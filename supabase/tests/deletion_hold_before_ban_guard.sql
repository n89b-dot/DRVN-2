-- OS-W11 follow-up: account deletion checks financial holds before it bans
-- sign-in (20261108130400).
--   - the gate answers held, with the order to settle, and changes nothing
--   - pausing records that order and names it in the next step
--   - a clear gate resumes a paused case as cleaning up
--   - the gate needs the job's live lease, and only the service role calls it
begin;

do $$
declare
  held_member uuid := gen_random_uuid();
  clear_member uuid := gen_random_uuid();
  seller uuid := gen_random_uuid();
  open_order uuid := gen_random_uuid();
  held_job uuid;
  clear_job uuid;
  held_lease uuid := gen_random_uuid();
  clear_lease uuid := gen_random_uuid();
  gate jsonb;
  refused boolean;
begin
  insert into auth.users(id, email, raw_user_meta_data) values
    (held_member, 'w11h-held@drvn.test', '{}'),
    (clear_member, 'w11h-clear@drvn.test', '{}'),
    (seller, 'w11h-seller@drvn.test', '{}');

  -- The held member is buying something that hasn't arrived.
  insert into public.orders(id, buyer_id, seller_id, status, subtotal_cents, shipping_cents, platform_fee_cents, total_cents, currency)
  values (open_order, held_member, seller, 'paid', 5000, 0, 500, 5000, 'USD');

  -- Both jobs as the worker holds them mid-run.
  insert into public.remediation_jobs(kind, dedup_key, payload, status, lease_id, locked_until)
  values ('delete_account', 'delete:' || held_member, jsonb_build_object('user_id', held_member), 'processing', held_lease, now() + interval '5 minutes')
  returning id into held_job;
  insert into public.remediation_jobs(kind, dedup_key, payload, status, lease_id, locked_until)
  values ('delete_account', 'delete:' || clear_member, jsonb_build_object('user_id', clear_member), 'processing', clear_lease, now() + interval '5 minutes')
  returning id into clear_job;
  insert into public.account_deletion_requests(user_id, job_id, outcome, next_action, responsible_owner)
  values (held_member, held_job, 'cleanup_pending', 'Automated cleanup is in progress.', 'privacy worker'),
         (clear_member, clear_job, 'temporary_financial_hold', 'Waiting', 'privacy worker');

  if has_function_privilege('authenticated', 'public.account_deletion_hold_gate(uuid,uuid,uuid)', 'execute')
     or has_function_privilege('anon', 'public.account_deletion_hold_gate(uuid,uuid,uuid)', 'execute') then
    raise exception 'FAIL 1: a member or visitor can call the deletion hold gate';
  end if;
  if has_function_privilege('authenticated', 'private.account_deletion_hold_order(uuid)', 'execute') then
    raise exception 'FAIL 2: a member can read which order holds someone''s deletion';
  end if;

  -- 1. Held: says so, names the order, and changes nothing.
  gate := public.account_deletion_hold_gate(held_job, held_lease, held_member);
  if not (gate->>'held')::boolean then raise exception 'FAIL 3: an open order did not hold the deletion (%)', gate; end if;
  if (gate->>'hold_order_id')::uuid is distinct from open_order then
    raise exception 'FAIL 4: the gate did not name the order to settle (%)', gate;
  end if;
  if (select outcome from public.account_deletion_requests where user_id = held_member) <> 'cleanup_pending'
     or (select status from public.remediation_jobs where id = held_job) <> 'processing' then
    raise exception 'FAIL 5: asking the gate changed the case';
  end if;

  -- 2. Pausing records the order and names it.
  perform public.pause_account_deletion_hold(held_job, held_lease, held_member);
  if (select hold_order_id from public.account_deletion_requests where user_id = held_member) is distinct from open_order then
    raise exception 'FAIL 6: the paused case does not record the order to settle';
  end if;
  if (select next_action from public.account_deletion_requests where user_id = held_member)
     not like 'Settle order ' || upper(left(open_order::text, 8)) || '%' then
    raise exception 'FAIL 7: the next step does not name the order';
  end if;
  if (select outcome from public.account_deletion_requests where user_id = held_member) <> 'temporary_financial_hold'
     or (select status from public.remediation_jobs where id = held_job) <> 'pending' then
    raise exception 'FAIL 8: the case was not paused on the hold';
  end if;

  -- 3. The paused job's lease is gone: the gate refuses it.
  refused := false;
  begin
    perform public.account_deletion_hold_gate(held_job, held_lease, held_member);
  exception when others then refused := sqlerrm = 'Deletion lease lost';
  end;
  if not refused then raise exception 'FAIL 9: the gate answered for a job without its lease'; end if;

  -- A lease for someone else's job is refused too.
  refused := false;
  begin
    perform public.account_deletion_hold_gate(clear_job, clear_lease, held_member);
  exception when others then refused := sqlerrm = 'Deletion lease lost';
  end;
  if not refused then raise exception 'FAIL 10: the gate answered for another member''s job'; end if;

  -- 4. Clear: a case paused earlier resumes as cleaning up.
  gate := public.account_deletion_hold_gate(clear_job, clear_lease, clear_member);
  if (gate->>'held')::boolean or gate->>'hold_order_id' is not null then
    raise exception 'FAIL 11: a member with nothing open was held (%)', gate;
  end if;
  if (select outcome from public.account_deletion_requests where user_id = clear_member) <> 'cleanup_pending'
     or (select hold_order_id from public.account_deletion_requests where user_id = clear_member) is not null then
    raise exception 'FAIL 12: a cleared case still reads as paused';
  end if;
  if not (gate ? 'retained_identity') then
    raise exception 'FAIL 13: the gate dropped the retained-identity answer the worker needs';
  end if;

  raise notice 'all deletion hold before ban checks passed';
end $$;

rollback;
