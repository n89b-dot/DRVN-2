-- Async refund durability: pending identity, crash replay, terminal settlement,
-- late provider failure compensation, exact seller obligation, and immutable
-- event history. Run only against the disposable test database.
begin;

do $$
declare
  seller_id uuid := gen_random_uuid();
  buyer_id uuid := gen_random_uuid();
  v_order uuid;
  v_paid_order uuid;
  v_operation uuid;
  v_paid_operation uuid;
  result jsonb;
  settled jsonb;
  n int;
  state text;
begin
  insert into auth.users(id,email) values
    (seller_id,'refund-life-seller@example.test'),
    (buyer_id,'refund-life-buyer@example.test');
  update public.profiles set display_name='Refund Life Seller',username='refund_life_seller'
    where id=seller_id;
  update public.profiles set display_name='Refund Life Buyer',username='refund_life_buyer'
    where id=buyer_id;

  insert into public.orders(
    buyer_id,seller_id,status,subtotal_cents,platform_fee_cents,total_cents,currency
  ) values (buyer_id,seller_id,'paid',10000,1000,10000,'USD') returning id into v_order;
  insert into public.payments(
    order_id,provider,provider_reference,status,amount_cents,currency
  ) values (v_order,'stripe','pi_refund_life','succeeded',10000,'USD');

  result := public.record_refund_provider_event(
    'evt_refund_pending','re_refund_life',null,v_order,'pi_refund_life',
    4000,'usd','pending','2026-09-05T12:00:00Z',null,null,null,'processing'
  );
  v_operation := (result->>'operation_id')::uuid;
  if result->>'action' <> 'pending' or v_operation is null then
    raise exception 'FAIL 1: pending refund did not create a durable operation: %',result;
  end if;
  if not exists(select 1 from public.refund_operations where id=v_operation
    and status='provider_pending' and provider_status='pending'
    and refund_reference='re_refund_life') then
    raise exception 'FAIL 2: pending identity/provider status was not retained';
  end if;
  if exists(select 1 from public.orders where id=v_order and refunded_cents<>0)
     or exists(select 1 from public.payments where order_id=v_order and refunded_cents<>0) then
    raise exception 'FAIL 3: pending refund changed settled counters';
  end if;

  result := public.record_refund_provider_event(
    'evt_refund_succeeded','re_refund_life',v_operation,v_order,'pi_refund_life',
    4000,'usd','succeeded','2026-09-05T12:05:00Z','txn_refund_life'
  );
  if result->>'action'<>'settle' then
    raise exception 'FAIL 4: pending -> succeeded did not request settlement: %',result;
  end if;
  -- Crash window: the event transaction committed but the caller died before
  -- settle_refund_operation. Replaying the identical event must still settle.
  result := public.record_refund_provider_event(
    'evt_refund_succeeded','re_refund_life',v_operation,v_order,'pi_refund_life',
    4000,'usd','succeeded','2026-09-05T12:05:00Z','txn_refund_life'
  );
  if result->>'action'<>'settle' then
    raise exception 'FAIL 5: succeeded event replay after crash lost settlement work: %',result;
  end if;
  settled := public.settle_refund_operation(v_operation);
  if not coalesce((settled->>'ok')::boolean,false) then
    raise exception 'FAIL 6: succeeded provider refund could not settle: %',settled;
  end if;
  if not exists(select 1 from public.orders where id=v_order
      and refunded_cents=4000 and platform_fee_refunded_cents=400)
     or not exists(select 1 from public.payments where order_id=v_order
      and refunded_cents=4000 and status='partially_refunded') then
    raise exception 'FAIL 7: succeeded refund ledger values are wrong';
  end if;

  result := public.record_refund_provider_event(
    'evt_refund_stale_pending','re_refund_life',v_operation,v_order,'pi_refund_life',
    4000,'usd','pending','2026-09-05T12:01:00Z',null,null,null,'processing'
  );
  if result->>'action'<>'committed' or not exists(
    select 1 from public.refund_operations where id=v_operation and provider_status='succeeded'
  ) then raise exception 'FAIL 8: older pending callback regressed provider success: %',result; end if;

  result := public.record_refund_provider_event(
    'evt_refund_failed','re_refund_life',v_operation,v_order,'pi_refund_life',
    4000,'usd','failed','2026-09-05T12:10:00Z','txn_refund_life','txn_restore_life',
    'insufficient_funds'
  );
  if result->>'action'<>'recovery_recorded' or (result->>'compensated')::boolean is not true then
    raise exception 'FAIL 9: late failure was not atomically compensated: %',result;
  end if;
  if not exists(select 1 from public.orders where id=v_order
      and refunded_cents=0 and platform_fee_refunded_cents=0)
     or not exists(select 1 from public.payments where order_id=v_order
      and refunded_cents=0 and status='succeeded') then
    raise exception 'FAIL 10: late failure did not restore exact ledger counters';
  end if;
  if not exists(select 1 from public.refund_operations where id=v_operation
      and status='recovery_required' and provider_status='failed'
      and provider_failure_balance_transaction='txn_restore_life')
     or not exists(select 1 from public.payment_recoveries where order_id=v_order
      and kind='refund_late_failure' and recovery_key='refund-late-failure:re_refund_life') then
    raise exception 'FAIL 11: late failure evidence/recovery is incomplete';
  end if;

  result := public.record_refund_provider_event(
    'evt_refund_failed','re_refund_life',v_operation,v_order,'pi_refund_life',
    4000,'usd','failed','2026-09-05T12:10:00Z','txn_refund_life','txn_restore_life',
    'insufficient_funds'
  );
  select count(*) into n from public.refund_lifecycle_adjustments
    where refund_operation_id=v_operation;
  if n<>1 or exists(select 1 from public.orders where id=v_order and refunded_cents<>0) then
    raise exception 'FAIL 12: failed event replay double-compensated the ledger';
  end if;

  -- A refund whose seller transfer was already reversed has an exact re-credit
  -- obligation. The adjustment and recovery retain it; automation stops.
  insert into public.orders(
    buyer_id,seller_id,status,subtotal_cents,platform_fee_cents,total_cents,currency,
    transfer_reference
  ) values (buyer_id,seller_id,'paid',10000,1000,10000,'USD','tr_refund_life')
    returning id into v_paid_order;
  insert into public.payments(
    order_id,provider,provider_reference,status,amount_cents,currency
  ) values (v_paid_order,'stripe','pi_refund_paid','succeeded',10000,'USD');
  result := public.record_refund_provider_event(
    'evt_paid_success','re_refund_paid',null,v_paid_order,'pi_refund_paid',
    3000,'usd','succeeded','2026-09-05T13:00:00Z','txn_refund_paid'
  );
  v_paid_operation := (result->>'operation_id')::uuid;
  settled := public.settle_refund_operation(v_paid_operation);
  if settled->>'status'<>'reversal_pending' or (settled->>'reversal_due_cents')::int<>2700 then
    raise exception 'FAIL 13: seller reversal obligation was not frozen exactly: %',settled;
  end if;
  update public.refund_operations set status='completed',reversal_reference='trr_refund_paid',
    reversal_completed_at=now() where id=v_paid_operation;
  result := public.record_refund_provider_event(
    'evt_paid_failed','re_refund_paid',v_paid_operation,v_paid_order,'pi_refund_paid',
    3000,'usd','failed','2026-09-05T13:10:00Z','txn_refund_paid','txn_restore_paid',
    'insufficient_funds'
  );
  if (result->>'seller_recredit_cents')::int<>2700 or not exists(
    select 1 from public.refund_lifecycle_adjustments where refund_operation_id=v_paid_operation
      and refund_amount_cents=3000 and fee_restore_cents=300 and seller_recredit_cents=2700
  ) then raise exception 'FAIL 14: exact seller re-credit was not recorded: %',result; end if;

  begin
    update public.refund_provider_events set failure_reason='tampered'
      where event_id='evt_refund_failed';
    raise exception 'FAIL 15: provider event history was mutable';
  exception when raise_exception then
    if sqlerrm='FAIL 15: provider event history was mutable' then raise; end if;
  end;
  select status into state from public.refund_operations where id=v_paid_operation;
  if state<>'recovery_required' then
    raise exception 'FAIL 16: late failure left automated reversal/refund work runnable: %',state;
  end if;

  raise notice 'All 16 refund lifecycle checks passed';
end $$;

rollback;
