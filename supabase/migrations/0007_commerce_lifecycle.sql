-- ============================================================================
-- 0007 — Commerce lifecycle (remediation plan R2 + R3.1)
--
-- Three problems, one migration:
--
--  1. The purchase path was check-then-act across five separate round trips
--     with no transaction. Two buyers could both be sold the same part, an
--     order could exist with no items (the insert error was discarded), and a
--     crash mid-sequence left paid-but-still-active listings. Fixed by moving
--     the whole claim into `purchase_begin`, which uses a conditional UPDATE as
--     its lock, and finishing in `purchase_finalize`.
--
--  2. Nothing recorded *what was paid*. `payment.reference` was thrown away,
--     so reconciliation, refunds and webhooks were impossible. Fixed by a
--     `payments` table keyed by provider reference and idempotency key.
--
--  3. Orders stopped at 'paid'. 'shipped'/'completed' were declared and
--     unreachable, no address was ever collected, and there was nowhere to put
--     tracking. Fixed by the lifecycle columns below.
--
-- The claim → pay → finalize split is deliberately shaped for a real
-- processor: when Stripe lands (R6), `purchase_finalize` is what the webhook
-- calls, and the reservation window is already modelled.
--
-- Idempotent: safe to re-run.
-- Run in the Supabase SQL Editor.
-- ============================================================================

begin;

-- ============================================================
-- 1. listings — reservation, shipping, pausing, offer floor
-- ============================================================
alter table public.listings
  drop constraint if exists listings_status_check;
alter table public.listings
  add constraint listings_status_check check (
    status in ('draft', 'active', 'reserved', 'paused', 'sold', 'archived')
  );

alter table public.listings
  -- Seller-set flat shipping, charged on top of the asking price.
  add column if not exists shipping_cents int not null default 0,
  add column if not exists allows_collection boolean not null default false,
  -- Offers below this are rejected before they reach the seller.
  add column if not exists offer_floor_cents int,
  add column if not exists sold_at timestamptz,
  -- Set while a checkout holds the listing, so an abandoned attempt frees it.
  add column if not exists reserved_until timestamptz;

alter table public.listings
  drop constraint if exists listings_shipping_bounds,
  add constraint listings_shipping_bounds check (
    shipping_cents >= 0 and shipping_cents <= 10000000
  );

alter table public.listings
  drop constraint if exists listings_offer_floor_bounds,
  add constraint listings_offer_floor_bounds check (
    offer_floor_cents is null or (offer_floor_cents > 0 and offer_floor_cents <= price_cents)
  );

-- ============================================================
-- 2. orders — lifecycle, shipping address, erasure-safe parties
-- ============================================================
alter table public.orders
  drop constraint if exists orders_status_check;
alter table public.orders
  add constraint orders_status_check check (
    status in (
      'pending',         -- created, awaiting payment
      'requires_action', -- processor needs the buyer (3DS) — used from R6
      'payment_failed',
      'paid',
      'shipped',
      'delivered',
      'completed',
      'cancelled',
      'refunded',
      'disputed'
    )
  );

alter table public.orders
  add column if not exists shipping_cents int not null default 0,
  add column if not exists ship_name text,
  add column if not exists ship_line1 text,
  add column if not exists ship_line2 text,
  add column if not exists ship_city text,
  add column if not exists ship_postcode text,
  add column if not exists ship_country text,
  add column if not exists ship_phone text,
  add column if not exists is_collection boolean not null default false,
  add column if not exists carrier text,
  add column if not exists tracking_number text,
  add column if not exists shipped_at timestamptz,
  add column if not exists delivered_at timestamptz,
  add column if not exists completed_at timestamptz,
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancel_reason text,
  -- Snapshot of who traded, so history survives account deletion.
  add column if not exists buyer_label text,
  add column if not exists seller_label text;

-- Erasure: every other FK in the schema cascades, but these two had no ON
-- DELETE clause at all — so deleting a user who had ever transacted failed on
-- a foreign-key violation. Anonymise instead of cascading: the counterparty
-- keeps their order history, and the label preserves who it was with.
update public.orders o
set buyer_label = coalesce(o.buyer_label, p.display_name, p.username, 'DRVN member')
from public.profiles p
where p.id = o.buyer_id and o.buyer_label is null;

update public.orders o
set seller_label = coalesce(o.seller_label, p.display_name, p.username, 'DRVN member')
from public.profiles p
where p.id = o.seller_id and o.seller_label is null;

alter table public.orders alter column buyer_id drop not null;
alter table public.orders alter column seller_id drop not null;

alter table public.orders drop constraint if exists orders_buyer_id_fkey;
alter table public.orders
  add constraint orders_buyer_id_fkey
  foreign key (buyer_id) references public.profiles (id) on delete set null;

alter table public.orders drop constraint if exists orders_seller_id_fkey;
alter table public.orders
  add constraint orders_seller_id_fkey
  foreign key (seller_id) references public.profiles (id) on delete set null;

create or replace function public.snapshot_order_parties()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.buyer_label is null then
    select coalesce(display_name, username, 'DRVN member') into new.buyer_label
    from public.profiles where id = new.buyer_id;
  end if;
  if new.seller_label is null then
    select coalesce(display_name, username, 'DRVN member') into new.seller_label
    from public.profiles where id = new.seller_id;
  end if;
  return new;
end;
$$;

drop trigger if exists orders_snapshot_parties on public.orders;
create trigger orders_snapshot_parties
  before insert on public.orders
  for each row execute function public.snapshot_order_parties();

-- Order history must survive a listing being removed, so snapshot the title
-- and stop the listing FK from blocking or cascading.
alter table public.order_items
  add column if not exists title text,
  add column if not exists shipping_cents int not null default 0;

alter table public.order_items alter column listing_id drop not null;
alter table public.order_items drop constraint if exists order_items_listing_id_fkey;
alter table public.order_items
  add constraint order_items_listing_id_fkey
  foreign key (listing_id) references public.listings (id) on delete set null;

-- Messages were keyed to an offer, so a cart or buy-now purchase — which has no
-- offer — had no channel at all. Thread them on the order instead.
alter table public.messages
  add column if not exists order_id uuid references public.orders (id) on delete cascade;

-- A message must belong to *something* addressable.
alter table public.messages
  drop constraint if exists messages_has_context,
  add constraint messages_has_context check (
    offer_id is not null or order_id is not null or listing_id is not null
  );

-- Extend 0006's immutability guard to cover the new context column.
create or replace function public.guard_message_columns()
returns trigger
language plpgsql
as $$
begin
  if public.is_trusted_writer() then
    return new;
  end if;

  if new.body is distinct from old.body
     or new.sender_id is distinct from old.sender_id
     or new.recipient_id is distinct from old.recipient_id
     or new.listing_id is distinct from old.listing_id
     or new.offer_id is distinct from old.offer_id
     or new.order_id is distinct from old.order_id then
    raise exception 'only read_at may be updated on a message'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

-- ============================================================
-- 3. payments
-- ============================================================
create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  provider text not null default 'stub',
  provider_reference text,
  status text not null default 'pending' check (
    status in ('pending', 'requires_action', 'succeeded', 'failed', 'refunded', 'partially_refunded')
  ),
  amount_cents int not null,
  refunded_cents int not null default 0,
  currency text not null default 'USD',
  idempotency_key text,
  failure_reason text,
  raw jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists payments_idempotency_key_idx
  on public.payments (idempotency_key) where idempotency_key is not null;
create unique index if not exists payments_provider_reference_idx
  on public.payments (provider, provider_reference) where provider_reference is not null;
create index if not exists payments_order_idx on public.payments (order_id);

alter table public.payments enable row level security;

-- Buyers and sellers may see that a payment exists and its state; only the
-- service role writes them.
drop policy if exists "participants read payments" on public.payments;
create policy "participants read payments" on public.payments for select
  using (exists (
    select 1 from public.orders o
    where o.id = order_id and auth.uid() in (o.buyer_id, o.seller_id)
  ));

-- ============================================================
-- 4. offers — counter-offers and expiry
-- ============================================================
alter table public.offers
  drop constraint if exists offers_status_check;
alter table public.offers
  add constraint offers_status_check check (
    status in ('open', 'countered', 'accepted', 'declined', 'withdrawn', 'expired')
  );

alter table public.offers
  add column if not exists counter_amount_cents int,
  add column if not exists countered_at timestamptz,
  add column if not exists expires_at timestamptz,
  add column if not exists responded_at timestamptz;

alter table public.offers
  drop constraint if exists offers_counter_bounds,
  add constraint offers_counter_bounds check (
    counter_amount_cents is null
    or (counter_amount_cents > 0 and counter_amount_cents <= 100000000)
  );

-- A countered offer is live again for the buyer, so the "final once it leaves
-- open" guard from 0006 has to admit that one transition.
create or replace function public.guard_offer_columns()
returns trigger
language plpgsql
as $$
begin
  if public.is_trusted_writer() then
    return new;
  end if;

  if new.amount_cents is distinct from old.amount_cents
     or new.listing_id is distinct from old.listing_id
     or new.buyer_id is distinct from old.buyer_id
     or new.counter_amount_cents is distinct from old.counter_amount_cents then
    raise exception 'offer amount and parties are immutable'
      using errcode = '42501';
  end if;

  if old.status not in ('open', 'countered') and new.status <> old.status then
    raise exception 'offer status is final once it leaves open'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

-- Buyers may withdraw an open *or* countered offer.
drop policy if exists "buyers withdraw own offers" on public.offers;
create policy "buyers withdraw own offers" on public.offers for update
  using (auth.uid() = buyer_id and status in ('open', 'countered'))
  with check (auth.uid() = buyer_id and status in ('open', 'countered', 'withdrawn'));

-- ============================================================
-- 5. Reviews only after the goods arrived
-- ============================================================
-- Previously accepted at 'paid', so a buyer could rate a seller before
-- anything shipped.
drop policy if exists "reviewers create reviews" on public.reviews;
create policy "reviewers create reviews" on public.reviews for insert
  with check (
    auth.uid() = reviewer_id
    and reviewer_id is distinct from reviewee_id
    and exists (
      select 1 from public.orders o
      where o.id = order_id
        and auth.uid() in (o.buyer_id, o.seller_id)
        and reviewee_id = case
              when auth.uid() = o.buyer_id then o.seller_id
              else o.buyer_id
            end
        and o.status in ('delivered', 'completed')
    )
  );

-- ============================================================
-- 6. updated_at maintenance
-- ============================================================
-- The columns existed on six tables and nothing ever set them.
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array[
    'profiles', 'cars', 'activity_posts', 'listings',
    'mod_items', 'orders', 'offers', 'payments'
  ]
  loop
    execute format('drop trigger if exists %I_touch_updated_at on public.%I', t, t);
    execute format(
      'create trigger %I_touch_updated_at before update on public.%I
       for each row execute function public.touch_updated_at()', t, t
    );
  end loop;
end $$;

-- ============================================================
-- 7. Atomic purchase: claim → pay → finalize
-- ============================================================
create table if not exists public.purchase_attempts (
  idempotency_key text primary key,
  buyer_id uuid references public.profiles (id) on delete cascade,
  result jsonb not null,
  created_at timestamptz not null default now()
);

alter table public.purchase_attempts enable row level security;
-- No policies: service-role only.

/**
 * Claims listings and creates pending orders in a single transaction.
 *
 * The conditional UPDATE is the lock: a listing moves active → reserved only
 * if it is still active, and only the transaction that wins that update gets
 * the row back. That closes the double-sell race without an advisory lock, and
 * it is also the idempotency guard — a replay claims nothing.
 *
 * One order per (seller, currency): grouping by currency means a mixed-currency
 * basket can never be summed into a single total, which the old code did.
 *
 * Returns { orders: [...], skipped: [{listing_id, reason}] } so the caller can
 * tell the buyer exactly what happened rather than silently dropping items.
 */
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
    -- Fee comes out of the seller's proceeds on the goods only, never on
    -- shipping; the buyer pays goods + shipping.
    v_fee := round(v_group.subtotal * 1000.0 / 10000.0);

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

/**
 * Settles a claimed order. On success the listings become sold; on failure
 * they return to sale and the reservation is released. This is the function a
 * payment webhook will call once a real processor is wired in.
 */
create or replace function public.purchase_finalize(
  p_order_id uuid,
  p_success boolean,
  p_provider text default 'stub',
  p_reference text default null,
  p_failure_reason text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_listing_ids uuid[];
begin
  select coalesce(array_agg(listing_id), array[]::uuid[])
  into v_listing_ids
  from public.order_items
  where order_id = p_order_id and listing_id is not null;

  if p_success then
    update public.orders
    set status = 'paid'
    where id = p_order_id and status in ('pending', 'requires_action');

    update public.listings
    set status = 'sold', sold_at = now(), reserved_until = null
    where id = any (v_listing_ids) and status = 'reserved';

    update public.payments
    set status = 'succeeded', provider = p_provider, provider_reference = p_reference
    where order_id = p_order_id;

    -- Any other open offer on a sold listing is now moot.
    update public.offers
    set status = 'expired', responded_at = now()
    where listing_id = any (v_listing_ids) and status in ('open', 'countered');
  else
    update public.orders
    set status = 'payment_failed', cancelled_at = now(), cancel_reason = p_failure_reason
    where id = p_order_id;

    update public.listings
    set status = 'active', reserved_until = null
    where id = any (v_listing_ids) and status = 'reserved';

    update public.payments
    set status = 'failed', provider = p_provider, failure_reason = p_failure_reason
    where order_id = p_order_id;
  end if;
end;
$$;

/**
 * Accepts an offer atomically: claims the listing at the agreed price and
 * creates the pending order. Same claim-then-pay shape as purchase_begin.
 * Returns the order id, or null if the listing was no longer available.
 */
create or replace function public.offer_accept_begin(
  p_offer_id uuid,
  p_seller_id uuid,
  p_reservation_window interval default interval '15 minutes'
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
  select o.id, o.listing_id, o.buyer_id, o.amount_cents, o.counter_amount_cents, o.status
  into v_offer
  from public.offers o
  where o.id = p_offer_id
  for update;

  if not found or v_offer.status not in ('open', 'countered') then
    return null;
  end if;

  -- A countered offer settles at the counter price.
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
    subtotal_cents, shipping_cents, platform_fee_cents, total_cents, currency
  )
  values (
    v_offer.buyer_id, p_seller_id, 'pending',
    v_price, v_listing.shipping_cents, v_fee,
    v_price + v_listing.shipping_cents, v_listing.currency
  )
  returning id into v_order_id;

  insert into public.order_items (order_id, listing_id, title, price_cents, shipping_cents)
  values (v_order_id, v_listing.id, v_listing.title, v_price, v_listing.shipping_cents);

  insert into public.payments (order_id, amount_cents, currency, status)
  values (v_order_id, v_price + v_listing.shipping_cents, v_listing.currency, 'pending');

  update public.offers
  set status = 'accepted', responded_at = now()
  where id = p_offer_id;

  return v_order_id;
end;
$$;

/** Releases reservations from abandoned checkouts. Safe to run on a schedule. */
create or replace function public.release_expired_reservations()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  with released as (
    update public.listings
    set status = 'active', reserved_until = null
    where status = 'reserved' and reserved_until < now()
    returning id
  )
  select count(*) into v_count from released;

  update public.orders
  set status = 'cancelled', cancelled_at = now(), cancel_reason = 'checkout abandoned'
  where status = 'pending' and created_at < now() - interval '1 hour';

  return v_count;
end;
$$;

revoke all on function public.purchase_begin(uuid, uuid[], text, interval) from public, anon, authenticated;
revoke all on function public.purchase_finalize(uuid, boolean, text, text, text) from public, anon, authenticated;
revoke all on function public.offer_accept_begin(uuid, uuid, interval) from public, anon, authenticated;
revoke all on function public.release_expired_reservations() from public, anon, authenticated;

commit;
