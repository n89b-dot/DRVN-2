-- Architecture remediation plan 2, item A2, second of two (20261111120000):
-- the database refuses any change of an order's status that
-- private.order_status_transitions does not hold, for every role.
--
--   1. The judge over all 10 x 10 pairs, the expectation read from the table,
--      plus the case rules: entering a case records the old status; leaving
--      it goes back there (paid or delivered when none was recorded) or to
--      refunded; while in a case, what it returns to moves only along the
--      table. Every legal move names functions that exist and name its
--      status. No scheduled job sets the override.
--   2. The trigger, for the server key, as the first write of its
--      transaction: a legal move goes through, an illegal one is refused.
--      An INSERT in any state is not judged.
--   3. A member, through a security-definer function, as the first write of
--      its transaction: the same.
--   4. The owner roles are judged too; under the override, with a reason, an
--      illegal move is made and audited; a blank reason is refused.
--   5. The server key with the override set is refused, directly and through
--      a security-definer function (session_user authenticator).
--   6. The migration runner's role (postgres, in a postgres session) may use
--      it, and is audited.
-- Disposable database only; every transaction rolls back.

-- ==========================================================
-- 1. The judge, and the table's own promises
-- ==========================================================
begin;
do $$
declare
  statuses text[] := array['pending', 'requires_action', 'payment_failed', 'paid', 'shipped', 'delivered', 'completed', 'cancelled', 'refunded', 'disputed'];
  s_from text;
  s_to text;
  old_pre text;
  new_pre text;
  expected boolean;
  allowed boolean;
  checked int := 0;
  legal int := 0;
  bad text;
begin
  foreach s_from in array statuses loop
    foreach s_to in array statuses loop
      continue when s_from = s_to;
      -- A case's status before it is the status it goes back to; entering one records the old status.
      old_pre := case when s_from = 'disputed' then case when s_to in ('paid', 'shipped', 'delivered', 'completed') then s_to else 'paid' end end;
      new_pre := case when s_to = 'disputed' then s_from else old_pre end;
      expected := exists (select 1 from private.order_status_transitions where from_status = s_from and to_status = s_to);
      allowed := public.order_status_change_problem(s_from, s_to, old_pre, new_pre) is null;
      if allowed is distinct from expected then
        raise exception 'FAIL 1a: % -> % is % by the judge but % in the table', s_from, s_to,
          case when allowed then 'allowed' else 'refused' end, case when expected then 'listed' else 'not listed' end;
      end if;
      checked := checked + 1;
      if expected then legal := legal + 1; end if;
    end loop;
    -- No change of status is not judged by the table.
    if public.order_status_change_problem(s_from, s_from, null, null) is not null then
      raise exception 'FAIL 1a: an unchanged % order was refused', s_from;
    end if;
  end loop;
  if checked <> 90 or legal <> 25 then
    raise exception 'FAIL 1a: % pairs checked, % legal (expected 90 and 25)', checked, legal;
  end if;

  -- Leaving a case.
  if public.order_status_change_problem('disputed', 'shipped', 'delivered', 'delivered') is null then
    raise exception 'FAIL 1b: a case on a delivered order closed to shipped';
  end if;
  if public.order_status_change_problem('disputed', 'refunded', 'delivered', 'delivered') is not null then
    raise exception 'FAIL 1b: a case could not end in a full refund';
  end if;
  if public.order_status_change_problem('disputed', 'paid', null, null) is not null
     or public.order_status_change_problem('disputed', 'delivered', null, null) is not null then
    raise exception 'FAIL 1b: a case with nothing recorded could not close to paid or delivered';
  end if;
  if public.order_status_change_problem('disputed', 'shipped', null, null) is null then
    raise exception 'FAIL 1b: a case with nothing recorded closed to shipped';
  end if;
  -- Entering a case.
  if public.order_status_change_problem('paid', 'disputed', null, null) is null
     or public.order_status_change_problem('paid', 'disputed', null, 'shipped') is null then
    raise exception 'FAIL 1c: an order entered a case without recording paid as its status before it';
  end if;
  -- While in a case.
  if public.order_status_change_problem('disputed', 'disputed', 'paid', 'shipped') is not null
     or public.order_status_change_problem('disputed', 'disputed', 'shipped', 'delivered') is not null
     or public.order_status_change_problem('disputed', 'disputed', 'paid', 'delivered') is not null then
    raise exception 'FAIL 1d: dispatch, delivery or a pickup during a case was refused';
  end if;
  if public.order_status_change_problem('disputed', 'disputed', 'shipped', 'paid') is null
     or public.order_status_change_problem('disputed', 'disputed', 'paid', 'refunded') is null
     or public.order_status_change_problem('disputed', 'disputed', null, 'paid') is null
     or public.order_status_change_problem('disputed', 'disputed', 'paid', null) is null then
    raise exception 'FAIL 1d: what a case returns to moved off the table';
  end if;

  -- Every legal move names the functions that make it, and each names that status.
  select string_agg(format('%s -> %s: %s', t.from_status, t.to_status, o.owner), '; ') into bad
    from private.order_status_transitions t,
         lateral unnest(string_to_array(t.owners, ',')) as u(raw),
         lateral (select btrim(u.raw) as owner) o
   where not exists (
     select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = o.owner
        and (case when t.from_status = 'disputed' and t.to_status <> 'refunded'
                  then p.prosrc ~ 'pre_dispute_status'
                  else p.prosrc ~ ('''' || t.to_status || '''') end));
  if bad is not null then
    raise exception 'FAIL 1e: a legal move names no function that makes it: %', bad;
  end if;

  -- Scheduled jobs run with session_user postgres, so they could use the
  -- override. Every job's command calls a function, and a function called by
  -- a job runs with both roles postgres: so no function but the guard itself
  -- may mention the setting, and no job's command either.
  select string_agg(n.nspname || '.' || p.proname, ', ') into bad
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'private')
     and p.prosrc ilike '%order_status_override%'
     and not (n.nspname = 'public' and p.proname = 'guard_order_status');
  if bad is not null then
    raise exception 'FAIL 1f: functions mention drvn.order_status_override: %', bad;
  end if;
  select string_agg(jobname, ', ') into bad from cron.job where command ilike '%order_status_override%';
  if bad is not null then
    raise exception 'FAIL 1f: scheduled jobs set drvn.order_status_override: %', bad;
  end if;

  raise notice 'PASS 1: the judge agrees with the table on all 90 changes (25 legal), the case rules hold, every move names its functions, no function or job but the guard mentions the override';
end $$;
rollback;

-- ==========================================================
-- 2. The server key, first write of its transaction
-- ==========================================================
begin;
create temp table a2_ids(name text primary key, id uuid) on commit drop;
grant all on a2_ids to public;
do $$
declare buyer uuid := gen_random_uuid(); seller uuid := gen_random_uuid();
begin
  insert into auth.users(id, email) values (buyer, 'a2-guard-buyer@drvn.test'), (seller, 'a2-guard-seller@drvn.test');
  insert into a2_ids values ('buyer', buyer), ('seller', seller);
  with o as (
    insert into public.orders(buyer_id, seller_id, status, subtotal_cents, platform_fee_cents, total_cents, currency)
    values (buyer, seller, 'paid', 10000, 1000, 10000, 'USD') returning id)
  insert into a2_ids select 'order', id from o;
  -- An INSERT in any state is not judged (fixtures and the checkout make orders in their first state).
  with o as (
    insert into public.orders(buyer_id, seller_id, status, subtotal_cents, platform_fee_cents, total_cents, currency)
    values (buyer, seller, 'disputed', 10000, 1000, 10000, 'USD') returning id)
  insert into a2_ids select 'disputed', id from o;
end $$;
set local role service_role;
do $$
declare o uuid := (select id from a2_ids where name = 'order'); refused boolean := false; state text;
begin
  update public.orders set status = 'shipped', shipped_at = now() where id = o;
  begin
    update public.orders set status = 'paid' where id = o;
  exception when check_violation then
    refused := sqlerrm like '%guard_order_status%';
  end;
  select status into state from public.orders where id = o;
  if not refused or state <> 'shipped' then
    raise exception 'FAIL 2: the server key moved a shipped order back to paid (now %)', state;
  end if;
  raise notice 'PASS 2: the server key, first write of its transaction: paid -> shipped allowed, shipped -> paid refused; an insert in any state is not judged';
end $$;
rollback;

-- ==========================================================
-- 3. A member, through a security-definer function, first write
-- ==========================================================
begin;
create temp table a2_ids(name text primary key, id uuid) on commit drop;
grant all on a2_ids to public;
create function public._a2_guard_member_move(p_order uuid, p_status text) returns void
language sql security definer set search_path = '' as $$
  update public.orders set status = p_status,
         pre_dispute_status = case when p_status = 'disputed' then status else pre_dispute_status end
   where id = p_order
$$;
grant execute on function public._a2_guard_member_move(uuid, text) to authenticated;
do $$
declare buyer uuid := gen_random_uuid(); seller uuid := gen_random_uuid();
begin
  insert into auth.users(id, email) values (buyer, 'a2-guard-buyer@drvn.test'), (seller, 'a2-guard-seller@drvn.test');
  insert into a2_ids values ('buyer', buyer);
  with o as (
    insert into public.orders(buyer_id, seller_id, status, subtotal_cents, platform_fee_cents, total_cents, currency)
    values (buyer, seller, 'delivered', 10000, 1000, 10000, 'USD') returning id)
  insert into a2_ids select 'order', id from o;
end $$;
select set_config('request.jwt.claims', json_build_object('sub', (select id from a2_ids where name = 'buyer'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare o uuid := (select id from a2_ids where name = 'order'); refused boolean := false; state text; before text;
begin
  perform public._a2_guard_member_move(o, 'disputed');
  begin
    perform public._a2_guard_member_move(o, 'shipped');
  exception when check_violation then
    refused := sqlerrm like '%guard_order_status%';
  end;
  select status, pre_dispute_status into state, before from public.orders where id = o;
  if not refused or state <> 'disputed' or before <> 'delivered' then
    raise exception 'FAIL 3: a member''s function moved the order wrongly (now %, before the case %)', state, before;
  end if;
  raise notice 'PASS 3: a member through a security-definer function, first write of its transaction: delivered -> disputed allowed, a case on a delivered order closing to shipped refused';
end $$;
rollback;

-- ==========================================================
-- 4. The owner roles are judged; the override, with a reason
-- ==========================================================
begin;
do $$
declare buyer uuid := gen_random_uuid(); seller uuid := gen_random_uuid(); o uuid; refused boolean := false; audit private.order_status_overrides;
begin
  insert into auth.users(id, email) values (buyer, 'a2-guard-buyer@drvn.test'), (seller, 'a2-guard-seller@drvn.test');
  insert into public.orders(buyer_id, seller_id, status, subtotal_cents, platform_fee_cents, total_cents, currency)
  values (buyer, seller, 'delivered', 10000, 1000, 10000, 'USD') returning id into o;

  begin
    update public.orders set status = 'paid' where id = o;
  exception when check_violation then
    refused := sqlerrm like '%guard_order_status%';
  end;
  if not refused then raise exception 'FAIL 4a: supabase_admin moved a delivered order to paid without the override'; end if;

  refused := false;
  perform set_config('drvn.order_status_override', '   ', true);
  begin
    update public.orders set status = 'paid' where id = o;
  exception when check_violation then
    refused := sqlerrm like '%needs a reason%';
  end;
  if not refused then raise exception 'FAIL 4b: the override was honoured with a blank reason'; end if;

  perform set_config('drvn.order_status_override', 'guard: a repair agreed in writing', true);
  update public.orders set status = 'paid' where id = o;
  perform set_config('drvn.order_status_override', '', true);
  select * into audit from private.order_status_overrides where order_id = o;
  if audit.id is null or audit.old_status <> 'delivered' or audit.new_status <> 'paid'
     or audit.reason <> 'guard: a repair agreed in writing'
     or audit.current_role_name <> 'supabase_admin' or audit.session_role_name <> 'supabase_admin' or audit.at is null then
    raise exception 'FAIL 4c: the override''s change was not audited as made (%)', row_to_json(audit);
  end if;

  refused := false;
  begin
    update public.orders set status = 'delivered' where id = o;
    update public.orders set status = 'cancelled' where id = o;
  exception when check_violation then
    refused := true;
  end;
  if not refused then raise exception 'FAIL 4d: the override outlived its reset'; end if;
  raise notice 'PASS 4: the owner role is judged; the override needs a reason, moves the order, and is audited with both roles';
end $$;
rollback;

-- ==========================================================
-- 5. The server key may not use the override
-- ==========================================================
begin;
create temp table a2_ids(name text primary key, id uuid) on commit drop;
grant all on a2_ids to public;
do $$
declare buyer uuid := gen_random_uuid(); seller uuid := gen_random_uuid();
begin
  insert into auth.users(id, email) values (buyer, 'a2-guard-buyer@drvn.test'), (seller, 'a2-guard-seller@drvn.test');
  with o as (
    insert into public.orders(buyer_id, seller_id, status, subtotal_cents, platform_fee_cents, total_cents, currency)
    values (buyer, seller, 'delivered', 10000, 1000, 10000, 'USD') returning id)
  insert into a2_ids select 'order', id from o;
end $$;
set local role service_role;
do $$
declare o uuid := (select id from a2_ids where name = 'order'); refused boolean := false;
begin
  perform set_config('drvn.order_status_override', 'the server key trying', true);
  begin
    update public.orders set status = 'paid' where id = o;
  exception when insufficient_privilege then
    refused := sqlerrm like '%refused for service_role%';
  end;
  if not refused then raise exception 'FAIL 5a: the server key used the override directly'; end if;
  raise notice 'PASS 5a: the server key setting the override itself is refused';
end $$;
rollback;

begin;
create temp table a2_ids(name text primary key, id uuid) on commit drop;
grant all on a2_ids to public;
-- A security-definer function, owned by the role that builds the database, that tries the override.
create function public._a2_guard_override_move(p_order uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform set_config('drvn.order_status_override', 'a function trying', true);
  update public.orders set status = 'paid' where id = p_order;
end $$;
grant execute on function public._a2_guard_override_move(uuid) to service_role;
do $$
declare buyer uuid := gen_random_uuid(); seller uuid := gen_random_uuid();
begin
  insert into auth.users(id, email) values (buyer, 'a2-guard-buyer@drvn.test'), (seller, 'a2-guard-seller@drvn.test');
  with o as (
    insert into public.orders(buyer_id, seller_id, status, subtotal_cents, platform_fee_cents, total_cents, currency)
    values (buyer, seller, 'delivered', 10000, 1000, 10000, 'USD') returning id)
  insert into a2_ids select 'order', id from o;
end $$;
-- The way the server key arrives: PostgREST logs in as authenticator and becomes service_role.
set local session authorization authenticator;
set local role service_role;
do $$
declare o uuid := (select id from a2_ids where name = 'order'); refused boolean := false; who text;
begin
  begin
    perform public._a2_guard_override_move(o);
  exception when insufficient_privilege then
    refused := true;
    who := sqlerrm;
  end;
  if not refused or who not like '%in a session of authenticator%' then
    raise exception 'FAIL 5b: the server key used the override through a security-definer function (%)', who;
  end if;
  raise notice 'PASS 5b: the server key through a security-definer function (current_user its owner, session_user authenticator) is refused';
end $$;
rollback;

-- ==========================================================
-- 6. The migration runner's role may use it, and is audited
-- ==========================================================
begin;
create temp table a2_ids(name text primary key, id uuid) on commit drop;
grant all on a2_ids to public;
-- Hosted and on a local stack, postgres applies the migrations and so owns
-- the audit table. Here supabase_admin built the database; give postgres what
-- it has there.
grant insert, select on private.order_status_overrides to postgres;
do $$
declare buyer uuid := gen_random_uuid(); seller uuid := gen_random_uuid();
begin
  insert into auth.users(id, email) values (buyer, 'a2-guard-buyer@drvn.test'), (seller, 'a2-guard-seller@drvn.test');
  with o as (
    insert into public.orders(buyer_id, seller_id, status, subtotal_cents, platform_fee_cents, total_cents, currency)
    values (buyer, seller, 'delivered', 10000, 1000, 10000, 'USD') returning id)
  insert into a2_ids select 'order', id from o;
end $$;
set local session authorization postgres;
set local drvn.order_status_override = 'a migration repairing an order';
do $$
declare o uuid := (select id from a2_ids where name = 'order'); audit private.order_status_overrides; state text;
begin
  update public.orders set status = 'paid' where id = o;
  select status into state from public.orders where id = o;
  select * into audit from private.order_status_overrides where order_id = o;
  if state <> 'paid' or audit.id is null or audit.reason <> 'a migration repairing an order'
     or audit.current_role_name <> 'postgres' or audit.session_role_name <> 'postgres' then
    raise exception 'FAIL 6: a migration run as postgres could not use the override, or was not audited (status %, %)', state, row_to_json(audit);
  end if;
  raise notice 'PASS 6: the migration runner (postgres in a postgres session) uses the override with a reason, audited';
end $$;
rollback;

do $$ begin raise notice 'all order status guard checks passed'; end $$;
