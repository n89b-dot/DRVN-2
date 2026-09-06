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
  rated jsonb:=jsonb_build_object(
    'shipmentRef','shp_frozen','rateRef','rate_frozen','amountCents',800,'currency','USD',
    'carrier','USPS','service','Priority','endShipperRef','es_frozen'
  );
  changed_rated jsonb:=jsonb_build_object(
    'shipmentRef','shp_changed','rateRef','rate_changed','amountCents',900,'currency','USD',
    'carrier','UPS','service','Ground','endShipperRef','es_frozen'
  );
  label jsonb:=jsonb_build_object(
    'shipmentRef','shp_frozen','amountCents',800,'currency','USD','carrier','USPS',
    'service','Priority','labelUrl','https://labels.test/outbound.pdf','trackingCode','TRACK-OUT',
    'trackerRef','trk_out'
  );
  result jsonb;
  rejected boolean;
begin
  insert into auth.users(id,email) values
    (seller,'outbound-label-seller@drvn.test'),
    (buyer,'outbound-label-buyer@drvn.test'),
    (outsider,'outbound-label-outsider@drvn.test');
  insert into public.listings(seller_id,title,category,price_cents,shipping_cents,currency,status)
  values(seller,'Outbound label fixture','engine',5000,800,'USD','sold') returning id into listing;
  insert into public.orders(
    buyer_id,seller_id,status,subtotal_cents,shipping_cents,platform_fee_cents,total_cents,currency,is_collection
  ) values(buyer,seller,'paid',5000,800,580,5800,'USD',false) returning id into oid;
  insert into public.order_items(order_id,listing_id,title,price_cents,shipping_cents)
  values(oid,listing,'Outbound label fixture',5000,800) returning id into item;
  insert into public.shipments(
    order_id,direction,provider,provider_shipment_id,fulfillment_type,carrier,service,status
  ) values(oid,'outbound','easypost','shp_old','drvn_shipping','USPS','Priority','pending')
  returning id into shipment;
  insert into public.shipment_items(shipment_id,order_item_id) values(shipment,item);

  rejected:=false;
  begin perform public.prepare_outbound_label(shipment,outsider,'easypost',rated); exception when others then rejected:=true; end;
  if not rejected or exists(select 1 from public.outbound_label_requests where shipment_id=shipment) then
    raise exception 'Unauthorized actor prepared outbound postage';
  end if;

  result:=public.prepare_outbound_label(shipment,seller,'easypost',rated);
  if result->'rated'<>rated
     or (select provider_shipment_id from public.shipments where id=shipment)<>'shp_frozen'
     or not exists(select 1 from public.admin_alert_outbox where dedup_key='outbound-label:'||shipment) then
    raise exception 'Provider identity was not frozen before outbound purchase';
  end if;
  result:=public.prepare_outbound_label(shipment,seller,'easypost',changed_rated);
  if result->'rated'<>rated or (select provider_shipment_id from public.shipments where id=shipment)<>'shp_frozen' then
    raise exception 'Prepared outbound request changed on retry';
  end if;

  rejected:=false;
  begin perform public.complete_outbound_label(shipment,label||jsonb_build_object('amountCents',801)); exception when others then rejected:=true; end;
  if not rejected or (select status from public.shipments where id=shipment)<>'pending' then
    raise exception 'Mismatched purchased label changed local state';
  end if;

  insert into public.seller_adjustments(
    seller_id,order_id,shipment_id,kind,amount_cents,currency,external_reference,description
  ) values(seller,oid,shipment,'outbound_label',-1,'USD','label:'||shipment,'conflicting fixture');
  rejected:=false;
  begin perform public.complete_outbound_label(shipment,label); exception when others then rejected:=true; end;
  if not rejected
     or (select status from public.shipments where id=shipment)<>'pending'
     or (select completed_at from public.outbound_label_requests where shipment_id=shipment) is not null then
    raise exception 'Failed local ledger completion partially committed outbound label state';
  end if;
  delete from public.seller_adjustments where kind='outbound_label' and external_reference='label:'||shipment;

  result:=public.complete_outbound_label(shipment,label);
  if coalesce((result->>'ok')::boolean,false) is not true
     or (select status from public.shipments where id=shipment)<>'label_purchased'
     or not exists(
       select 1 from public.seller_adjustments where seller_id=seller and order_id=oid
       and shipment_id=shipment and kind='outbound_label' and amount_cents=-800
       and currency='USD' and external_reference='label:'||shipment
     )
     or (select completed_at from public.outbound_label_requests where shipment_id=shipment) is null
     or exists(select 1 from public.admin_alert_outbox where dedup_key='outbound-label:'||shipment and status='pending') then
    raise exception 'Outbound label did not atomically complete shipment and seller adjustment';
  end if;
  result:=public.complete_outbound_label(shipment,label);
  if coalesce((result->>'replayed')::boolean,false) is not true
     or (select count(*) from public.seller_adjustments where kind='outbound_label' and external_reference='label:'||shipment)<>1 then
    raise exception 'Outbound label completion replay duplicated its seller adjustment';
  end if;
  rejected:=false;
  begin perform public.complete_outbound_label(shipment,label||jsonb_build_object('trackingCode','CHANGED')); exception when others then rejected:=true; end;
  if not rejected then raise exception 'Changed completed label replay was accepted'; end if;

  delete from public.outbound_label_requests where shipment_id=shipment;
  delete from public.seller_adjustments where kind='outbound_label' and external_reference='label:'||shipment;
  result:=public.repair_completed_outbound_label(shipment,seller);
  if coalesce((result->>'ok')::boolean,false) is not true
     or result->>'label_url'<>'https://labels.test/outbound.pdf'
     or not exists(
       select 1 from public.seller_adjustments where shipment_id=shipment
       and kind='outbound_label' and amount_cents=-800 and external_reference='label:'||shipment
     ) then raise exception 'Legacy completed shipment did not repair its missing seller adjustment'; end if;
end $$;

do $$
begin
  if has_function_privilege('authenticated','public.prepare_outbound_label(uuid,uuid,text,jsonb)','execute')
     or has_function_privilege('authenticated','public.complete_outbound_label(uuid,jsonb)','execute')
     or has_function_privilege('authenticated','public.repair_completed_outbound_label(uuid,uuid)','execute') then
    raise exception 'Client role can invoke privileged outbound label journal';
  end if;
  raise notice 'all durable outbound label request checks passed';
end $$;

rollback;
