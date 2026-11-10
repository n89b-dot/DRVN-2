-- Every path to 'delivered' starts the seller's payout clock; nothing else does.
begin;

do $$
declare
  seller uuid := gen_random_uuid();
  buyer uuid := gen_random_uuid();
  tracked uuid;
  pending_order uuid;
  disputed uuid;
  stamp timestamptz := now() - interval '2 days';
begin
  insert into auth.users(id, email) values (seller, 'clock-seller@example.test'), (buyer, 'clock-buyer@example.test');
  -- The clock mechanism under test is the fixed 7-day hold; pin it so the
  -- deployed settlement decision (20261006100200) doesn't change this check.
  update public.settlement_settings set payout_hold_mode = 'fixed', payout_hold_days = 7 where id;
  insert into public.orders(buyer_id, seller_id, status, subtotal_cents, platform_fee_cents, total_cents, currency)
  values (buyer, seller, 'shipped', 5000, 500, 5000, 'USD') returning id into tracked;
  insert into public.orders(buyer_id, seller_id, status, subtotal_cents, platform_fee_cents, total_cents, currency)
  values (buyer, seller, 'shipped', 5000, 500, 5000, 'USD') returning id into pending_order;
  insert into public.orders(buyer_id, seller_id, status, subtotal_cents, platform_fee_cents, total_cents, currency)
  values (buyer, seller, 'shipped', 5000, 500, 5000, 'USD') returning id into disputed;
  insert into public.transfer_intents(order_id, seller_id, amount_cents, currency, status, available_at) values
    (tracked, seller, 4500, 'USD', 'holding', null),
    (pending_order, seller, 4500, 'USD', 'holding', null),
    (disputed, seller, 4500, 'USD', 'holding', null);

  -- 1. A carrier scan (apply-tracking's update) starts the clock from delivery.
  update public.orders set status = 'delivered', delivered_at = stamp where id = tracked;
  if (select available_at from public.transfer_intents where order_id = tracked) is distinct from stamp + interval '7 days' then
    raise exception 'FAIL 1: a tracked delivery did not start the payout clock';
  end if;

  -- 2. Still shipped: no clock.
  if (select available_at from public.transfer_intents where order_id = pending_order) is not null then
    raise exception 'FAIL 2: an undelivered order has a payout date';
  end if;

  -- 3. A disputed order isn't released by the clock (mark_due requires
  --    delivered/completed), even once the date has passed.
  update public.orders set status = 'delivered', delivered_at = now() - interval '30 days' where id = disputed;
  update public.orders set status = 'disputed', pre_dispute_status = status where id = disputed;
  perform public.mark_due_transfer_intents();
  if (select status from public.transfer_intents where order_id = disputed) <> 'holding' then
    raise exception 'FAIL 3: a disputed order''s payout was released';
  end if;
  if (select status from public.transfer_intents where order_id = tracked) <> 'holding' then
    raise exception 'FAIL 4: a payout was released before its clearing window';
  end if;

  -- 4. An existing date is never moved.
  update public.transfer_intents set available_at = now() + interval '1 day' where order_id = pending_order;
  update public.orders set status = 'delivered', delivered_at = now() - interval '20 days' where id = pending_order;
  if (select available_at from public.transfer_intents where order_id = pending_order) < now() then
    raise exception 'FAIL 5: delivery overwrote an existing payout date';
  end if;

  if has_function_privilege('anon', 'public.start_payout_clock_on_delivery()', 'execute') then
    raise exception 'FAIL 6: the trigger function is client-callable';
  end if;
  raise notice 'all payout clock checks passed';
end $$;

rollback;
