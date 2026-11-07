-- The agent foundation (20261021100000 / 20261021100100): the A2 security
-- regression set, run against the real worker role with SET ROLE.
--   1. The worker role: NOLOGIN, no table privileges, and the only definer
--      functions it can run beyond a visitor's are the worker functions.
--   2. Calling privileged functions directly: members can't reach the worker
--      functions or the move cores; the worker can't reach tables or cores.
--   3. Reading hidden floors and another member's mandate.
--   4. The effective floor: the agent's minimum only ever raises it.
--   5. A lease is required: wrong lease, expired lease, wrong action, another
--      offer or round, a seller agent accepting, a buyer over its ceiling.
--   6. Duplicated event delivery: one job per turn, one write per job, and a
--      duplicate job for the same move replays instead of moving twice.
--   7. Acting after the owner turns it off.
--   8. Acting under each kill switch.
--   9. The outbox and task lifecycle, approvals, the round's agent columns.
--  10. Append-only events, card redaction, retention and account purge.
begin;

create function pg_temp.act(p_member uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true), set_config('request.jwt.claims', jsonb_build_object('sub', p_member, 'role', 'authenticated')::text, true);
$$;

create function pg_temp.worker() returns void language sql as $$
  select set_config('role', 'agent_worker', true), set_config('request.jwt.claims', '', true);
$$;

create function pg_temp.reset() returns void language sql as $$
  select set_config('role', 'none', true), set_config('request.jwt.claims', '', true);
$$;

create function pg_temp.code(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return 'ok';
exception when others then
  return sqlstate;
end $$;

create function pg_temp.claim(p_n integer default 1) returns table(job_id uuid, lease_id uuid, kind text, offer_id uuid, round_no integer)
language sql as $$ select c.job_id, c.lease_id, c.kind, c.offer_id, c.round_no from public.agent_claim_jobs(p_n, 60) c $$;

do $$
declare
  seller uuid := gen_random_uuid();
  buyer uuid := gen_random_uuid();
  other uuid := gen_random_uuid();
  part uuid := gen_random_uuid();
  part2 uuid := gen_random_uuid();
  part3 uuid := gen_random_uuid();
  o1 uuid := gen_random_uuid();
  o2 uuid := gen_random_uuid();
  o3 uuid := gen_random_uuid();
  seller_mandate uuid;
  buyer_mandate uuid;
  m3 uuid;
  j record;
  j2 record;
  r jsonb;
  c text;
  n integer;
  approval uuid;
  ctx jsonb;
begin
  update public.beta_access_config set enforced = false where singleton = true;
  -- The guard drives agents, so lift the seeded "all" switch inside this transaction.
  update public.agent_controls set cleared_at = now() where scope = 'all' and cleared_at is null;
  -- Mandates need their side's beta step open (20261026100000).
  update public.agent_beta_steps set open = true where step in ('seller', 'buyer');
  insert into auth.users(id, email) values
    (seller, 'agent-seller@drvn.test'), (buyer, 'agent-buyer@drvn.test'), (other, 'agent-other@drvn.test');
  insert into public.listings(id, seller_id, title, category, price_cents, shipping_cents, status)
  values (part, seller, 'Agent guard turbo', 'performance', 100000, 2000, 'active'),
         (part2, seller, 'Agent guard wheels', 'performance', 80000, 0, 'active'),
         (part3, seller, 'Agent guard seats', 'performance', 50000, 0, 'active');
  -- The listing's own minimum lives only in listing_private_terms.
  insert into public.listing_private_terms(listing_id, seller_id, offer_floor_cents)
  values (part, seller, 60000), (part2, seller, 40000), (part3, seller, 20000)
  on conflict (listing_id) do update set offer_floor_cents = excluded.offer_floor_cents;

  -- 1. The role.
  if (select rolcanlogin from pg_roles where rolname = 'agent_worker') then
    raise exception 'FAIL 1: agent_worker can log in from a migration';
  end if;
  if exists (select 1 from pg_auth_members m join pg_roles r on r.oid = m.member where r.rolname = 'agent_worker') then
    raise exception 'FAIL 2: agent_worker is a member of another role';
  end if;
  if exists (select 1 from pg_class c join pg_namespace s on s.oid = c.relnamespace
             where s.nspname in ('public', 'auth', 'storage') and c.relkind in ('r', 'v', 'm', 'p', 'S')
               and (has_table_privilege('agent_worker', c.oid, 'select') or has_table_privilege('agent_worker', c.oid, 'insert')
                    or has_table_privilege('agent_worker', c.oid, 'update') or has_table_privilege('agent_worker', c.oid, 'delete'))) then
    raise exception 'FAIL 3: agent_worker has a table privilege';
  end if;
  select count(*) into n from pg_proc p
  where p.pronamespace = 'public'::regnamespace and p.prosecdef and p.prorettype <> 'trigger'::regtype
    and has_function_privilege('agent_worker', p.oid, 'execute')
    and not has_function_privilege('anon', p.oid, 'execute')
    and p.proname not in ('agent_claim_jobs', 'agent_renew_lease', 'agent_job_context', 'agent_offer_move',
      'agent_offer_open', 'agent_request_approval', 'agent_record_decision', 'agent_finish_job');
  if n <> 0 then raise exception 'FAIL 4: agent_worker can run % definer function(s) beyond the worker set', n; end if;
  select count(*) into n from pg_proc p
  where p.pronamespace = 'public'::regnamespace
    and p.proname in ('agent_claim_jobs', 'agent_renew_lease', 'agent_job_context', 'agent_offer_move',
      'agent_offer_open', 'agent_request_approval', 'agent_record_decision', 'agent_finish_job')
    and has_function_privilege('agent_worker', p.oid, 'execute')
    and not has_function_privilege('anon', p.oid, 'execute') and not has_function_privilege('authenticated', p.oid, 'execute')
    and not has_function_privilege('service_role', p.oid, 'execute');
  if n <> 8 then raise exception 'FAIL 5: the worker functions are not the worker''s alone (% of 8)', n; end if;

  -- 2. Privileged functions called directly.
  perform pg_temp.act(seller);
  c := pg_temp.code(format('select public.agent_offer_move(%L, %L, %L, ''counter'', 90000, 1)', gen_random_uuid(), gen_random_uuid(), o1));
  if c <> '42501' then raise exception 'FAIL 6: a member reached agent_offer_move (%)', c; end if;
  c := pg_temp.code(format('select public.offer_move_core(%L, %L, ''counter'', 90000, ''core-direct-01'', 1, null)', buyer, o1));
  if c <> '42501' then raise exception 'FAIL 7: a member reached offer_move_core (%)', c; end if;
  c := pg_temp.code('select * from public.agent_claim_jobs(1, 60)');
  if c <> '42501' then raise exception 'FAIL 8: a member claimed agent jobs (%)', c; end if;
  c := pg_temp.code('select public.agent_reconcile_outbox(10)');
  if c <> '42501' then raise exception 'FAIL 9: a member ran the outbox sweep (%)', c; end if;
  c := pg_temp.code(format('select public.admin_set_agent_control(''all'', null, false, ''lift'')'));
  if c <> '42501' then raise exception 'FAIL 10: a member flipped a kill switch (%)', c; end if;
  perform pg_temp.worker();
  c := pg_temp.code('select count(*) from public.agent_mandates');
  if c <> '42501' then raise exception 'FAIL 11: the worker read a table (%)', c; end if;
  c := pg_temp.code('select count(*) from public.listing_private_terms');
  if c <> '42501' then raise exception 'FAIL 12: the worker read the private floors (%)', c; end if;
  c := pg_temp.code(format('select public.offer_move_core(%L, %L, ''counter'', 90000, ''core-direct-02'', 1, null)', seller, o1));
  if c <> '42501' then raise exception 'FAIL 13: the worker reached offer_move_core (%)', c; end if;
  c := pg_temp.code(format('select public.offer_move(%L, ''counter'', 90000, ''worker-move-01'', 1)', o1));
  if c <> '42501' then raise exception 'FAIL 14: the worker reached the member''s offer_move (%)', c; end if;
  c := pg_temp.code(format('select public.agent_mandate_set(''seller'', %L, 70000)', part));
  if c <> '42501' then raise exception 'FAIL 15: the worker set a mandate (%)', c; end if;
  perform pg_temp.reset();

  -- 3. Mandates: the seller's agent minimum (70k) is stricter than the floor (60k).
  perform pg_temp.act(seller);
  c := pg_temp.code(format('select public.agent_mandate_set(''seller'', %L, 70000, 95000)', part));
  if c <> '22023' then raise exception 'FAIL 16: a seller mandate without the binding acknowledgement was accepted (%)', c; end if;
  seller_mandate := public.agent_mandate_set('seller', part, 70000, 95000, null, null, 'balanced', null, true);
  c := pg_temp.code(format('select public.agent_mandate_set(''buyer'', %L, null, null, 90000, ''item'')', part));
  if c <> '42501' then raise exception 'FAIL 17: a seller set a buyer mandate on their own listing (%)', c; end if;
  perform pg_temp.act(buyer);
  c := pg_temp.code(format('select public.agent_mandate_set(''seller'', %L, 50000, null, null, null, ''balanced'', null, true)', part));
  if c <> '42501' then raise exception 'FAIL 18: a buyer set a seller mandate on someone else''s listing (%)', c; end if;
  if exists (select 1 from public.agent_mandates) or exists (select 1 from public.agent_tasks)
     or exists (select 1 from public.agent_events) or exists (select 1 from public.agent_mandate_versions) then
    raise exception 'FAIL 19: a member read another member''s mandate, task or record';
  end if;
  c := pg_temp.code('select count(*) from public.offer_round_terms');
  if c <> '42501' then raise exception 'FAIL 20: a member read round terms (%)', c; end if;
  c := pg_temp.code('select count(*) from public.listing_private_terms where offer_floor_cents is not null');
  if c = 'ok' and (select count(*) from public.listing_private_terms) > 0 then raise exception 'FAIL 20b: a buyer read a seller''s floor'; end if;
  c := pg_temp.code('select count(*) from public.agent_jobs');
  if c <> '42501' then raise exception 'FAIL 21: a member read the agent queue (%)', c; end if;
  perform pg_temp.act(seller);
  if (select count(*) from public.agent_mandates) <> 1 or (select count(*) from public.agent_tasks) <> 1 then
    raise exception 'FAIL 22: the owner cannot read their own mandate and task';
  end if;
  perform pg_temp.reset();

  -- 4. The effective floor is the higher one, never lower.
  if public.offer_effective_floor(part) <> 70000 then raise exception 'FAIL 23: the agent minimum did not raise the floor'; end if;
  perform pg_temp.act(seller);
  perform public.agent_mandate_set('seller', part2, 30000, null, null, null, 'firm', null, true);
  perform pg_temp.reset();
  if public.offer_effective_floor(part2) <> 40000 then raise exception 'FAIL 24: a laxer agent minimum lowered the listing floor'; end if;
  -- A buyer below the agent minimum (but above the listing floor) is declined at once.
  perform pg_temp.act(buyer);
  r := public.offer_open(gen_random_uuid(), part, 65000, null);
  if r->>'outcome' <> 'below_minimum' then raise exception 'FAIL 25: an offer under the agent minimum was not declined (%)', r; end if;
  perform pg_temp.reset();

  -- 5. A buyer offer queues the seller agent's turn, once.
  perform pg_temp.act(buyer);
  r := public.offer_open(o1, part, 72000, null);
  perform pg_temp.reset();
  if (select count(*) from public.agent_jobs where offer_id = o1 and status = 'pending') <> 1 then
    raise exception 'FAIL 26: the opening offer did not queue exactly one seller job';
  end if;
  if (select status from public.agent_tasks where mandate_id = seller_mandate) <> 'working' then
    raise exception 'FAIL 27: the seller task did not start working';
  end if;
  -- Re-delivery: the sweep finds the job already there.
  r := public.agent_reconcile_outbox(50);
  if (r->>'enqueued')::integer <> 0 or (select count(*) from public.agent_jobs where offer_id = o1) <> 1 then
    raise exception 'FAIL 28: a redelivered event queued a second job (%)', r;
  end if;

  perform pg_temp.worker();
  select * into j from pg_temp.claim() limit 1;
  if j.job_id is null or j.offer_id <> o1 or j.round_no <> 1 then raise exception 'FAIL 29: the worker could not claim the turn'; end if;
  ctx := public.agent_job_context(j.job_id, j.lease_id);
  if (ctx->>'effective_floor_cents')::integer <> 70000 or ctx->'mandate'->>'ceiling_cents' is not null then
    raise exception 'FAIL 30: the seller context is wrong (%)', ctx;
  end if;
  -- Leases and matching.
  c := pg_temp.code(format('select public.agent_offer_move(%L, %L, %L, ''counter'', 90000, 1)', j.job_id, gen_random_uuid(), o1));
  if c <> 'AG001' then raise exception 'FAIL 31: a wrong lease was accepted (%)', c; end if;
  c := pg_temp.code(format('select public.agent_offer_open(%L, %L, %L, 50000)', j.job_id, j.lease_id, part));
  if c <> 'AG002' then raise exception 'FAIL 32: a turn job opened an offer (%)', c; end if;
  c := pg_temp.code(format('select public.agent_offer_move(%L, %L, %L, ''counter'', 90000, 2)', j.job_id, j.lease_id, o1));
  if c <> 'AG002' then raise exception 'FAIL 33: a job moved another round (%)', c; end if;
  c := pg_temp.code(format('select public.agent_offer_move(%L, %L, %L, ''accept'', null, 1)', j.job_id, j.lease_id, o1));
  if c <> 'AG008' then raise exception 'FAIL 34: the seller''s agent accepted an offer (%)', c; end if;
  c := pg_temp.code(format('select public.agent_offer_move(%L, %L, %L, ''counter'', 68000, 1)', j.job_id, j.lease_id, o1));
  if c <> 'OF004' then raise exception 'FAIL 35: the seller agent countered under its own minimum (%)', c; end if;
  r := public.agent_offer_move(j.job_id, j.lease_id, o1, 'counter', 90000, 1);
  if (r->>'round_no')::integer <> 2 then raise exception 'FAIL 36: the agent counter did not land (%)', r; end if;
  -- The same job can't write twice.
  c := pg_temp.code(format('select public.agent_offer_move(%L, %L, %L, ''counter'', 89000, 1)', j.job_id, j.lease_id, o1));
  if c <> 'AG001' then raise exception 'FAIL 37: a finished job wrote again (%)', c; end if;
  perform pg_temp.reset();
  if (select actor_task_id is null or actor_job_id <> j.job_id or mandate_version <> 1 from public.offer_rounds where offer_id = o1 and round_no = 2) then
    raise exception 'FAIL 38: the round does not record the agent''s authority';
  end if;
  if (select actor_member_id from public.offer_rounds where offer_id = o1 and round_no = 2) <> seller then
    raise exception 'FAIL 39: the agent''s move was not made as its owner';
  end if;
  if (select count(*) from public.agent_events where task_id = (select id from public.agent_tasks where mandate_id = seller_mandate) and kind = 'move') <> 1 then
    raise exception 'FAIL 40: the move was not recorded';
  end if;

  -- 6. A duplicate job for the same move replays instead of moving twice.
  perform pg_temp.act(buyer);
  r := public.offer_move(o1, 'counter', 80000, 'buyer-cb-000001', 2);
  perform pg_temp.reset();
  insert into public.agent_jobs(task_id, kind, expected_action, listing_id, offer_id, round_no, dedup_key)
  select task_id, kind, expected_action, listing_id, offer_id, round_no, dedup_key || ':dup'
  from public.agent_jobs where offer_id = o1 and round_no = 3 and status = 'pending';
  perform pg_temp.worker();
  n := 0;
  c := '';
  for j in select * from pg_temp.claim(10) loop
    c := c || pg_temp.code(format('select public.agent_offer_move(%L, %L, %L, ''counter'', 86000, 3)', j.job_id, j.lease_id, o1)) || ' ';
    n := n + 1;
  end loop;
  perform pg_temp.reset();
  -- The first lands; the move itself cancels the duplicate's lease.
  if n <> 2 or c <> 'ok AG001 ' or (select round_count from public.offers where id = o1) <> 4 then
    raise exception 'FAIL 41: a duplicated delivery moved twice (% jobs: %, round %)', n, c, (select round_count from public.offers where id = o1);
  end if;
  -- And an exact repeat of a committed move replays.
  r := public.offer_move_core(seller, o1, 'counter', 86000, 'counter:' || o1 || ':r3:86000', 3, null);
  if not (r->>'replayed')::boolean or (select round_count from public.offers where id = o1) <> 4 then
    raise exception 'FAIL 41b: a repeated agent move did not replay (%)', r;
  end if;

  -- 7. Buyer agent: its own ceiling, never the seller's floor.
  perform pg_temp.act(buyer);
  buyer_mandate := public.agent_mandate_set('buyer', part, null, null, 87000, 'total', 'balanced', null, false);
  perform pg_temp.reset();
  perform pg_temp.worker();
  select * into j from pg_temp.claim() limit 1;
  if j.offer_id <> o1 or j.round_no <> 4 then raise exception 'FAIL 42: setting a buyer mandate did not queue the buyer''s turn'; end if;
  ctx := public.agent_job_context(j.job_id, j.lease_id);
  if ctx ? 'effective_floor_cents' and ctx->>'effective_floor_cents' is not null then
    raise exception 'FAIL 43: the buyer''s agent was shown the seller''s minimum (%)', ctx;
  end if;
  if ctx::text like '%70000%' or ctx::text like '%60000%' then
    raise exception 'FAIL 44: a seller limit leaked into the buyer''s context';
  end if;
  -- Total basis: 86,000 + 2,000 shipping is over 87,000.
  c := pg_temp.code(format('select public.agent_offer_move(%L, %L, %L, ''accept'', null, 4)', j.job_id, j.lease_id, o1));
  if c <> 'AG006' then raise exception 'FAIL 45: the buyer agent accepted above its total ceiling (%)', c; end if;
  c := pg_temp.code(format('select public.agent_offer_move(%L, %L, %L, ''counter'', 85500, 4)', j.job_id, j.lease_id, o1));
  if c <> 'AG006' then raise exception 'FAIL 46: the buyer agent countered above its total ceiling (%)', c; end if;
  -- It asks its owner instead.
  approval := public.agent_request_approval(j.job_id, j.lease_id, o1, 4, 'The seller wants more than your limit');
  perform pg_temp.reset();
  if (select status from public.agent_tasks where mandate_id = buyer_mandate) <> 'needs_approval' then
    raise exception 'FAIL 47: the buyer task is not waiting on its owner';
  end if;
  perform pg_temp.act(other);
  c := pg_temp.code(format('select public.agent_approval_decide(%L, ''accept'')', approval));
  if c <> 'P0002' then raise exception 'FAIL 48: another member answered an approval (%)', c; end if;

  -- 8. Acting after the owner turns it off.
  perform pg_temp.act(buyer);
  r := public.offer_open(o2, part2, 50000, null);
  perform pg_temp.reset();
  perform pg_temp.worker();
  select * into j from pg_temp.claim() limit 1;
  perform pg_temp.reset();
  if j.offer_id <> o2 then raise exception 'FAIL 49: the second listing''s turn was not queued'; end if;
  perform pg_temp.act(seller);
  perform public.agent_mandate_set_status((select id from public.agent_mandates where listing_id = part2), 'revoked');
  perform pg_temp.worker();
  c := pg_temp.code(format('select public.agent_offer_move(%L, %L, %L, ''counter'', 70000, 1)', j.job_id, j.lease_id, o2));
  if c <> 'AG003' then raise exception 'FAIL 50: the agent acted after its owner turned it off (%)', c; end if;
  if not public.agent_finish_job(j.job_id, j.lease_id, 'cancelled', c) then raise exception 'FAIL 51: the job could not be handed back'; end if;
  perform pg_temp.reset();
  if (select status from public.agent_tasks where mandate_id = (select id from public.agent_mandates where listing_id = part2)) <> 'cancelled' then
    raise exception 'FAIL 52: turning the agent off did not cancel its task';
  end if;
  if not exists (select 1 from public.agent_telemetry where kind = 'permission_denied' and code = 'AG003') then
    raise exception 'FAIL 53: the denial was not recorded for monitoring';
  end if;
  if public.offer_effective_floor(part2) <> 40000 then raise exception 'FAIL 54: a revoked minimum still applies'; end if;

  -- 9. Kill switches: each one stops the claim and the write. The offer stays as it was.
  perform pg_temp.act(seller);
  m3 := public.agent_mandate_set('seller', part3, 25000, null, null, null, 'balanced', null, true);
  perform pg_temp.act(buyer);
  r := public.offer_open(o3, part3, 26000, null);
  perform pg_temp.reset();
  declare
    sw record;
  begin
    for sw in select * from (values ('all', null::uuid), ('seller', null), ('member', seller), ('mandate', m3), ('listing', part3), ('account', buyer)) s(scope, subject) loop
      insert into public.agent_controls(scope, subject_id, reason) values (sw.scope, sw.subject, 'guard');
      perform pg_temp.worker();
      if exists (select 1 from pg_temp.claim(10) x where x.offer_id = o3) then
        raise exception 'FAIL 55: a job was claimed under the % kill switch', sw.scope;
      end if;
      perform pg_temp.reset();
      update public.agent_controls set cleared_at = now() where scope = sw.scope and subject_id is not distinct from sw.subject and cleared_at is null;
    end loop;
    -- Skipped jobs stepped back a minute in the queue; time passes.
    if not exists (select 1 from public.agent_jobs where offer_id = o3 and available_at > now()) then
      raise exception 'FAIL 55b: a job skipped under a switch kept its place at the front';
    end if;
    update public.agent_jobs set available_at = now() where offer_id = o3 and status = 'pending';
    -- A switch thrown after the claim stops the write too.
    perform pg_temp.worker();
    select * into j from pg_temp.claim(10) x where x.offer_id = o3 limit 1;
    perform pg_temp.reset();
    if j.job_id is null then raise exception 'FAIL 56: the job did not run once the switches cleared'; end if;
    insert into public.agent_controls(scope, subject_id, reason) values ('seller', null, 'guard');
    perform pg_temp.worker();
    c := pg_temp.code(format('select public.agent_offer_move(%L, %L, %L, ''counter'', 40000, 1)', j.job_id, j.lease_id, j.offer_id));
    perform pg_temp.reset();
    if c <> 'AG004' then raise exception 'FAIL 57: the agent acted under a kill switch (%)', c; end if;
    if (select status from public.offers where id = j.offer_id) <> 'open' then raise exception 'FAIL 58: a kill switch changed an offer'; end if;
    update public.agent_controls set cleared_at = now() where scope = 'seller' and cleared_at is null;
  end;

  -- 10. Approval → the owner accepts as themself; the task completes and the mandate ends.
  perform pg_temp.act(buyer);
  r := public.agent_approval_decide(approval, 'accept');
  perform pg_temp.reset();
  if r->>'order_id' is null or (select status from public.offers where id = o1) <> 'accepted' then
    raise exception 'FAIL 59: accepting the approval did not accept the offer (%)', r;
  end if;
  if (select actor_task_id from public.offer_rounds where offer_id = o1 and kind = 'accept') is not null then
    raise exception 'FAIL 60: the owner''s own accept was labelled as the agent''s';
  end if;
  -- The buyer's task is done; the seller's waits for the sale to complete,
  -- so a cancelled checkout keeps the agent's minimum.
  if (select status from public.agent_tasks where mandate_id = buyer_mandate) <> 'completed'
     or (select status from public.agent_mandates where id = buyer_mandate) <> 'ended'
     or (select finished_at from public.agent_tasks where mandate_id = seller_mandate) is not null
     or (select status from public.agent_mandates where id = seller_mandate) <> 'active' then
    raise exception 'FAIL 61: the sale did not settle the tasks as it should';
  end if;
  update public.listings set status = 'sold', sold_at = now() where id = part;
  r := public.agent_reconcile_outbox(50);
  if (select status || ':' || outcome from public.agent_tasks where mandate_id = seller_mandate) <> 'completed:sold'
     or (select status from public.agent_mandates where id = seller_mandate) <> 'ended' then
    raise exception 'FAIL 61b: a sold listing did not complete the seller''s task (%)', r;
  end if;
  if (select status from public.agent_approvals where id = approval) <> 'approved' then
    raise exception 'FAIL 62: the approval does not say approved';
  end if;

  -- 11. Append-only record, redaction.
  c := pg_temp.code(format('update public.agent_events set result = ''{}'' where task_id = (select id from public.agent_tasks where mandate_id = %L)', seller_mandate));
  if c <> '42501' then raise exception 'FAIL 63: an agent event was edited (%)', c; end if;
  c := pg_temp.code('delete from public.agent_events');
  if c <> '42501' then raise exception 'FAIL 64: agent events were deleted outside the purge (%)', c; end if;
  insert into public.agent_conversations(owner_id) values (buyer);
  insert into public.agent_messages(conversation_id, owner_id, role, body)
  select id, buyer, 'member', 'my card is 4242 4242 4242 4242 and part 1234-5678-9012' from public.agent_conversations where owner_id = buyer;
  if (select body from public.agent_messages where owner_id = buyer) <> 'my card is [card number removed] and part 1234-5678-9012' then
    raise exception 'FAIL 65: a card number was stored (%)', (select body from public.agent_messages where owner_id = buyer);
  end if;
  if public.agent_redact_cards('card 4242 4242 4242 4242 12/28') <> 'card [card number removed] 12/28'
     or public.agent_redact_cards('4242-4242-4242-4242 1234 ok') <> '[card number removed] 1234 ok'
     or public.agent_redact_cards('order 4242 4242 4242 4241') <> 'order 4242 4242 4242 4241' then
    raise exception 'FAIL 65b: a card followed by other digits was stored';
  end if;
  if (select reason from public.agent_approvals where id = approval) like '%4242%'
     or exists (select 1 from public.agent_events where inputs::text like '%4242 4242%' or result::text like '%4242 4242%') then
    raise exception 'FAIL 65c: a card number reached an approval or the record';
  end if;
  insert into public.agent_events(owner_id, kind, inputs) values (seller, 'decision', jsonb_build_object('reason', 'pay 4242 4242 4242 4242'));
  if exists (select 1 from public.agent_events where inputs->>'reason' like '%4242%') then
    raise exception 'FAIL 65d: the record kept a card number';
  end if;
  c := pg_temp.code(format('update public.agent_tasks set status = ''working'' where mandate_id = %L', buyer_mandate));
  if c <> '23514' then raise exception 'FAIL 66: a finished task was reopened (%)', c; end if;

  -- 11b. The sweep ends tasks whose listing went or whose mandate expired.
  perform pg_temp.act(seller);
  m3 := public.agent_mandate_set('seller', part3, 25000, null, null, null, 'balanced', now() + interval '1 hour', true);
  perform pg_temp.reset();
  update public.agent_mandates set expires_at = now() - interval '1 minute' where id = m3;
  r := public.agent_reconcile_outbox(50);
  if (r->>'ended')::integer < 1 or (select status from public.agent_tasks where mandate_id = m3) <> 'cancelled'
     or (select status from public.agent_mandates where id = m3) <> 'ended' then
    raise exception 'FAIL 66b: an expired mandate left its task open (%)', r;
  end if;

  -- 11c. A race the outbox must survive: the buyer's mandate was turned off
  --      while its task still looked open. A person's accept must still land.
  declare
    part4 uuid := gen_random_uuid();
    o4 uuid := gen_random_uuid();
    m4 uuid;
    t4 uuid;
  begin
    insert into public.listings(id, seller_id, title, category, price_cents, shipping_cents, status)
    values (part4, seller, 'Agent guard race', 'performance', 30000, 0, 'active');
    perform pg_temp.act(other);
    m4 := public.agent_mandate_set('buyer', part4, null, null, 29000, 'item', 'balanced', null, false);
    r := public.offer_open(o4, part4, 25000, null);
    perform pg_temp.reset();
    update public.agent_mandates set status = 'revoked', ended_at = now() where id = m4;
    perform pg_temp.act(seller);
    c := pg_temp.code(format('select public.offer_move(%L, ''accept'', null, ''race-accept-01'', 1)', o4));
    perform pg_temp.reset();
    if c <> 'ok' then raise exception 'FAIL 66c: a turned-off mandate broke a person''s accept (%)', c; end if;

    -- 11d. Resuming a mandate whose task ended opens a new one.
    perform pg_temp.act(other);
    m4 := public.agent_mandate_set('buyer', part2, null, null, 70000, 'item', 'firm', null, false);
    perform public.agent_mandate_set_status(m4, 'paused');
    perform pg_temp.reset();
    update public.agent_tasks set status = 'failed', outcome = 'guard' where mandate_id = m4 and finished_at is null;
    perform pg_temp.act(other);
    perform public.agent_mandate_set_status(m4, 'active');
    perform pg_temp.reset();
    select id into t4 from public.agent_tasks where mandate_id = m4 and finished_at is null;
    if t4 is null then raise exception 'FAIL 66d: resuming did not open a task'; end if;

    -- 11e. A null answer is refused, not taken as "dismiss".
    perform pg_temp.act(other);
    c := pg_temp.code(format('select public.agent_approval_decide(%L, null)', gen_random_uuid()));
    if c <> '22023' then raise exception 'FAIL 66e: a null approval choice was accepted (%)', c; end if;
    c := pg_temp.code(format('select public.agent_mandate_set_status(%L, null)', m4));
    if c <> '22023' then raise exception 'FAIL 66f: a null mandate status was accepted (%)', c; end if;
    perform pg_temp.reset();

    -- 11g. A paused job steps back in the queue instead of blocking it, and a
    --      no-move decision is refused under a kill switch.
    perform pg_temp.act(other);
    perform public.agent_mandate_set_status(m4, 'paused');
    perform pg_temp.reset();
    perform pg_temp.worker();
    perform * from pg_temp.claim(50);
    perform pg_temp.reset();
    if exists (select 1 from public.agent_jobs where task_id = t4 and status = 'pending' and available_at <= now()) then
      raise exception 'FAIL 66g: a paused job stayed at the front of the queue';
    end if;
    perform pg_temp.act(other);
    perform public.agent_mandate_set_status(m4, 'active');
    perform pg_temp.reset();
    update public.agent_jobs set available_at = now() where task_id = t4 and status = 'pending';
    perform pg_temp.worker();
    select * into j from pg_temp.claim(50) x where x.kind = 'offer_open' limit 1;
    perform pg_temp.reset();
    if j.job_id is null then raise exception 'FAIL 66h: the resumed job was not claimable'; end if;
    insert into public.agent_controls(scope, subject_id, reason) values ('member', other, 'guard');
    perform pg_temp.worker();
    c := pg_temp.code(format('select public.agent_record_decision(%L, %L, ''hold'', ''guard'')', j.job_id, j.lease_id));
    perform pg_temp.reset();
    if c <> 'AG004' then raise exception 'FAIL 66i: a decision was recorded under a kill switch (%)', c; end if;
    update public.agent_controls set cleared_at = now() where scope = 'member' and subject_id = other and cleared_at is null;
  end;

  -- 12. Retention and account purge.
  update public.agent_jobs set finished_at = now() - interval '31 days' where offer_id = o1 and finished_at is not null;
  r := public.agent_retention_sweep();
  if (r->>'jobs')::integer < 1 or exists (select 1 from public.agent_jobs where offer_id = o1 and finished_at < now() - interval '30 days') then
    raise exception 'FAIL 67: finished jobs outlived 30 days (%)', r;
  end if;
  if (select actor_job_id from public.offer_rounds where offer_id = o1 and round_no = 2) is not null
     or (select actor_task_id from public.offer_rounds where offer_id = o1 and round_no = 2) is null then
    raise exception 'FAIL 68: removing a job did not keep the round''s task link';
  end if;
  r := public.agent_purge_member(buyer);
  if exists (select 1 from public.agent_mandates where owner_id = buyer) or exists (select 1 from public.agent_tasks where owner_id = buyer)
     or exists (select 1 from public.agent_events where owner_id = buyer) or exists (select 1 from public.agent_conversations where owner_id = buyer)
     or exists (select 1 from public.agent_approvals where owner_id = buyer) or exists (select 1 from public.agent_mandate_versions where owner_id = buyer) then
    raise exception 'FAIL 69: the purge left agent rows behind';
  end if;
  if not exists (select 1 from public.offer_rounds where offer_id = o1 and kind = 'accept') then
    raise exception 'FAIL 70: the purge removed the negotiation itself';
  end if;

  raise notice 'all agent worker checks passed';
end $$;

rollback;
