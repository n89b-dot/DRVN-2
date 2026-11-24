-- ============================================================================
-- 20261124180000 — refunds and checkout take their locks in one order
--
-- Two refund paths locked the same two rows in opposite orders.
-- begin_refund_replacement and claim_refund_replacement_provider lock the
-- order, then the refund operation. settle_refund_operation and
-- record_refund_provider_event locked the operation, then the order; and
-- hold_refund_reversal locked the operation and then wrote rows that name the
-- order, which takes a lock on it. A replacement started while a settlement,
-- a Stripe refund event or a reversal hold for the same refund was in flight
-- could leave each holding the lock the other needed, and Postgres ends that
-- by cancelling one of them ("deadlock detected") on a money path.
--
--   * public.settle_refund_operation, public.record_refund_provider_event,
--     public.hold_refund_reversal: lock the order first. The operation is
--     read unlocked only to learn its order, then read again under its own
--     lock, the pattern claim_refund_replacement_provider already uses.
--     Nothing else in them changed.
--   * public.purchase_begin: the parts of a basket are locked in id order
--     before they are reserved, so two baskets that share parts wait for each
--     other in one order. The claimed rows are kept in a variable in place of
--     a temporary table created and dropped on every checkout. What a
--     checkout reserves, charges and returns is unchanged.
--
-- No data is changed. supabase/tests/lock_order_guard.sql proves the order
-- from the definitions and with two sessions.
-- ============================================================================

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
  -- 20261107130000
  v_exhausted   int;
  v_adjustments int;
  v_net_before  int;
  v_net_after   int;
  -- 20261124180000
  v_lock_order  uuid;
begin
  -- 20261124180000: the order's lock is taken before the operation's, the
  -- order begin_refund_replacement and claim_refund_replacement_provider
  -- already use. This function took the operation first, so a settlement and
  -- a replacement of the same refund each held the lock the other needed.
  -- The operation is read unlocked only to learn its order (which never
  -- changes), and read again under its own lock below.
  select order_id into v_lock_order from public.refund_operations where id = p_operation_id;
  if v_lock_order is not null then
    perform 1 from public.orders where id = v_lock_order for update;
  end if;
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
    -- 20261107130000: only a payout Stripe was never called for is cancelled
    -- outright. One whose call may have happened (a crashed or in-flight
    -- request) could still produce a transfer, and a cancelled row is never
    -- claimed again, so it goes to the worker's reconciliation shelf instead,
    -- due now, with any lease ended (an in-flight owner can then neither
    -- prepare nor overwrite it). The worker records a transfer it finds,
    -- with a 'transfer_after_refund' case for an operator to decide on a
    -- reversal, and cancels the payout itself once its attempt budget has
    -- found none. One whose attempt budget is already spent (the worker's
    -- 8; claim_transfer_intents would never admit it again) stays with the
    -- operator instead: 'failed', its case open, with a note of the refund.
    update public.transfer_intents
    set status = 'cancelled', last_error = 'order fully refunded', updated_at = now()
    where order_id = v_op.order_id
      and status in ('holding', 'ready', 'blocked_unpayable', 'failed', 'processing')
      and not provider_call_may_have_occurred;
    update public.transfer_intents
    set status = 'holding',
        next_attempt_at = now(),
        last_error = 'order fully refunded; reconciling a possible Stripe transfer',
        locked_at = null,
        locked_by = null,
        lease_expires_at = null,
        updated_at = now()
    where order_id = v_op.order_id
      and status in ('holding', 'ready', 'blocked_unpayable', 'failed', 'processing')
      and provider_call_may_have_occurred
      and attempts < 8;
    update public.transfer_intents
    set status = 'failed',
        next_attempt_at = null,
        last_error = left('order fully refunded; ' || coalesce(last_error, ''), 500),
        locked_at = null,
        locked_by = null,
        lease_expires_at = null,
        updated_at = now()
    where order_id = v_op.order_id
      and status in ('holding', 'ready', 'blocked_unpayable', 'failed', 'processing')
      and provider_call_may_have_occurred
      and attempts >= 8
    returning coalesce(dispatch_amount_cents, amount_cents) into v_exhausted;
    if found then
      insert into public.payment_recoveries (order_id, kind, recovery_key, amount_cents, detail)
      values (
        v_op.order_id, 'transfer_unresolved', 'transfer-unresolved:' || v_op.order_id::text, v_exhausted,
        'The order was fully refunded while this seller transfer was unresolved (Stripe may have been called); check Stripe before closing.'
      )
      on conflict (recovery_key) do update
      set detail = left('The order was fully refunded while this seller transfer was unresolved; check Stripe before closing. '
                        || coalesce(public.payment_recoveries.detail, ''), 1000),
          last_seen_at = now(), status = 'open',
          resolved_by = null, resolved_at = null, resolution_note = null;
    end if;
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

CREATE OR REPLACE FUNCTION public.hold_refund_reversal(p_operation uuid, p_worker text, p_operation_key text, p_detail text, p_next_attempt_at timestamp with time zone)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_op public.refund_operations;
  v_recovery uuid;
  -- 20261124180000
  v_lock_order uuid;
begin
  if nullif(p_detail, '') is null then raise exception 'Reversal recovery detail is required'; end if;
  -- 20261124180000: order first, then the operation. The recovery case and
  -- the alert below each name the order, and a row that references an order
  -- takes a lock on it; taken after the operation's, that was the opposite
  -- of every function that locks the order first.
  select order_id into v_lock_order from public.refund_operations where id = p_operation;
  if v_lock_order is not null then
    perform 1 from public.orders where id = v_lock_order for update;
  end if;
  select * into v_op
  from public.refund_operations
  where id = p_operation
  for update;
  if not found
     or v_op.status <> 'reversal_pending'
     or v_op.reversal_locked_by <> p_worker
     or v_op.reversal_operation_key <> p_operation_key
     or not v_op.reversal_call_may_have_occurred then
    return null;
  end if;

  insert into public.payment_recoveries (
    order_id, kind, recovery_key, amount_cents, detail
  ) values (
    v_op.order_id,
    'reversal_failed',
    'reversal-failed:' || p_operation::text,
    v_op.reversal_amount_cents,
    left(p_detail, 2000)
  )
  on conflict (recovery_key) do update
  set last_seen_at = now(),
      amount_cents = excluded.amount_cents,
      detail = excluded.detail,
      status = 'open',
      resolved_by = null,
      resolved_at = null,
      resolution_note = null
  returning id into v_recovery;

  insert into public.admin_alert_outbox (
    kind, title, detail, order_id, amount_cents, payload, dedup_key, status
  ) values (
    'recovery_case_opened',
    'Transfer reversal requires reconciliation',
    left(p_detail, 2000),
    v_op.order_id,
    v_op.reversal_amount_cents,
    jsonb_build_object('operation_id', p_operation, 'recovery_id', v_recovery),
    'reversal-failed:' || p_operation::text,
    'pending'
  ) on conflict (dedup_key) do nothing;

  update public.refund_operations
  set recovery_id = v_recovery,
      attempts = attempts + 1,
      next_attempt_at = p_next_attempt_at,
      last_error = left(p_detail, 500),
      reversal_locked_by = null,
      reversal_lease_expires_at = null,
      updated_at = now()
  where id = p_operation;
  return v_recovery;
end;
$function$;

CREATE OR REPLACE FUNCTION public.record_refund_provider_event(p_event_id text, p_refund_reference text, p_operation_id uuid, p_order_id uuid, p_payment_reference text, p_amount_cents integer, p_currency text, p_provider_status text, p_provider_created_at timestamp with time zone, p_balance_transaction text DEFAULT NULL::text, p_failure_balance_transaction text DEFAULT NULL::text, p_failure_reason text DEFAULT NULL::text, p_pending_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_op public.refund_operations;
  v_order public.orders;
  v_payment public.payments;
  v_existing_event public.refund_provider_events;
  v_inflight int;
  v_remaining int;
  v_after int;
  v_fee_after int;
  v_fee_restore int;
  v_seller_recredit int;
  v_recovery_id uuid;
  v_adjustment_id uuid;
  v_known_order uuid;
  -- 20261124180000
  v_lock_order uuid;
begin
  if p_event_id is null or length(p_event_id) < 3
     or p_refund_reference is null or length(p_refund_reference) < 3
     or p_amount_cents is null or p_amount_cents <= 0
     or p_currency is null or p_provider_created_at is null
     or p_provider_status is null
     or p_provider_status not in ('pending','requires_action','succeeded','failed','canceled','unknown') then
    raise exception 'Invalid refund provider event';
  end if;

  -- 20261010100000: the order a refund names is provider metadata and may not
  -- exist here. Only an order that does is stored in an order_id column; the
  -- reported value is kept as reported_order_id either way.
  select id into v_known_order from public.orders where id = p_order_id;

  select * into v_existing_event
  from public.refund_provider_events where event_id = p_event_id;
  if found then
    if v_existing_event.refund_reference <> p_refund_reference
       or v_existing_event.payment_reference is distinct from p_payment_reference
       or v_existing_event.amount_cents <> p_amount_cents
       or lower(v_existing_event.currency) <> lower(p_currency)
       or v_existing_event.provider_status <> p_provider_status
       or v_existing_event.provider_created_at <> p_provider_created_at
       or v_existing_event.balance_transaction is distinct from p_balance_transaction
       or v_existing_event.failure_balance_transaction is distinct from p_failure_balance_transaction
       or v_existing_event.failure_reason is distinct from p_failure_reason
       or v_existing_event.reported_operation_id is distinct from p_operation_id
       or v_existing_event.reported_order_id is distinct from p_order_id then
      raise exception 'Refund event replay payload changed';
    end if;
    if v_existing_event.refund_operation_id is null then
      return jsonb_build_object('action','recovery_recorded','replayed',true);
    end if;
    select * into v_op from public.refund_operations
      where id = v_existing_event.refund_operation_id;
    if not found then raise exception 'Recorded refund event lost its operation'; end if;
    return jsonb_build_object(
      'action', case
        when v_op.provider_status in ('failed','canceled') or v_op.status = 'recovery_required'
          then 'recovery_recorded'
        when v_op.provider_status in ('pending','requires_action','unknown')
          then 'pending'
        when v_op.provider_status = 'succeeded'
             and v_op.status in ('provider_succeeded','effects_pending','reversal_pending')
          then 'settle'
        else 'committed'
      end,
      'operation_id', v_op.id,
      'replayed', true
    );
  end if;

  -- 20261124180000: order first, then the operation, as every other refund
  -- function does. The operation is read unlocked only to learn its order;
  -- where there is no operation yet, the order the provider named (if it is
  -- one of ours) is the order the branch below locks anyway.
  if p_operation_id is not null then
    select order_id into v_lock_order from public.refund_operations where id = p_operation_id;
  else
    select order_id into v_lock_order from public.refund_operations where refund_reference = p_refund_reference;
  end if;
  v_lock_order := coalesce(v_lock_order, v_known_order);
  if v_lock_order is not null then
    perform 1 from public.orders where id = v_lock_order for update;
  end if;

  if p_operation_id is not null then
    select * into v_op from public.refund_operations where id = p_operation_id for update;
  else
    select * into v_op from public.refund_operations
      where refund_reference = p_refund_reference for update;
  end if;

  if not found and p_operation_id is not null then
    insert into public.refund_provider_events(
      event_id,refund_reference,reported_operation_id,payment_reference,order_id,
      reported_order_id,amount_cents,currency,
      provider_status,provider_created_at,balance_transaction,
      failure_balance_transaction,failure_reason
    ) values (
      p_event_id,p_refund_reference,p_operation_id,p_payment_reference,v_known_order,
      p_order_id,p_amount_cents,p_currency,
      p_provider_status,p_provider_created_at,p_balance_transaction,
      p_failure_balance_transaction,p_failure_reason
    );
    insert into public.payment_recoveries(kind,recovery_key,order_id,amount_cents,detail)
    values(
      'refund_lifecycle_unresolved','refund-lifecycle:'||p_refund_reference,
      v_known_order,p_amount_cents,
      'Refund '||p_refund_reference||' references an unknown local operation.'
    )
    on conflict(recovery_key) do update set
      last_seen_at=now(), detail=excluded.detail, amount_cents=excluded.amount_cents,
      status='open', resolved_by=null, resolved_at=null, resolution_note=null;
    return jsonb_build_object('action','recovery_recorded','reason','unknown_operation');
  end if;

  if found then
    if v_op.payment_reference is distinct from p_payment_reference
       or v_op.amount_cents <> p_amount_cents
       or lower(v_op.currency) <> lower(p_currency)
       or (p_order_id is not null and v_op.order_id <> p_order_id)
       or not exists (
         select 1 from public.payments
         where order_id=v_op.order_id and provider_reference=p_payment_reference
       )
       or (v_op.refund_reference is not null and v_op.refund_reference <> p_refund_reference) then
      insert into public.refund_provider_events(
        event_id,refund_reference,reported_operation_id,payment_reference,order_id,
        reported_order_id,amount_cents,currency,
        provider_status,provider_created_at,balance_transaction,
        failure_balance_transaction,failure_reason
      ) values (
        p_event_id,p_refund_reference,p_operation_id,p_payment_reference,v_known_order,
        p_order_id,p_amount_cents,p_currency,
        p_provider_status,p_provider_created_at,p_balance_transaction,
        p_failure_balance_transaction,p_failure_reason
      );
      insert into public.payment_recoveries(kind,recovery_key,order_id,amount_cents,detail)
      values(
        'refund_lifecycle_unresolved','refund-lifecycle:'||p_refund_reference,
        v_known_order,p_amount_cents,
        'Refund '||p_refund_reference||' does not match the referenced local operation.'
      )
      on conflict(recovery_key) do update set
        last_seen_at=now(), detail=excluded.detail, amount_cents=excluded.amount_cents,
        status='open', resolved_by=null, resolved_at=null, resolution_note=null;
      return jsonb_build_object('action','recovery_recorded','reason','operation_mismatch');
    end if;
  else
    if v_known_order is null then
      insert into public.refund_provider_events(
        event_id,refund_reference,reported_operation_id,payment_reference,
        reported_order_id,amount_cents,currency,
        provider_status,provider_created_at,balance_transaction,
        failure_balance_transaction,failure_reason
      ) values (
        p_event_id,p_refund_reference,p_operation_id,p_payment_reference,
        p_order_id,p_amount_cents,p_currency,
        p_provider_status,p_provider_created_at,p_balance_transaction,
        p_failure_balance_transaction,p_failure_reason
      );
      insert into public.payment_recoveries(kind,recovery_key,amount_cents,detail)
      values(
        'refund_lifecycle_unresolved','refund-lifecycle:'||p_refund_reference,
        p_amount_cents,'Refund '||p_refund_reference||' has no safe local order attribution.'
      )
      on conflict(recovery_key) do update set
        last_seen_at=now(), detail=excluded.detail, amount_cents=excluded.amount_cents,
        status='open', resolved_by=null, resolved_at=null, resolution_note=null;
      return jsonb_build_object('action','recovery_recorded','reason','missing_mapping');
    end if;

    select * into v_order from public.orders where id = p_order_id for update;
    if not found then raise exception 'Refund order mapping disappeared'; end if;
    select * into v_payment from public.payments
      where order_id = p_order_id and provider_reference = p_payment_reference
      limit 1;
    if not found or lower(v_order.currency) <> lower(p_currency) then
      insert into public.refund_provider_events(
        event_id,refund_reference,reported_operation_id,payment_reference,order_id,
        reported_order_id,amount_cents,currency,
        provider_status,provider_created_at,balance_transaction,
        failure_balance_transaction,failure_reason
      ) values (
        p_event_id,p_refund_reference,p_operation_id,p_payment_reference,p_order_id,
        p_order_id,p_amount_cents,p_currency,
        p_provider_status,p_provider_created_at,p_balance_transaction,
        p_failure_balance_transaction,p_failure_reason
      );
      insert into public.payment_recoveries(kind,recovery_key,order_id,amount_cents,detail)
      values(
        'refund_lifecycle_unresolved','refund-lifecycle:'||p_refund_reference,
        p_order_id,p_amount_cents,
        'Refund '||p_refund_reference||' payment or currency does not match the local order.'
      )
      on conflict(recovery_key) do update set
        last_seen_at=now(), detail=excluded.detail, amount_cents=excluded.amount_cents,
        status='open', resolved_by=null, resolved_at=null, resolution_note=null;
      return jsonb_build_object('action','recovery_recorded','reason','payment_mismatch');
    end if;

    select coalesce(sum(amount_cents),0) into v_inflight
    from public.refund_operations
    where order_id=p_order_id and status in (
      'requested','provider_pending','provider_succeeded','effects_pending',
      'reversal_pending','recovery_required'
    )
    -- 20261007100200: only what is not yet in refunded_cents.
    and effects_completed_at is null;
    v_remaining := v_order.total_cents - v_order.refunded_cents - v_inflight;
    if p_amount_cents > v_remaining or exists(select 1 from public.payment_recoveries where order_id=p_order_id and kind='refund_late_failure' and status='open') then
      insert into public.refund_provider_events(
        event_id,refund_reference,reported_operation_id,payment_reference,order_id,
        reported_order_id,amount_cents,currency,
        provider_status,provider_created_at,balance_transaction,
        failure_balance_transaction,failure_reason
      ) values (
        p_event_id,p_refund_reference,p_operation_id,p_payment_reference,p_order_id,
        p_order_id,p_amount_cents,p_currency,
        p_provider_status,p_provider_created_at,p_balance_transaction,
        p_failure_balance_transaction,p_failure_reason
      );
      insert into public.payment_recoveries(kind,recovery_key,order_id,amount_cents,detail)
      values(
        'refund_lifecycle_unresolved','refund-lifecycle:'||p_refund_reference,
        p_order_id,p_amount_cents,
        'Refund '||p_refund_reference||' cannot be safely allocated: the unreserved balance is insufficient or a late-refund replacement recovery is open.'
      )
      on conflict(recovery_key) do update set
        last_seen_at=now(), detail=excluded.detail, amount_cents=excluded.amount_cents,
        status='open', resolved_by=null, resolved_at=null, resolution_note=null;
      return jsonb_build_object('action','recovery_recorded','reason','amount_mismatch');
    end if;

    insert into public.refund_operations(
      order_id,payment_reference,amount_cents,currency,remaining_before_cents,
      reason,requested_by,actor_role,idempotency_key,refund_reference,status,
      external,resolve_dispute,dispute_outcome,provider_status,
      provider_failure_reason,provider_balance_transaction,
      provider_failure_balance_transaction,provider_pending_reason,
      provider_event_created_at,provider_event_id
    ) values (
      p_order_id,p_payment_reference,p_amount_cents,v_order.currency,v_remaining,
      'Stripe refund '||p_refund_reference,'stripe:webhook','system',
      'stripe:external:'||p_refund_reference,p_refund_reference,
      case when p_provider_status='succeeded' then 'provider_succeeded'
           else 'provider_pending' end,
      true,true,'chargeback_lost',null,null,
      null,null,null,
      null,null
    ) returning * into v_op;
  end if;

  insert into public.refund_provider_events(
    event_id,refund_reference,refund_operation_id,reported_operation_id,payment_reference,order_id,
    reported_order_id,amount_cents,currency,provider_status,provider_created_at,balance_transaction,
    failure_balance_transaction,failure_reason
  ) values (
    p_event_id,p_refund_reference,v_op.id,p_operation_id,p_payment_reference,v_op.order_id,
    p_order_id,p_amount_cents,p_currency,p_provider_status,p_provider_created_at,
    p_balance_transaction,p_failure_balance_transaction,p_failure_reason
  );

  -- A terminal provider failure never regresses. Older callbacks are retained
  -- above, but do not change the current operation state.
  if v_op.provider_status in ('failed','canceled') then
    return jsonb_build_object('action','recovery_recorded','operation_id',v_op.id,'stale',true);
  end if;
  if v_op.provider_event_created_at is not null
     and p_provider_created_at < v_op.provider_event_created_at then
    return jsonb_build_object('action','committed','operation_id',v_op.id,'stale',true);
  end if;
  if v_op.provider_status='succeeded'
     and p_provider_status in ('pending','requires_action','unknown') then
    return jsonb_build_object('action','committed','operation_id',v_op.id,'stale',true);
  end if;

  if p_provider_status in ('pending','requires_action','unknown') then
    update public.refund_operations set
      refund_reference=p_refund_reference,
      provider_status=p_provider_status,
      provider_pending_reason=p_pending_reason,
      provider_balance_transaction=p_balance_transaction,
      provider_event_created_at=p_provider_created_at,
      provider_event_id=p_event_id,
      updated_at=now(),
      status=case when status in ('requested','provider_pending') then 'provider_pending' else status end
    where id=v_op.id;
    return jsonb_build_object('action','pending','operation_id',v_op.id);
  end if;

  if p_provider_status='succeeded' then
    update public.refund_operations set
      refund_reference=p_refund_reference,
      provider_status='succeeded',
      provider_pending_reason=null,
      provider_failure_reason=null,
      provider_balance_transaction=p_balance_transaction,
      provider_failure_balance_transaction=null,
      provider_completed_at=coalesce(provider_completed_at,now()),
      provider_event_created_at=p_provider_created_at,
      provider_event_id=p_event_id,
      updated_at=now(),
      status=case when status in ('requested','provider_pending') then 'provider_succeeded' else status end
    where id=v_op.id;
    return jsonb_build_object('action','settle','operation_id',v_op.id);
  end if;

  -- failed/canceled before local settlement: preserve the provider identity and
  -- release the reservation, but retain one visible obligation for the
  -- customer's unresolved refund.
  if v_op.effects_completed_at is null then
    insert into public.payment_recoveries(kind,recovery_key,order_id,amount_cents,detail)
    values(
      'refund_failed','refund-failed:'||p_refund_reference,v_op.order_id,v_op.amount_cents,
      'Refund '||p_refund_reference||' '||p_provider_status||': '||coalesce(p_failure_reason,'no reason supplied')
    )
    on conflict(recovery_key) do update set
      last_seen_at=now(), detail=excluded.detail, amount_cents=excluded.amount_cents,
      status='open', resolved_by=null, resolved_at=null, resolution_note=null
    returning id into v_recovery_id;
    update public.refund_operations set
      status='failed', refund_reference=p_refund_reference,
      provider_status=p_provider_status,
      provider_failure_reason=left(p_failure_reason,500),
      provider_balance_transaction=p_balance_transaction,
      provider_failure_balance_transaction=p_failure_balance_transaction,
      provider_event_created_at=p_provider_created_at,provider_event_id=p_event_id,
      recovery_id=v_recovery_id,last_error=left(coalesce(p_failure_reason,p_provider_status),500),
      updated_at=now()
    where id=v_op.id;
    return jsonb_build_object('action','recovery_recorded','operation_id',v_op.id);
  end if;

  -- succeeded -> failed: compensate the exact operation once. We intentionally
  -- preserve order workflow status because the pre-refund fulfillment state is
  -- not derivable from money counters; the recovery row is the operator's
  -- explicit instruction to repair that state after review.
  select * into v_order from public.orders where id=v_op.order_id for update;
  if v_order.refunded_cents < v_op.amount_cents then
    raise exception 'Late refund failure exceeds settled refund ledger';
  end if;
  v_after := v_order.refunded_cents - v_op.amount_cents;
  v_fee_after := least(v_order.platform_fee_cents,
    round((v_after::numeric * v_order.platform_fee_cents) / greatest(v_order.total_cents,1)));
  v_fee_restore := v_order.platform_fee_refunded_cents - v_fee_after;
  v_seller_recredit := case
    when v_op.reversal_reference is not null then coalesce(v_op.reversal_due_cents,0)
    when coalesce(v_op.reversal_due_cents,0)=0 then 0
    else null
  end;

  insert into public.refund_lifecycle_adjustments(
    refund_operation_id,refund_reference,event_id,kind,refund_amount_cents,
    fee_restore_cents,seller_recredit_cents,failure_balance_transaction
  ) values (
    v_op.id,p_refund_reference,p_event_id,'provider_failure_compensation',
    v_op.amount_cents,v_fee_restore,v_seller_recredit,p_failure_balance_transaction
  )
  on conflict(refund_operation_id,kind) do nothing
  returning id into v_adjustment_id;

  if v_adjustment_id is not null then
    update public.orders set
      refunded_cents=v_after,
      platform_fee_refunded_cents=v_fee_after
    where id=v_op.order_id;
    update public.payments set
      refunded_cents=refunded_cents-v_op.amount_cents,
      status=case when refunded_cents-v_op.amount_cents<=0 then 'succeeded'
                  else 'partially_refunded' end
    where order_id=v_op.order_id and refunded_cents>=v_op.amount_cents
    returning * into v_payment;
    if not found then raise exception 'Late refund failure payment ledger mismatch'; end if;
  end if;

  insert into public.payment_recoveries(kind,recovery_key,order_id,amount_cents,detail)
  values(
    'refund_late_failure','refund-late-failure:'||p_refund_reference,v_op.order_id,
    case when coalesce(v_seller_recredit,0)>0 then v_seller_recredit else v_op.amount_cents end,
    'Refund '||p_refund_reference||' failed after local settlement. Customer remains owed '
      ||v_op.amount_cents||' '||v_op.currency||'. Seller re-credit obligation: '
      ||case when v_seller_recredit is null
             then 'unknown until the in-flight reversal is reconciled.'
             else v_seller_recredit||' cents.' end
  )
  on conflict(recovery_key) do update set
    last_seen_at=now(), detail=excluded.detail, amount_cents=excluded.amount_cents,
    status='open', resolved_by=null, resolved_at=null, resolution_note=null
  returning id into v_recovery_id;

  update public.refund_operations set
    status='recovery_required',provider_status=p_provider_status,
    provider_failure_reason=left(p_failure_reason,500),
    provider_balance_transaction=p_balance_transaction,
    provider_failure_balance_transaction=p_failure_balance_transaction,
    provider_event_created_at=p_provider_created_at,provider_event_id=p_event_id,
    recovery_id=v_recovery_id,last_error='Provider refund failed after local settlement',
    updated_at=now()
  where id=v_op.id;
  return jsonb_build_object(
    'action','recovery_recorded','operation_id',v_op.id,
    'compensated',v_adjustment_id is not null,
    'seller_recredit_cents',v_seller_recredit
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.purchase_begin(p_buyer_id uuid, p_listing_ids uuid[], p_idempotency_key text DEFAULT NULL::text, p_reservation_window interval DEFAULT '00:15:00'::interval, p_shipping_overrides jsonb DEFAULT NULL::jsonb, p_checkout_request_key text DEFAULT NULL::text, p_checkout_context jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_previous jsonb;
  v_owner uuid;
  v_bound_owner uuid;
  v_bound_idempotency_key text;
  v_bound_context jsonb;
  v_fingerprint jsonb;
  v_orders jsonb := '[]'::jsonb;
  v_skipped jsonb := '[]'::jsonb;
  v_group record;
  v_order_id uuid;
  v_fee int;
  v_requested uuid[];
  v_claimed uuid[];
  v_basket_total bigint;
  -- 20261124180000
  v_claimed_rows jsonb;
begin
  if p_checkout_request_key is not null and (
    p_idempotency_key is null
    or p_checkout_context is null
    or jsonb_typeof(p_checkout_context) <> 'object'
  ) then
    raise exception 'Checkout request binding requires an idempotency key and context' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_buyer_id::text, 0));
  if exists(select 1 from public.profiles where id=p_buyer_id and suspended_at is not null) then raise exception 'Account unavailable'; end if;
  if p_checkout_request_key is not null then
    perform pg_advisory_xact_lock(hashtextextended(p_checkout_request_key, 2));
    select buyer_id, idempotency_key, checkout_context
      into v_bound_owner, v_bound_idempotency_key, v_bound_context
    from public.purchase_attempts
    where checkout_request_key = p_checkout_request_key;
    if found and (
      v_bound_owner is distinct from p_buyer_id
      or v_bound_idempotency_key is distinct from p_idempotency_key
      or v_bound_context is distinct from p_checkout_context
    ) then
      raise exception 'Checkout request is already bound to a different purchase' using errcode='42501';
    end if;
  end if;
  v_fingerprint := jsonb_build_object('ids', (select jsonb_agg(x order by x) from (select distinct unnest(p_listing_ids) x) t), 'shipping', coalesce(p_shipping_overrides, '{}'::jsonb));
  if p_idempotency_key is not null then
    perform pg_advisory_xact_lock(hashtextextended(p_idempotency_key, 1));
    select buyer_id, request_fingerprint into v_owner, v_previous from public.purchase_attempts where idempotency_key=p_idempotency_key;
    if found and (v_owner is distinct from p_buyer_id or v_previous is distinct from v_fingerprint) then
      raise exception 'Checkout attempt does not match this buyer or basket' using errcode='42501';
    end if;
    select result into v_previous
    from public.purchase_attempts
    where idempotency_key = p_idempotency_key;

    if v_previous is not null then
      -- 20261108130000: a replay settles this request's own admissions too.
      perform private.guest_holds_settle(p_idempotency_key, v_previous);
      return v_previous;
    end if;
  end if;

  if (select count(*) from public.orders where buyer_id=p_buyer_id and status in ('pending','requires_action')) >= 5 then
    raise exception 'Too many unresolved checkouts';
  end if;
  if (select count(distinct currency) from public.listings where id=any(p_listing_ids)) > 1 then raise exception 'A checkout must use one currency'; end if;
  if cardinality(p_listing_ids)>50 then raise exception 'Checkout supports at most 50 items'; end if;
  if (select count(distinct seller_id) from public.listings where id=any(p_listing_ids))>13 then raise exception 'Split this basket into checkouts with at most 13 sellers'; end if;
  v_requested := coalesce(p_listing_ids, array[]::uuid[]);
  if array_length(v_requested, 1) is null then
    return jsonb_build_object('orders', v_orders, 'skipped', v_skipped);
  end if;

  -- 20261124180000: the parts are locked in id order before they are
  -- reserved, so two baskets that share parts always wait for each other in
  -- the same order and neither can hold what the other needs. The claimed
  -- rows are kept in a variable: this used to create and drop a temporary
  -- table on every checkout, which writes to the system catalogs each time.
  with locked as (
    select l.id
    from public.listings l
    where l.id = any (v_requested)
      and l.status = 'active'
      and l.seller_id <> p_buyer_id
      and private.seller_can_take_payment(l.seller_id)
    order by l.id
    for update
  ), claimed as (
    update public.listings l
    set status = 'reserved',
        reserved_until = now() + p_reservation_window
    from locked
    where l.id = locked.id
    returning
      l.id, l.seller_id, l.title, l.price_cents, l.shipping_cents, l.currency
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', c.id, 'seller_id', c.seller_id, 'title', c.title,
    'price_cents', c.price_cents, 'currency', c.currency,
    'shipping_cents', greatest(
      coalesce((p_shipping_overrides ->> c.id::text)::int, c.shipping_cents),
      0
    )
  ) order by c.id), '[]'::jsonb)
  into v_claimed_rows
  from claimed c;

  select coalesce(array_agg(c.id), array[]::uuid[]) into v_claimed
  from jsonb_to_recordset(v_claimed_rows)
    as c(id uuid, seller_id uuid, title text, price_cents int, currency text, shipping_cents int);

  -- One payment covers the whole basket, so the bound is on the basket. Summed
  -- as bigint: a basket of large prices must be refused, not overflow below.
  select coalesce(sum(price_cents::bigint + shipping_cents::bigint), 0)
    into v_basket_total
    from jsonb_to_recordset(v_claimed_rows)
      as c(id uuid, seller_id uuid, title text, price_cents int, currency text, shipping_cents int);
  if cardinality(v_claimed) > 0 and not public.charge_cents_in_bounds(v_basket_total) then
    raise exception 'A checkout total must be between $0.50 and $999,999.99'
      using errcode = '22003';
  end if;

  select coalesce(
    jsonb_agg(jsonb_build_object('listing_id', missing.id, 'reason', 'unavailable')),
    '[]'::jsonb
  )
  into v_skipped
  from (select unnest(v_requested) as id except select unnest(v_claimed)) as missing;

  for v_group in
    select
      c.seller_id,
      c.currency,
      sum(c.price_cents)::int as subtotal,
      sum(c.shipping_cents)::int as shipping
    from jsonb_to_recordset(v_claimed_rows)
      as c(id uuid, seller_id uuid, title text, price_cents int, currency text, shipping_cents int)
    group by c.seller_id, c.currency
  loop
    v_fee := round((v_group.subtotal + v_group.shipping) * 1000.0 / 10000.0);

    insert into public.orders (
      buyer_id, seller_id, status,
      subtotal_cents, shipping_cents, platform_fee_cents, total_cents, currency
    )
    values (
      p_buyer_id, v_group.seller_id, 'pending',
      v_group.subtotal, v_group.shipping, v_fee,
      v_group.subtotal + v_group.shipping, v_group.currency
    )
    returning id into v_order_id;

    insert into public.order_items (order_id, listing_id, title, price_cents, shipping_cents)
    select v_order_id, c.id, c.title, c.price_cents, c.shipping_cents
    from jsonb_to_recordset(v_claimed_rows)
      as c(id uuid, seller_id uuid, title text, price_cents int, currency text, shipping_cents int)
    where c.seller_id = v_group.seller_id and c.currency = v_group.currency;

    insert into public.payments (order_id, amount_cents, currency, idempotency_key, status)
    values (
      v_order_id,
      v_group.subtotal + v_group.shipping,
      v_group.currency,
      case
        when p_idempotency_key is null then null
        else p_idempotency_key || ':' || v_order_id::text
      end,
      'pending'
    );

    v_orders := v_orders || jsonb_build_object(
      'order_id', v_order_id,
      'seller_id', v_group.seller_id,
      'currency', v_group.currency,
      'subtotal_cents', v_group.subtotal,
      'shipping_cents', v_group.shipping,
      'platform_fee_cents', v_fee,
      'total_cents', v_group.subtotal + v_group.shipping,
      'listing_ids', (
        select jsonb_agg(c.id)
        from jsonb_to_recordset(v_claimed_rows)
          as c(id uuid, seller_id uuid, title text, price_cents int, currency text, shipping_cents int)
        where c.seller_id = v_group.seller_id and c.currency = v_group.currency
      )
    );
  end loop;

  v_previous := jsonb_build_object('orders', v_orders, 'skipped', v_skipped);

  if p_idempotency_key is not null then
    insert into public.purchase_attempts (
      idempotency_key, buyer_id, result, request_fingerprint,
      checkout_request_key, checkout_context
    )
    values (
      p_idempotency_key, p_buyer_id, v_previous, v_fingerprint,
      p_checkout_request_key, p_checkout_context
    )
    on conflict (idempotency_key) do nothing;
  end if;

  -- 20261108130000 (N89): a guest's hold admissions are bound to the orders
  -- that hold their parts in this same transaction, before any delivery or
  -- payment work, and the admissions for parts not reserved are given back.
  -- Only this request's admissions: another checkout's are never touched.
  perform private.guest_holds_settle(p_idempotency_key, v_previous);

  return v_previous;
end;
$function$;

