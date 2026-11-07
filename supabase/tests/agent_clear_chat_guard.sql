-- "Clear chat" (N125): agent_clear_conversation (20261021100100), the call
-- the Clear chat button makes as the member.
--   1. It deletes the caller's own thread, messages included, and says how
--      many conversations went.
--   2. Another member's thread is untouched.
--   3. A visitor can't call it; a second clear finds nothing.
--   4. A message after the clear starts a fresh thread.
-- Transactional; disposable local database only.
begin;

create function pg_temp.act(p_member uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true), set_config('request.jwt.claims', jsonb_build_object('sub', p_member, 'role', 'authenticated')::text, true);
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

do $$
declare
  me uuid := gen_random_uuid();
  other uuid := gen_random_uuid();
  n integer;
  c text;
begin
  insert into auth.users(id, email) values (me, 'clear-chat-me@drvn.test'), (other, 'clear-chat-other@drvn.test');
  perform public.agent_chat_append(me, 'member', 'Will this fit my car?');
  perform public.agent_chat_append(me, 'agent', 'Yes, it fits.');
  perform public.agent_chat_append(other, 'member', 'What do parts like this sell for?');

  -- 1. The caller's own thread goes, with its messages.
  perform pg_temp.act(me);
  n := public.agent_clear_conversation();
  perform pg_temp.reset();
  if n <> 1 then raise exception 'FAIL 1: clearing reported % conversations, not 1', n; end if;
  if exists (select 1 from public.agent_conversations where owner_id = me) or exists (select 1 from public.agent_messages where owner_id = me) then
    raise exception 'FAIL 2: the cleared thread left rows behind';
  end if;

  -- 2. Only theirs.
  if (select count(*) from public.agent_messages where owner_id = other) <> 1 then
    raise exception 'FAIL 3: clearing one member''s chat touched another''s';
  end if;

  -- 3. Visitors can't; a second clear finds nothing.
  perform set_config('role', 'anon', true);
  c := pg_temp.code('select public.agent_clear_conversation()');
  perform pg_temp.reset();
  if c <> '42501' then raise exception 'FAIL 4: a visitor could call agent_clear_conversation (%)', c; end if;
  perform pg_temp.act(me);
  n := public.agent_clear_conversation();
  perform pg_temp.reset();
  if n <> 0 then raise exception 'FAIL 5: a second clear found % conversations', n; end if;

  -- 4. A new message after the clear starts a fresh thread of one.
  perform public.agent_chat_append(me, 'member', 'Starting again');
  if (select count(*) from public.agent_messages where owner_id = me) <> 1 then
    raise exception 'FAIL 6: the thread after a clear is not a fresh one';
  end if;

  raise notice 'all clear chat checks passed';
end $$;

rollback;
