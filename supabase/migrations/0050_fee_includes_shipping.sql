-- 0050 — Platform fee basis: goods subtotal + buyer-paid shipping (brief §2, §7).
--
-- The 10% DRVN fee was computed on the merchandise subtotal only, which lets a
-- seller move economic value into "shipping" and cut DRVN out of it: a $300
-- part with $23 shipping paid $30 in fee whether the seller priced it
-- 300/23 or 100/223. From 0050 the fee basis is subtotal + shipping — the
-- full amount the buyer pays before tax — in both order-creation paths.
--
-- Worked example (the brief's): item $300, buyer-paid shipping $23 → total
-- $323, fee $32.30, eventual seller proceeds $323 − $32.30 − label cost.
--
-- Historical orders are untouched: platform_fee_cents is stored on the order
-- at creation and every downstream consumer (ledger, transfers, refunds,
-- admin) already prefers the stored figure. Nothing recomputes old fees from
-- current configuration.
--
-- Both functions are restated in full because the function body is the
-- definition (0034 precedent). purchase_begin is otherwise identical to the
-- 0007 version; offer_accept_begin to the 0034 version. The only change in
-- each is the fee line.
--
-- The TS mirror of the rate lives in src/lib/payments/provider.ts
-- (PLATFORM_FEE_BPS = 1000); its BASIS callers change in the same commit as
-- this migration.
--
-- Idempotent. Safe to re-run.

begin;

-- ============================================================
-- purchase_begin — fee on subtotal + shipping
-- ============================================================
create or replace function public.purchase_begin(
  p_buyer_id uuid,
  p_listing_ids uuid[],
  p_idempotency_key text default null,
  p_reservation_window interval default interval '15 minutes'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_previous jsonb;
  v_orders jsonb := '[]'::jsonb;
  v_skipped jsonb := '[]'::jsonb;
  v_group record;
  v_order_id uuid;
  v_fee int;
  v_requested uuid[];
  v_claimed uuid[];
begin
  if p_idempotency_key is not null then
    select result into v_previous
    from public.purchase_attempts
    where idempotency_key = p_idempotency_key;

    if v_previous is not null then
      return v_previous;
    end if;
  end if;

  v_requested := coalesce(p_listing_ids, array[]::uuid[]);
  if array_length(v_requested, 1) is null then
    return jsonb_build_object('orders', v_orders, 'skipped', v_skipped);
  end if;

  -- Claim. Anything not returned here was unavailable, someone else's win, or
  -- the buyer's own listing.
  --
  -- `on commit drop` only fires at commit, so a second call inside the same
  -- transaction would otherwise find the table still there. Temp tables are
  -- per-session, so this cannot interfere with a concurrent buyer.
  drop table if exists _claimed;
  create temp table _claimed on commit drop as
  with claimed as (
    update public.listings l
    set status = 'reserved',
        reserved_until = now() + p_reservation_window
    where l.id = any (v_requested)
      and l.status = 'active'
      and l.seller_id <> p_buyer_id
    returning
      l.id, l.seller_id, l.title, l.price_cents, l.shipping_cents, l.currency
  )
  select * from claimed;

  select coalesce(array_agg(id), array[]::uuid[]) into v_claimed from _claimed;

  select coalesce(
    jsonb_agg(jsonb_build_object('listing_id', missing.id, 'reason', 'unavailable')),
    '[]'::jsonb
  )
  into v_skipped
  from (select unnest(v_requested) as id except select unnest(v_claimed)) as missing;

  -- One order per seller per currency.
  for v_group in
    select
      c.seller_id,
      c.currency,
      sum(c.price_cents)::int as subtotal,
      sum(c.shipping_cents)::int as shipping
    from _claimed c
    group by c.seller_id, c.currency
  loop
    -- Fee basis is everything the buyer pays before tax: goods + shipping
    -- (0050). Pricing value into "shipping" no longer reduces DRVN's fee.
    v_fee := round((v_group.subtotal + v_group.shipping) * 1000.0 / 10000.0);

    insert into public.orders (
      buyer_id, seller_id, status,
      subtotal_cents, shipping_cents, platform_fee_cents, total_cents, currency
    )
    values (
      p_buyer_id, v_group.seller_id, 'pending',
      v_group.subtotal, v_group.shipping, v_fee,
      v_group.subtotal + v_group.shipping, v_group.currency
    )
    returning id into v_order_id;

    insert into public.order_items (order_id, listing_id, title, price_cents, shipping_cents)
    select v_order_id, c.id, c.title, c.price_cents, c.shipping_cents
    from _claimed c
    where c.seller_id = v_group.seller_id and c.currency = v_group.currency;

    insert into public.payments (order_id, amount_cents, currency, idempotency_key, status)
    values (
      v_order_id,
      v_group.subtotal + v_group.shipping,
      v_group.currency,
      case
        when p_idempotency_key is null then null
        else p_idempotency_key || ':' || v_order_id::text
      end,
      'pending'
    );

    v_orders := v_orders || jsonb_build_object(
      'order_id', v_order_id,
      'seller_id', v_group.seller_id,
      'currency', v_group.currency,
      'subtotal_cents', v_group.subtotal,
      'shipping_cents', v_group.shipping,
      'platform_fee_cents', v_fee,
      'total_cents', v_group.subtotal + v_group.shipping,
      'listing_ids', (
        select jsonb_agg(c.id)
        from _claimed c
        where c.seller_id = v_group.seller_id and c.currency = v_group.currency
      )
    );
  end loop;

  v_previous := jsonb_build_object('orders', v_orders, 'skipped', v_skipped);

  if p_idempotency_key is not null then
    insert into public.purchase_attempts (idempotency_key, buyer_id, result)
    values (p_idempotency_key, p_buyer_id, v_previous)
    on conflict (idempotency_key) do nothing;
  end if;

  return v_previous;
end;
$$;

revoke all on function public.purchase_begin(uuid, uuid[], text, interval)
  from public, anon, authenticated;

-- ============================================================
-- offer_accept_begin — fee on price + shipping
-- ============================================================
create or replace function public.offer_accept_begin(
  p_offer_id uuid,
  p_seller_id uuid,
  p_reservation_window interval default interval '24 hours'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_offer record;
  v_listing record;
  v_price int;
  v_fee int;
  v_order_id uuid;
begin
  select o.id, o.listing_id, o.buyer_id, o.amount_cents, o.counter_amount_cents,
         o.status, o.expires_at
  into v_offer
  from public.offers o
  where o.id = p_offer_id
  for update;

  if not found or v_offer.status not in ('open', 'countered') then
    return null;
  end if;

  -- Honour expiry. A months-old offer must not be acceptable at its old price.
  if v_offer.expires_at is not null and v_offer.expires_at < now() then
    update public.offers
    set status = 'expired', responded_at = now()
    where id = p_offer_id;
    return null;
  end if;

  v_price := coalesce(v_offer.counter_amount_cents, v_offer.amount_cents);

  update public.listings l
  set status = 'reserved', reserved_until = now() + p_reservation_window
  where l.id = v_offer.listing_id
    and l.seller_id = p_seller_id
    and l.status = 'active'
  returning l.id, l.title, l.shipping_cents, l.currency
  into v_listing;

  if not found then
    return null;
  end if;

  -- Fee basis is everything the buyer pays before tax: goods + shipping
  -- (0050). An accepted offer cannot dodge the fee through shipping either.
  v_fee := round((v_price + v_listing.shipping_cents) * 1000.0 / 10000.0);

  insert into public.orders (
    buyer_id, seller_id, status,
    subtotal_cents, shipping_cents, platform_fee_cents, total_cents, currency,
    origin_offer_id
  )
  values (
    v_offer.buyer_id, p_seller_id, 'pending',
    v_price, v_listing.shipping_cents, v_fee,
    v_price + v_listing.shipping_cents, v_listing.currency,
    p_offer_id
  )
  returning id into v_order_id;

  insert into public.order_items (order_id, listing_id, title, price_cents, shipping_cents)
  values (v_order_id, v_listing.id, v_listing.title, v_price, v_listing.shipping_cents);

  -- Keyed on the order so a replayed completion cannot double-charge.
  insert into public.payments (order_id, amount_cents, currency, status, idempotency_key)
  values (
    v_order_id,
    v_price + v_listing.shipping_cents,
    v_listing.currency,
    'pending',
    'offer:' || p_offer_id::text || ':' || v_order_id::text
  );

  update public.offers
  set status = 'accepted', responded_at = now()
  where id = p_offer_id;

  return v_order_id;
end;
$$;

revoke all on function public.offer_accept_begin(uuid, uuid, interval)
  from public, anon, authenticated;

-- ============================================================
-- Self-checks
-- ============================================================
do $$
declare
  v_def text;
begin
  v_def := pg_get_functiondef('public.purchase_begin(uuid, uuid[], text, interval)'::regprocedure);
  if position('(v_group.subtotal + v_group.shipping) * 1000.0' in v_def) = 0 then
    raise exception '0050: purchase_begin fee basis does not include shipping';
  end if;

  v_def := pg_get_functiondef('public.offer_accept_begin(uuid, uuid, interval)'::regprocedure);
  if position('(v_price + v_listing.shipping_cents) * 1000.0' in v_def) = 0 then
    raise exception '0050: offer_accept_begin fee basis does not include shipping';
  end if;
  -- 0034's contract must survive the restatement.
  if position('origin_offer_id' in v_def) = 0 then
    raise exception '0050: offer_accept_begin lost origin_offer_id';
  end if;

  raise notice 'PASS: 0050 self-checks';
end $$;

commit;
