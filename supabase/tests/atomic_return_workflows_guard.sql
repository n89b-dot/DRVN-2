begin;

do $$
declare
  seller uuid:=gen_random_uuid();
  buyer uuid:=gen_random_uuid();
  outsider uuid:=gen_random_uuid();
  l1 uuid;
  l2 uuid;
  l3 uuid;
  protection_order uuid;
  shop_order uuid;
  item1 uuid;
  item2 uuid;
  shop_item uuid;
  protection_return uuid;
  shop_return uuid;
  result jsonb;
  rejected boolean;
  approved_at timestamptz;
  ship_by timestamptz;
  policy jsonb:=jsonb_build_object(
    'commercial',jsonb_build_object(
      'return_policy',jsonb_build_object('returns_accepted',true,'window_days',30)
    )
  );
begin
  insert into auth.users(id,email) values
    (seller,'return-workflow-seller@drvn.test'),
    (buyer,'return-workflow-buyer@drvn.test'),
    (outsider,'return-workflow-outsider@drvn.test');
  insert into public.listings(seller_id,title,category,price_cents,shipping_cents,currency,status)
  values(seller,'Protection item one','engine',2000,200,'USD','sold') returning id into l1;
  insert into public.listings(seller_id,title,category,price_cents,shipping_cents,currency,status)
  values(seller,'Protection item two','engine',3000,300,'USD','sold') returning id into l2;
  insert into public.listings(seller_id,title,category,price_cents,shipping_cents,currency,status)
  values(seller,'Shop policy item','engine',4000,400,'USD','sold') returning id into l3;

  insert into public.orders(
    buyer_id,seller_id,status,pre_dispute_status,dispute_reason,subtotal_cents,shipping_cents,
    platform_fee_cents,total_cents,currency
  ) values(buyer,seller,'disputed','delivered','not as described',5000,500,550,5500,'USD')
  returning id into protection_order;
  insert into public.order_items(order_id,listing_id,title,price_cents,shipping_cents)
  values(protection_order,l1,'Protection item one',2000,200) returning id into item1;
  insert into public.order_items(order_id,listing_id,title,price_cents,shipping_cents)
  values(protection_order,l2,'Protection item two',3000,300) returning id into item2;

  rejected:=false;
  begin perform public.create_protection_return(protection_order,outsider,array[item1],7); exception when others then rejected:=true; end;
  if not rejected or exists(select 1 from public.returns where order_id=protection_order) then
    raise exception 'Unauthorized protection return left state';
  end if;
  rejected:=false;
  begin perform public.create_protection_return(protection_order,seller,array[gen_random_uuid()],7); exception when others then rejected:=true; end;
  if not rejected or exists(select 1 from public.returns where order_id=protection_order) then
    raise exception 'Invalid return item left an RMA shell';
  end if;

  result:=public.create_protection_return(protection_order,seller,array[item1],7);
  protection_return:=(result->>'return_id')::uuid;
  if (select refund_amount_cents from public.returns where id=protection_return)<>2200
     or (select count(*) from public.return_items where return_id=protection_return)<>1 then
    raise exception 'Protection return shell and entitlement were not committed with its items';
  end if;
  result:=public.create_protection_return(protection_order,seller,array[item1],7);
  if coalesce((result->>'replayed')::boolean,false) is not true
     or (result->>'return_id')::uuid<>protection_return
     or (select count(*) from public.returns where order_id=protection_order)<>1 then
    raise exception 'Protection return lost-response replay duplicated the RMA';
  end if;
  rejected:=false;
  begin perform public.create_protection_return(protection_order,seller,array[item1,item2],7); exception when others then rejected:=true; end;
  if not rejected or (select count(*) from public.returns where order_id=protection_order)<>1 then
    raise exception 'Overlapping return-item failure left a partial RMA shell';
  end if;

  insert into public.orders(
    buyer_id,seller_id,status,delivered_at,completed_at,subtotal_cents,shipping_cents,
    platform_fee_cents,total_cents,currency
  ) values(buyer,seller,'delivered',now(),now(),4000,400,440,4400,'USD') returning id into shop_order;
  insert into public.order_items(order_id,listing_id,title,price_cents,shipping_cents,commercial_snapshot)
  values(shop_order,l3,'Shop policy item',4000,400,policy) returning id into shop_item;

  result:=public.create_shop_policy_return(shop_order,buyer,'Changed my mind');
  shop_return:=(result->>'return_id')::uuid;
  if (select refund_amount_cents from public.returns where id=shop_return)<>4000
     or not exists(select 1 from public.return_items where return_id=shop_return and order_item_id=shop_item) then
    raise exception 'Shop return did not atomically freeze its goods-only entitlement and item';
  end if;
  update public.orders set delivered_at=now()-interval '40 days' where id=shop_order;
  result:=public.create_shop_policy_return(shop_order,buyer,'Different retry text');
  if coalesce((result->>'replayed')::boolean,false) is not true
     or (result->>'return_id')::uuid<>shop_return then
    raise exception 'Existing shop return was lost when its request window later elapsed';
  end if;

  update public.returns set status='approved',approved_at=now(),ship_by=now()+interval '7 days'
  where id=shop_return;
  result:=public.respond_shop_policy_return(shop_return,seller,'approve',7);
  if coalesce((result->>'ok')::boolean,false) is not true
     or coalesce((result->>'repaired')::boolean,false) is not true
     or (select status from public.returns where id=shop_return)<>'awaiting_shipment' then
    raise exception 'Shop approval did not repair the partial approved state';
  end if;
  select r.approved_at,r.ship_by into strict approved_at,ship_by from public.returns r where id=shop_return;
  result:=public.respond_shop_policy_return(shop_return,seller,'approve',7);
  if coalesce((result->>'replayed')::boolean,false) is not true
     or (select r.approved_at from public.returns r where id=shop_return)<>approved_at
     or (select r.ship_by from public.returns r where id=shop_return)<>ship_by then
    raise exception 'Shop approval replay changed its deadline';
  end if;
  result:=public.respond_shop_policy_return(shop_return,seller,'reject',7);
  if coalesce((result->>'ok')::boolean,true) is not false
     or (select status from public.returns where id=shop_return)<>'awaiting_shipment' then
    raise exception 'Changed shop-return decision regressed an approval';
  end if;
end $$;

do $$
begin
  if has_function_privilege('authenticated','public.create_protection_return(uuid,uuid,uuid[],integer)','execute')
     or has_function_privilege('authenticated','public.create_shop_policy_return(uuid,uuid,text)','execute')
     or has_function_privilege('authenticated','public.respond_shop_policy_return(uuid,uuid,text,integer)','execute') then
    raise exception 'Client role can invoke privileged atomic return workflows';
  end if;
  raise notice 'all atomic return workflow checks passed';
end $$;

rollback;
