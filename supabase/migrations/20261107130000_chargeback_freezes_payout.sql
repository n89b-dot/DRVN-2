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
--   5. settle_refund_operation    — (latest: 20261007100400) a full refund
--                                   cancels only payouts Stripe was never
--                                   called for. One whose call may have
--                                   happened goes to the reconciliation shelf
--                                   (2), so a late transfer is still found and
--                                   recorded with a 'transfer_after_refund'
--                                   case (4); the worker cancels it once its
--                                   attempt budget finds none. No automatic
--                                   reversal: an operator decides.
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
--    Changed: the order row is locked first (it waits for a chargeback
--    admission in progress, which locks the order before writing the
--    journal: section 6), then an unresolved chargeback refuses
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
  -- and record_transfer_recovery take the same order -> intent order). FOR
  -- UPDATE, not KEY SHARE: it must wait for any chargeback admission in
  -- progress, and every admission locks the order before it writes the
  -- journal (hold_stripe_dispute, apply_stripe_dispute_event: section 6),
  -- so the check below reads the journal as committed. (KEY SHARE let the
  -- check run first and only waited later, in guard_late_refund_payout's
  -- FOR UPDATE, after the decision was made. Taking FOR UPDATE here also
  -- means that trigger never has to upgrade a weaker lock.)
  perform 1 from public.orders where id = p_order for update;

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
    -- 20261107130000: a full refund now shelves such a payout ('holding',
    -- settle_refund_operation) instead of cancelling it; the same evidence
    -- applies to it, and to an exhausted one the refund left 'failed' with
    -- its operator case. Any other shelved row stays 'lost' here and is found
    -- by the worker's next reconciliation.
    if (
         v_intent.status = 'cancelled'
         or (v_intent.status in ('holding', 'failed')
             and (v_order.status = 'refunded' or v_order.refunded_cents >= v_order.total_cents))
       )
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

  -- 20261107130000: a transfer found (reconciled) after the order was fully
  -- refunded is recorded, and an operator decides on a reversal. Nothing is
  -- reversed automatically.
  if v_order.status = 'refunded' or v_order.refunded_cents >= v_order.total_cents then
    insert into public.payment_recoveries (
      order_id, kind, recovery_key, amount_cents, detail
    ) values (
      p_order,
      'transfer_after_refund',
      'transfer-adjustment:' || coalesce(v_operation_key, p_order::text) || ':' || p_transfer_reference,
      coalesce(v_dispatch_amount, v_intent.amount_cents),
      'Stripe transfer ' || p_transfer_reference ||
        ' was paid after the order was refunded; decide whether to reverse it from the seller.'
    )
    on conflict (recovery_key) do update
    set last_seen_at = now(), detail = excluded.detail,
        amount_cents = excluded.amount_cents, status = 'open',
        resolved_by = null, resolved_at = null, resolution_note = null;
    return 'recovery';
  end if;

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

-- ---------------------------------------------------------------------------
-- 5. Full refund. Latest: 20261007100400_carry_after_cancelled_payout.sql.
--    Changed (marked 20261107130000): the intent cancellation at the end.
-- ---------------------------------------------------------------------------

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

-- ---------------------------------------------------------------------------
-- 6. Chargeback admission takes the order locks first. Latest of both:
--    20260905195518_provider_dispute_ordering.sql. Changed (marked
--    20261107130000): one `for update` on the basket's orders before any
--    journal write. A partial or mismatched chargeback went to
--    hold_stripe_dispute before the explicit order lock, and an order
--    already in an in-app dispute was never locked at all, so a concurrent
--    dispatch could pass while the unresolved entry was still uncommitted.
-- ---------------------------------------------------------------------------

create or replace function public.hold_stripe_dispute(p_dispute text,p_detail text) returns text
language plpgsql security definer set search_path=public,pg_temp as $$
declare entry public.stripe_dispute_journal%rowtype; recovery uuid;
begin
 select * into strict entry from public.stripe_dispute_journal where dispute_id=p_dispute for update;
 -- 20261107130000: lock every order of the basket, already-disputed ones
 -- included, before the journal changes, so a concurrent
 -- prepare_transfer_dispatch (FOR UPDATE on the order, then the journal)
 -- waits for this commit and then sees the unresolved entry.
 perform 1 from public.orders where id=any(entry.order_ids) order by id for update;
 update public.stripe_dispute_journal set state='recovery',lease_id=null,lease_expires_at=null,updated_at=now() where dispute_id=p_dispute;
 -- Freeze the basket while attribution is reviewed; never infer that a
 -- partial chargeback refunded every order on its PaymentIntent.
 update public.orders set pre_dispute_status=status,status='disputed',disputed_at=now(),
  dispute_resolved_at=null,dispute_outcome=null,dispute_category='other',
  dispute_reason='Card dispute requires reconciliation — '||p_dispute,stripe_dispute_id=p_dispute
 where id=any(entry.order_ids) and status in ('paid','shipped','delivered','completed');
 insert into public.payment_recoveries(order_id,kind,recovery_key,amount_cents,detail)
 values(case when cardinality(entry.order_ids)=1 then entry.order_ids[1] else null end,
 'partial_refund_unattributed','stripe:dispute:'||p_dispute,entry.amount_cents,left(p_detail,2000))
 on conflict(recovery_key) do update set last_seen_at=now()
 returning id into recovery;
 insert into public.admin_alert_outbox(kind,title,detail,order_id,amount_cents,payload,dedup_key)
 values('recovery_case_opened','Card dispute requires reconciliation',left(p_detail,2000),
 case when cardinality(entry.order_ids)=1 then entry.order_ids[1] else null end,entry.amount_cents,
 jsonb_build_object('recovery_id',recovery,'dispute_id',p_dispute),'stripe-dispute:'||p_dispute)
 on conflict(dedup_key) do nothing;
 return 'recovery_recorded';
end $$;

create or replace function public.apply_stripe_dispute_event(
 p_dispute text,p_intent text,p_amount integer,p_currency text,p_status text,
 p_closed boolean,p_event text,p_created bigint,p_lease uuid
) returns text language plpgsql security definer set search_path=public,pg_temp as $$
declare entry public.stripe_dispute_journal%rowtype; ids uuid[]; total bigint;
 valid boolean; order_row public.orders%rowtype; prior_exists boolean;
begin
 if p_closed is null then raise exception 'Missing dispute event phase'; end if;
 if p_closed and (p_status in ('won','warning_closed','lost')) is distinct from true then return 'retry'; end if;
 if p_dispute is null or p_intent is null or p_event is null or p_lease is null or p_created is null or p_amount<=0 or p_currency!~'^[a-z]{3}$' then raise exception 'Invalid dispute event'; end if;
 perform pg_advisory_xact_lock(hashtextextended('stripe-dispute:'||p_intent,0));
 select * into entry from public.stripe_dispute_journal where dispute_id=p_dispute for update;
 prior_exists:=found;
 if prior_exists then
  if entry.payment_reference<>p_intent or entry.amount_cents<>p_amount or entry.currency<>p_currency then return public.hold_stripe_dispute(p_dispute,'Provider dispute identity, amount or currency changed. Reconcile against the original journal.'); end if;
  if entry.state='recovery' then return 'recovery_recorded'; end if;
  if not p_closed and entry.state<>'open' then return 'committed'; end if;
  if p_closed and entry.state in ('won','warning_closed','lost') then
   if entry.state=p_status then return 'committed'; end if;
   return public.hold_stripe_dispute(p_dispute,'Conflicting terminal provider dispute outcomes require review.');
  end if;
  if entry.state='loss_pending' and p_closed and p_status<>'lost' then return public.hold_stripe_dispute(p_dispute,'Conflicting terminal outcome during chargeback booking.'); end if;
  if entry.state='loss_pending' and entry.lease_expires_at>now() then return 'retry'; end if;
  if not p_closed and p_created<=entry.last_event_created then return 'committed'; end if;
 end if;
 select array_agg(distinct p.order_id order by p.order_id),sum(p.amount_cents),
 bool_and(lower(p.currency)=p_currency and p.status in ('succeeded','partially_refunded','refunded'))
 into ids,total,valid from public.payments p where p.provider='stripe' and p.provider_reference=p_intent;
 if ids is null then return 'retry'; end if;
 -- 20261107130000: the basket's orders are locked before any journal write
 -- below (the insert, or hold_stripe_dispute), in the order dispatch uses.
 perform 1 from public.orders where id=any(ids) order by id for update;
 if not prior_exists then
  insert into public.stripe_dispute_journal(dispute_id,payment_reference,amount_cents,currency,state,last_event_id,last_event_created,order_ids)
  values(p_dispute,p_intent,p_amount,p_currency,'open',p_event,p_created,ids)
  returning * into entry;
 end if;
 if cardinality(ids)>50 then return public.hold_stripe_dispute(p_dispute,'Dispute basket exceeds the bounded automatic-processing limit.'); end if;
 if ids is distinct from entry.order_ids or total<>p_amount or valid is distinct from true then
  return public.hold_stripe_dispute(p_dispute,'The dispute does not exactly match the frozen payment basket and currency. Allocate the provider amount before booking any refund.');
 end if;
 perform id from public.orders where id=any(ids) order by id for update;
 if (select sum(total_cents) from public.orders where id=any(ids))<>p_amount or exists(select 1 from public.orders o where o.id=any(ids) and lower(o.currency)<>p_currency) then
  return public.hold_stripe_dispute(p_dispute,'Order and provider dispute currencies differ.');
 end if;
 if p_closed and p_status not in ('won','warning_closed','lost') then return 'retry'; end if;
 -- Won/closed-before-created is journaled without inventing a prior hold.
 if p_closed and p_status in ('won','warning_closed') then
  if exists(select 1 from public.orders o where o.id=any(ids) and o.status='disputed' and o.stripe_dispute_id=p_dispute and o.dispute_reason not like '% — '||p_dispute) then
   return public.hold_stripe_dispute(p_dispute,'A newer in-app dispute owns an order; provider closure cannot resolve it.');
  end if;
  update public.orders set status=coalesce(pre_dispute_status,'paid'),dispute_resolved_at=now()
   where id=any(ids) and status='disputed' and stripe_dispute_id=p_dispute
   and dispute_reason like '% — '||p_dispute;
  update public.stripe_dispute_journal set state=p_status,last_event_id=p_event,last_event_created=p_created,updated_at=now() where dispute_id=p_dispute;
  return 'committed';
 end if;
 if exists(select 1 from public.orders o where o.id=any(ids) and (
  (o.status='disputed' and o.stripe_dispute_id is distinct from p_dispute)
  or (o.status not in ('paid','shipped','delivered','completed','disputed') and entry.state<>'loss_pending')
  or (p_status='lost' and p_closed and o.refunded_cents>0 and entry.state<>'loss_pending')
 )) then return public.hold_stripe_dispute(p_dispute,'Existing order/dispute/refund state prevents safe automatic chargeback allocation.'); end if;
 for order_row in select * from public.orders where id=any(ids) loop
  if order_row.status<>'disputed' and entry.state<>'loss_pending' then
   update public.orders set status='disputed',pre_dispute_status=order_row.status,
    disputed_at=now(),dispute_resolved_at=null,dispute_outcome=null,dispute_category='other',
    dispute_reason='Card dispute via Stripe — '||p_dispute,stripe_dispute_id=p_dispute
   where id=order_row.id;
  end if;
 end loop;
 update public.stripe_dispute_journal set state=case when p_closed then 'loss_pending' else 'open' end,
 last_event_id=p_event,last_event_created=p_created,
 lease_id=case when p_closed then p_lease else null end,
 lease_expires_at=case when p_closed then now()+interval '5 minutes' else null end,updated_at=now()
 where dispute_id=p_dispute;
 return case when p_closed then 'apply_loss' else 'committed' end;
end $$;

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
revoke all on function public.settle_refund_operation(uuid) from public, anon, authenticated;
grant execute on function public.settle_refund_operation(uuid) to service_role;
revoke all on function public.hold_stripe_dispute(text, text) from public, anon, authenticated;
grant execute on function public.hold_stripe_dispute(text, text) to service_role;
revoke all on function public.apply_stripe_dispute_event(text, text, integer, text, text, boolean, text, bigint, uuid) from public, anon, authenticated;
grant execute on function public.apply_stripe_dispute_event(text, text, integer, text, text, boolean, text, bigint, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 7. Self-checks
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
