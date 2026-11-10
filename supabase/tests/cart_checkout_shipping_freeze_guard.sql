-- Atomic cart checkout destination, quote, and shipment projection guard.
-- Disposable local database only.
begin;

do $$
<<shipping_freeze_guard>>
declare
  seller uuid := gen_random_uuid();
  buyer uuid := gen_random_uuid();
  outsider uuid := gen_random_uuid();
  listing uuid;
  conflicting_listing uuid;
  oid uuid := gen_random_uuid();
  rollback_order uuid := gen_random_uuid();
  item_id uuid;
  rollback_item uuid;
  quote_id uuid := gen_random_uuid();
  rollback_quote uuid := gen_random_uuid();
  attempt_key text := 'shipping-freeze-attempt';
  rollback_key text := 'shipping-freeze-rollback';
  context jsonb;
  rollback_context jsonb;
  result jsonb;
  shipment uuid;
  blocker uuid;
  rejected boolean;
begin
  insert into auth.users(id,email) values
    (seller,'shipping-freeze-seller@drvn.test'),
    (buyer,'shipping-freeze-buyer@drvn.test'),
    (outsider,'shipping-freeze-outsider@drvn.test');

  insert into public.listings(
    seller_id,title,category,price_cents,shipping_cents,status,currency,
    shipping_mode,weight_oz,length_in,width_in,height_in
  ) values(
    seller,'Atomic shipping fixture','engine',10000,975,'reserved','USD',
    'drvn',16,8,6,4
  ) returning id into listing;

  insert into public.listings(
    seller_id,title,category,price_cents,shipping_cents,status,currency,
    shipping_mode,weight_oz,length_in,width_in,height_in
  ) values(
    seller,'Rollback shipping fixture','engine',12000,1100,'reserved','USD',
    'drvn',20,9,7,5
  ) returning id into conflicting_listing;

  insert into public.orders(
    id,buyer_id,seller_id,status,subtotal_cents,shipping_cents,
    platform_fee_cents,total_cents,currency
  ) values
    (oid,buyer,seller,'pending',10000,975,1098,10975,'USD'),
    (rollback_order,buyer,seller,'pending',12000,1100,1310,13100,'USD');

  insert into public.order_items(order_id,listing_id,title,price_cents,shipping_cents)
  values(oid,listing,'Atomic shipping fixture',10000,975)
  returning id into item_id;
  insert into public.order_items(order_id,listing_id,title,price_cents,shipping_cents)
  values(rollback_order,conflicting_listing,'Rollback shipping fixture',12000,1100)
  returning id into rollback_item;

  insert into public.shipping_rate_quotes(
    id,buyer_id,listing_id,provider,provider_shipment_id,rate_ref,carrier,
    service,service_label,amount_cents,currency,destination_hash,parcel,created_at,expires_at
  ) values
    (quote_id,buyer,listing,'easypost','shp_atomic','rate_atomic','USPS',
     'Priority','USPS Priority',975,'USD','destination-one','{}',now()-interval '2 hours',now()-interval '30 minutes'),
    (rollback_quote,buyer,conflicting_listing,'easypost','shp_rollback','rate_rollback','UPS',
     'Ground','UPS Ground',1100,'USD','destination-two','{}',now(),now()+interval '1 hour');

  context := jsonb_build_object(
    'version',1,
    'shipping',jsonb_build_object(
      'name','Buyer One','line1','10 Main Street','line2',null,'city','Detroit',
      'postcode','48201','country','US','state','MI','phone',null,'isCollection',false
    ),
    'destinationHash','destination-one',
    'quoteIds',jsonb_build_object(listing::text,quote_id::text)
  );
  rollback_context := jsonb_build_object(
    'version',1,
    'shipping',jsonb_build_object(
      'name','Buyer Two','line1','20 State Street','line2',null,'city','Chicago',
      'postcode','60601','country','US','state','IL','phone',null,'isCollection',false
    ),
    'destinationHash','destination-two',
    'quoteIds',jsonb_build_object(conflicting_listing::text,rollback_quote::text)
  );

  -- The quote is expired now, but was valid at the durable journal time.
  -- Recovery must remain possible after the short-lived quote window closes.
  insert into public.purchase_attempts(
    idempotency_key,buyer_id,result,request_fingerprint,checkout_request_key,
    checkout_context,created_at
  ) values(
    attempt_key,buyer,
    jsonb_build_object('orders',jsonb_build_array(jsonb_build_object(
      'order_id',oid,'listing_ids',jsonb_build_array(listing)
    )),'skipped','[]'::jsonb),
    jsonb_build_object('ids',jsonb_build_array(listing),'shipping',jsonb_build_object(listing::text,975)),
    'shipping-freeze-browser',context,now()-interval '1 hour'
  ),(
    rollback_key,buyer,
    jsonb_build_object('orders',jsonb_build_array(jsonb_build_object(
      'order_id',rollback_order,'listing_ids',jsonb_build_array(conflicting_listing)
    )),'skipped','[]'::jsonb),
    jsonb_build_object('ids',jsonb_build_array(conflicting_listing),'shipping',jsonb_build_object(conflicting_listing::text,1100)),
    'shipping-freeze-rollback-browser',rollback_context,now()
  );

  rejected := false;
  begin
    perform public.freeze_cart_checkout_shipping(outsider,attempt_key,oid);
  exception when sqlstate '42501' then rejected := true;
  end;
  if not rejected or (select ship_name from public.orders where id=oid) is not null then
    raise exception 'FAIL: another buyer crossed the shipping freeze boundary';
  end if;

  rejected := false;
  begin
    perform public.freeze_cart_checkout_shipping(buyer,attempt_key,rollback_order);
  exception when sqlstate '42501' then rejected := true;
  end;
  if not rejected then
    raise exception 'FAIL: an order outside the journal was accepted';
  end if;

  result := public.freeze_cart_checkout_shipping(buyer,attempt_key,oid);
  if coalesce((result->>'ok')::boolean,false) is not true
     or coalesce((result->>'replayed')::boolean,true) is not false
     or (select ship_line1 from public.orders where id=oid) <> '10 Main Street'
     or (select shipping_quote->0->>'provider_shipment_id' from public.orders where id=oid) <> 'shp_atomic'
     or (select consumed_order_id from public.shipping_rate_quotes where id=quote_id) is distinct from oid
     or (select count(*) from public.shipments where order_id=oid and provider_shipment_id='shp_atomic') <> 1
     or (select count(*) from public.shipment_items si join public.shipments s on s.id=si.shipment_id
          where s.order_id=oid and si.order_item_id=item_id) <> 1 then
    raise exception 'FAIL: destination, quote, shipment, and item link were not committed together';
  end if;

  select id into shipment from public.shipments
   where order_id=oid and provider_shipment_id='shp_atomic';
  update public.shipments set label_reference='label_already_issued',status='label_purchased'
   where id=shipment;
  result := public.freeze_cart_checkout_shipping(buyer,attempt_key,oid);
  if coalesce((result->>'replayed')::boolean,false) is not true
     or (select count(*) from public.shipments where order_id=oid) <> 1
     or (select label_reference from public.shipments where id=shipment) <> 'label_already_issued'
     or (select status from public.shipments where id=shipment) <> 'label_purchased' then
    raise exception 'FAIL: exact replay duplicated or replaced existing carrier state';
  end if;

  -- A multi-seller payment can settle one order before another finalize needs
  -- recovery. The completed order must pass this boundary read-only so the
  -- retry can continue to the still-pending sibling.
  update public.orders set status='paid' where id=oid;
  result := public.freeze_cart_checkout_shipping(buyer,attempt_key,oid);
  if coalesce((result->>'replayed')::boolean,false) is not true
     or (select count(*) from public.shipments where order_id=oid) <> 1
     or (select label_reference from public.shipments where id=shipment) <> 'label_already_issued'
     or (select shipping_quote->0->>'provider_shipment_id' from public.orders where id=oid) <> 'shp_atomic' then
    raise exception 'FAIL: settled exact projection could not replay read-only';
  end if;
  -- A fixture move the order status guard refuses (plan 2 A2); made under its audited override.
  perform set_config('drvn.order_status_override', 'guard fixture: a paid order made payment_failed', true);
  update public.orders set status='payment_failed' where id=oid;
  perform set_config('drvn.order_status_override', '', true);
  result := public.freeze_cart_checkout_shipping(buyer,attempt_key,oid);
  if coalesce((result->>'replayed')::boolean,false) is not true then
    raise exception 'FAIL: released sibling order blocked failed-payment basket recovery';
  end if;

  -- Force the shipment-item uniqueness trigger to fail after this RPC has
  -- prepared its order/quote writes. The nested exception is a subtransaction;
  -- all RPC writes must roll back together.
  insert into public.shipments(
    order_id,direction,provider,provider_shipment_id,fulfillment_type,
    carrier,service,status,quoted_cents
  ) values(
    rollback_order,'outbound','manual','existing_live','drvn_shipping',
    'Manual','Existing','pending',1100
  ) returning id into blocker;
  insert into public.shipment_items(shipment_id,order_item_id)
  values(blocker,rollback_item);

  rejected := false;
  begin
    perform public.freeze_cart_checkout_shipping(buyer,rollback_key,rollback_order);
  exception when sqlstate '42501' then rejected := true;
  end;
  if not rejected
     or (select ship_name from public.orders where id=rollback_order) is not null
     or (select shipping_quote from public.orders where id=rollback_order) is not null
     or (select consumed_order_id from public.shipping_rate_quotes where id=rollback_quote) is not null
     or exists(select 1 from public.shipments where order_id=rollback_order and provider_shipment_id='shp_rollback') then
    raise exception 'FAIL: injected shipment-link failure left a partial shipping projection';
  end if;

  raise notice 'PASS: cart shipping freeze is authorized, exact, idempotent, and atomic';
end;
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);

do $$
declare denied boolean := false;
begin
  begin
    perform public.freeze_cart_checkout_shipping(gen_random_uuid(),'client-attempt',gen_random_uuid());
  exception when insufficient_privilege then denied := true;
  end;
  if not denied then
    raise exception 'FAIL: authenticated client executed the service-only shipping freeze';
  end if;
end;
$$;

reset role;
rollback;

select 'all cart checkout shipping freeze checks passed' as result;
