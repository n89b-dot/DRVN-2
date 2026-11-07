-- An unresolved bank chargeback freezes the seller's payout
-- (20261107130000; readiness B9, items N13 and N223; ruled 7 Nov 2026).
--
-- Closing an in-app dispute (the buyer's closeDispute, an admin's
-- dispute.resolve_for_seller) or a dispute-resolving refund completing puts
-- the order back to delivered. Whatever did it, while the chargeback's
-- journal entry is open, recovery or loss_pending the payout is refused at
-- readiness (mark_due_transfer_intents), fresh admission
-- (claim_transfer_intents) and dispatch (prepare_transfer_dispatch). A won
-- chargeback lets the normal schedule resume. A transfer whose provider call
-- may already have happened is still reconciled, never abandoned and never
-- sent twice: shelved with a backed-off reconciliation time that admission
-- honours during the chargeback, so a request Stripe completes late is still
-- recorded. Every fixture order is delivered and past its clearing time,
-- so the chargeback is the only thing standing between it and a payout.
-- Disposable database only; everything rolls back.
begin;

create function pg_temp.w18_order(p_buyer uuid, p_seller uuid, p_intent text,
  p_available timestamptz default now() - interval '1 day')
returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into public.orders(buyer_id, seller_id, status, subtotal_cents, platform_fee_cents,
    total_cents, currency, delivered_at)
  values (p_buyer, p_seller, 'delivered', 10000, 1000, 10000, 'USD', now() - interval '3 days')
  returning id into v;
  insert into public.payments(order_id, provider, provider_reference, status, amount_cents, currency)
  values (v, 'stripe', p_intent, 'succeeded', 10000, 'USD');
  insert into public.transfer_intents(order_id, seller_id, amount_cents, currency, status, available_at)
  values (v, p_seller, 9000, 'USD', 'holding', p_available);
  return v;
end $$;

-- The buyer opens an in-app dispute (dispute-command.ts).
create function pg_temp.w18_open_in_app(p_order uuid) returns void language sql as $$
  update public.orders
  set status = 'disputed', pre_dispute_status = status, disputed_at = now(),
      dispute_category = 'item_not_as_described', dispute_reason = 'Not the part in the photos',
      dispute_resolved_at = null, dispute_outcome = null
  where id = p_order;
$$;

-- The buyer closes it: the exact update closeDispute
-- (src/features/commerce/dispute-actions.ts) makes.
create function pg_temp.w18_buyer_close(p_order uuid) returns void language plpgsql as $$
begin
  update public.orders
  set status = coalesce(pre_dispute_status, 'delivered'),
      dispute_resolved_at = now(),
      dispute_outcome = 'closed_by_buyer',
      refund_offer_cents = null,
      refund_offered_at = null
  where id = p_order and status = 'disputed';
  if not found then raise exception 'Fixture: buyer close found no disputed order'; end if;
end $$;

-- An admin resolves it for the seller through the real command
-- (adminResolveForSeller -> auditedAction -> execute_admin_command).
create function pg_temp.w18_admin_close(p_admin uuid, p_order uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', p_admin, 'role', 'authenticated',
    'aal', 'aal2', 'amr', json_build_array(json_build_object('method', 'totp',
    'timestamp', extract(epoch from now())::bigint)))::text, true);
  perform public.execute_admin_command('dispute.resolve_for_seller', p_order, 'chargeback guard: seller shipped');
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
end $$;

-- Readiness: run the cron's pure-SQL half, report this intent's status.
create function pg_temp.w18_after_mark(p_order uuid) returns text language plpgsql as $$
begin
  perform public.mark_due_transfer_intents();
  return (select status from public.transfer_intents where order_id = p_order);
end $$;

-- Admission: a ready intent, then a worker's claim. True when it was admitted.
create function pg_temp.w18_admitted(p_order uuid) returns boolean language plpgsql as $$
begin
  update public.transfer_intents set status = 'ready', updated_at = now() - interval '1 year'
  where order_id = p_order and status in ('holding', 'ready');
  return exists (select 1 from public.claim_transfer_intents('w18-probe', 200, 300, 8) c
                 where c.order_id = p_order);
end $$;

-- Dispatch: a worker that claimed before the chargeback, at the last boundary.
create function pg_temp.w18_dispatch(p_order uuid, p_intent text) returns boolean language plpgsql as $$
begin
  update public.transfer_intents
  set status = 'processing', locked_by = 'w18-worker', locked_at = now(),
      lease_expires_at = now() + interval '5 minutes'
  where order_id = p_order;
  return public.prepare_transfer_dispatch(p_order, 'w18-worker', 'transfer:' || p_order::text,
    9000, 'usd', 'acct_w18_seller', 'ch_' || p_intent, p_intent);
end $$;

-- All three gates refuse; the refused dispatch shelves the row cleanly.
create function pg_temp.w18_assert_frozen(p_label text, p_order uuid, p_intent text)
returns void language plpgsql as $$
declare v_status text;
begin
  if (select status from public.orders where id = p_order) <> 'delivered' then
    raise exception 'Fixture %: the close did not put the order back to delivered', p_label;
  end if;
  v_status := pg_temp.w18_after_mark(p_order);
  if v_status <> 'holding' then
    raise exception 'FAIL %: readiness marked the payout % during an unresolved chargeback', p_label, v_status;
  end if;
  if pg_temp.w18_admitted(p_order) then
    raise exception 'FAIL %: a fresh payout was admitted during an unresolved chargeback', p_label;
  end if;
  if pg_temp.w18_dispatch(p_order, p_intent) then
    raise exception 'FAIL %: dispatch was prepared during an unresolved chargeback', p_label;
  end if;
  if not exists (
    select 1 from public.transfer_intents
    where order_id = p_order and status = 'holding' and locked_by is null
      and lease_expires_at is null and operation_key is null
      and dispatch_amount_cents is null and not provider_call_may_have_occurred
      and next_attempt_at is null
      and last_error like 'Payout frozen: a bank chargeback%'
  ) then
    raise exception 'FAIL %: the refused dispatch did not return the payout to the shelf untouched', p_label;
  end if;
  -- A shelved fresh payout waits for readiness: no claim admits it.
  if exists (select 1 from public.claim_transfer_intents('w18-shelf', 200, 300, 8) c where c.order_id = p_order) then
    raise exception 'FAIL %: a shelved fresh payout was admitted during an unresolved chargeback', p_label;
  end if;
end $$;

do $$
declare
  seller uuid := gen_random_uuid();
  buyer uuid := gen_random_uuid();
  actor uuid := gen_random_uuid();
  lease uuid := gen_random_uuid();
  o uuid;
  r jsonb;
  v_result text;
  v_ok boolean;
  v_status text;
begin
  insert into auth.users(id, email) values
    (seller, 'w18-seller@example.test'), (buyer, 'w18-buyer@example.test'),
    (actor, 'w18-admin@example.test');
  insert into public.admin_users(user_id) values (actor);

  -- 1. In-app dispute first, then the chargeback. The chargeback can't own the
  --    order's dispute fields, so it is only in the journal ('recovery') and
  --    orders.stripe_dispute_id stays null. The buyer closes the in-app case.
  o := pg_temp.w18_order(buyer, seller, 'pi_w18_recovery');
  perform pg_temp.w18_open_in_app(o);
  v_result := public.apply_stripe_dispute_event('dp_w18_recovery', 'pi_w18_recovery', 10000, 'usd',
    'needs_response', false, 'evt_w18_recovery', 100, lease);
  if v_result <> 'recovery_recorded'
     or (select state from public.stripe_dispute_journal where dispute_id = 'dp_w18_recovery') <> 'recovery'
     or (select stripe_dispute_id from public.orders where id = o) is not null then
    raise exception 'Fixture 1: expected a journal-only chargeback in recovery (got %)', v_result;
  end if;
  perform pg_temp.w18_buyer_close(o);
  perform pg_temp.w18_assert_frozen('1 (recovery, buyer close)', o, 'pi_w18_recovery');
  raise notice 'PASS 1: a recovering chargeback recorded only in the journal freezes readiness, admission and dispatch after the buyer closes';

  -- 2. The chargeback owns the dispute ('open'); the buyer closes it in-app.
  o := pg_temp.w18_order(buyer, seller, 'pi_w18_open');
  v_result := public.apply_stripe_dispute_event('dp_w18_open', 'pi_w18_open', 10000, 'usd',
    'needs_response', false, 'evt_w18_open', 200, lease);
  if v_result <> 'committed' or (select status from public.orders where id = o) <> 'disputed' then
    raise exception 'Fixture 2: open chargeback not admitted (%)', v_result;
  end if;
  perform pg_temp.w18_buyer_close(o);
  perform pg_temp.w18_assert_frozen('2 (open, buyer close)', o, 'pi_w18_open');
  raise notice 'PASS 2: an open chargeback freezes readiness, admission and dispatch after the buyer closes';

  -- 3. The loss is being booked ('loss_pending'); the buyer closes in-app.
  o := pg_temp.w18_order(buyer, seller, 'pi_w18_loss');
  v_result := public.apply_stripe_dispute_event('dp_w18_loss', 'pi_w18_loss', 10000, 'usd',
    'lost', true, 'evt_w18_loss', 300, lease);
  if v_result <> 'apply_loss'
     or (select state from public.stripe_dispute_journal where dispute_id = 'dp_w18_loss') <> 'loss_pending' then
    raise exception 'Fixture 3: expected loss_pending (got %)', v_result;
  end if;
  perform pg_temp.w18_buyer_close(o);
  perform pg_temp.w18_assert_frozen('3 (loss_pending, buyer close)', o, 'pi_w18_loss');
  raise notice 'PASS 3: a loss-pending chargeback freezes readiness, admission and dispatch after the buyer closes';

  -- 4. An admin resolves an open chargeback's dispute for the seller.
  o := pg_temp.w18_order(buyer, seller, 'pi_w18_admin');
  perform public.apply_stripe_dispute_event('dp_w18_admin', 'pi_w18_admin', 10000, 'usd',
    'needs_response', false, 'evt_w18_admin_open', 400, lease);
  perform pg_temp.w18_admin_close(actor, o);
  if (select dispute_outcome from public.orders where id = o) <> 'admin_resolved' then
    raise exception 'Fixture 4: the admin command did not resolve the dispute';
  end if;
  perform pg_temp.w18_assert_frozen('4 (open, admin close)', o, 'pi_w18_admin');
  raise notice 'PASS 4: an open chargeback freezes the payout after an admin resolves the dispute for the seller';

  -- 5. A dispute-resolving partial refund completes during an open chargeback
  --    (begin_refund_operation + settle_refund_operation restore delivered).
  o := pg_temp.w18_order(buyer, seller, 'pi_w18_refund');
  perform pg_temp.w18_open_in_app(o);
  perform public.apply_stripe_dispute_event('dp_w18_refund', 'pi_w18_refund', 10000, 'usd',
    'needs_response', false, 'evt_w18_refund_open', 500, lease);
  r := public.begin_refund_operation(
    p_order_id => o, p_amount_cents => 2500, p_reason => 'chargeback guard: accepted offer',
    p_requested_by => 'stripe:webhook', p_actor_role => 'system', p_resolve_dispute => true,
    p_dispute_outcome => 'refund_accepted', p_payment_reference => 'pi_w18_refund', p_external => true);
  r := public.settle_refund_operation((r->>'operation_id')::uuid);
  if (select refunded_cents from public.orders where id = o) <> 2500 then
    raise exception 'Fixture 5: the partial refund did not settle (%)', r;
  end if;
  perform pg_temp.w18_assert_frozen('5 (recovery, refund completed)', o, 'pi_w18_refund');
  raise notice 'PASS 5: a completed dispute-resolving refund cannot release the payout during a chargeback';

  -- 6. The admin-closed chargeback (4) is won. Provider closure leaves
  --    orders.stripe_dispute_id set; the journal says it is resolved, and the
  --    payout resumes on its own schedule, at every gate.
  o := (select id from public.orders where stripe_dispute_id = 'dp_w18_admin');
  v_result := public.apply_stripe_dispute_event('dp_w18_admin', 'pi_w18_admin', 10000, 'usd',
    'won', true, 'evt_w18_admin_won', 410, lease);
  if v_result <> 'committed'
     or (select state from public.stripe_dispute_journal where dispute_id = 'dp_w18_admin') <> 'won'
     or (select stripe_dispute_id from public.orders where id = o) is distinct from 'dp_w18_admin' then
    raise exception 'Fixture 6: expected a won journal with the provider id still on the order (got %)', v_result;
  end if;
  v_status := pg_temp.w18_after_mark(o);
  if v_status <> 'ready' then
    raise exception 'FAIL 6: readiness did not resume after the chargeback was won (%)', v_status;
  end if;
  if not exists (select 1 from public.claim_transfer_intents('w18-won', 200, 300, 8) c where c.order_id = o) then
    raise exception 'FAIL 6: the payout was not admitted after the chargeback was won';
  end if;
  v_ok := public.prepare_transfer_dispatch(o, 'w18-won', 'transfer:' || o::text, 9000, 'usd',
    'acct_w18_seller', 'ch_pi_w18_admin', 'pi_w18_admin');
  if not v_ok then
    raise exception 'FAIL 6: dispatch was refused after the chargeback was won';
  end if;
  raise notice 'PASS 6: a won chargeback lets readiness, admission and dispatch resume';

  -- 7. The schedule itself is unchanged: a won chargeback releases nothing
  --    before the order's clearing time, and then it does.
  o := pg_temp.w18_order(buyer, seller, 'pi_w18_schedule', now() + interval '1 day');
  perform public.apply_stripe_dispute_event('dp_w18_schedule', 'pi_w18_schedule', 10000, 'usd',
    'needs_response', false, 'evt_w18_schedule_open', 700, lease);
  perform pg_temp.w18_admin_close(actor, o);
  perform public.apply_stripe_dispute_event('dp_w18_schedule', 'pi_w18_schedule', 10000, 'usd',
    'won', true, 'evt_w18_schedule_won', 710, lease);
  if pg_temp.w18_after_mark(o) <> 'holding' then
    raise exception 'FAIL 7: a won chargeback released the payout before its clearing time';
  end if;
  update public.transfer_intents set available_at = now() - interval '1 second' where order_id = o;
  if pg_temp.w18_after_mark(o) <> 'ready' then
    raise exception 'FAIL 7: the payout did not release at its clearing time after a won chargeback';
  end if;
  raise notice 'PASS 7: after a win the payout follows its normal clearing time';

  -- 8. A row whose provider call may already have happened is still admitted
  --    during a chargeback (it must reconcile), its refused re-dispatch keeps
  --    the frozen request and the uncertainty, and a transfer found at Stripe
  --    is recorded once with an operator case, not dropped or re-sent.
  o := pg_temp.w18_order(buyer, seller, 'pi_w18_uncertain');
  perform public.apply_stripe_dispute_event('dp_w18_uncertain', 'pi_w18_uncertain', 10000, 'usd',
    'needs_response', false, 'evt_w18_uncertain_open', 800, lease);
  perform pg_temp.w18_buyer_close(o);
  update public.transfer_intents
  set status = 'ready', updated_at = now() - interval '1 year',
      operation_key = 'transfer:' || o::text, dispatch_amount_cents = 9000, dispatch_currency = 'usd',
      dispatch_destination = 'acct_w18_seller', dispatch_source_transaction = 'ch_pi_w18_uncertain',
      dispatch_transfer_group = 'pi_w18_uncertain', provider_call_may_have_occurred = true
  where order_id = o;
  if not exists (select 1 from public.claim_transfer_intents('w18-reconcile', 200, 300, 8) c where c.order_id = o) then
    raise exception 'FAIL 8: an uncertain payout was abandoned (not admitted) during a chargeback';
  end if;
  v_ok := public.prepare_transfer_dispatch(o, 'w18-reconcile', 'transfer:' || o::text, 9000, 'usd',
    'acct_w18_seller', 'ch_pi_w18_uncertain', 'pi_w18_uncertain');
  if v_ok or not exists (
    select 1 from public.transfer_intents
    where order_id = o and status = 'holding' and locked_by is null
      and operation_key = 'transfer:' || o::text and dispatch_amount_cents = 9000
      and provider_call_may_have_occurred
      and next_attempt_at between now() + interval '4 minutes' and now() + interval '6 minutes'
  ) then
    raise exception 'FAIL 8: a refused uncertain re-dispatch lost its frozen request, uncertainty or reconciliation time';
  end if;
  if pg_temp.w18_after_mark(o) <> 'holding' then
    raise exception 'FAIL 8: readiness re-marked a shelved uncertain payout during the chargeback';
  end if;
  if exists (select 1 from public.claim_transfer_intents('w18-early', 200, 300, 8) c where c.order_id = o) then
    raise exception 'FAIL 8: a shelved uncertain payout was admitted before its reconciliation time';
  end if;
  -- Five minutes pass. Still during the chargeback, a real claim brings the
  -- row back to reconcile, with its request and uncertainty intact.
  update public.transfer_intents set next_attempt_at = now() - interval '1 second' where order_id = o;
  if not exists (
    select 1 from public.claim_transfer_intents('w18-reconcile-2', 200, 300, 8) c
    where c.order_id = o and c.provider_call_may_have_occurred
      and c.operation_key = 'transfer:' || o::text and c.dispatch_amount_cents = 9000
  ) then
    raise exception 'FAIL 8: a shelved uncertain payout became unreachable for reconciliation during the chargeback';
  end if;
  -- Stripe still shows nothing, so the worker shelves it again with backoff
  -- (the release the worker makes, transfer-worker.ts).
  if not public.release_transfer_intent(o, 'w18-reconcile-2', 'holding',
       'Payout frozen: a bank chargeback on this order is unresolved', 1, now() + interval '2 minutes') then
    raise exception 'Fixture 8: the worker could not shelve the reconciled row';
  end if;
  if exists (select 1 from public.claim_transfer_intents('w18-early', 200, 300, 8) c where c.order_id = o) then
    raise exception 'FAIL 8: the backoff was not respected';
  end if;
  -- Meanwhile the in-flight request completes at Stripe. The next due pass is
  -- admitted and records the transfer it finds, with an operator case.
  update public.transfer_intents set next_attempt_at = now() - interval '1 second' where order_id = o;
  if not exists (select 1 from public.claim_transfer_intents('w18-reconcile-3', 200, 300, 8) c where c.order_id = o) then
    raise exception 'FAIL 8: the backed-off reconciliation was not admitted';
  end if;
  v_result := public.complete_transfer_intent(o, 'w18-reconcile-3', 'transfer:' || o::text, 'tr_w18_found');
  if v_result <> 'recovery' then
    raise exception 'FAIL 8: a transfer found during a chargeback completed silently (%)', v_result;
  end if;
  if not exists (
    select 1 from public.orders ord join public.transfer_intents ti on ti.order_id = ord.id
    where ord.id = o and ord.transfer_reference = 'tr_w18_found'
      and ti.status = 'transferred' and ti.transfer_reference = 'tr_w18_found'
  ) or not exists (
    select 1 from public.payment_recoveries
    where recovery_key = 'transfer-unresolved:' || o::text and kind = 'transfer_unresolved'
      and status = 'open' and detail like '%bank chargeback on it was unresolved%'
  ) then
    raise exception 'FAIL 8: the found transfer was not recorded with an open operator case';
  end if;
  if exists (select 1 from public.claim_transfer_intents('w18-again', 200, 300, 8) c where c.order_id = o) then
    raise exception 'FAIL 8: a recorded transfer was admitted again';
  end if;
  raise notice 'PASS 8: uncertain payouts stay reachable for reconciliation through a chargeback, with backoff, keep their request, record a late transfer and are never sent twice';

  -- 9. The predicate stays private.
  if has_function_privilege('authenticated', 'private.order_has_unresolved_chargeback(uuid)', 'execute')
     or has_function_privilege('anon', 'private.order_has_unresolved_chargeback(uuid)', 'execute')
     or has_function_privilege('service_role', 'private.order_has_unresolved_chargeback(uuid)', 'execute') then
    raise exception 'FAIL 9: the chargeback predicate is callable by a client role';
  end if;
  raise notice 'PASS 9: the chargeback predicate is private';

  raise notice 'all chargeback payout freeze checks passed';
end $$;

rollback;
