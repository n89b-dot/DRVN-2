-- Reservation and settlement can't interleave (20261107190500; OS-PR64 R67
-- follow-up). Disposable local DB only.
--   1. agent_spend_settle takes the agent_spend_limits row lock before it
--      touches a hold or usage, and agent_spend_reserve takes it before it
--      reads them, reading spend and holds in one statement.
--   2. With dblink (shipped in the supabase/postgres image): while this
--      session is inside a settlement, another session's reservation waits
--      for it, and while this session is inside a reservation, another
--      session's settlement waits. Each probe runs in a remote transaction
--      that is rolled back, so nothing it does is kept.
--      The remote session can't see this session's uncommitted rows, so for
--      a reservation probe it clears the seeded "Every agent" switch
--      (20261021100000) inside its own transaction first; without that its reservation returns 'paused'
--      before it ever reaches the lock. A control probe with no lock held
--      proves each remote call really reaches the lock path, so a probe
--      can't pass, or fail, by returning early.
--   3. A settlement with a cost but no tokens (an unknown outcome charged at
--      its worst case) is stored and counted by the next reservation.
--   4. agent_chat_turn_status is the server's only, and answers for the
--      owner's own request.
-- Runs on its own: no other guard's writes are in these transactions, so the
-- only lock on agent_spend_limits is the one the function under test took.

begin;

-- One remote call in its own transaction, rolled back: what it returned, or its error.
create function pg_temp.probe(p_ext text, p_conn text, p_sql text, p_clear_switches boolean) returns text language plpgsql as $$
declare
  v_out text;
begin
  execute format('select %I.dblink_exec(%L, %L)', p_ext, p_conn, 'begin; set local lock_timeout = ''500ms''');
  -- Only the remote transaction sees this, and it is rolled back.
  if p_clear_switches then
    execute format('select %I.dblink_exec(%L, %L)', p_ext, p_conn, 'update public.agent_controls set cleared_at = now() where cleared_at is null');
  end if;
  begin
    execute format('select r from %I.dblink(%L, %L) as t(r text)', p_ext, p_conn, p_sql) into v_out;
    v_out := 'ran: ' || coalesce(v_out, 'null');
  exception when others then
    v_out := sqlerrm;
  end;
  execute format('select %I.dblink_exec(%L, %L)', p_ext, p_conn, 'rollback');
  return v_out;
end $$;

-- A second session on this database, or null when dblink can't give one.
create function pg_temp.connect(p_name text) returns text language plpgsql as $$
declare
  v_ext text;
begin
  if not exists (select 1 from pg_extension where extname = 'dblink') then
    if not exists (select 1 from pg_available_extensions where name = 'dblink') then
      raise notice 'dblink is not available: the two-session checks are skipped, the lock order from the definitions still holds';
      return null;
    end if;
    create extension dblink;
  end if;
  select n.nspname into v_ext from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'dblink';
  begin
    execute format('select %I.dblink_connect(%L, %L)', v_ext, p_name,
      format('host=127.0.0.1 port=%s dbname=%s user=%s password=postgres', current_setting('port'), current_database(), current_user));
  exception when others then
    raise notice 'dblink could not connect back (%): the two-session checks are skipped, the lock order from the definitions still holds', sqlerrm;
    return null;
  end;
  return v_ext;
end $$;

do $$
declare
  member uuid := gen_random_uuid();
  settle_def text := pg_get_functiondef('public.agent_spend_settle(uuid,uuid,text,text,integer,integer,numeric,uuid)'::regprocedure);
  reserve_def text := pg_get_functiondef('public.agent_spend_reserve(uuid,text,numeric)'::regprocedure);
  ext text;
  probe text;
  checks integer := 0;
begin
  -- 1. Lock order, read from the definitions.
  if position('agent_spend_limits where singleton for update' in settle_def) = 0
     or position('agent_spend_limits where singleton for update' in settle_def) > position('delete from public.agent_spend_holds' in settle_def) then
    raise exception 'FAIL 1: settlement does not lock agent_spend_limits before it changes a hold';
  end if;
  if position('for update' in reserve_def) = 0 or position('for update' in reserve_def) > position('from public.agent_usage' in reserve_def) then
    raise exception 'FAIL 1b: the reservation reads spend before it holds the lock';
  end if;
  if reserve_def ~* 'into v_member, v_global;.*into v_member, v_global;' then
    raise exception 'FAIL 1c: the reservation still reads spend and holds in two statements';
  end if;
  checks := checks + 3;

  insert into auth.users(id, email) values (member, 'agent-lock-order@drvn.test');

  -- 2a. A reservation waits for a settlement in progress.
  ext := pg_temp.connect('lockprobe');
  if ext is not null then
    -- Control: with no lock held, the remote reservation gets past the lock
    -- to its insert (a stranger's id fails the hold's foreign key there).
    probe := pg_temp.probe(ext, 'lockprobe', format('select public.agent_spend_reserve(%L, %L, 0.01)::text', gen_random_uuid(), 'agent_chat'), true);
    if probe !~* 'agent_spend_holds_owner_id_fkey' then
      raise exception 'FAIL 2 control: the remote reservation did not reach the lock path (%)', probe;
    end if;
    -- This session is mid-settlement, holding its lock until rollback: the
    -- same remote reservation now waits on that lock and times out.
    perform public.agent_spend_settle(gen_random_uuid(), member, 'agent_chat', 'claude-opus-5-5', 10, 5, 0.01);
    probe := pg_temp.probe(ext, 'lockprobe', format('select public.agent_spend_reserve(%L, %L, 0.01)::text', gen_random_uuid(), 'agent_chat'), true);
    execute format('select %I.dblink_disconnect(%L)', ext, 'lockprobe');
    if probe !~* 'lock timeout' then
      raise exception 'FAIL 2: a reservation ran while a settlement was in progress (%)', probe;
    end if;
    checks := checks + 2;
  end if;
  raise notice 'all % lock-order checks passed (definitions, and a reservation waiting for a settlement)', checks;
end $$;

rollback;
begin;

create function pg_temp.probe(p_ext text, p_conn text, p_sql text, p_clear_switches boolean) returns text language plpgsql as $$
declare
  v_out text;
begin
  execute format('select %I.dblink_exec(%L, %L)', p_ext, p_conn, 'begin; set local lock_timeout = ''500ms''');
  -- Only the remote transaction sees this, and it is rolled back.
  if p_clear_switches then
    execute format('select %I.dblink_exec(%L, %L)', p_ext, p_conn, 'update public.agent_controls set cleared_at = now() where cleared_at is null');
  end if;
  begin
    execute format('select r from %I.dblink(%L, %L) as t(r text)', p_ext, p_conn, p_sql) into v_out;
    v_out := 'ran: ' || coalesce(v_out, 'null');
  exception when others then
    v_out := sqlerrm;
  end;
  execute format('select %I.dblink_exec(%L, %L)', p_ext, p_conn, 'rollback');
  return v_out;
end $$;

create function pg_temp.connect(p_name text) returns text language plpgsql as $$
declare
  v_ext text;
begin
  if not exists (select 1 from pg_extension where extname = 'dblink') then
    if not exists (select 1 from pg_available_extensions where name = 'dblink') then return null; end if;
    create extension dblink;
  end if;
  select n.nspname into v_ext from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'dblink';
  begin
    execute format('select %I.dblink_connect(%L, %L)', v_ext, p_name,
      format('host=127.0.0.1 port=%s dbname=%s user=%s password=postgres', current_setting('port'), current_database(), current_user));
  exception when others then
    return null;
  end;
  return v_ext;
end $$;

do $$
declare
  member uuid := gen_random_uuid();
  ext text;
  probe text;
  r jsonb;
  hold uuid;
  request uuid := gen_random_uuid();
  checks integer := 0;
begin
  insert into auth.users(id, email) values (member, 'agent-lock-order-2@drvn.test');
  delete from public.agent_usage;
  delete from public.agent_spend_holds;
  delete from public.agent_controls;

  -- 2b. A settlement waits for a reservation in progress.
  ext := pg_temp.connect('lockprobe2');
  if ext is not null then
    -- Control: with no lock held, the remote settlement runs to its end.
    probe := pg_temp.probe(ext, 'lockprobe2', format('select public.agent_spend_settle(%L, %L, %L, %L, 0, 0)::text', gen_random_uuid(), gen_random_uuid(), 'agent_chat', 'm'), false);
    if probe !~ '^ran: ' then raise exception 'FAIL 2b control: the remote settlement did not run (%)', probe; end if;
  end if;
  r := public.agent_spend_reserve(member, 'agent_chat', 0.5);
  if not (r->>'allowed')::boolean then raise exception 'FAIL 3: setup reservation refused (%)', r; end if;
  hold := (r->>'hold')::uuid;
  if ext is not null then
    -- This session is mid-reservation, holding its lock until rollback.
    probe := pg_temp.probe(ext, 'lockprobe2', format('select public.agent_spend_settle(%L, %L, %L, %L, 0, 0)::text', gen_random_uuid(), gen_random_uuid(), 'agent_chat', 'm'), false);
    execute format('select %I.dblink_disconnect(%L)', ext, 'lockprobe2');
    if probe !~* 'lock timeout' then
      raise exception 'FAIL 2b: a settlement ran while a reservation was in progress (%)', probe;
    end if;
    checks := checks + 2;
  end if;

  -- 3. An unknown outcome is charged: cost, no tokens, and it counts.
  update public.agent_spend_limits set per_member_daily_usd = 1.00, global_daily_usd = 50.00 where singleton;
  perform public.agent_spend_settle(hold, member, 'agent_chat', 'claude-opus-5-5', 0, 0, 0.45);
  if not exists (select 1 from public.agent_usage where owner_id = member and cost_usd = 0.45 and input_tokens = 0) then
    raise exception 'FAIL 3b: a charged unknown outcome was not stored';
  end if;
  if exists (select 1 from public.agent_spend_holds where id = hold) then raise exception 'FAIL 3c: the charged hold stayed open'; end if;
  r := public.agent_spend_reserve(member, 'agent_chat', 0.6);
  if (r->>'allowed')::boolean then raise exception 'FAIL 3d: a charged unknown outcome did not count against the cap (%)', r; end if;
  r := public.agent_spend_reserve(member, 'agent_chat', 0.5);
  if not (r->>'allowed')::boolean then raise exception 'FAIL 3e: a turn within what is left was refused (%)', r; end if;
  checks := checks + 4;

  -- 4. Status of a chat request.
  if has_function_privilege('authenticated', 'public.agent_chat_turn_status(uuid,uuid)', 'execute')
     or has_function_privilege('anon', 'public.agent_chat_turn_status(uuid,uuid)', 'execute')
     or not has_function_privilege('service_role', 'public.agent_chat_turn_status(uuid,uuid)', 'execute') then
    raise exception 'FAIL 4: agent_chat_turn_status privileges';
  end if;
  r := public.agent_chat_turn_status(member, request);
  if (r->>'found')::boolean then raise exception 'FAIL 4b: an unknown request was found (%)', r; end if;
  perform public.agent_chat_turn_begin(member, request, 'Will this fit?');
  r := public.agent_chat_turn_status(member, request);
  if not (r->>'found')::boolean or r->'member'->>'body' <> 'Will this fit?' or r->'reply' <> 'null'::jsonb then raise exception 'FAIL 4c: a running turn (%)', r; end if;
  perform public.agent_chat_turn_finish(member, request, 'It fits.');
  r := public.agent_chat_turn_status(member, request);
  if r->'reply'->>'body' <> 'It fits.' then raise exception 'FAIL 4d: a finished turn has no reply (%)', r; end if;
  if (public.agent_chat_turn_status(gen_random_uuid(), request)->>'found')::boolean then raise exception 'FAIL 4e: another member read this request'; end if;
  checks := checks + 5;

  raise notice 'all % spend-lock-order checks passed (a settlement waiting for a reservation, charged unknowns, request status)', checks;
end $$;

rollback;
