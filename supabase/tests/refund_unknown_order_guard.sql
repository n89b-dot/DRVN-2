-- A refund whose metadata names an order this database does not hold is
-- recorded for review instead of failing on the orders foreign key
-- (20261010100000). The reported id is kept; nothing is attributed to it.
begin;

do $$
declare
  seller uuid := gen_random_uuid();
  buyer uuid := gen_random_uuid();
  foreign_order uuid := gen_random_uuid();
  foreign_op uuid := gen_random_uuid();
  o uuid;
  r jsonb;
begin
  -- 1. Unknown operation and unknown order: the other environment's refund.
  r := public.record_refund_provider_event(
    p_event_id => 'evt_unknown_order_1', p_refund_reference => 're_unknown_order_1',
    p_operation_id => foreign_op, p_order_id => foreign_order,
    p_payment_reference => 'pi_unknown_order_1', p_amount_cents => 2500, p_currency => 'usd',
    p_provider_status => 'succeeded', p_provider_created_at => now());
  if r->>'action' <> 'recovery_recorded' or r->>'reason' <> 'unknown_operation' then
    raise exception 'FAIL 1: a refund for an unknown order was not sent to recovery: %', r;
  end if;
  if not exists (
       select 1 from public.refund_provider_events
       where event_id = 'evt_unknown_order_1' and order_id is null
         and reported_order_id = foreign_order and reported_operation_id = foreign_op)
     or not exists (
       select 1 from public.payment_recoveries
       where recovery_key = 'refund-lifecycle:re_unknown_order_1' and order_id is null
         and status = 'open' and amount_cents = 2500) then
    raise exception 'FAIL 1: the unknown order was not kept as reported only';
  end if;
  raise notice 'PASS 1: unknown operation and order are recorded, not rejected';

  -- 2. Stripe redelivers the same event: same answer, no second row.
  r := public.record_refund_provider_event(
    p_event_id => 'evt_unknown_order_1', p_refund_reference => 're_unknown_order_1',
    p_operation_id => foreign_op, p_order_id => foreign_order,
    p_payment_reference => 'pi_unknown_order_1', p_amount_cents => 2500, p_currency => 'usd',
    p_provider_status => 'succeeded',
    p_provider_created_at => (select provider_created_at from public.refund_provider_events where event_id = 'evt_unknown_order_1'));
  if r->>'action' <> 'recovery_recorded' or (r->>'replayed')::boolean is not true
     or (select count(*) from public.refund_provider_events where refund_reference = 're_unknown_order_1') <> 1 then
    raise exception 'FAIL 2: the redelivery was not a clean replay: %', r;
  end if;
  raise notice 'PASS 2: a redelivery replays';

  -- 3. Unknown order with no operation named.
  r := public.record_refund_provider_event(
    p_event_id => 'evt_unknown_order_3', p_refund_reference => 're_unknown_order_3',
    p_operation_id => null, p_order_id => foreign_order,
    p_payment_reference => 'pi_unknown_order_3', p_amount_cents => 1000, p_currency => 'usd',
    p_provider_status => 'succeeded', p_provider_created_at => now());
  if r->>'action' <> 'recovery_recorded' or r->>'reason' <> 'missing_mapping'
     or not exists (
       select 1 from public.refund_provider_events
       where event_id = 'evt_unknown_order_3' and order_id is null and reported_order_id = foreign_order) then
    raise exception 'FAIL 3: an unknown order with no operation was not sent to recovery: %', r;
  end if;
  raise notice 'PASS 3: unknown order without an operation is recorded';

  -- 4. An order that does exist is still attached to the event and recovery.
  insert into auth.users(id, email) values
    (seller, 'unknown-order-seller@example.test'), (buyer, 'unknown-order-buyer@example.test');
  insert into public.orders(buyer_id, seller_id, status, subtotal_cents, platform_fee_cents, total_cents, currency)
  values (buyer, seller, 'delivered', 10000, 1000, 10000, 'USD') returning id into o;
  insert into public.payments(order_id, provider, status, amount_cents, currency, provider_reference)
  values (o, 'stripe', 'succeeded', 10000, 'USD', 'pi_unknown_order_4');
  r := public.record_refund_provider_event(
    p_event_id => 'evt_unknown_order_4', p_refund_reference => 're_unknown_order_4',
    p_operation_id => foreign_op, p_order_id => o,
    p_payment_reference => 'pi_unknown_order_4', p_amount_cents => 1000, p_currency => 'usd',
    p_provider_status => 'succeeded', p_provider_created_at => now());
  if r->>'reason' <> 'unknown_operation'
     or not exists (select 1 from public.refund_provider_events where event_id = 'evt_unknown_order_4' and order_id = o)
     or not exists (select 1 from public.payment_recoveries where recovery_key = 'refund-lifecycle:re_unknown_order_4' and order_id = o) then
    raise exception 'FAIL 4: a known order was no longer attached: %', r;
  end if;
  raise notice 'PASS 4: a known order is still attached';

  raise notice 'all refund unknown order checks passed';
end $$;

rollback;
