-- OS-W21 follow-up (Codex on PR #95; 20261108130100): the build hold and the
-- dispute-evidence folder cap hold when two sessions race. Disposable local
-- or CI database only.
--
-- With dblink (shipped in the supabase/postgres image; pattern from
-- chargeback_dispatch_lock_guard.sql), two sessions, for real:
--   A. Publish first. This session (the owner) publishes a private build and,
--      while that is uncommitted, the other session places a hold on it. The
--      hold must wait for the publish, and once this session commits the
--      build must be private. Before the fix the hold skipped the car (it
--      read is_public = false), committed without waiting, and the publish
--      then left the build public with a hold on file.
--   B. Hold first. This session places the hold and, while it is
--      uncommitted, the other session (the owner) publishes. The publish must
--      wait, then re-check under the car's row lock and stay private. Before
--      the fix the hold never locked the car, so the publish didn't wait and
--      committed public.
--   C. Concurrent uploads. With 15 files already in a buyer's evidence
--      folder, this session uploads the 16th and, while it is uncommitted,
--      the other session uploads a 17th. The second must wait, then be
--      refused once the first commits. Before the fix both counted 15, both
--      passed the cap of 16, and the folder held 17.
--   Controls first: uncontended, the other session's publish makes the build
--   public and its upload is accepted, so B and C can't pass because the
--   remote write failed for some other reason.
--
-- The other session sees only committed rows, so fixtures (and, in each
-- race, this session's half) are committed and everything is deleted again
-- at the end, and at the start in case an earlier failed run stopped before
-- its cleanup.

create function pg_temp.w21r_cleanup() returns void language plpgsql as $$
declare
  v_users uuid[] := array(select id from auth.users where email in
    ('w21-race-owner@example.test', 'w21-race-buyer@example.test'));
begin
  delete from storage.objects where bucket_id = 'dispute-evidence'
     and split_part(name, '/', 1) = any(array(select u::text from unnest(v_users) u));
  delete from public.car_moderation_holds h using public.cars c where c.id = h.car_id and c.owner_id = any(v_users);
  delete from public.cars where owner_id = any(v_users);
  delete from public.orders where buyer_id = any(v_users) or seller_id = any(v_users);
  delete from auth.users where id = any(v_users);
  if exists (select 1 from auth.users where email like 'w21-race-%@example.test')
     or exists (select 1 from public.cars where slug like 'w21-race-%') then
    raise exception 'Cleanup: the committed fixtures were not removed';
  end if;
end $$;

select pg_temp.w21r_cleanup();

-- Hosted Supabase grants members storage.objects; the CI image's storage
-- stand-in doesn't, and the other session only sees a committed grant. Grant
-- what is missing for the checks, and take back exactly that at the end, so
-- RLS is what's under test and later guards see the image as it was.
create table pg_temp.w21r_grants (privilege text primary key);
insert into pg_temp.w21r_grants
  select p from unnest(array['select', 'insert']) p
   where not has_table_privilege('authenticated', 'storage.objects', p);
do $$
declare
  p text;
begin
  for p in select privilege from pg_temp.w21r_grants loop
    execute format('grant %s on storage.objects to authenticated', p);
  end loop;
  if not has_schema_privilege('authenticated', 'storage', 'usage') then
    insert into pg_temp.w21r_grants values ('usage');
    grant usage on schema storage to authenticated;
  end if;
end $$;

create function pg_temp.w21r_restore_grants() returns void language plpgsql as $$
declare
  p text;
begin
  for p in select privilege from pg_temp.w21r_grants where privilege <> 'usage' loop
    execute format('revoke %s on storage.objects from authenticated', p);
  end loop;
  if exists (select 1 from pg_temp.w21r_grants where privilege = 'usage') then
    revoke usage on schema storage from authenticated;
  end if;
  delete from pg_temp.w21r_grants;
end $$;

-- Fixtures, committed.
create table pg_temp.w21r_fx (k text primary key, id uuid not null);
do $$
declare
  v_owner uuid := gen_random_uuid();
  buyer uuid := gen_random_uuid();
  o uuid := gen_random_uuid();
begin
  insert into auth.users(id, email, raw_user_meta_data) values
    (v_owner, 'w21-race-owner@example.test', '{}'), (buyer, 'w21-race-buyer@example.test', '{}');
  insert into pg_temp.w21r_fx values ('owner', v_owner), ('buyer', buyer), ('order', o),
    ('car_a', gen_random_uuid()), ('car_b', gen_random_uuid());
  insert into public.cars(id, owner_id, slug, name, is_public)
    select f.id, v_owner, 'w21-race-' || f.k, 'W21 race ' || f.k, false from pg_temp.w21r_fx f where f.k in ('car_a', 'car_b');
  insert into public.orders(id, buyer_id, seller_id, status, subtotal_cents, total_cents)
    values (o, buyer, v_owner, 'disputed', 5000, 5000);
  insert into storage.objects(bucket_id, name, owner)
    select 'dispute-evidence', buyer || '/' || o || '/f' || g || '.jpg', buyer from generate_series(1, 15) g;
end $$;

-- A second session on this database, or null when dblink can't give one.
create function pg_temp.connect(p_name text) returns text language plpgsql as $$
declare
  v_ext text;
begin
  if not exists (select 1 from pg_extension where extname = 'dblink') then
    if not exists (select 1 from pg_available_extensions where name = 'dblink') then
      raise notice 'dblink is not available: the two-session checks are skipped, the definitions are checked in social_moderation_guard.sql';
      return null;
    end if;
    create extension dblink;
  end if;
  select n.nspname into v_ext from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'dblink';
  begin
    execute format('select %I.dblink_connect(%L, %L)', v_ext, p_name,
      format('host=127.0.0.1 port=%s dbname=%s user=%s password=postgres', current_setting('port'), current_database(), current_user));
  exception when others then
    raise notice 'dblink could not connect back (%): the two-session checks are skipped, the definitions are checked in social_moderation_guard.sql', sqlerrm;
    return null;
  end;
  return v_ext;
end $$;

create function pg_temp.rx(p_ext text, p_conn text, p_sql text) returns void language plpgsql as $$
begin
  execute format('select %I.dblink_exec(%L, %L)', p_ext, p_conn, p_sql);
end $$;

-- The other session opens a transaction as a signed-in member.
create function pg_temp.remote_member(p_ext text, p_conn text, p_member uuid) returns void language plpgsql as $$
begin
  perform pg_temp.rx(p_ext, p_conn, format(
    'begin; set local lock_timeout = %L; set local role authenticated; set local request.jwt.claims = %L',
    '20s', json_build_object('sub', p_member, 'role', 'authenticated')::text));
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
-- half of each race while the other session waits. A failed check is held
-- until the committed rows are cleaned up.
do $$
declare
  -- dblink is created here only if it wasn't installed, and dropped again
  -- below: this block commits, and a dblink left in public would trip
  -- definer_exposure_guard and function_search_path_guard.
  had_dblink boolean := exists (select 1 from pg_extension where extname = 'dblink');
  ext text := pg_temp.connect('w21race');
  remote_pid int;
  v_owner uuid := (select id from pg_temp.w21r_fx where k = 'owner');
  buyer uuid := (select id from pg_temp.w21r_fx where k = 'buyer');
  o uuid := (select id from pg_temp.w21r_fx where k = 'order');
  car_a uuid := (select id from pg_temp.w21r_fx where k = 'car_a');
  car_b uuid := (select id from pg_temp.w21r_fx where k = 'car_b');
  folder text := buyer || '/' || o || '/';
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
  execute format('select r from %I.dblink(%L, %L) as t(r int)', ext, 'w21race', 'select pg_backend_pid()') into remote_pid;

  -- Controls: uncontended, the other session's publish and upload go through.
  perform pg_temp.remote_member(ext, 'w21race', v_owner);
  execute format('select r from %I.dblink(%L, %L) as t(r boolean)', ext, 'w21race', format(
    'with p as (update public.cars set is_public = true where id = %L returning is_public) select bool_and(is_public) from p', car_b))
    into reply;
  perform pg_temp.rx(ext, 'w21race', 'rollback');
  if reply is distinct from 'true' then
    v_fail := format('FAIL control: the owner''s publish from the other session did not make the build public (%s)', reply);
  end if;
  if v_fail is null then
    perform pg_temp.remote_member(ext, 'w21race', buyer);
    waited := pg_temp.send_and_wait(ext, 'w21race', remote_pid, format(
      'insert into storage.objects(bucket_id, name, owner) values (%L, %L, %L)', 'dispute-evidence', folder || 'control.jpg', buyer));
    reply := pg_temp.answer(ext, 'w21race');
    perform pg_temp.rx(ext, 'w21race', 'rollback');
    if reply is distinct from 'INSERT 0 1' then
      v_fail := format('FAIL control: the 16th upload from the other session was refused (%s)', reply);
    else
      checks := checks + 2;
    end if;
  end if;

  -- A. Publish first: the hold waits for it, then makes the build private.
  if v_fail is null then
    perform set_config('role', 'authenticated', true);
    perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
    update public.cars set is_public = true where id = car_a;
    get diagnostics n = row_count;
    -- Back to this session's own role: the row lock stays with the
    -- transaction, and only a privileged role sees the other session's wait.
    perform set_config('role', 'none', true);
    if n <> 1 then
      v_fail := 'Fixture A: the owner could not publish the build';
    else
      perform pg_temp.rx(ext, 'w21race', 'set lock_timeout = ''20s''');
      waited := pg_temp.send_and_wait(ext, 'w21race', remote_pid, format(
        'insert into public.car_moderation_holds(car_id, reason) values (%L, %L)', car_a, 'W21 race hold'));
    end if;
    commit;
    if v_fail is null then
      reply := pg_temp.answer(ext, 'w21race');
      perform pg_temp.rx(ext, 'w21race', 'reset lock_timeout');
      if reply is distinct from 'INSERT 0 1' then
        v_fail := format('Fixture A: the hold was not placed (%s)', reply);
      elsif not waited then
        v_fail := 'FAIL A: a hold did not wait for the owner''s publish in progress';
      elsif (select is_public from public.cars where id = car_a) then
        v_fail := 'FAIL A: the build is public although a hold was placed while it was being published';
      else
        checks := checks + 2;
      end if;
    end if;
  end if;

  -- B. Hold first: the publish waits, re-checks under the row lock, stays private.
  if v_fail is null then
    insert into public.car_moderation_holds(car_id, reason) values (car_b, 'W21 race hold');
    perform pg_temp.remote_member(ext, 'w21race', v_owner);
    waited := pg_temp.send_and_wait(ext, 'w21race', remote_pid, format(
      'update public.cars set is_public = true where id = %L', car_b));
    commit;
    reply := pg_temp.answer(ext, 'w21race');
    perform pg_temp.rx(ext, 'w21race', case when reply like 'error:%' then 'rollback' else 'commit' end);
    if reply is distinct from 'UPDATE 1' then
      v_fail := format('Fixture B: the owner''s publish did not run (%s)', reply);
    elsif not waited then
      v_fail := 'FAIL B: the owner''s publish did not wait for a hold in progress';
    elsif (select is_public from public.cars where id = car_b) then
      v_fail := 'FAIL B: the owner published a build while it was being hidden';
    else
      checks := checks + 2;
    end if;
  end if;

  -- C. Two uploads into a folder one short of the cap: one is accepted.
  if v_fail is null then
    perform set_config('role', 'authenticated', true);
    perform set_config('request.jwt.claims', json_build_object('sub', buyer, 'role', 'authenticated')::text, true);
    insert into storage.objects(bucket_id, name, owner) values ('dispute-evidence', folder || 'race-a.jpg', buyer);
    perform set_config('role', 'none', true);
    perform pg_temp.remote_member(ext, 'w21race', buyer);
    waited := pg_temp.send_and_wait(ext, 'w21race', remote_pid, format(
      'insert into storage.objects(bucket_id, name, owner) values (%L, %L, %L)', 'dispute-evidence', folder || 'race-b.jpg', buyer));
    commit;
    reply := pg_temp.answer(ext, 'w21race');
    perform pg_temp.rx(ext, 'w21race', case when reply like 'error:%' then 'rollback' else 'commit' end);
    select count(*) into n from storage.objects where bucket_id = 'dispute-evidence' and name like folder || '%';
    if not waited then
      v_fail := format('FAIL C: a second upload did not wait for one in progress (%s)', reply);
    elsif reply not like 'error:%row-level security%' then
      v_fail := format('FAIL C: the 17th upload was not refused by the upload policy (%s)', reply);
    elsif n <> 16 then
      v_fail := format('FAIL C: the folder holds % files, not 16', n);
    else
      checks := checks + 3;
    end if;
  end if;

  execute format('select %I.dblink_disconnect(%L)', ext, 'w21race');
  if not had_dblink then drop extension dblink; end if;
  if v_fail is not null then
    perform pg_temp.w21r_cleanup();
    perform pg_temp.w21r_restore_grants();
    commit;
    raise exception '%', v_fail;
  end if;
  raise notice 'PASS: % two-session checks (controls; a hold waits for a publish in progress; a publish waits for a hold in progress; a concurrent upload past the cap is refused)', checks;
end $$;

-- Remove everything the checks committed, and the grants they needed.
select pg_temp.w21r_cleanup();
select pg_temp.w21r_restore_grants();
do $$ begin raise notice 'all social moderation race checks passed'; end $$;
