-- 0034 — orders.origin_offer_id: the canonical accepted-offer → order link.
--
-- The offer thread had no foreign key to the order an acceptance produced, so
-- /offers/<id> guessed: it collected every order_item for the listing, then
-- took the buyer's most recent matching order. That is only right because a
-- listing is usually reserved once. Re-listed parts, cancelled-then-rebought
-- orders and a buyer who bought the same listing twice all break it — silently,
-- by linking an offer to somebody else's transaction shape.
--
-- The relationship is now a column, written inside offer_accept_begin in the
-- same transaction that creates the order, and unique: one order per offer.
-- Buy-now orders keep it null, which is what they are — orders with no
-- negotiation behind them.
--
-- Backfill is deliberately narrow. offer_accept_begin (0012 onward) writes the
-- payments idempotency key as 'offer:<offer_id>:<order_id>', which is a durable
-- record of the pairing rather than an inference, so those rows can be linked
-- exactly. Orders from the 0007-era accept carry no such key; they are left
-- null rather than guessed at, and the self-check below reports how many.
--
-- Idempotent: guarded with IF NOT EXISTS throughout. Safe to re-run.

begin;

alter table public.orders
  add column if not exists origin_offer_id uuid
    references public.offers (id) on delete set null;

comment on column public.orders.origin_offer_id is
  'The accepted offer this order came from. NULL for buy-now and cart orders.';

-- One order per offer. Partial so the null-heavy buy-now majority costs
-- nothing and does not collide with itself.
create unique index if not exists orders_origin_offer_id_key
  on public.orders (origin_offer_id)
  where origin_offer_id is not null;

-- Offer-detail reads it the other way round (offer → order), which the unique
-- index above already serves, but order-detail resolves order → offer through
-- the FK, so no second index is needed.

-- ============================================================
-- offer_accept_begin — stamp the relation as the order is created
-- ============================================================
-- Identical to the 0012 version apart from the origin_offer_id column on the
-- insert. Restated in full because the function body is the definition.
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

  v_fee := round(v_price * 1000.0 / 10000.0);

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

revoke all on function public.offer_accept_begin(uuid, uuid, interval) from public, anon, authenticated;

-- ============================================================
-- Backfill — from the payments idempotency key only
-- ============================================================
-- 'offer:<offer_id>:<order_id>' was written by the accept path itself, so this
-- is reading a record, not reconstructing one. Rows that would collide on the
-- unique index (the same offer already claimed by another order) are excluded
-- rather than overwritten.
do $$
declare
  v_linked int;
  v_unlinked int;
begin
  with keyed as (
    select
      p.order_id,
      nullif(split_part(p.idempotency_key, ':', 2), '')::uuid as offer_id
    from public.payments p
    where p.idempotency_key like 'offer:%'
  ),
  valid as (
    select k.order_id, k.offer_id
    from keyed k
    join public.offers o on o.id = k.offer_id
    join public.orders ord on ord.id = k.order_id
    where ord.origin_offer_id is null
      and not exists (
        select 1 from public.orders other
        where other.origin_offer_id = k.offer_id
      )
  ),
  -- Defensive: if two orders somehow keyed the same offer, link neither.
  -- (array_agg(...))[1] rather than min() — Postgres has no min(uuid).
  unique_pairs as (
    select offer_id, (array_agg(order_id))[1] as order_id
    from valid
    group by offer_id
    having count(*) = 1
  )
  update public.orders ord
  set origin_offer_id = u.offer_id
  from unique_pairs u
  where ord.id = u.order_id;

  get diagnostics v_linked = row_count;

  select count(*) into v_unlinked
  from public.offers o
  where o.status = 'accepted'
    and not exists (
      select 1 from public.orders ord where ord.origin_offer_id = o.id
    );

  raise notice '0034: linked % order(s) from the payments key; % accepted offer(s) remain unlinked (pre-0012 accepts — left null rather than guessed)',
    v_linked, v_unlinked;
end $$;

-- ============================================================
-- Self-checks
-- ============================================================
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'orders'
      and column_name = 'origin_offer_id'
  ) then
    raise exception '0034: orders.origin_offer_id missing';
  end if;

  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public' and indexname = 'orders_origin_offer_id_key'
  ) then
    raise exception '0034: orders_origin_offer_id_key missing';
  end if;

  -- The function must stamp the column, or the whole point is lost.
  if position('origin_offer_id' in pg_get_functiondef(
       'public.offer_accept_begin(uuid, uuid, interval)'::regprocedure
     )) = 0 then
    raise exception '0034: offer_accept_begin does not set origin_offer_id';
  end if;

  raise notice 'PASS: 0034 self-checks';
end $$;

commit;
