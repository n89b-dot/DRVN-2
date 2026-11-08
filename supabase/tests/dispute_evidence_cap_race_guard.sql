-- OS-W29: the 8-photo dispute-evidence limit holds in the database, and under
-- concurrent attaches (20261108130300). Disposable local or CI database only.
--
--   1. One session: a party's 9th photo on a dispute is refused with
--      check_violation, while the other party and another dispute still
--      attach.
--   2. Two sessions, with dblink (pattern from social_moderation_race_guard.sql):
--      with 7 photos attached, this session attaches the 8th and, while it is
--      uncommitted, the other session attaches a 9th. The second must wait,
--      then be refused once the first commits, leaving 8. Before the fix
--      nothing in the database held the limit: the app counted 7 in each
--      request and both inserts went in, leaving 9. A control first shows the
--      other session's attach goes through when nothing is in its way.
--
-- The other session sees only committed rows, so part 2's fixtures (and this
-- session's half of the race) are committed and deleted again at the end, and
-- at the start in case an earlier failed run stopped before its cleanup.

-- ---------- 1. One session ----------
begin;
do $$
declare
  buyer uuid := gen_random_uuid();
  seller uuid := gen_random_uuid();
  o uuid := gen_random_uuid();
  other uuid := gen_random_uuid();
  refused boolean := false;
  n int;
begin
  insert into auth.users(id, email, raw_user_meta_data) values
    (buyer, 'w29-cap-buyer@drvn.test', '{}'), (seller, 'w29-cap-seller@drvn.test', '{}');
  insert into public.orders(id, buyer_id, seller_id, status, subtotal_cents, total_cents) values
    (o, buyer, seller, 'disputed', 5000, 5000), (other, buyer, seller, 'disputed', 5000, 5000);
  insert into public.dispute_evidence(order_id, uploader_id, url, storage_path)
    select o, buyer, buyer || '/' || o || '/p' || g || '.jpg', buyer || '/' || o || '/p' || g || '.jpg'
      from generate_series(1, 8) g;
  begin
    insert into public.dispute_evidence(order_id, uploader_id, url, storage_path)
      values (o, buyer, buyer || '/' || o || '/p9.jpg', buyer || '/' || o || '/p9.jpg');
  exception when check_violation then
    refused := sqlerrm like '%maximum of 8 photos%';
  end;
  if not refused then raise exception 'FAIL 1: a party attached a 9th photo to one dispute'; end if;

  insert into public.dispute_evidence(order_id, uploader_id, url, storage_path)
    values (o, seller, seller || '/' || o || '/s1.jpg', seller || '/' || o || '/s1.jpg');
  insert into public.dispute_evidence(order_id, uploader_id, url, storage_path)
    values (other, buyer, buyer || '/' || other || '/p1.jpg', buyer || '/' || other || '/p1.jpg');
  select count(*) into n from public.dispute_evidence where order_id in (o, other);
  if n <> 10 then raise exception 'FAIL 2: the limit stopped the other party or another dispute (% rows, not 10)', n; end if;

  if not exists (
    select 1 from pg_trigger t
     where t.tgrelid = 'public.dispute_evidence'::regclass and not t.tgisinternal
       and t.tgfoid = 'private.dispute_evidence_attach_cap()'::regprocedure
  ) or (select provolatile from pg_proc where oid = 'private.dispute_evidence_attach_cap()'::regprocedure) <> 'v'
     or position('pg_advisory_xact_lock' in pg_get_functiondef('private.dispute_evidence_attach_cap()'::regprocedure)) = 0 then
    raise exception 'FAIL 3: dispute evidence is not counted under a lock on insert';
  end if;
end $$;
rollback;

-- ---------- 2. Two sessions ----------
create function pg_temp.w29_cleanup() returns void language plpgsql as $$
declare
  v_users uuid[] := array(select id from auth.users where email in
    ('w29-race-buyer@example.test', 'w29-race-seller@example.test'));
begin
  delete from public.dispute_evidence where uploader_id = any(v_users)
     or order_id in (select id from public.orders where buyer_id = any(v_users));
  delete from public.orders where buyer_id = any(v_users) or seller_id = any(v_users);
  delete from auth.users where id = any(v_users);
  if exists (select 1 from auth.users where email like 'w29-race-%@example.test') then
    raise exception 'Cleanup: the committed fixtures were not removed';
  end if;
end $$;

select pg_temp.w29_cleanup();

-- Fixtures, committed: a dispute with 7 of the buyer's photos attached.
create table pg_temp.w29_fx (k text primary key, id uuid not null);
do $$
declare
  buyer uuid := gen_random_uuid();
  seller uuid := gen_random_uuid();
  o uuid := gen_random_uuid();
begin
  insert into auth.users(id, email, raw_user_meta_data) values
    (buyer, 'w29-race-buyer@example.test', '{}'), (seller, 'w29-race-seller@example.test', '{}');
  insert into pg_temp.w29_fx values ('buyer', buyer), ('order', o);
  insert into public.orders(id, buyer_id, seller_id, status, subtotal_cents, total_cents)
    values (o, buyer, seller, 'disputed', 5000, 5000);
  insert into public.dispute_evidence(order_id, uploader_id, url, storage_path)
    select o, buyer, buyer || '/' || o || '/f' || g || '.jpg', buyer || '/' || o || '/f' || g || '.jpg'
      from generate_series(1, 7) g;
end $$;

-- A second session on this database, or null when dblink can't give one.
create function pg_temp.connect(p_name text) returns text language plpgsql as $$
declare
  v_ext text;
begin
  if not exists (select 1 from pg_extension where extname = 'dblink') then
    if not exists (select 1 from pg_available_extensions where name = 'dblink') then
      raise notice 'dblink is not available: the two-session checks are skipped, part 1 still holds';
      return null;
    end if;
    create extension dblink;
  end if;
  select n.nspname into v_ext from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'dblink';
  begin
    execute format('select %I.dblink_connect(%L, %L)', v_ext, p_name,
      format('host=127.0.0.1 port=%s dbname=%s user=%s password=postgres', current_setting('port'), current_database(), current_user));
  exception when others then
    raise notice 'dblink could not connect back (%): the two-session checks are skipped, part 1 still holds', sqlerrm;
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
  -- The empty result that ends the async query.
  execute format('select count(*) from %I.dblink_get_result(%L, false) as t(r text)', p_ext, p_conn);
  if v_err is not null and v_err <> 'OK' then
    return 'error: ' || v_err;
  end if;
  return coalesce(v_out, 'null');
end $$;

-- Runs outside an explicit transaction block, so this session can commit its
-- attach while the other session waits. A failed check is held until the
-- committed rows are cleaned up.
do $$
declare
  -- dblink is created here only if it wasn't installed, and dropped again
  -- below: this block commits, and a dblink left in public would trip
  -- definer_exposure_guard and function_search_path_guard.
  had_dblink boolean := exists (select 1 from pg_extension where extname = 'dblink');
  ext text := pg_temp.connect('w29race');
  remote_pid int;
  buyer uuid := (select id from pg_temp.w29_fx where k = 'buyer');
  o uuid := (select id from pg_temp.w29_fx where k = 'order');
  folder text := buyer || '/' || o || '/';
  attach_sql text := 'insert into public.dispute_evidence(order_id, uploader_id, url, storage_path) values (%L, %L, %L, %L)';
  waited boolean;
  reply text;
  n int;
  v_fail text;
  checks int := 0;
begin
  if ext is null then
    if not had_dblink then drop extension if exists dblink; end if;
    raise notice 'two-session checks skipped';
    return;
  end if;
  execute format('select r from %I.dblink(%L, %L) as t(r int)', ext, 'w29race', 'select pg_backend_pid()') into remote_pid;

  -- Control: uncontended, the other session's 8th attach goes through.
  perform pg_temp.rx(ext, 'w29race', 'begin; set local lock_timeout = ''20s''');
  waited := pg_temp.send_and_wait(ext, 'w29race', remote_pid,
    format(attach_sql, o, buyer, folder || 'control.jpg', folder || 'control.jpg'));
  reply := pg_temp.answer(ext, 'w29race');
  perform pg_temp.rx(ext, 'w29race', 'rollback');
  if reply is distinct from 'INSERT 0 1' then
    v_fail := format('FAIL control: the 8th attach from the other session was refused (%s)', reply);
  else
    checks := checks + 1;
  end if;

  -- The race: this session's 8th attach is uncommitted when the other's 9th starts.
  if v_fail is null then
    execute format(attach_sql, o, buyer, folder || 'race-a.jpg', folder || 'race-a.jpg');
    perform pg_temp.rx(ext, 'w29race', 'begin; set local lock_timeout = ''20s''');
    waited := pg_temp.send_and_wait(ext, 'w29race', remote_pid,
      format(attach_sql, o, buyer, folder || 'race-b.jpg', folder || 'race-b.jpg'));
    commit;
    reply := pg_temp.answer(ext, 'w29race');
    perform pg_temp.rx(ext, 'w29race', case when reply like 'error:%' then 'rollback' else 'commit' end);
    select count(*) into n from public.dispute_evidence where order_id = o and uploader_id = buyer;
    if not waited then
      v_fail := format('FAIL 4: a second attach did not wait for one in progress (%s; %s photos now)', reply, n);
    elsif reply not like 'error:%maximum of 8 photos%' then
      v_fail := format('FAIL 5: the 9th attach was not refused (%s)', reply);
    elsif n <> 8 then
      v_fail := format('FAIL 6: the dispute holds % of the buyer''s photos, not 8', n);
    else
      checks := checks + 3;
    end if;
  end if;

  execute format('select %I.dblink_disconnect(%L)', ext, 'w29race');
  if not had_dblink then drop extension dblink; end if;
  if v_fail is not null then
    perform pg_temp.w29_cleanup();
    commit;
    raise exception '%', v_fail;
  end if;
  raise notice 'PASS: % two-session checks (control; a concurrent 9th attach waits and is refused, leaving 8)', checks;
end $$;

-- Remove everything the checks committed.
select pg_temp.w29_cleanup();
do $$ begin raise notice 'all dispute evidence cap checks passed'; end $$;
