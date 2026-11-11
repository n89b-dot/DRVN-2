-- 20261107210100 — settlement correctness and reconciliation (OS-W20).
--
-- Production-readiness review, 3 Nov 2026: N114, N8, N115.
--
-- 1. Fair payout admission (N114). claim_transfer_intents took the oldest
--    updated rows first and admitted every 'blocked_unpayable' row on every
--    pass, so sellers who couldn't be paid held places in each batch while
--    ready payouts waited behind them. A blocked row is now admitted only
--    when it can move: the seller has a Stripe account and payouts are
--    enabled, or a provider call may already have happened (that row must
--    reconcile, never be abandoned). Its reconciliation time is honoured as
--    for any other row (a payout Stripe refused for a restricted account
--    waits a day: transfer-worker.ts). Work is served longest-due first, so
--    no state can starve another. Readiness (mark_due_transfer_intents) and
--    so the date a payout becomes due are untouched, as are the attempt
--    budget, the chargeback rule (20261107130000) and the lease.
-- 2. Operator retry for an exhausted payout (N8). A payout that spent its
--    eight attempts sits 'failed' with a transfer_unresolved case and no way
--    back but SQL. admin_retry_transfer_intent puts it back in the queue
--    (attempts 0, no backoff) and nothing else: its frozen request and its
--    provider-call flag stay, so the worker looks Stripe up before it sends
--    anything, with the same idempotency key, and admission, readiness, the
--    chargeback freeze and dispatch still decide whether it can go. Called by
--    the console's audited action (lib/admin/actions.ts) on the service role.
--    The recovery case stays open for the operator to close.
-- 3. Daily ledger reconciliation (N115). A read-only job compares Stripe's
--    payments, refunds and transfers with the ledger
--    (lib/payments/ledger-reconciliation.ts). It corrects nothing: each
--    discrepancy becomes a payment_recoveries case of the new kind
--    'ledger_discrepancy', and corrections stay the console's explicit,
--    audited commands. ledger_reconciliation_runs records each run's window
--    and counts, so the next run starts where the last complete one ended.
--    Scheduled as drvn-ledger-reconciliation (daily, 05:50 UTC) through
--    invoke_remediation_worker('ledger-reconciliation'), and listed in the
--    job inventory (latest 20261107200300) with its worker family.
--
-- Money rules unchanged: who is paid, when, refunds, holds and fees are as
-- before. Idempotent.

begin;

-- ---------------------------------------------------------------------------
-- 1. Admission. Latest: 20261107130000_chargeback_freezes_payout.sql.
--    Changed: 'blocked_unpayable' is its own branch, admitted only when
--    actionable; the order is longest-due first. Everything else as before.
-- ---------------------------------------------------------------------------

create or replace function public.claim_transfer_intents(
  p_worker        text,
  p_batch         int default 20,
  p_lease_seconds int default 300,
  p_max_attempts  int default 8
) returns setof public.transfer_intents
language sql
security definer
set search_path = public, pg_temp
as $$
  with candidates as (
    select ti.order_id, ti.status = 'processing' as was_processing
    from public.transfer_intents ti
    where (
        ti.status in ('ready', 'failed')
        and ti.attempts < p_max_attempts
        and (ti.next_attempt_at is null or ti.next_attempt_at <= now())
        and (
          ti.provider_call_may_have_occurred
          or not private.order_has_unresolved_chargeback(ti.order_id)
        )
      )
      -- 20261107210100 (N114): a seller-side wait takes a place in the batch
      -- only when it can move.
      or (
        ti.status = 'blocked_unpayable'
        and ti.attempts < p_max_attempts
        and (ti.next_attempt_at is null or ti.next_attempt_at <= now())
        and (
          ti.provider_call_may_have_occurred
          or (
            not private.order_has_unresolved_chargeback(ti.order_id)
            and exists (
              select 1 from public.profiles p
              where p.id = ti.seller_id
                and p.stripe_account_id is not null
                and p.payouts_enabled
            )
          )
        )
      )
      or (
        ti.status = 'holding'
        and ti.provider_call_may_have_occurred
        and ti.next_attempt_at is not null
        and ti.next_attempt_at <= now()
        and ti.attempts < p_max_attempts
      )
      or (
        ti.status = 'processing'
        and (ti.lease_expires_at is null or ti.lease_expires_at < now())
      )
    -- 20261107210100 (N114): longest-due first — the lapsed lease, the
    -- reconciliation or retry time, or when the payout became payable.
    order by
      case
        when ti.status = 'processing' then coalesce(ti.lease_expires_at, ti.updated_at)
        -- greatest() skips nulls: the later of the two times that are set.
        else coalesce(greatest(ti.available_at, ti.next_attempt_at), ti.created_at)
      end,
      ti.order_id
    limit greatest(p_batch, 1)
    for update of ti skip locked
  )
  update public.transfer_intents ti
  set status = 'processing',
      locked_at = now(),
      locked_by = p_worker,
      lease_expires_at = now() + make_interval(secs => greatest(p_lease_seconds, 30)),
      last_attempt_at = now(),
      provider_call_may_have_occurred =
        ti.provider_call_may_have_occurred or c.was_processing,
      updated_at = now()
  from candidates c
  where ti.order_id = c.order_id
  returning ti.*;
$$;
revoke all on function public.claim_transfer_intents(text, int, int, int) from public, anon, authenticated;
grant execute on function public.claim_transfer_intents(text, int, int, int) to service_role;

-- ---------------------------------------------------------------------------
-- 2. Operator retry of an exhausted payout (new)
-- ---------------------------------------------------------------------------

create or replace function public.admin_retry_transfer_intent(p_order uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_intent public.transfer_intents;
begin
  if p_order is null then
    raise exception 'A payout is required' using errcode = '22023';
  end if;
  -- Parent lock first, as refund settlement, completion and recovery take it.
  perform 1 from public.orders where id = p_order for key share;
  select * into v_intent from public.transfer_intents where order_id = p_order for update;
  if not found then
    raise exception 'That payout no longer exists' using errcode = 'P0002';
  end if;
  if v_intent.status in ('transferred', 'cancelled') then
    raise exception 'This payout is already %', v_intent.status using errcode = '22023';
  end if;
  if v_intent.status = 'processing' then
    raise exception 'A worker holds this payout right now; try again in a few minutes' using errcode = '55P03';
  end if;
  -- Only a payout the worker gave up on. Anything else is still the
  -- worker's (it retries on its own) or waits on the seller or readiness.
  if v_intent.status <> 'failed' or v_intent.attempts < 8 then
    raise exception 'This payout is still being retried automatically' using errcode = '22023';
  end if;

  update public.transfer_intents
     set attempts = 0,
         next_attempt_at = null,
         last_error = 'Queued again by an operator',
         locked_at = null,
         locked_by = null,
         lease_expires_at = null,
         updated_at = now()
   where order_id = p_order;

  return jsonb_build_object(
    'order_id', p_order,
    'status', 'failed',
    'previous_attempts', v_intent.attempts,
    'provider_call_may_have_occurred', v_intent.provider_call_may_have_occurred
  );
end;
$$;
revoke all on function public.admin_retry_transfer_intent(uuid) from public, anon, authenticated;
grant execute on function public.admin_retry_transfer_intent(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 3. Ledger reconciliation
-- ---------------------------------------------------------------------------

-- Latest: 20260905174828_refund_lifecycle_durability.sql. Added: ledger_discrepancy.
alter table public.payment_recoveries drop constraint if exists payment_recoveries_kind_check;
alter table public.payment_recoveries add constraint payment_recoveries_kind_check check (kind in (
  'reversal_failed', 'refund_failed', 'partial_refund_unattributed',
  'transfer_after_refund', 'negative_balance', 'capture_unresolved',
  'transfer_unresolved', 'refund_lifecycle_unresolved', 'refund_late_failure',
  'ledger_discrepancy'
));

create table if not exists public.ledger_reconciliation_runs (
  id uuid primary key default gen_random_uuid(),
  window_start timestamptz not null,
  window_end timestamptz not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running'
    check (status in ('running', 'complete', 'incomplete', 'failed')),
  checked jsonb not null default '{}'::jsonb,
  discrepancies integer not null default 0 check (discrepancies >= 0),
  detail text,
  check (window_end > window_start)
);
create index if not exists ledger_reconciliation_runs_complete_idx
  on public.ledger_reconciliation_runs (window_end desc) where status = 'complete';
alter table public.ledger_reconciliation_runs enable row level security;
revoke all on public.ledger_reconciliation_runs from public, anon, authenticated;
grant select, insert, update on public.ledger_reconciliation_runs to service_role;

-- Latest: 20261107200300_saved_search_email_digests.sql. Added: ledger-reconciliation.
create or replace function public.invoke_remediation_worker(p_family text) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare base text; secret text;
begin
 if p_family not in ('search','account-deletions','media-gc','saved-searches','listing-imports','agent','saved-search-digests','ledger-reconciliation') then raise exception 'Unknown worker family'; end if;
 select value into base from public.job_config where key='transfer_worker_url';
 select value into secret from public.job_config where key='transfer_worker_secret';
 if base is null or secret is null then return; end if;
 if base !~ '/api/jobs/transfers$' then raise exception 'Invalid transfer worker URL'; end if;
 perform net.http_post(url:=regexp_replace(base,'/transfers$','/'||p_family),headers:=jsonb_build_object('Authorization','Bearer '||secret,'Content-Type','application/json'),body:='{}'::jsonb,timeout_milliseconds:=60000);
end $$;
revoke all on function public.invoke_remediation_worker(text) from public,anon,authenticated;
grant execute on function public.invoke_remediation_worker(text) to service_role;

-- Latest: 20261107200300_saved_search_email_digests.sql. Added: drvn-ledger-reconciliation.
create or replace function private.scheduled_job_inventory()
returns table(job text, schedule text, command text, families text[], budget interval)
language sql
immutable
set search_path = public, pg_temp
as $$
  values
    ('drvn-agent-worker', '*/5 * * * *', 'select public.invoke_remediation_worker(''agent'');', array['agent'], interval '30 minutes'),
    ('drvn-cron-history-prune', '27 4 * * *', 'select private.prune_cron_history();', array[]::text[], interval '26 hours'),
    ('drvn-deletion-worker', '*/5 * * * *', 'select public.invoke_remediation_worker(''account-deletions'');', array['deletions'], interval '30 minutes'),
    ('drvn-delivery-auto-confirm', '23 * * * *', 'select public.auto_confirm_untracked_deliveries();', array['deliveryAutoConfirm'], interval '3 hours'),
    ('drvn-dispute-sla', '5 8 * * *', 'select public.escalate_stale_disputes();', array[]::text[], interval '26 hours'),
    ('drvn-explore-builders', '*/10 * * * *', 'select public.refresh_explore_builders();', array[]::text[], interval '30 minutes'),
    ('drvn-explore-trending', '*/2 * * * *', 'select public.refresh_explore_trending();', array[]::text[], interval '30 minutes'),
    ('drvn-grow-products', '17 * * * *', 'select public.grow_products()', array[]::text[], interval '3 hours'),
    ('drvn-grow-products-full', '47 4 * * *', 'select public.grow_products(true)', array[]::text[], interval '26 hours'),
    ('drvn-ledger-reconciliation', '50 5 * * *', 'select public.invoke_remediation_worker(''ledger-reconciliation'');', array['ledgerReconciliation'], interval '26 hours'),
    ('drvn-listing-edit-sweep', '45 3 * * *', 'select public.prune_listing_edit_requests();', array[]::text[], interval '26 hours'),
    ('drvn-listing-import-sweep', '37 3 * * *', 'select public.invoke_remediation_worker(''listing-imports'');', array['listingImports'], interval '26 hours'),
    ('drvn-marketplace-counts', '30 seconds', 'select public.refresh_marketplace_facet_counts();', array[]::text[], interval '10 minutes'),
    ('drvn-media-gc', '17 3 * * *', 'select public.invoke_remediation_worker(''media-gc'');', array['media'], interval '26 hours'),
    ('drvn-prune-rate-limits', '15 3 * * *', 'select public.prune_rate_limits();', array[]::text[], interval '26 hours'),
    ('drvn-release-reservations', '*/5 * * * *', 'select public.release_expired_reservations();', array[]::text[], interval '30 minutes'),
    ('drvn-saved-search-digests', '41 * * * *', 'select public.invoke_remediation_worker(''saved-search-digests'');', array['savedSearchDigests'], interval '3 hours'),
    ('drvn-saved-search-worker', '*/30 * * * *', 'select public.invoke_remediation_worker(''saved-searches'');', array['savedSearches'], interval '90 minutes'),
    ('drvn-search-words', '23 * * * *', 'select public.refresh_search_words();', array[]::text[], interval '3 hours'),
    ('drvn-search-worker', '*/2 * * * *', 'select public.invoke_remediation_worker(''search'');', array['search'], interval '30 minutes'),
    ('drvn-transfer-worker', '*/10 * * * *', 'select public.mark_due_transfer_intents(); select public.invoke_transfer_worker();',
      array['expiries','captures','transfers','transferReconciliation','refunds','labelVoids','returns','disputes','alerts','receipts','analytics'],
      interval '30 minutes')
$$;
revoke all on function private.scheduled_job_inventory() from public, anon, authenticated;

do $$
declare
  j record;
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    for j in select jobid from cron.job where jobname = 'drvn-ledger-reconciliation' loop
      perform cron.unschedule(j.jobid);
    end loop;
    perform cron.schedule('drvn-ledger-reconciliation', '50 5 * * *', $job$select public.invoke_remediation_worker('ledger-reconciliation');$job$);
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Self-check
-- ---------------------------------------------------------------------------
do $$
declare
  missing text;
begin
  if has_function_privilege('authenticated', 'public.admin_retry_transfer_intent(uuid)', 'execute')
     or has_function_privilege('anon', 'public.admin_retry_transfer_intent(uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.claim_transfer_intents(text,int,int,int)', 'execute') then
    raise exception 'SELF-CHECK FAILED: a payout function is client-callable';
  end if;
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    select string_agg(i.job, ', ') into missing from private.scheduled_job_inventory() i
    where not exists (select 1 from cron.job j where j.jobname = i.job and j.schedule = i.schedule
                        and private.normalized_sql(j.command) = private.normalized_sql(i.command));
    if missing is not null then raise exception 'SELF-CHECK FAILED: inventory jobs not scheduled as listed: %', missing; end if;
    select string_agg(j.jobname, ', ') into missing from cron.job j
    where j.jobname like 'drvn-%' and not exists (select 1 from private.scheduled_job_inventory() i where i.job = j.jobname);
    if missing is not null then raise exception 'SELF-CHECK FAILED: scheduled jobs missing from the inventory: %', missing; end if;
  end if;
  if not exists (select 1 from jsonb_array_elements(public.worker_health_snapshot()->'families') f
                 where f->>'family' = 'ledgerReconciliation') then
    raise exception 'SELF-CHECK FAILED: the ledger reconciliation family is not in worker health';
  end if;
end $$;

notify pgrst, 'reload schema';
commit;
