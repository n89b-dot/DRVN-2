-- Settlement correctness and reconciliation (20261107210100; OS-W20, readiness
-- N114, N8, N115).
--
-- N114: payout admission is fair. A queue whose oldest rows are sellers who
-- can't be paid ('blocked_unpayable', nothing sent) no longer fills the batch:
-- those rows aren't admitted until the seller is payable, a blocked row whose
-- provider call may have happened still reconciles, and due work is served
-- longest-due first. Readiness and payout dates are untouched.
-- N8: an exhausted payout can be queued again by an operator through
-- admin_retry_transfer_intent, which resets only its attempt budget: the
-- frozen request and the provider-call flag stay, and admission still
-- refuses it while a chargeback is unresolved.
-- N115: the ledger reconciliation's case kind, run log, worker and schedule.
-- Disposable database only; everything rolls back.
begin;

create function pg_temp.w20_order(p_buyer uuid, p_seller uuid, p_intent text, p_status text,
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
  values (v, p_seller, 9000, 'USD', p_status, p_available);
  return v;
end $$;

-- The rows one claim admits, by order id.
create function pg_temp.w20_claim(p_worker text, p_batch int) returns uuid[] language sql as $$
  select coalesce(array_agg(order_id), '{}') from public.claim_transfer_intents(p_worker, p_batch, 300, 8);
$$;

do $$
declare
  unpaid uuid := gen_random_uuid();
  paid uuid := gen_random_uuid();
  buyer uuid := gen_random_uuid();
  lease uuid := gen_random_uuid();
  blocked uuid[] := '{}';
  ready_order uuid;
  payable_blocked uuid;
  uncertain uuid;
  uncertain_later uuid;
  oldest uuid;
  middle uuid;
  newest uuid;
  exhausted uuid;
  frozen_cb uuid;
  claimed uuid[];
  v_result jsonb;
  v_text text;
  i int;
begin
  insert into auth.users(id, email) values
    (unpaid, 'w20-unpaid@example.test'), (paid, 'w20-paid@example.test'), (buyer, 'w20-buyer@example.test');
  update public.profiles set stripe_account_id = null, payouts_enabled = false where id = unpaid;
  update public.profiles set stripe_account_id = 'acct_w20_paid', payouts_enabled = true where id = paid;

  -- Nothing else in the fixture database may be claimable.
  update public.transfer_intents set status = 'cancelled' where status in ('ready', 'failed', 'blocked_unpayable', 'holding', 'processing');

  -- 1. A blocked prefix: twenty payouts to a seller who can't be paid, all
  --    due long ago, ahead of one ready payout that is due now.
  for i in 1..20 loop
    blocked := blocked || pg_temp.w20_order(buyer, unpaid, 'pi_w20_blocked_' || i, 'blocked_unpayable',
      now() - interval '30 days');
  end loop;
  update public.transfer_intents set updated_at = now() - interval '30 days' where order_id = any(blocked);
  ready_order := pg_temp.w20_order(buyer, paid, 'pi_w20_ready', 'ready', now() - interval '1 hour');

  claimed := pg_temp.w20_claim('w20-worker-1', 8);
  if claimed <> array[ready_order] then
    raise exception 'FAIL 1: a batch of 8 behind 20 unpayable payouts should admit only the ready one (got % rows)', cardinality(claimed);
  end if;
  if exists (select 1 from public.transfer_intents where order_id = any(blocked) and status <> 'blocked_unpayable') then
    raise exception 'FAIL 1: an unpayable seller''s payout was claimed';
  end if;
  raise notice 'PASS 1: twenty unpayable payouts no longer starve a ready one';

  -- 2. The seller becomes payable: their blocked payouts can move, so they
  --    are admitted (longest-due first) — without readiness being re-run.
  update public.profiles set stripe_account_id = 'acct_w20_unpaid', payouts_enabled = true where id = unpaid;
  claimed := pg_temp.w20_claim('w20-worker-2', 5);
  if cardinality(claimed) <> 5 or not (claimed <@ blocked) then
    raise exception 'FAIL 2: a payable seller''s blocked payouts were not admitted (got %)', cardinality(claimed);
  end if;
  update public.profiles set stripe_account_id = null, payouts_enabled = false where id = unpaid;
  raise notice 'PASS 2: a blocked payout is admitted once its seller is payable';

  -- 3. A blocked payout whose provider call may have happened always
  --    reconciles once its time is due, payable seller or not.
  uncertain := pg_temp.w20_order(buyer, unpaid, 'pi_w20_uncertain', 'blocked_unpayable');
  uncertain_later := pg_temp.w20_order(buyer, unpaid, 'pi_w20_uncertain_later', 'blocked_unpayable');
  update public.transfer_intents
     set operation_key = 'transfer:' || order_id::text, dispatch_amount_cents = 9000, dispatch_currency = 'usd',
         dispatch_destination = 'acct_w20_restricted', dispatch_source_transaction = 'ch_' || order_id::text,
         dispatch_transfer_group = 'pi_w20_uncertain', provider_call_may_have_occurred = true,
         next_attempt_at = case when order_id = uncertain then now() - interval '1 minute' else now() + interval '1 day' end,
         last_error = 'Stripe refused the transfer: the seller''s Stripe account can''t receive transfers'
   where order_id in (uncertain, uncertain_later);
  claimed := pg_temp.w20_claim('w20-worker-3', 50);
  if not (uncertain = any(claimed)) then
    raise exception 'FAIL 3: a due uncertain blocked payout was not admitted to reconcile';
  end if;
  if uncertain_later = any(claimed) or exists (select 1 from unnest(claimed) c where c = any(blocked)) then
    raise exception 'FAIL 3: a blocked payout was admitted before its time or while its seller is unpayable';
  end if;
  if (select provider_call_may_have_occurred from public.transfer_intents where order_id = uncertain) is not true then
    raise exception 'FAIL 3: admission dropped the provider-call flag';
  end if;
  raise notice 'PASS 3: an uncertain blocked payout reconciles when due, not before';

  -- 4. Longest-due first, whatever the update order.
  oldest := pg_temp.w20_order(buyer, paid, 'pi_w20_oldest', 'ready', now() - interval '3 days');
  middle := pg_temp.w20_order(buyer, paid, 'pi_w20_middle', 'ready', now() - interval '2 days');
  newest := pg_temp.w20_order(buyer, paid, 'pi_w20_newest', 'ready', now() - interval '1 day');
  update public.transfer_intents set updated_at = now() - interval '9 days' where order_id = newest;
  update public.transfer_intents set updated_at = now() - interval '1 minute' where order_id = oldest;
  if pg_temp.w20_claim('w20-worker-4', 1) <> array[oldest]
     or pg_temp.w20_claim('w20-worker-5', 1) <> array[middle]
     or pg_temp.w20_claim('w20-worker-6', 1) <> array[newest] then
    raise exception 'FAIL 4: due payouts were not served longest-due first';
  end if;
  raise notice 'PASS 4: due payouts are served longest-due first';

  -- 5. Readiness and the payout date are untouched: a holding payout whose
  --    clearing time is ahead is neither marked nor admitted.
  i := (select count(*) from public.transfer_intents);
  perform pg_temp.w20_order(buyer, paid, 'pi_w20_future', 'holding', now() + interval '1 day');
  perform public.mark_due_transfer_intents();
  if exists (select 1 from public.transfer_intents ti join public.payments p on p.order_id = ti.order_id
             where p.provider_reference = 'pi_w20_future' and (ti.status <> 'holding' or ti.available_at <= now())) then
    raise exception 'FAIL 5: a payout was released before its clearing time';
  end if;
  if cardinality(pg_temp.w20_claim('w20-worker-7', 50)) <> 0 then
    raise exception 'FAIL 5: a claim admitted a payout that is not due';
  end if;
  raise notice 'PASS 5: payout dates are unchanged';

  -- 6. Operator retry of an exhausted payout keeps everything but the budget.
  exhausted := pg_temp.w20_order(buyer, paid, 'pi_w20_exhausted', 'failed');
  update public.transfer_intents
     set attempts = 8, last_error = 'Seller transfer exhausted 8 attempts: Stripe unavailable',
         operation_key = 'transfer:' || order_id::text, dispatch_amount_cents = 9000, dispatch_currency = 'usd',
         dispatch_destination = 'acct_w20_paid', dispatch_source_transaction = 'ch_w20_exhausted',
         dispatch_transfer_group = 'pi_w20_exhausted', provider_call_may_have_occurred = true
   where order_id = exhausted;
  if exhausted = any(pg_temp.w20_claim('w20-worker-8', 50)) then
    raise exception 'FAIL 6: an exhausted payout was admitted before any retry';
  end if;
  v_result := public.admin_retry_transfer_intent(exhausted);
  if (v_result->>'previous_attempts')::int <> 8 or (v_result->>'provider_call_may_have_occurred')::boolean is not true then
    raise exception 'FAIL 6: unexpected retry result %', v_result;
  end if;
  if not exists (select 1 from public.transfer_intents where order_id = exhausted and status = 'failed'
                   and attempts = 0 and next_attempt_at is null and provider_call_may_have_occurred
                   and operation_key = 'transfer:' || exhausted::text and dispatch_amount_cents = 9000
                   and dispatch_destination = 'acct_w20_paid' and dispatch_transfer_group = 'pi_w20_exhausted') then
    raise exception 'FAIL 6: the retry changed more than the attempt budget';
  end if;
  if not (exhausted = any(pg_temp.w20_claim('w20-worker-9', 50))) then
    raise exception 'FAIL 6: a retried payout was not admitted';
  end if;
  raise notice 'PASS 6: a retried payout keeps its frozen request and provider-call flag and is admitted';

  -- 7. A retry bypasses nothing: an exhausted payout Stripe was never called
  --    for, on an order with an open bank chargeback, stays out after retry.
  frozen_cb := pg_temp.w20_order(buyer, paid, 'pi_w20_chargeback', 'failed');
  update public.transfer_intents set attempts = 8 where order_id = frozen_cb;
  v_text := public.apply_stripe_dispute_event('dp_w20_cb', 'pi_w20_chargeback', 10000, 'usd',
    'needs_response', false, 'evt_w20_cb', 100, lease);
  if v_text not in ('committed', 'recovery_recorded') then
    raise exception 'Fixture 7: chargeback not admitted (%)', v_text;
  end if;
  update public.orders set status = 'delivered' where id = frozen_cb;
  perform public.admin_retry_transfer_intent(frozen_cb);
  if frozen_cb = any(pg_temp.w20_claim('w20-worker-10', 50)) then
    raise exception 'FAIL 7: a retried payout was admitted during an unresolved chargeback';
  end if;
  raise notice 'PASS 7: a retry leaves the chargeback freeze in force';

  -- 8. Retry refusals.
  begin
    perform public.admin_retry_transfer_intent(ready_order); -- processing, live lease
    raise exception 'FAIL 8: retried a payout a worker holds';
  exception when sqlstate '55P03' then null;
  end;
  update public.transfer_intents set status = 'failed', attempts = 3, locked_by = null, lease_expires_at = null
   where order_id = oldest;
  begin
    perform public.admin_retry_transfer_intent(oldest);
    raise exception 'FAIL 8: retried a payout that is still retrying on its own';
  exception when sqlstate '22023' then null;
  end;
  update public.transfer_intents set status = 'transferred', transfer_reference = 'tr_w20_done' where order_id = middle;
  begin
    perform public.admin_retry_transfer_intent(middle);
    raise exception 'FAIL 8: retried a paid payout';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform public.admin_retry_transfer_intent(gen_random_uuid());
    raise exception 'FAIL 8: retried a payout that does not exist';
  exception when sqlstate 'P0002' then null;
  end;
  if has_function_privilege('authenticated', 'public.admin_retry_transfer_intent(uuid)', 'execute')
     or has_function_privilege('anon', 'public.admin_retry_transfer_intent(uuid)', 'execute')
     or not has_function_privilege('service_role', 'public.admin_retry_transfer_intent(uuid)', 'execute') then
    raise exception 'FAIL 8: the retry is callable by a client role, or not by the service role';
  end if;
  raise notice 'PASS 8: retry refuses held, retrying, paid and missing payouts, and is service-role only';

  -- 9. Ledger reconciliation: its case kind, its run log, its worker.
  insert into public.payment_recoveries(kind, recovery_key, amount_cents, detail)
  values ('ledger_discrepancy', 'ledger:guard:w20', 100, 'Daily ledger reconciliation: guard fixture');
  insert into public.payment_recoveries(kind, recovery_key, amount_cents, detail)
  values ('ledger_discrepancy', 'ledger:guard:w20', 200, 'replayed')
  on conflict (recovery_key) do nothing;
  if (select amount_cents from public.payment_recoveries where recovery_key = 'ledger:guard:w20') <> 100 then
    raise exception 'FAIL 9: an insert-only discrepancy replay changed the case';
  end if;
  insert into public.ledger_reconciliation_runs(window_start, window_end, status)
  values (now() - interval '2 days', now() - interval '2 hours', 'complete');
  begin
    insert into public.ledger_reconciliation_runs(window_start, window_end) values (now(), now() - interval '1 hour');
    raise exception 'FAIL 9: a run with an empty window was accepted';
  exception when check_violation then null;
  end;
  if has_table_privilege('authenticated', 'public.ledger_reconciliation_runs', 'select')
     or has_table_privilege('anon', 'public.ledger_reconciliation_runs', 'select')
     or not (select relrowsecurity from pg_class where oid = 'public.ledger_reconciliation_runs'::regclass) then
    raise exception 'FAIL 9: the run log is readable by a client role or has no row security';
  end if;
  perform public.invoke_remediation_worker('ledger-reconciliation');
  begin
    perform public.invoke_remediation_worker('ledger-reconciliation-typo');
    raise exception 'FAIL 9: the worker invoker accepted an unknown family';
  exception when raise_exception then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
  if not exists (select 1 from private.scheduled_job_inventory()
                 where job = 'drvn-ledger-reconciliation' and schedule = '50 5 * * *'
                   and families = array['ledgerReconciliation'] and budget = interval '26 hours') then
    raise exception 'FAIL 9: the ledger reconciliation job is not in the inventory';
  end if;
  if exists (select 1 from pg_extension where extname = 'pg_cron')
     and not exists (select 1 from cron.job where jobname = 'drvn-ledger-reconciliation' and schedule = '50 5 * * *') then
    raise exception 'FAIL 9: the ledger reconciliation job is not scheduled';
  end if;
  raise notice 'PASS 9: ledger discrepancies, run log, worker and schedule';

  raise notice 'all settlement reconciliation checks passed';
end $$;

rollback;
