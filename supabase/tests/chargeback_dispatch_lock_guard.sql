-- A chargeback being admitted and a payout being dispatched can't interleave
-- (20261107130000; PR #72 review). Disposable local DB only.
--
--   1. From the definitions: prepare_transfer_dispatch locks the order
--      (FOR UPDATE, not KEY SHARE, which an ordinary order update or an FK
--      insert doesn't block) before it reads the journal; hold_stripe_dispute
--      locks the basket's orders before it changes the journal;
--      apply_stripe_dispute_event locks them before it inserts a journal
--      entry or hands a mismatch to hold_stripe_dispute.
--   2. With dblink (shipped in the supabase/postgres image; pattern from
--      agent_spend_lock_order_guard.sql), two sessions, for real:
--        a. Controls: with no admission in progress, the other session's
--           dispatch reaches the lock and the journal check and prepares
--           (true), so the probes below can't pass by returning early.
--        b. This session starts admitting a partial chargeback (it goes
--           straight to hold_stripe_dispute) and, while it is uncommitted,
--           the other session's dispatch of the same order is shown to be
--           waiting on a lock. This session then COMMITS the admission.
--           The waiting dispatch must then refuse (false): it read the
--           journal after the commit, not before. Under the old KEY SHARE
--           lock it had already passed the check and returned true.
--         Once for a delivered order (which the hold updates) and once for
--         an order already in an in-app dispute (which the hold doesn't
--         update, so only the explicit order lock covers it).
--
-- The other session can only see committed rows, so fixtures (and, in 2b,
-- the admissions) are committed, and everything is deleted again at the end
-- — and at the start, in case an earlier failed run stopped before its
-- cleanup. The fixtures' payouts are 'cancelled' (inert); each dispatch
-- probe moves its own copy to 'processing' inside its own transaction, which
-- it rolls back.

create function pg_temp.w18_cleanup() returns void language plpgsql as $$
declare
  v_users uuid[] := array(select id from auth.users where email in
    ('w18-lock-seller@example.test', 'w18-lock-buyer@example.test'));
  v_orders uuid[] := array(select order_id from public.payments where provider_reference in
    ('pi_w18_lock_delivered', 'pi_w18_lock_inapp'));
begin
  delete from public.admin_alert_outbox
   where order_id = any(v_orders) or dedup_key in ('stripe-dispute:dp_w18_lock_delivered', 'stripe-dispute:dp_w18_lock_inapp');
  delete from public.payment_recoveries
   where order_id = any(v_orders) or recovery_key in ('stripe:dispute:dp_w18_lock_delivered', 'stripe:dispute:dp_w18_lock_inapp');
  delete from public.stripe_dispute_journal where dispute_id in ('dp_w18_lock_delivered', 'dp_w18_lock_inapp');
  delete from public.transfer_intents where order_id = any(v_orders);
  delete from public.payments where order_id = any(v_orders);
  delete from public.orders where id = any(v_orders);
  delete from auth.users where id = any(v_users);
  if exists (select 1 from public.orders where id = any(v_orders))
     or exists (select 1 from auth.users where id = any(v_users))
     or exists (select 1 from public.stripe_dispute_journal where dispute_id like 'dp_w18_lock_%') then
    raise exception 'Cleanup: the committed fixtures were not removed';
  end if;
end $$;

select pg_temp.w18_cleanup();

-- Fixtures, committed.
create table pg_temp.w18_fx (k text primary key, id uuid not null);
do $$
declare
  seller uuid := gen_random_uuid();
  buyer uuid := gen_random_uuid();
  o uuid;
begin
  insert into auth.users(id, email) values
    (seller, 'w18-lock-seller@example.test'), (buyer, 'w18-lock-buyer@example.test');

  insert into public.orders(buyer_id, seller_id, status, subtotal_cents, platform_fee_cents,
    total_cents, currency, delivered_at)
  values (buyer, seller, 'delivered', 10000, 1000, 10000, 'USD', now() - interval '3 days')
  returning id into o;
  insert into public.payments(order_id, provider, provider_reference, status, amount_cents, currency)
  values (o, 'stripe', 'pi_w18_lock_delivered', 'succeeded', 10000, 'USD');
  insert into public.transfer_intents(order_id, seller_id, amount_cents, currency, status, available_at)
  values (o, seller, 9000, 'USD', 'cancelled', now() - interval '1 day');
  insert into pg_temp.w18_fx values ('delivered', o);

  insert into public.orders(buyer_id, seller_id, status, pre_dispute_status, subtotal_cents,
    platform_fee_cents, total_cents, currency, delivered_at, disputed_at, dispute_category, dispute_reason)
  values (buyer, seller, 'disputed', 'delivered', 10000, 1000, 10000, 'USD', now() - interval '3 days',
    now(), 'item_not_as_described', 'Not the part in the photos')
  returning id into o;
  insert into public.payments(order_id, provider, provider_reference, status, amount_cents, currency)
  values (o, 'stripe', 'pi_w18_lock_inapp', 'succeeded', 10000, 'USD');
  insert into public.transfer_intents(order_id, seller_id, amount_cents, currency, status, available_at)
  values (o, seller, 9000, 'USD', 'cancelled', now() - interval '1 day');
  insert into pg_temp.w18_fx values ('inapp', o);
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

-- The other session opens a transaction and takes p_order's payout as its
-- own worker, ready to dispatch.
create function pg_temp.remote_claim(p_ext text, p_conn text, p_order uuid, p_timeout text) returns void language plpgsql as $$
begin
  execute format('select %I.dblink_exec(%L, %L)', p_ext, p_conn,
    format('begin; set local lock_timeout = %L', p_timeout));
  execute format('select %I.dblink_exec(%L, %L)', p_ext, p_conn, format(
    'update public.transfer_intents set status = %L, locked_by = %L, locked_at = now(), '
    'lease_expires_at = now() + interval ''5 minutes'' where order_id = %L',
    'processing', 'w18-probe', p_order));
end $$;

create function pg_temp.dispatch_sql(p_order uuid) returns text language sql as $$
  select format('select public.prepare_transfer_dispatch(%L, %L, %L, 9000, %L, %L, %L, %L)::text',
    p_order, 'w18-probe', 'transfer:' || p_order::text, 'usd', 'acct_w18_probe', 'ch_w18_probe', 'pi_w18_probe');
$$;

-- A dispatch in the other session, start to finish, rolled back.
create function pg_temp.dispatch_probe(p_ext text, p_conn text, p_order uuid) returns text language plpgsql as $$
declare
  v_out text;
begin
  perform pg_temp.remote_claim(p_ext, p_conn, p_order, '2s');
  begin
    execute format('select r from %I.dblink(%L, %L) as t(r text)', p_ext, p_conn, pg_temp.dispatch_sql(p_order)) into v_out;
    v_out := 'ran: ' || coalesce(v_out, 'null');
  exception when others then
    v_out := sqlerrm;
  end;
  execute format('select %I.dblink_exec(%L, %L)', p_ext, p_conn, 'rollback');
  return v_out;
end $$;

-- 1. Lock order, read from the definitions.
do $$
declare
  prepare_def text := pg_get_functiondef('public.prepare_transfer_dispatch(uuid,text,text,integer,text,text,text,text)'::regprocedure);
  hold_def text := pg_get_functiondef('public.hold_stripe_dispute(text,text)'::regprocedure);
  apply_def text := pg_get_functiondef('public.apply_stripe_dispute_event(text,text,integer,text,text,boolean,text,bigint,uuid)'::regprocedure);
  lock_at int := position('from public.orders where id = p_order for update' in prepare_def);
begin
  if lock_at = 0 or position('for key share' in prepare_def) > 0
     or lock_at > position('order_has_unresolved_chargeback' in prepare_def) then
    raise exception 'FAIL 1: dispatch does not lock the order before it reads the journal';
  end if;
  if position('from public.orders where id=any(entry.order_ids) order by id for update' in hold_def) = 0
     or position('from public.orders where id=any(entry.order_ids) order by id for update' in hold_def)
        > position('update public.stripe_dispute_journal' in hold_def) then
    raise exception 'FAIL 1b: hold_stripe_dispute changes the journal before it locks every order of the basket';
  end if;
  if position('from public.orders where id=any(ids) order by id for update' in apply_def) = 0
     or position('from public.orders where id=any(ids) order by id for update' in apply_def)
        > position('insert into public.stripe_dispute_journal' in apply_def)
     or position('from public.orders where id=any(ids) order by id for update' in apply_def)
        > position('public.hold_stripe_dispute(p_dispute,''The dispute does not exactly match' in apply_def) then
    raise exception 'FAIL 1c: apply_stripe_dispute_event writes the journal before it locks the orders';
  end if;
  raise notice 'PASS 1: dispatch and both admission paths lock the order before the journal';
end $$;

-- 2. Two sessions. Runs outside an explicit transaction block, so it can
--    commit the admission while the other session's dispatch waits. A
--    failed check is held until the committed rows are cleaned up.
do $$
declare
  -- dblink is created here only if it wasn't installed, and dropped again
  -- below: this block commits, and a dblink left in public would trip
  -- definer_exposure_guard and function_search_path_guard.
  had_dblink boolean := exists (select 1 from pg_extension where extname = 'dblink');
  ext text := pg_temp.connect('w18lock');
  remote_pid int;
  v_k text;
  o uuid;
  probe text;
  waited boolean;
  busy int;
  answer text;
  v_fail text;
  checks int := 0;
begin
  if ext is null then
    if not had_dblink then drop extension if exists dblink; end if;
    raise notice 'two-session checks skipped';
    return;
  end if;
  execute format('select r from %I.dblink(%L, %L) as t(r int)', ext, 'w18lock', 'select pg_backend_pid()') into remote_pid;

  -- 2a. Controls.
  foreach v_k in array array['delivered', 'inapp'] loop
    o := (select id from pg_temp.w18_fx f where f.k = v_k);
    probe := pg_temp.dispatch_probe(ext, 'w18lock', o);
    if probe <> 'ran: true' then
      v_fail := format('FAIL 2a control (%s): the remote dispatch did not reach the lock path (%s)', v_k, probe);
      exit;
    end if;
    checks := checks + 1;
  end loop;

  -- 2b. Admission commits while the dispatch waits.
  if v_fail is null then
    foreach v_k in array array['delivered', 'inapp'] loop
      o := (select id from pg_temp.w18_fx f where f.k = v_k);
      if public.apply_stripe_dispute_event('dp_w18_lock_' || v_k, 'pi_w18_lock_' || v_k, 4000, 'usd',
           'needs_response', false, 'evt_w18_lock_' || v_k, 100, gen_random_uuid()) <> 'recovery_recorded' then
        v_fail := format('Fixture 2b (%s): the partial chargeback did not go to recovery', v_k);
        exit;
      end if;
      if v_k = 'inapp' and (select stripe_dispute_id from public.orders where id = o) is not null then
        v_fail := 'Fixture 2b: the hold changed the in-app-disputed order (it must not)';
        exit;
      end if;
      perform pg_temp.remote_claim(ext, 'w18lock', o, '20s');
      execute format('select %I.dblink_send_query(%L, %L)', ext, 'w18lock', pg_temp.dispatch_sql(o));
      -- Wait (up to 5s) until the other session is blocked on a lock, or done.
      waited := false;
      for i in 1..100 loop
        if exists (select 1 from pg_stat_activity where pid = remote_pid and wait_event_type = 'Lock') then
          waited := true;
          exit;
        end if;
        execute format('select %I.dblink_is_busy(%L)', ext, 'w18lock') into busy;
        exit when busy = 0;
        perform pg_sleep(0.05);
      end loop;
      -- The chargeback is admitted for good while the dispatch waits.
      commit;
      execute format('select r from %I.dblink_get_result(%L) as t(r text)', ext, 'w18lock') into answer;
      -- The empty result that ends the async query.
      execute format('select count(*) from %I.dblink_get_result(%L) as t(r text)', ext, 'w18lock');
      execute format('select %I.dblink_exec(%L, %L)', ext, 'w18lock', 'rollback');
      if not waited then
        v_fail := format('FAIL 2b (%s): a dispatch did not wait for a chargeback admission in progress (it returned %s)', v_k, answer);
        exit;
      end if;
      if answer is distinct from 'false' then
        v_fail := format('FAIL 2b (%s): the waiting dispatch prepared (%s) although the chargeback committed first', v_k, answer);
        exit;
      end if;
      checks := checks + 2;
    end loop;
  end if;

  execute format('select %I.dblink_disconnect(%L)', ext, 'w18lock');
  if not had_dblink then drop extension dblink; end if;
  if v_fail is not null then
    perform pg_temp.w18_cleanup();
    commit;
    raise exception '%', v_fail;
  end if;
  raise notice 'PASS 2: % two-session checks (controls; a dispatch waits for a committing chargeback admission and then refuses, for a delivered and an already-disputed order)', checks;
end $$;

-- Remove everything the checks committed.
select pg_temp.w18_cleanup();
do $$ begin raise notice 'all chargeback dispatch lock checks passed'; end $$;
