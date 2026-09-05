begin;
-- A replacement has its own provider key and a permanent link to the failed
-- refund. The new seller transfer is an operation-specific source; the order's
-- original transfer remains unchanged for other allocations.
alter table public.refund_operations
 add column replaces_adjustment_id uuid references public.refund_lifecycle_adjustments(id) on delete restrict,
 add column replacement_transfer_reference text;
create index refund_replacement_adjustment_idx on public.refund_operations(replaces_adjustment_id) where replaces_adjustment_id is not null;

create function public.begin_refund_replacement(p_recovery uuid,p_actor uuid) returns uuid
language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.payment_recoveries; a public.refund_lifecycle_adjustments;
 f public.refund_operations; proof public.refund_recredit_proofs;
 o public.orders; previous public.refund_operations; result_id uuid:=gen_random_uuid(); due integer; source text;
begin
 if not exists(select 1 from public.admin_users where user_id=p_actor and role='admin') then raise exception 'Administrator required'; end if;
 select * into strict r from public.payment_recoveries where id=p_recovery;
 -- Serialize all new reservations on this order, including ordinary refunds.
 select * into strict o from public.orders where id=r.order_id for update;
 select * into strict r from public.payment_recoveries where id=p_recovery for update;
 if r.kind<>'refund_late_failure' or r.status<>'open' then raise exception 'Open late-refund case required'; end if;
 select * into strict a from public.refund_lifecycle_adjustments where refund_reference=substring(r.recovery_key from length('refund-late-failure:')+1);
 select * into strict f from public.refund_operations where id=a.refund_operation_id for update;
 select * into strict proof from public.refund_recredit_proofs where adjustment_id=a.id and recovery_id=r.id;
 if f.order_id<>o.id or f.provider_status not in ('failed','canceled') then raise exception 'Failed refund identity required'; end if;
 select * into previous from public.refund_operations where replaces_adjustment_id=a.id order by created_at desc,id desc limit 1;
 if found then
  -- Never issue another refund for an uncertain, settled or late-failed attempt.
  if previous.status<>'failed' or previous.effects_completed_at is not null then return previous.id; end if;
  if previous.provider_status is null or previous.provider_status not in ('failed','canceled') then raise exception 'Reconcile the previous replacement before retrying'; end if;
 end if;
 if exists(select 1 from public.refund_operations where order_id=o.id and id<>f.id and status in
 ('requested','provider_pending','provider_succeeded','effects_pending','reversal_pending','recovery_required')) then
  raise exception 'Finish other refund operations before replacing this refund';
 end if;
 if exists(select 1 from public.payment_recoveries where order_id=o.id and kind='refund_lifecycle_unresolved' and status='open') then raise exception 'Reconcile other provider refund evidence before replacement'; end if;
 if o.refunded_cents+a.refund_amount_cents>o.total_cents then raise exception 'Replacement exceeds the remaining buyer obligation'; end if;
 if proof.amount_cents=0 and (o.transfer_reference is not null or exists(
  select 1 from public.transfer_intents where order_id=o.id and (status<>'cancelled' or provider_call_may_have_occurred or transfer_reference is not null)
 )) then raise exception 'A later or uncertain seller payout requires reconciliation before zero-obligation replacement'; end if;
 source:=case when proof.amount_cents>0 then proof.recredit_transfer_reference else null end;
 due:=case when source is null then 0 else
 least(o.total_cents-o.platform_fee_cents,round((o.refunded_cents+a.refund_amount_cents)::numeric*(o.total_cents-o.platform_fee_cents)/greatest(o.total_cents,1)))
 -least(o.total_cents-o.platform_fee_cents,round(o.refunded_cents::numeric*(o.total_cents-o.platform_fee_cents)/greatest(o.total_cents,1))) end;
 if proof.amount_cents>0 and due<>proof.amount_cents then
  raise exception 'Seller allocation changed; reconcile the partial-refund rounding before replacement';
 end if;
 -- Release only this definitively failed reservation, in the same transaction
 -- that creates its replacement. Keep all original provider evidence intact.
 update public.refund_operations set status='failed',updated_at=now() where id=f.id;
 insert into public.refund_operations(id,order_id,payment_reference,amount_cents,currency,remaining_before_cents,
 reason,requested_by,actor_role,idempotency_key,status,resolve_dispute,dispute_outcome,replaces_adjustment_id,replacement_transfer_reference,created_at)
 values(result_id,o.id,f.payment_reference,a.refund_amount_cents,f.currency,o.total_cents-o.refunded_cents,
 'Admin refund: Replacement for failed refund '||a.refund_reference,'admin:'||p_actor,'admin',
 'refund:replacement:'||result_id,'requested',f.resolve_dispute,f.dispute_outcome,a.id,source,clock_timestamp());
 return result_id;
end $$;
revoke all on function public.begin_refund_replacement(uuid,uuid) from public,anon,authenticated;
grant execute on function public.begin_refund_replacement(uuid,uuid) to service_role;

-- Ordinary refunds must not consume a failed refund's released reservation
-- while its recovery remains open, or reclaim a seller's original transfer
-- instead of the dedicated recredit. Also fence the source at dispatch.
create function public.guard_refund_replacement() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare proof public.refund_recredit_proofs;
begin
 if tg_op='INSERT' then
  perform 1 from public.orders where id=new.order_id for update;
  if new.replaces_adjustment_id is null and exists(select 1 from public.payment_recoveries where order_id=new.order_id and kind='refund_late_failure' and status='open') then
   raise exception 'Use the linked replacement action for this late-refund recovery';
  end if;
 else
  if new.replaces_adjustment_id is distinct from old.replaces_adjustment_id or new.replacement_transfer_reference is distinct from old.replacement_transfer_reference then raise exception 'Replacement identity is immutable'; end if;
 end if;
 if new.replaces_adjustment_id is not null then
  select * into strict proof from public.refund_recredit_proofs where adjustment_id=new.replaces_adjustment_id;
  if new.reversal_operation_key is not null and new.reversal_transfer_reference is distinct from new.replacement_transfer_reference then raise exception 'Replacement must reverse its dedicated seller transfer'; end if;
  if new.effects_completed_at is not null and new.reversal_due_cents is distinct from proof.amount_cents then raise exception 'Replacement seller allocation changed'; end if;
 end if;
 return new;
end $$;
create trigger refund_replacement_guard before insert or update on public.refund_operations for each row execute function public.guard_refund_replacement();
revoke all on function public.guard_refund_replacement() from public,anon,authenticated;

create or replace function public.require_refund_recredit_proof() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if old.kind='refund_late_failure' and new.status<>'open' then
  if not exists(select 1 from public.refund_recredit_proofs where recovery_id=old.id) then raise exception 'Verify the seller recredit obligation before closing this recovery case'; end if;
  if not exists(
   select 1 from public.refund_recredit_proofs proof
   join public.refund_lifecycle_adjustments a on a.id=proof.adjustment_id
   join public.refund_operations f on f.id=a.refund_operation_id
   join public.refund_operations replacement on replacement.replaces_adjustment_id=a.id
   where proof.recovery_id=old.id and replacement.order_id=f.order_id
    and replacement.payment_reference=f.payment_reference and replacement.amount_cents=a.refund_amount_cents
    and replacement.refund_reference is not null and replacement.refund_reference<>a.refund_reference
    and ((replacement.status='completed' and replacement.provider_status='succeeded')
     or exists(select 1 from public.payment_recoveries child where child.recovery_key='refund-late-failure:'||replacement.refund_reference and child.status='recovered'))
  ) then raise exception 'The linked replacement buyer refund must also be settled before closure'; end if;
  if new.status<>'recovered' then raise exception 'A fulfilled late-refund obligation must be recorded as recovered'; end if;
  -- Failed pre-settlement attempts share this obligation. Once its linked
  -- successor has paid the buyer, their alerts must no longer claim money owed.
  update public.payment_recoveries early_case set status='recovered',resolved_by=new.resolved_by,
   resolved_at=coalesce(new.resolved_at,now()),resolution_note='Superseded replacement fulfilled; parent recovery '||old.id
  where early_case.status='open' and early_case.kind='refund_failed' and exists(
   select 1 from public.refund_operations attempt
   join public.refund_recredit_proofs proof on proof.adjustment_id=attempt.replaces_adjustment_id
   where proof.recovery_id=old.id and attempt.recovery_id=early_case.id
    and attempt.status='failed' and attempt.provider_status in ('failed','canceled') and attempt.effects_completed_at is null
  );
 end if;
 return new;
end $$;
-- A fresh payout cannot race the linked replacement's zero-transfer check.
-- Already uncertain calls remain reconcilable; they are rejected by admission.
create function public.guard_late_refund_payout() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if new.provider_call_may_have_occurred and not old.provider_call_may_have_occurred then
  perform 1 from public.orders where id=new.order_id for update;
  if exists(select 1 from public.payment_recoveries where order_id=new.order_id and kind='refund_late_failure' and status='open') then
   raise exception 'Reconcile the late refund before dispatching a new seller payout';
  end if;
 end if;
 return new;
end $$;
create trigger late_refund_payout_guard before update of provider_call_may_have_occurred on public.transfer_intents for each row execute function public.guard_late_refund_payout();
revoke all on function public.guard_late_refund_payout() from public,anon,authenticated;

-- Preserve external provider facts while an open replacement blocks adoption.
create or replace function public.record_refund_provider_event(
  p_event_id text,
  p_refund_reference text,
  p_operation_id uuid,
  p_order_id uuid,
  p_payment_reference text,
  p_amount_cents int,
  p_currency text,
  p_provider_status text,
  p_provider_created_at timestamptz,
  p_balance_transaction text default null,
  p_failure_balance_transaction text default null,
  p_failure_reason text default null,
  p_pending_reason text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
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
    );
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
$$;

-- The replacement's provider boundary and unresolved-fact check are one
-- order-serialized transaction. Dashboard activity after this boundary remains
-- external activity and must be reconciled using its provider event journal.
create function public.claim_refund_replacement_provider(p_operation uuid) returns text
language plpgsql security definer set search_path=public,pg_temp as $$
declare op public.refund_operations; previous_status text; o public.orders; proof public.refund_recredit_proofs; due integer;
begin
 select * into strict op from public.refund_operations where id=p_operation;
 select * into strict o from public.orders where id=op.order_id for update;
 select * into strict op from public.refund_operations where id=p_operation for update;
 if op.replaces_adjustment_id is null then raise exception 'Linked replacement required'; end if;
 if op.status not in ('requested','provider_pending') then return 'stopped'; end if;
 if exists(select 1 from public.payment_recoveries where order_id=op.order_id and kind='refund_lifecycle_unresolved' and status='open') then return 'recovery_required'; end if;
 if exists(select 1 from public.refund_operations where order_id=op.order_id and id<>op.id and status in ('requested','provider_pending','provider_succeeded','effects_pending','reversal_pending','recovery_required')) then return 'recovery_required'; end if;
 select * into strict proof from public.refund_recredit_proofs where adjustment_id=op.replaces_adjustment_id;
 if o.refunded_cents+op.amount_cents>o.total_cents then return 'recovery_required'; end if;
 due:=case when o.transfer_reference is null then 0 else
 least(o.total_cents-o.platform_fee_cents,round((o.refunded_cents+op.amount_cents)::numeric*(o.total_cents-o.platform_fee_cents)/greatest(o.total_cents,1)))
 -least(o.total_cents-o.platform_fee_cents,round(o.refunded_cents::numeric*(o.total_cents-o.platform_fee_cents)/greatest(o.total_cents,1))) end;
 if due<>proof.amount_cents then return 'recovery_required'; end if;
 if proof.amount_cents=0 and exists(select 1 from public.transfer_intents where order_id=o.id and (status<>'cancelled' or provider_call_may_have_occurred or transfer_reference is not null)) then return 'recovery_required'; end if;
 previous_status:=op.status;
 update public.refund_operations set status='provider_pending',updated_at=now() where id=op.id;
 return previous_status;
end $$;
revoke all on function public.claim_refund_replacement_provider(uuid) from public,anon,authenticated;
grant execute on function public.claim_refund_replacement_provider(uuid) to service_role;

notify pgrst,'reload schema';
commit;
