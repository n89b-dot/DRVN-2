begin;

do $$
declare
 seller uuid:=gen_random_uuid();
 buyer uuid:=gen_random_uuid();
 outsider uuid:=gen_random_uuid();
 listing uuid;
 oid uuid;
 item uuid;
 shipment uuid;
 first_shipped_at timestamptz;
 first_delivered_at timestamptz;
 first_available_at timestamptz;
 result jsonb;
 rejected boolean;
begin
 -- The fixed 7-day clearing rule is what this guard checks; pin it so the
 -- deployed settlement decision (20261006100200) doesn't change the check.
 update public.settlement_settings set payout_hold_mode='fixed',payout_hold_days=7 where id;
 insert into auth.users(id,email) values
  (seller,'fulfillment-seller@drvn.test'),
  (buyer,'fulfillment-buyer@drvn.test'),
  (outsider,'fulfillment-outsider@drvn.test');
 insert into public.listings(seller_id,title,category,price_cents,shipping_cents,currency,status)
 values(seller,'Fulfillment guard part','engine',10000,1000,'USD','sold') returning id into listing;
 insert into public.orders(
  buyer_id,seller_id,status,subtotal_cents,shipping_cents,platform_fee_cents,total_cents,currency,is_collection
 ) values(buyer,seller,'paid',10000,1000,1100,11000,'USD',false) returning id into oid;
 insert into public.order_items(order_id,listing_id,title,price_cents,shipping_cents)
 values(oid,listing,'Fulfillment guard part',10000,1000) returning id into item;
 insert into public.payments(order_id,provider,provider_reference,status,amount_cents,currency)
 values(oid,'stub','stub_fulfillment','succeeded',11000,'USD');
 insert into public.transfer_intents(order_id,seller_id,amount_cents,currency,status)
 values(oid,seller,9900,'USD','holding');

 rejected:=false;
 begin perform public.mark_order_dispatched(oid,outsider,'USPS','TRACK-ONE'); exception when others then rejected:=true; end;
 if not rejected or (select status from public.orders where id=oid)<>'paid' then
  raise exception 'Unauthorized dispatch changed the order';
 end if;

 result:=public.mark_order_dispatched(oid,seller,' USPS ',' TRACK-ONE ');
 shipment:=(result->>'shipment_id')::uuid;
 if coalesce((result->>'applied')::boolean,false) is not true
    or (select status from public.orders where id=oid)<>'shipped'
    or (select carrier from public.orders where id=oid)<>'USPS'
    or (select tracking_number from public.orders where id=oid)<>'TRACK-ONE' then
  raise exception 'Atomic dispatch did not transition the order';
 end if;
 if not exists(
  select 1 from public.shipments s join public.shipment_items si on si.shipment_id=s.id
  where s.id=shipment and s.order_id=oid and s.direction='outbound'
   and s.fulfillment_type='seller_arranged' and s.status='in_transit'
   and s.carrier='USPS' and s.tracking_code='TRACK-ONE' and si.order_item_id=item
 ) then raise exception 'Atomic dispatch did not persist authoritative shipment identity'; end if;
 select shipped_at into strict first_shipped_at from public.orders where id=oid;

 result:=public.mark_order_dispatched(oid,seller,'USPS','TRACK-ONE');
 if coalesce((result->>'replayed')::boolean,false) is not true
    or (result->>'shipment_id')::uuid<>shipment
    or (select shipped_at from public.orders where id=oid)<>first_shipped_at
    or (select count(*) from public.shipments where order_id=oid and direction='outbound' and status not in ('cancelled','failed'))<>1 then
  raise exception 'Lost dispatch response replay duplicated or changed fulfillment';
 end if;
 rejected:=false;
 begin perform public.mark_order_dispatched(oid,seller,'USPS','TRACK-CHANGED'); exception when others then rejected:=true; end;
 if not rejected or (select tracking_number from public.orders where id=oid)<>'TRACK-ONE' then
  raise exception 'Changed dispatch replay was accepted';
 end if;

 rejected:=false;
 begin perform public.mark_order_received(oid,outsider,7); exception when others then rejected:=true; end;
 if not rejected or (select status from public.orders where id=oid)<>'shipped' then
  raise exception 'Unauthorized receipt changed the order';
 end if;
 result:=public.mark_order_received(oid,buyer,7);
 if coalesce((result->>'applied')::boolean,false) is not true
    or (select status from public.orders where id=oid)<>'delivered'
    or (select status from public.shipments where id=shipment)<>'delivered' then
  raise exception 'Atomic receipt did not complete order and shipment';
 end if;
 select delivered_at into strict first_delivered_at from public.orders where id=oid;
 select available_at into strict first_available_at from public.transfer_intents where order_id=oid;
 if first_available_at<>first_delivered_at+interval '7 days' then
  raise exception 'Receipt did not atomically schedule the clearing window';
 end if;

 result:=public.mark_order_received(oid,buyer,7);
 if coalesce((result->>'replayed')::boolean,false) is not true
    or (select delivered_at from public.orders where id=oid)<>first_delivered_at
    or (select available_at from public.transfer_intents where order_id=oid)<>first_available_at then
  raise exception 'Lost receipt response replay extended or changed clearing';
 end if;
 if (select count(*) from public.notifications where user_id=buyer and kind='order_shipped')<>1
    or (select count(*) from public.notifications where user_id=seller and kind='order_delivered')<>1 then
  raise exception 'Fulfillment replay duplicated status notifications';
 end if;
end $$;

do $$
declare
 seller uuid;
 buyer uuid;
 listing uuid;
 missing_intent_order uuid;
 terminal_order uuid;
 result jsonb;
 rejected boolean;
begin
 select id into strict seller from auth.users where email='fulfillment-seller@drvn.test';
 select id into strict buyer from auth.users where email='fulfillment-buyer@drvn.test';
 insert into public.listings(seller_id,title,category,price_cents,shipping_cents,currency,status)
 values(seller,'Missing transfer fixture','engine',1000,100,'USD','sold') returning id into listing;
 insert into public.orders(
  buyer_id,seller_id,status,subtotal_cents,shipping_cents,platform_fee_cents,total_cents,currency,is_collection,
  carrier,tracking_number,shipped_at
 ) values(buyer,seller,'shipped',1000,100,110,1100,'USD',false,'UPS','MISSING-INTENT',now())
 returning id into missing_intent_order;
 insert into public.order_items(order_id,listing_id,title,price_cents,shipping_cents)
 values(missing_intent_order,listing,'Missing transfer fixture',1000,100);

 rejected:=false;
 begin perform public.mark_order_received(missing_intent_order,buyer,null); exception when others then rejected:=true; end;
 if not rejected or (select status from public.orders where id=missing_intent_order)<>'shipped' then
  raise exception 'Receipt accepted a null clearing period';
 end if;

 rejected:=false;
 begin perform public.mark_order_received(missing_intent_order,buyer,7); exception when others then rejected:=true; end;
 if not rejected or (select status from public.orders where id=missing_intent_order)<>'shipped' then
  raise exception 'Receipt committed without its seller transfer obligation';
 end if;

 insert into public.payments(order_id,provider,provider_reference,status,amount_cents,currency)
 values(missing_intent_order,'stub','stub_missing_intent','succeeded',1100,'USD');
 result:=public.mark_order_received(missing_intent_order,buyer,7);
 if coalesce((result->>'applied')::boolean,false) is not true
    or (select status from public.orders where id=missing_intent_order)<>'delivered'
    or exists(select 1 from public.transfer_intents where order_id=missing_intent_order) then
  raise exception 'Exact stub settlement did not complete without inventing a real payout obligation';
 end if;

 insert into public.orders(
  buyer_id,seller_id,status,subtotal_cents,shipping_cents,platform_fee_cents,total_cents,currency,is_collection
 ) values(buyer,seller,'cancelled',1000,100,110,1100,'USD',false) returning id into terminal_order;
 result:=public.mark_order_dispatched(terminal_order,seller,'UPS','TERMINAL');
 if coalesce((result->>'ok')::boolean,true) is not false
    or (select status from public.orders where id=terminal_order)<>'cancelled' then
  raise exception 'Dispatch regressed a terminal order';
 end if;
 result:=public.mark_order_received(terminal_order,buyer,7);
 if coalesce((result->>'ok')::boolean,true) is not false
    or (select status from public.orders where id=terminal_order)<>'cancelled' then
  raise exception 'Receipt regressed a terminal order';
 end if;
end $$;

do $$
declare
 seller uuid;
 buyer uuid;
 listing uuid;
 oid uuid;
 item uuid;
 pending_shipment uuid;
 replacement_shipment uuid;
 result jsonb;
begin
 select id into strict seller from auth.users where email='fulfillment-seller@drvn.test';
 select id into strict buyer from auth.users where email='fulfillment-buyer@drvn.test';
 insert into public.listings(seller_id,title,category,price_cents,shipping_cents,currency,status)
 values(seller,'Manual override fixture','engine',2000,200,'USD','sold') returning id into listing;
 insert into public.orders(
  buyer_id,seller_id,status,subtotal_cents,shipping_cents,platform_fee_cents,total_cents,currency,is_collection
 ) values(buyer,seller,'paid',2000,200,220,2200,'USD',false) returning id into oid;
 insert into public.order_items(order_id,listing_id,title,price_cents,shipping_cents)
 values(oid,listing,'Manual override fixture',2000,200) returning id into item;
 insert into public.shipments(order_id,direction,provider,provider_shipment_id,fulfillment_type,carrier,status,quoted_cents)
 values(oid,'outbound','stub','shp_pending','drvn_shipping','StubCarrier','pending',200)
 returning id into pending_shipment;
 insert into public.shipment_items(shipment_id,order_item_id) values(pending_shipment,item);

 result:=public.mark_order_dispatched(oid,seller,'USPS','MANUAL-OVERRIDE');
 replacement_shipment:=(result->>'shipment_id')::uuid;
 if replacement_shipment=pending_shipment
    or (select status from public.shipments where id=pending_shipment)<>'cancelled'
    or (select status from public.shipments where id=replacement_shipment)<>'in_transit'
    or (select fulfillment_type from public.shipments where id=replacement_shipment)<>'seller_arranged' then
  raise exception 'Manual dispatch did not replace the unused rated shipment atomically';
 end if;
end $$;

do $$
declare
 seller uuid;
 buyer uuid;
 listing uuid;
 oid uuid;
 item uuid;
 repaired_shipment uuid;
 result jsonb;
begin
 select id into strict seller from auth.users where email='fulfillment-seller@drvn.test';
 select id into strict buyer from auth.users where email='fulfillment-buyer@drvn.test';
 insert into public.listings(seller_id,title,category,price_cents,shipping_cents,currency,status)
 values(seller,'Legacy dispatch replay fixture','engine',3000,300,'USD','sold') returning id into listing;
 insert into public.orders(
  buyer_id,seller_id,status,subtotal_cents,shipping_cents,platform_fee_cents,total_cents,currency,is_collection,
  carrier,tracking_number,shipped_at
 ) values(buyer,seller,'shipped',3000,300,330,3300,'USD',false,'UPS','LEGACY-REPLAY',clock_timestamp())
 returning id into oid;
 insert into public.order_items(order_id,listing_id,title,price_cents,shipping_cents)
 values(oid,listing,'Legacy dispatch replay fixture',3000,300) returning id into item;

 result:=public.mark_order_dispatched(oid,seller,'UPS','LEGACY-REPLAY');
 repaired_shipment:=(result->>'shipment_id')::uuid;
 if coalesce((result->>'replayed')::boolean,false) is not true
    or not exists(
      select 1 from public.shipments s join public.shipment_items si on si.shipment_id=s.id
      where s.id=repaired_shipment and s.order_id=oid and s.status='in_transit'
        and s.carrier='UPS' and s.tracking_code='LEGACY-REPLAY' and si.order_item_id=item
    ) then
  raise exception 'Dispatch replay did not repair a legacy partial write';
 end if;
end $$;

do $$
begin
 if has_function_privilege('authenticated','public.mark_order_dispatched(uuid,uuid,text,text)','execute')
    or has_function_privilege('authenticated','public.mark_order_received(uuid,uuid,integer)','execute') then
  raise exception 'Client role can execute privileged fulfillment transitions';
 end if;
 raise notice 'all durable order fulfillment transition checks passed';
end $$;

rollback;
