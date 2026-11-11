begin;

-- A reversal can cross Stripe's request boundary before its reference is
-- recorded locally. Freeze the exact request first and retain an independent
-- uncertainty bit because Stripe may prune an idempotency key after 24 hours.
alter table public.refund_operations
  add column if not exists reversal_operation_key text,
  add column if not exists reversal_transfer_reference text,
  add column if not exists reversal_amount_cents int,
  add column if not exists reversal_currency text,
  add column if not exists reversal_call_may_have_occurred boolean not null default false,
  add column if not exists reversal_locked_by text,
  add column if not exists reversal_lease_expires_at timestamptz,
  add column if not exists reversal_last_attempt_at timestamptz;

alter table public.refund_operations
  drop constraint if exists refund_operations_reversal_dispatch_check;
alter table public.refund_operations
  add constraint refund_operations_reversal_dispatch_check check (
    (
      reversal_operation_key is null
      and reversal_transfer_reference is null
      and reversal_amount_cents is null
      and reversal_currency is null
      and reversal_call_may_have_occurred = false
      and reversal_locked_by is null
      and reversal_lease_expires_at is null
      and reversal_last_attempt_at is null
    )
    or
    (
      reversal_operation_key is not null
      and reversal_transfer_reference is not null
      and reversal_amount_cents is not null
      and reversal_amount_cents > 0
      and reversal_currency is not null
      and reversal_currency = lower(reversal_currency)
      and reversal_call_may_have_occurred
      and reversal_last_attempt_at is not null
      and (
        (reversal_locked_by is null and reversal_lease_expires_at is null)
        or
        (reversal_locked_by is not null and reversal_lease_expires_at is not null)
      )
    )
  );

create unique index if not exists refund_operations_reversal_operation_idx
  on public.refund_operations (reversal_operation_key)
  where reversal_operation_key is not null;
create unique index if not exists refund_operations_reversal_reference_idx
  on public.refund_operations (reversal_reference)
  where reversal_reference is not null;
create index if not exists refund_operations_reversal_reclaim_idx
  on public.refund_operations (reversal_lease_expires_at, updated_at)
  where status = 'reversal_pending';

create or replace function public.claim_refund_reversal(
  p_operation uuid,
  p_worker text,
  p_transfer_reference text,
  p_amount_cents int,
  p_currency text,
  p_operation_key text,
  p_lease_seconds int default 300
) returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_op public.refund_operations;
  v_currency text := lower(p_currency);
begin
  if p_operation is null or nullif(p_worker, '') is null
     or nullif(p_transfer_reference, '') is null
     or p_amount_cents is null or p_amount_cents <= 0
     or nullif(v_currency, '') is null
     or nullif(p_operation_key, '') is null then
    raise exception 'Invalid reversal dispatch';
  end if;

  select * into v_op
  from public.refund_operations
  where id = p_operation
  for update;
  if not found then return 'missing'; end if;

  if v_op.status = 'completed' and v_op.reversal_reference is not null then
    if v_op.reversal_operation_key = p_operation_key
       and v_op.reversal_transfer_reference = p_transfer_reference
       and v_op.reversal_amount_cents = p_amount_cents
       and v_op.reversal_currency = v_currency then
      return 'completed';
    end if;
    return 'conflict';
  end if;
  if v_op.status <> 'reversal_pending' then return 'stopped'; end if;

  if v_op.reversal_operation_key is not null and (
    v_op.reversal_operation_key <> p_operation_key
    or v_op.reversal_transfer_reference <> p_transfer_reference
    or v_op.reversal_amount_cents <> p_amount_cents
    or v_op.reversal_currency <> v_currency
  ) then
    return 'conflict';
  end if;

  if v_op.reversal_locked_by is not null
     and v_op.reversal_locked_by <> p_worker
     and v_op.reversal_lease_expires_at >= now() then
    return 'busy';
  end if;

  update public.refund_operations
  set reversal_operation_key = p_operation_key,
      reversal_transfer_reference = p_transfer_reference,
      reversal_amount_cents = p_amount_cents,
      reversal_currency = v_currency,
      reversal_call_may_have_occurred = true,
      reversal_locked_by = p_worker,
      reversal_lease_expires_at = now() + make_interval(secs => greatest(p_lease_seconds, 30)),
      reversal_last_attempt_at = now(),
      updated_at = now()
  where id = p_operation;
  return 'claimed';
end;
$$;

revoke all on function public.claim_refund_reversal(uuid, text, text, int, text, text, int)
  from public, anon, authenticated;
grant execute on function public.claim_refund_reversal(uuid, text, text, int, text, text, int)
  to service_role;

create or replace function public.renew_refund_reversal_lease(
  p_operation uuid,
  p_worker text,
  p_operation_key text,
  p_lease_seconds int default 300
) returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_updated int;
begin
  update public.refund_operations
  set reversal_lease_expires_at = now() + make_interval(secs => greatest(p_lease_seconds, 30)),
      updated_at = now()
  where id = p_operation
    and status = 'reversal_pending'
    and reversal_locked_by = p_worker
    and reversal_lease_expires_at > now()
    and reversal_operation_key = p_operation_key
    and reversal_call_may_have_occurred;
  get diagnostics v_updated = row_count;
  return v_updated = 1;
end;
$$;

revoke all on function public.renew_refund_reversal_lease(uuid, text, text, int)
  from public, anon, authenticated;
grant execute on function public.renew_refund_reversal_lease(uuid, text, text, int)
  to service_role;

create or replace function public.hold_refund_reversal(
  p_operation uuid,
  p_worker text,
  p_operation_key text,
  p_detail text,
  p_next_attempt_at timestamptz
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_op public.refund_operations;
  v_recovery uuid;
begin
  if nullif(p_detail, '') is null then raise exception 'Reversal recovery detail is required'; end if;
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
$$;

revoke all on function public.hold_refund_reversal(uuid, text, text, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.hold_refund_reversal(uuid, text, text, text, timestamptz)
  to service_role;

create or replace function public.complete_refund_reversal(
  p_operation uuid,
  p_worker text,
  p_operation_key text,
  p_transfer_reference text,
  p_amount_cents int,
  p_currency text,
  p_reversal_reference text
) returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_op public.refund_operations;
  v_recovery public.payment_recoveries;
  v_updated int;
begin
  if nullif(p_reversal_reference, '') is null then raise exception 'Invalid reversal reference'; end if;
  select * into v_op
  from public.refund_operations
  where id = p_operation
  for update;
  if not found then return 'missing'; end if;

  if v_op.status = 'completed' then
    if v_op.reversal_reference = p_reversal_reference
       and v_op.reversal_operation_key = p_operation_key
       and v_op.reversal_transfer_reference = p_transfer_reference
       and v_op.reversal_amount_cents = p_amount_cents
       and v_op.reversal_currency = lower(p_currency) then
      return 'completed';
    end if;
    return 'conflict';
  end if;

  if (
    v_op.status = 'reversal_pending'
    and v_op.reversal_locked_by = p_worker
    and v_op.reversal_lease_expires_at > now()
    and v_op.reversal_call_may_have_occurred
    and v_op.reversal_operation_key = p_operation_key
    and v_op.reversal_transfer_reference = p_transfer_reference
    and v_op.reversal_amount_cents = p_amount_cents
    and v_op.reversal_currency = lower(p_currency)
  ) is not true then
    return 'lost';
  end if;

  update public.refund_operations
  set status = 'completed',
      reversal_reference = p_reversal_reference,
      reversal_completed_at = now(),
      last_error = null,
      next_attempt_at = null,
      reversal_locked_by = null,
      reversal_lease_expires_at = null,
      updated_at = now()
  where id = p_operation;

  if v_op.recovery_id is not null then
    update public.payment_recoveries
    set status = 'recovered',
        resolved_at = now(),
        resolution_note = 'Reversal recovered from exact Stripe history match.'
    where id = v_op.recovery_id and status = 'open';
    get diagnostics v_updated = row_count;
    if v_updated = 0 then
      select * into v_recovery from public.payment_recoveries where id = v_op.recovery_id;
      if not found or v_recovery.status <> 'recovered' then
        raise exception 'Reversal recovery resolution was not persisted';
      end if;
    end if;
  end if;
  return 'completed';
end;
$$;

revoke all on function public.complete_refund_reversal(uuid, text, text, text, int, text, text)
  from public, anon, authenticated;
grant execute on function public.complete_refund_reversal(uuid, text, text, text, int, text, text)
  to service_role;

commit;
