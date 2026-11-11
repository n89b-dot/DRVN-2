-- ============================================================================
-- 0020 — Transfer scheduling: money moves on delivery + hold, not on payment
--
-- Rev E critical #2. Transfers fired inside payment_intent.succeeded — before
-- anything shipped — while the ledger advertised a seven-day clearing window
-- that was unreachable for real orders. Now:
--
--   payment succeeds  → a transfer_intents row is created (status 'holding')
--   buyer confirms    → available_at = delivered_at + 7 days (the window the
--   delivery            ledger already displays, src/lib/payments/ledger.ts)
--   window passes     → pg_cron marks the intent 'ready' (pure SQL, below) —
--                       only while the order is in a deliverable end state,
--                       so a dispute freezes the money by construction
--   worker runs       → the app claims 'ready' intents and calls Stripe
--                       (src/lib/payments/transfer-worker.ts), recording the
--                       transfer on the intent and the order
--
-- The worker is reached two ways: pg_cron → pg_net HTTP POST to
-- /api/jobs/transfers (configured in job_config below — set it when the app
-- has a deployed URL; the job silently skips while unconfigured, e.g. in dev
-- where the DB is cloud-side and the app is localhost), and a manual "Run
-- transfer worker" action in the admin console's Payments surface, which is
-- also the dev path and the human retry for stuck funds.
--
-- Also backfills intents for already-paid orders that never transferred —
-- the existing stuck funds (sellers who sold before finishing onboarding).
--
-- Idempotent: safe to re-run.
-- ============================================================================

begin;

-- ============================================================
-- 1. source_transaction — the charge a transfer draws on
-- ============================================================
-- Stamped by the webhook at intent-creation time so the worker doesn't have
-- to re-fetch the PaymentIntent. Null on backfilled rows; the worker falls
-- back to retrieving the charge from Stripe.
alter table public.transfer_intents
  add column if not exists source_transaction text;

-- ============================================================
-- 2. job_config — where the scheduler finds the worker
-- ============================================================
-- key/value, service-role only. Expected keys:
--   transfer_worker_url    e.g. https://drvn.example/api/jobs/transfers
--   transfer_worker_secret bearer token the endpoint requires (CRON_SECRET)
create table if not exists public.job_config (
  key        text primary key,
  value      text not null,
  updated_at timestamptz not null default now()
);

alter table public.job_config enable row level security;
revoke all on public.job_config from anon, authenticated;

-- ============================================================
-- 3. mark_due_transfer_intents() — the pure-SQL half
-- ============================================================
-- 'holding' → 'ready' when the clearing window has passed AND the order is in
-- a deliverable end state. Disputed/refunded/cancelled orders simply never
-- match; a dispute that later resolves back to delivered gets picked up on
-- the next run with no special casing.
create or replace function public.mark_due_transfer_intents()
returns int
language sql
security definer
set search_path = public, pg_temp
as $$
  with marked as (
    update public.transfer_intents ti
    set status = 'ready', updated_at = now()
    from public.orders o
    where ti.order_id = o.id
      and ti.status = 'holding'
      and ti.available_at is not null
      and ti.available_at <= now()
      and o.status in ('delivered', 'completed')
    returning ti.order_id
  )
  select count(*)::int from marked;
$$;

-- ============================================================
-- 4. invoke_transfer_worker() — the HTTP half (best effort)
-- ============================================================
-- Uses pg_net when installed and configured; otherwise does nothing, loudly
-- (NOTICE) rather than fatally. The admin console's manual run covers any
-- environment where this can't reach the app.
do $$
begin
  create extension if not exists pg_net;
exception when others then
  raise notice 'pg_net unavailable (%); transfer worker will run via the admin console or an external cron', sqlerrm;
end $$;

create or replace function public.invoke_transfer_worker()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_url    text;
  v_secret text;
begin
  select value into v_url from public.job_config where key = 'transfer_worker_url';
  select value into v_secret from public.job_config where key = 'transfer_worker_secret';
  if v_url is null or v_secret is null then
    return; -- unconfigured (dev): the admin console's manual run is the path
  end if;
  begin
    perform net.http_post(
      url := v_url,
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || v_secret,
        'Content-Type', 'application/json'
      ),
      body := '{}'::jsonb
    );
  exception when others then
    raise notice 'transfer worker invocation failed: %', sqlerrm;
  end;
end;
$$;

-- ============================================================
-- 5. Schedule — every 10 minutes, alongside the 0013 jobs
-- ============================================================
do $$
declare
  j record;
begin
  for j in select jobid from cron.job where jobname = 'drvn-transfer-worker'
  loop
    perform cron.unschedule(j.jobid);
  end loop;
end $$;

select cron.schedule(
  'drvn-transfer-worker',
  '*/10 * * * *',
  $job$ select public.mark_due_transfer_intents(); select public.invoke_transfer_worker(); $job$
);

-- ============================================================
-- 6. Backfill — the funds already stuck
-- ============================================================
-- Every captured, untransferred, unrefunded order gets an intent:
--   * delivered/completed → holding with available_at from delivered_at
--     (mark_due flips it to ready on the next cron run if the window passed)
--   * paid/shipped        → holding, available_at null until delivery
-- Sellers who sold before onboarding stop being an error log and start being
-- rows the console's stuck-funds queue can see.
insert into public.transfer_intents (order_id, seller_id, amount_cents, currency, status, available_at)
select
  o.id,
  o.seller_id,
  o.total_cents - o.platform_fee_cents,
  o.currency,
  'holding',
  case when o.delivered_at is not null then o.delivered_at + interval '7 days' end
from public.orders o
where o.status in ('paid', 'shipped', 'delivered', 'completed')
  and o.transfer_reference is null
  and o.refunded_cents = 0
  and o.seller_id is not null
  and o.total_cents - o.platform_fee_cents > 0
on conflict (order_id) do nothing;

-- ============================================================
-- 7. Self-checks
-- ============================================================
do $$
begin
  if not exists (select 1 from cron.job where jobname = 'drvn-transfer-worker') then
    raise exception 'SELF-CHECK FAILED: transfer worker job not scheduled';
  end if;
  if exists (
    select 1 from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'job_config'
      and grantee in ('anon', 'authenticated')
  ) then
    raise exception 'SELF-CHECK FAILED: job_config reachable by client roles';
  end if;
  raise notice 'PASS: 0020 self-checks';
end $$;

commit;
