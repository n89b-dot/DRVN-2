-- 20261007100000 — a refund after the payout reverses what is still reversible.
--
-- settle_refund_operation (latest: 20261005110100) caps a transfer reversal
-- at the amount the transfer sent, because label costs and carried-forward
-- charges come off the transfer and Stripe refuses a larger reversal. That
-- cap was applied to the order's *cumulative* refund share:
--
--   least(cap, share(after)) − least(cap, share(before))
--
-- which is right only when nothing was refunded before the transfer. A
-- refund that came first is never reversed — the worker sends the transfer
-- already reduced by its share — yet its share was counted against the cap,
-- so each later refund reversed that much too little, and the difference was
-- booked as a carry-forward debt collectable only from a future sale.
--   $100 order, $10 fee: $50 refunded before payout → $45 sent. The other
--   $50 refunded after → reversal 0, shortfall 4500. The seller kept $45 of a
--   fully refunded order.
--
-- The cap is now on what remains reversible: the amount sent, less the
-- reversals earlier refunds of the same order already asked for. Each refund
-- reverses least(its own share, what is left of the transfer); only what the
-- transfer truly could not return — the charges it had collected — is owed
-- again. With no refund before the transfer the result is unchanged.
--
-- Changed: the two declarations and the reversal block marked 20261007100000.
-- Everything else is restated as it was. Idempotent.

begin;

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
