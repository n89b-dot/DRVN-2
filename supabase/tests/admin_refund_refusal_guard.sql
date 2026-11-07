-- N134 (20261107200510): a refused admin refund closes its request only when
-- the refund records prove nothing was refunded or is still on its way. A
-- refund still running, completed, or one Stripe created keeps the fence
-- closed for the operator's reconciliation, as an unknown outcome always did.
begin;

do $$
declare
  actor uuid := gen_random_uuid();
  other uuid := gen_random_uuid();
  buyer uuid := gen_random_uuid();
  seller uuid := gen_random_uuid();
  plain_ord uuid := gen_random_uuid();
  running_ord uuid := gen_random_uuid();
  declined_ord uuid := gen_random_uuid();
  created_ord uuid := gen_random_uuid();
  op jsonb;
  result jsonb;
  rejected boolean := false;
begin
  insert into auth.users(id, email) values
    (actor, 'refusal-admin@example.test'), (other, 'refusal-other@example.test'),
    (buyer, 'refusal-buyer@example.test'), (seller, 'refusal-seller@example.test');
  insert into public.admin_users(user_id, role, note) values (actor, 'admin', 'guard'), (other, 'admin', 'guard');
  insert into public.orders(id, buyer_id, seller_id, status, subtotal_cents, shipping_cents, platform_fee_cents, total_cents, currency)
  select o, buyer, seller, 'paid', 5000, 0, 500, 5000, 'USD'
  from unnest(array[plain_ord, running_ord, declined_ord, created_ord]) o;

  -- 1. Refused before anything was reserved ("nothing left to refund"):
  --    the request closes as not applied and the next one is admitted.
  op := public.begin_admin_external_operation(actor, 'order.force_refund', 'order', plain_ord::text, plain_ord, 'Guard refund', '{}');
  result := public.release_refused_admin_refund(actor, (op->>'operationId')::uuid, 'Nothing left to refund on this order.');
  if not (result->>'released')::boolean then raise exception 'FAIL 1: a refusal with no refund on file kept the lock: %', result; end if;
  if (select metadata->>'outcome' from public.admin_audit_log
      where metadata->>'operationId' = op->>'operationId' and metadata->>'phase' = 'reconciled') <> 'not_applied' then
    raise exception 'FAIL 2: the refusal was not recorded as not applied';
  end if;
  if (public.begin_admin_external_operation(actor, 'order.force_refund', 'order', plain_ord::text, plain_ord, 'Corrected retry', '{}')->>'reused')::boolean then
    raise exception 'FAIL 3: refunds stayed locked after a proven refusal';
  end if;
  -- Releasing again is a no-op: one terminal record per operation.
  result := public.release_refused_admin_refund(actor, (op->>'operationId')::uuid, 'again');
  if result->>'status' <> 'already_resolved' then raise exception 'FAIL 4: a second release was accepted: %', result; end if;

  -- 2. A refund from this request is still at the provider: the app may think
  --    it was refused, the records say otherwise, so the fence holds.
  op := public.begin_admin_external_operation(actor, 'order.force_refund', 'order', running_ord::text, running_ord, 'Guard refund', '{}');
  insert into public.refund_operations(order_id, amount_cents, currency, remaining_before_cents, reason,
    requested_by, actor_role, idempotency_key, status)
  values (running_ord, 5000, 'USD', 5000, 'Admin refund: guard', 'admin:' || actor, 'admin', 'guard-running-' || running_ord, 'provider_pending');
  result := public.release_refused_admin_refund(actor, (op->>'operationId')::uuid, 'claimed refusal');
  if (result->>'released')::boolean or result->>'status' <> 'refund_on_file' then
    raise exception 'FAIL 5: a running refund was closed as refused: %', result;
  end if;
  if not (public.begin_admin_external_operation(actor, 'order.force_refund', 'order', running_ord::text, running_ord, 'Retry', '{}')->>'reused')::boolean then
    raise exception 'FAIL 6: a second refund was admitted while one is running';
  end if;

  -- 3. Stripe declined to create the refund (failed, no provider refund id).
  op := public.begin_admin_external_operation(actor, 'order.force_refund', 'order', declined_ord::text, declined_ord, 'Guard refund', '{}');
  insert into public.refund_operations(order_id, amount_cents, currency, remaining_before_cents, reason,
    requested_by, actor_role, idempotency_key, status)
  values (declined_ord, 5000, 'USD', 5000, 'Admin refund: guard', 'admin:' || actor, 'admin', 'guard-declined-' || declined_ord, 'failed');
  result := public.release_refused_admin_refund(actor, (op->>'operationId')::uuid, 'The provider refused the refund.');
  if not (result->>'released')::boolean then raise exception 'FAIL 7: a provider decline kept the lock: %', result; end if;

  -- 4. A refund Stripe created and later failed: something existed at the
  --    provider, so a person reconciles it.
  op := public.begin_admin_external_operation(actor, 'order.force_refund', 'order', created_ord::text, created_ord, 'Guard refund', '{}');
  insert into public.refund_operations(order_id, amount_cents, currency, remaining_before_cents, reason,
    requested_by, actor_role, idempotency_key, status, refund_reference)
  values (created_ord, 5000, 'USD', 5000, 'Admin refund: guard', 'admin:' || actor, 'admin', 'guard-created-' || created_ord, 'failed', 're_guard_created');
  result := public.release_refused_admin_refund(actor, (op->>'operationId')::uuid, 'claimed refusal');
  if (result->>'released')::boolean then raise exception 'FAIL 8: a refund that existed at Stripe was closed as refused'; end if;

  -- 5. Only the admin who made the request, only for refunds, only the
  --    service role.
  begin
    perform public.release_refused_admin_refund(other, (op->>'operationId')::uuid, 'not mine');
  exception when no_data_found then rejected := true; end;
  if not rejected then raise exception 'FAIL 9: another admin released someone else''s request'; end if;
  rejected := false;
  op := public.begin_admin_external_operation(actor, 'listing.guard_external', 'listing', plain_ord::text, null, 'Guard', '{}');
  begin
    perform public.release_refused_admin_refund(actor, (op->>'operationId')::uuid, 'not a refund');
  exception when no_data_found then rejected := true; end;
  if not rejected then raise exception 'FAIL 10: a non-refund operation was released'; end if;
  rejected := false;
  begin
    perform public.release_refused_admin_refund(buyer, (op->>'operationId')::uuid, 'not an admin');
  exception when insufficient_privilege then rejected := true; end;
  if not rejected then raise exception 'FAIL 11: a non-admin released a request'; end if;
  if has_function_privilege('authenticated', 'public.release_refused_admin_refund(uuid,uuid,text)', 'execute')
     or has_function_privilege('anon', 'public.release_refused_admin_refund(uuid,uuid,text)', 'execute') then
    raise exception 'FAIL 12: a client role can release a refund request';
  end if;

  raise notice 'all admin refund refusal checks passed';
end $$;

rollback;
