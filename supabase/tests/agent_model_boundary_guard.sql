-- The agent's model boundary in the database (20261107100000; OS-PR64 R66
-- R67, OS-W04 N121 N127). Disposable local DB only.
--   1. Only the server can reserve or settle spend, or begin and finish a
--      chat turn; nobody reads or writes the holds or request tables
--      directly, the service role included.
--   2. A reservation counts today's spend and every open hold, so neither
--      one turn nor several at once can pass the member cap; settling swaps
--      the hold for real usage; the global cap holds across members.
--   3. A suspended member is refused by the reservation, by
--      agent_chat_turn_begin and by agent_chat_append for their own message.
--   4. A kill switch that reaches the model (all, member, account) refuses
--      the reservation; a listing or mandate switch doesn't, and a cleared
--      one doesn't.
--   5. A chat turn is stored once per request id: a second begin replays it,
--      a second finish returns the first reply.
--   6. Settling a hold that is gone still records usage; zero tokens record
--      nothing; bad input is refused.
begin;

create function pg_temp.code(p_sql text) returns text language plpgsql as $$
begin execute p_sql; return 'ok'; exception when others then return sqlstate; end $$;

-- This guard's own helpers are called while acting as other roles. A new
-- function is closed by default (architecture plan 2, item A3), so they are opened here.
grant execute on all routines in schema pg_temp to public;

do $$
declare
  member uuid := gen_random_uuid();
  other uuid := gen_random_uuid();
  request uuid := gen_random_uuid();
  r jsonb;
  h1 uuid;
  h2 uuid;
  reply_id text;
  c text;
  f text;
begin
  insert into auth.users(id, email) values (member, 'agent-boundary-member@drvn.test'), (other, 'agent-boundary-other@drvn.test');
  delete from public.agent_usage;
  delete from public.agent_spend_holds;
  delete from public.agent_controls;
  update public.agent_spend_limits set per_member_daily_usd = 1.00, global_daily_usd = 50.00 where singleton;

  -- 1. Who may call what.
  foreach f in array array['public.agent_spend_reserve(uuid,text,numeric)', 'public.agent_spend_settle(uuid,uuid,text,text,integer,integer,numeric,uuid)',
                           'public.agent_chat_turn_begin(uuid,uuid,text,text[])', 'public.agent_chat_turn_finish(uuid,uuid,text,jsonb)'] loop
    if has_function_privilege('authenticated', f, 'execute') or has_function_privilege('anon', f, 'execute') then
      raise exception 'FAIL 1: members or visitors can call %', f;
    end if;
    if not has_function_privilege('service_role', f, 'execute') then raise exception 'FAIL 1b: the server cannot call %', f; end if;
  end loop;
  if has_function_privilege('service_role', 'public.agent_chat_message_json(uuid)', 'execute') then raise exception 'FAIL 1c: agent_chat_message_json is callable'; end if;
  foreach f in array array['public.agent_spend_holds', 'public.agent_chat_requests'] loop
    if has_table_privilege('service_role', f, 'select') or has_table_privilege('service_role', f, 'insert')
       or has_table_privilege('authenticated', f, 'select') or has_table_privilege('anon', f, 'select') then
      raise exception 'FAIL 1d: % is readable or writable directly', f;
    end if;
  end loop;

  -- 2. Reservations against the member cap ($1.00).
  r := public.agent_spend_reserve(member, 'agent_chat', 0.5);
  if not (r->>'allowed')::boolean then raise exception 'FAIL 2: the first turn was refused (%)', r; end if;
  h1 := (r->>'hold')::uuid;
  r := public.agent_spend_reserve(member, 'agent_chat', 0.5);
  if not (r->>'allowed')::boolean then raise exception 'FAIL 2b: a second turn within the cap was refused (%)', r; end if;
  h2 := (r->>'hold')::uuid;
  -- Two turns in flight hold the whole dollar: a third, at the same time, can't start.
  r := public.agent_spend_reserve(member, 'agent_chat', 0.5);
  if (r->>'allowed')::boolean or r->>'reason' <> 'spend_cap' then raise exception 'FAIL 2c: open holds did not count (%)', r; end if;
  -- One turn really cost $0.10: its hold goes and its usage stays.
  perform public.agent_spend_settle(h1, member, 'agent_chat', 'claude-opus-5-5', 20000, 1000, 0.10);
  if exists (select 1 from public.agent_spend_holds where id = h1) then raise exception 'FAIL 2d: a settled hold stayed'; end if;
  if (select count(*) from public.agent_usage where owner_id = member) <> 1 then raise exception 'FAIL 2e: settled usage was not stored'; end if;
  -- $0.10 spent + $0.50 held: $0.50 more would pass the cap, $0.40 is exactly at it.
  r := public.agent_spend_reserve(member, 'agent_chat', 0.5);
  if (r->>'allowed')::boolean then raise exception 'FAIL 2f: a turn past the member cap was reserved (%)', r; end if;
  r := public.agent_spend_reserve(member, 'agent_chat', 0.4);
  if not (r->>'allowed')::boolean then raise exception 'FAIL 2g: a turn exactly at the cap was refused (%)', r; end if;
  -- Another member is unaffected by this one's cap...
  r := public.agent_spend_reserve(other, 'marketplace_filters', 0.05);
  if not (r->>'allowed')::boolean then raise exception 'FAIL 2h: one member''s cap stopped another (%)', r; end if;
  -- ...but not by the global one.
  update public.agent_spend_limits set global_daily_usd = 1.10 where singleton;
  r := public.agent_spend_reserve(other, 'marketplace_filters', 0.5);
  if (r->>'allowed')::boolean or r->>'reason' <> 'spend_cap' then raise exception 'FAIL 2i: the global cap did not hold (%)', r; end if;
  update public.agent_spend_limits set global_daily_usd = 50.00 where singleton;

  -- 3. Suspension.
  update public.profiles set suspended_at = now() where id = other;
  r := public.agent_spend_reserve(other, 'agent_chat', 0.05);
  if (r->>'allowed')::boolean or r->>'reason' <> 'suspended' then raise exception 'FAIL 3: a suspended member reserved spend (%)', r; end if;
  c := pg_temp.code(format('select public.agent_chat_turn_begin(%L, %L, %L)', other, gen_random_uuid(), 'hello'));
  if c <> '42501' then raise exception 'FAIL 3b: a suspended member began a chat turn (%)', c; end if;
  c := pg_temp.code(format('select public.agent_chat_append(%L, %L, %L)', other, 'member', 'hello'));
  if c <> '42501' then raise exception 'FAIL 3c: a suspended member''s message was stored (%)', c; end if;
  if exists (select 1 from public.agent_messages where owner_id = other) then raise exception 'FAIL 3d: a suspended member''s message is in the chat'; end if;
  update public.profiles set suspended_at = null where id = other;

  -- 4. Kill switches.
  delete from public.agent_spend_holds;
  delete from public.agent_usage;
  insert into public.agent_controls(scope, subject_id, reason) values ('listing', gen_random_uuid(), 'guard'), ('mandate', gen_random_uuid(), 'guard');
  r := public.agent_spend_reserve(member, 'agent_chat', 0.05);
  if not (r->>'allowed')::boolean then raise exception 'FAIL 4: a listing or mandate switch stopped chat (%)', r; end if;
  foreach f in array array['member', 'account', 'all'] loop
    delete from public.agent_controls;
    insert into public.agent_controls(scope, subject_id, reason) values (f, case when f = 'all' then null else member end, 'guard');
    r := public.agent_spend_reserve(member, 'agent_chat', 0.05);
    if (r->>'allowed')::boolean or r->>'reason' <> 'paused' then raise exception 'FAIL 4b: a % switch did not refuse the reservation (%)', f, r; end if;
  end loop;
  r := public.agent_spend_reserve(other, 'agent_chat', 0.05);
  if (r->>'allowed')::boolean then raise exception 'FAIL 4c: the all switch let another member reserve'; end if;
  update public.agent_controls set cleared_at = now();
  r := public.agent_spend_reserve(member, 'agent_chat', 0.05);
  if not (r->>'allowed')::boolean then raise exception 'FAIL 4d: a cleared switch still refused (%)', r; end if;

  -- 5. One turn per request id.
  r := public.agent_chat_turn_begin(member, request, 'Will this fit?');
  if (r->>'replayed')::boolean or r->'member'->>'body' <> 'Will this fit?' or r->'reply' <> 'null'::jsonb then raise exception 'FAIL 5: first begin (%)', r; end if;
  r := public.agent_chat_turn_begin(member, request, 'Will this fit?');
  if not (r->>'replayed')::boolean or r->'reply' <> 'null'::jsonb then raise exception 'FAIL 5b: a retried begin did not replay (%)', r; end if;
  if (select count(*) from public.agent_messages where owner_id = member and role = 'member') <> 1 then raise exception 'FAIL 5c: a retried send stored the message twice'; end if;
  reply_id := public.agent_chat_turn_finish(member, request, 'It fits.')->>'id';
  if reply_id is null then raise exception 'FAIL 5d: the reply was not stored'; end if;
  if public.agent_chat_turn_finish(member, request, 'A second answer')->>'id' <> reply_id then raise exception 'FAIL 5e: a second finish stored another reply'; end if;
  if (select count(*) from public.agent_messages where owner_id = member and role = 'agent') <> 1 then raise exception 'FAIL 5f: two replies stored'; end if;
  r := public.agent_chat_turn_begin(member, request, 'Will this fit?');
  if not (r->>'replayed')::boolean or r->'reply'->>'id' <> reply_id then raise exception 'FAIL 5g: the replay lost the reply (%)', r; end if;
  -- The same id from another member is a different request.
  r := public.agent_chat_turn_begin(other, request, 'Mine');
  if (r->>'replayed')::boolean then raise exception 'FAIL 5h: one member replayed another''s request'; end if;
  c := pg_temp.code(format('select public.agent_chat_turn_finish(%L, %L, %L)', member, gen_random_uuid(), 'x'));
  if c <> 'P0002' then raise exception 'FAIL 5i: a reply to no request was stored (%)', c; end if;

  -- 6. Settlement edges and bad input.
  delete from public.agent_usage;
  perform public.agent_spend_settle(gen_random_uuid(), member, 'agent_chat', 'claude-opus-5-5', 10, 5, 0.0001);
  if (select count(*) from public.agent_usage where owner_id = member) <> 1 then raise exception 'FAIL 6: usage of a swept hold was lost'; end if;
  perform public.agent_spend_settle(gen_random_uuid(), member, 'agent_chat', 'claude-opus-5-5', 0, 0);
  if (select count(*) from public.agent_usage where owner_id = member) <> 1 then raise exception 'FAIL 6b: a call that used nothing was recorded'; end if;
  c := pg_temp.code(format('select public.agent_spend_reserve(%L, %L, 0)', member, 'agent_chat'));
  if c <> '22023' then raise exception 'FAIL 6c: a zero reservation was accepted (%)', c; end if;
  c := pg_temp.code(format('select public.agent_spend_reserve(%L, %L, 0.1)', member, 'something_else'));
  if c <> '22023' then raise exception 'FAIL 6d: an unknown feature was accepted (%)', c; end if;
  c := pg_temp.code(format('select public.agent_spend_settle(%L, %L, %L, %L, -1, 0)', gen_random_uuid(), member, 'agent_chat', 'm'));
  if c <> '22023' then raise exception 'FAIL 6e: negative tokens were accepted (%)', c; end if;

  raise notice 'all 35 model-boundary checks passed';
end $$;
rollback;
