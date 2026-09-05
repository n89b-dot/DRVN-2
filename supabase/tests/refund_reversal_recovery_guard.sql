-- R03 reversal-dispatch durability guard. Disposable database only; rollback
-- retains no fixtures or state.
begin;

do $$
declare
  v_seller uuid := gen_random_uuid();
  v_buyer uuid := gen_random_uuid();
  v_order uuid;
  v_operation uuid;
  v_recovery uuid;
  v_result text;
  v_count int;
begin
  insert into auth.users (id, email) values
    (v_seller, 'reversal-recovery-seller@example.test'),
    (v_buyer, 'reversal-recovery-buyer@example.test');
  update public.profiles set display_name = 'Reversal Seller', username = 'reversal_guard_seller'
    where id = v_seller;
  update public.profiles set display_name = 'Reversal Buyer', username = 'reversal_guard_buyer'
    where id = v_buyer;

  insert into public.orders (
    buyer_id, seller_id, status, subtotal_cents, platform_fee_cents,
    total_cents, currency, transfer_reference
  ) values (
    v_buyer, v_seller, 'refunded', 5000, 500, 5000, 'USD', 'tr_guard_original'
  ) returning id into v_order;
  insert into public.refund_operations (
    order_id, amount_cents, currency, remaining_before_cents, reason,
    requested_by, actor_role, idempotency_key, refund_reference,
    reversal_due_cents, status, provider_status
  ) values (
    v_order, 2500, 'USD', 5000, 'guard', 'system', 'system',
    'refund:guard:' || v_order::text, 're_guard', 2250,
    'reversal_pending', 'succeeded'
  ) returning id into v_operation;

  v_result := public.claim_refund_reversal(
    v_operation, 'owner-a', 'tr_guard_original', 2250, 'USD',
    'reversal:' || v_operation::text, 300
  );
  if v_result <> 'claimed' or not exists (
    select 1 from public.refund_operations
    where id = v_operation
      and reversal_operation_key = 'reversal:' || v_operation::text
      and reversal_transfer_reference = 'tr_guard_original'
      and reversal_amount_cents = 2250
      and reversal_currency = 'usd'
      and reversal_call_may_have_occurred
      and reversal_locked_by = 'owner-a'
  ) then
    raise exception 'FAIL 1: exact immutable intent was not claimed';
  end if;
  raise notice 'PASS 1/8: exact immutable intent is persisted before dispatch';

  v_result := public.claim_refund_reversal(
    v_operation, 'owner-b', 'tr_guard_original', 2250, 'usd',
    'reversal:' || v_operation::text, 300
  );
  if v_result <> 'busy' then raise exception 'FAIL 2: concurrent claim returned %', v_result; end if;
  raise notice 'PASS 2/8: concurrent worker cannot own a live reversal lease';

  v_result := public.claim_refund_reversal(
    v_operation, 'owner-a', 'tr_guard_original', 2249, 'usd',
    'reversal:' || v_operation::text, 300
  );
  if v_result <> 'conflict' then raise exception 'FAIL 3: changed amount returned %', v_result; end if;
  raise notice 'PASS 3/8: frozen provider parameters cannot change';

  update public.refund_operations
  set reversal_lease_expires_at = now() - interval '1 second'
  where id = v_operation;
  v_result := public.claim_refund_reversal(
    v_operation, 'owner-b', 'tr_guard_original', 2250, 'usd',
    'reversal:' || v_operation::text, 300
  );
  if v_result <> 'claimed' then raise exception 'FAIL 4: expired claim returned %', v_result; end if;
  raise notice 'PASS 4/8: expired lease is reclaimed with original parameters';

  v_result := public.complete_refund_reversal(
    v_operation, 'owner-a', 'reversal:' || v_operation::text,
    'tr_guard_original', 2250, 'usd', 'trr_stale'
  );
  if v_result <> 'lost' then raise exception 'FAIL 5: stale completion returned %', v_result; end if;
  raise notice 'PASS 5/8: stale worker cannot complete';

  v_recovery := public.hold_refund_reversal(
    v_operation, 'owner-b', 'reversal:' || v_operation::text,
    'provider outcome unknown', now() + interval '2 minutes'
  );
  if v_recovery is null or not exists (
    select 1 from public.refund_operations
    where id = v_operation and recovery_id = v_recovery and status = 'reversal_pending'
      and reversal_call_may_have_occurred and reversal_locked_by is null and attempts = 1
  ) then
    raise exception 'FAIL 6: unknown outcome was not durably held';
  end if;
  select count(*) into v_count from public.payment_recoveries
    where recovery_key = 'reversal-failed:' || v_operation::text and status = 'open';
  if v_count <> 1 then raise exception 'FAIL 6: recovery count is %', v_count; end if;
  select count(*) into v_count from public.admin_alert_outbox
    where dedup_key = 'reversal-failed:' || v_operation::text;
  if v_count <> 1 then raise exception 'FAIL 6: alert count is %', v_count; end if;
  raise notice 'PASS 6/8: unknown outcome creates one durable recovery and alert';

  update public.refund_operations set next_attempt_at = now() where id = v_operation;
  v_result := public.claim_refund_reversal(
    v_operation, 'owner-c', 'tr_guard_original', 2250, 'usd',
    'reversal:' || v_operation::text, 300
  );
  v_recovery := public.hold_refund_reversal(
    v_operation, 'owner-c', 'reversal:' || v_operation::text,
    'provider outcome remains unknown', now() + interval '4 minutes'
  );
  select count(*) into v_count from public.payment_recoveries
    where recovery_key = 'reversal-failed:' || v_operation::text;
  if v_count <> 1 then raise exception 'FAIL 7: replay produced % recoveries', v_count; end if;
  select count(*) into v_count from public.admin_alert_outbox
    where dedup_key = 'reversal-failed:' || v_operation::text;
  if v_count <> 1 then raise exception 'FAIL 7: replay produced % alerts', v_count; end if;
  raise notice 'PASS 7/8: replay retains one recovery and one alert';

  update public.refund_operations set next_attempt_at = now() where id = v_operation;
  v_result := public.claim_refund_reversal(
    v_operation, 'owner-d', 'tr_guard_original', 2250, 'usd',
    'reversal:' || v_operation::text, 300
  );
  v_result := public.complete_refund_reversal(
    v_operation, 'owner-d', 'reversal:' || v_operation::text,
    'tr_guard_original', 2250, 'usd', 'trr_recovered'
  );
  if v_result <> 'completed' or not exists (
    select 1 from public.refund_operations
    where id = v_operation and status = 'completed'
      and reversal_reference = 'trr_recovered' and reversal_locked_by is null
  ) or not exists (
    select 1 from public.payment_recoveries
    where id = v_recovery and status = 'recovered' and resolved_at is not null
  ) then
    raise exception 'FAIL 8: exact recovered reversal did not complete atomically';
  end if;
  raise notice 'PASS 8/8: exact recovery completes and resolves its obligation atomically';

  raise notice '--- all refund-reversal recovery checks passed ---';
end $$;

rollback;
