-- OS-W11 follow-up: account deletion checks financial holds before it bans
-- sign-in, and a hold found at any point gives sign-in back (20261108130400).
--   - the gate answers held, with the order to settle, and changes nothing
--   - pausing records that order and names it in the next step
--   - a clear gate resumes a paused case as cleaning up
--   - finalise checks and records the outcome in one step: held, retained
--     identity (recorded, job finished), or deletable outright
--   - a hold that appears after the case finished requeues it, paused
--   - a held member can write again; one being cleaned up still can't
--   - the gate and finalise need the job's live lease; only the service role
--     calls them
-- The two-session races are in deletion_hold_race_guard.sql.
begin;

-- The hold watch is deferred to commit; this guard rolls back, so it fires
-- at the end of each statement instead.
set constraints all immediate;

do $$
declare
  held_member uuid := gen_random_uuid();
  clear_member uuid := gen_random_uuid();
  final_member uuid := gen_random_uuid();
  plain_member uuid := gen_random_uuid();
  seller uuid := gen_random_uuid();
  open_order uuid := gen_random_uuid();
  done_order uuid := gen_random_uuid();
  late_order uuid := gen_random_uuid();
  clear_order uuid := gen_random_uuid();
  held_job uuid;
  clear_job uuid;
  final_job uuid;
  plain_job uuid;
  held_lease uuid := gen_random_uuid();
  clear_lease uuid := gen_random_uuid();
  final_lease uuid := gen_random_uuid();
  plain_lease uuid := gen_random_uuid();
  retained jsonb := jsonb_build_object(
    'blocker_code', 'immutable_retained_identity',
    'affected_data_classes', jsonb_build_array('orders', 'financial records'),
    'next_action', 'An operator must apply the retention policy.',
    'responsible_owner', 'operations and policy owner',
    'policy_decisions_pending', jsonb_build_array('audit/log retention'));
  gate jsonb;
  refused boolean;
begin
  insert into auth.users(id, email, raw_user_meta_data) values
    (held_member, 'w11h-held@drvn.test', '{}'),
    (clear_member, 'w11h-clear@drvn.test', '{}'),
    (final_member, 'w11h-final@drvn.test', '{}'),
    (plain_member, 'w11h-plain@drvn.test', '{}'),
    (seller, 'w11h-seller@drvn.test', '{}');

  -- The held member is buying something that hasn't arrived; the final
  -- member sold something long done.
  insert into public.orders(id, buyer_id, seller_id, status, subtotal_cents, shipping_cents, platform_fee_cents, total_cents, currency)
  values (open_order, held_member, seller, 'paid', 5000, 0, 500, 5000, 'USD'),
         (done_order, seller, final_member, 'completed', 5000, 0, 500, 5000, 'USD');

  -- The jobs as the worker holds them mid-run.
  insert into public.remediation_jobs(kind, dedup_key, payload, status, lease_id, locked_until)
  values ('delete_account', 'delete:' || held_member, jsonb_build_object('user_id', held_member), 'processing', held_lease, now() + interval '5 minutes')
  returning id into held_job;
  insert into public.remediation_jobs(kind, dedup_key, payload, status, lease_id, locked_until)
  values ('delete_account', 'delete:' || clear_member, jsonb_build_object('user_id', clear_member), 'processing', clear_lease, now() + interval '5 minutes')
  returning id into clear_job;
  insert into public.remediation_jobs(kind, dedup_key, payload, status, lease_id, locked_until)
  values ('delete_account', 'delete:' || final_member, jsonb_build_object('user_id', final_member), 'processing', final_lease, now() + interval '5 minutes')
  returning id into final_job;
  insert into public.remediation_jobs(kind, dedup_key, payload, status, lease_id, locked_until)
  values ('delete_account', 'delete:' || plain_member, jsonb_build_object('user_id', plain_member), 'processing', plain_lease, now() + interval '5 minutes')
  returning id into plain_job;
  insert into public.account_deletion_requests(user_id, job_id, outcome, next_action, responsible_owner)
  values (held_member, held_job, 'cleanup_pending', 'Automated cleanup is in progress.', 'privacy worker'),
         (clear_member, clear_job, 'temporary_financial_hold', 'Waiting', 'privacy worker'),
         (final_member, final_job, 'cleanup_pending', 'Automated cleanup is in progress.', 'privacy worker'),
         (plain_member, plain_job, 'cleanup_pending', 'Automated cleanup is in progress.', 'privacy worker');

  if has_function_privilege('authenticated', 'public.account_deletion_hold_gate(uuid,uuid,uuid)', 'execute')
     or has_function_privilege('anon', 'public.account_deletion_hold_gate(uuid,uuid,uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.account_deletion_finalise(uuid,uuid,uuid,jsonb)', 'execute')
     or has_function_privilege('anon', 'public.account_deletion_finalise(uuid,uuid,uuid,jsonb)', 'execute') then
    raise exception 'FAIL 1: a member or visitor can call the deletion gate or finalise (OS-W11)';
  end if;
  if has_function_privilege('authenticated', 'private.account_deletion_hold_order(uuid)', 'execute')
     or has_function_privilege('authenticated', 'private.requeue_account_deletion_for_hold(uuid)', 'execute') then
    raise exception 'FAIL 2: a member can call the private deletion helpers (OS-W11)';
  end if;

  -- 1. Held: says so, names the order, and changes nothing.
  gate := public.account_deletion_hold_gate(held_job, held_lease, held_member);
  if not (gate->>'held')::boolean then raise exception 'FAIL 3: an open order did not hold the deletion (%) (OS-W11)', gate; end if;
  if (gate->>'hold_order_id')::uuid is distinct from open_order then
    raise exception 'FAIL 4: the gate did not name the order to settle (%) (OS-W11)', gate;
  end if;
  if (select outcome from public.account_deletion_requests where user_id = held_member) <> 'cleanup_pending'
     or (select status from public.remediation_jobs where id = held_job) <> 'processing' then
    raise exception 'FAIL 5: asking the gate changed the case (OS-W11)';
  end if;

  -- 2. Pausing records the order and names it.
  perform public.pause_account_deletion_hold(held_job, held_lease, held_member);
  if (select hold_order_id from public.account_deletion_requests where user_id = held_member) is distinct from open_order then
    raise exception 'FAIL 6: the paused case does not record the order to settle (OS-W11)';
  end if;
  if (select next_action from public.account_deletion_requests where user_id = held_member)
     not like 'Settle order ' || upper(left(open_order::text, 8)) || '%' then
    raise exception 'FAIL 7: the next step does not name the order (OS-W11)';
  end if;
  if (select outcome from public.account_deletion_requests where user_id = held_member) <> 'temporary_financial_hold'
     or (select status from public.remediation_jobs where id = held_job) <> 'pending' then
    raise exception 'FAIL 8: the case was not paused on the hold (OS-W11)';
  end if;

  -- 3. The paused job's lease is gone: the gate refuses it, and a lease for
  -- someone else's job is refused too.
  refused := false;
  begin
    perform public.account_deletion_hold_gate(held_job, held_lease, held_member);
  exception when others then refused := sqlerrm = 'Deletion lease lost';
  end;
  if not refused then raise exception 'FAIL 9: the gate answered for a job without its lease (OS-W11)'; end if;
  refused := false;
  begin
    perform public.account_deletion_finalise(clear_job, clear_lease, held_member, retained);
  exception when others then refused := sqlerrm = 'Deletion lease lost';
  end;
  if not refused then raise exception 'FAIL 10: finalise answered for another member''s job (OS-W11)'; end if;

  -- 4. Clear: a case paused earlier resumes as cleaning up.
  gate := public.account_deletion_hold_gate(clear_job, clear_lease, clear_member);
  if (gate->>'held')::boolean or gate->>'hold_order_id' is not null then
    raise exception 'FAIL 11: a member with nothing open was held (%) (OS-W11)', gate;
  end if;
  if (select outcome from public.account_deletion_requests where user_id = clear_member) <> 'cleanup_pending'
     or (select hold_order_id from public.account_deletion_requests where user_id = clear_member) is not null then
    raise exception 'FAIL 12: a cleared case still reads as paused (OS-W11)';
  end if;

  -- 5. Finalise, held: an order that opened during cleanup holds it, and
  -- nothing is recorded. (The job is still in the queue, so the hold watch
  -- leaves it to this check.)
  insert into public.orders(id, buyer_id, seller_id, status, subtotal_cents, shipping_cents, platform_fee_cents, total_cents, currency)
  values (clear_order, clear_member, seller, 'paid', 5000, 0, 500, 5000, 'USD');
  gate := public.account_deletion_finalise(clear_job, clear_lease, clear_member, retained);
  if not (gate->>'held')::boolean or (gate->>'hold_order_id')::uuid is distinct from clear_order then
    raise exception 'FAIL 13: finalise did not hold on an order opened during cleanup (%) (OS-W11)', gate;
  end if;
  if (select outcome from public.account_deletion_requests where user_id = clear_member) <> 'cleanup_pending'
     or (select status from public.remediation_jobs where id = clear_job) <> 'processing' then
    raise exception 'FAIL 14: a held finalise recorded an outcome (OS-W11)';
  end if;

  -- 6. Finalise, retained identity: recorded and the job finished, together.
  gate := public.account_deletion_finalise(final_job, final_lease, final_member, retained);
  if (gate->>'held')::boolean or gate->>'outcome' <> 'operator_attention' then
    raise exception 'FAIL 15: a past seller''s deletion did not end with the operator step (%) (OS-W11)', gate;
  end if;
  if (select outcome from public.account_deletion_requests where user_id = final_member) <> 'operator_attention'
     or (select next_action from public.account_deletion_requests where user_id = final_member) <> retained->>'next_action'
     or (select status from public.remediation_jobs where id = final_job) <> 'completed' then
    raise exception 'FAIL 16: the operator step and the finished job were not recorded together (OS-W11)';
  end if;

  -- 7. Finalise, nothing kept: deletable outright; the worker finishes it.
  gate := public.account_deletion_finalise(plain_job, plain_lease, plain_member, retained);
  if (gate->>'held')::boolean or gate->>'outcome' <> 'hard_delete_eligible'
     or (select status from public.remediation_jobs where id = plain_job) <> 'processing' then
    raise exception 'FAIL 17: an account with nothing kept was not left for the worker to delete (%) (OS-W11)', gate;
  end if;

  -- 8. A hold after the case finished: a buyer's new order on the finished
  -- seller requeues the case, paused on that order.
  insert into public.orders(id, buyer_id, seller_id, status, subtotal_cents, shipping_cents, platform_fee_cents, total_cents, currency)
  values (late_order, seller, final_member, 'paid', 5000, 0, 500, 5000, 'USD');
  if (select status from public.remediation_jobs where id = final_job) <> 'pending'
     or (select next_attempt_at from public.remediation_jobs where id = final_job) > now() then
    raise exception 'FAIL 18: a hold after the case finished did not put it back in the queue (OS-W11)';
  end if;
  if (select outcome from public.account_deletion_requests where user_id = final_member) <> 'temporary_financial_hold'
     or (select hold_order_id from public.account_deletion_requests where user_id = final_member) is distinct from late_order then
    raise exception 'FAIL 19: the requeued case does not say which order to settle (OS-W11)';
  end if;

  -- 9. Writes: a held member's go through; one being cleaned up is refused.
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', held_member, 'role', 'authenticated')::text, true);
  begin
    update public.profiles set store_note = store_note where false;
  exception when insufficient_privilege then
    perform set_config('role', 'none', true);
    raise exception 'FAIL 20: a member whose deletion is paused on a hold still can''t write (%) (OS-W11)', sqlerrm;
  end;
  perform set_config('request.jwt.claims', json_build_object('sub', plain_member, 'role', 'authenticated')::text, true);
  refused := false;
  begin
    update public.profiles set store_note = store_note where false;
  exception when insufficient_privilege then refused := sqlerrm = 'Account deletion is pending';
  end;
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
  if not refused then raise exception 'FAIL 21: a member being cleaned up could write (OS-W11)'; end if;

  raise notice 'all deletion hold before ban checks passed';
end $$;

rollback;
