-- AG-7's member-level agent mode (20261107170000): the column's shape, who
-- may read and write it, and that a member can only set their own.
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

  -- 4. A member sets their own.
  if not has_column_privilege('authenticated', 'public.profiles', 'agent_mode', 'update') then
    raise exception 'FAIL 4: a member cannot set their own agent_mode';
  end if;
  perform pg_temp.act(me);
  update public.profiles set agent_mode = 'suggest' where id = me;
  get diagnostics n = row_count;
  perform pg_temp.reset();
  if n <> 1 or (select agent_mode from public.profiles where id = me) <> 'suggest' then
    raise exception 'FAIL 4b: the owner''s update did not land';
  end if;

  -- 5. ...and nobody else's: the row isn't theirs, so the update touches nothing.
  perform pg_temp.act(me);
  update public.profiles set agent_mode = 'off' where id = other;
  get diagnostics n = row_count;
  perform pg_temp.reset();
  if n <> 0 or (select agent_mode from public.profiles where id = other) <> 'act' then
    raise exception 'FAIL 5: a member changed another member''s agent_mode';
  end if;

  -- 6. Signed out, nothing: anon has no update grant on the column at all.
  perform set_config('role', 'anon', true), set_config('request.jwt.claims', '', true);
  v := pg_temp.code(format('update public.profiles set agent_mode = %L where id = %L', 'off', me));
  perform pg_temp.reset();
  if v <> '42501' then raise exception 'FAIL 6: an anonymous update of agent_mode was not refused (%)', v; end if;

  raise notice 'all 6 agent member mode checks passed';
end $$;

rollback;
