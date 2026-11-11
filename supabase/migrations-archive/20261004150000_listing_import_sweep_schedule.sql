-- 20261004150000 — schedule the listing-import retention sweep.
--
-- /api/jobs/listing-imports (0047) expires overdue imports and, 7 days after
-- a row goes terminal, scrubs the copied source text and image list — the
-- retention promise the importer makes. Its header said "the same external
-- cron that runs media-gc" runs it, but media-gc is run by pg_cron through
-- invoke_remediation_worker, whose family allowlist never included
-- 'listing-imports', and no schedule was ever created. Nothing ran the sweep
-- outside a developer's scripts/dev-jobs.sh.
--
-- This migration:
--   1. restates invoke_remediation_worker (latest: 20260905011618) with
--      'listing-imports' added to the allowlist — same URL derivation from
--      job_config.transfer_worker_url, same bearer, same timeout, same grants;
--   2. schedules it daily as drvn-listing-import-sweep, the way drvn-media-gc
--      is scheduled;
--   3. restates worker_health_snapshot (latest: 20260905234024) with a
--      'listingImports' family on media's 26-hour budget, so a sweep that
--      stops running shows as overdue in Admin → Settings → Background jobs,
--      /api/health/workers and the independent monitor.
--
-- Idempotent: create-or-replace functions, unschedule-by-name before
-- scheduling. Signatures and return types are unchanged, so the generated
-- database contract is unaffected.

begin;

create or replace function public.invoke_remediation_worker(p_family text) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare base text; secret text;
begin
 if p_family not in ('search','account-deletions','media-gc','saved-searches','listing-imports') then raise exception 'Unknown worker family'; end if;
 select value into base from public.job_config where key='transfer_worker_url';
 select value into secret from public.job_config where key='transfer_worker_secret';
 if base is null or secret is null then return; end if;
 if base !~ '/api/jobs/transfers$' then raise exception 'Invalid transfer worker URL'; end if;
 perform net.http_post(url:=regexp_replace(base,'/transfers$','/'||p_family),headers:=jsonb_build_object('Authorization','Bearer '||secret,'Content-Type','application/json'),body:='{}'::jsonb,timeout_milliseconds:=60000);
end $$;
revoke all on function public.invoke_remediation_worker(text) from public,anon,authenticated;
grant execute on function public.invoke_remediation_worker(text) to service_role;

do $$
declare
  j record;
begin
  for j in select jobid from cron.job where jobname = 'drvn-listing-import-sweep'
  loop
    perform cron.unschedule(j.jobid);
  end loop;
end $$;

-- Daily at 03:37, twenty minutes after drvn-media-gc: rows expired here leave
-- their staged photos to the 48-hour media GC, one media lifecycle.
select cron.schedule('drvn-listing-import-sweep','37 3 * * *',$job$select public.invoke_remediation_worker('listing-imports');$job$);

create or replace function public.worker_health_snapshot() returns jsonb
language sql security definer set search_path=public,pg_temp as $$
 with families(family,budget) as (values
 ('expiries',interval '30 minutes'),('captures',interval '30 minutes'),
 ('transfers',interval '30 minutes'),('transferReconciliation',interval '30 minutes'),
 ('refunds',interval '30 minutes'),('labelVoids',interval '30 minutes'),
 ('returns',interval '30 minutes'),('disputes',interval '30 minutes'),
 ('alerts',interval '30 minutes'),('receipts',interval '30 minutes'),
 ('analytics',interval '30 minutes'),('search',interval '30 minutes'),
 ('deletions',interval '30 minutes'),('savedSearches',interval '90 minutes'),
 ('media',interval '26 hours'),('listingImports',interval '26 hours')),
 runs as (
 select f.family,f.budget,
 max(r.finished_at) filter(where r.status='succeeded') last_success,
 max(r.finished_at) filter(where r.status='failed') last_failure,
 min(r.started_at) filter(where r.status='running') running_since
 from families f left join public.worker_runs r on r.family=f.family group by f.family,f.budget),
 runnable as (
 select kind,status,next_attempt_at due_at from public.remediation_jobs
 where status='failed' or (status='pending' and next_attempt_at<=now())
 union all select kind,'processing',locked_until from public.remediation_jobs
 where status='processing' and locked_until<=now()
 union all select 'alerts',status,next_attempt_at from public.admin_alert_outbox
 where status='failed' or (status='pending' and next_attempt_at<=now())
 union all select 'transfers',status,greatest(coalesce(available_at,created_at),coalesce(next_attempt_at,created_at))
 from public.transfer_intents where status in ('holding','ready','blocked_unpayable','failed')
 and greatest(coalesce(available_at,created_at),coalesce(next_attempt_at,created_at))<=now()
 union all select 'transfers','processing',lease_expires_at from public.transfer_intents
 where status='processing' and lease_expires_at<=now()
 union all select 'refunds',status,coalesce(next_attempt_at,created_at) from public.refund_operations
 where status in ('requested','provider_pending','provider_succeeded','effects_pending','reversal_pending','failed','recovery_required')
 and coalesce(next_attempt_at,created_at)<=now()
 and coalesce(provider_status,'unknown') not in ('pending','requires_action')
 union all select 'labelVoids',status,
   case when provider_state='submitted' then updated_at+interval '6 hours'
        when status='requested' then updated_at+interval '1 minute'
        else updated_at+interval '15 minutes' end
 from public.outbound_label_void_requests
 where status in ('requested','provider_pending') and
   case when provider_state='submitted' then updated_at+interval '6 hours'
        when status='requested' then updated_at+interval '1 minute'
        else updated_at+interval '15 minutes' end <=now()
 union all select 'financial_recovery','open',created_at from public.payment_recoveries where status='open'
 ), queues as (
 select kind,status,count(*) count,min(due_at) oldest,
 (status in ('failed','recovery_required') or kind='financial_recovery'
   or min(due_at)<now()-interval '30 minutes') overdue
 from runnable group by kind,status)
 select jsonb_build_object('families',(select jsonb_agg(jsonb_build_object(
 'family',family,'last_success',last_success,'last_failure',last_failure,
 'running_since',running_since,'budget_seconds',extract(epoch from budget),
 'stale',coalesce(last_success<now()-budget,true)
   or coalesce(last_failure>last_success,false)
   or coalesce(running_since<now()-interval '6 minutes',false))) from runs),
 'queues',(select coalesce(jsonb_agg(queues),'[]'::jsonb) from queues));
$$;
revoke all on function public.worker_health_snapshot() from public,anon,authenticated;
grant execute on function public.worker_health_snapshot() to service_role;

do $$
begin
  if not exists (
    select 1 from cron.job
    where jobname = 'drvn-listing-import-sweep'
      and schedule = '37 3 * * *'
      and command like '%invoke_remediation_worker(''listing-imports'')%'
  ) then
    raise exception 'SELF-CHECK FAILED: listing-import sweep not scheduled';
  end if;
  if position('''listing-imports''' in pg_get_functiondef('public.invoke_remediation_worker(text)'::regprocedure)) = 0 then
    raise exception 'SELF-CHECK FAILED: listing-imports missing from the worker allowlist';
  end if;
  if not exists (
    select 1 from jsonb_array_elements(public.worker_health_snapshot()->'families') f
    where f->>'family' = 'listingImports'
  ) then
    raise exception 'SELF-CHECK FAILED: listingImports missing from worker health';
  end if;
end $$;

notify pgrst,'reload schema';
commit;
