-- 0053 — Listing shipping choices + rated checkout plumbing (brief §11, §14, §15).
--
-- A listing now declares how it ships:
--   'flat'        — seller-arranged, the existing flat shipping_cents.
--   'drvn'        — DRVN Shipping: rated via the shipping provider from the
--                   seller-declared parcel (weight/dims) and the seller's
--                   fulfillment profile (0051). Requires all four measures.
--   'pickup_only' — local pickup, no shipping. Requires allows_collection.
-- Any mode may ALSO offer pickup via the existing allows_collection flag.
--
-- Rated checkout: the buyer's selected rate must never be client-trusted, so
-- quotes live server-side in shipping_rate_quotes (deny-all RLS; written and
-- consumed only by server actions). Checkout passes the quoted amounts into
-- purchase_begin via a new p_shipping_overrides parameter — restated in full
-- below (0050 body + the override join); the fee basis (0050) then includes
-- quoted shipping automatically. The chosen service is frozen onto the order
-- as orders.shipping_quote jsonb (§15.7): historical evidence, like the 0049
-- snapshot, never re-derived from live provider state.
--
-- Pickup hardening (§14): orders.is_collection was client-trusted. Now a
-- database guard refuses is_collection = true unless every order item's
-- frozen commercial snapshot says the listing offered collection — the
-- snapshot, not the live listing, because the sale is judged by what was
-- represented at purchase. The checkout action additionally validates per
-- seller-order before writing.
--
-- Idempotent. Safe to re-run.

begin;

-- ============================================================
-- 1. listings — shipping mode + parcel
-- ============================================================
alter table public.listings
  add column if not exists shipping_mode text not null default 'flat',
  add column if not exists weight_oz numeric(8,2),
  add column if not exists length_in numeric(6,2),
  add column if not exists width_in numeric(6,2),
  add column if not exists height_in numeric(6,2);

alter table public.listings drop constraint if exists listings_shipping_mode_check;
alter table public.listings add constraint listings_shipping_mode_check
  check (shipping_mode in ('flat', 'drvn', 'pickup_only'));

-- 'drvn' needs a complete positive parcel; 'pickup_only' needs collection on
-- and no shipping charge (there is nothing to charge for).
alter table public.listings drop constraint if exists listings_shipping_mode_shape_check;
alter table public.listings add constraint listings_shipping_mode_shape_check
  check (
    (shipping_mode <> 'drvn' or (
      weight_oz > 0 and length_in > 0 and width_in > 0 and height_in > 0
    ))
    and (shipping_mode <> 'pickup_only' or (allows_collection and shipping_cents = 0))
  );

-- ============================================================
-- 2. shipping_rate_quotes — server-held, short-lived
-- ============================================================
create table if not exists public.shipping_rate_quotes (
  id uuid primary key default gen_random_uuid(),
  -- Signed-in buyer; null for guest checkouts (bound by quote id possession
  -- plus the destination hash below).
  buyer_id uuid references public.profiles (id) on delete cascade,
  listing_id uuid not null references public.listings (id) on delete cascade,
  provider text not null,
  provider_shipment_id text not null,
  rate_ref text not null,
  carrier text not null,
  service text not null,
  service_label text not null,
  amount_cents int not null check (amount_cents >= 0),
  currency text not null default 'USD',
  est_delivery_days int,
  -- Fingerprint of the destination the rate was quoted for — a quote cannot
  -- be replayed against a different address.
  destination_hash text not null,
  parcel jsonb not null,
  consumed_order_id uuid references public.orders (id) on delete set null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists shipping_rate_quotes_listing_idx
  on public.shipping_rate_quotes (listing_id, created_at);
create index if not exists shipping_rate_quotes_expiry_idx
  on public.shipping_rate_quotes (expires_at);

alter table public.shipping_rate_quotes enable row level security;
revoke all on public.shipping_rate_quotes from anon, authenticated;
-- Deny-all: quotes are a server-side ledger. The client only ever holds
-- opaque quote ids handed out by the rating action.

-- ============================================================
-- 3. orders — frozen shipping service snapshot
-- ============================================================
alter table public.orders
  add column if not exists shipping_quote jsonb;

comment on column public.orders.shipping_quote is
  'DRVN Shipping service frozen at checkout (§15.7): provider, service, quoted amount, parcel. Null for flat/pickup orders.';

-- ============================================================
-- 4. Pickup guard — the snapshot decides, not the client
-- ============================================================
create or replace function public.guard_order_collection()
returns trigger
language plpgsql
as $$
begin
  if new.is_collection and not old.is_collection then
    if exists (
      select 1
        from public.order_items oi
       where oi.order_id = new.id
         and coalesce(
               (oi.commercial_snapshot -> 'commercial' ->> 'allows_collection')::boolean,
               false
             ) = false
    ) then
      raise exception 'pickup not offered by every item on this order'
        using errcode = '42501';
    end if;
    if not exists (select 1 from public.order_items oi where oi.order_id = new.id) then
      raise exception 'pickup cannot be set before order items exist'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists orders_collection_guard on public.orders;
create trigger orders_collection_guard
  before update on public.orders
  for each row execute function public.guard_order_collection();

-- ============================================================
-- 5. purchase_begin — shipping overrides for rated checkout
-- ============================================================
-- Identical to the 0050 body except: p_shipping_overrides (jsonb object of
-- listing_id → cents, server-validated quote amounts) replaces the listing's
-- flat shipping_cents where present. Restated in full because the function
-- body is the definition.
drop function if exists public.purchase_begin(uuid, uuid[], text, interval);
create or replace function public.purchase_begin(
  p_buyer_id uuid,
  p_listing_ids uuid[],
  p_idempotency_key text default null,
  p_reservation_window interval default interval '15 minutes',
  p_shipping_overrides jsonb default null
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
  select
    c.id, c.seller_id, c.title, c.price_cents, c.currency,
    -- Rated checkout (0053): the server-validated quote amount replaces the
    -- flat charge where an override is present. Never negative.
    greatest(
      coalesce((p_shipping_overrides ->> c.id::text)::int, c.shipping_cents),
      0
    ) as shipping_cents
  from claimed c;

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

revoke all on function public.purchase_begin(uuid, uuid[], text, interval, jsonb)
  from public, anon, authenticated;

-- ============================================================
-- Self-checks
-- ============================================================
do $$
declare
  v_def text;
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'listings'
      and column_name = 'shipping_mode'
  ) then
    raise exception '0053: listings.shipping_mode missing';
  end if;

  if to_regclass('public.shipping_rate_quotes') is null then
    raise exception '0053: shipping_rate_quotes missing';
  end if;

  -- Deny-all: the quotes table must have zero policies.
  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'shipping_rate_quotes'
  ) then
    raise exception '0053: shipping_rate_quotes has a policy; it must have none';
  end if;

  if not exists (
    select 1 from pg_trigger
    where tgname = 'orders_collection_guard' and tgrelid = 'public.orders'::regclass
  ) then
    raise exception '0053: orders_collection_guard missing';
  end if;

  v_def := pg_get_functiondef('public.purchase_begin(uuid, uuid[], text, interval, jsonb)'::regprocedure);
  if position('p_shipping_overrides' in v_def) = 0 then
    raise exception '0053: purchase_begin lacks shipping overrides';
  end if;
  if position('(v_group.subtotal + v_group.shipping) * 1000.0' in v_def) = 0 then
    raise exception '0053: purchase_begin lost the 0050 fee basis';
  end if;

  -- The 4-arg signature must be gone — two overloads would make PostgREST
  -- rpc calls ambiguous.
  if exists (
    select 1 from pg_proc
    where proname = 'purchase_begin'
      and pronamespace = 'public'::regnamespace
      and pg_get_function_identity_arguments(oid) = 'p_buyer_id uuid, p_listing_ids uuid[], p_idempotency_key text, p_reservation_window interval'
  ) then
    raise exception '0053: old purchase_begin overload still present';
  end if;

  raise notice 'PASS: 0053 self-checks';
end $$;

commit;
