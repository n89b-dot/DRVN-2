-- The agent's tool-call audit trail (20261107210200; OS-W07 R-audit).
-- Disposable local DB only.
--   1. Only the server can write it: members and visitors can't call
--      agent_record_tool_calls, and nobody can insert agent_events directly.
--   2. One 'tool_call' event per call, successes, refusals and failures, with
--      the tool name, object ids, outcome, code, timing, order, the turn's
--      outcome and the chat request id (initiated_by, idempotency_key).
--   3. Nothing else is kept: arguments, text, links and non-uuid ids the
--      caller sends are dropped; a bad tool name, outcome or shape is refused.
--   4. A second call for the same request records nothing more.
--   5. The owner reads their own rows; another member doesn't.
--   6. The rows are append-only, like every agent event.
begin;

create function pg_temp.code(p_sql text) returns text language plpgsql as $$
begin execute p_sql; return 'ok'; exception when others then return sqlstate; end $$;

do $$
declare
  member uuid := gen_random_uuid();
  other uuid := gen_random_uuid();
  request uuid := gen_random_uuid();
  -- Ids with no long digit runs, so the card-number scrub can't touch them.
  listing uuid := 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
  car uuid := 'abcdefab-cdef-4abc-8def-abcdefabcdef';
  n integer;
  e record;
  c text;
begin
  insert into auth.users(id, email) values (member, 'agent-audit-member@drvn.test'), (other, 'agent-audit-other@drvn.test');

  -- 1. Who may write.
  if has_function_privilege('authenticated', 'public.agent_record_tool_calls(uuid,uuid,text,jsonb)', 'execute')
     or has_function_privilege('anon', 'public.agent_record_tool_calls(uuid,uuid,text,jsonb)', 'execute') then
    raise exception 'FAIL 1: members or visitors can write the agent audit';
  end if;
  if not has_function_privilege('service_role', 'public.agent_record_tool_calls(uuid,uuid,text,jsonb)', 'execute') then
    raise exception 'FAIL 1b: the server cannot write the agent audit';
  end if;
  if has_table_privilege('authenticated', 'public.agent_events', 'insert') or has_table_privilege('service_role', 'public.agent_events', 'insert') then
    raise exception 'FAIL 1c: agent_events is writable directly';
  end if;

  -- 2 and 3. Three calls: a success, a refusal, a failure, with things that must not be kept.
  n := public.agent_record_tool_calls(member, request, 'ok', jsonb_build_array(
    jsonb_build_object('tool', 'read_listing', 'outcome', 'ok', 'ms', 12.4,
      'ids', jsonb_build_object('listingId', upper(listing::text), 'query', 'my VIN is WVWZZZAUZKW123456'),
      'input', jsonb_build_object('text', 'raw chat'), 'answer', 'listing body'),
    jsonb_build_object('tool', 'propose_build_change', 'outcome', 'refused', 'code', 'not_allowed', 'ms', 3,
      'ids', jsonb_build_object('carId', car::text, 'productUrl', 'https://parts-deals.example.net/x', 'modIds', jsonb_build_array(car::text, 'not-a-uuid'))),
    jsonb_build_object('tool', 'search_parts', 'outcome', 'failed', 'code', 'Bad Code!', 'ms', 99999999)
  ));
  if n <> 3 then raise exception 'FAIL 2: % events recorded, expected 3', n; end if;
  if (select count(*) from public.agent_events where owner_id = member and kind = 'tool_call') <> 3 then
    raise exception 'FAIL 2b: the tool calls are not stored as tool_call events';
  end if;
  select * into e from public.agent_events where owner_id = member and idempotency_key = 'tool:' || request::text || ':1';
  if e.initiated_by <> 'chat:' || request::text or e.inputs <> jsonb_build_object('tool', 'read_listing', 'ids', jsonb_build_object('listingId', listing::text))
     or e.result <> jsonb_build_object('outcome', 'ok', 'ms', 12, 'seq', 1, 'turn', 'ok') then
    raise exception 'FAIL 2c: the success was not kept as name, ids, outcome and timing only (% / %)', e.inputs, e.result;
  end if;
  select * into e from public.agent_events where owner_id = member and idempotency_key = 'tool:' || request::text || ':2';
  if e.inputs <> jsonb_build_object('tool', 'propose_build_change', 'ids', jsonb_build_object('carId', car::text, 'modIds', jsonb_build_array(car::text)))
     or e.result->>'outcome' <> 'refused' or e.result->>'code' <> 'not_allowed' then
    raise exception 'FAIL 2d: the refusal was not kept as recorded (% / %)', e.inputs, e.result;
  end if;
  select * into e from public.agent_events where owner_id = member and idempotency_key = 'tool:' || request::text || ':3';
  if e.result->>'outcome' <> 'failed' or e.result->>'code' <> 'failed' or (e.result->>'ms')::integer <> 600000 then
    raise exception 'FAIL 2e: the failure was not normalised (%)', e.result;
  end if;
  if exists (select 1 from public.agent_events where owner_id = member and kind = 'tool_call'
             and (inputs::text ~* 'WVWZZZ|raw chat|listing body|parts-deals|not-a-uuid|query|productUrl' or result::text ~* 'Bad Code')) then
    raise exception 'FAIL 3: an argument, text or link was kept in the audit';
  end if;

  -- 3b. Bad input is refused.
  c := pg_temp.code(format($q$select public.agent_record_tool_calls(%L, %L, 'ok', '[{"tool":"Read Listing","outcome":"ok"}]')$q$, member, gen_random_uuid()));
  if c <> '22023' then raise exception 'FAIL 3b: a bad tool name was accepted (%)', c; end if;
  c := pg_temp.code(format($q$select public.agent_record_tool_calls(%L, %L, 'ok', '[{"tool":"read_listing","outcome":"maybe"}]')$q$, member, gen_random_uuid()));
  if c <> '22023' then raise exception 'FAIL 3c: a bad outcome was accepted (%)', c; end if;
  c := pg_temp.code(format($q$select public.agent_record_tool_calls(%L, %L, 'ok', '{"tool":"read_listing"}')$q$, member, gen_random_uuid()));
  if c <> '22023' then raise exception 'FAIL 3d: a non-array was accepted (%)', c; end if;
  c := pg_temp.code(format($q$select public.agent_record_tool_calls(%L, %L, 'Not OK', '[]')$q$, member, gen_random_uuid()));
  if c <> '22023' then raise exception 'FAIL 3e: a bad turn outcome was accepted (%)', c; end if;
  c := pg_temp.code(format($q$select public.agent_record_tool_calls(%L, %L, 'ok', '[]')$q$, gen_random_uuid(), gen_random_uuid()));
  if c <> 'P0002' then raise exception 'FAIL 3f: an unknown member was accepted (%)', c; end if;

  -- 4. The same request again adds nothing.
  n := public.agent_record_tool_calls(member, request, 'ok', '[{"tool":"read_listing","outcome":"ok"}]'::jsonb);
  if n <> 0 or (select count(*) from public.agent_events where owner_id = member and kind = 'tool_call') <> 3 then
    raise exception 'FAIL 4: a repeated request recorded again';
  end if;

  -- 5. Owner-only reads.
  perform set_config('role', 'authenticated', true), set_config('request.jwt.claims', jsonb_build_object('sub', other, 'role', 'authenticated')::text, true);
  n := (select count(*) from public.agent_events where kind = 'tool_call' and owner_id = member);
  perform set_config('role', 'none', true), set_config('request.jwt.claims', '', true);
  if n <> 0 then raise exception 'FAIL 5: another member read the audit'; end if;
  perform set_config('role', 'authenticated', true), set_config('request.jwt.claims', jsonb_build_object('sub', member, 'role', 'authenticated')::text, true);
  n := (select count(*) from public.agent_events where kind = 'tool_call');
  perform set_config('role', 'none', true), set_config('request.jwt.claims', '', true);
  if n <> 3 then raise exception 'FAIL 5b: the owner cannot read their own audit (% rows)', n; end if;

  -- 6. Append-only.
  c := pg_temp.code(format('update public.agent_events set result = ''{}''::jsonb where owner_id = %L and kind = ''tool_call''', member));
  if c <> '42501' then raise exception 'FAIL 6: an audit row was changed (%)', c; end if;
  c := pg_temp.code(format('delete from public.agent_events where owner_id = %L and kind = ''tool_call''', member));
  if c <> '42501' then raise exception 'FAIL 6b: an audit row was deleted (%)', c; end if;

  raise notice 'all agent tool audit checks passed';
end $$;

rollback;
