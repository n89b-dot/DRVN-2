begin;

-- Stripe refunds are asynchronous objects. Keep provider state separate from
-- the local operation state: only provider_status=succeeded may advance the
-- settled refund ledger.
alter table public.refund_operations
  add column if not exists provider_status text,
  add column if not exists provider_failure_reason text,
  add column if not exists provider_balance_transaction text,
  add column if not exists provider_failure_balance_transaction text,
  add column if not exists provider_pending_reason text,
  add column if not exists provider_event_created_at timestamptz,
  add column if not exists provider_event_id text;

alter table public.refund_operations
  drop constraint if exists refund_operations_provider_status_check;
alter table public.refund_operations
  add constraint refund_operations_provider_status_check check (
    provider_status is null or provider_status in (
      'pending', 'requires_action', 'succeeded', 'failed', 'canceled', 'unknown'
    )
  );

-- Immutable receipt history for every refund lifecycle callback. The event id
-- is the replay key; the provider object identity remains queryable even when
-- an event cannot be safely mapped to an operation.
create table if not exists public.refund_provider_events (
  event_id text primary key,
  refund_reference text not null,
  refund_operation_id uuid references public.refund_operations(id) on delete restrict,
  reported_operation_id uuid,
  payment_reference text,
  order_id uuid references public.orders(id) on delete set null,
  reported_order_id uuid,
  amount_cents int not null check (amount_cents > 0),
  currency text not null,
  provider_status text not null check (provider_status in (
    'pending', 'requires_action', 'succeeded', 'failed', 'canceled', 'unknown'
  )),
  provider_created_at timestamptz not null,
  balance_transaction text,
  failure_balance_transaction text,
  failure_reason text,
  received_at timestamptz not null default now()
);
alter table public.refund_provider_events
  add column if not exists reported_operation_id uuid,
  add column if not exists reported_order_id uuid;
create index if not exists refund_provider_events_refund_idx
  on public.refund_provider_events(refund_reference, provider_created_at);
alter table public.refund_provider_events enable row level security;
drop policy if exists "admins read refund provider events" on public.refund_provider_events;
create policy "admins read refund provider events" on public.refund_provider_events
  for select using (public.is_admin());
revoke all on public.refund_provider_events from anon, authenticated;
grant select on public.refund_provider_events to authenticated;

-- A succeeded refund can later fail. This append-only row proves the exact
-- counter-restoration applied once and the seller amount that still needs an
-- operator-controlled re-credit after a completed transfer reversal.
create table if not exists public.refund_lifecycle_adjustments (
  id uuid primary key default gen_random_uuid(),
  refund_operation_id uuid not null references public.refund_operations(id) on delete restrict,
  refund_reference text not null,
  event_id text not null references public.refund_provider_events(event_id) on delete restrict,
  kind text not null check (kind = 'provider_failure_compensation'),
  refund_amount_cents int not null check (refund_amount_cents > 0),
  fee_restore_cents int not null check (fee_restore_cents >= 0),
  -- Null means a reversal request may have crossed the provider boundary but
  -- its result was never durably recorded; an operator must reconcile Stripe
  -- before deciding whether a seller re-credit is owed.
  seller_recredit_cents int check (seller_recredit_cents is null or seller_recredit_cents >= 0),
  failure_balance_transaction text,
  created_at timestamptz not null default now(),
  unique(refund_operation_id, kind)
);
alter table public.refund_lifecycle_adjustments
  alter column seller_recredit_cents drop not null;
alter table public.refund_lifecycle_adjustments enable row level security;
drop policy if exists "admins read refund lifecycle adjustments" on public.refund_lifecycle_adjustments;
create policy "admins read refund lifecycle adjustments" on public.refund_lifecycle_adjustments
  for select using (public.is_admin());
revoke all on public.refund_lifecycle_adjustments from anon, authenticated;
grant select on public.refund_lifecycle_adjustments to authenticated;

create or replace function public.reject_refund_history_mutation()
returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
  raise exception 'Refund lifecycle history is append-only';
end $$;
drop trigger if exists refund_provider_events_append_only on public.refund_provider_events;
create trigger refund_provider_events_append_only
before update or delete on public.refund_provider_events
for each row execute function public.reject_refund_history_mutation();
drop trigger if exists refund_lifecycle_adjustments_append_only on public.refund_lifecycle_adjustments;
create trigger refund_lifecycle_adjustments_append_only
before update or delete on public.refund_lifecycle_adjustments
for each row execute function public.reject_refund_history_mutation();

alter table public.payment_recoveries drop constraint if exists payment_recoveries_kind_check;
alter table public.payment_recoveries add constraint payment_recoveries_kind_check check(kind in (
  'reversal_failed', 'refund_failed', 'partial_refund_unattributed',
  'transfer_after_refund', 'negative_balance', 'capture_unresolved',
  'transfer_unresolved', 'refund_lifecycle_unresolved', 'refund_late_failure'
));

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
    if p_amount_cents > v_remaining then
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
        'Refund '||p_refund_reference||' exceeds the unreserved local refundable balance.'
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

revoke all on function public.record_refund_provider_event(
  text,text,uuid,uuid,text,int,text,text,timestamptz,text,text,text,text
) from public,anon,authenticated;
grant execute on function public.record_refund_provider_event(
  text,text,uuid,uuid,text,int,text,text,timestamptz,text,text,text,text
) to service_role;

notify pgrst,'reload schema';
commit;
