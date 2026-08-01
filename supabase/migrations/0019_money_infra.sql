-- ============================================================================
-- 0019 — Money infrastructure: webhook dedup, transfer intents, recovery queue
--
-- APPLIED to the live database on 1 Aug 2026 (direct connection), twice —
-- idempotency confirmed; self-checks pass.
--
-- Rev E items 1, 4, 5 and 6 all need somewhere to stand:
--
--   * webhook_events — Stripe event.id dedup. Replay safety currently rests
--     entirely on downstream guards; this makes "seen it" a first-class fact.
--   * transfer_intents — a transfer is RECORDED before Stripe is called, so a
--     webhook redelivery after the 24h Stripe idempotency window cannot pay a
--     seller twice, and a seller who sold before completing onboarding shows
--     up as a blocked intent (the stuck-funds queue) instead of an error log.
--     `available_at` models the delivery + clearing hold that replaces
--     transfer-on-payment (Rev E item 2).
--   * payment_recoveries — money that needs a human: a refund whose transfer
--     reversal failed (negative-balance recovery), a partial refund that
--     could not be attributed, and the like. The admin console's payments-ops
--     queue reads this; nothing here is ever just a log line.
--   * orders.refunded_cents / platform_fee_refunded_cents / refunded_at —
--     refunds recorded as explicit adjustments rather than by mutating the
--     frozen checkout figures, so historical amounts survive and every
--     derived figure (ledger, fee reporting) can subtract what went back.
--
-- All three tables are service-role-written; admins read them through RLS
-- (is_admin(), 0018). No client role can write any of this.
--
-- Idempotent: safe to re-run.
-- ============================================================================

begin;

-- ============================================================
-- 1. webhook_events — processed-event dedup
-- ============================================================
create table if not exists public.webhook_events (
  id           text primary key,          -- Stripe event id (evt_…)
  type         text not null,
  received_at  timestamptz not null default now(),
  processed_at timestamptz
);

alter table public.webhook_events enable row level security;

drop policy if exists "admins read webhook events" on public.webhook_events;
create policy "admins read webhook events" on public.webhook_events for select
  using (public.is_admin());

revoke all on public.webhook_events from anon, authenticated;
grant select on public.webhook_events to authenticated;

-- ============================================================
-- 2. transfer_intents — persisted before Stripe is called
-- ============================================================
create table if not exists public.transfer_intents (
  order_id           uuid primary key references public.orders (id) on delete cascade,
  seller_id          uuid references public.profiles (id) on delete set null,
  amount_cents       int not null check (amount_cents > 0),
  currency           text not null,
  status             text not null default 'holding' check (status in (
                       'holding',            -- inside the delivery + clearing window
                       'ready',              -- window passed, queued for the scheduler
                       'processing',         -- claimed by a run; crash-safe re-entry point
                       'transferred',        -- Stripe transfer confirmed and recorded
                       'blocked_unpayable',  -- seller has no payable account (stuck funds)
                       'failed',             -- Stripe refused; needs attention
                       'cancelled'           -- order refunded/cancelled before transfer
                     )),
  available_at       timestamptz,           -- delivery + clearing hold; null until delivered
  transfer_reference text,
  attempts           int not null default 0,
  last_error         text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists transfer_intents_due_idx
  on public.transfer_intents (available_at)
  where status in ('holding', 'ready', 'blocked_unpayable');
create index if not exists transfer_intents_status_idx
  on public.transfer_intents (status);

alter table public.transfer_intents enable row level security;

drop policy if exists "admins read transfer intents" on public.transfer_intents;
create policy "admins read transfer intents" on public.transfer_intents for select
  using (public.is_admin());

revoke all on public.transfer_intents from anon, authenticated;
grant select on public.transfer_intents to authenticated;

-- ============================================================
-- 3. payment_recoveries — money that needs a human
-- ============================================================
create table if not exists public.payment_recoveries (
  id              uuid primary key default gen_random_uuid(),
  order_id        uuid references public.orders (id) on delete set null,
  kind            text not null check (kind in (
                    'reversal_failed',              -- refund went out, reclaim from seller failed
                    'refund_failed',                -- Stripe refused the refund itself
                    'partial_refund_unattributed',  -- dashboard partial refund matching no single order
                    'transfer_after_refund',        -- transfer landed on an already-refunded order
                    'negative_balance'              -- seller owes the platform
                  )),
  amount_cents    int,
  detail          text,
  status          text not null default 'open' check (status in ('open', 'recovered', 'written_off')),
  created_at      timestamptz not null default now(),
  resolved_by     uuid references public.profiles (id) on delete set null,
  resolved_at     timestamptz,
  resolution_note text
);

create index if not exists payment_recoveries_open_idx
  on public.payment_recoveries (created_at) where status = 'open';

alter table public.payment_recoveries enable row level security;

drop policy if exists "admins read payment recoveries" on public.payment_recoveries;
create policy "admins read payment recoveries" on public.payment_recoveries for select
  using (public.is_admin());

revoke all on public.payment_recoveries from anon, authenticated;
grant select on public.payment_recoveries to authenticated;

-- ============================================================
-- 4. orders — refund adjustments as explicit columns
-- ============================================================
alter table public.orders
  add column if not exists refunded_cents              int not null default 0,
  add column if not exists platform_fee_refunded_cents int not null default 0,
  add column if not exists refunded_at                 timestamptz;

alter table public.orders
  drop constraint if exists orders_refunded_cents_check;
alter table public.orders
  add constraint orders_refunded_cents_check check (
    refunded_cents >= 0 and refunded_cents <= total_cents
    and platform_fee_refunded_cents >= 0
    and platform_fee_refunded_cents <= platform_fee_cents
  );

-- ============================================================
-- 5. Self-checks
-- ============================================================
do $$
begin
  if exists (
    select 1 from information_schema.role_table_grants
    where table_schema = 'public'
      and table_name in ('webhook_events', 'transfer_intents', 'payment_recoveries')
      and grantee in ('anon', 'authenticated')
      and privilege_type <> 'SELECT'
  ) then
    raise exception 'SELF-CHECK FAILED: money tables writable by client roles';
  end if;
  raise notice 'PASS: 0019 self-checks';
end $$;

commit;
