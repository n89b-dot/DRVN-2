-- 20261107130000 — an unresolved bank chargeback freezes the seller's payout
-- (readiness B9; items N13 and N223; ruled by Neil, 7 Nov 2026).
--
-- The rule: an open bank chargeback freezes the seller's payout. Closing an
-- in-app dispute, by the buyer or an admin, or a refund completing, can never
-- make a payout eligible while a chargeback is unresolved.
--
-- What was wrong: payout eligibility looked only at the order's status
-- (mark_due_transfer_intents, 0020). A buyer closing their in-app dispute
-- (closeDispute), an admin resolving it for the seller
-- (execute_admin_command 'dispute.resolve_for_seller') and a dispute-resolving
-- refund (settle_refund_operation) all put the order back to its pre-dispute
-- status, and the next cron pass marked the payout ready while the bank's
-- case was still running. When the in-app dispute came first, the chargeback
-- doesn't even own the order's dispute fields: hold_stripe_dispute records it
-- only in the provider journal.
--
-- The truth is therefore the provider dispute JOURNAL
-- (stripe_dispute_journal, 20260905195518), not orders.stripe_dispute_id,
-- which provider closure leaves set. A chargeback is unresolved unless its
-- journal entry reached a terminal provider outcome: won, warning_closed or
-- lost. 'open', 'loss_pending' (a loss being booked) and 'recovery' (held for
-- an operator) all freeze, and so would any state added later.
--
-- Enforced at every step that moves money towards a seller:
--
--   1. mark_due_transfer_intents  — transfer readiness (latest: 0020)
--   2. claim_transfer_intents     — fresh-transfer admission (latest:
--                                   20260905173052). A row whose provider call
--                                   may already have happened is still
--                                   admitted: it must reconcile, never be
--                                   abandoned. That includes one shelved
--                                   ('holding') during the chargeback once its
--                                   reconciliation backoff (next_attempt_at)
--                                   is due — Stripe may complete an in-flight
--                                   request after a lookup found nothing.
--   3. prepare_transfer_dispatch  — the last durable boundary before Stripe
--                                   (latest: 20260905173052). Refuses, and
--                                   puts the row back on the shelf ('holding')
--                                   under the caller's live lease, keeping any
--                                   frozen payload so a later pass reconciles
--                                   it with the same idempotency key instead
--                                   of issuing a second transfer. A row whose
--                                   provider call may have happened is shelved
--                                   with a reconciliation time, so it comes
--                                   back for reconciliation (2) while the
--                                   chargeback lasts.
--   4. complete_transfer_intent   — a transfer found (reconciled) while a
--                                   chargeback is unresolved is recorded and
--                                   opens a transfer_unresolved recovery for
--                                   an operator, like one found while the
--                                   order was disputed (latest:
--                                   20261005110100).
--
-- The worker (src/lib/payments/transfer-worker.ts) reads the same journal on
-- both of its order reads.
--
-- Unchanged: the release timing (available_at, paid 2 days after delivery),
-- the in-app dispute rules, refunds, fees and holds. When the chargeback is
-- won or closed as a warning, the payout resumes on its normal schedule; when
-- it is lost, the order is refunded and the payout cancels as before.
--
-- Idempotent: create or replace, if not exists.

begin;

-- ---------------------------------------------------------------------------
-- 0. The one definition of "unresolved"
-- ---------------------------------------------------------------------------

create index if not exists stripe_dispute_journal_order_ids_idx
  on public.stripe_dispute_journal using gin (order_ids);

-- Private: only the definer functions below call it. Resolved means a
-- terminal provider outcome; anything else, including a state added later,
-- fails closed.
create or replace function private.order_has_unresolved_chargeback(p_order uuid)
returns boolean
language sql
stable
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.stripe_dispute_journal j
    where j.order_ids @> array[p_order]
      and j.state not in ('won', 'warning_closed', 'lost')
  );
$$;

revoke all on function private.order_has_unresolved_chargeback(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 1. Readiness. Latest: 0020_transfer_scheduling.sql. Changed: the chargeback
--    condition. The window (available_at) is untouched.
-- ---------------------------------------------------------------------------

create or replace function public.mark_due_transfer_intents()
returns int
language sql
security definer
set search_path = public, pg_temp
as $$
  with marked as (
    update public.transfer_intents ti
    set status = 'ready', updated_at = now()
    from public.orders o
    where ti.order_id = o.id
      and ti.status = 'holding'
      and ti.available_at is not null
      and ti.available_at <= now()
      and o.status in ('delivered', 'completed')
      and not private.order_has_unresolved_chargeback(o.id)
    returning ti.order_id
  )
  select count(*)::int from marked;
$$;

-- ---------------------------------------------------------------------------
-- 2. Admission. Latest: 20260905173052_transfer_dispatch_recovery.sql.
--    Changed: a fresh (provider-certain) row on an order with an unresolved
--    chargeback is not admitted; it waits where it is and is admitted on the
--    first pass after the chargeback resolves. Uncertain rows and expired
--    leases are admitted exactly as before, and an uncertain row shelved
--    with a reconciliation time is admitted when that time is due, whatever
--    the chargeback or the order's status: the worker shelves every absent
--    uncertain payout that isn't payable now (chargeback unresolved, order
--    disputed or undelivered, clearing time ahead) that way, reconciles it
--    against Stripe on each due pass (recording any transfer it finds), never
--    creates a new one until it is payable, and asks an operator when its
--    attempt budget is spent. Fresh rows are shelved without a
--    next_attempt_at and keep waiting for readiness, as before.
-- ---------------------------------------------------------------------------

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
        and (
          provider_call_may_have_occurred
          or not private.order_has_unresolved_chargeback(order_id)
        )
      )
      or (
        status = 'holding'
        and provider_call_may_have_occurred
        and next_attempt_at is not null
        and next_attempt_at <= now()
        and attempts < p_max_attempts
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

-- ---------------------------------------------------------------------------
-- 3. Dispatch. Latest: 20260905173052_transfer_dispatch_recovery.sql.
--    Changed: the order row is key-share locked first (the lock a provider
--    dispute admission conflicts with), then an unresolved chargeback refuses
--    the dispatch and returns the row to 'holding' under the caller's live
--    lease. Returns false, as for a lost lease: the caller must not call
--    Stripe and must not touch the row again.
--
--    A row that never froze a payload (nothing has left DRVN) also drops its
--    carry-forward decision, which freeze_transfer_carry may re-decide freely,
--    so a frozen payout doesn't reserve the seller's carried charges. A row
--    with a frozen payload or a possible provider call keeps everything:
--    operation key, payload, carry and the uncertainty flag, and is given a
--    reconciliation time five minutes out, so claim_transfer_intents brings
--    it back to reconcile (the worker then backs off on its own schedule).
-- ---------------------------------------------------------------------------

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

  -- 20261107130000: parent lock first (refund settlement, transfer completion
  -- and record_transfer_recovery take the same order -> intent order).
  perform 1 from public.orders where id = p_order for key share;

  if private.order_has_unresolved_chargeback(p_order) then
    update public.transfer_intents
    set status = 'holding',
        dispatch_carry_cents = case
          when operation_key is null and not provider_call_may_have_occurred then null
          else dispatch_carry_cents
        end,
        next_attempt_at = case
          when operation_key is null and not provider_call_may_have_occurred then null
          else now() + interval '5 minutes'
        end,
        last_error = 'Payout frozen: a bank chargeback on this order is unresolved',
        locked_at = null,
        locked_by = null,
        lease_expires_at = null,
        updated_at = now()
    where order_id = p_order
      and status = 'processing'
      and locked_by = p_worker
      and lease_expires_at > now();
    return false;
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

-- ---------------------------------------------------------------------------
-- 4. Completion. Latest: 20261005110100_seller_carry_forward.sql. Changed
--    (marked 20261107130000): an unresolved chargeback joins the "completed
--    while not payable" recovery condition. The transfer is still recorded.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.complete_transfer_intent(p_order uuid, p_worker text, p_operation_key text, p_transfer_reference text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_order record;
  v_intent public.transfer_intents;
  v_dispatch_amount int;
  v_operation_key text;
  v_adjustments int;
  v_current_payable int;
  -- 20261107130000
  v_chargeback boolean;
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

  -- 20261107130000: read under the order lock, which a provider dispute
  -- admission also takes before it changes the order.
  v_chargeback := private.order_has_unresolved_chargeback(p_order);

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
    + v_adjustments
    -- 20261005110100: the dispatch already took the frozen carry-forward
    -- collection off; compare like with like.
    - coalesce(v_intent.dispatch_carry_cents, 0);

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

  -- 20261107130000: a transfer found while a bank chargeback is unresolved is
  -- still recorded (it happened), and an operator is told, exactly as for a
  -- transfer that completed while the order was disputed.
  if (v_order.status in ('delivered', 'completed')) is not true
     or (v_intent.available_at is not null and v_intent.available_at > now())
     or v_chargeback then
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
        end ||
        case when v_chargeback then ' and a bank chargeback on it was unresolved' else '' end
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
$function$;

-- create or replace keeps each function's grants; restate them so this file
-- alone shows who may call what.
revoke all on function public.mark_due_transfer_intents() from public, anon, authenticated;
grant execute on function public.mark_due_transfer_intents() to service_role;
revoke all on function public.claim_transfer_intents(text, int, int, int) from public, anon, authenticated;
grant execute on function public.claim_transfer_intents(text, int, int, int) to service_role;
revoke all on function public.prepare_transfer_dispatch(uuid, text, text, int, text, text, text, text) from public, anon, authenticated;
grant execute on function public.prepare_transfer_dispatch(uuid, text, text, int, text, text, text, text) to service_role;
revoke all on function public.complete_transfer_intent(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.complete_transfer_intent(uuid, text, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- 5. Self-checks
-- ---------------------------------------------------------------------------

do $$
begin
  if has_function_privilege('authenticated', 'private.order_has_unresolved_chargeback(uuid)', 'execute')
     or has_function_privilege('anon', 'private.order_has_unresolved_chargeback(uuid)', 'execute') then
    raise exception 'SELF-CHECK FAILED: the chargeback predicate is client-callable';
  end if;
  if has_function_privilege('authenticated', 'public.prepare_transfer_dispatch(uuid,text,text,int,text,text,text,text)', 'execute')
     or has_function_privilege('authenticated', 'public.claim_transfer_intents(text,int,int,int)', 'execute')
     or has_function_privilege('authenticated', 'public.mark_due_transfer_intents()', 'execute')
     or has_function_privilege('authenticated', 'public.complete_transfer_intent(uuid,text,text,text)', 'execute') then
    raise exception 'SELF-CHECK FAILED: a transfer function is client-callable';
  end if;
  raise notice 'PASS: 20261107130000 self-checks';
end $$;

notify pgrst, 'reload schema';
commit;
