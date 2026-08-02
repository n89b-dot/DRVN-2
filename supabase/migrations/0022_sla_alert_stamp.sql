-- ============================================================================
-- 0022 — SLA alert stamp (console audit follow-up: push alerting)
--
-- The console's queues were pull-only: a dispute crossing the 4-day SLA was
-- only discovered when someone loaded the page. The app worker now posts a
-- webhook alert (ADMIN_ALERT_WEBHOOK_URL) for each newly-breached dispute;
-- this column is its once-only marker, mirroring 0021's
-- dispute_escalated_at (which marks the PARTY notification, a different
-- audience on a different channel — the two stamps stay separate so either
-- mechanism can be re-run or disabled without confusing the other).
--
-- Idempotent: safe to re-run.
-- ============================================================================

begin;

alter table public.orders
  add column if not exists dispute_sla_alerted_at timestamptz;

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'orders'
      and column_name = 'dispute_sla_alerted_at'
  ) then
    raise exception 'SELF-CHECK FAILED: dispute_sla_alerted_at missing';
  end if;
  raise notice 'PASS: 0022 self-checks';
end $$;

commit;
