-- 0055 — Return / RMA domain (brief §22-§31).
--
-- Returns are a separate, item-aware domain: goods moving back is not an
-- order status (orders keeps its small enum) and not money moving back (the
-- 0026 refund engine keeps that). A return AUTHORIZES an eventual refund;
-- refund_operations executes it.
--
--   returns       — one RMA: type (protection claim vs shop policy),
--                   responsibility, lifecycle, deadlines FROZEN ON THE ROW
--                   (changing the policy constants later must not change
--                   in-flight returns), agreed refund entitlement, label
--                   deduction, and the refund operation it produced.
--   return_items  — which purchased units are coming back, with per-item
--                   inspection outcome. Modelled item-aware even though most
--                   P2P returns are quantity 1 (§22).
--
-- Lifecycle (guarded by trigger; mirrored in src/lib/domain/states.ts):
--   requested → approved → awaiting_shipment → in_transit → delivered
--             → received → completed
--   exception/terminal: rejected, expired, cancelled, escalated
--   (delivered → escalated is the §29 inspection-dispute path; escalation
--   routes into the existing ops-case system, never a new admin queue.)
--
-- Timers (§27), stored on the row: ship_by = approval + 7 days (buyer must
-- ship or the return expires); seller_respond_by = return delivery + 48h
-- (seller confirms received or reports a problem, else the agreed refund
-- proceeds automatically). §28: an ACTIVE return pauses the original
-- dispute's day-10 auto-refund — the app worker treats the RMA as the
-- governing clock (tested in dispute-sla tests).
--
-- One live RMA per purchased unit: a guard trigger refuses a second
-- return_items row for an order item whose earlier RMA is still active.
--
-- Reads: order participants + admins. Writes: service-role actions/workers.
--
-- Idempotent. Safe to re-run.

begin;

-- ============================================================
-- 1. returns
-- ============================================================
create table if not exists public.returns (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  requested_by uuid references public.profiles (id) on delete set null,
  return_type text not null,
  reason text,
  responsibility text not null,
  status text not null default 'requested',
  requested_at timestamptz not null default now(),
  approved_at timestamptz,
  ship_by timestamptz,
  shipped_at timestamptz,
  delivered_at timestamptz,
  seller_respond_by timestamptz,
  received_at timestamptz,
  completed_at timestamptz,
  -- Entitlement agreed at approval (§31): item price + applicable shipping
  -- share, before any label deduction. Frozen — never recomputed later.
  refund_amount_cents int,
  -- Deducted from the refund when the buyer owes return postage on a
  -- DRVN-generated label (§26).
  label_deduction_cents int not null default 0,
  refund_operation_id uuid references public.refund_operations (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.returns drop constraint if exists returns_type_check;
alter table public.returns add constraint returns_type_check
  check (return_type in ('protection', 'shop_policy'));

alter table public.returns drop constraint if exists returns_responsibility_check;
alter table public.returns add constraint returns_responsibility_check
  check (responsibility in ('buyer', 'seller'));

alter table public.returns drop constraint if exists returns_status_check;
alter table public.returns add constraint returns_status_check
  check (status in (
    'requested', 'approved', 'awaiting_shipment', 'in_transit', 'delivered',
    'received', 'completed', 'rejected', 'expired', 'cancelled', 'escalated'
  ));

alter table public.returns drop constraint if exists returns_money_check;
alter table public.returns add constraint returns_money_check
  check (
    (refund_amount_cents is null or refund_amount_cents >= 0)
    and label_deduction_cents >= 0
  );

create index if not exists returns_order_idx on public.returns (order_id);
create index if not exists returns_active_timers_idx
  on public.returns (status, ship_by, seller_respond_by)
  where status in ('approved', 'awaiting_shipment', 'delivered');

drop trigger if exists returns_touch_updated_at on public.returns;
create trigger returns_touch_updated_at
  before update on public.returns
  for each row execute function public.touch_updated_at();

create or replace function public.guard_return_status()
returns trigger
language plpgsql
as $$
begin
  if new.status is distinct from old.status then
    if not (
      (old.status = 'requested' and new.status in ('approved', 'rejected', 'cancelled', 'escalated'))
      or (old.status = 'approved' and new.status in ('awaiting_shipment', 'expired', 'cancelled', 'escalated'))
      or (old.status = 'awaiting_shipment' and new.status in ('in_transit', 'expired', 'cancelled', 'escalated'))
      or (old.status = 'in_transit' and new.status in ('delivered', 'escalated'))
      or (old.status = 'delivered' and new.status in ('received', 'escalated'))
      or (old.status = 'received' and new.status in ('completed', 'escalated'))
      or (old.status = 'escalated' and new.status in ('received', 'completed', 'rejected', 'cancelled'))
    ) then
      raise exception 'illegal return transition: % -> %', old.status, new.status
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists returns_status_guard on public.returns;
create trigger returns_status_guard
  before update on public.returns
  for each row execute function public.guard_return_status();

-- ============================================================
-- 2. return_items
-- ============================================================
create table if not exists public.return_items (
  return_id uuid not null references public.returns (id) on delete cascade,
  order_item_id uuid not null references public.order_items (id) on delete cascade,
  quantity int not null default 1 check (quantity > 0),
  reason text,
  inspection_status text not null default 'pending',
  inspection_note text,
  primary key (return_id, order_item_id)
);

alter table public.return_items drop constraint if exists return_items_inspection_check;
alter table public.return_items add constraint return_items_inspection_check
  check (inspection_status in ('pending', 'ok', 'mismatch'));

create index if not exists return_items_order_item_idx
  on public.return_items (order_item_id);

-- One live RMA per purchased unit (§22): a second active claim on the same
-- item is how a part gets returned twice or refunded twice.
create or replace function public.guard_return_item_unique_live()
returns trigger
language plpgsql
as $$
begin
  if exists (
    select 1
      from public.return_items ri
      join public.returns r on r.id = ri.return_id
     where ri.order_item_id = new.order_item_id
       and ri.return_id <> new.return_id
       and r.status not in ('rejected', 'expired', 'cancelled', 'completed')
  ) then
    raise exception 'order item already has an active return'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists return_items_unique_live on public.return_items;
create trigger return_items_unique_live
  before insert on public.return_items
  for each row execute function public.guard_return_item_unique_live();

-- ============================================================
-- 3. shipments.return_id gets its FK (0052 left it dangling on purpose)
-- ============================================================
alter table public.shipments drop constraint if exists shipments_return_id_fkey;
alter table public.shipments add constraint shipments_return_id_fkey
  foreign key (return_id) references public.returns (id) on delete set null;

-- ============================================================
-- 4. RLS
-- ============================================================
alter table public.returns enable row level security;
revoke all on public.returns from anon, authenticated;
grant select on public.returns to authenticated;

drop policy if exists "participants read returns" on public.returns;
create policy "participants read returns" on public.returns for select
  using (exists (
    select 1 from public.orders o
    where o.id = order_id and (auth.uid() in (o.buyer_id, o.seller_id) or public.is_admin())
  ));

alter table public.return_items enable row level security;
revoke all on public.return_items from anon, authenticated;
grant select on public.return_items to authenticated;

drop policy if exists "participants read return items" on public.return_items;
create policy "participants read return items" on public.return_items for select
  using (exists (
    select 1
      from public.returns r
      join public.orders o on o.id = r.order_id
     where r.id = return_id and (auth.uid() in (o.buyer_id, o.seller_id) or public.is_admin())
  ));

-- ============================================================
-- Self-checks
-- ============================================================
do $$
begin
  if to_regclass('public.returns') is null or to_regclass('public.return_items') is null then
    raise exception '0055: table missing';
  end if;

  if not exists (
    select 1 from pg_trigger
    where tgname = 'returns_status_guard' and tgrelid = 'public.returns'::regclass
  ) then
    raise exception '0055: return status guard missing';
  end if;

  if not exists (
    select 1 from pg_trigger
    where tgname = 'return_items_unique_live'
      and tgrelid = 'public.return_items'::regclass
  ) then
    raise exception '0055: live-return uniqueness guard missing';
  end if;

  if not exists (
    select 1 from information_schema.table_constraints
    where table_schema = 'public' and table_name = 'shipments'
      and constraint_name = 'shipments_return_id_fkey'
  ) then
    raise exception '0055: shipments.return_id FK missing';
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'returns'
      and policyname = 'participants read returns'
  ) then
    raise exception '0055: returns read policy missing';
  end if;

  raise notice 'PASS: 0055 self-checks';
end $$;

commit;
