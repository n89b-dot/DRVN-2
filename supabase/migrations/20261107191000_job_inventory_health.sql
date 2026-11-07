-- 20261107191000 — one job inventory, health judged by running, webhook retries.
--
-- Production-readiness review, 3 Nov 2026 (OS-W09): N226, N245, N391, N109,
-- and the health half of N4.
--
-- 1. private.scheduled_job_inventory() is the ONE list of what pg_cron must
--    run: every drvn-* job with its exact schedule and command, the worker
--    families it drives, and how long it may go without a success. Nineteen
--    jobs: the eighteen the migrations already schedule, and
--    drvn-cron-history-prune (below). supabase/tests/job_inventory_health_guard.sql
--    proves it matches cron.job both ways; src/lib/job-inventory.test.ts proves
--    the app's copy and the monitor's match it.
-- 2. worker_health_snapshot() judges jobs by running, not by counting rows
--    (N226): each inventory job is scheduled, active, on its schedule and
--    running its command, and its last successful run (cron.job_run_details)
--    is inside its budget. The refresh jobs, the reservation and rate-limit
--    sweeps and the dispute SLA now have freshness of their own (N245).
--    Worker families keep their worker_runs freshness, now derived from the
--    inventory so a family cannot exist without the job that drives it; the
--    lookups use the (family, started_at) index instead of scanning every run,
--    and a run orphaned before a later success no longer reads as stuck.
--    `config` reports the scheduler, pg_net, run history and the worker URL
--    and secret (as a SHA-256, compared with CRON_SECRET by the app; never
--    returned to a caller).
-- 3. False failures (N391): an undelivered payout hold (no release date), a
--    hold or ready payout frozen by an unresolved chargeback, and a seller who
--    can't be paid yet are not overdue work; blocked payouts are reported
--    with overdue = false. A terminal refused refund belongs to its recovery
--    case (which pages while open), not to the refund queue forever. Refunds
--    still pending at Stripe are their own 'awaiting_provider' row, overdue
--    only after 72 hours. A failed transfer waiting for its backoff gets the
--    normal 30-minute grace instead of paging at once.
-- 4. Chargeback recovery (N245): a provider dispute stuck in 'loss_pending'
--    after its lease expired is a queue again (dropped by 20261006100100).
-- 5. Webhook retries (N109): webhook_events records failed deliveries
--    (failed_attempts, last_failed_at, last_failure_kind, last_failure_detail)
--    through record_webhook_failure, and unprocessed events are a 'webhooks'
--    queue (EasyPost's 'easypost_webhooks'), overdue after an hour, with the
--    highest attempt count.
-- 6. drvn-cron-history-prune keeps cron.job_run_details to 14 days, so the
--    freshness lookups stay bounded (Supabase does not prune it).
--
-- Money rules are unchanged: nothing here moves money or changes when it
-- moves. Idempotent.

begin;

-- ---------------------------------------------------------------------------
-- 1. The inventory
-- ---------------------------------------------------------------------------
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
    ('drvn-listing-edit-sweep', '45 3 * * *', 'select public.prune_listing_edit_requests();', array[]::text[], interval '26 hours'),
    ('drvn-listing-import-sweep', '37 3 * * *', 'select public.invoke_remediation_worker(''listing-imports'');', array['listingImports'], interval '26 hours'),
    ('drvn-marketplace-counts', '30 seconds', 'select public.refresh_marketplace_facet_counts();', array[]::text[], interval '10 minutes'),
    ('drvn-media-gc', '17 3 * * *', 'select public.invoke_remediation_worker(''media-gc'');', array['media'], interval '26 hours'),
    ('drvn-prune-rate-limits', '15 3 * * *', 'select public.prune_rate_limits();', array[]::text[], interval '26 hours'),
    ('drvn-release-reservations', '*/5 * * * *', 'select public.release_expired_reservations();', array[]::text[], interval '30 minutes'),
    ('drvn-saved-search-worker', '*/30 * * * *', 'select public.invoke_remediation_worker(''saved-searches'');', array['savedSearches'], interval '90 minutes'),
    ('drvn-search-words', '23 * * * *', 'select public.refresh_search_words();', array[]::text[], interval '3 hours'),
    ('drvn-search-worker', '*/2 * * * *', 'select public.invoke_remediation_worker(''search'');', array['search'], interval '30 minutes'),
    ('drvn-transfer-worker', '*/10 * * * *', 'select public.mark_due_transfer_intents(); select public.invoke_transfer_worker();',
      array['expiries','captures','transfers','transferReconciliation','refunds','labelVoids','returns','disputes','alerts','receipts','analytics'],
      interval '30 minutes')
$$;
revoke all on function private.scheduled_job_inventory() from public, anon, authenticated;

-- cron.job.command is stored as written; compare on collapsed whitespace.
create or replace function private.normalized_sql(p text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$ select regexp_replace(btrim(p), '\s+', ' ', 'g') $$;
revoke all on function private.normalized_sql(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. Run-history retention (scheduled below, once the function exists)
-- ---------------------------------------------------------------------------
create or replace function private.prune_cron_history()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  removed integer;
begin
  delete from cron.job_run_details where coalesce(end_time, start_time) < now() - interval '14 days';
  get diagnostics removed = row_count;
  return removed;
end;
$$;
revoke all on function private.prune_cron_history() from public, anon, authenticated;

do $$
declare
  j record;
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    for j in select jobid from cron.job where jobname = 'drvn-cron-history-prune' loop
      perform cron.unschedule(j.jobid);
    end loop;
    perform cron.schedule('drvn-cron-history-prune', '27 4 * * *', $job$select private.prune_cron_history();$job$);
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 5. Webhook delivery failures
-- ---------------------------------------------------------------------------
alter table public.webhook_events
  add column if not exists failed_attempts integer not null default 0,
  add column if not exists last_failed_at timestamptz,
  add column if not exists last_failure_kind text,
  add column if not exists last_failure_detail text;

alter table public.webhook_events drop constraint if exists webhook_events_last_failure_kind_check;
alter table public.webhook_events add constraint webhook_events_last_failure_kind_check
  check (last_failure_kind is null or last_failure_kind in ('retry', 'error'));

-- The unprocessed backlog is tiny next to the table; health reads only it.
create index if not exists webhook_events_unprocessed_idx
  on public.webhook_events (received_at) where processed_at is null;

-- One failed delivery of an event that is still unprocessed: 'retry' when a
-- handler asked the provider to redeliver, 'error' when it threw. Returns the
-- attempt count, or null when the event is unknown or already processed.
create or replace function public.record_webhook_failure(p_id text, p_kind text, p_detail text default null)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_attempts integer;
begin
  if p_kind is null or p_kind not in ('retry', 'error') then
    raise exception 'Unknown webhook failure kind' using errcode = '22023';
  end if;
  update public.webhook_events
     set failed_attempts = failed_attempts + 1,
         last_failed_at = now(),
         last_failure_kind = p_kind,
         last_failure_detail = left(nullif(btrim(p_detail), ''), 300)
   where id = p_id and processed_at is null
  returning failed_attempts into v_attempts;
  return v_attempts;
end;
$$;
revoke all on function public.record_webhook_failure(text, text, text) from public, anon, authenticated;
grant execute on function public.record_webhook_failure(text, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- 2–5. The snapshot
-- ---------------------------------------------------------------------------
-- Latest: 20261026100000_agent_hosted_schedule.sql (#64). Changed: families
-- come from the inventory, jobs and config are new, and the queue rules above.
-- The families and queues keys keep their shape, plus `job`/`reason` on a
-- family and `attempts_max` on a queue.
create or replace function public.worker_health_snapshot()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_jobs jsonb;
  v_families jsonb;
  v_queues jsonb;
  v_scheduler boolean := to_regclass('cron.job') is not null and to_regclass('cron.job_run_details') is not null;
  v_history boolean := coalesce(current_setting('cron.log_run', true), 'on') <> 'off';
begin
  if v_scheduler then
    with inventory as (select * from private.scheduled_job_inventory()),
    history as (select d.start_time from cron.job_run_details d order by d.runid limit 1),
    observed as (
      select i.*, j.jobid, j.active, j.schedule as actual_schedule, j.command as actual_command,
             s.runid as success_run, s.end_time as last_success, f.end_time as last_failure, r.start_time as running_since
      from inventory i
      left join cron.job j on j.jobname = i.job
      left join lateral (
        select d.runid, d.end_time from cron.job_run_details d
        where d.jobid = j.jobid and d.status = 'succeeded' order by d.runid desc limit 1) s on true
      left join lateral (
        select d.end_time from cron.job_run_details d
        where d.jobid = j.jobid and d.status = 'failed' and d.runid > coalesce(s.runid, -1)
        order by d.runid desc limit 1) f on true
      left join lateral (
        select d.start_time from cron.job_run_details d
        where d.jobid = j.jobid and d.status in ('starting', 'running', 'sending', 'connecting')
          and d.runid > coalesce(s.runid, -1)
        order by d.runid limit 1) r on true
    ),
    judged as (
      select o.*,
        case
          when o.jobid is null then 'not_scheduled'
          when not o.active then 'inactive'
          when o.actual_schedule is distinct from o.schedule then 'schedule_changed'
          when private.normalized_sql(o.actual_command) is distinct from private.normalized_sql(o.command) then 'command_changed'
          when not v_history then 'history_disabled'
          when o.last_failure is not null then 'failing'
          when o.running_since < now() - o.budget then 'stuck_running'
          -- Never run: only once the scheduler's own history is older than
          -- the budget, so a fresh project is not red until 03:15.
          when o.success_run is null then
            case when (select h.start_time from history h) < now() - o.budget then 'never_succeeded' end
          when o.last_success < now() - o.budget then 'overdue'
        end as reason
      from observed o
    )
    select jsonb_agg(jsonb_build_object(
      'job', job, 'schedule', schedule, 'families', to_jsonb(families),
      'budget_seconds', extract(epoch from budget),
      'scheduled', jobid is not null, 'active', coalesce(active, false),
      'schedule_matches', jobid is not null and actual_schedule is not distinct from schedule,
      'command_matches', jobid is not null and private.normalized_sql(actual_command) is not distinct from private.normalized_sql(command),
      'last_success', last_success, 'last_failure', last_failure, 'running_since', running_since,
      'stale', reason is not null, 'reason', reason) order by job)
    into v_jobs from judged;
  else
    select jsonb_agg(jsonb_build_object(
      'job', job, 'schedule', schedule, 'families', to_jsonb(families),
      'budget_seconds', extract(epoch from budget),
      'scheduled', false, 'active', false, 'schedule_matches', false, 'command_matches', false,
      'last_success', null, 'last_failure', null, 'running_since', null,
      'stale', true, 'reason', 'scheduler_missing') order by job)
    into v_jobs from private.scheduled_job_inventory();
  end if;

  with family_jobs as (
    select distinct on (f.family) f.family, i.job, i.budget
    from private.scheduled_job_inventory() i cross join lateral unnest(i.families) as f(family)
    order by f.family, i.budget
  ),
  runs as (
    select fj.*, s.started_at as success_started, s.finished_at as last_success,
           fl.finished_at as last_failure, rn.started_at as running_since
    from family_jobs fj
    left join lateral (
      select r.started_at, r.finished_at from public.worker_runs r
      where r.family = fj.family and r.status = 'succeeded' order by r.started_at desc limit 1) s on true
    left join lateral (
      select r.finished_at from public.worker_runs r
      where r.family = fj.family and r.status = 'failed' and r.started_at >= coalesce(s.started_at, '-infinity')
      order by r.started_at desc limit 1) fl on true
    -- A run orphaned before a later success is history, not a stuck worker.
    left join lateral (
      select r.started_at from public.worker_runs r
      where r.family = fj.family and r.status = 'running' and r.started_at > coalesce(s.started_at, '-infinity')
      order by r.started_at limit 1) rn on true
  ),
  judged as (
    select runs.*,
      case
        when last_success is null then 'never_succeeded'
        when last_failure is not null then 'failing'
        when running_since < now() - interval '6 minutes' then 'stuck_running'
        when last_success < now() - budget then 'overdue'
      end as reason
    from runs
  )
  select jsonb_agg(jsonb_build_object(
    'family', family, 'job', job, 'last_success', last_success, 'last_failure', last_failure,
    'running_since', running_since, 'budget_seconds', extract(epoch from budget),
    'stale', reason is not null, 'reason', reason) order by family)
  into v_families from judged;

  with runnable(kind, status, due_at, grace, page_now, attempts) as (
    -- Durable job queues: 'failed' is terminal (attempts exhausted).
    select kind, status, next_attempt_at, interval '30 minutes', status = 'failed', attempts
    from public.remediation_jobs
    where status = 'failed' or (status = 'pending' and next_attempt_at <= now())
    union all
    select kind, 'processing', locked_until, interval '30 minutes', false, attempts
    from public.remediation_jobs where status = 'processing' and locked_until <= now()
    union all
    select 'alerts', status, next_attempt_at, interval '30 minutes', status = 'failed', attempts
    from public.admin_alert_outbox
    where status = 'failed' or (status = 'pending' and next_attempt_at <= now())
    -- Payouts. Overdue only when the payout could go: delivered, released,
    -- and not frozen by a chargeback that hasn't reached a final outcome
    -- (the journal's terminal states, as 20261107130000 defines them).
    union all
    select 'transfers', ti.status,
      case when ti.status = 'holding' then ti.available_at
           else greatest(coalesce(ti.available_at, ti.created_at), coalesce(ti.next_attempt_at, ti.created_at)) end,
      interval '30 minutes', false, ti.attempts
    from public.transfer_intents ti join public.orders o on o.id = ti.order_id
    where ((ti.status = 'holding' and ti.available_at is not null and ti.available_at <= now()
            and o.status in ('delivered', 'completed'))
        -- Admission's own rule (claim_transfer_intents, 8 attempts): an
        -- exhausted row has opened a recovery case, which pages instead.
        or (ti.status in ('ready', 'failed') and ti.attempts < 8
            and greatest(coalesce(ti.available_at, ti.created_at), coalesce(ti.next_attempt_at, ti.created_at)) <= now()))
      and not exists (select 1 from public.stripe_dispute_journal j
                      where j.order_ids @> array[ti.order_id] and j.state not in ('won', 'warning_closed', 'lost'))
    union all
    select 'transfers', 'processing', lease_expires_at, interval '30 minutes', false, attempts
    from public.transfer_intents where status = 'processing' and lease_expires_at <= now()
    -- A seller who can't be paid yet is waiting on the seller, not on us.
    union all
    select 'transfers', 'blocked_unpayable', coalesce(available_at, created_at), null::interval, false, attempts
    from public.transfer_intents where status = 'blocked_unpayable' and coalesce(available_at, created_at) <= now()
    -- Refunds we owe a step on. 'failed' (refused, terminal) and
    -- 'recovery_required' with a recovery case belong to that case.
    union all
    select 'refunds', status, coalesce(next_attempt_at, created_at), interval '30 minutes', false, attempts
    from public.refund_operations
    where status in ('requested', 'provider_pending', 'provider_succeeded', 'effects_pending', 'reversal_pending')
      and coalesce(next_attempt_at, created_at) <= now()
      and not (status = 'provider_pending' and coalesce(provider_status, 'unknown') in ('pending', 'requires_action'))
    union all
    select 'refunds', 'recovery_required', updated_at, interval '0 seconds', true, attempts
    from public.refund_operations where status = 'recovery_required' and recovery_id is null
    -- Refunds Stripe is still settling: visible, and late after three days.
    union all
    select 'refunds', 'awaiting_provider', created_at, interval '72 hours', false, attempts
    from public.refund_operations
    where status = 'provider_pending' and provider_status in ('pending', 'requires_action')
    union all
    select 'labelVoids', status,
      case when provider_state = 'submitted' then updated_at + interval '6 hours'
           when status = 'requested' then updated_at + interval '1 minute'
           else updated_at + interval '15 minutes' end,
      interval '30 minutes', false, null::integer
    from public.outbound_label_void_requests
    where status in ('requested', 'provider_pending') and
      case when provider_state = 'submitted' then updated_at + interval '6 hours'
           when status = 'requested' then updated_at + interval '1 minute'
           else updated_at + interval '15 minutes' end <= now()
    -- Chargeback recovery: a loss being booked whose lease ran out.
    union all
    select 'provider_disputes', 'loss_pending', coalesce(lease_expires_at, updated_at), interval '30 minutes', false, null::integer
    from public.stripe_dispute_journal
    where state = 'loss_pending' and coalesce(lease_expires_at, updated_at) <= now()
    -- Provider events not yet applied (a retry, or a first pass that died).
    union all
    select case when id like 'easypost:%' then 'easypost_webhooks' else 'webhooks' end,
      case when failed_attempts > 0 then 'retrying' else 'unprocessed' end,
      received_at, interval '1 hour', false, failed_attempts
    from public.webhook_events where processed_at is null
    union all
    select 'financial_recovery', 'open', created_at, interval '0 seconds', true, null::integer
    from public.payment_recoveries where status = 'open'
  ),
  queues as (
    select kind, status, count(*) as count, min(due_at) as oldest, max(attempts) as attempts_max,
      coalesce(bool_or(page_now) or min(due_at) < now() - min(grace), false) as overdue
    from runnable group by kind, status
  )
  select coalesce(jsonb_agg(to_jsonb(queues) order by kind, status), '[]'::jsonb) into v_queues from queues;

  return jsonb_build_object(
    'families', coalesce(v_families, '[]'::jsonb),
    'jobs', coalesce(v_jobs, '[]'::jsonb),
    'queues', v_queues,
    'config', jsonb_build_object(
      'scheduler', v_scheduler,
      'run_history', v_scheduler and v_history,
      'pg_net', exists (select 1 from pg_extension where extname = 'pg_net'),
      'worker_url', (select c.value from public.job_config c where c.key = 'transfer_worker_url'),
      'worker_secret_sha256', (select encode(sha256(convert_to(c.value, 'UTF8')), 'hex')
                               from public.job_config c where c.key = 'transfer_worker_secret')));
end;
$$;
revoke all on function public.worker_health_snapshot() from public, anon, authenticated;
grant execute on function public.worker_health_snapshot() to service_role;

-- ---------------------------------------------------------------------------
-- Self-check
-- ---------------------------------------------------------------------------
do $$
declare
  snapshot jsonb := public.worker_health_snapshot();
  missing text;
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    select string_agg(i.job, ', ') into missing from private.scheduled_job_inventory() i
    where not exists (select 1 from cron.job j where j.jobname = i.job and j.schedule = i.schedule
                        and private.normalized_sql(j.command) = private.normalized_sql(i.command));
    if missing is not null then raise exception 'SELF-CHECK FAILED: inventory jobs not scheduled as listed: %', missing; end if;
    select string_agg(j.jobname, ', ') into missing from cron.job j
    where j.jobname like 'drvn-%' and not exists (select 1 from private.scheduled_job_inventory() i where i.job = j.jobname);
    if missing is not null then raise exception 'SELF-CHECK FAILED: scheduled jobs missing from the inventory: %', missing; end if;
  end if;
  if jsonb_array_length(snapshot->'jobs') <> (select count(*) from private.scheduled_job_inventory())
     or not exists (select 1 from jsonb_array_elements(snapshot->'families') f where f->>'family' = 'agent') then
    raise exception 'SELF-CHECK FAILED: worker health shape';
  end if;
end $$;

notify pgrst, 'reload schema';
commit;
