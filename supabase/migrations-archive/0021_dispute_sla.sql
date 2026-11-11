-- ============================================================================
-- 0021 — Dispute SLA: nothing strands (Rev E item 12)
--
-- A dispute the seller ignores used to sit open forever with the money
-- already moved. Two-stage, mirroring 0020's shape:
--
--   Day 4 (SLA)   escalate_stale_disputes() — pure SQL, daily cron — notifies
--                 both parties that the case is now flagged for DRVN support,
--                 stamps dispute_escalated_at (once), and the console's
--                 dispute queue shows it over-SLA (it already does, derived
--                 from disputed_at).
--   Day 10        the app-side sweeper (processDisputeSla, run by the same
--                 worker endpoint/manual-run as transfers) auto-refunds
--                 disputes where the seller has stayed silent — no refund
--                 offer outstanding — through the one refund path, so the
--                 reversal/fee logic all applies. An admin action before day
--                 10 naturally prevents it (the order leaves `disputed`).
--
-- Idempotent: safe to re-run.
-- ============================================================================

begin;

alter table public.orders
  add column if not exists dispute_escalated_at timestamptz;

create or replace function public.escalate_stale_disputes()
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count int := 0;
  r record;
begin
  for r in
    select id, buyer_id, seller_id
    from public.orders
    where status = 'disputed'
      and dispute_escalated_at is null
      and disputed_at < now() - interval '4 days'
  loop
    update public.orders set dispute_escalated_at = now() where id = r.id;

    if r.seller_id is not null then
      perform public.notify(
        r.seller_id, 'dispute_escalated', 'marketplace',
        'A dispute needs your reply',
        'This case is past the response window and is now flagged for DRVN support. '
          || 'Unanswered disputes are refunded to the buyer automatically.',
        '/orders/' || r.id, null
      );
    end if;
    if r.buyer_id is not null then
      perform public.notify(
        r.buyer_id, 'dispute_escalated', 'marketplace',
        'Your dispute was escalated',
        'The seller has not responded in time — DRVN support is now watching this case.',
        '/orders/' || r.id, null
      );
    end if;

    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

do $$
declare
  j record;
begin
  for j in select jobid from cron.job where jobname = 'drvn-dispute-sla'
  loop
    perform cron.unschedule(j.jobid);
  end loop;
end $$;

-- Daily at 08:05 — an escalation notice is a morning thing, not a 3am one.
select cron.schedule(
  'drvn-dispute-sla',
  '5 8 * * *',
  $job$ select public.escalate_stale_disputes(); $job$
);

do $$
begin
  if not exists (select 1 from cron.job where jobname = 'drvn-dispute-sla') then
    raise exception 'SELF-CHECK FAILED: dispute SLA job not scheduled';
  end if;
  raise notice 'PASS: 0021 self-checks';
end $$;

commit;
