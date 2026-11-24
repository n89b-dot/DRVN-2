-- 20261124180000_refund_and_checkout_lock_order.sql. Disposable database only.
--
-- A refund function locks the order before the refund operation, and a
-- checkout locks its parts in id order. Two ways of holding that:
--
--   1. From the definitions: in each of the three refund functions the
--      order's lock comes before the operation's; purchase_begin locks in id
--      order and creates no temporary table.
--   2. With dblink (shipped in the supabase/postgres image; the pattern of
--      chargeback_dispatch_lock_guard.sql): three sessions.
--        - One holds a row. A second calls the function under test and has
--          to wait for that row. This session then asks what the waiting
--          call already holds.
--        - Refunds: the holder has the order; the waiting call must NOT yet
--          hold the refund operation (it took the order's lock first).
--        - Checkout: the holder has the part with the higher id; the waiting
--          checkout must already hold the lower one. Then the holder has the
--          lower one; the waiting checkout must not hold the higher one.
--
-- The other sessions only see committed rows, so the fixtures are committed
-- and removed at the end, and at the start in case an earlier run stopped
-- before its cleanup. Every call under test runs in a transaction the guard
-- rolls back.

create function pg_temp.lo_cleanup() returns void language plpgsql as $$
declare
  v_users uuid[] := array(select id from auth.users where email in
    ('lock-order-seller@example.test', 'lock-order-buyer@example.test'));
  v_orders uuid[] := array(select id from public.orders where seller_id = any(v_users) or buyer_id = any(v_users));
begin
  delete from public.refund_operations where order_id = any(v_orders);
  delete from public.payments where order_id = any(v_orders);
  delete from public.order_items where order_id = any(v_orders);
  delete from public.orders where id = any(v_orders);
  delete from public.listings where seller_id = any(v_users);
  delete from auth.users where id = any(v_users);
  if exists (select 1 from auth.users where id = any(v_users))
     or exists (select 1 from public.refund_operations where idempotency_key like 'refund:lock-order-guard:%') then
    raise exception 'Cleanup: the committed fixtures were not removed';
  end if;
end $$;

select pg_temp.lo_cleanup();

-- Fixtures, committed. The refund operation is 'completed', so each refund
-- function, once it has its locks, finds nothing to do.
create table pg_temp.lo_fx (k text primary key, id uuid not null);
do $$
declare
  seller uuid := gen_random_uuid();
  buyer uuid := gen_random_uuid();
  o uuid;
  op uuid;
  a uuid;
  b uuid;
begin
  insert into auth.users(id, email) values
    (seller, 'lock-order-seller@example.test'), (buyer, 'lock-order-buyer@example.test');
  insert into public.orders(buyer_id, seller_id, status, subtotal_cents, platform_fee_cents, total_cents, currency)
  values (buyer, seller, 'refunded', 5000, 500, 5000, 'USD')
  returning id into o;
  insert into public.refund_operations(order_id, amount_cents, currency, remaining_before_cents, reason,
    requested_by, actor_role, idempotency_key, refund_reference, reversal_due_cents, status, provider_status)
  values (o, 2500, 'USD', 5000, 'guard', 'system', 'system', 'refund:lock-order-guard:' || o::text,
    're_lock_order_guard', 0, 'completed', 'succeeded')
  returning id into op;
  insert into public.listings(seller_id, title, category, price_cents, shipping_cents, status, currency)
  values (seller, 'Lock order guard part one', 'brakes-suspension', 50000, 1500, 'active', 'USD')
  returning id into a;
  insert into public.listings(seller_id, title, category, price_cents, shipping_cents, status, currency)
  values (seller, 'Lock order guard part two', 'brakes-suspension', 60000, 1500, 'active', 'USD')
  returning id into b;
  insert into pg_temp.lo_fx values
    ('order', o), ('op', op), ('buyer', buyer),
    ('lo', least(a, b)), ('hi', greatest(a, b));
end $$;

-- Another session on this database, or null when dblink can't give one.
create function pg_temp.lo_connect(p_name text) returns text language plpgsql as $$
declare
  v_ext text;
begin
  if not exists (select 1 from pg_extension where extname = 'dblink') then
    if not exists (select 1 from pg_available_extensions where name = 'dblink') then
      return null;
    end if;
    create extension dblink;
  end if;
  select n.nspname into v_ext from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'dblink';
  execute format('select %I.dblink_connect(%L, %L)', v_ext, p_name,
    format('host=127.0.0.1 port=%s dbname=%s user=%s password=postgres', current_setting('port'), current_database(), current_user));
  return v_ext;
end $$;

-- One probe. The holder session locks p_held; the runner session calls
-- p_run and must wait for it; this session then reports whether p_asked is
-- locked ('locked') or not ('free') while the runner waits. Both other
-- sessions are rolled back.
create function pg_temp.lo_probe(p_ext text, p_held_table text, p_held uuid, p_run text, p_asked_table text, p_asked uuid)
returns text language plpgsql as $$
declare
  v_runner_pid int;
  v_waited boolean := false;
  v_busy int;
  v_state text;
begin
  execute format('select r from %I.dblink(%L, %L) as t(r int)', p_ext, 'lo_run', 'select pg_backend_pid()') into v_runner_pid;
  execute format('select %I.dblink_exec(%L, %L)', p_ext, 'lo_hold', 'begin');
  execute format('select count(*) from %I.dblink(%L, %L) as t(r int)', p_ext, 'lo_hold',
    format('select 1 from public.%I where id = %L for update', p_held_table, p_held));
  execute format('select %I.dblink_exec(%L, %L)', p_ext, 'lo_run', 'begin; set local lock_timeout = ''20s''');
  execute format('select %I.dblink_send_query(%L, %L)', p_ext, 'lo_run', p_run);
  -- Wait (up to 5s) until the runner is blocked on a lock, or done.
  for i in 1..100 loop
    if exists (select 1 from pg_stat_activity where pid = v_runner_pid and wait_event_type = 'Lock') then
      v_waited := true;
      exit;
    end if;
    execute format('select %I.dblink_is_busy(%L)', p_ext, 'lo_run') into v_busy;
    exit when v_busy = 0;
    perform pg_sleep(0.05);
  end loop;
  -- What the waiting call holds. The lock this takes is given back at once:
  -- the block is left by an exception either way.
  begin
    execute format('select 1 from public.%I where id = %L for update nowait', p_asked_table, p_asked);
    raise exception 'lo-probe-free';
  exception
    when lock_not_available then v_state := 'locked';
    when others then
      if sqlerrm <> 'lo-probe-free' then raise; end if;
      v_state := 'free';
  end;
  execute format('select %I.dblink_exec(%L, %L)', p_ext, 'lo_hold', 'rollback');
  -- The runner's answer (or its error) is read and thrown away, then undone.
  begin
    execute format('select count(*) from %I.dblink_get_result(%L, false) as t(r text)', p_ext, 'lo_run');
    execute format('select count(*) from %I.dblink_get_result(%L, false) as t(r text)', p_ext, 'lo_run');
  exception when others then null;
  end;
  execute format('select %I.dblink_exec(%L, %L, false)', p_ext, 'lo_run', 'rollback');
  if not v_waited then return 'did not wait'; end if;
  return v_state;
end $$;

grant execute on all routines in schema pg_temp to public;

-- 1. Lock order, read from the definitions.
do $$
declare
  settle_def text := pg_get_functiondef('public.settle_refund_operation(uuid)'::regprocedure);
  hold_def text := pg_get_functiondef('public.hold_refund_reversal(uuid,text,text,text,timestamptz)'::regprocedure);
  event_def text := pg_get_functiondef('public.record_refund_provider_event(text,text,uuid,uuid,text,integer,text,text,timestamptz,text,text,text,text)'::regprocedure);
  begin_def text := pg_get_functiondef('public.purchase_begin(uuid,uuid[],text,interval,jsonb,text,jsonb)'::regprocedure);
  order_lock constant text := 'from public.orders where id = v_lock_order for update';
  d text;
  n int := 0;
begin
  foreach d in array array[settle_def, hold_def, event_def] loop
    n := n + 1;
    if position(order_lock in d) = 0 then
      raise exception 'FAIL 1.%: the order is not locked first', n;
    end if;
    -- No lock on a refund operation before the order's.
    if substring(d from 1 for position(order_lock in d)) ~* 'refund_operations[^;]*for update' then
      raise exception 'FAIL 1.%: a refund operation is locked before its order', n;
    end if;
  end loop;
  if begin_def ~* 'temp(orary)? table' then
    raise exception 'FAIL 1.4: purchase_begin creates a temporary table again';
  end if;
  if begin_def !~* 'order by l\.id\s+for update' then
    raise exception 'FAIL 1.5: purchase_begin does not lock its parts in id order';
  end if;
  raise notice 'PASS 1: three refund functions lock the order first; checkout locks parts in id order and creates no temporary table';
end $$;

-- 2. Three sessions. Runs outside a transaction block: the fixtures above
--    are committed, and a failed check is held until they are removed.
do $$
declare
  had_dblink boolean := exists (select 1 from pg_extension where extname = 'dblink');
  ext text := pg_temp.lo_connect('lo_hold');
  o uuid := (select id from pg_temp.lo_fx where k = 'order');
  op uuid := (select id from pg_temp.lo_fx where k = 'op');
  buyer uuid := (select id from pg_temp.lo_fx where k = 'buyer');
  lo uuid := (select id from pg_temp.lo_fx where k = 'lo');
  hi uuid := (select id from pg_temp.lo_fx where k = 'hi');
  got text;
  v_fail text;
  v_begin text;
begin
  if ext is null then
    perform pg_temp.lo_cleanup();
    raise exception 'FAIL 2: dblink is not available, so the three-session checks cannot run';
  end if;
  perform pg_temp.lo_connect('lo_run');

  got := pg_temp.lo_probe(ext, 'orders', o,
    format('select public.settle_refund_operation(%L)::text', op), 'refund_operations', op);
  if got <> 'free' then v_fail := format('FAIL 2a: settle_refund_operation waiting for its order: the refund operation is "%s", expected "free"', got); end if;

  if v_fail is null then
    got := pg_temp.lo_probe(ext, 'orders', o,
      format('select public.hold_refund_reversal(%L, %L, %L, %L, now())::text', op, 'lock-order-guard', 'reversal:' || op::text, 'guard'),
      'refund_operations', op);
    if got <> 'free' then v_fail := format('FAIL 2b: hold_refund_reversal waiting for its order: the refund operation is "%s", expected "free"', got); end if;
  end if;

  if v_fail is null then
    got := pg_temp.lo_probe(ext, 'orders', o,
      format('select public.record_refund_provider_event(%L, %L, %L, %L, %L, 2500, %L, %L, now())::text',
        'evt_lock_order_guard', 're_lock_order_guard', op, o, 'pi_lock_order_guard', 'usd', 'succeeded'),
      'refund_operations', op);
    if got <> 'free' then v_fail := format('FAIL 2c: record_refund_provider_event waiting for its order: the refund operation is "%s", expected "free"', got); end if;
  end if;

  -- The basket names the higher id first: the order asked for is not the order locked.
  v_begin := format('select public.purchase_begin(%L, array[%L, %L]::uuid[])::text', buyer, hi, lo);
  if v_fail is null then
    got := pg_temp.lo_probe(ext, 'listings', hi, v_begin, 'listings', lo);
    if got <> 'locked' then v_fail := format('FAIL 2d: a checkout waiting for its higher part: the lower part is "%s", expected "locked"', got); end if;
  end if;
  if v_fail is null then
    got := pg_temp.lo_probe(ext, 'listings', lo, v_begin, 'listings', hi);
    if got <> 'free' then v_fail := format('FAIL 2e: a checkout waiting for its lower part: the higher part is "%s", expected "free"', got); end if;
  end if;

  execute format('select %I.dblink_disconnect(%L)', ext, 'lo_hold');
  execute format('select %I.dblink_disconnect(%L)', ext, 'lo_run');
  if not had_dblink then drop extension dblink; end if;
  -- Nothing a rolled-back call did may remain.
  if v_fail is null and (
       exists (select 1 from public.listings where id in (lo, hi) and status <> 'active')
    or exists (select 1 from public.refund_operations where id = op and status <> 'completed')
    or exists (select 1 from public.refund_provider_events where event_id = 'evt_lock_order_guard')) then
    v_fail := 'FAIL 2f: a probe left a change behind';
  end if;
  perform pg_temp.lo_cleanup();
  if v_fail is not null then raise exception '%', v_fail; end if;
  raise notice 'PASS 2: five three-session checks (a settlement, a reversal hold and a Stripe refund event wait for the order without holding the refund operation; a checkout holds its lower part while it waits for the higher, and not the higher while it waits for the lower)';
end $$;

do $$ begin raise notice 'all lock order checks passed'; end $$;
