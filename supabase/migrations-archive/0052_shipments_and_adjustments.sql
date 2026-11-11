-- 0052 — Shipments domain + seller adjustments ledger (brief §13, §17).
--
-- Order = the commercial transaction; Shipment = physical goods moving. The
-- two were previously conflated into carrier/tracking columns on orders,
-- which cannot represent multiple parcels, return legs, or label economics.
-- orders keeps its carrier/tracking columns for compatibility (existing UI
-- reads them; fulfillment code now writes both), but shipments is the
-- authoritative movement record going forward.
--
--   shipments        — one row per parcel/label (outbound or return).
--   shipment_items   — which purchased items are in which parcel. MVP: one
--                      listing = one parcel (brief §12), so usually 1:1.
--   shipment_events  — lightweight tracking history (no raw provider blobs;
--                      provider refs kept for re-fetch/reconcile).
--   seller_adjustments — the minimal signed ledger that makes payout math
--                      explicit: label costs, label refunds, insurance.
--                      NOT a wallet product. Negative = comes out of the
--                      seller's payout, positive = credited back. A void or
--                      provider refund REVERSES via a new opposing row
--                      (label_refund); history is never mutated. voided_at
--                      exists only for admin correction of an erroneous row
--                      and excludes it from payout sums.
--
-- Status machine (guarded by trigger, 0047 pattern; mirrored in
-- src/lib/domain/states.ts):
--   pending → label_purchased | in_transit | cancelled | failed
--   label_purchased → in_transit | out_for_delivery | delivered
--                     | returned_to_sender | cancelled | failed
--   in_transit → out_for_delivery | delivered | returned_to_sender | failed
--   out_for_delivery → delivered | in_transit | returned_to_sender | failed
--   returned_to_sender → in_transit            (carrier re-attempts happen)
--   delivered / cancelled / failed = terminal
-- Seller-arranged shipments skip label_purchased (pending → in_transit when
-- the seller enters tracking).
--
-- Privacy/read model: buyers and sellers both read shipment progress, but
-- label_reference (the printable label) and provider internals are excluded
-- from the client column grant — the label reaches the seller through a
-- server action only. Writes everywhere: service role.
--
-- Idempotent. Safe to re-run.

begin;

-- ============================================================
-- 1. shipments
-- ============================================================
create table if not exists public.shipments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  direction text not null default 'outbound',
  -- FK to returns arrives with the returns domain migration.
  return_id uuid,
  provider text,
  provider_shipment_id text,
  provider_tracker_id text,
  fulfillment_type text not null,
  carrier text,
  service text,
  status text not null default 'pending',
  tracking_code text,
  label_reference text,
  quoted_cents int,
  purchased_cents int,
  insured_value_cents int,
  signature_required boolean not null default false,
  shipped_at timestamptz,
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.shipments drop constraint if exists shipments_direction_check;
alter table public.shipments add constraint shipments_direction_check
  check (direction in ('outbound', 'return'));

alter table public.shipments drop constraint if exists shipments_fulfillment_type_check;
alter table public.shipments add constraint shipments_fulfillment_type_check
  check (fulfillment_type in ('drvn_shipping', 'seller_arranged'));

alter table public.shipments drop constraint if exists shipments_status_check;
alter table public.shipments add constraint shipments_status_check
  check (status in (
    'pending', 'label_purchased', 'in_transit', 'out_for_delivery',
    'delivered', 'returned_to_sender', 'cancelled', 'failed'
  ));

alter table public.shipments drop constraint if exists shipments_money_check;
alter table public.shipments add constraint shipments_money_check
  check (
    (quoted_cents is null or quoted_cents >= 0)
    and (purchased_cents is null or purchased_cents >= 0)
    and (insured_value_cents is null or insured_value_cents >= 0)
  );

create index if not exists shipments_order_idx on public.shipments (order_id);
create index if not exists shipments_tracking_idx on public.shipments (tracking_code)
  where tracking_code is not null;
-- Webhook lookups arrive keyed by the provider's tracker id.
create index if not exists shipments_provider_tracker_idx
  on public.shipments (provider_tracker_id) where provider_tracker_id is not null;
create index if not exists shipments_provider_shipment_idx
  on public.shipments (provider_shipment_id) where provider_shipment_id is not null;

drop trigger if exists shipments_touch_updated_at on public.shipments;
create trigger shipments_touch_updated_at
  before update on public.shipments
  for each row execute function public.touch_updated_at();

-- Transition guard — legality lives in the database (0047 precedent). The
-- domain map in src/lib/domain/states.ts documents this; divergence there is
-- a bug in states.ts.
create or replace function public.guard_shipment_status()
returns trigger
language plpgsql
as $$
begin
  if new.status is distinct from old.status then
    if not (
      (old.status = 'pending' and new.status in ('label_purchased', 'in_transit', 'cancelled', 'failed'))
      or (old.status = 'label_purchased' and new.status in ('in_transit', 'out_for_delivery', 'delivered', 'returned_to_sender', 'cancelled', 'failed'))
      or (old.status = 'in_transit' and new.status in ('out_for_delivery', 'delivered', 'returned_to_sender', 'failed'))
      or (old.status = 'out_for_delivery' and new.status in ('delivered', 'in_transit', 'returned_to_sender', 'failed'))
      or (old.status = 'returned_to_sender' and new.status in ('in_transit'))
    ) then
      raise exception 'illegal shipment transition: % -> %', old.status, new.status
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists shipments_status_guard on public.shipments;
create trigger shipments_status_guard
  before update on public.shipments
  for each row execute function public.guard_shipment_status();

-- ============================================================
-- 2. shipment_items
-- ============================================================
create table if not exists public.shipment_items (
  shipment_id uuid not null references public.shipments (id) on delete cascade,
  order_item_id uuid not null references public.order_items (id) on delete cascade,
  primary key (shipment_id, order_item_id)
);

create index if not exists shipment_items_order_item_idx
  on public.shipment_items (order_item_id);

-- One LIVE shipment per item per direction. A cancelled/failed label may be
-- replaced; two simultaneously live labels for the same parcel is how an
-- item gets shipped twice or double-charged.
create or replace function public.guard_shipment_item_unique_live()
returns trigger
language plpgsql
as $$
declare
  v_direction text;
begin
  select s.direction into v_direction from public.shipments s where s.id = new.shipment_id;

  if exists (
    select 1
      from public.shipment_items si
      join public.shipments s on s.id = si.shipment_id
     where si.order_item_id = new.order_item_id
       and si.shipment_id <> new.shipment_id
       and s.direction = v_direction
       and s.status not in ('cancelled', 'failed')
  ) then
    raise exception 'order item already has a live % shipment', v_direction
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists shipment_items_unique_live on public.shipment_items;
create trigger shipment_items_unique_live
  before insert on public.shipment_items
  for each row execute function public.guard_shipment_item_unique_live();

-- ============================================================
-- 3. shipment_events
-- ============================================================
create table if not exists public.shipment_events (
  id uuid primary key default gen_random_uuid(),
  shipment_id uuid not null references public.shipments (id) on delete cascade,
  provider_event_ref text,
  status text not null,
  description text,
  occurred_at timestamptz not null,
  city text,
  state text,
  country text,
  created_at timestamptz not null default now()
);

create index if not exists shipment_events_shipment_idx
  on public.shipment_events (shipment_id, occurred_at);

-- Duplicate webhook deliveries insert the same provider event ref — the
-- unique index makes the second insert a conflict the worker swallows.
create unique index if not exists shipment_events_dedupe_key
  on public.shipment_events (shipment_id, provider_event_ref)
  where provider_event_ref is not null;

-- ============================================================
-- 4. seller_adjustments
-- ============================================================
create table if not exists public.seller_adjustments (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid references public.profiles (id) on delete set null,
  order_id uuid references public.orders (id) on delete set null,
  shipment_id uuid references public.shipments (id) on delete set null,
  return_id uuid,
  kind text not null,
  -- Signed. Negative = deducted from the seller's payout (a label DRVN
  -- bought on their behalf); positive = credited back (void/refund).
  amount_cents int not null,
  currency text not null default 'USD',
  external_reference text,
  description text,
  created_at timestamptz not null default now(),
  voided_at timestamptz
);

alter table public.seller_adjustments drop constraint if exists seller_adjustments_kind_check;
alter table public.seller_adjustments add constraint seller_adjustments_kind_check
  check (kind in ('outbound_label', 'return_label', 'label_refund', 'insurance'));

alter table public.seller_adjustments drop constraint if exists seller_adjustments_sign_check;
alter table public.seller_adjustments add constraint seller_adjustments_sign_check
  check (
    (kind in ('outbound_label', 'return_label', 'insurance') and amount_cents <= 0)
    or (kind = 'label_refund' and amount_cents >= 0)
  );

create index if not exists seller_adjustments_seller_idx
  on public.seller_adjustments (seller_id, created_at);
create index if not exists seller_adjustments_order_idx
  on public.seller_adjustments (order_id);

-- Idempotency: one adjustment per (kind, external ref). A retried label
-- purchase carries the same provider shipment ref and lands on this index.
create unique index if not exists seller_adjustments_external_key
  on public.seller_adjustments (kind, external_reference)
  where external_reference is not null;

-- Ledger rows are append-only; the only legal update is stamping voided_at.
create or replace function public.guard_seller_adjustment_immutable()
returns trigger
language plpgsql
as $$
begin
  if new.id is distinct from old.id
     or new.seller_id is distinct from old.seller_id
     or new.order_id is distinct from old.order_id
     or new.shipment_id is distinct from old.shipment_id
     or new.return_id is distinct from old.return_id
     or new.kind is distinct from old.kind
     or new.amount_cents is distinct from old.amount_cents
     or new.currency is distinct from old.currency
     or new.external_reference is distinct from old.external_reference
     or new.created_at is distinct from old.created_at
     or (old.voided_at is not null and new.voided_at is distinct from old.voided_at)
  then
    raise exception 'seller_adjustments rows are append-only (void via voided_at once, reverse via label_refund)'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists seller_adjustments_immutable on public.seller_adjustments;
create trigger seller_adjustments_immutable
  before update on public.seller_adjustments
  for each row execute function public.guard_seller_adjustment_immutable();

-- ============================================================
-- 5. RLS
-- ============================================================
alter table public.shipments enable row level security;
revoke all on public.shipments from anon, authenticated;
-- Column grant excludes label_reference + provider internals: progress is
-- shared, the printable label and provider identifiers are not. The seller
-- gets the label through a server action.
grant select (
  id, order_id, direction, return_id, fulfillment_type, carrier, service,
  status, tracking_code, quoted_cents, purchased_cents, insured_value_cents,
  signature_required, shipped_at, delivered_at, created_at, updated_at
) on public.shipments to authenticated;

drop policy if exists "participants read shipments" on public.shipments;
create policy "participants read shipments" on public.shipments for select
  using (exists (
    select 1 from public.orders o
    where o.id = order_id and (auth.uid() in (o.buyer_id, o.seller_id) or public.is_admin())
  ));

alter table public.shipment_items enable row level security;
revoke all on public.shipment_items from anon, authenticated;
grant select on public.shipment_items to authenticated;

drop policy if exists "participants read shipment items" on public.shipment_items;
create policy "participants read shipment items" on public.shipment_items for select
  using (exists (
    select 1
      from public.shipments s
      join public.orders o on o.id = s.order_id
     where s.id = shipment_id and (auth.uid() in (o.buyer_id, o.seller_id) or public.is_admin())
  ));

alter table public.shipment_events enable row level security;
revoke all on public.shipment_events from anon, authenticated;
grant select on public.shipment_events to authenticated;

drop policy if exists "participants read shipment events" on public.shipment_events;
create policy "participants read shipment events" on public.shipment_events for select
  using (exists (
    select 1
      from public.shipments s
      join public.orders o on o.id = s.order_id
     where s.id = shipment_id and (auth.uid() in (o.buyer_id, o.seller_id) or public.is_admin())
  ));

alter table public.seller_adjustments enable row level security;
revoke all on public.seller_adjustments from anon, authenticated;
grant select on public.seller_adjustments to authenticated;

drop policy if exists "seller reads own adjustments" on public.seller_adjustments;
create policy "seller reads own adjustments" on public.seller_adjustments for select
  using (seller_id = auth.uid() or public.is_admin());

-- ============================================================
-- Self-checks
-- ============================================================
do $$
begin
  if to_regclass('public.shipments') is null
     or to_regclass('public.shipment_items') is null
     or to_regclass('public.shipment_events') is null
     or to_regclass('public.seller_adjustments') is null then
    raise exception '0052: table missing';
  end if;

  if not exists (
    select 1 from pg_trigger
    where tgname = 'shipments_status_guard' and tgrelid = 'public.shipments'::regclass
  ) then
    raise exception '0052: shipment status guard missing';
  end if;

  if not exists (
    select 1 from pg_trigger
    where tgname = 'shipment_items_unique_live'
      and tgrelid = 'public.shipment_items'::regclass
  ) then
    raise exception '0052: live-shipment uniqueness guard missing';
  end if;

  if not exists (
    select 1 from pg_trigger
    where tgname = 'seller_adjustments_immutable'
      and tgrelid = 'public.seller_adjustments'::regclass
  ) then
    raise exception '0052: adjustment immutability guard missing';
  end if;

  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public' and indexname = 'seller_adjustments_external_key'
  ) then
    raise exception '0052: adjustment idempotency index missing';
  end if;

  -- The label column must NOT be in the client grant.
  if exists (
    select 1 from information_schema.column_privileges
    where table_schema = 'public' and table_name = 'shipments'
      and column_name = 'label_reference'
      and grantee = 'authenticated' and privilege_type = 'SELECT'
  ) then
    raise exception '0052: label_reference is client-readable — it must not be';
  end if;

  raise notice 'PASS: 0052 self-checks';
end $$;

commit;
