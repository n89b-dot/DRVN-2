-- ============================================================================
-- 0013 — Scheduled jobs
--
-- 0007 shipped release_expired_reservations() and prune_rate_limits() as
-- functions and scheduled neither, which is why C1 (reservations never
-- released) was a live inventory leak rather than a theoretical one. A
-- function nothing calls is documentation, not behaviour.
--
-- Requires pg_cron. On Supabase the extension lives in the `cron` schema and
-- jobs run as the database owner against the `postgres` database.
--
-- Idempotent: safe to re-run.
-- ============================================================================

begin;

create extension if not exists pg_cron;

-- Unschedule first so re-running doesn't stack duplicate jobs.
do $$
declare
  j record;
begin
  for j in select jobid from cron.job where jobname in ('drvn-release-reservations', 'drvn-prune-rate-limits')
  loop
    perform cron.unschedule(j.jobid);
  end loop;
end $$;

-- Every 5 minutes: free listings whose checkout was abandoned, cancel the
-- stranded order, fail its payment, and expire lapsed offers. The reservation
-- window is 15 minutes, so a listing is unbuyable for at most ~20.
select cron.schedule(
  'drvn-release-reservations',
  '*/5 * * * *',
  $job$ select public.release_expired_reservations(); $job$
);

-- Daily at 03:15: drop rate-limit counters older than a day.
select cron.schedule(
  'drvn-prune-rate-limits',
  '15 3 * * *',
  $job$ select public.prune_rate_limits(); $job$
);

commit;
