-- OS-W11 follow-up (Codex on #157; 20261108130400): a return started while a
-- deleting seller's case is being finalised never leaves the seller banned
-- with no retry. Disposable local or CI database only.
--
-- With dblink (pattern from social_moderation_race_guard.sql), two sessions,
-- for real. The other session is the shop-return server action: it calls
-- create_shop_policy_return as the service role, the only role it is granted
-- to (the action checks the signed-in buyer first).
--   A. Return first. The other session starts a return on seller A's
--      completed order and, while that is uncommitted, this session finalises
--      seller A's deletion (it can't see the return yet) and commits. When the
--      return commits, the case must be back in the queue, paused on that
--      order, so the worker's next pass gives sign-in back. Before the fix the
--      case stayed finished with the seller banned and nothing scheduled.
--   B. Finalise first. This session finalises seller B's deletion and, while
--      that is uncommitted, the other session commits a return on seller B's
--      completed order. The commit must wait for the finalise, then requeue
--      the case. Before the fix nothing waited.
--   Control first: with no deletion running, the other session's return
--   commits without waiting, so A and B can't pass because the remote call
--   failed for some other reason.
--
-- The other session sees only committed rows, so fixtures (and, in each
-- race, this session's half) are committed and everything is deleted again
-- at the end, and at the start in case an earlier failed run stopped before
-- its cleanup.

create function pg_temp.w11r_cleanup() returns void language plpgsql as $$
declare
  v_users uuid[] := array(select id from auth.users where email like 'w11-race-%@example.test');
begin
  delete from public.return_items ri using public.returns r, public.orders o
   where ri.return_id = r.id and r.order_id = o.id and (o.buyer_id = any(v_users) or o.seller_id = any(v_users));
  delete from public.returns r using public.orders o
   where r.order_id = o.id and (o.buyer_id = any(v_users) or o.seller_id = any(v_users));
  delete from public.order_items oi using public.orders o
   where oi.order_id = o.id and (o.buyer_id = any(v_users) or o.seller_id = any(v_users));
  delete from public.account_deletion_requests where user_id = any(v_users);
  delete from public.orders where buyer_id = any(v_users) or seller_id = any(v_users);
  delete from public.listings where seller_id = any(v_users);
  delete from public.remediation_jobs where dedup_key = any(array(select 'delete:' || u::text from unnest(v_users) u));
  delete from auth.users where id = any(v_users);
  if exists (select 1 from auth.users where email like 'w11-race-%@example.test') then
    raise exception 'Cleanup: the committed fixtures were not removed (OS-W11)';
  end if;
end $$;

select pg_temp.w11r_cleanup();

-- Fixtures, committed: three sellers (control, A, B) each with a completed,
-- delivered order inside its 30-day shop return window, one buyer, and for A
-- and B a deletion job the worker holds mid-run with the case cleaning up.
create table pg_temp.w11r_fx (k text primary key, id uuid not null);
do $$
declare
  buyer uuid := gen_random_uuid();
  policy jsonb := jsonb_build_object('commercial', jsonb_build_object(
    'return_policy', jsonb_build_object('returns_accepted', true, 'window_days', 30)));
  s text;
  v_seller uuid;
  v_listing uuid;
  v_order uuid;
  v_job uuid;
  v_lease uuid;
begin
  insert into auth.users(id, email, raw_user_meta_data) values (buyer, 'w11-race-buyer@example.test', '{}');
  insert into pg_temp.w11r_fx values ('buyer', buyer);
  foreach s in array array['control', 'a', 'b'] loop
    v_seller := gen_random_uuid();
    v_order := gen_random_uuid();
    insert into auth.users(id, email, raw_user_meta_data) values (v_seller, 'w11-race-seller-' || s || '@example.test', '{}');
    insert into public.listings(seller_id, title, category, price_cents, shipping_cents, currency, status)
    values (v_seller, 'W11 race ' || s, 'engine', 4000, 400, 'USD', 'sold') returning id into v_listing;
    insert into public.orders(id, buyer_id, seller_id, status, delivered_at, completed_at, subtotal_cents, shipping_cents, platform_fee_cents, total_cents, currency)
    values (v_order, buyer, v_seller, 'completed', now() - interval '2 days', now() - interval '1 day', 4000, 400, 440, 4400, 'USD');
    insert into public.order_items(order_id, listing_id, title, price_cents, shipping_cents, commercial_snapshot)
    values (v_order, v_listing, 'W11 race ' || s, 4000, 400, policy);
    insert into pg_temp.w11r_fx values ('seller_' || s, v_seller), ('order_' || s, v_order);
    if s <> 'control' then
      v_lease := gen_random_uuid();
      insert into public.remediation_jobs(kind, dedup_key, payload, status, lease_id, locked_until)
      values ('delete_account', 'delete:' || v_seller, jsonb_build_object('user_id', v_seller), 'processing', v_lease, now() + interval '30 minutes')
      returning id into v_job;
      insert into public.account_deletion_requests(user_id, job_id, outcome, next_action, responsible_owner)
      values (v_seller, v_job, 'cleanup_pending', 'Automated cleanup is in progress.', 'privacy worker');
      insert into pg_temp.w11r_fx values ('job_' || s, v_job), ('lease_' || s, v_lease);
    end if;
  end loop;
end $$;

-- A second session on this database, or null when dblink can't give one.
create function pg_temp.connect(p_name text) returns text language plpgsql as $$
declare
  v_ext text;
begin
  if not exists (select 1 from pg_extension where extname = 'dblink') then
    if not exists (select 1 from pg_available_extensions where name = 'dblink') then
      raise notice 'dblink is not available: the two-session checks are skipped, the definitions are checked in deletion_hold_before_ban_guard.sql';
      return null;
    end if;
    create extension dblink;
  end if;
  select n.nspname into v_ext from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'dblink';
  begin
    execute format('select %I.dblink_connect(%L, %L)', v_ext, p_name,
      format('host=127.0.0.1 port=%s dbname=%s user=%s password=postgres', current_setting('port'), current_database(), current_user));
  exception when others then
    raise notice 'dblink could not connect back (%): the two-session checks are skipped, the definitions are checked in deletion_hold_before_ban_guard.sql', sqlerrm;
    return null;
  end;
  return v_ext;
end $$;

create function pg_temp.rx(p_ext text, p_conn text, p_sql text) returns void language plpgsql as $$
begin
  execute format('select %I.dblink_exec(%L, %L)', p_ext, p_conn, p_sql);
end $$;

-- The other session opens a transaction as the shop-return action does: the
-- service role, then starts the buyer's return (uncommitted).
create function pg_temp.remote_return(p_ext text, p_conn text, p_order uuid, p_buyer uuid) returns void language plpgsql as $$
declare
  v_reply jsonb;
begin
  perform pg_temp.rx(p_ext, p_conn, format(
    'begin; set local lock_timeout = %L; set local role service_role; set local request.jwt.claims = %L',
    '20s', json_build_object('role', 'service_role')::text));
  -- dblink, not dblink_exec: the function returns a row.
  execute format('select r::jsonb from %I.dblink(%L, %L) as t(r text)', p_ext, p_conn, format(
    'select public.create_shop_policy_return(%L, %L, %L)::text', p_order, p_buyer, 'W11 race return'))
    into v_reply;
  if not coalesce((v_reply->>'ok')::boolean, false) or coalesce((v_reply->>'replayed')::boolean, true) then
    raise exception 'Fixture: the other session did not start a new return (%) (OS-W11)', v_reply;
  end if;
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

-- This guard's own helpers are called while acting as other roles. A new
-- function is closed by default (architecture plan 2, item A3), so they are opened here.
grant execute on all routines in schema pg_temp to public;

-- Runs outside an explicit transaction block, so this session can commit its
-- half of each race while the other session waits. A failed check is held
-- until the committed rows are cleaned up.
do $$
declare
  had_dblink boolean := exists (select 1 from pg_extension where extname = 'dblink');
  ext text := pg_temp.connect('w11race');
  remote_pid int;
  buyer uuid := (select id from pg_temp.w11r_fx where k = 'buyer');
  order_control uuid := (select id from pg_temp.w11r_fx where k = 'order_control');
  seller_a uuid := (select id from pg_temp.w11r_fx where k = 'seller_a');
  order_a uuid := (select id from pg_temp.w11r_fx where k = 'order_a');
  job_a uuid := (select id from pg_temp.w11r_fx where k = 'job_a');
  lease_a uuid := (select id from pg_temp.w11r_fx where k = 'lease_a');
  seller_b uuid := (select id from pg_temp.w11r_fx where k = 'seller_b');
  order_b uuid := (select id from pg_temp.w11r_fx where k = 'order_b');
  job_b uuid := (select id from pg_temp.w11r_fx where k = 'job_b');
  lease_b uuid := (select id from pg_temp.w11r_fx where k = 'lease_b');
  retained jsonb := jsonb_build_object(
    'blocker_code', 'immutable_retained_identity',
    'affected_data_classes', jsonb_build_array('orders'),
    'next_action', 'An operator must apply the retention policy.',
    'responsible_owner', 'operations and policy owner',
    'policy_decisions_pending', jsonb_build_array('audit/log retention'));
  waited boolean;
  reply text;
  v_final jsonb;
  v_fail text;
  checks int := 0;
begin
  if ext is null then
    if not had_dblink then drop extension if exists dblink; end if;
    raise notice 'two-session checks skipped';
    return;
  end if;
  execute format('select r from %I.dblink(%L, %L) as t(r int)', ext, 'w11race', 'select pg_backend_pid()') into remote_pid;

  -- Control: with no deletion running, the return commits without waiting.
  begin
    perform pg_temp.remote_return(ext, 'w11race', order_control, buyer);
    waited := pg_temp.send_and_wait(ext, 'w11race', remote_pid, 'commit');
    reply := pg_temp.answer(ext, 'w11race');
  exception when others then
    reply := 'error: ' || sqlerrm;
    perform pg_temp.rx(ext, 'w11race', 'rollback');
  end;
  if reply is distinct from 'COMMIT' or waited then
    v_fail := format('FAIL control: the buyer''s return from the other session did not commit cleanly (%s, waited %s)', reply, waited);
  elsif not exists (select 1 from public.returns where order_id = order_control) then
    v_fail := 'FAIL control: the control return was not recorded';
  else
    checks := checks + 1;
  end if;

  -- A. Return first: finalise can't see it; the return's commit requeues.
  if v_fail is null then
    perform pg_temp.remote_return(ext, 'w11race', order_a, buyer);
    v_final := public.account_deletion_finalise(job_a, lease_a, seller_a, retained);
    commit;
    if v_final->>'outcome' is distinct from 'operator_attention' then
      v_fail := format('Fixture A: finalise did not end with the operator step (%s)', v_final);
      perform pg_temp.rx(ext, 'w11race', 'rollback');
    else
      waited := pg_temp.send_and_wait(ext, 'w11race', remote_pid, 'commit');
      reply := pg_temp.answer(ext, 'w11race');
      if reply is distinct from 'COMMIT' then
        v_fail := format('Fixture A: the return did not commit (%s)', reply);
      elsif (select status from public.remediation_jobs where id = job_a) <> 'pending' then
        v_fail := 'FAIL A: a return that committed after the case finished left it finished, with the seller banned and nothing scheduled';
      elsif (select outcome from public.account_deletion_requests where user_id = seller_a) <> 'temporary_financial_hold'
         or (select hold_order_id from public.account_deletion_requests where user_id = seller_a) is distinct from order_a then
        v_fail := 'FAIL A: the requeued case does not name the order to settle';
      else
        checks := checks + 2;
      end if;
    end if;
  end if;

  -- B. Finalise first: the return's commit waits for it, then requeues.
  if v_fail is null then
    perform pg_temp.remote_return(ext, 'w11race', order_b, buyer);
    v_final := public.account_deletion_finalise(job_b, lease_b, seller_b, retained);
    if v_final->>'outcome' is distinct from 'operator_attention' then
      v_fail := format('Fixture B: finalise did not end with the operator step (%s)', v_final);
      commit;
      perform pg_temp.rx(ext, 'w11race', 'rollback');
    else
      waited := pg_temp.send_and_wait(ext, 'w11race', remote_pid, 'commit');
      commit;
      reply := pg_temp.answer(ext, 'w11race');
      if reply is distinct from 'COMMIT' then
        v_fail := format('Fixture B: the return did not commit (%s)', reply);
      elsif not waited then
        v_fail := 'FAIL B: a return committing during the finalise did not wait for it';
      elsif (select status from public.remediation_jobs where id = job_b) <> 'pending'
         or (select outcome from public.account_deletion_requests where user_id = seller_b) <> 'temporary_financial_hold' then
        v_fail := 'FAIL B: a return that committed during the finalise did not put the case back in the queue';
      else
        checks := checks + 2;
      end if;
    end if;
  end if;

  execute format('select %I.dblink_disconnect(%L)', ext, 'w11race');
  if not had_dblink then drop extension dblink; end if;
  if v_fail is not null then
    perform pg_temp.w11r_cleanup();
    commit;
    raise exception '% (OS-W11)', v_fail;
  end if;
  raise notice 'PASS: % two-session checks (control; a return in flight during finalise requeues the case; a return committing during finalise waits, then requeues)', checks;
end $$;

-- Remove everything the checks committed.
select pg_temp.w11r_cleanup();
do $$ begin raise notice 'all deletion hold race checks passed'; end $$;
