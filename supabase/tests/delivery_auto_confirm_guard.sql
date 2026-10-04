-- Untracked-shipment auto-confirm (20261006100100): off by default it does
-- nothing; on, it warns each eligible buyer once, confirms only orders that
-- are due and still eligible, and never touches disputed, returned,
-- refunded, tracked or buyer-confirmed orders.
begin;

do $$
declare
  seller uuid := gen_random_uuid();
  buyer uuid := gen_random_uuid();
  eligible uuid;
  tracked uuid;
  disputed uuid;
  returned uuid;
  refunded uuid;
  recent uuid;
  self_confirmed uuid;
  late_dispute uuid;
  unfunded uuid;
  switched_off uuid;
  shipment uuid;
  long_ago timestamptz := now() - interval '30 days';
  summary jsonb;
begin
  -- 0. Not callable by any client.
  if has_function_privilege('authenticated', 'public.auto_confirm_untracked_deliveries(integer)', 'execute')
     or has_function_privilege('anon', 'public.auto_confirm_untracked_deliveries(integer)', 'execute')
     or has_function_privilege('authenticated', 'public.auto_confirm_delivery(uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.delivery_auto_confirm_eligible(uuid)', 'execute')
     or has_table_privilege('authenticated', 'public.delivery_auto_confirmations', 'select') then
    raise exception 'FAIL 0: auto-confirm is reachable by a client role';
  end if;

  insert into auth.users(id, email) values (seller, 'auto-seller@example.test'), (buyer, 'auto-buyer@example.test');

  insert into public.orders(buyer_id, seller_id, status, shipped_at, carrier, tracking_number, subtotal_cents, platform_fee_cents, total_cents, currency)
  values (buyer, seller, 'shipped', long_ago, 'Royal Mail', 'RM1', 5000, 500, 5000, 'USD') returning id into eligible;
  insert into public.orders(buyer_id, seller_id, status, shipped_at, carrier, tracking_number, subtotal_cents, platform_fee_cents, total_cents, currency)
  values (buyer, seller, 'shipped', long_ago, 'UPS', '1Z2', 5000, 500, 5000, 'USD') returning id into tracked;
  insert into public.orders(buyer_id, seller_id, status, pre_dispute_status, disputed_at, dispute_reason, shipped_at, subtotal_cents, platform_fee_cents, total_cents, currency)
  values (buyer, seller, 'disputed', 'shipped', now() - interval '2 days', 'never arrived', long_ago, 5000, 500, 5000, 'USD') returning id into disputed;
  insert into public.orders(buyer_id, seller_id, status, shipped_at, subtotal_cents, platform_fee_cents, total_cents, currency)
  values (buyer, seller, 'shipped', long_ago, 5000, 500, 5000, 'USD') returning id into returned;
  insert into public.orders(buyer_id, seller_id, status, shipped_at, refunded_cents, refunded_at, subtotal_cents, platform_fee_cents, total_cents, currency)
  values (buyer, seller, 'refunded', long_ago, 5000, now(), 5000, 500, 5000, 'USD') returning id into refunded;
  insert into public.orders(buyer_id, seller_id, status, shipped_at, subtotal_cents, platform_fee_cents, total_cents, currency)
  values (buyer, seller, 'shipped', now() - interval '2 days', 5000, 500, 5000, 'USD') returning id into recent;
  insert into public.orders(buyer_id, seller_id, status, shipped_at, subtotal_cents, platform_fee_cents, total_cents, currency)
  values (buyer, seller, 'shipped', long_ago, 5000, 500, 5000, 'USD') returning id into self_confirmed;
  insert into public.orders(buyer_id, seller_id, status, shipped_at, subtotal_cents, platform_fee_cents, total_cents, currency)
  values (buyer, seller, 'shipped', long_ago, 5000, 500, 5000, 'USD') returning id into late_dispute;
  insert into public.orders(buyer_id, seller_id, status, shipped_at, subtotal_cents, platform_fee_cents, total_cents, currency)
  values (buyer, seller, 'shipped', long_ago, 5000, 500, 5000, 'USD') returning id into unfunded;
  insert into public.orders(buyer_id, seller_id, status, shipped_at, subtotal_cents, platform_fee_cents, total_cents, currency)
  values (buyer, seller, 'shipped', long_ago, 5000, 500, 5000, 'USD') returning id into switched_off;

  insert into public.shipments(order_id, direction, fulfillment_type, carrier, status, tracking_code, shipped_at)
  values (eligible, 'outbound', 'seller_arranged', 'Royal Mail', 'in_transit', 'RM1', long_ago) returning id into shipment;
  insert into public.shipments(order_id, direction, fulfillment_type, carrier, status, tracking_code, shipped_at, provider, provider_tracker_id)
  values (tracked, 'outbound', 'seller_arranged', 'UPS', 'in_transit', '1Z2', long_ago, 'easypost', 'trk_guard');
  insert into public.returns(order_id, requested_by, return_type, responsibility, status)
  values (returned, buyer, 'protection', 'seller', 'requested');
  insert into public.transfer_intents(order_id, seller_id, amount_cents, currency, status, available_at)
  select id, seller, 4500, 'USD', 'holding', null
    from public.orders where id in (eligible, tracked, disputed, returned, recent, self_confirmed, late_dispute, switched_off);

  -- 1. Off by default: the run is recorded and nothing else happens.
  if (select auto_confirm_after_days from public.settlement_settings where id) is not null then
    raise exception 'FAIL 1: auto-confirm is not off by default';
  end if;
  summary := public.auto_confirm_untracked_deliveries();
  if (summary->>'enabled')::boolean
     or exists (select 1 from public.delivery_auto_confirmations)
     or (select status from public.orders where id = eligible) <> 'shipped'
     or exists (select 1 from public.notifications where kind in ('receipt_due', 'receipt_auto_confirmed')) then
    raise exception 'FAIL 1: auto-confirm acted while off: %', summary;
  end if;
  if not exists (select 1 from public.worker_runs where family = 'deliveryAutoConfirm' and status = 'succeeded') then
    raise exception 'FAIL 1: an off run was not recorded for worker health';
  end if;
  raise notice 'PASS 1: off by default does nothing but record the run';

  -- 2. On at 14 days (3 days' notice): only the eligible, old-enough orders
  --    are warned, and none is confirmed before its notice has run.
  update public.settlement_settings set auto_confirm_after_days = 14 where id;
  summary := public.auto_confirm_untracked_deliveries();
  if (select array_agg(order_id order by order_id) from public.delivery_auto_confirmations)
     is distinct from (select array_agg(id order by id) from unnest(array[eligible, self_confirmed, late_dispute, unfunded, switched_off]) id)
     or (summary->>'reminded')::integer <> 5 or (summary->>'confirmed')::integer <> 0 then
    raise exception 'FAIL 2: the wrong orders were warned: %', summary;
  end if;
  if (select confirm_at from public.delivery_auto_confirmations where order_id = eligible) <> now() + interval '3 days' then
    raise exception 'FAIL 2: a backlog order was not given the full notice period';
  end if;
  if (select count(*) from public.notifications
       where user_id = buyer and kind = 'receipt_due' and href = '/orders/' || eligible) <> 1 then
    raise exception 'FAIL 2: the buyer was not warned exactly once';
  end if;
  raise notice 'PASS 2: eligible orders warned; tracked, disputed, returned, refunded and recent ones not';

  -- 3. A second run sends no second warning.
  summary := public.auto_confirm_untracked_deliveries();
  if (summary->>'reminded')::integer <> 0
     or (select count(*) from public.notifications where kind = 'receipt_due') <> 5 then
    raise exception 'FAIL 3: a warning was sent twice: %', summary;
  end if;
  raise notice 'PASS 3: the warning is sent once';

  -- 4. When due: the buyer who confirmed and the order disputed since are
  --    left alone; the eligible order is confirmed with its event, payout
  --    clock and notifications.
  update public.delivery_auto_confirmations set confirm_at = now() - interval '1 minute'
   where order_id <> switched_off;
  perform public.mark_order_received(self_confirmed, buyer);
  update public.orders set status = 'disputed', pre_dispute_status = 'shipped', disputed_at = now(),
         dispute_reason = 'never arrived' where id = late_dispute;
  summary := public.auto_confirm_untracked_deliveries();

  if (select status from public.orders where id = eligible) <> 'delivered'
     or (select delivered_at from public.orders where id = eligible) <> now()
     or (select status from public.shipments where id = shipment) <> 'delivered'
     or (select available_at from public.transfer_intents where order_id = eligible) <> now() + interval '7 days'
     or (select confirmed_at from public.delivery_auto_confirmations where order_id = eligible) <> now() then
    raise exception 'FAIL 4: the eligible order was not confirmed: %', summary;
  end if;
  if not exists (select 1 from public.shipment_events
                  where shipment_id = shipment and status = 'delivered' and provider_event_ref = 'drvn:auto-confirm'
                    and description like 'Marked delivered automatically%14 days%') then
    raise exception 'FAIL 4: no order event records the auto-confirmation';
  end if;
  if (select count(*) from public.notifications where user_id = buyer and kind = 'receipt_auto_confirmed') <> 1
     or not exists (select 1 from public.notifications where user_id = seller and kind = 'order_delivered'
                     and href = '/orders/' || eligible and body like 'No problem was reported%') then
    raise exception 'FAIL 4: the buyer or seller was not told about the auto-confirmation';
  end if;
  if not exists (select 1 from public.notifications where user_id = seller and kind = 'order_delivered'
                  and href = '/orders/' || self_confirmed and body = 'The buyer marked the order received') then
    raise exception 'FAIL 4: a buyer''s own receipt lost its message';
  end if;
  if (select confirmed_at from public.delivery_auto_confirmations where order_id = self_confirmed) is not null
     or (select status from public.orders where id = late_dispute) <> 'disputed'
     or (select status from public.orders where id = tracked) <> 'shipped'
     or (select status from public.orders where id = returned) <> 'shipped'
     or (select status from public.orders where id = refunded) <> 'refunded' then
    raise exception 'FAIL 4: an ineligible order was touched';
  end if;
  raise notice 'PASS 4: due eligible order confirmed with event, payout clock and notices; others untouched';

  -- 5. An order without its seller-transfer obligation is refused, kept
  --    for retry with its reason, and fails the run.
  if (select status from public.orders where id = unfunded) <> 'shipped'
     or (select last_error from public.delivery_auto_confirmations where order_id = unfunded) not like '%transfer obligation%'
     or (summary->>'failed')::integer <> 1
     or (select status from public.worker_runs where family = 'deliveryAutoConfirm' order by started_at desc limit 1) <> 'failed' then
    raise exception 'FAIL 5: an unfunded order was not refused and reported: %', summary;
  end if;
  raise notice 'PASS 5: an order with no transfer obligation fails loudly and stays shipped';

  -- 6. Switching the rule off stops a confirmation that is already due;
  --    repeated runs never confirm or notify twice.
  update public.delivery_auto_confirmations set confirm_at = now() - interval '1 minute'
   where order_id = switched_off;
  update public.settlement_settings set auto_confirm_after_days = null where id;
  summary := public.auto_confirm_untracked_deliveries();
  if (select status from public.orders where id = switched_off) <> 'shipped' then
    raise exception 'FAIL 6: switching the rule off did not stop a pending confirmation';
  end if;
  update public.settlement_settings set auto_confirm_after_days = 14 where id;
  perform public.auto_confirm_untracked_deliveries();
  perform public.auto_confirm_untracked_deliveries();
  if (select count(*) from public.notifications where kind = 'receipt_auto_confirmed' and href = '/orders/' || eligible) <> 1
     or (select count(*) from public.shipment_events where shipment_id = shipment and provider_event_ref = 'drvn:auto-confirm') <> 1
     or (select delivered_at from public.orders where id = eligible) <> now()
     or (select count(*) from public.notifications where kind = 'receipt_auto_confirmed' and href = '/orders/' || switched_off) <> 1 then
    raise exception 'FAIL 6: a repeated run confirmed or notified twice';
  end if;
  raise notice 'PASS 6: switching off stops it; repeated runs are idempotent';

  -- 7. Settings are bounded: N between 7 and 60 and longer than the notice.
  begin
    update public.settlement_settings set auto_confirm_after_days = 3 where id;
    raise exception 'FAIL 7: a 3-day auto-confirm was accepted';
  exception when check_violation then null;
  end;
  begin
    update public.settlement_settings set auto_confirm_after_days = 8, auto_confirm_notice_days = 8 where id;
    raise exception 'FAIL 7: a notice as long as the rule was accepted';
  exception when check_violation then null;
  end;
  raise notice 'PASS 7: settings are bounded';

  raise notice 'all delivery auto-confirm checks passed';
end $$;

rollback;
