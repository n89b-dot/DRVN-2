-- N418 (Codex post-merge review of #149; 20261108180000): a handle retired by
-- an account deletion can't be claimed by a session racing the scrub.
-- Disposable local or CI database only.
--
-- The scrub inserts the tombstone and clears the handle in one transaction.
-- Before the fix, a claim of the same handle made while the scrub was
-- uncommitted saw no tombstone, waited on the unique index for the deleted
-- member's row, and won the moment the scrub committed. Now both take the
-- per-handle advisory lock and the claim reads tombstones after it.
--
-- With dblink (pattern from deletion_hold_race_guard.sql), two sessions, for
-- real:
--   Control first: a claim of a free handle commits without waiting, so the
--   race can't pass because the remote call failed for another reason.
--   Race: this session scrubs the member (uncommitted); the other session
--   claims the member's handle and must wait; this session commits; the
--   claim must then be refused as taken, and the handle stays retired.
--
-- The other session sees only committed rows, so the fixtures are committed
-- (with fixed ids, since the scrub erases the email that would find them)
-- and deleted again at the end, and at the start in case an earlier failed
-- run stopped before its cleanup.

create function pg_temp.n418r_cleanup() returns void language plpgsql as $$
declare
  v_users uuid[] := array['00000000-0000-4418-8000-000000000001', '00000000-0000-4418-8000-000000000002']::uuid[];
begin
  delete from public.account_deletion_requests where user_id = any(v_users);
  delete from public.remediation_jobs where dedup_key = any(array(select 'delete:' || u::text from unnest(v_users) u));
  delete from private.username_tombstones where username in ('n418_race_handle', 'n418_race_free');
  delete from auth.users where id = any(v_users);
  if exists (select 1 from auth.users where id = any(v_users))
     or exists (select 1 from public.profiles where username in ('n418_race_handle', 'n418_race_free')) then
    raise exception 'Cleanup: the committed fixtures were not removed (N418)';
  end if;
end $$;

select pg_temp.n418r_cleanup();

-- Fixtures, committed: the deleting member holding the handle, with a
-- deletion under way and nothing open; a member who hasn't chosen one yet.
do $$
declare
  leaver uuid := '00000000-0000-4418-8000-000000000001';
  claimant uuid := '00000000-0000-4418-8000-000000000002';
  v_job uuid;
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (leaver, 'n418-race-leaver@example.test', '{}'),
    (claimant, 'n418-race-claimant@example.test', '{}');
  update public.profiles set username = 'n418_race_handle', display_name = 'Race Leaver' where id = leaver;
  insert into public.remediation_jobs (kind, dedup_key, payload, status, lease_id, locked_until)
  values ('delete_account', 'delete:' || leaver, jsonb_build_object('user_id', leaver), 'processing', gen_random_uuid(), now() + interval '30 minutes')
  returning id into v_job;
  insert into public.account_deletion_requests (user_id, job_id, outcome, next_action, responsible_owner)
  values (leaver, v_job, 'cleanup_pending', 'Automated cleanup is in progress.', 'privacy worker');
end $$;

-- A second session on this database, or null when dblink can't give one.
create function pg_temp.connect(p_name text) returns text language plpgsql as $$
declare
  v_ext text;
begin
  if not exists (select 1 from pg_extension where extname = 'dblink') then
    if not exists (select 1 from pg_available_extensions where name = 'dblink') then
      raise notice 'dblink is not available: the two-session checks are skipped, the lock itself is checked in deletion_late_holds_and_previews_guard.sql';
      return null;
    end if;
    create extension dblink;
  end if;
  select n.nspname into v_ext from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'dblink';
  begin
    execute format('select %I.dblink_connect(%L, %L)', v_ext, p_name,
      format('host=127.0.0.1 port=%s dbname=%s user=%s password=postgres', current_setting('port'), current_database(), current_user));
  exception when others then
    raise notice 'dblink could not connect back (%): the two-session checks are skipped, the lock itself is checked in deletion_late_holds_and_previews_guard.sql', sqlerrm;
    return null;
  end;
  return v_ext;
end $$;

create function pg_temp.rx(p_ext text, p_conn text, p_sql text) returns void language plpgsql as $$
begin
  execute format('select %I.dblink_exec(%L, %L)', p_ext, p_conn, p_sql);
end $$;

-- Starts p_sql in the other session; true once it is waiting on a lock
-- (up to 5s), false if it finished without waiting.
create function pg_temp.send_and_wait(p_ext text, p_conn text, p_pid int, p_sql text) returns boolean language plpgsql as $$
declare
  busy int;
begin
  execute format('select %I.dblink_send_query(%L, %L)', p_ext, p_conn, p_sql);
  for i in 1..100 loop
    if exists (select 1 from pg_stat_activity where pid = p_pid and wait_event_type = 'Lock') then
      return true;
    end if;
    execute format('select %I.dblink_is_busy(%L)', p_ext, p_conn) into busy;
    if busy = 0 then
      return false;
    end if;
    perform pg_sleep(0.05);
  end loop;
  return false;
end $$;

-- The other session's answer: its command status, or 'error: <message>'.
create function pg_temp.answer(p_ext text, p_conn text) returns text language plpgsql as $$
declare
  v_out text;
  v_err text;
begin
  execute format('select r from %I.dblink_get_result(%L, false) as t(r text)', p_ext, p_conn) into v_out;
  execute format('select %I.dblink_error_message(%L)', p_ext, p_conn) into v_err;
  execute format('select count(*) from %I.dblink_get_result(%L, false) as t(r text)', p_ext, p_conn);
  if v_err is not null and v_err <> 'OK' then
    return 'error: ' || v_err;
  end if;
  return coalesce(v_out, 'null');
end $$;

-- Runs outside an explicit transaction block, so this session can commit its
-- half of the race while the other session waits. A failed check is held
-- until the committed rows are cleaned up.
do $$
declare
  had_dblink boolean := exists (select 1 from pg_extension where extname = 'dblink');
  ext text := pg_temp.connect('n418race');
  remote_pid int;
  leaver uuid := '00000000-0000-4418-8000-000000000001';
  claimant uuid := '00000000-0000-4418-8000-000000000002';
  claim text := format('update public.profiles set username = %L where id = %L', 'n418_race_handle', claimant);
  waited boolean;
  reply text;
  v_fail text;
  checks int := 0;
begin
  if ext is null then
    if not had_dblink then drop extension if exists dblink; end if;
    raise notice 'two-session checks skipped';
    perform pg_temp.n418r_cleanup();
    return;
  end if;
  execute format('select r from %I.dblink(%L, %L) as t(r int)', ext, 'n418race', 'select pg_backend_pid()') into remote_pid;

  -- Control: a free handle is claimed without waiting.
  begin
    perform pg_temp.rx(ext, 'n418race', format('begin; set local lock_timeout = %L', '20s'));
    waited := pg_temp.send_and_wait(ext, 'n418race', remote_pid,
      format('update public.profiles set username = %L where id = %L', 'n418_race_free', claimant));
    reply := pg_temp.answer(ext, 'n418race');
  exception when others then
    reply := 'error: ' || sqlerrm;
  end;
  perform pg_temp.rx(ext, 'n418race', 'rollback');
  if reply is distinct from 'UPDATE 1' or waited then
    v_fail := format('FAIL control: the other session could not claim a free handle cleanly (%s, waited %s)', reply, waited);
  else
    checks := checks + 1;
  end if;

  -- The race: the scrub is in flight when the claim arrives.
  if v_fail is null then
    perform public.scrub_deleted_account(leaver, null, null);
    perform pg_temp.rx(ext, 'n418race', format('begin; set local lock_timeout = %L', '20s'));
    waited := pg_temp.send_and_wait(ext, 'n418race', remote_pid, claim);
    commit;
    reply := pg_temp.answer(ext, 'n418race');
    perform pg_temp.rx(ext, 'n418race', 'rollback');
    if not waited then
      v_fail := format('Fixture race: the claim did not wait for the scrub in flight (%s)', reply);
    elsif reply not like 'error:%taken%' then
      v_fail := format('FAIL T1: a claim racing the deletion scrub took the retired handle (%s)', reply);
    elsif (select username from public.profiles where id = claimant) is not null
       or not exists (select 1 from private.username_tombstones where username = 'n418_race_handle') then
      v_fail := 'FAIL T2: after the race the handle is not retired, or the claimant holds it';
    else
      checks := checks + 2;
    end if;
  end if;

  execute format('select %I.dblink_disconnect(%L)', ext, 'n418race');
  if not had_dblink then drop extension dblink; end if;
  perform pg_temp.n418r_cleanup();
  commit;
  if v_fail is not null then
    raise exception '% (N418)', v_fail;
  end if;
  raise notice 'PASS: % two-session checks (control; a claim racing the scrub waits, then is refused as taken)', checks;
end $$;

select pg_temp.n418r_cleanup();
do $$ begin raise notice 'all username tombstone race (N418) checks passed'; end $$;
