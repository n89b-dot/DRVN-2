-- One refund operation per business request: a retried return or refund offer
-- adopts its live operation instead of refunding again.
begin;

do $$
declare
  seller uuid := gen_random_uuid();
  buyer uuid := gen_random_uuid();
  v_order uuid;
  first jsonb;
  again jsonb;
  other jsonb;
  n int;
  rejected boolean := false;
begin
  insert into auth.users(id, email) values
    (seller, 'refund-key-seller@example.test'), (buyer, 'refund-key-buyer@example.test');
  insert into public.orders(buyer_id, seller_id, status, subtotal_cents, platform_fee_cents, total_cents, currency)
  values (buyer, seller, 'delivered', 20000, 2000, 20000, 'USD') returning id into v_order;
  insert into public.payments(order_id, provider, provider_reference, status, amount_cents, currency)
  values (v_order, 'stripe', 'pi_refund_key', 'succeeded', 20000, 'USD');

  -- 1. A $100 return refund starts.
  first := public.begin_request_refund_operation('return:guard-1', v_order, 10000, 'Return received',
    'return:guard-1', 'system', false, 'refund_accepted', 'pi_refund_key');
  if not (first->>'ok')::boolean or (first->>'adopted')::boolean then
    raise exception 'FAIL 1: first request did not create an operation: %', first;
  end if;

  -- 2. Stripe says pending; the worker retries the same return. $100 is still
  --    refundable on a $200 order, but the retry must adopt, not refund again.
  update public.refund_operations set status = 'provider_pending' where id = (first->>'operation_id')::uuid;
  again := public.begin_request_refund_operation('return:guard-1', v_order, 10000, 'Return received',
    'return:guard-1', 'system', false, 'refund_accepted', 'pi_refund_key');
  if not (again->>'adopted')::boolean or again->>'operation_id' <> first->>'operation_id' then
    raise exception 'FAIL 2: a pending return refund was created again: %', again;
  end if;
  select count(*) into n from public.refund_operations where order_id = v_order;
  if n <> 1 then raise exception 'FAIL 3: % refund operations for one return', n; end if;

  -- 3. Completed, it still adopts (the caller just finishes the return).
  update public.refund_operations set status = 'completed' where id = (first->>'operation_id')::uuid;
  again := public.begin_request_refund_operation('return:guard-1', v_order, 10000, 'Return received',
    'return:guard-1', 'system', false, 'refund_accepted', 'pi_refund_key');
  if again->>'operation_id' <> first->>'operation_id' then
    raise exception 'FAIL 4: a completed return refund was not adopted: %', again;
  end if;

  -- 4. A different request on the same order is its own operation.
  other := public.begin_request_refund_operation('offer:guard-2', v_order, 5000, 'Refund offer accepted',
    'buyer:' || buyer, 'buyer', false, 'refund_accepted', 'pi_refund_key');
  if not (other->>'ok')::boolean or (other->>'adopted')::boolean then
    raise exception 'FAIL 5: a separate request was swallowed: %', other;
  end if;

  -- 5. After Stripe refused it (failed), the same request may try again.
  update public.refund_operations set status = 'failed' where id = (other->>'operation_id')::uuid;
  again := public.begin_request_refund_operation('offer:guard-2', v_order, 5000, 'Refund offer accepted',
    'buyer:' || buyer, 'buyer', false, 'refund_accepted', 'pi_refund_key');
  if not (again->>'ok')::boolean or (again->>'adopted')::boolean or again->>'operation_id' = other->>'operation_id' then
    raise exception 'FAIL 6: a refused request could not try again: %', again;
  end if;

  -- 6. Two live operations can never share a key, whoever writes them.
  begin
    update public.refund_operations set request_key = 'return:guard-1'
    where id = (again->>'operation_id')::uuid;
  exception when unique_violation then rejected := true; end;
  if not rejected then raise exception 'FAIL 7: two live operations share a request key'; end if;
  rejected := false;

  -- 7. A key can't be replayed against another order.
  begin
    perform public.begin_request_refund_operation('return:guard-1', gen_random_uuid(), 100, 'x',
      'x', 'system', false, null, 'pi_refund_key');
  exception when invalid_parameter_value then rejected := true; end;
  if not rejected then raise exception 'FAIL 8: a request key crossed orders'; end if;

  if has_function_privilege('anon', 'public.begin_request_refund_operation(text,uuid,integer,text,text,text,boolean,text,text)', 'execute')
     or has_function_privilege('authenticated', 'public.begin_request_refund_operation(text,uuid,integer,text,text,text,boolean,text,text)', 'execute') then
    raise exception 'FAIL 9: clients can begin refunds';
  end if;
  raise notice 'all refund request key checks passed';
end $$;

rollback;
