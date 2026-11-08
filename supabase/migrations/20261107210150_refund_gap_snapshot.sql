-- 20261107210150 — the charge.refunded gap from one snapshot (OS-W20
-- follow-up to #91, from the post-merge review).
--
-- applyChargeRefund (src/lib/payments/settlement.ts) opens an "unattributed
-- refund" case for refunded cents Stripe reports succeeded that the ledger
-- neither booked nor is still booking. It read the booked total
-- (payments.refunded_cents) and the operations still booking
-- (refund_operations) in two requests. A refund settling between them
-- (settle_refund_operation books refunded_cents and completes its operation
-- in one transaction) was in neither: the stale booked total missed it and
-- the later operation read no longer counted it in flight, so a normal $30
-- refund opened a false $30 case.
--
-- refund_gap_snapshot reads both in ONE statement, so one snapshot: every
-- refund is either booked or still in flight, never neither. The app opens a
-- case only on this result. Read-only; nothing about refunds changes.

begin;

create or replace function public.refund_gap_snapshot(p_payment_reference text, p_refund_references text[])
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'payments', (select count(*) from public.payments where provider_reference = p_payment_reference),
    'booked_cents', (select coalesce(sum(refunded_cents), 0) from public.payments
                     where provider_reference = p_payment_reference),
    -- Same rule as before: an operation for one of these refunds whose money
    -- isn't in refunded_cents yet and that the refund state machine still
    -- drives.
    'in_flight_cents', (select coalesce(sum(amount_cents), 0) from public.refund_operations
                        where refund_reference = any(coalesce(p_refund_references, '{}'))
                          and effects_completed_at is null
                          and status in ('requested', 'provider_pending', 'provider_succeeded', 'effects_pending'))
  );
$$;
revoke all on function public.refund_gap_snapshot(text, text[]) from public, anon, authenticated;
grant execute on function public.refund_gap_snapshot(text, text[]) to service_role;

notify pgrst, 'reload schema';
commit;
