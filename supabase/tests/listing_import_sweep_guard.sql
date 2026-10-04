-- ============================================================================
-- Listing-import sweep guard (20261004150000)
--
-- The importer's retention sweep (/api/jobs/listing-imports) must actually be
-- scheduled: pg_cron owns a daily drvn-listing-import-sweep job, the
-- remediation worker invoker accepts the 'listing-imports' family (and still
-- refuses unknown ones), the invoker targets /api/jobs/listing-imports when
-- pg_net is present, and worker health reports the listingImports family.
--
-- Same contract as the other guards: NON-PRODUCTION database only; the whole
-- run is one rolled-back transaction; raises on failure, NOTICEs on success.
-- ============================================================================

begin;

do $$
declare
  refused boolean := false;
  target text;
begin
  -- 1. The schedule exists, daily, calling the invoker with this family.
  if not exists (
    select 1 from cron.job
    where jobname = 'drvn-listing-import-sweep'
      and schedule = '37 3 * * *'
      and active
      and command like '%invoke_remediation_worker(''listing-imports'')%'
  ) then
    raise exception 'drvn-listing-import-sweep is not scheduled daily against listing-imports';
  end if;
  if (select count(*) from cron.job where jobname = 'drvn-listing-import-sweep') <> 1 then
    raise exception 'drvn-listing-import-sweep must be scheduled exactly once';
  end if;
  raise notice 'PASS: listing-import sweep scheduled once, daily';

  -- 2. The media-gc job it sits beside is unchanged.
  if not exists (
    select 1 from cron.job
    where jobname = 'drvn-media-gc'
      and command like '%invoke_remediation_worker(''media-gc'')%'
  ) then
    raise exception 'drvn-media-gc schedule changed';
  end if;
  raise notice 'PASS: media-gc schedule intact';

  -- 3. The invoker accepts the family. With no worker URL configured it
  --    returns quietly — the allowlist is checked first, so reaching that
  --    return proves the family is allowed.
  delete from public.job_config where key in ('transfer_worker_url', 'transfer_worker_secret');
  perform public.invoke_remediation_worker('listing-imports');
  begin
    perform public.invoke_remediation_worker('listing-import');
  exception when others then
    refused := sqlerrm = 'Unknown worker family';
  end;
  if not refused then
    raise exception 'invoke_remediation_worker must still refuse unknown families';
  end if;
  raise notice 'PASS: listing-imports allowed, unknown families refused';

  -- 4. With pg_net present, the request goes to the sweep's own route.
  if to_regclass('net.http_request_queue') is not null then
    insert into public.job_config (key, value) values
      ('transfer_worker_url', 'https://guard.example/api/jobs/transfers'),
      ('transfer_worker_secret', 'guard-secret-guard-secret-guard-secret');
    perform public.invoke_remediation_worker('listing-imports');
    execute 'select url from net.http_request_queue order by id desc limit 1' into target;
    if target is distinct from 'https://guard.example/api/jobs/listing-imports' then
      raise exception 'listing-imports invoked the wrong URL: %', target;
    end if;
    raise notice 'PASS: invoker targets /api/jobs/listing-imports';
  else
    raise notice 'SKIP: pg_net absent — URL derivation not exercised';
  end if;

  -- 5. Worker health watches the sweep.
  if (
    select count(*) from jsonb_array_elements(public.worker_health_snapshot()->'families') f
    where f->>'family' = 'listingImports' and (f->>'budget_seconds')::numeric = 26 * 3600
  ) <> 1 then
    raise exception 'worker health must report listingImports once on a 26-hour budget';
  end if;
  raise notice 'PASS: listingImports reported by worker health';

  -- 6. The invoker is not callable by API roles.
  if has_function_privilege('anon', 'public.invoke_remediation_worker(text)', 'execute')
     or has_function_privilege('authenticated', 'public.invoke_remediation_worker(text)', 'execute') then
    raise exception 'invoke_remediation_worker must not be executable by API roles';
  end if;
  raise notice 'PASS: invoker closed to anon and authenticated';

  raise notice 'all listing-import-sweep checks passed';
end $$;

rollback;
