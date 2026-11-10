-- 20261107191000: one job inventory, health judged by running, webhook retries.
--   A. The inventory and cron.job agree both ways: name, schedule, command (N226, N245).
--   A2. The families, job by job, equal the runbook's list, and every worker
--       route the jobs call is accepted (N680).
--   B. The snapshot reports every inventory job; no fixed row count anywhere.
--   C. A job is judged by its runs: never succeeded, fresh, failing, overdue,
--      stuck, and by its schedule row: not scheduled, inactive, changed.
--   D. A fresh project (history younger than the budget) is not red for a job yet to run.
--   E. Families: never run, fresh, failing, stuck; an orphan before a success is not stuck.
--   F. Config: the worker URL and a digest of the secret, never the secret.
--   G. Payouts (N391): undelivered holds, chargeback-frozen holds and seller blocks are not overdue.
--   H. Refunds (N391): provider-pending is its own row, a terminal refusal is not a queue.
--   I. Chargeback recovery: a loss_pending dispute whose lease ran out is overdue.
--   J. Webhooks (N109): failed deliveries are counted, and an old unprocessed event is overdue.
--   K. Members can call neither function.
begin;

create function pg_temp.job(p_name text) returns jsonb language sql as $$
  select j from jsonb_array_elements(public.worker_health_snapshot()->'jobs') j where j->>'job' = p_name
$$;
create function pg_temp.family(p_name text) returns jsonb language sql as $$
  select f from jsonb_array_elements(public.worker_health_snapshot()->'families') f where f->>'family' = p_name
$$;
create function pg_temp.queue(p_kind text, p_status text) returns jsonb language sql as $$
  select q from jsonb_array_elements(public.worker_health_snapshot()->'queues') q where q->>'kind' = p_kind and q->>'status' = p_status
$$;
create function pg_temp.code(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return 'ok';
exception when others then
  return sqlstate;
end $$;
-- Fixture runs sort after anything the live scheduler writes during the guard.
create sequence pg_temp.fixture_run start 9000000000000001;
create function pg_temp.run(p_job text, p_status text, p_start timestamptz, p_end timestamptz) returns void language sql as $$
  insert into cron.job_run_details(runid, jobid, status, start_time, end_time)
  select nextval('pg_temp.fixture_run'), j.jobid, p_status, p_start, p_end from cron.job j where j.jobname = p_job
$$;

-- This guard's own helpers are called while acting as other roles. A new
-- function is closed by default (architecture plan 2, item A3), so they are opened here.
grant execute on all routines in schema pg_temp to public;

do $$
declare
  seller uuid := gen_random_uuid();
  buyer uuid := gen_random_uuid();
  o uuid;
  unpaid uuid;
  n integer;
  missing text;
  j jsonb;
  q jsonb;
  snapshot jsonb;
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise exception 'FAIL 0: this guard needs pg_cron, as CI''s database has';
  end if;

  -- A. Both directions, every column that matters.
  select string_agg(i.job, ', ') into missing from private.scheduled_job_inventory() i
  where not exists (select 1 from cron.job c where c.jobname = i.job and c.schedule = i.schedule
                      and private.normalized_sql(c.command) = private.normalized_sql(i.command));
  if missing is not null then raise exception 'FAIL 1: inventory jobs not scheduled as listed: %', missing; end if;
  select string_agg(c.jobname, ', ') into missing from cron.job c
  where c.jobname like 'drvn-%' and not exists (select 1 from private.scheduled_job_inventory() i where i.job = c.jobname);
  if missing is not null then raise exception 'FAIL 2: scheduled jobs missing from the inventory: %', missing; end if;
  -- Every family is driven by exactly one job, and the agent, refresh jobs
  -- and the transfer pass are all there.
  if (select count(*) from private.scheduled_job_inventory() i, unnest(i.families) f)
     <> (select count(distinct f) from private.scheduled_job_inventory() i, unnest(i.families) f) then
    raise exception 'FAIL 3: a worker family is driven by two jobs';
  end if;
  if not exists (select 1 from private.scheduled_job_inventory() where job = 'drvn-agent-worker' and families = array['agent'])
     or not exists (select 1 from private.scheduled_job_inventory() where job = 'drvn-marketplace-counts')
     or not exists (select 1 from private.scheduled_job_inventory() where job = 'drvn-grow-products-full')
     or not exists (select 1 from private.scheduled_job_inventory() where job = 'drvn-transfer-worker' and 'refunds' = any(families)) then
    raise exception 'FAIL 4: the inventory leaves out a family';
  end if;
  -- The families, job by job, as docs/production-runbook.md §4 lists them
  -- (N680). A restatement of the inventory that drops or moves a family fails
  -- here by name; tests/ci/job-families.test.ts holds this list, the
  -- runbook's and src/lib/job-inventory.ts's to the same set.
  create temporary table pg_temp.expected_families(job text, family text) on commit drop;
  insert into pg_temp.expected_families(job, family) values
    ('drvn-agent-worker', 'agent'),
    ('drvn-deletion-worker', 'deletions'),
    ('drvn-delivery-auto-confirm', 'deliveryAutoConfirm'),
    ('drvn-ledger-reconciliation', 'ledgerReconciliation'),
    ('drvn-listing-import-sweep', 'listingImports'),
    ('drvn-media-gc', 'media'),
    ('drvn-saved-search-digests', 'savedSearchDigests'),
    ('drvn-saved-search-worker', 'savedSearches'),
    ('drvn-search-worker', 'search'),
    ('drvn-transfer-worker', 'expiries'),
    ('drvn-transfer-worker', 'captures'),
    ('drvn-transfer-worker', 'transfers'),
    ('drvn-transfer-worker', 'transferReconciliation'),
    ('drvn-transfer-worker', 'refunds'),
    ('drvn-transfer-worker', 'labelVoids'),
    ('drvn-transfer-worker', 'returns'),
    ('drvn-transfer-worker', 'disputes'),
    ('drvn-transfer-worker', 'payoutDeadlines'),
    ('drvn-transfer-worker', 'alerts'),
    ('drvn-transfer-worker', 'receipts'),
    ('drvn-transfer-worker', 'analytics');
  select string_agg(e.job || ':' || e.family, ', ' order by e.job, e.family) into missing
  from pg_temp.expected_families e
  where not exists (select 1 from private.scheduled_job_inventory() i where i.job = e.job and e.family = any(i.families));
  if missing is not null then raise exception 'FAIL 4b: the inventory lost the families % (N680)', missing; end if;
  select string_agg(i.job || ':' || f, ', ' order by i.job, f) into missing
  from private.scheduled_job_inventory() i, unnest(i.families) f
  where not exists (select 1 from pg_temp.expected_families e where e.job = i.job and e.family = f);
  if missing is not null then raise exception 'FAIL 4c: the inventory has families the runbook does not list: % (N680)', missing; end if;
  -- Every route the inventory's jobs call is one invoke_remediation_worker
  -- accepts (with no worker URL it returns before calling anything).
  delete from public.job_config where key in ('transfer_worker_url', 'transfer_worker_secret');
  select string_agg(r.route, ', ' order by r.route) into missing
  from (select distinct (regexp_match(i.command, 'invoke_remediation_worker\(''([a-z-]+)''\)'))[1] as route
        from private.scheduled_job_inventory() i) r
  where r.route is not null
    and pg_temp.code(format('select public.invoke_remediation_worker(%L)', r.route)) <> 'ok';
  if missing is not null then raise exception 'FAIL 4d: invoke_remediation_worker refuses the routes % (N680)', missing; end if;
  if (select count(distinct (regexp_match(i.command, 'invoke_remediation_worker\(''([a-z-]+)''\)'))[1]) from private.scheduled_job_inventory() i) <> 8 then
    raise exception 'FAIL 4e: the inventory no longer calls the eight worker routes (N680)';
  end if;
  raise notice 'PASS A: inventory and cron.job agree by name, schedule and command';

  -- B. The snapshot covers the inventory, judged per job.
  snapshot := public.worker_health_snapshot();
  if jsonb_array_length(snapshot->'jobs') <> (select count(*) from private.scheduled_job_inventory())
     or jsonb_array_length(snapshot->'jobs') <> (select count(*) from cron.job where jobname like 'drvn-%') then
    raise exception 'FAIL 5: snapshot jobs differ from the inventory';
  end if;
  if exists (select 1 from jsonb_array_elements(snapshot->'jobs') x
             where not (x->>'scheduled')::boolean or not (x->>'schedule_matches')::boolean or not (x->>'command_matches')::boolean) then
    raise exception 'FAIL 6: a freshly migrated job reads unscheduled or changed';
  end if;
  if jsonb_array_length(snapshot->'families') <> (select count(distinct f) from private.scheduled_job_inventory() i, unnest(i.families) f) then
    raise exception 'FAIL 7: snapshot families differ from the inventory';
  end if;
  raise notice 'PASS B: every inventory job and family is reported';

  -- C. drvn-dispute-sla (daily, 08:05) as the subject.
  delete from cron.job_run_details where jobid = (select jobid from cron.job where jobname = 'drvn-dispute-sla');
  insert into cron.job_run_details(runid, jobid, status, start_time, end_time)
  values (-1, (select jobid from cron.job where jobname = 'drvn-release-reservations'), 'succeeded', now() - interval '3 days', now() - interval '3 days');
  j := pg_temp.job('drvn-dispute-sla');
  if j->>'reason' is distinct from 'never_succeeded' or not (j->>'stale')::boolean then
    raise exception 'FAIL 8: a job that never ran on an established scheduler reads %', j->>'reason';
  end if;
  perform pg_temp.run('drvn-dispute-sla', 'succeeded', now() - interval '2 minutes', now() - interval '1 minute');
  j := pg_temp.job('drvn-dispute-sla');
  if (j->>'stale')::boolean or j->>'last_success' is null then raise exception 'FAIL 9: a fresh success reads %', j->>'reason'; end if;
  perform pg_temp.run('drvn-dispute-sla', 'failed', now(), now());
  if pg_temp.job('drvn-dispute-sla')->>'reason' is distinct from 'failing' then raise exception 'FAIL 10: a failure after the last success is not failing'; end if;
  perform pg_temp.run('drvn-dispute-sla', 'succeeded', now() - interval '2 days', now() - interval '2 days');
  if pg_temp.job('drvn-dispute-sla')->>'reason' is distinct from 'overdue' then raise exception 'FAIL 11: a success older than the budget is not overdue'; end if;
  perform pg_temp.run('drvn-dispute-sla', 'running', now() - interval '27 hours', null);
  if pg_temp.job('drvn-dispute-sla')->>'reason' is distinct from 'stuck_running' then raise exception 'FAIL 12: a run past its budget is not stuck'; end if;
  perform pg_temp.run('drvn-dispute-sla', 'succeeded', now() - interval '1 minute', now());
  if (pg_temp.job('drvn-dispute-sla')->>'stale')::boolean then raise exception 'FAIL 13: a later success does not clear the job'; end if;

  update cron.job set schedule = '0 0 * * *' where jobname = 'drvn-dispute-sla';
  if pg_temp.job('drvn-dispute-sla')->>'reason' is distinct from 'schedule_changed' then raise exception 'FAIL 14: a changed schedule is not reported'; end if;
  update cron.job set schedule = '5 8 * * *', command = 'select 1' where jobname = 'drvn-dispute-sla';
  if pg_temp.job('drvn-dispute-sla')->>'reason' is distinct from 'command_changed' then raise exception 'FAIL 15: a changed command is not reported'; end if;
  update cron.job set command = $c$ select public.escalate_stale_disputes(); $c$, active = false where jobname = 'drvn-dispute-sla';
  if pg_temp.job('drvn-dispute-sla')->>'reason' is distinct from 'inactive' then raise exception 'FAIL 16: an inactive job is not reported'; end if;
  delete from cron.job where jobname = 'drvn-dispute-sla';
  j := pg_temp.job('drvn-dispute-sla');
  if j->>'reason' is distinct from 'not_scheduled' or (j->>'scheduled')::boolean then raise exception 'FAIL 17: an unscheduled job is not reported'; end if;
  raise notice 'PASS C: a job is judged by its runs and its schedule row';

  -- D. A fresh project: nothing older than a day in the history.
  delete from cron.job_run_details;
  j := pg_temp.job('drvn-prune-rate-limits');
  if (j->>'stale')::boolean then raise exception 'FAIL 18: a daily job reads % on a scheduler younger than its budget', j->>'reason'; end if;
  raise notice 'PASS D: a fresh scheduler is not red for a job that has not had its first run';

  -- E. Families.
  delete from public.worker_runs where family = 'agent';
  if pg_temp.family('agent')->>'reason' is distinct from 'never_succeeded' then raise exception 'FAIL 19: a family that never ran is not stale'; end if;
  if pg_temp.family('agent')->>'job' is distinct from 'drvn-agent-worker' then raise exception 'FAIL 20: a family does not name its job'; end if;
  insert into public.worker_runs(id, family, status, started_at, finished_at)
  values (gen_random_uuid(), 'agent', 'running', now() - interval '2 days', null),
         (gen_random_uuid(), 'agent', 'succeeded', now() - interval '20 minutes', now() - interval '19 minutes');
  if (pg_temp.family('agent')->>'stale')::boolean then
    raise exception 'FAIL 21: an orphaned run before a later success reads %', pg_temp.family('agent')->>'reason';
  end if;
  insert into public.worker_runs(id, family, status, started_at, finished_at)
  values (gen_random_uuid(), 'agent', 'running', now() - interval '10 minutes', null);
  if pg_temp.family('agent')->>'reason' is distinct from 'stuck_running' then raise exception 'FAIL 22: a run stuck after the last success is not reported'; end if;
  delete from public.worker_runs where family = 'agent' and status = 'running';
  insert into public.worker_runs(id, family, status, started_at, finished_at)
  values (gen_random_uuid(), 'agent', 'failed', now(), now());
  if pg_temp.family('agent')->>'reason' is distinct from 'failing' then raise exception 'FAIL 23: a failure after the last success is not failing'; end if;
  raise notice 'PASS E: families are fresh, failing, stuck or never run, and orphans do not linger';

  -- F. Config.
  delete from public.job_config where key in ('transfer_worker_url', 'transfer_worker_secret');
  snapshot := public.worker_health_snapshot();
  if snapshot->'config'->>'worker_url' is not null or snapshot->'config'->>'worker_secret_sha256' is not null
     or not (snapshot->'config'->>'scheduler')::boolean then
    raise exception 'FAIL 24: missing scheduler configuration is not reported';
  end if;
  insert into public.job_config(key, value) values
    ('transfer_worker_url', 'https://drvn.example/api/jobs/transfers'), ('transfer_worker_secret', 'guard-secret-guard-secret-guard-secret');
  snapshot := public.worker_health_snapshot();
  if snapshot->'config'->>'worker_url' <> 'https://drvn.example/api/jobs/transfers'
     or snapshot->'config'->>'worker_secret_sha256' <> encode(sha256(convert_to('guard-secret-guard-secret-guard-secret', 'UTF8')), 'hex')
     or snapshot::text like '%guard-secret-guard-secret%' then
    raise exception 'FAIL 25: the secret is not reported as a digest only';
  end if;
  raise notice 'PASS F: worker URL and secret digest reported, secret never';

  -- G. Payouts.
  insert into auth.users(id, email) values (seller, 'health-seller@drvn.test'), (buyer, 'health-buyer@drvn.test');
  insert into public.orders(buyer_id, seller_id, status, subtotal_cents, platform_fee_cents, total_cents, currency)
  values (buyer, seller, 'paid', 10000, 1000, 10000, 'USD') returning id into unpaid;
  insert into public.transfer_intents(order_id, seller_id, amount_cents, currency, status, created_at)
  values (unpaid, seller, 9000, 'USD', 'holding', now() - interval '2 hours');
  if pg_temp.queue('transfers', 'holding') is not null then raise exception 'FAIL 26: an undelivered hold counts as overdue work'; end if;
  delete from public.transfer_intents where order_id = unpaid;

  insert into public.orders(buyer_id, seller_id, status, subtotal_cents, platform_fee_cents, total_cents, currency)
  values (buyer, seller, 'delivered', 10000, 1000, 10000, 'USD') returning id into o;
  insert into public.transfer_intents(order_id, seller_id, amount_cents, currency, status, available_at, created_at)
  values (o, seller, 9000, 'USD', 'holding', now() - interval '2 hours', now() - interval '3 days');
  if not coalesce((pg_temp.queue('transfers', 'holding')->>'overdue')::boolean, false) then
    raise exception 'FAIL 27: a released hold the scheduler did not move is not overdue';
  end if;
  insert into public.stripe_dispute_journal(dispute_id, payment_reference, amount_cents, currency, state, last_event_id, last_event_created, order_ids)
  values ('dp_health_guard', 'pi_health_guard', 10000, 'usd', 'open', 'evt_health_guard', 1, array[o]);
  if pg_temp.queue('transfers', 'holding') is not null then raise exception 'FAIL 28: a hold frozen by an open chargeback counts as overdue'; end if;
  update public.stripe_dispute_journal set state = 'won' where dispute_id = 'dp_health_guard';
  if pg_temp.queue('transfers', 'holding') is null then raise exception 'FAIL 29: a won chargeback still hides the hold'; end if;

  update public.transfer_intents set status = 'blocked_unpayable' where order_id = o;
  q := pg_temp.queue('transfers', 'blocked_unpayable');
  if q is null or (q->>'overdue')::boolean then raise exception 'FAIL 30: a seller block must be visible and not overdue'; end if;

  update public.transfer_intents set status = 'failed', attempts = 2, next_attempt_at = now() - interval '10 minutes' where order_id = o;
  if (pg_temp.queue('transfers', 'failed')->>'overdue')::boolean then raise exception 'FAIL 31: a failed payout inside its grace pages'; end if;
  update public.transfer_intents set next_attempt_at = now() - interval '2 hours' where order_id = o;
  if not (pg_temp.queue('transfers', 'failed')->>'overdue')::boolean then raise exception 'FAIL 32: a failed payout long past its retry is not overdue'; end if;
  update public.transfer_intents set attempts = 8 where order_id = o;
  if pg_temp.queue('transfers', 'failed') is not null then raise exception 'FAIL 33: an exhausted payout (owned by its recovery case) is still a queue'; end if;
  raise notice 'PASS G: payout holds, chargeback freezes and seller blocks are not overdue work';

  -- H. Refunds.
  insert into public.refund_operations(order_id, amount_cents, currency, remaining_before_cents, reason, requested_by, idempotency_key, status, provider_status, created_at)
  values (o, 1000, 'USD', 10000, 'health guard', 'admin:guard', 'health-guard-pending', 'provider_pending', 'pending', now() - interval '2 hours');
  q := pg_temp.queue('refunds', 'awaiting_provider');
  if q is null or (q->>'overdue')::boolean or pg_temp.queue('refunds', 'provider_pending') is not null then
    raise exception 'FAIL 34: a refund pending at Stripe is not its own, quiet row';
  end if;
  update public.refund_operations set created_at = now() - interval '4 days' where idempotency_key = 'health-guard-pending';
  if not (pg_temp.queue('refunds', 'awaiting_provider')->>'overdue')::boolean then raise exception 'FAIL 35: a refund pending at Stripe for days is not overdue'; end if;
  -- An unknown outcome, retried with backoff: aged from creation, not reset by each retry.
  update public.refund_operations set provider_status = 'unknown', created_at = now() - interval '3 hours',
    next_attempt_at = now() + interval '30 minutes', attempts = 5 where idempotency_key = 'health-guard-pending';
  q := pg_temp.queue('refunds', 'provider_unknown');
  if q is null or not (q->>'overdue')::boolean or pg_temp.queue('refunds', 'awaiting_provider') is not null then
    raise exception 'FAIL 35b: an unconfirmed refund outcome hides behind its retry backoff';
  end if;
  update public.refund_operations set created_at = now() - interval '10 minutes' where idempotency_key = 'health-guard-pending';
  if (pg_temp.queue('refunds', 'provider_unknown')->>'overdue')::boolean then raise exception 'FAIL 35c: a fresh unknown outcome pages'; end if;
  update public.refund_operations set status = 'failed', provider_status = 'failed' where idempotency_key = 'health-guard-pending';
  if exists (select 1 from jsonb_array_elements(public.worker_health_snapshot()->'queues') x where x->>'kind' = 'refunds') then
    raise exception 'FAIL 36: a terminal refused refund is still a refund queue';
  end if;
  update public.refund_operations set status = 'recovery_required', recovery_id = null where idempotency_key = 'health-guard-pending';
  if not (pg_temp.queue('refunds', 'recovery_required')->>'overdue')::boolean then raise exception 'FAIL 37: a recovery-required refund with no case does not page'; end if;
  raise notice 'PASS H: provider-pending refunds are distinct and terminal refusals are not a queue';

  -- I. Chargeback recovery.
  update public.stripe_dispute_journal set state = 'loss_pending', lease_id = gen_random_uuid(), lease_expires_at = now() - interval '1 hour'
  where dispute_id = 'dp_health_guard';
  if not coalesce((pg_temp.queue('provider_disputes', 'loss_pending')->>'overdue')::boolean, false) then
    raise exception 'FAIL 38: a stuck chargeback loss is not overdue';
  end if;
  raise notice 'PASS I: chargeback recovery is in health';

  -- J. Webhooks.
  insert into public.webhook_events(id, type, received_at) values ('evt_health_guard', 'charge.refunded', now() - interval '2 hours');
  insert into public.webhook_events(id, type, received_at, processed_at) values ('evt_health_done', 'charge.refunded', now() - interval '2 hours', now());
  insert into public.webhook_events(id, type, received_at) values ('easypost:evt_health', 'tracker.updated', now() - interval '5 minutes');
  if not (pg_temp.queue('webhooks', 'unprocessed')->>'overdue')::boolean then raise exception 'FAIL 39: an event unprocessed for hours is not overdue'; end if;
  n := public.record_webhook_failure('evt_health_guard', 'retry');
  n := public.record_webhook_failure('evt_health_guard', 'error', 'Error: handler threw');
  if n <> 2 then raise exception 'FAIL 40: failed deliveries are not counted (%)', n; end if;
  if (select last_failure_kind || ':' || last_failure_detail from public.webhook_events where id = 'evt_health_guard') <> 'error:Error: handler threw' then
    raise exception 'FAIL 41: the last failure is not recorded';
  end if;
  q := pg_temp.queue('webhooks', 'retrying');
  if q is null or not (q->>'overdue')::boolean or (q->>'attempts_max')::int <> 2 or (q->>'count')::int <> 1 then
    raise exception 'FAIL 42: a retrying event is not overdue with its attempts (%)', q;
  end if;
  if public.record_webhook_failure('evt_health_done', 'retry') is not null then raise exception 'FAIL 43: a processed event gained a failure'; end if;
  if (pg_temp.queue('easypost_webhooks', 'unprocessed')->>'overdue')::boolean then raise exception 'FAIL 44: a minutes-old event pages'; end if;
  if pg_temp.code($c$select public.record_webhook_failure('evt_health_guard', 'whatever')$c$) <> '22023' then raise exception 'FAIL 45: an unknown failure kind is accepted'; end if;
  raise notice 'PASS J: webhook retries carry age and attempts';

  -- K. Privileges.
  if has_function_privilege('authenticated', 'public.worker_health_snapshot()', 'execute')
     or has_function_privilege('anon', 'public.worker_health_snapshot()', 'execute')
     or has_function_privilege('authenticated', 'public.record_webhook_failure(text, text, text)', 'execute')
     or has_function_privilege('anon', 'public.record_webhook_failure(text, text, text)', 'execute')
     or not has_function_privilege('service_role', 'public.record_webhook_failure(text, text, text)', 'execute') then
    raise exception 'FAIL 46: health functions are callable outside the service role';
  end if;
  raise notice 'PASS K: service role only';

  raise notice 'all job inventory health checks passed';
end $$;

rollback;
