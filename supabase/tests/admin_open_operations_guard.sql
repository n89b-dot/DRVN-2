-- N718 (20261110210000, work review #155): the console's open operations
-- come from one query. An open request is found however many closed ones
-- are newer; a completed or reconciled one is never listed; an escalated one
-- stays open and carries its later phase and its newest audit id; only the
-- service role may ask.
begin;

do $$
declare
  actor uuid := gen_random_uuid();
  old_open uuid := gen_random_uuid();
  escalated uuid := gen_random_uuid();
  done uuid := gen_random_uuid();
  reconciled uuid := gen_random_uuid();
  newest uuid := gen_random_uuid();
  old_open_row bigint;
  escalated_row bigint;
  escalated_later bigint;
  ops jsonb;
  ids text[];
  o jsonb;
begin
  insert into auth.users(id, email) values (actor, 'open-ops-admin@example.test');
  insert into auth.mfa_factors(id, user_id, friendly_name, factor_type, status, created_at, updated_at) values (gen_random_uuid(), actor, 'guard', 'totp', 'verified', now(), now());
  insert into public.admin_users(user_id, role, note, mfa_factor_id) select f.user_id, 'admin', 'guard', f.id from auth.mfa_factors f where f.user_id = actor;

  -- Nothing of this guard's is open yet; what the database already holds is left out of every check below.
  -- An old open request, then 450 newer operations that were each closed.
  insert into public.admin_audit_log(actor_id, action, subject_type, subject_id, reason, metadata)
  values (actor, 'order.force_refund', 'order', gen_random_uuid(), 'Guard: old and open', jsonb_build_object('operationId', old_open::text, 'phase', 'requested'))
  returning id into old_open_row;

  insert into public.admin_audit_log(actor_id, action, subject_type, subject_id, reason, metadata)
  select actor, 'order.force_refund', 'order', gen_random_uuid(), 'Guard: closed ' || g, jsonb_build_object('operationId', md5('open-ops-guard-' || g), 'phase', p.phase)
  from generate_series(1, 450) g cross join (values ('requested'), ('completed')) p(phase)
  order by g, p.phase desc;

  -- An escalated one (outcome unknown: still open), a completed one, a reconciled one.
  insert into public.admin_audit_log(actor_id, action, subject_type, subject_id, reason, metadata)
  values (actor, 'payout.transfer', 'order', gen_random_uuid(), 'Guard: escalated', jsonb_build_object('operationId', escalated::text, 'phase', 'requested'))
  returning id into escalated_row;
  insert into public.admin_audit_log(actor_id, action, subject_type, subject_id, reason, metadata)
  values (actor, 'payout.transfer', 'order', gen_random_uuid(), 'Guard: escalated', jsonb_build_object('operationId', escalated::text, 'phase', 'failed_or_requires_reconciliation')),
         (actor, 'payout.transfer', 'order', gen_random_uuid(), 'Guard: escalated', jsonb_build_object('operationId', escalated::text, 'phase', 'escalated'));
  select max(id) into escalated_later from public.admin_audit_log where metadata->>'operationId' = escalated::text;
  insert into public.admin_audit_log(actor_id, action, subject_type, subject_id, reason, metadata) values
    (actor, 'order.force_refund', 'order', gen_random_uuid(), 'Guard: done', jsonb_build_object('operationId', done::text, 'phase', 'requested')),
    (actor, 'order.force_refund', 'order', gen_random_uuid(), 'Guard: done', jsonb_build_object('operationId', done::text, 'phase', 'completed')),
    (actor, 'order.force_refund', 'order', gen_random_uuid(), 'Guard: reconciled', jsonb_build_object('operationId', reconciled::text, 'phase', 'requested')),
    (actor, 'order.force_refund', 'order', gen_random_uuid(), 'Guard: reconciled', jsonb_build_object('operationId', reconciled::text, 'phase', 'reconciled')),
    -- A request that names no operation is not one.
    (actor, 'order.force_refund', 'order', gen_random_uuid(), 'Guard: no operation', jsonb_build_object('phase', 'requested')),
    (actor, 'order.force_refund', 'order', gen_random_uuid(), 'Guard: newest', jsonb_build_object('operationId', newest::text, 'phase', 'requested'));

  ops := public.admin_open_operations(200);
  select array_agg(e->>'operation_id' order by (e->>'id')::bigint desc) into ids
  from jsonb_array_elements(ops) e where e->>'reason' like 'Guard:%';

  -- 1. Exactly the three open ones, newest first; the old one is found behind 450 closed operations (900 rows).
  if ids is distinct from array[newest::text, escalated::text, old_open::text] then
    raise exception 'FAIL 1: open operations are % (N718)', ids;
  end if;

  -- 2. Only the request: no later phases, and its version is its own row.
  select e into o from jsonb_array_elements(ops) e where e->>'operation_id' = old_open::text;
  if (o->>'seen_through')::bigint <> old_open_row or jsonb_array_length(o->'phases') <> 0 or o->>'action' <> 'order.force_refund' or o->>'reason' <> 'Guard: old and open' then
    raise exception 'FAIL 2: the old open request reads % (N718)', o;
  end if;

  -- 3. Escalated: still open, with both later phases and the newest audit id.
  select e into o from jsonb_array_elements(ops) e where e->>'operation_id' = escalated::text;
  if (o->>'id')::bigint <> escalated_row or (o->>'seen_through')::bigint <> escalated_later
     or not (o->'phases' ? 'escalated' and o->'phases' ? 'failed_or_requires_reconciliation') or jsonb_array_length(o->'phases') <> 2 then
    raise exception 'FAIL 3: the escalated operation reads % (N718)', o;
  end if;

  -- 4. The limit is the newest N, and is clamped to 1..200.
  ops := public.admin_open_operations(1);
  if jsonb_array_length(ops) <> 1 or ops->0->>'operation_id' <> newest::text then
    raise exception 'FAIL 4: a limit of 1 gave % (N718)', ops;
  end if;
  if jsonb_array_length(public.admin_open_operations(0)) <> 1 or jsonb_array_length(public.admin_open_operations(null)) < 3 then
    raise exception 'FAIL 4: the limit is not clamped (N718)';
  end if;

  -- 5. Closing one takes it off the list.
  insert into public.admin_audit_log(actor_id, action, subject_type, subject_id, reason, metadata)
  values (actor, 'order.force_refund', 'order', gen_random_uuid(), 'Guard: old and open', jsonb_build_object('operationId', old_open::text, 'phase', 'reconciled'));
  if exists (select 1 from jsonb_array_elements(public.admin_open_operations(200)) e where e->>'operation_id' = old_open::text) then
    raise exception 'FAIL 5: a reconciled operation is still listed (N718)';
  end if;

  -- 6. Service role only.
  if has_function_privilege('anon', 'public.admin_open_operations(integer)', 'execute')
     or has_function_privilege('authenticated', 'public.admin_open_operations(integer)', 'execute')
     or not has_function_privilege('service_role', 'public.admin_open_operations(integer)', 'execute') then
    raise exception 'FAIL 6: admin_open_operations has the wrong callers (N718)';
  end if;

  raise notice 'all admin open operations checks passed';
end $$;

rollback;
