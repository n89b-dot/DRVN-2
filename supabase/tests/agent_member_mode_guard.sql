-- AG-7's member-level agent mode (20261107170000, written through
-- agent_mode_set from 20261107190000): the column's shape, who may read and
-- write it, and that a member can only set their own.
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

-- This guard's own helpers are called while acting as other roles. A new
-- function is closed by default (architecture plan 2, item A3), so they are opened here.
grant execute on all routines in schema pg_temp to public;

do $$
declare
  me uuid := gen_random_uuid();
  other uuid := gen_random_uuid();
  n integer;
  v text;
begin
  insert into auth.users(id, email) values (me, 'agent-mode-me@example.test'), (other, 'agent-mode-other@example.test');
  insert into public.profiles(id, username) values (me, 'agentmodeme'), (other, 'agentmodeother') on conflict (id) do nothing;

  -- 1. Every member starts at 'act': the setting changes nothing until it is set.
  select agent_mode into v from public.profiles where id = me;
  if v is distinct from 'act' then raise exception 'FAIL 1: a new profile''s agent_mode is % not act', v; end if;

  -- 2. Only the three modes are storable.
  if pg_temp.code(format('update public.profiles set agent_mode = %L where id = %L', 'loud', me)) <> '23514' then
    raise exception 'FAIL 2: an unknown agent_mode was accepted';
  end if;
  if pg_temp.code(format('update public.profiles set agent_mode = null where id = %L', me)) <> '23502' then
    raise exception 'FAIL 2b: a null agent_mode was accepted';
  end if;

  -- 3. No client reads the column: how a member configured their agent is theirs.
  if has_column_privilege('anon', 'public.profiles', 'agent_mode', 'select')
     or has_column_privilege('authenticated', 'public.profiles', 'agent_mode', 'select') then
    raise exception 'FAIL 3: agent_mode is readable by clients';
  end if;

  -- 4. A member sets their own, through agent_mode_set only (20261107190000):
  --    a direct column update would skip ending what was running.
  if has_column_privilege('authenticated', 'public.profiles', 'agent_mode', 'update') then
    raise exception 'FAIL 4: members can still update agent_mode directly';
  end if;
  perform pg_temp.act(me);
  v := pg_temp.code(format('update public.profiles set agent_mode = %L where id = %L', 'off', me));
  if v <> '42501' then raise exception 'FAIL 4a: a direct update of agent_mode was not refused (%)', v; end if;
  perform public.agent_mode_set('suggest');
  perform pg_temp.reset();
  if (select agent_mode from public.profiles where id = me) <> 'suggest' then
    raise exception 'FAIL 4b: agent_mode_set did not store the owner''s mode';
  end if;

  -- 5. ...and only theirs: agent_mode_set has no member argument.
  if (select agent_mode from public.profiles where id = other) <> 'act' then
    raise exception 'FAIL 5: setting one member''s mode changed another''s';
  end if;
  perform pg_temp.act(me);
  v := pg_temp.code('select public.agent_mode_set(''loud'')');
  perform pg_temp.reset();
  if v <> '22023' then raise exception 'FAIL 5b: an unknown mode reached agent_mode_set (%)', v; end if;

  -- 6. Signed out, nothing: anon has no update grant on the column at all.
  perform set_config('role', 'anon', true), set_config('request.jwt.claims', '', true);
  v := pg_temp.code(format('update public.profiles set agent_mode = %L where id = %L', 'off', me));
  perform pg_temp.reset();
  if v <> '42501' then raise exception 'FAIL 6: an anonymous update of agent_mode was not refused (%)', v; end if;

  raise notice 'all 6 agent member mode checks passed';
end $$;

rollback;
