-- ============================================================================
-- Return/RMA guard verification (brief §22-§23, migration 0055)
--
-- Proves in the database what the app must be able to rely on:
--   1. The lifecycle trigger refuses illegal transitions (42501) and walks
--      the legal ladder.
--   2. One LIVE RMA per purchased unit; a second only after the first ends.
--   3. Pickup redemption (0054): wrong hash counts an attempt, right hash
--      is single-use and delivers the order.
--
-- Run against a NON-PRODUCTION project; everything rolls back.
-- ============================================================================

begin;

do $$
declare
  v_seller uuid := gen_random_uuid();
  v_buyer uuid := gen_random_uuid();
  v_listing uuid;
  v_order uuid;
  v_item uuid;
  v_return uuid;
  v_return2 uuid;
  v_result jsonb;
  v_hash text := encode(sha256('guard-token'::bytea), 'hex');
begin
  -- ---------- fixtures ----------
  insert into auth.users (id, email) values
    (v_seller, 'ret-seller@example.test'),
    (v_buyer, 'ret-buyer@example.test');
  update public.profiles set username = 'ret_seller' where id = v_seller;

  insert into public.listings
    (seller_id, title, category, condition, price_cents, shipping_cents,
     allows_collection, status, currency)
  values
    (v_seller, 'Return guard part', 'engine', 'used', 20000, 1000, true, 'active', 'USD')
  returning id into v_listing;

  v_result := public.purchase_begin(v_buyer, array[v_listing], 'ret-guard-key');
  v_order := (v_result->'orders'->0->>'order_id')::uuid;
  select id into v_item from public.order_items where order_id = v_order;

  -- ---------- 1. lifecycle guard ----------
  insert into public.returns (order_id, requested_by, return_type, responsibility, status)
  values (v_order, v_buyer, 'protection', 'seller', 'requested')
  returning id into v_return;
  insert into public.return_items (return_id, order_item_id) values (v_return, v_item);

  begin
    update public.returns set status = 'completed' where id = v_return;
    raise exception 'FAIL: requested -> completed was allowed';
  exception when insufficient_privilege then
    raise notice 'PASS: requested -> completed refused (42501)';
  end;

  update public.returns set status = 'approved' where id = v_return;
  update public.returns set status = 'awaiting_shipment' where id = v_return;
  update public.returns set status = 'in_transit' where id = v_return;

  begin
    update public.returns set status = 'expired' where id = v_return;
    raise exception 'FAIL: in_transit -> expired was allowed';
  exception when insufficient_privilege then
    raise notice 'PASS: a moving return cannot expire (42501)';
  end;

  update public.returns set status = 'delivered' where id = v_return;
  update public.returns set status = 'received' where id = v_return;

  -- ---------- 2. one live RMA per item ----------
  insert into public.returns (order_id, requested_by, return_type, responsibility, status)
  values (v_order, v_buyer, 'protection', 'seller', 'requested')
  returning id into v_return2;
  begin
    insert into public.return_items (return_id, order_item_id) values (v_return2, v_item);
    raise exception 'FAIL: second live RMA on the same item was allowed';
  exception when insufficient_privilege then
    raise notice 'PASS: second live RMA refused (42501)';
  end;

  update public.returns set status = 'completed' where id = v_return;
  insert into public.return_items (return_id, order_item_id) values (v_return2, v_item);
  raise notice 'PASS: a new RMA is allowed once the first is terminal';

  -- ---------- 3. pickup redemption (0054) ----------
  update public.orders set is_collection = true where id = v_order;
  update public.orders set status = 'paid' where id = v_order;
  insert into public.pickup_confirmations (order_id, token_hash, code_hash, expires_at)
  values (v_order, v_hash, encode(sha256('000000'::bytea), 'hex'), now() + interval '1 hour');
  -- The seller's payout is waiting on the handoff (no clock yet).
  insert into public.transfer_intents (order_id, seller_id, amount_cents, currency, status, available_at)
  values (v_order, v_seller, 1000, 'USD', 'holding', null)
  on conflict (order_id) do update set status = 'holding', available_at = null;

  v_result := public.pickup_redeem(v_order, v_buyer, v_hash);
  if (v_result->>'ok')::boolean then
    raise exception 'FAIL: a non-seller redeemed the pass';
  end if;
  raise notice 'PASS: only the seller can redeem (%)', v_result->>'reason';

  v_result := public.pickup_redeem(v_order, v_seller, 'wrong-hash');
  if (v_result->>'ok')::boolean or (select attempts from public.pickup_confirmations where order_id = v_order) <> 1 then
    raise exception 'FAIL: wrong hash accepted or attempt not counted';
  end if;
  raise notice 'PASS: wrong code rejected and counted';

  v_result := public.pickup_redeem(v_order, v_seller, v_hash);
  if not (v_result->>'ok')::boolean then
    raise exception 'FAIL: valid redemption refused: %', v_result;
  end if;
  if (select status from public.orders where id = v_order) <> 'delivered' then
    raise exception 'FAIL: redemption did not deliver the order';
  end if;
  raise notice 'PASS: valid pass delivers the order';
  if (select available_at from public.transfer_intents where order_id = v_order) is null
     or (select available_at from public.transfer_intents where order_id = v_order)
        not between now() + interval '7 days' - interval '1 minute' and now() + interval '7 days' + interval '1 minute' then
    raise exception 'FAIL: the handoff did not start the payout clock (20261004120000)';
  end if;
  raise notice 'PASS: the handoff starts the seller''s payout clock';

  v_result := public.pickup_redeem(v_order, v_seller, v_hash);
  if (v_result->>'ok')::boolean then
    raise exception 'FAIL: pass was redeemable twice';
  end if;
  raise notice 'PASS: pass is single-use (%)', v_result->>'reason';

  raise notice 'PASS: return_guard — all checks green (rolling back)';
end $$;

rollback;
