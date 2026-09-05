-- ============================================================================
-- Money-durability guard (0026)
--
-- Regression-tests the crash-window closures in 0026_money_durability.sql:
-- refund_operations as an atomic reservation + durable state machine,
-- settle_refund_operation()'s exactly-once bookkeeping, claim_transfer_intents()'s
-- leased/bounded/backoff-aware batch claim, and the client write-lockout on all
-- three new surfaces (refund_operations, transfer_intents leasing, admin_alert_outbox).
--
-- Same contract as purchase_guard.sql / security_guard.sql: run against a
-- NON-PRODUCTION database; everything happens inside a transaction that is
-- rolled back at the end; impersonation uses transaction-local
-- set_config('role', …) + request.jwt.claims — the real PostgREST mechanism,
-- not a SECURITY DEFINER shortcut; raises on failure, NOTICEs on success.
-- ============================================================================

begin;

-- plpgsql has no nested procedures, so the impersonation helpers live in
-- pg_temp; the rollback removes them with everything else.
create function pg_temp.impersonate(uid uuid) returns void
language sql as $$
  select set_config('role', 'authenticated', true);
  select set_config(
    'request.jwt.claims',
    json_build_object('sub', uid::text, 'role', 'authenticated', 'aal', 'aal2')::text,
    true
  );
$$;

-- 'none' = SET ROLE NONE: back to the session user (supabase_admin in CI,
-- postgres against a live project) — the trusted-writer role every function
-- under test is granted EXECUTE on (0026 revokes them from public/anon/authenticated).
create function pg_temp.back_to_admin() returns void
language sql as $$
  select set_config('role', 'none', true);
  select set_config('request.jwt.claims', '', true);
$$;

do $$
declare
  v_seller uuid := gen_random_uuid();
  v_buyer  uuid := gen_random_uuid();

  -- refund-operations fixtures
  v_order1 uuid; -- sequential reservations exceeding total
  v_order2 uuid; -- full reservation then "nothing left"
  v_order3 uuid; -- external clamp
  v_order4 uuid; -- refund-reference adoption
  v_order5 uuid; -- settle-once bookkeeping
  v_order6 uuid; -- full-refund settle + transfer_intents cancel
  v_order7 uuid; -- partial-refund settle + reversal_pending
  v_order8 uuid; -- failed op releases reservation

  v_payment5 uuid;

  v_res  jsonb;
  v_res2 jsonb;
  v_op   uuid;
  v_op_a uuid;
  v_settle  jsonb;
  v_settle2 jsonb;

  v_status text;
  v_count  int;
  v_int    int;

  -- transfer_intents leasing fixtures
  v_ti1 uuid; v_ti2 uuid; v_ti3 uuid; v_ti_stale uuid; v_ti_live uuid;
  v_ti6 uuid; v_ti7 uuid; v_ti8 uuid;
  v_ti9 uuid;  -- attempts guard
  v_ti10 uuid; -- backoff

  v_all_processing boolean;
  v_all_locked     boolean;
  v_all_future     boolean;
begin
  -- ---------- fixtures ----------
  insert into auth.users (id, email) values
    (v_seller, 'money-guard-seller@example.test'),
    (v_buyer,  'money-guard-buyer@example.test');

  update public.profiles set display_name = 'Money Guard Seller', username = 'money_guard_seller' where id = v_seller;
  update public.profiles set display_name = 'Money Guard Buyer',  username = 'money_guard_buyer'  where id = v_buyer;

  insert into public.orders (buyer_id, seller_id, status, subtotal_cents, platform_fee_cents, total_cents, currency)
  values (v_buyer, v_seller, 'paid', 10000, 1000, 10000, 'USD') returning id into v_order1;

  insert into public.orders (buyer_id, seller_id, status, subtotal_cents, platform_fee_cents, total_cents, currency)
  values (v_buyer, v_seller, 'paid', 5000, 500, 5000, 'USD') returning id into v_order2;

  -- 60% already settled — used by the external-clamp assertion.
  insert into public.orders (buyer_id, seller_id, status, subtotal_cents, platform_fee_cents, total_cents, refunded_cents, currency)
  values (v_buyer, v_seller, 'paid', 10000, 1000, 10000, 6000, 'USD') returning id into v_order3;

  insert into public.orders (buyer_id, seller_id, status, subtotal_cents, platform_fee_cents, total_cents, currency)
  values (v_buyer, v_seller, 'paid', 10000, 1000, 10000, 'USD') returning id into v_order4;

  insert into public.orders (buyer_id, seller_id, status, subtotal_cents, platform_fee_cents, total_cents, currency)
  values (v_buyer, v_seller, 'paid', 10000, 1000, 10000, 'USD') returning id into v_order5;

  insert into public.orders (buyer_id, seller_id, status, subtotal_cents, platform_fee_cents, total_cents, currency)
  values (v_buyer, v_seller, 'paid', 8000, 800, 8000, 'USD') returning id into v_order6;

  -- Has an existing transfer_reference — the seller was already paid out, so
  -- a refund now owes a reversal.
  insert into public.orders (buyer_id, seller_id, status, subtotal_cents, platform_fee_cents, total_cents, transfer_reference, currency)
  values (v_buyer, v_seller, 'paid', 10000, 1000, 10000, 'tr_money_guard_1', 'USD') returning id into v_order7;

  insert into public.orders (buyer_id, seller_id, status, subtotal_cents, platform_fee_cents, total_cents, currency)
  values (v_buyer, v_seller, 'paid', 5000, 500, 5000, 'USD') returning id into v_order8;

  raise notice '--- fixtures ready ---';

  -- ================================================================
  -- 1/2. begin_refund_operation — sequential reservations exceeding total
  -- ================================================================
  v_res := public.begin_refund_operation(
    p_order_id => v_order1, p_amount_cents => 6000, p_reason => 'first refund',
    p_requested_by => 'admin:money-guard', p_actor_role => 'admin',
    p_resolve_dispute => false, p_dispute_outcome => null, p_payment_reference => null
  );
  if (v_res ->> 'ok')::boolean is not true then
    raise exception 'FAIL 1: first 6000 reservation on a 10000 order was rejected: %', v_res;
  end if;
  raise notice 'PASS 1/36: first reservation (6000 of 10000) accepted';

  v_res2 := public.begin_refund_operation(
    p_order_id => v_order1, p_amount_cents => 6000, p_reason => 'second refund',
    p_requested_by => 'admin:money-guard', p_actor_role => 'admin',
    p_resolve_dispute => false, p_dispute_outcome => null, p_payment_reference => null
  );
  if (v_res2 ->> 'ok')::boolean is not false then
    raise exception 'FAIL 2: second 6000 reservation (sum 12000 > total 10000) was accepted: %', v_res2;
  end if;
  raise notice 'PASS 2/36: second reservation rejected — in-flight sum would exceed the order total';

  -- ================================================================
  -- 3/4. In-flight reservations count against the remainder
  -- ================================================================
  v_res := public.begin_refund_operation(
    p_order_id => v_order2, p_amount_cents => null, p_reason => 'full refund',
    p_requested_by => 'admin:money-guard', p_actor_role => 'admin',
    p_resolve_dispute => false, p_dispute_outcome => null, p_payment_reference => null
  );
  if (v_res ->> 'ok')::boolean is not true or (v_res ->> 'amount_cents')::int <> 5000 then
    raise exception 'FAIL 3: full-amount reservation on a 5000 order did not reserve 5000: %', v_res;
  end if;
  raise notice 'PASS 3/36: full-amount reservation (5000 of 5000) accepted';

  v_res2 := public.begin_refund_operation(
    p_order_id => v_order2, p_amount_cents => null, p_reason => 'second full refund',
    p_requested_by => 'admin:money-guard', p_actor_role => 'admin',
    p_resolve_dispute => false, p_dispute_outcome => null, p_payment_reference => null
  );
  if (v_res2 ->> 'ok')::boolean is not false or (v_res2 ->> 'error') not ilike '%Nothing left%' then
    raise exception 'FAIL 4: a second reservation against a fully in-flight order did not report "Nothing left": %', v_res2;
  end if;
  raise notice 'PASS 4/36: second reservation on a fully-reserved order refused — "Nothing left"';

  -- ================================================================
  -- 5. p_external clamps instead of rejecting
  -- ================================================================
  -- order3: total 10000, already-settled refunded_cents 6000 → remaining 4000.
  -- Ask for 10000 (100%) as an external (Stripe-originated) refund.
  v_res := public.begin_refund_operation(
    p_order_id => v_order3, p_amount_cents => 10000, p_reason => 'stripe dashboard refund',
    p_requested_by => 'stripe:webhook', p_actor_role => 'system',
    p_resolve_dispute => false, p_dispute_outcome => null, p_payment_reference => null,
    p_refund_reference => null, p_external => true
  );
  if (v_res ->> 'ok')::boolean is not true then
    raise exception 'FAIL 5a: external 100%% refund request was rejected instead of clamped: %', v_res;
  end if;
  if (v_res ->> 'amount_cents')::int <> 4000 then
    raise exception 'FAIL 5b: external refund did not clamp to the 4000 remaining, got %', v_res ->> 'amount_cents';
  end if;
  raise notice 'PASS 5/36: external refund for 100%% clamps to the 4000 actually remaining';

  -- ================================================================
  -- 6/7. Adoption: same p_refund_reference twice
  -- ================================================================
  v_res := public.begin_refund_operation(
    p_order_id => v_order4, p_amount_cents => 3000, p_reason => 'webhook refund',
    p_requested_by => 'stripe:webhook', p_actor_role => 'system',
    p_resolve_dispute => false, p_dispute_outcome => null, p_payment_reference => null,
    p_refund_reference => 're_test_1', p_external => true
  );
  if (v_res ->> 'ok')::boolean is not true or (v_res ->> 'adopted')::boolean is not false then
    raise exception 'FAIL 6: first begin with a fresh refund_reference should create, not adopt: %', v_res;
  end if;
  v_op_a := (v_res ->> 'operation_id')::uuid;
  raise notice 'PASS 6/36: first begin with re_test_1 creates a new operation';

  v_res2 := public.begin_refund_operation(
    p_order_id => v_order4, p_amount_cents => 3000, p_reason => 'webhook refund replay',
    p_requested_by => 'stripe:webhook', p_actor_role => 'system',
    p_resolve_dispute => false, p_dispute_outcome => null, p_payment_reference => null,
    p_refund_reference => 're_test_1', p_external => true
  );
  if (v_res2 ->> 'adopted')::boolean is not true or (v_res2 ->> 'operation_id')::uuid <> v_op_a then
    raise exception 'FAIL 7: second begin with the same refund_reference did not adopt the first operation: %', v_res2;
  end if;
  raise notice 'PASS 7/36: second begin with re_test_1 adopts the same operation_id';

  -- ================================================================
  -- 8–13. settle_refund_operation applies effects exactly once
  -- ================================================================
  insert into public.payments (order_id, provider, status, amount_cents, currency)
  values (v_order5, 'stub', 'succeeded', 10000, 'USD') returning id into v_payment5;

  v_res := public.begin_refund_operation(
    p_order_id => v_order5, p_amount_cents => 4000, p_reason => 'partial refund',
    p_requested_by => 'stripe:webhook', p_actor_role => 'system',
    p_resolve_dispute => false, p_dispute_outcome => null, p_payment_reference => null,
    p_external => true
  );
  v_op := (v_res ->> 'operation_id')::uuid;
  if (v_res ->> 'status') <> 'effects_pending' then
    raise exception 'FAIL 8 setup: external begin did not land in effects_pending, got %', v_res;
  end if;

  v_settle := public.settle_refund_operation(v_op);
  if (v_settle ->> 'ok')::boolean is not true or (v_settle ->> 'already')::boolean is not false then
    raise exception 'FAIL 8: first settle did not report ok/not-already: %', v_settle;
  end if;
  raise notice 'PASS 8/36: settle_refund_operation applies on the first call (ok=true, already=false)';

  select refunded_cents into v_int from public.orders where id = v_order5;
  if v_int <> 4000 then
    raise exception 'FAIL 9: orders.refunded_cents did not advance to 4000, got %', v_int;
  end if;
  raise notice 'PASS 9/36: orders.refunded_cents advanced to 4000';

  select platform_fee_refunded_cents into v_int from public.orders where id = v_order5;
  if v_int <> 400 then
    raise exception 'FAIL 10: platform_fee_refunded_cents should be round(4000*1000/10000)=400, got %', v_int;
  end if;
  raise notice 'PASS 10/36: platform_fee_refunded_cents = round(after * fee / total) = 400';

  select refunded_cents, status into v_int, v_status from public.payments where id = v_payment5;
  if v_int <> 4000 or v_status <> 'partially_refunded' then
    raise exception 'FAIL 11: payments row did not advance correctly (refunded_cents=%, status=%)', v_int, v_status;
  end if;
  raise notice 'PASS 11/36: payments.refunded_cents advanced and status transitioned to partially_refunded';

  v_settle2 := public.settle_refund_operation(v_op);
  if (v_settle2 ->> 'already')::boolean is not true then
    raise exception 'FAIL 12: settling an already-settled operation did not report already=true: %', v_settle2;
  end if;
  raise notice 'PASS 12/36: settling again reports already=true (no re-application)';

  select refunded_cents into v_int from public.orders where id = v_order5;
  if v_int <> 4000 then
    raise exception 'FAIL 13: a second settle call double-advanced refunded_cents to %', v_int;
  end if;
  raise notice 'PASS 13/36: orders.refunded_cents unchanged after the second settle (no double-advance)';

  -- ================================================================
  -- 14/15. Full-refund settle — order refunded, pending transfer cancelled
  -- ================================================================
  insert into public.transfer_intents (order_id, seller_id, amount_cents, currency, status)
  values (v_order6, v_seller, 7200, 'USD', 'ready');

  v_res := public.begin_refund_operation(
    p_order_id => v_order6, p_amount_cents => null, p_reason => 'full refund',
    p_requested_by => 'stripe:webhook', p_actor_role => 'system',
    p_resolve_dispute => false, p_dispute_outcome => null, p_payment_reference => null,
    p_external => true
  );
  v_op := (v_res ->> 'operation_id')::uuid;
  perform public.settle_refund_operation(v_op);

  select status into v_status from public.orders where id = v_order6;
  if v_status <> 'refunded' then
    raise exception 'FAIL 14: a full-amount settle did not move the order to refunded, got %', v_status;
  end if;
  raise notice 'PASS 14/36: full-refund settle moves the order to status refunded';

  select status into v_status from public.transfer_intents where order_id = v_order6;
  if v_status <> 'cancelled' then
    raise exception 'FAIL 15: the pending transfer_intents row was not cancelled on full refund, got %', v_status;
  end if;
  raise notice 'PASS 15/36: the pending transfer_intents row for a fully-refunded order flips to cancelled';

  -- ================================================================
  -- 16/17. Partial-refund settle with an existing transfer_reference
  -- ================================================================
  -- order7: total 10000, fee 1000 → net (seller share) 9000. Refund 3000 (30%).
  -- reversal_due_cents = round(3000*9000/10000) - round(0*9000/10000) = 2700 - 0 = 2700.
  v_res := public.begin_refund_operation(
    p_order_id => v_order7, p_amount_cents => 3000, p_reason => 'partial refund, seller already paid',
    p_requested_by => 'stripe:webhook', p_actor_role => 'system',
    p_resolve_dispute => false, p_dispute_outcome => null, p_payment_reference => null,
    p_external => true
  );
  v_op := (v_res ->> 'operation_id')::uuid;
  v_settle := public.settle_refund_operation(v_op);

  if (v_settle ->> 'status') <> 'reversal_pending' then
    raise exception 'FAIL 16: a partial refund on an order with transfer_reference did not land in reversal_pending: %', v_settle;
  end if;
  raise notice 'PASS 16/36: partial refund with an existing transfer_reference lands the op in reversal_pending';

  if (v_settle ->> 'reversal_due_cents')::int <> 2700 then
    raise exception 'FAIL 17: reversal_due_cents should be 2700 (round(3000*9000/10000) - round(0)), got %', v_settle ->> 'reversal_due_cents';
  end if;
  raise notice 'PASS 17/36: reversal_due_cents = round(after*net/total) - round(before*net/total) = 2700';

  -- ================================================================
  -- 18. A failed op releases its reservation
  -- ================================================================
  -- Reserve the full 5000 remaining on a 5000 order, so a second attempt at
  -- ANY nonzero amount is refused ("Nothing left") while the first op is
  -- still in flight.
  v_res := public.begin_refund_operation(
    p_order_id => v_order8, p_amount_cents => 5000, p_reason => 'app-initiated refund',
    p_requested_by => 'admin:money-guard', p_actor_role => 'admin',
    p_resolve_dispute => false, p_dispute_outcome => null, p_payment_reference => null
  );
  if (v_res ->> 'ok')::boolean is not true then
    raise exception 'FAIL 18 setup: full reservation on order8 was rejected: %', v_res;
  end if;
  v_op := (v_res ->> 'operation_id')::uuid;

  -- Simulate the Stripe call failing: mark the op failed directly (service role).
  update public.refund_operations set status = 'failed' where id = v_op;

  -- Retry at the SAME amount (5000): begin_refund_operation's idempotency_key
  -- is 'refund:order:<id>:' || (refunded_cents + in-flight + amount), which
  -- would reproduce the first op's key bit-for-bit here (refunded_cents and
  -- in-flight are both back at 0 once the prior op is 'failed'). 0026 now
  -- detects that case: when a prior 'failed' op exists for the order, the key
  -- gets a deterministic ':r<failed_count>' suffix (this is the 1st retry, so
  -- ':r1'), so the same-amount retry inserts cleanly instead of colliding on
  -- the idempotency_key unique constraint.
  v_res2 := public.begin_refund_operation(
    p_order_id => v_order8, p_amount_cents => 5000, p_reason => 'retry after failure',
    p_requested_by => 'admin:money-guard', p_actor_role => 'admin',
    p_resolve_dispute => false, p_dispute_outcome => null, p_payment_reference => null
  );
  if (v_res2 ->> 'ok')::boolean is not true then
    raise exception 'FAIL 18: a same-amount reservation was refused after the prior op failed: %', v_res2;
  end if;
  if not exists (
    select 1 from public.refund_operations
    where id = (v_res2 ->> 'operation_id')::uuid and idempotency_key like '%:r1'
  ) then
    raise exception 'FAIL 18: the retry operation did not get the '':r1'' key suffix';
  end if;
  raise notice 'PASS 18/36: a failed op releases its reservation — a same-amount retry succeeds afterward';

  if (v_res2 ->> 'idempotency_key') not like '%:r1' then
    raise exception 'FAIL 18b: retry idempotency_key should end with :r1 (1 prior failed op), got %', v_res2 ->> 'idempotency_key';
  end if;
  raise notice 'PASS 18b/36: the retry''s idempotency_key carries the deterministic :r1 suffix';

  -- ================================================================
  -- 19–23. claim_transfer_intents — batch, lease, stale-lease reclaim
  -- ================================================================
  insert into public.orders (buyer_id, seller_id, status, subtotal_cents, platform_fee_cents, total_cents, currency)
  values (v_buyer, v_seller, 'delivered', 5000, 500, 5000, 'USD') returning id into v_ti1;
  insert into public.orders (buyer_id, seller_id, status, subtotal_cents, platform_fee_cents, total_cents, currency)
  values (v_buyer, v_seller, 'delivered', 5000, 500, 5000, 'USD') returning id into v_ti2;
  insert into public.orders (buyer_id, seller_id, status, subtotal_cents, platform_fee_cents, total_cents, currency)
  values (v_buyer, v_seller, 'delivered', 5000, 500, 5000, 'USD') returning id into v_ti3;
  insert into public.orders (buyer_id, seller_id, status, subtotal_cents, platform_fee_cents, total_cents, currency)
  values (v_buyer, v_seller, 'delivered', 5000, 500, 5000, 'USD') returning id into v_ti_stale;
  insert into public.orders (buyer_id, seller_id, status, subtotal_cents, platform_fee_cents, total_cents, currency)
  values (v_buyer, v_seller, 'delivered', 5000, 500, 5000, 'USD') returning id into v_ti_live;

  insert into public.transfer_intents (order_id, seller_id, amount_cents, currency, status)
  values
    (v_ti1, v_seller, 4500, 'USD', 'ready'),
    (v_ti2, v_seller, 4500, 'USD', 'ready'),
    (v_ti3, v_seller, 4500, 'USD', 'ready');

  -- 'processing' with a lease that already expired — the crash-recovery case.
  insert into public.transfer_intents (order_id, seller_id, amount_cents, currency, status, locked_by, locked_at, lease_expires_at)
  values (v_ti_stale, v_seller, 4500, 'USD', 'processing', 'crashed-worker', now() - interval '10 minutes', now() - interval '5 minutes');

  -- 'processing' with a lease still live — must NOT be claimed.
  insert into public.transfer_intents (order_id, seller_id, amount_cents, currency, status, locked_by, locked_at, lease_expires_at)
  values (v_ti_live, v_seller, 4500, 'USD', 'processing', 'live-worker', now(), now() + interval '10 minutes');

  select count(*),
         coalesce(bool_and(status = 'processing'), false),
         coalesce(bool_and(locked_by = 'money-guard-worker'), false),
         coalesce(bool_and(lease_expires_at > now()), false)
    into v_count, v_all_processing, v_all_locked, v_all_future
    from public.claim_transfer_intents('money-guard-worker', 10, 300, 8);

  if v_count <> 4 then
    raise exception 'FAIL 19: claim_transfer_intents(batch=10) should return 4 rows (3 ready + 1 stale-leased), got %', v_count;
  end if;
  raise notice 'PASS 19/36: claim_transfer_intents claims 4 rows (3 ready + the stale-leased one, not the live-leased one)';

  if not v_all_processing then
    raise exception 'FAIL 20: not every claimed row has status=processing';
  end if;
  raise notice 'PASS 20/36: every claimed row has status=processing';

  if not v_all_locked then
    raise exception 'FAIL 21: not every claimed row has locked_by set to the claiming worker';
  end if;
  raise notice 'PASS 21/36: every claimed row has locked_by set to the claiming worker';

  if not v_all_future then
    raise exception 'FAIL 22: not every claimed row has lease_expires_at in the future';
  end if;
  raise notice 'PASS 22/36: every claimed row has lease_expires_at in the future';

  select status into v_status from public.transfer_intents where order_id = v_ti_live;
  if v_status <> 'processing' then
    raise exception 'FAIL 23: the live-leased row changed status, got %', v_status;
  end if;
  select locked_by into v_status from public.transfer_intents where order_id = v_ti_live;
  if v_status <> 'live-worker' then
    raise exception 'FAIL 23: the live-leased row was claimed by another worker (locked_by=%)', v_status;
  end if;
  raise notice 'PASS 23/36: the row with a live lease was not claimed — untouched, still owned by live-worker';

  -- ================================================================
  -- 24. Bounded batch
  -- ================================================================
  insert into public.orders (buyer_id, seller_id, status, subtotal_cents, platform_fee_cents, total_cents, currency)
  values (v_buyer, v_seller, 'delivered', 5000, 500, 5000, 'USD') returning id into v_ti6;
  insert into public.orders (buyer_id, seller_id, status, subtotal_cents, platform_fee_cents, total_cents, currency)
  values (v_buyer, v_seller, 'delivered', 5000, 500, 5000, 'USD') returning id into v_ti7;
  insert into public.orders (buyer_id, seller_id, status, subtotal_cents, platform_fee_cents, total_cents, currency)
  values (v_buyer, v_seller, 'delivered', 5000, 500, 5000, 'USD') returning id into v_ti8;

  insert into public.transfer_intents (order_id, seller_id, amount_cents, currency, status)
  values
    (v_ti6, v_seller, 4500, 'USD', 'ready'),
    (v_ti7, v_seller, 4500, 'USD', 'ready'),
    (v_ti8, v_seller, 4500, 'USD', 'ready');

  select count(*) into v_count from public.claim_transfer_intents('money-guard-worker-2', 2, 300, 8);
  if v_count <> 2 then
    raise exception 'FAIL 24: claim_transfer_intents(batch=2) should return exactly 2 rows, got %', v_count;
  end if;
  raise notice 'PASS 24/36: claim_transfer_intents(p_batch=2) returns exactly 2 rows';

  -- ================================================================
  -- 25. attempts guard
  -- ================================================================
  insert into public.orders (buyer_id, seller_id, status, subtotal_cents, platform_fee_cents, total_cents, currency)
  values (v_buyer, v_seller, 'delivered', 5000, 500, 5000, 'USD') returning id into v_ti9;
  insert into public.transfer_intents (order_id, seller_id, amount_cents, currency, status, attempts)
  values (v_ti9, v_seller, 4500, 'USD', 'failed', 8);

  select count(*) into v_count
    from public.claim_transfer_intents('money-guard-worker-3', 50, 300, 8) c
    where c.order_id = v_ti9;
  if v_count <> 0 then
    raise exception 'FAIL 25: an intent with attempts=8 (>= p_max_attempts) was claimed';
  end if;
  select status into v_status from public.transfer_intents where order_id = v_ti9;
  if v_status <> 'failed' then
    raise exception 'FAIL 25: an intent at the attempts ceiling changed status to %', v_status;
  end if;
  raise notice 'PASS 25/36: an intent with attempts >= p_max_attempts is never claimed';

  -- ================================================================
  -- 26/27. next_attempt_at backoff
  -- ================================================================
  insert into public.orders (buyer_id, seller_id, status, subtotal_cents, platform_fee_cents, total_cents, currency)
  values (v_buyer, v_seller, 'delivered', 5000, 500, 5000, 'USD') returning id into v_ti10;
  insert into public.transfer_intents (order_id, seller_id, amount_cents, currency, status, attempts, next_attempt_at)
  values (v_ti10, v_seller, 4500, 'USD', 'failed', 1, now() + interval '1 hour');

  perform public.claim_transfer_intents('money-guard-worker-4', 50, 300, 8);
  select status into v_status from public.transfer_intents where order_id = v_ti10;
  if v_status <> 'failed' then
    raise exception 'FAIL 26: an intent with next_attempt_at in the future was claimed (status=%)', v_status;
  end if;
  raise notice 'PASS 26/36: an intent whose next_attempt_at is still in the future is not claimed';

  update public.transfer_intents set next_attempt_at = now() - interval '1 hour' where order_id = v_ti10;
  perform public.claim_transfer_intents('money-guard-worker-5', 50, 300, 8);
  select status into v_status from public.transfer_intents where order_id = v_ti10;
  if v_status <> 'processing' then
    raise exception 'FAIL 27: an intent whose backoff has elapsed was not claimed (status=%)', v_status;
  end if;
  raise notice 'PASS 27/36: once next_attempt_at is in the past, the intent is claimed';

  -- ================================================================
  -- 28/29. admin_alert_outbox dedup (as the trusted writer — the client
  -- lockout on this table is proven separately below)
  -- ================================================================
  insert into public.admin_alert_outbox (kind, title, dedup_key)
  values ('dispute_opened', 'Money guard dedup fixture', 'money-guard-dedup-1');
  raise notice 'PASS 28/36: first insert with dedup_key money-guard-dedup-1 succeeds';

  begin
    insert into public.admin_alert_outbox (kind, title, dedup_key)
    values ('dispute_opened', 'Money guard dedup fixture, replay', 'money-guard-dedup-1');
    raise exception 'FAIL 29: a second insert with the same dedup_key was accepted';
  exception when unique_violation then
    raise notice 'PASS 29/36: a second insert with the same dedup_key is rejected (unique violation)';
  end;

  -- ================================================================
  -- 30–36. Client lockout — refund_operations, transfer_intents, admin_alert_outbox
  -- ================================================================
  perform pg_temp.impersonate(v_buyer);

  begin
    insert into public.refund_operations
      (order_id, amount_cents, currency, remaining_before_cents, requested_by, idempotency_key)
    values (v_order1, 100, 'USD', 100, 'buyer:forged', 'client-forged-key');
    raise exception 'FAIL 30: authenticated client inserted a refund_operations row';
  exception when insufficient_privilege then
    raise notice 'PASS 30/36: refund_operations rejects a direct client INSERT';
  end;

  begin
    update public.refund_operations set status = 'completed';
    raise exception 'FAIL 31: authenticated client updated a refund_operations row';
  exception when insufficient_privilege then
    raise notice 'PASS 31/36: refund_operations rejects a direct client UPDATE';
  end;

  select count(*) into v_count from public.refund_operations;
  if v_count <> 0 then
    raise exception 'FAIL 32: a non-admin authenticated user read % refund_operations rows', v_count;
  end if;
  raise notice 'PASS 32/36: a non-admin SELECT on refund_operations returns zero rows';

  begin
    insert into public.admin_alert_outbox (kind, title) values ('test', 'client-forged alert');
    raise exception 'FAIL 33: authenticated client inserted an admin_alert_outbox row';
  exception when insufficient_privilege then
    raise notice 'PASS 33/36: admin_alert_outbox rejects a direct client INSERT';
  end;

  begin
    update public.admin_alert_outbox set status = 'delivered';
    raise exception 'FAIL 34: authenticated client updated an admin_alert_outbox row';
  exception when insufficient_privilege then
    raise notice 'PASS 34/36: admin_alert_outbox rejects a direct client UPDATE';
  end;

  select count(*) into v_count from public.admin_alert_outbox;
  if v_count <> 0 then
    raise exception 'FAIL 35: a non-admin authenticated user read % admin_alert_outbox rows (fixture rows exist from 28/29)', v_count;
  end if;
  raise notice 'PASS 35/36: a non-admin SELECT on admin_alert_outbox returns zero rows, despite fixture rows existing';

  begin
    perform public.begin_refund_operation(
      p_order_id => v_order1, p_amount_cents => 1, p_reason => 'client-forged',
      p_requested_by => 'buyer:forged', p_actor_role => 'buyer',
      p_resolve_dispute => false, p_dispute_outcome => null, p_payment_reference => null
    );
    raise exception 'FAIL 36: authenticated client executed begin_refund_operation directly';
  exception when insufficient_privilege then
    raise notice 'PASS 36/36: begin_refund_operation is not EXECUTE-granted to authenticated';
  end;

  perform pg_temp.back_to_admin();
  raise notice '--- all money-guard checks passed ---';
end $$;

-- Nothing is kept.
rollback;
