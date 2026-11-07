-- R2-02: reconciling a stuck admin operation is one authorized, checked
-- transition. It follows the durable refund records, admits one terminal
-- answer, keeps "unknown" blocked, and never stands in for a step-up.
begin;

do $$
declare
  actor uuid := gen_random_uuid();
  viewer uuid := gen_random_uuid();
  buyer uuid := gen_random_uuid();
  seller uuid := gen_random_uuid();
  ord uuid := gen_random_uuid();
  fresh_ord uuid := gen_random_uuid();
  old_ord uuid := gen_random_uuid();
  old_op uuid := gen_random_uuid();
  op jsonb;
  op_id uuid;
  seen bigint;
  result jsonb;
  refund uuid := gen_random_uuid();
  rejected boolean := false;
  stepped_up jsonb;
begin
  insert into auth.users(id, email) values
    (actor, 'reconcile-admin@example.test'), (viewer, 'reconcile-viewer@example.test'),
    (buyer, 'reconcile-buyer@example.test'), (seller, 'reconcile-seller@example.test');
  -- Confirmed authenticators (20261107200500): without one no admin privilege.
  insert into auth.mfa_factors(id, user_id, friendly_name, factor_type, status, created_at, updated_at) values (gen_random_uuid(), actor, 'guard', 'totp', 'verified', now(), now());
  insert into auth.mfa_factors(id, user_id, friendly_name, factor_type, status, created_at, updated_at) values (gen_random_uuid(), viewer, 'guard', 'totp', 'verified', now(), now());
  insert into public.admin_users(user_id, role, note, mfa_factor_id)
  select f.user_id, case when f.user_id = actor then 'admin' else 'viewer' end, 'guard', f.id
  from auth.mfa_factors f where f.user_id in (actor, viewer);
  insert into public.orders(id, buyer_id, seller_id, status, subtotal_cents, shipping_cents, platform_fee_cents, total_cents, currency)
  values (ord, buyer, seller, 'paid', 5000, 0, 500, 5000, 'USD'),
         (fresh_ord, buyer, seller, 'paid', 5000, 0, 500, 5000, 'USD'),
         (old_ord, buyer, seller, 'paid', 5000, 0, 500, 5000, 'USD');

  -- A refund request from an hour ago whose answer never came back.
  op := public.begin_admin_external_operation(actor, 'order.force_refund', 'order', ord::text, ord, 'Guard refund', '{}');
  op_id := (op->>'operationId')::uuid;
  select max(id) into seen from public.admin_audit_log where metadata->>'operationId' = op_id::text;

  stepped_up := jsonb_build_object('sub', actor, 'role', 'authenticated', 'aal', 'aal2',
    'amr', jsonb_build_array(jsonb_build_object('method', 'totp', 'timestamp', extract(epoch from now()))));

  -- 1. No step-up, no reconciliation — even for a full admin.
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', actor, 'role', 'authenticated')::text, true);
  begin
    perform public.reconcile_admin_external_operation(op_id, seen, 'not_applied', 'checked');
  exception when insufficient_privilege then rejected := true; end;
  if not rejected then raise exception 'Reconciliation ran without a step-up'; end if;
  rejected := false;

  -- 2. A viewer can't reconcile, step-up or not.
  perform set_config('request.jwt.claims', (stepped_up || jsonb_build_object('sub', viewer))::text, true);
  begin
    perform public.reconcile_admin_external_operation(op_id, seen, 'not_applied', 'checked');
  exception when insufficient_privilege then rejected := true; end;
  if not rejected then raise exception 'A viewer reconciled an operation'; end if;
  rejected := false;

  perform set_config('request.jwt.claims', stepped_up::text, true);

  -- 3. Within the in-flight lease, "not applied" is refused: the provider
  --    call may still be running.
  begin
    perform public.reconcile_admin_external_operation(op_id, seen, 'not_applied', 'checked');
  exception when object_not_in_prerequisite_state then rejected := true; end;
  if not rejected then raise exception 'A fresh operation was closed as not applied'; end if;
  rejected := false;

  -- 4. "Unknown" is recorded but doesn't release the fence.
  result := public.reconcile_admin_external_operation(op_id, seen, 'unknown', 'Stripe search inconclusive');
  if result->>'status' <> 'escalated' then raise exception 'Unknown was not escalated: %', result; end if;
  perform set_config('role', 'postgres', true);
  if not (public.begin_admin_external_operation(actor, 'order.force_refund', 'order', ord::text, ord, 'Retry', '{}')->>'reused')::boolean then
    raise exception 'An unknown outcome released the operation fence';
  end if;
  perform set_config('role', 'authenticated', true);

  -- 5. The operator's view is now stale (the escalation is newer).
  begin
    perform public.reconcile_admin_external_operation(op_id, seen, 'applied', 'checked');
  exception when serialization_failure then rejected := true; end;
  if not rejected then raise exception 'A stale view recorded an outcome'; end if;
  rejected := false;
  select max(id) into seen from public.admin_audit_log where metadata->>'operationId' = op_id::text;

  -- 6. A refund from this request is still at the provider: neither answer
  --    can close it.
  perform set_config('role', 'postgres', true);
  insert into public.refund_operations(id, order_id, amount_cents, currency, remaining_before_cents, reason,
    requested_by, actor_role, idempotency_key, status)
  values (refund, ord, 5000, 'USD', 5000, 'Admin refund: guard', 'admin:' || actor, 'admin', 'guard-' || refund, 'provider_pending');
  perform set_config('role', 'authenticated', true);
  begin
    perform public.reconcile_admin_external_operation(op_id, seen, 'applied', 'checked');
  exception when object_not_in_prerequisite_state then rejected := true; end;
  if not rejected then raise exception 'An in-flight refund was closed as applied'; end if;
  rejected := false;

  -- 7. The refund completes. "Not applied" now contradicts the records.
  perform set_config('role', 'postgres', true);
  update public.refund_operations set status = 'completed', refund_reference = 're_guard', provider_status = 'succeeded',
    effects_completed_at = now(), provider_completed_at = now() where id = refund;
  perform set_config('role', 'authenticated', true);
  begin
    perform public.reconcile_admin_external_operation(op_id, seen, 'not_applied', 'checked');
  exception when object_not_in_prerequisite_state then rejected := true; end;
  if not rejected then raise exception 'Not-applied was recorded over a completed refund'; end if;
  rejected := false;

  -- 8. "Applied" commits once, with the refund as evidence; the identical
  --    answer replays; the opposite answer can't follow it.
  result := public.reconcile_admin_external_operation(op_id, seen, 'applied', 'Refund re_guard completed');
  if result->>'status' <> 'resolved' or result->'evidence'->>'source' <> 'refund_operations' then
    raise exception 'Applied was not recorded with refund evidence: %', result;
  end if;
  result := public.reconcile_admin_external_operation(op_id, seen, 'applied', 'Refund re_guard completed');
  if not (result->>'replayed')::boolean then raise exception 'Identical answer did not replay: %', result; end if;
  result := public.reconcile_admin_external_operation(op_id, seen, 'not_applied', 'Second opinion');
  if result->>'status' <> 'already_resolved' then raise exception 'A second terminal answer was accepted: %', result; end if;
  if (select count(*) from public.admin_audit_log where metadata->>'operationId' = op_id::text
        and metadata->>'phase' in ('completed', 'reconciled')) <> 1 then
    raise exception 'Operation has more than one terminal record';
  end if;

  -- 9. No second terminal record can be written by any path, including the
  --    service role's completion writer.
  perform set_config('role', 'postgres', true);
  begin
    insert into public.admin_audit_log(actor_id, action, subject_type, subject_id, order_id, reason, metadata)
    values (actor, 'order.force_refund', 'order', ord, ord, 'late completion',
      jsonb_build_object('operationId', op_id::text, 'phase', 'completed'));
  exception when unique_violation then rejected := true; end;
  if not rejected then raise exception 'A completion was recorded over a reconciliation'; end if;
  rejected := false;

  -- The fence is released now that the outcome is authoritative.
  if (public.begin_admin_external_operation(actor, 'order.force_refund', 'order', ord::text, ord, 'Next', '{}')->>'reused')::boolean then
    raise exception 'A resolved operation still blocks its subject';
  end if;

  -- 10. With no refund recorded, "applied" can't be claimed.
  op := public.begin_admin_external_operation(actor, 'order.force_refund', 'order', fresh_ord::text, fresh_ord, 'Guard 2', '{}');
  select max(id) into seen from public.admin_audit_log where metadata->>'operationId' = op->>'operationId';
  perform set_config('role', 'authenticated', true);
  begin
    perform public.reconcile_admin_external_operation((op->>'operationId')::uuid, seen, 'applied', 'checked');
  exception when object_not_in_prerequisite_state then rejected := true; end;
  if not rejected then raise exception 'Applied was recorded with no refund on file'; end if;

  -- 11. Past the lease, with no refund ever reserved, "not applied" is
  --     provable from the records and lifts the block.
  perform set_config('role', 'postgres', true);
  insert into public.admin_audit_log(actor_id, action, subject_type, subject_id, order_id, reason, metadata, created_at)
  values (actor, 'order.force_refund', 'order', old_ord, old_ord, 'Old refund',
    jsonb_build_object('operationId', old_op::text, 'phase', 'requested'), now() - interval '1 hour');
  select max(id) into seen from public.admin_audit_log where metadata->>'operationId' = old_op::text;
  perform set_config('role', 'authenticated', true);
  result := public.reconcile_admin_external_operation(old_op, seen, 'not_applied', 'No refund reserved');
  if result->>'status' <> 'resolved' or result->'evidence'->'operations' <> '[]'::jsonb then
    raise exception 'Provable not-applied was refused: %', result;
  end if;
  perform set_config('role', 'postgres', true);
  if (public.begin_admin_external_operation(actor, 'order.force_refund', 'order', old_ord::text, old_ord, 'Again', '{}')->>'reused')::boolean then
    raise exception 'A not-applied operation still blocks its subject';
  end if;

  perform set_config('role', 'none', true);
  if has_function_privilege('anon', 'public.reconcile_admin_external_operation(uuid,bigint,text,text)', 'execute') then
    raise exception 'Anonymous callers can reconcile';
  end if;
  raise notice 'all admin operation reconciliation checks passed';
end $$;

rollback;
