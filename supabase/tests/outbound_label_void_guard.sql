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
  rejected_shipment uuid;
  zero_shipment uuid;
  worker1 uuid:=gen_random_uuid();
  worker2 uuid:=gen_random_uuid();
  result jsonb;
  refused boolean;
begin
  insert into auth.users(id,email) values
    (seller,'void-label-seller@drvn.test'),
    (buyer,'void-label-buyer@drvn.test'),
    (outsider,'void-label-outsider@drvn.test');
  insert into public.listings(seller_id,title,category,price_cents,shipping_cents,currency,status)
  values(seller,'Void label fixture','engine',5000,800,'USD','sold') returning id into listing;
  insert into public.orders(
    buyer_id,seller_id,status,subtotal_cents,shipping_cents,platform_fee_cents,total_cents,currency,is_collection
  ) values(buyer,seller,'paid',5000,800,580,5800,'USD',false) returning id into oid;
  insert into public.order_items(order_id,listing_id,title,price_cents,shipping_cents)
  values(oid,listing,'Void label fixture',5000,800) returning id into item;
  insert into public.shipments(
    order_id,direction,provider,provider_shipment_id,fulfillment_type,carrier,service,status,
    purchased_cents,label_reference,tracking_code
  ) values(
    oid,'outbound','easypost','shp_void_frozen','drvn_shipping','USPS','Priority','label_purchased',
    800,'https://labels.test/void.pdf','TRACK-VOID'
  ) returning id into shipment;
  insert into public.shipment_items(shipment_id,order_item_id) values(shipment,item);
  insert into public.seller_adjustments(
    seller_id,order_id,shipment_id,kind,amount_cents,currency,external_reference,description
  ) values(seller,oid,shipment,'outbound_label',-800,'USD','label:'||shipment,'fixture label');

  refused:=false;
  begin perform public.prepare_outbound_label_void(shipment,outsider,'easypost');
  exception when others then refused:=true; end;
  if not refused or exists(select 1 from public.outbound_label_void_requests where shipment_id=shipment) then
    raise exception 'Unauthorized actor prepared a label refund';
  end if;

  result:=public.prepare_outbound_label_void(shipment,seller,'easypost');
  if result->>'provider_shipment_reference'<>'shp_void_frozen'
     or (result->>'amount_cents')::integer<>800
     or not exists(select 1 from public.admin_alert_outbox where dedup_key='outbound-label-void:'||shipment) then
    raise exception 'Label refund identity or recovery obligation was not frozen';
  end if;
  refused:=false;
  begin perform public.prepare_outbound_label_void(shipment,seller,'stub');
  exception when others then refused:=true; end;
  if not refused then raise exception 'Prepared label refund accepted a changed provider'; end if;
  refused:=false;
  begin perform public.prepare_outbound_label_void(shipment,seller,null);
  exception when others then refused:=true; end;
  if not refused then raise exception 'Prepared label refund accepted a null provider'; end if;

  result:=public.claim_outbound_label_void(shipment,worker1);
  if result->>'action'<>'dispatch' or nullif(result->>'observation_started_at','') is null then
    raise exception 'First worker did not receive dispatch ownership and a database observation epoch';
  end if;
  refused:=false;
  begin perform public.record_outbound_label_void_observation(shipment,worker1,'dispatch',null,1,now());
  exception when others then refused:=true; end;
  if not refused or (select status from public.shipments where id=shipment)<>'label_purchased' then
    raise exception 'Null provider state reached the refunded completion branch';
  end if;
  refused:=false;
  begin perform public.record_outbound_label_void_observation(shipment,worker1,null,'refunded',1,now());
  exception when others then refused:=true; end;
  if not refused or (select status from public.shipments where id=shipment)<>'label_purchased' then
    raise exception 'Null observation source reached the refunded completion branch';
  end if;
  result:=public.claim_outbound_label_void(shipment,worker2);
  if result->>'action'<>'reconcile' then raise exception 'Concurrent worker could repeat provider dispatch'; end if;
  result:=public.record_outbound_label_void_observation(shipment,worker2,'reconcile','submitted',1,now());
  if result->>'state'<>'pending' or (select status from public.shipments where id=shipment)<>'label_purchased'
     or exists(select 1 from public.seller_adjustments where kind='label_refund' and external_reference='label:'||shipment||':refund') then
    raise exception 'Submitted carrier refund was treated as settled money';
  end if;
  update public.outbound_label_void_requests set updated_at=now()-interval '7 hours'
  where shipment_id=shipment;
  result:=public.worker_health_snapshot();
  if not exists(
       select 1 from jsonb_array_elements(result->'families') f where f->>'family'='labelVoids'
     ) or not exists(
       select 1 from jsonb_array_elements(result->'queues') q
       where q->>'kind'='labelVoids' and q->>'status'='provider_pending'
     ) then
    raise exception 'Due label refund reconciliation is absent from worker health';
  end if;

  update public.outbound_label_void_requests set claim_expires_at=now()-interval '1 second'
  where shipment_id=shipment;
  result:=public.record_outbound_label_void_observation(
    shipment,worker2,'reconcile','not_requested',1,now()-interval '2 minutes'
  );
  result:=public.claim_outbound_label_void(shipment,worker2);
  if result->>'action'<>'reconcile' then
    raise exception 'Provider read begun before lease expiry authorized a new dispatch';
  end if;
  result:=public.record_outbound_label_void_observation(shipment,worker2,'reconcile','not_requested',1,now());
  result:=public.claim_outbound_label_void(shipment,worker2);
  if result->>'action'<>'dispatch'
     or (select attempts from public.outbound_label_void_requests where shipment_id=shipment)<>2 then
    raise exception 'Expired crash claim was not recoverable after exact provider absence';
  end if;
  refused:=false;
  begin perform public.record_outbound_label_void_observation(shipment,worker1,'dispatch','refunded',2,now());
  exception when others then refused:=true; end;
  if not refused then raise exception 'Stale worker could complete a newer provider dispatch'; end if;
  refused:=false;
  begin perform public.record_outbound_label_void_observation(shipment,worker1,'reconcile','rejected',1,now());
  exception when others then refused:=true; end;
  if not refused then raise exception 'Stale reconciliation changed a newer provider attempt'; end if;

  insert into public.seller_adjustments(
    seller_id,order_id,shipment_id,kind,amount_cents,currency,external_reference,description
  ) values(seller,oid,shipment,'label_refund',1,'USD','label:'||shipment||':refund','conflicting fixture');
  refused:=false;
  begin perform public.record_outbound_label_void_observation(shipment,worker2,'dispatch','refunded',2,now());
  exception when others then refused:=true; end;
  if not refused or (select status from public.shipments where id=shipment)<>'label_purchased'
     or (select status from public.outbound_label_void_requests where shipment_id=shipment)<>'provider_pending' then
    raise exception 'Failed refund ledger completion partially changed shipment or request';
  end if;
  delete from public.seller_adjustments where kind='label_refund' and external_reference='label:'||shipment||':refund';

  result:=public.record_outbound_label_void_observation(shipment,worker2,'dispatch','refunded',2,now());
  if result->>'state'<>'refunded' or (select status from public.shipments where id=shipment)<>'cancelled'
     or (select status from public.outbound_label_void_requests where shipment_id=shipment)<>'completed'
     or not exists(
       select 1 from public.seller_adjustments where seller_id=seller and order_id=oid
       and shipment_id=shipment and kind='label_refund' and amount_cents=800 and currency='USD'
       and external_reference='label:'||shipment||':refund'
     )
     or exists(select 1 from public.admin_alert_outbox where dedup_key='outbound-label-void:'||shipment and status='pending') then
    raise exception 'Refunded label did not atomically cancel shipment and reverse the exact adjustment';
  end if;
  result:=public.record_outbound_label_void_observation(shipment,worker1,'reconcile','refunded',2,now());
  if coalesce((result->>'replayed')::boolean,false) is not true
     or (select count(*) from public.seller_adjustments where kind='label_refund' and external_reference='label:'||shipment||':refund')<>1 then
    raise exception 'Refund completion replay duplicated its seller adjustment';
  end if;

  -- A definitive rejection is terminal and creates no local refund.
  insert into public.shipments(
    order_id,direction,provider,provider_shipment_id,fulfillment_type,carrier,service,status,
    purchased_cents,label_reference,tracking_code
  ) values(
    oid,'outbound','easypost','shp_void_rejected','drvn_shipping','UPS','Ground','label_purchased',
    400,'https://labels.test/rejected.pdf','TRACK-REJECT'
  ) returning id into rejected_shipment;
  insert into public.seller_adjustments(
    seller_id,order_id,shipment_id,kind,amount_cents,currency,external_reference,description
  ) values(seller,oid,rejected_shipment,'outbound_label',-400,'USD','label:'||rejected_shipment,'fixture label');
  perform public.prepare_outbound_label_void(rejected_shipment,seller,'easypost');
  perform public.claim_outbound_label_void(rejected_shipment,worker1);
  result:=public.record_outbound_label_void_observation(rejected_shipment,worker1,'dispatch','rejected',1,now());
  if result->>'state'<>'rejected'
     or (select status from public.shipments where id=rejected_shipment)<>'label_purchased'
     or exists(select 1 from public.seller_adjustments where kind='label_refund' and shipment_id=rejected_shipment) then
    raise exception 'Rejected carrier refund fabricated a local refund';
  end if;

  -- Zero-cost labels can be cancelled after provider confirmation but do not
  -- create a monetary credit which never existed.
  insert into public.shipments(
    order_id,direction,provider,provider_shipment_id,fulfillment_type,carrier,service,status,
    purchased_cents,label_reference,tracking_code
  ) values(
    oid,'outbound','stub','stub_zero','drvn_shipping','StubCarrier','Ground','label_purchased',
    0,'https://labels.test/zero.pdf','TRACK-ZERO'
  ) returning id into zero_shipment;
  insert into public.seller_adjustments(
    seller_id,order_id,shipment_id,kind,amount_cents,currency,external_reference,description
  ) values(seller,oid,zero_shipment,'outbound_label',0,'USD','label:'||zero_shipment,'zero fixture');
  perform public.prepare_outbound_label_void(zero_shipment,seller,'stub');
  perform public.claim_outbound_label_void(zero_shipment,worker1);
  perform public.record_outbound_label_void_observation(zero_shipment,worker1,'dispatch','refunded',1,now());
  if (select status from public.shipments where id=zero_shipment)<>'cancelled'
     or exists(select 1 from public.seller_adjustments where kind='label_refund' and shipment_id=zero_shipment) then
    raise exception 'Zero-cost label refund fabricated a credit';
  end if;
end $$;

do $$
begin
  if has_function_privilege('authenticated','public.prepare_outbound_label_void(uuid,uuid,text)','execute')
     or has_function_privilege('authenticated','public.claim_outbound_label_void(uuid,uuid)','execute')
     or has_function_privilege('authenticated','public.record_outbound_label_void_observation(uuid,uuid,text,text,integer,timestamptz,text)','execute') then
    raise exception 'Client role can invoke privileged outbound label refund journal';
  end if;
  raise notice 'all durable outbound label void checks passed';
end $$;

rollback;
