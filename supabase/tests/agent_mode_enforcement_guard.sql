-- R-agentmode (20261107190000): Off and Suggest hold in the database, for a
-- direct authenticated call and for the worker, not only in the app.
--   1. Saving Off or Suggest revokes every live mandate (active or paused)
--      in the same call: open tasks cancelled, pending cards dismissed.
--   2. Below Act a direct agent_mandate_set is refused (AG009): a tab that
--      read Act before another tab saved Off can't start a mandate after.
--   3. Below Act a resume is refused (AG009), even for a mandate left paused.
--   4. The worker: a job claimed before the mode dropped can't write
--      (agent_authority, AG003), and a queued one is cancelled at claim.
--   5. The locks that serialise them: a mandate start and a worker write
--      hold the member's lock shared, a mode save holds it exclusively.
--   6. The chat: under Off agent_chat_turn_begin stores nothing and refuses
--      (AG009), so a send that read Act before another tab saved Off stops at
--      the database; Suggest still chats.
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

-- The advisory locks this backend holds on a member, by mode.
create function pg_temp.member_lock(p_member uuid, p_mode text) returns boolean language sql as $$
  select exists (
    select 1 from pg_locks l
    where l.locktype = 'advisory' and l.pid = pg_backend_pid() and l.mode = p_mode and l.objsubid = 1
      and ((l.classid::bigint << 32) | l.objid::bigint) = public.agent_member_lock_key(p_member)
  );
$$;

-- This guard's own helpers are called while acting as other roles. A new
-- function is closed by default (20261110170000), so they are opened here.
grant execute on all routines in schema pg_temp to public;

do $$
declare
  seller uuid := gen_random_uuid();
  buyer uuid := gen_random_uuid();
  part uuid := gen_random_uuid();
  part2 uuid := gen_random_uuid();
  part3 uuid := gen_random_uuid();
  o1 uuid := gen_random_uuid();
  bm uuid;
  sm uuid;
  t uuid;
  j record;
  r jsonb;
  c text;
begin
  update public.agent_controls set cleared_at = now() where scope = 'all' and cleared_at is null;
  update public.agent_beta_steps set open = true where step in ('seller', 'buyer');
  insert into auth.users(id, email) values (seller, 'mode-guard-seller@drvn.test'), (buyer, 'mode-guard-buyer@drvn.test');
  insert into public.listings(id, seller_id, title, category, price_cents, shipping_cents, status)
  values (part, seller, 'Mode guard turbo', 'performance', 100000, 0, 'active'),
         (part2, seller, 'Mode guard wheels', 'performance', 50000, 0, 'active'),
         (part3, buyer, 'Mode guard seats', 'performance', 40000, 0, 'active');
  insert into public.listing_private_terms(listing_id, seller_id, offer_floor_cents)
  values (part3, buyer, 20000)
  on conflict (listing_id) do update set offer_floor_cents = excluded.offer_floor_cents;

  -- Under Act: a buyer mandate with its turn claimed, and a paused seller mandate.
  perform pg_temp.act(buyer);
  r := public.offer_open(o1, part, 60000, null);
  perform pg_temp.act(seller);
  r := public.offer_move(o1, 'counter', 90000, 'mode-guard-c1', 1);
  perform pg_temp.act(buyer);
  bm := public.agent_mandate_set('buyer', part, null, null, 95000, 'item', 'balanced', null, false);
  -- 5a. Starting a mandate held the member's lock, shared (read back as the superuser).
  perform pg_temp.reset();
  if not pg_temp.member_lock(buyer, 'ShareLock') then raise exception 'FAIL 1: agent_mandate_set did not take the member''s lock'; end if;
  perform pg_temp.act(buyer);
  sm := public.agent_mandate_set('seller', part3, 25000, null, null, null, 'firm', null, true);
  perform public.agent_mandate_set_status(sm, 'paused');
  perform pg_temp.reset();
  select id into t from public.agent_tasks where mandate_id = bm and finished_at is null;
  insert into public.agent_approvals(owner_id, task_id, kind, offer_id, round_no, amount_cents, reason)
  values (buyer, t, 'accept_offer', o1, 2, 90000, 'mode guard: a card waiting on the buyer');
  perform pg_temp.worker();
  select * into j from pg_temp.claim() limit 1;
  perform pg_temp.reset();
  if j.job_id is null or j.offer_id <> o1 then raise exception 'FAIL 2: the buyer''s turn was not claimed (%)', j; end if;

  -- 1. Off, in one call: both mandates revoked, the task cancelled, the card dismissed.
  perform pg_temp.act(buyer);
  r := public.agent_mode_set('off');
  perform pg_temp.reset();
  -- 5b. The save held the member's lock exclusively.
  if not pg_temp.member_lock(buyer, 'ExclusiveLock') then raise exception 'FAIL 3: agent_mode_set did not take the member''s lock exclusively'; end if;
  if (r->>'revoked')::integer <> 2 or r->>'mode' <> 'off' then raise exception 'FAIL 4: Off did not revoke both live mandates (%)', r; end if;
  if exists (select 1 from public.agent_mandates where owner_id = buyer and status in ('active', 'paused')) then
    raise exception 'FAIL 5: a mandate is still live under Off';
  end if;
  if (select status from public.agent_tasks where id = t) <> 'cancelled' then raise exception 'FAIL 6: Off left the open task running'; end if;
  if exists (select 1 from public.agent_approvals where owner_id = buyer and status = 'pending') then
    raise exception 'FAIL 7: Off left a card waiting';
  end if;
  if (select status from public.offers where id = o1) <> 'countered' then raise exception 'FAIL 8: Off changed an offer'; end if;

  -- 4a. The job claimed under Act can't write now.
  perform pg_temp.worker();
  c := pg_temp.code(format('select public.agent_offer_move(%L, %L, %L, ''accept'', null, 2)', j.job_id, j.lease_id, o1));
  perform pg_temp.reset();
  if c <> 'AG003' then raise exception 'FAIL 9: the worker accepted after Off (%)', c; end if;

  -- 2. Direct calls below Act are refused, a new mandate and a changed one alike.
  perform pg_temp.act(buyer);
  c := pg_temp.code(format('select public.agent_mandate_set(''buyer'', %L, null, null, 45000, ''item'', ''balanced'', null, false)', part2));
  if c <> 'AG009' then raise exception 'FAIL 10: a buyer mandate started under Off (%)', c; end if;
  c := pg_temp.code(format('select public.agent_mandate_set(''seller'', %L, 25000, null, null, null, ''firm'', null, true)', part3));
  if c <> 'AG009' then raise exception 'FAIL 11: a seller mandate started under Off (%)', c; end if;
  perform public.agent_mode_set('suggest');
  c := pg_temp.code(format('select public.agent_mandate_set(''buyer'', %L, null, null, 45000, ''item'', ''balanced'', null, false)', part2));
  if c <> 'AG009' then raise exception 'FAIL 12: a mandate started under Suggest (%)', c; end if;
  perform pg_temp.reset();
  if exists (select 1 from public.agent_mandates where owner_id = buyer and status in ('active', 'paused')) then
    raise exception 'FAIL 13: a refused start left a mandate behind';
  end if;

  -- Back to Act: a mandate starts again, then is paused.
  perform pg_temp.act(buyer);
  perform public.agent_mode_set('act');
  bm := public.agent_mandate_set('buyer', part2, null, null, 45000, 'item', 'balanced', null, false);
  perform public.agent_mandate_set_status(bm, 'paused');
  perform pg_temp.reset();

  -- 3. A mode that dropped without the save (a bypass of agent_mode_set) still refuses a resume.
  update public.profiles set agent_mode = 'off' where id = buyer;
  perform pg_temp.act(buyer);
  c := pg_temp.code(format('select public.agent_mandate_set_status(%L, ''active'')', bm));
  perform pg_temp.reset();
  if c <> 'AG009' then raise exception 'FAIL 14: a paused mandate resumed under Off (%)', c; end if;
  if (select status from public.agent_mandates where id = bm) <> 'paused' then raise exception 'FAIL 15: the refused resume changed the mandate'; end if;

  -- 4b. The worker reads the mode itself: with the mandate live again, a job
  --     claimed under Act can't write once the mode drops below it...
  update public.profiles set agent_mode = 'act' where id = buyer;
  update public.agent_mandates set status = 'active' where id = bm;
  perform pg_temp.worker();
  select * into j from pg_temp.claim(10) x where x.kind = 'offer_open' limit 1;
  perform pg_temp.reset();
  if j.job_id is null then raise exception 'FAIL 16: the buyer''s opening offer was not queued'; end if;
  update public.profiles set agent_mode = 'off' where id = buyer;
  perform pg_temp.worker();
  c := pg_temp.code(format('select public.agent_offer_open(%L, %L, %L, 30000)', j.job_id, j.lease_id, part2));
  perform pg_temp.reset();
  if c <> 'AG003' then raise exception 'FAIL 17: the worker opened an offer for an owner set to Off (%)', c; end if;
  if exists (select 1 from public.offers where listing_id = part2) then raise exception 'FAIL 18: an offer was opened under Off'; end if;

  -- ...and a queued one is cancelled at claim.
  insert into public.agent_jobs(task_id, kind, expected_action, listing_id, dedup_key)
  select t2.id, 'offer_open', 'offer_open', part2, 'mode-guard-open:' || t2.id
  from public.agent_tasks t2 where t2.mandate_id = bm and t2.finished_at is null;
  perform pg_temp.worker();
  if exists (select 1 from pg_temp.claim(10) x where x.kind = 'offer_open') then
    raise exception 'FAIL 19: the worker claimed a job for an owner set to Off';
  end if;
  perform pg_temp.reset();
  if (select j2.status from public.agent_jobs j2 where j2.dedup_key like 'mode-guard-open:%') <> 'cancelled' then
    raise exception 'FAIL 20: the job for an owner set to Off was not cancelled';
  end if;

  -- 6. The chat. The member is Off now (check 4b): a send that read Act
  --    earlier reaches the database after the save, and stops there.
  perform pg_temp.reset();
  c := pg_temp.code(format('select public.agent_chat_turn_begin(%L, %L, ''Will this fit?'')', buyer, gen_random_uuid()));
  if c <> 'AG009' then raise exception 'FAIL 21: a chat turn began under Off (%)', c; end if;
  if exists (select 1 from public.agent_messages where owner_id = buyer) or exists (select 1 from public.agent_chat_requests where owner_id = buyer) then
    raise exception 'FAIL 22: a refused chat turn stored something';
  end if;
  perform pg_temp.act(buyer);
  perform public.agent_mode_set('suggest');
  perform pg_temp.reset();
  r := public.agent_chat_turn_begin(buyer, gen_random_uuid(), 'Will this fit?');
  if (r->>'replayed')::boolean or r->'member' is null or r->'member' = 'null'::jsonb then
    raise exception 'FAIL 23: Suggest refused the chat (%)', r;
  end if;

  raise notice 'all agent mode enforcement checks passed';
end $$;

rollback;
