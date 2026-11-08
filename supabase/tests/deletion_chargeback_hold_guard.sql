-- An open bank chargeback holds account deletion for both parties to the
-- order, even when the order is completed (20261108140000; ruled by Neil,
-- 8 Nov 2026).
--   - a completed order alone holds nothing; an unresolved chargeback on it
--     holds the buyer and the seller
--   - open, loss_pending and recovery hold; won, warning_closed and lost don't
--   - the gate names the order; pausing records blocker_code open_chargeback
--     and says the bank decides it; other holds keep the settle wording
--   - a chargeback opened, or linked to its order, after a case finished puts
--     the case back in the queue on the hold; a resolved one doesn't
--   - members can't call the new private helpers
begin;

-- The hold watch is deferred to commit; this guard rolls back, so it fires
-- at the end of each statement instead.
set constraints all immediate;

do $$
declare
  buyer uuid := gen_random_uuid();
  seller uuid := gen_random_uuid();
  late_buyer uuid := gen_random_uuid();
  late_seller uuid := gen_random_uuid();
  other_buyer uuid := gen_random_uuid();
  done_order uuid := gen_random_uuid();
  late_order uuid := gen_random_uuid();
  open_order uuid := gen_random_uuid();
  buyer_job uuid;
  buyer_lease uuid := gen_random_uuid();
  other_job uuid;
  other_lease uuid := gen_random_uuid();
  late_job uuid;
  gate jsonb;
  st text;
begin
  insert into auth.users(id, email, raw_user_meta_data) values
    (buyer, 'cbh-buyer@drvn.test', '{}'),
    (seller, 'cbh-seller@drvn.test', '{}'),
    (late_buyer, 'cbh-late-buyer@drvn.test', '{}'),
    (late_seller, 'cbh-late-seller@drvn.test', '{}'),
    (other_buyer, 'cbh-other@drvn.test', '{}');

  insert into public.orders(id, buyer_id, seller_id, status, subtotal_cents, shipping_cents, platform_fee_cents, total_cents, currency)
  values (done_order, buyer, seller, 'completed', 5000, 0, 500, 5000, 'USD'),
         (late_order, late_buyer, late_seller, 'completed', 5000, 0, 500, 5000, 'USD'),
         (open_order, other_buyer, seller, 'paid', 5000, 0, 500, 5000, 'USD');

  if has_function_privilege('authenticated', 'private.account_deletion_hold_note(uuid)', 'execute')
     or has_function_privilege('authenticated', 'private.account_deletion_hold_code(uuid)', 'execute')
     or has_function_privilege('anon', 'private.account_deletion_hold_note(uuid)', 'execute')
     or has_function_privilege('anon', 'private.account_deletion_hold_code(uuid)', 'execute') then
    raise exception 'FAIL 1: a member or visitor can call the chargeback hold helpers (OS-W11)';
  end if;

  -- 1. A completed order alone holds nothing.
  if (public.account_deletion_blockers(buyer)->>'financial_hold')::boolean then
    raise exception 'FAIL 2: a completed order with no chargeback held the deletion (OS-W11)';
  end if;

  -- 2. Every unresolved state holds both parties; every terminal one clears.
  insert into public.stripe_dispute_journal(dispute_id, payment_reference, amount_cents, currency, state, last_event_id, last_event_created, order_ids)
  values ('dp_cbh_done', 'pi_cbh_done', 5000, 'usd', 'open', 'evt_cbh_1', 1, array[done_order]);
  foreach st in array array['open', 'loss_pending', 'recovery'] loop
    update public.stripe_dispute_journal set state = st where dispute_id = 'dp_cbh_done';
    if not (public.account_deletion_blockers(buyer)->>'financial_hold')::boolean then
      raise exception 'FAIL 3: a % chargeback did not hold the buyer''s deletion (OS-W11)', st;
    end if;
    if not (public.account_deletion_blockers(seller)->>'financial_hold')::boolean then
      raise exception 'FAIL 4: a % chargeback did not hold the seller''s deletion (OS-W11)', st;
    end if;
  end loop;
  foreach st in array array['won', 'warning_closed', 'lost'] loop
    update public.stripe_dispute_journal set state = st where dispute_id = 'dp_cbh_done';
    if (public.account_deletion_blockers(buyer)->>'financial_hold')::boolean then
      raise exception 'FAIL 5: a % chargeback still held the deletion (OS-W11)', st;
    end if;
  end loop;
  update public.stripe_dispute_journal set state = 'open' where dispute_id = 'dp_cbh_done';

  -- 3. The gate names the chargeback's order; pausing says the bank decides.
  insert into public.remediation_jobs(kind, dedup_key, payload, status, lease_id, locked_until)
  values ('delete_account', 'delete:' || buyer, jsonb_build_object('user_id', buyer), 'processing', buyer_lease, now() + interval '5 minutes')
  returning id into buyer_job;
  insert into public.account_deletion_requests(user_id, job_id, outcome, next_action, responsible_owner)
  values (buyer, buyer_job, 'cleanup_pending', 'Automated cleanup is in progress.', 'privacy worker');

  gate := public.account_deletion_hold_gate(buyer_job, buyer_lease, buyer);
  if not (gate->>'held')::boolean or (gate->>'hold_order_id')::uuid is distinct from done_order then
    raise exception 'FAIL 6: the gate did not hold on the chargeback or name its order (%) (OS-W11)', gate;
  end if;
  perform public.pause_account_deletion_hold(buyer_job, buyer_lease, buyer);
  if (select blocker_code from public.account_deletion_requests where user_id = buyer) is distinct from 'open_chargeback' then
    raise exception 'FAIL 7: the paused case does not record open_chargeback (OS-W11)';
  end if;
  if (select next_action from public.account_deletion_requests where user_id = buyer)
     not like 'Order ' || upper(left(done_order::text, 8)) || ' has an open bank chargeback.%' then
    raise exception 'FAIL 8: the next step does not say the order waits on the bank (OS-W11)';
  end if;
  if not coalesce((select affected_data_classes @> array['chargebacks'] from public.account_deletion_requests where user_id = buyer), false) then
    raise exception 'FAIL 9: the paused case does not list chargebacks (OS-W11)';
  end if;

  -- 4. Any other hold keeps the settle wording and the old code. The seller's
  -- oldest hold is the open sale (created after done_order, so pin the time).
  update public.orders set created_at = now() - interval '1 day' where id = open_order;
  insert into public.remediation_jobs(kind, dedup_key, payload, status, lease_id, locked_until)
  values ('delete_account', 'delete:' || seller, jsonb_build_object('user_id', seller), 'processing', other_lease, now() + interval '5 minutes')
  returning id into other_job;
  insert into public.account_deletion_requests(user_id, job_id, outcome, next_action, responsible_owner)
  values (seller, other_job, 'cleanup_pending', 'Automated cleanup is in progress.', 'privacy worker');
  perform public.pause_account_deletion_hold(other_job, other_lease, seller);
  if (select hold_order_id from public.account_deletion_requests where user_id = seller) is distinct from open_order
     or (select blocker_code from public.account_deletion_requests where user_id = seller) <> 'active_financial_obligations'
     or (select next_action from public.account_deletion_requests where user_id = seller) not like 'Settle order %' then
    raise exception 'FAIL 10: an ordinary hold lost its settle wording or code (OS-W11)';
  end if;

  -- 5. A chargeback opened after the case finished puts it back in the queue.
  insert into public.remediation_jobs(kind, dedup_key, payload, status, completed_at)
  values ('delete_account', 'delete:' || late_seller, jsonb_build_object('user_id', late_seller), 'completed', now())
  returning id into late_job;
  insert into public.account_deletion_requests(user_id, job_id, outcome, next_action, responsible_owner)
  values (late_seller, late_job, 'operator_attention', 'An operator must apply the retention policy.', 'operations and policy owner');

  -- A resolved one first: nothing changes.
  insert into public.stripe_dispute_journal(dispute_id, payment_reference, amount_cents, currency, state, last_event_id, last_event_created, order_ids)
  values ('dp_cbh_won', 'pi_cbh_late', 5000, 'usd', 'won', 'evt_cbh_2', 2, array[late_order]);
  if (select status from public.remediation_jobs where id = late_job) <> 'completed' then
    raise exception 'FAIL 11: a resolved chargeback requeued a finished case (OS-W11)';
  end if;

  -- Then one recorded before it was matched to its order, and linked later.
  insert into public.stripe_dispute_journal(dispute_id, payment_reference, amount_cents, currency, state, last_event_id, last_event_created, order_ids)
  values ('dp_cbh_late', 'pi_cbh_late', 5000, 'usd', 'open', 'evt_cbh_3', 3, '{}');
  if (select status from public.remediation_jobs where id = late_job) <> 'completed' then
    raise exception 'FAIL 12: a chargeback with no order requeued a case (OS-W11)';
  end if;
  update public.stripe_dispute_journal set order_ids = array[late_order] where dispute_id = 'dp_cbh_late';
  if (select status from public.remediation_jobs where id = late_job) <> 'pending' then
    raise exception 'FAIL 13: a chargeback linked after the case finished did not requeue it (OS-W11)';
  end if;
  if (select outcome from public.account_deletion_requests where user_id = late_seller) <> 'temporary_financial_hold'
     or (select blocker_code from public.account_deletion_requests where user_id = late_seller) is distinct from 'open_chargeback'
     or (select hold_order_id from public.account_deletion_requests where user_id = late_seller) is distinct from late_order then
    raise exception 'FAIL 14: the requeued case is not held on the chargeback (OS-W11)';
  end if;

  raise notice 'all deletion chargeback hold checks passed';
end $$;

rollback;
