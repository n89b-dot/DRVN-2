begin;

-- Freeze the complete Stripe request before leaving Postgres. Nullable
-- columns preserve legacy rows; an expired legacy processing lease is marked
-- uncertain by claim_transfer_intents and must be sent to operator recovery
-- rather than having its missing request parameters reconstructed.
alter table public.transfer_intents
  add column operation_key text,
  add column dispatch_amount_cents int,
  add column dispatch_currency text,
  add column dispatch_destination text,
  add column dispatch_source_transaction text,
  add column dispatch_transfer_group text,
  add column provider_call_may_have_occurred boolean not null default false;

create unique index transfer_intents_operation_key_uidx
  on public.transfer_intents (operation_key)
  where operation_key is not null;

alter table public.transfer_intents
  add constraint transfer_intents_dispatch_payload_check check (
    (
      operation_key is null
      and dispatch_amount_cents is null
      and dispatch_currency is null
      and dispatch_destination is null
      and dispatch_source_transaction is null
      and dispatch_transfer_group is null
    )
    or (
      operation_key is not null
      and dispatch_amount_cents is not null
      and dispatch_amount_cents > 0
      and dispatch_currency is not null
      and dispatch_currency ~ '^[a-z]{3}$'
      and dispatch_destination is not null
      and length(dispatch_destination) > 0
      and dispatch_source_transaction is not null
      and length(dispatch_source_transaction) > 0
      and dispatch_transfer_group is not null
      and length(dispatch_transfer_group) > 0
    )
  );

-- Reclaiming a processing row is evidence that its previous owner could have
-- reached Stripe, regardless of the retry counter. This flag is part of the
-- atomic claim and therefore cannot be skipped by an attempts=0 stale lease.
create or replace function public.claim_transfer_intents(
  p_worker        text,
  p_batch         int default 20,
  p_lease_seconds int default 300,
  p_max_attempts  int default 8
) returns setof public.transfer_intents
language sql
security definer
set search_path = public, pg_temp
as $$
  with candidates as (
    select order_id, status = 'processing' as was_processing
    from public.transfer_intents
    where (
        status in ('ready', 'blocked_unpayable', 'failed')
        and attempts < p_max_attempts
        and (next_attempt_at is null or next_attempt_at <= now())
      )
      or (
        status = 'processing'
        and (lease_expires_at is null or lease_expires_at < now())
      )
    order by updated_at
    limit greatest(p_batch, 1)
    for update skip locked
  )
  update public.transfer_intents ti
  set status = 'processing',
      locked_at = now(),
      locked_by = p_worker,
      lease_expires_at = now() + make_interval(secs => greatest(p_lease_seconds, 30)),
      last_attempt_at = now(),
      provider_call_may_have_occurred =
        ti.provider_call_may_have_occurred or c.was_processing,
      updated_at = now()
  from candidates c
  where ti.order_id = c.order_id
  returning ti.*;
$$;

revoke all on function public.claim_transfer_intents(text, int, int, int)
  from public, anon, authenticated;
grant execute on function public.claim_transfer_intents(text, int, int, int)
  to service_role;

-- This short transaction is the durable boundary before transfers.create.
-- Replays may present the same payload, but no owner may replace a previously
-- frozen payload or write through an expired lease.
create or replace function public.prepare_transfer_dispatch(
  p_order uuid,
  p_worker text,
  p_operation_key text,
  p_amount_cents int,
  p_currency text,
  p_destination text,
  p_source_transaction text,
  p_transfer_group text
) returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_updated int;
begin
  if p_order is null
     or p_worker is null
     or p_operation_key is null
     or p_amount_cents is null
     or p_currency is null
     or p_destination is null
     or p_source_transaction is null
     or p_transfer_group is null
     or length(p_operation_key) < 3
     or p_amount_cents <= 0
     or p_currency !~ '^[a-z]{3}$'
     or length(p_destination) = 0
     or length(p_source_transaction) = 0
     or length(p_transfer_group) = 0 then
    raise exception 'Invalid transfer dispatch payload';
  end if;

  update public.transfer_intents
  set operation_key = p_operation_key,
      dispatch_amount_cents = p_amount_cents,
      dispatch_currency = p_currency,
      dispatch_destination = p_destination,
      dispatch_source_transaction = p_source_transaction,
      dispatch_transfer_group = p_transfer_group,
      source_transaction = coalesce(source_transaction, p_source_transaction),
      provider_call_may_have_occurred = true,
      updated_at = now()
  where order_id = p_order
    and status = 'processing'
    and locked_by = p_worker
    and lease_expires_at > now()
    and (
      (
        operation_key is null
        and dispatch_amount_cents is null
        and dispatch_currency is null
        and dispatch_destination is null
        and dispatch_source_transaction is null
        and dispatch_transfer_group is null
        and provider_call_may_have_occurred = false
      )
      or (
        operation_key = p_operation_key
        and dispatch_amount_cents = p_amount_cents
        and dispatch_currency = p_currency
        and dispatch_destination = p_destination
        and dispatch_source_transaction = p_source_transaction
        and dispatch_transfer_group = p_transfer_group
      )
    );
  get diagnostics v_updated = row_count;
  return v_updated = 1;
end;
$$;

revoke all on function public.prepare_transfer_dispatch(uuid, text, text, int, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.prepare_transfer_dispatch(uuid, text, text, int, text, text, text, text)
  to service_role;

create or replace function public.release_transfer_intent(
  p_order uuid,
  p_worker text,
  p_status text,
  p_last_error text default null,
  p_attempts int default null,
  p_next_attempt_at timestamptz default null
) returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_updated int;
begin
  if p_status not in ('holding', 'blocked_unpayable', 'failed', 'cancelled') then
    raise exception 'Invalid transfer release status';
  end if;

  update public.transfer_intents
  set status = p_status,
      attempts = coalesce(p_attempts, attempts),
      next_attempt_at = p_next_attempt_at,
      last_error = left(p_last_error, 500),
      locked_at = null,
      locked_by = null,
      lease_expires_at = null,
      updated_at = now()
  where order_id = p_order
    and status = 'processing'
    and locked_by = p_worker
    and lease_expires_at > now();
  get diagnostics v_updated = row_count;
  return v_updated = 1;
end;
$$;

revoke all on function public.release_transfer_intent(uuid, text, text, text, int, timestamptz)
  from public, anon, authenticated;
grant execute on function public.release_transfer_intent(uuid, text, text, text, int, timestamptz)
  to service_role;

create or replace function public.complete_transfer_intent(
  p_order uuid,
  p_worker text,
  p_operation_key text,
  p_transfer_reference text
) returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_order record;
  v_intent public.transfer_intents;
  v_dispatch_amount int;
  v_operation_key text;
  v_adjustments int;
  v_current_payable int;
begin
  if p_order is null
     or p_worker is null
     or p_transfer_reference is null
     or length(p_transfer_reference) = 0 then
    raise exception 'Invalid transfer reference';
  end if;

  -- Match settle_refund_operation's order -> transfer_intent lock order. The
  -- order row lock also serializes FK-checked seller-adjustment inserts, so
  -- the payable amount below reflects every adjustment committed before this
  -- completion and cannot change until this transaction commits.
  select id, status, total_cents, platform_fee_cents, refunded_cents, transfer_reference
  into v_order
  from public.orders
  where id = p_order
  for update;
  if not found then return 'lost'; end if;

  select * into v_intent
  from public.transfer_intents
  where order_id = p_order
  for update;
  if not found then return 'lost'; end if;

  v_dispatch_amount := v_intent.dispatch_amount_cents;
  v_operation_key := v_intent.operation_key;

  if (
    v_intent.status = 'processing'
    and v_intent.locked_by = p_worker
    and v_intent.lease_expires_at > now()
    and v_intent.operation_key is not distinct from p_operation_key
  ) is not true then
    -- A full refund can cancel the intent while its owner is inside Stripe.
    -- The returned transfer is definitive evidence of the external effect, so
    -- preserve its reference and open the adjustment instead of dropping it.
    -- A processing row owned by anybody else remains untouched.
    if v_intent.status = 'cancelled'
       and v_intent.provider_call_may_have_occurred
       and v_intent.operation_key = p_operation_key
       and v_intent.transfer_reference is null then
      if v_order.transfer_reference is not null
         and v_order.transfer_reference <> p_transfer_reference then
        update public.transfer_intents
        set status = 'failed',
            attempts = greatest(attempts, 8),
            next_attempt_at = null,
            last_error = 'Order has a different transfer reference',
            locked_at = null,
            locked_by = null,
            lease_expires_at = null,
            updated_at = now()
        where order_id = p_order;

        insert into public.payment_recoveries (
          order_id, kind, recovery_key, amount_cents, detail
        ) values (
          p_order,
          'transfer_unresolved',
          'transfer-unresolved:' || p_order::text,
          coalesce(v_dispatch_amount, v_intent.amount_cents),
          'Stripe transfer ' || p_transfer_reference ||
            ' conflicts with order transfer ' || v_order.transfer_reference
        )
        on conflict (recovery_key) do update
        set last_seen_at = now(), detail = excluded.detail, status = 'open',
            resolved_by = null, resolved_at = null, resolution_note = null;
        return 'recovery';
      end if;

      update public.orders
      set transfer_reference = p_transfer_reference,
          transferred_at = coalesce(transferred_at, now())
      where id = p_order;
      update public.transfer_intents
      set status = 'transferred',
          transfer_reference = p_transfer_reference,
          last_error = null,
          next_attempt_at = null,
          locked_at = null,
          locked_by = null,
          lease_expires_at = null,
          updated_at = now()
      where order_id = p_order;
      insert into public.payment_recoveries (
        order_id, kind, recovery_key, amount_cents, detail
      ) values (
        p_order,
        'transfer_after_refund',
        'transfer-adjustment:' || v_operation_key || ':' || p_transfer_reference,
        v_dispatch_amount,
        'The order became non-payable while Stripe transfer ' ||
          p_transfer_reference || ' was in flight; reconcile the seller balance.'
      )
      on conflict (recovery_key) do update
      set last_seen_at = now(), detail = excluded.detail,
          amount_cents = excluded.amount_cents, status = 'open',
          resolved_by = null, resolved_at = null, resolution_note = null;
      return 'recovery';
    end if;
    return 'lost';
  end if;

  select coalesce(sum(amount_cents), 0)::int
  into v_adjustments
  from public.seller_adjustments
  where order_id = p_order and voided_at is null;

  v_current_payable := v_intent.amount_cents
    - case
        when v_order.total_cents <= 0 or v_intent.amount_cents <= 0 then 0
        else least(
          v_intent.amount_cents,
          round((v_order.refunded_cents::numeric * v_intent.amount_cents) /
            v_order.total_cents)::int
        )
      end
    + v_adjustments;

  if v_order.transfer_reference is not null
     and v_order.transfer_reference <> p_transfer_reference then
    update public.transfer_intents
    set status = 'failed',
        attempts = greatest(attempts, 8),
        next_attempt_at = null,
        last_error = 'Order has a different transfer reference',
        locked_at = null,
        locked_by = null,
        lease_expires_at = null,
        updated_at = now()
    where order_id = p_order;

    insert into public.payment_recoveries (
      order_id, kind, recovery_key, amount_cents, detail
    ) values (
      p_order,
      'transfer_unresolved',
      'transfer-unresolved:' || p_order::text,
      coalesce(v_dispatch_amount, v_intent.amount_cents),
      'Stripe transfer ' || p_transfer_reference ||
        ' conflicts with order transfer ' || v_order.transfer_reference
    )
    on conflict (recovery_key) do update
    set last_seen_at = now(), detail = excluded.detail, status = 'open',
        resolved_by = null, resolved_at = null, resolution_note = null;
    return 'recovery';
  end if;

  update public.orders
  set transfer_reference = p_transfer_reference,
      transferred_at = coalesce(transferred_at, now())
  where id = p_order;

  update public.transfer_intents
  set status = 'transferred',
      transfer_reference = p_transfer_reference,
      last_error = null,
      next_attempt_at = null,
      locked_at = null,
      locked_by = null,
      lease_expires_at = null,
      updated_at = now()
  where order_id = p_order;

  if (v_order.status in ('delivered', 'completed')) is not true
     or (v_intent.available_at is not null and v_intent.available_at > now()) then
    insert into public.payment_recoveries (
      order_id, kind, recovery_key, amount_cents, detail
    ) values (
      p_order,
      'transfer_unresolved',
      'transfer-unresolved:' || p_order::text,
      coalesce(v_dispatch_amount, v_intent.amount_cents),
      'Stripe transfer ' || p_transfer_reference ||
        ' completed while the order was ' || v_order.status ||
        case
          when v_intent.available_at is not null and v_intent.available_at > now()
            then ' and its clearing time was still in the future'
          else ''
        end
    )
    on conflict (recovery_key) do update
    set last_seen_at = now(), detail = excluded.detail,
        amount_cents = excluded.amount_cents, status = 'open',
        resolved_by = null, resolved_at = null, resolution_note = null;
    return 'recovery';
  end if;

  if v_dispatch_amount is not null and v_current_payable <> v_dispatch_amount then
    insert into public.payment_recoveries (
      order_id, kind, recovery_key, amount_cents, detail
    ) values (
      p_order,
      'transfer_after_refund',
      'transfer-adjustment:' || v_operation_key || ':' || p_transfer_reference,
      abs(v_dispatch_amount - v_current_payable),
      'Recovered the frozen transfer amount ' || v_dispatch_amount::text ||
        ' cents while the current payable amount is ' || v_current_payable::text ||
        ' cents; reconcile the difference separately.'
    )
    on conflict (recovery_key) do update
    set last_seen_at = now(),
        detail = excluded.detail,
        amount_cents = excluded.amount_cents,
        status = 'open',
        resolved_by = null,
        resolved_at = null,
        resolution_note = null;
  end if;

  return 'completed';
end;
$$;

revoke all on function public.complete_transfer_intent(uuid, text, text, text)
  from public, anon, authenticated;
grant execute on function public.complete_transfer_intent(uuid, text, text, text)
  to service_role;

-- A unique recovery identity turns every ambiguous provider result into one
-- durable operator obligation. The same transaction also prevents its
-- current lease owner from issuing another transfer for the order.
alter table public.payment_recoveries
  drop constraint payment_recoveries_kind_check;
alter table public.payment_recoveries
  add constraint payment_recoveries_kind_check check (kind in (
    'reversal_failed', 'refund_failed', 'partial_refund_unattributed',
    'transfer_after_refund', 'negative_balance', 'capture_unresolved',
    'transfer_unresolved'
  ));

-- Every open transfer recovery owns a durable alert in the same transaction.
-- This closes the process-death gap between committing the money/recovery
-- state and asking the application to enqueue an alert. The recovery identity
-- is also the alert identity, so replayed upserts cannot fan out duplicates.
create or replace function public.enqueue_transfer_recovery_alert()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.kind in ('transfer_after_refund', 'transfer_unresolved')
     and new.status = 'open' then
    insert into public.admin_alert_outbox (
      kind, title, detail, order_id, amount_cents, payload, dedup_key, status
    ) values (
      'transfer_stuck',
      'Seller transfer requires reconciliation',
      new.detail,
      new.order_id,
      new.amount_cents,
      jsonb_build_object(
        'recovery_id', new.id,
        'recovery_key', new.recovery_key,
        'recovery_kind', new.kind
      ),
      'transfer-recovery:' || coalesce(new.recovery_key, new.id::text),
      'pending'
    )
    on conflict (dedup_key) do nothing;
  end if;
  return new;
end;
$$;

revoke all on function public.enqueue_transfer_recovery_alert()
  from public, anon, authenticated;

drop trigger if exists payment_recovery_transfer_alert
  on public.payment_recoveries;
create trigger payment_recovery_transfer_alert
after insert or update of status, detail, amount_cents, last_seen_at
on public.payment_recoveries
for each row execute function public.enqueue_transfer_recovery_alert();

-- Preserve the same invariant for open transfer recoveries that predate this
-- migration (transfer_after_refund existed in the original money schema).
insert into public.admin_alert_outbox (
  kind, title, detail, order_id, amount_cents, payload, dedup_key, status
)
select
  'transfer_stuck',
  'Seller transfer requires reconciliation',
  r.detail,
  r.order_id,
  r.amount_cents,
  jsonb_build_object(
    'recovery_id', r.id,
    'recovery_key', r.recovery_key,
    'recovery_kind', r.kind
  ),
  'transfer-recovery:' || coalesce(r.recovery_key, r.id::text),
  'pending'
from public.payment_recoveries r
where r.kind in ('transfer_after_refund', 'transfer_unresolved')
  and r.status = 'open'
on conflict (dedup_key) do nothing;

create or replace function public.record_transfer_recovery(
  p_order uuid,
  p_worker text,
  p_key text,
  p_detail text,
  p_amount int default null
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_result uuid;
begin
  if p_order is null
     or p_worker is null
     or p_key is null
     or p_detail is null
     or length(p_key) < 3
     or length(p_key) > 250 then
    raise exception 'Invalid transfer recovery identity';
  end if;

  -- Take the parent lock first, matching refund settlement and transfer
  -- completion. A stale owner returns null without changing state or audit.
  perform 1 from public.orders where id = p_order for key share;
  if not found then return null; end if;

  update public.transfer_intents
  set status = 'failed',
      attempts = greatest(attempts, 8),
      next_attempt_at = null,
      last_error = left(p_detail, 500),
      locked_at = null,
      locked_by = null,
      lease_expires_at = null,
      updated_at = now()
  where order_id = p_order
    and status = 'processing'
    and locked_by = p_worker
    and lease_expires_at > now()
    and transfer_reference is null;
  if not found then return null; end if;

  insert into public.payment_recoveries (
    order_id, kind, recovery_key, amount_cents, detail
  ) values (
    p_order,
    'transfer_unresolved',
    p_key,
    p_amount,
    left(p_detail, 1000)
  )
  on conflict (recovery_key) do update
  set last_seen_at = now(),
      detail = excluded.detail,
      amount_cents = excluded.amount_cents,
      status = 'open',
      resolved_by = null,
      resolved_at = null,
      resolution_note = null
  returning id into v_result;

  return v_result;
end;
$$;

revoke all on function public.record_transfer_recovery(uuid, text, text, text, int)
  from public, anon, authenticated;
grant execute on function public.record_transfer_recovery(uuid, text, text, text, int)
  to service_role;

notify pgrst, 'reload schema';
commit;
