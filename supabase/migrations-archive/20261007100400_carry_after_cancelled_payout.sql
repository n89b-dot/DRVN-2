-- 20261007100400 — carry-forward: a refund after a cancelled payout, and
-- reservations that don't bind.
--
-- 1. A further refund after a cancelled payout wasn't carried.
--    When refunds and label costs together use up a seller's share, the
--    worker cancels the payout and carry_on_transfer_intent_status records
--    the shortfall once ('uncollected'): share left after refunds + labels,
--    when below zero. The ledger is then kept in step by events — a label
--    added or voided later is its own entry — but a later *refund* was not
--    one of them. It removes more of the share the labels were set against,
--    yet the intent's status doesn't change again (no trigger) and there is
--    no transfer to reverse (no reversal, no shortfall).
--      $100 order, $10 fee, $12 of labels. $90 refunded: 900 of share left,
--      payout cancelled, 300 owed. The last $10 refunded: all 1200 of labels
--      is now uncovered, and still only 300 was owed.
--    settle_refund_operation now records the difference. If the cancelled
--    payout later turns out to have gone through (the in-flight case), the
--    trigger takes back every 'uncollected' entry of the order, not only the
--    first.
--
-- 2. A carry amount frozen on a transfer that never reached dispatch kept
--    the debt reserved. freeze_transfer_carry writes dispatch_carry_cents
--    before the dispatch is prepared; if the attempt stopped there (seller
--    not payable yet, an error, max attempts) the intent went back to
--    holding/failed still carrying the number, and
--    seller_carry_available_cents subtracted it from what every other
--    transfer of that seller could collect — for as long as that intent sat.
--    Nothing was promised to Stripe at that point and the next attempt
--    re-decides the amount, so it reserves nothing. A dispatch that was
--    prepared (or may have reached Stripe) still reserves until it resolves:
--    that transfer really did keep the money back.
--
-- settle_refund_operation is restated from 20261007100000,
-- carry_on_transfer_intent_status and seller_carry_available_cents from
-- 20261005110100; only the lines marked 20261007100400 changed. Idempotent.

begin;

create or replace function public.seller_carry_available_cents(p_seller uuid, p_except_order uuid)
returns int
language sql
stable
set search_path = public, pg_temp
as $$
  select greatest(0,
    -coalesce((select sum(e.amount_cents) from public.seller_carry_entries e where e.seller_id = p_seller), 0)
    - coalesce((
        select sum(ti.dispatch_carry_cents) from public.transfer_intents ti
         where ti.seller_id = p_seller
           and ti.order_id is distinct from p_except_order
           and ti.dispatch_carry_cents > 0
           -- 20261007100400: only a reservation that binds. Until a dispatch
           -- is prepared (operation_key) nothing has been promised to
           -- Stripe and freeze_transfer_carry re-decides the amount on the
           -- next attempt, so an amount left on an intent that fell back to
           -- holding or failed before then reserves nothing; the one worker
           -- between its freeze and its dispatch is 'processing'.
           and (ti.status = 'processing'
                or ti.operation_key is not null
                or ti.provider_call_may_have_occurred)
           and (ti.status not in ('transferred', 'cancelled')
                or (ti.status = 'cancelled' and ti.provider_call_may_have_occurred))
      ), 0)
  )::int;
$$;

revoke all on function public.seller_carry_available_cents(uuid, uuid) from public, anon, authenticated;
grant execute on function public.seller_carry_available_cents(uuid, uuid) to service_role;

create or replace function public.carry_on_transfer_intent_status()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_order record;
  v_adjustments int;
  v_net int;
  v_previous int;
  v_seller uuid;
begin
  if new.status is not distinct from old.status then
    return null;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('seller-carry-order:' || new.order_id::text, 0));
  select seller_id, total_cents, refunded_cents into v_order from public.orders where id = new.order_id;
  v_seller := coalesce(new.seller_id, v_order.seller_id);

  if new.status = 'cancelled' and v_order.total_cents is not null then
    -- The same payable arithmetic as the transfer worker and
    -- complete_transfer_intent: share less the refund's share, plus labels.
    select coalesce(sum(amount_cents), 0)::int into v_adjustments
      from public.seller_adjustments
     where order_id = new.order_id and voided_at is null;
    v_net := new.amount_cents
      - case
          when v_order.total_cents <= 0 or new.amount_cents <= 0 then 0
          else least(new.amount_cents,
            round((v_order.refunded_cents::numeric * new.amount_cents) / v_order.total_cents)::int)
        end
      + v_adjustments;
    if v_net < 0 then
      perform public.record_seller_carry(v_seller, 'uncollected', v_net, new.order_id, null,
        'uncollected:' || new.order_id::text);
    end if;
  elsif old.status = 'cancelled' then
    -- 20261007100400: every 'uncollected' entry of the order — the one made
    -- at cancellation and any a later refund added — not only the first.
    select coalesce(sum(amount_cents), 0)::int into v_previous
      from public.seller_carry_entries
     where order_id = new.order_id and kind = 'uncollected';
    if v_previous <> 0 then
      perform public.record_seller_carry(v_seller, 'uncollected_reversed', -v_previous, new.order_id, null,
        'uncollected-reversed:' || new.order_id::text);
    end if;
  end if;

  if new.status = 'transferred' and coalesce(new.dispatch_carry_cents, 0) > 0 then
    perform public.record_seller_carry(v_seller, 'collected', new.dispatch_carry_cents, new.order_id, null,
      'collected:' || new.order_id::text);
  end if;
  return null;
end;
$$;

CREATE OR REPLACE FUNCTION public.settle_refund_operation(p_operation_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_op        public.refund_operations;
  v_order     record;
  v_payment   record;
  v_before    int;
  v_after     int;
  v_fully     boolean;
  v_transfer  int;   -- seller share of the order (total − fee)
  v_rev_due   int;
  v_fee_after int;
  v_next      text;
  -- 20261005110100
  v_sent      int;
  v_seller    uuid;
  v_cap       int;
  v_shortfall int := 0;
  -- 20261007100000
  v_share_delta int;
  v_reversed  int;
  -- 20261007100400
  v_closed      record;
  v_adjustments int;
  v_net_before  int;
  v_net_after   int;
begin
  select * into v_op from public.refund_operations
    where id = p_operation_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'Operation not found.');
  end if;
  if v_op.status not in ('provider_succeeded', 'effects_pending') then
    return jsonb_build_object('ok', true, 'already', true, 'status', v_op.status,
      'reversal_due_cents', coalesce(v_op.reversal_due_cents, 0),
      'fee_refunded_delta', 0);
  end if;

  select id, status, total_cents, platform_fee_cents, refunded_cents,
         platform_fee_refunded_cents, transfer_reference, pre_dispute_status,
         currency
    into v_order
    from public.orders where id = v_op.order_id
    for update;

  v_before := v_order.refunded_cents;
  v_after  := least(v_before + v_op.amount_cents, v_order.total_cents);
  v_fully  := v_after >= v_order.total_cents;

  -- Seller reversal owed, cumulative-deterministic (matches
  -- reversalShareCents in lib/payments/refunds.ts).
  v_transfer := v_order.total_cents - v_order.platform_fee_cents;
  -- 20261005110100: a transfer can't be reversed by more than was sent. Label
  -- costs and carried-forward charges came off the transfer, so the share can
  -- exceed it; Stripe refused that reversal and it sat in recovery. The
  -- reversal is now capped at the amount sent, and what the cap leaves
  -- unreversed is exactly the charges that transfer had collected — they go
  -- back on the seller's carry-forward balance (seller_carry_entries).
  -- Transfers sent before dispatch amounts were recorded keep the old rule.
  --
  -- 20261007100000: the cap is on what is still reversible — the amount sent
  -- less what earlier refunds of this order already took back — not on the
  -- cumulative refund share. A refund made before the transfer was never
  -- reversed (the transfer was simply sent smaller), so counting its share
  -- against the cap cancelled the reversal of every later refund by that
  -- much: $50 of a $100 order refunded before payout, $50 after, reversed
  -- nothing and left the seller holding $45 of a fully refunded order.
  select ti.dispatch_amount_cents, ti.seller_id into v_sent, v_seller
    from public.transfer_intents ti
   where ti.order_id = v_op.order_id
     and ti.status = 'transferred'
     and ti.transfer_reference is not distinct from v_order.transfer_reference;
  v_cap := least(v_transfer, coalesce(v_sent, v_transfer));
  if v_order.transfer_reference is not null and v_transfer > 0 and v_order.total_cents > 0 then
    v_share_delta := least(v_transfer, round((v_after::numeric * v_transfer) / v_order.total_cents))
                   - least(v_transfer, round((v_before::numeric * v_transfer) / v_order.total_cents));
    if v_sent is null then
      v_rev_due := v_share_delta;
    else
      select coalesce(sum(ro.reversal_due_cents), 0) into v_reversed
        from public.refund_operations ro
       where ro.order_id = v_op.order_id and ro.id <> p_operation_id;
      v_rev_due := least(v_share_delta, greatest(v_cap - v_reversed, 0));
    end if;
    v_shortfall := v_share_delta - v_rev_due;
  else
    v_rev_due := 0;
  end if;

  v_fee_after := least(v_order.platform_fee_cents,
    round((v_after::numeric * v_order.platform_fee_cents) / greatest(v_order.total_cents, 1)));

  update public.orders o
  set refunded_cents = v_after,
      platform_fee_refunded_cents = v_fee_after,
      refunded_at = now(),
      status = case when v_op.purpose = 'late_capture' then o.status when v_fully then 'refunded'
                    when v_op.resolve_dispute and o.status = 'disputed'
                      then coalesce(v_order.pre_dispute_status, 'delivered')
                    else o.status end,
      cancelled_at = case when v_fully then now() else o.cancelled_at end,
      cancel_reason = case when v_fully then left(v_op.reason, 500) else o.cancel_reason end,
      dispute_resolved_at = case when v_op.resolve_dispute and o.status = 'disputed'
                                 then now() else o.dispute_resolved_at end,
      refund_offer_cents = case when v_op.resolve_dispute and o.status = 'disputed'
                                then null else o.refund_offer_cents end,
      refund_offered_at = case when v_op.resolve_dispute and o.status = 'disputed'
                               then null else o.refund_offered_at end,
      dispute_outcome = case when v_op.resolve_dispute and o.status = 'disputed'
                             then v_op.dispute_outcome else o.dispute_outcome end
  where o.id = v_op.order_id;

  select id, amount_cents, refunded_cents into v_payment
    from public.payments where order_id = v_op.order_id
    limit 1;
  if found then
    update public.payments
    set refunded_cents = coalesce(v_payment.refunded_cents, 0) + v_op.amount_cents,
        status = case when coalesce(v_payment.refunded_cents, 0) + v_op.amount_cents
                           >= v_payment.amount_cents
                      then 'refunded' else 'partially_refunded' end
    where id = v_payment.id;
  end if;

  -- 20261007100400: a payout that was ALREADY cancelled — its label costs had
  -- used up what the earlier refunds left of the seller's share — recorded
  -- what the seller owed at that moment (carry_on_transfer_intent_status,
  -- 'uncollected'). A later refund takes away more of that share, so more of
  -- the same label costs is uncovered; nothing recorded it, because the
  -- intent's status no longer changes and there is no transfer to reverse.
  -- Record the difference, with the same arithmetic as that trigger: the
  -- seller's position on the order (share left after refunds, plus live
  -- adjustments), counted only where it is below zero. Read before the
  -- cancellation below, so a payout this very refund cancels is left to the
  -- trigger, which already sees the new refunded amount.
  select ti.amount_cents, ti.seller_id into v_closed
    from public.transfer_intents ti
   where ti.order_id = v_op.order_id
     and ti.status = 'cancelled'
     and ti.transfer_reference is null;
  if found and v_order.transfer_reference is null
     and v_order.total_cents > 0 and v_closed.amount_cents > 0 then
    perform pg_advisory_xact_lock(hashtextextended('seller-carry-order:' || v_op.order_id::text, 0));
    select coalesce(sum(amount_cents), 0)::int into v_adjustments
      from public.seller_adjustments
     where order_id = v_op.order_id and voided_at is null;
    v_net_before := v_closed.amount_cents
      - least(v_closed.amount_cents, round((v_before::numeric * v_closed.amount_cents) / v_order.total_cents)::int)
      + v_adjustments;
    v_net_after := v_closed.amount_cents
      - least(v_closed.amount_cents, round((v_after::numeric * v_closed.amount_cents) / v_order.total_cents)::int)
      + v_adjustments;
    if least(v_net_after, 0) < least(v_net_before, 0) then
      perform public.record_seller_carry(
        coalesce(v_closed.seller_id, (select o.seller_id from public.orders o where o.id = v_op.order_id)),
        'uncollected', least(v_net_after, 0) - least(v_net_before, 0), v_op.order_id, null,
        'uncollected:' || v_op.order_id::text || ':refund:' || p_operation_id::text);
    end if;
  end if;

  if v_fully then
    update public.transfer_intents
    set status = 'cancelled', last_error = 'order fully refunded', updated_at = now()
    where order_id = v_op.order_id
      and status in ('holding', 'ready', 'blocked_unpayable', 'failed', 'processing');
  end if;

  -- 20261005110100
  if v_shortfall > 0 then
    perform public.record_seller_carry(
      v_seller, 'reversal_shortfall', -v_shortfall, v_op.order_id, null,
      'reversal-shortfall:' || p_operation_id::text);
  end if;

  v_next := case when v_rev_due > 0 then 'reversal_pending' else 'completed' end;

  update public.refund_operations
  set status = v_next,
      reversal_due_cents = v_rev_due,
      effects_completed_at = now(),
      reversal_completed_at = case when v_rev_due > 0 then null else now() end,
      updated_at = now()
  where id = p_operation_id;

  return jsonb_build_object('ok', true, 'already', false, 'status', v_next,
    'reversal_due_cents', v_rev_due,
    'transfer_reference', v_order.transfer_reference,
    'fully_refunded', v_fully,
    'refunded_after_cents', v_after,
    'fee_refunded_delta', v_fee_after - v_order.platform_fee_refunded_cents);
end;
$function$;

revoke all on function public.settle_refund_operation(uuid) from public, anon, authenticated;
grant execute on function public.settle_refund_operation(uuid) to service_role;

notify pgrst, 'reload schema';

commit;
