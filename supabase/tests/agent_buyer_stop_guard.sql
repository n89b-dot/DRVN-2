-- "Stop negotiating for me" (readiness 64): the buyer revokes their agent's
-- authority with agent_mandate_set_status(…, 'revoked'), the call
-- stopBuyerAgent makes. Run against the real worker role with SET ROLE.
--   1. Stopping wins a race with the worker: a job claimed before the stop
--      can't move afterwards, and the open task and any card end with it.
--   2. Stopping takes nothing back: the seller's counter stays live for the
--      buyer to answer by hand, and a revoked mandate can't be resumed.
--   3. An agreement the agent already reached stands: its offer stays
--      accepted and its order pending; the ended mandate refuses a stop.
--   4. The rounds keep the agent's authority after its task is gone, so the
--      checkout can still say an agent set the price (readiness 65).
-- Transactional; disposable local database only.
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
  part uuid := gen_random_uuid();
  part2 uuid := gen_random_uuid();
  o1 uuid := gen_random_uuid();
  o2 uuid := gen_random_uuid();
  m1 uuid;
  m2 uuid;
  t1 uuid;
  order2 uuid;
  j record;
  r jsonb;
  c text;
  v text;
begin
  update public.beta_access_config set enforced = false where singleton = true;
  update public.agent_controls set cleared_at = now() where scope = 'all' and cleared_at is null;
  update public.agent_beta_steps set open = true where step in ('seller', 'buyer');
  insert into auth.users(id, email) values (seller, 'stop-guard-seller@drvn.test'), (buyer, 'stop-guard-buyer@drvn.test');
  insert into public.listings(id, seller_id, title, category, price_cents, shipping_cents, status)
  values (part, seller, 'Stop guard turbo', 'performance', 100000, 0, 'active'),
         (part2, seller, 'Stop guard wheels', 'performance', 50000, 0, 'active');

  -- 1. The buyer offers by hand, the seller counters, then the buyer hands it to their agent.
  perform pg_temp.act(buyer);
  r := public.offer_open(o1, part, 60000, null);
  perform pg_temp.act(seller);
  r := public.offer_move(o1, 'counter', 90000, 'stop-guard-c1', 1);
  perform pg_temp.act(buyer);
  m1 := public.agent_mandate_set('buyer', part, null, null, 95000, 'item', 'balanced', null, false);
  perform pg_temp.reset();
  select id into t1 from public.agent_tasks where mandate_id = m1 and finished_at is null;
  if t1 is null then raise exception 'FAIL 1: the buyer mandate opened no task'; end if;

  -- The worker claims the turn, then the buyer stops before it writes.
  perform pg_temp.worker();
  select * into j from pg_temp.claim() limit 1;
  perform pg_temp.reset();
  if j.job_id is null or j.offer_id <> o1 or j.round_no <> 2 then raise exception 'FAIL 2: the buyer''s turn was not queued (%)', j; end if;
  insert into public.agent_approvals(owner_id, task_id, kind, offer_id, round_no, amount_cents, reason)
  values (buyer, t1, 'accept_offer', o1, 2, 90000, 'stop guard: a card waiting on the buyer');
  perform pg_temp.act(buyer);
  v := public.agent_mandate_set_status(m1, 'revoked');
  perform pg_temp.reset();
  if v <> 'revoked' then raise exception 'FAIL 3: the stop did not answer revoked (%)', v; end if;

  perform pg_temp.worker();
  c := pg_temp.code(format('select public.agent_offer_move(%L, %L, %L, ''accept'', null, 2)', j.job_id, j.lease_id, o1));
  perform pg_temp.reset();
  if c <> 'AG003' then raise exception 'FAIL 4: the agent accepted after the buyer stopped it (%)', c; end if;
  if (select status from public.agent_mandates where id = m1) <> 'revoked' or (select ended_at from public.agent_mandates where id = m1) is null then
    raise exception 'FAIL 5: the mandate is not revoked';
  end if;
  if (select status from public.agent_tasks where id = t1) <> 'cancelled' then raise exception 'FAIL 6: the open task outlived the stop'; end if;
  if exists (select 1 from public.agent_approvals where task_id = t1 and status = 'pending') then
    raise exception 'FAIL 7: a card still waits on the buyer after the stop';
  end if;

  -- 2. Nothing is taken back: the seller's counter is still the buyer's to answer.
  if (select status || ':' || counter_amount_cents from public.offers where id = o1) <> 'countered:90000' then
    raise exception 'FAIL 8: stopping changed the offer (%)', (select status from public.offers where id = o1);
  end if;
  if exists (select 1 from public.orders where origin_offer_id = o1) then raise exception 'FAIL 9: stopping made an order'; end if;
  perform pg_temp.act(buyer);
  c := pg_temp.code(format('select public.agent_mandate_set_status(%L, ''active'')', m1));
  if c <> '22023' then raise exception 'FAIL 10: a revoked mandate was resumed (%)', c; end if;
  r := public.offer_move(o1, 'accept', null, 'stop-guard-a1', 2);
  perform pg_temp.reset();
  if r->>'order_id' is null or (select status from public.offers where id = o1) <> 'accepted' then
    raise exception 'FAIL 11: the buyer could not accept the counter by hand after stopping (%)', r;
  end if;
  if (select actor_task_id is not null or mandate_version is not null from public.offer_rounds where offer_id = o1 and kind = 'accept') then
    raise exception 'FAIL 12: the buyer''s own accept was recorded as the agent''s';
  end if;

  -- 3. An agreement the agent reached before the stop stands.
  perform pg_temp.act(buyer);
  r := public.offer_open(o2, part2, 40000, null);
  perform pg_temp.act(seller);
  r := public.offer_move(o2, 'counter', 45000, 'stop-guard-c2', 1);
  perform pg_temp.act(buyer);
  m2 := public.agent_mandate_set('buyer', part2, null, null, 46000, 'item', 'balanced', null, false);
  perform pg_temp.reset();
  perform pg_temp.worker();
  select * into j from pg_temp.claim(10) x where x.offer_id = o2 limit 1;
  if j.job_id is null then raise exception 'FAIL 13: the second turn was not queued'; end if;
  r := public.agent_offer_move(j.job_id, j.lease_id, o2, 'accept', null, 2);
  perform pg_temp.reset();
  select id into order2 from public.orders where origin_offer_id = o2;
  if order2 is null or (select status from public.offers where id = o2) <> 'accepted' then
    raise exception 'FAIL 14: the buyer''s agent did not accept within its max (%)', r;
  end if;
  perform pg_temp.act(buyer);
  c := pg_temp.code(format('select public.agent_mandate_set_status(%L, ''revoked'')', m2));
  perform pg_temp.reset();
  if c <> '22023' then raise exception 'FAIL 15: an ended mandate took a stop (%)', c; end if;
  if (select status from public.offers where id = o2) <> 'accepted' or (select status from public.orders where id = order2) <> 'pending' then
    raise exception 'FAIL 16: stopping undid an agreement the agent had reached';
  end if;

  -- 4. The agent's accept keeps its authority on the round, even once its task is purged.
  if (select actor_task_id is null or mandate_version is null from public.offer_rounds where offer_id = o2 and kind = 'accept') then
    raise exception 'FAIL 17: the agent''s accept does not record its authority';
  end if;
  r := public.agent_purge_member(buyer);
  if (select actor_task_id from public.offer_rounds where offer_id = o2 and kind = 'accept') is not null then
    raise exception 'FAIL 18: the purge left the task link (the premise of check 19)';
  end if;
  if (select mandate_version from public.offer_rounds where offer_id = o2 and kind = 'accept') is null then
    raise exception 'FAIL 19: the round lost the agent''s mandate version with its task';
  end if;

  raise notice 'all buyer stop checks passed';
end $$;

rollback;
