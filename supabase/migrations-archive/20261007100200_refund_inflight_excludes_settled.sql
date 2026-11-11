-- 20261007100200 — a settled refund is not also counted as in flight.
--
-- What is left to refund on an order is
--   total − orders.refunded_cents − (refunds in flight).
-- "In flight" was every operation in a live status, including
-- 'reversal_pending' (and 'recovery_required'). But settle_refund_operation
-- has already added a reversal_pending refund to refunded_cents — the
-- operation is only waiting for the seller's transfer reversal — so it was
-- subtracted twice. Until the reversal went through:
--   * an operator saw less left to refund than there was;
--   * begin_refund_operation booked a Stripe-side refund (p_external) for
--     only what it thought was left, silently short;
--   * record_refund_provider_event sent a legitimate Stripe refund to
--     recovery as an amount mismatch.
--
-- settle_refund_operation stamps effects_completed_at in the same statement
-- that moves an operation past its effects, and a late failure that undoes
-- them ends in 'failed' (never a live status). So an operation is in flight
-- for this sum exactly when it is live and effects_completed_at is null.
--
-- Both functions are restated from their current definitions (0026 and
-- 20260905203107) with that one condition added. The "is any other refund
-- still running" gates in the replacement functions are not sums and are
-- unchanged. Idempotent.

begin;

CREATE OR REPLACE FUNCTION public.begin_refund_operation(p_order_id uuid, p_amount_cents integer, p_reason text, p_requested_by text, p_actor_role text, p_resolve_dispute boolean, p_dispute_outcome text, p_payment_reference text, p_refund_reference text DEFAULT NULL::text, p_external boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_order     record;
  v_inflight  int;
  v_remaining int;
  v_amount    int;
  v_existing  record;
  v_op        public.refund_operations;
  v_key       text;
  v_failed    int;
begin
  -- Adopt an operation we already hold for this Stripe refund object.
  if p_refund_reference is not null then
    select id, status into v_existing
    from public.refund_operations
    where refund_reference = p_refund_reference;
    if found then
      return jsonb_build_object('ok', true, 'adopted', true,
        'operation_id', v_existing.id, 'status', v_existing.status);
    end if;
  end if;

  select id, total_cents, refunded_cents, currency
    into v_order
    from public.orders where id = p_order_id
    for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'Order not found.');
  end if;

  select coalesce(sum(amount_cents), 0) into v_inflight
  from public.refund_operations
  where order_id = p_order_id
    and status in ('requested', 'provider_pending', 'provider_succeeded',
                   'effects_pending', 'reversal_pending', 'recovery_required')
    -- 20261007100200: only what is not yet in refunded_cents.
    and effects_completed_at is null;

  v_remaining := v_order.total_cents - v_order.refunded_cents - v_inflight;
  v_amount := coalesce(p_amount_cents, v_remaining);

  -- External refunds already happened at Stripe: book what's still bookable
  -- rather than refusing (stale webhook views can over-ask harmlessly).
  if p_external then
    v_amount := least(v_amount, v_remaining);
  end if;

  if v_amount <= 0 or v_remaining <= 0 then
    return jsonb_build_object('ok', false,
      'error', 'Nothing left to refund on this order (settled or in flight).');
  end if;
  if v_amount > v_remaining then
    return jsonb_build_object('ok', false,
      'error', 'Refund exceeds what''s left to refund on this order.');
  end if;

  -- Cumulative-deterministic (settled + reserved + this), so a crash-retry of
  -- the same in-flight operation reuses the key. A NEW operation after a
  -- terminally FAILED one at the same amount would collide (failed ops release
  -- their reservation but keep their key row) — those get a deterministic
  -- retry suffix: Stripe refused the previous request, so the retry is a new
  -- logical attempt and must not replay the refused call's key.
  v_key := 'refund:order:' || p_order_id || ':' || (v_order.refunded_cents + v_inflight + v_amount);
  select count(*) into v_failed
  from public.refund_operations
  where order_id = p_order_id and status = 'failed';
  if v_failed > 0 then
    v_key := v_key || ':r' || v_failed;
  end if;

  insert into public.refund_operations (
    order_id, payment_reference, amount_cents, currency, remaining_before_cents,
    reason, requested_by, actor_role, idempotency_key, refund_reference,
    status, external, resolve_dispute, dispute_outcome, provider_completed_at
  ) values (
    p_order_id, p_payment_reference, v_amount, v_order.currency, v_remaining,
    left(coalesce(p_reason, ''), 500), p_requested_by, p_actor_role,
    v_key,
    p_refund_reference,
    -- External refunds already exist at the provider — they enter the machine
    -- at effects_pending; app-initiated ones start at requested.
    case when p_external then 'effects_pending' else 'requested' end,
    p_external,
    coalesce(p_resolve_dispute, false),
    p_dispute_outcome,
    case when p_external then now() end
  ) returning * into v_op;

  return jsonb_build_object('ok', true, 'adopted', false,
    'operation_id', v_op.id, 'idempotency_key', v_op.idempotency_key,
    'amount_cents', v_op.amount_cents, 'status', v_op.status);
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
begin
  if p_event_id is null or length(p_event_id) < 3
     or p_refund_reference is null or length(p_refund_reference) < 3
     or p_amount_cents is null or p_amount_cents <= 0
     or p_currency is null or p_provider_created_at is null
     or p_provider_status is null
     or p_provider_status not in ('pending','requires_action','succeeded','failed','canceled','unknown') then
    raise exception 'Invalid refund provider event';
  end if;

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
      p_event_id,p_refund_reference,p_operation_id,p_payment_reference,p_order_id,
      p_order_id,p_amount_cents,p_currency,
      p_provider_status,p_provider_created_at,p_balance_transaction,
      p_failure_balance_transaction,p_failure_reason
    );
    insert into public.payment_recoveries(kind,recovery_key,order_id,amount_cents,detail)
    values(
      'refund_lifecycle_unresolved','refund-lifecycle:'||p_refund_reference,
      p_order_id,p_amount_cents,
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
        p_event_id,p_refund_reference,p_operation_id,p_payment_reference,p_order_id,
        p_order_id,p_amount_cents,p_currency,
        p_provider_status,p_provider_created_at,p_balance_transaction,
        p_failure_balance_transaction,p_failure_reason
      );
      insert into public.payment_recoveries(kind,recovery_key,order_id,amount_cents,detail)
      values(
        'refund_lifecycle_unresolved','refund-lifecycle:'||p_refund_reference,
        p_order_id,p_amount_cents,
        'Refund '||p_refund_reference||' does not match the referenced local operation.'
      )
      on conflict(recovery_key) do update set
        last_seen_at=now(), detail=excluded.detail, amount_cents=excluded.amount_cents,
        status='open', resolved_by=null, resolved_at=null, resolution_note=null;
      return jsonb_build_object('action','recovery_recorded','reason','operation_mismatch');
    end if;
  else
    if p_order_id is null then
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

revoke all on function public.begin_refund_operation(uuid, int, text, text, text, boolean, text, text, text, boolean) from public, anon, authenticated;
grant execute on function public.begin_refund_operation(uuid, int, text, text, text, boolean, text, text, text, boolean) to service_role;
revoke all on function public.record_refund_provider_event(text, text, uuid, uuid, text, integer, text, text, timestamptz, text, text, text, text) from public, anon, authenticated;
grant execute on function public.record_refund_provider_event(text, text, uuid, uuid, text, integer, text, text, timestamptz, text, text, text, text) to service_role;

notify pgrst, 'reload schema';

commit;
