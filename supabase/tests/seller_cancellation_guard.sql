begin;

do $$
declare
  seller uuid:=gen_random_uuid();
  buyer uuid:=gen_random_uuid();
  outsider uuid:=gen_random_uuid();
  l_pending uuid;
  l_uncertain uuid;
  l_paid uuid;
  l_refunded uuid;
  o_pending uuid;
  o_uncertain uuid;
  o_paid uuid;
  o_refunded uuid;
  result jsonb;
  rejected boolean;
begin
  insert into auth.users(id,email) values
    (seller,'cancel-guard-seller@drvn.test'),
    (buyer,'cancel-guard-buyer@drvn.test'),
    (outsider,'cancel-guard-outsider@drvn.test');
  insert into public.listings(seller_id,title,category,price_cents,currency,status)
  values(seller,'Pending cancel','engine',1000,'USD','reserved') returning id into l_pending;
  insert into public.listings(seller_id,title,category,price_cents,currency,status)
  values(seller,'Uncertain cancel','engine',1000,'USD','reserved') returning id into l_uncertain;
  insert into public.listings(seller_id,title,category,price_cents,currency,status)
  values(seller,'Paid cancel','engine',1000,'USD','sold') returning id into l_paid;
  insert into public.listings(seller_id,title,category,price_cents,currency,status)
  values(seller,'Refunded cancel','engine',1000,'USD','sold') returning id into l_refunded;

  insert into public.orders(buyer_id,seller_id,status,subtotal_cents,platform_fee_cents,total_cents,currency)
  values(buyer,seller,'pending',1000,100,1000,'USD') returning id into o_pending;
  insert into public.orders(buyer_id,seller_id,status,subtotal_cents,platform_fee_cents,total_cents,currency)
  values(buyer,seller,'pending',1000,100,1000,'USD') returning id into o_uncertain;
  insert into public.orders(buyer_id,seller_id,status,subtotal_cents,platform_fee_cents,total_cents,currency)
  values(buyer,seller,'paid',1000,100,1000,'USD') returning id into o_paid;
  insert into public.orders(buyer_id,seller_id,status,subtotal_cents,platform_fee_cents,total_cents,currency,refunded_cents,platform_fee_refunded_cents)
  values(buyer,seller,'refunded',1000,100,1000,'USD',1000,100) returning id into o_refunded;
  insert into public.order_items(order_id,listing_id,title,price_cents,shipping_cents) values
    (o_pending,l_pending,'Pending cancel',1000,0),
    (o_uncertain,l_uncertain,'Uncertain cancel',1000,0),
    (o_paid,l_paid,'Paid cancel',1000,0),
    (o_refunded,l_refunded,'Refunded cancel',1000,0);
  insert into public.payments(order_id,provider,status,amount_cents,currency,provider_reference,refunded_cents) values
    (o_pending,'stripe','pending',1000,'USD',null,0),
    (o_uncertain,'stripe','pending',1000,'USD',null,0),
    (o_paid,'stripe','succeeded',1000,'USD','pi_paid',0),
    (o_refunded,'stripe','refunded',1000,'USD','pi_refunded',1000);
  insert into public.payment_requests(operation_key,request)
  values('cancel-guard-request',jsonb_build_object(
    'orderIds',jsonb_build_array(o_uncertain::text),'buyerId',buyer::text,'sellerId',seller::text,
    'totalCents',1000,'currency','usd','customerId',null
  ));

  rejected:=false;
  begin perform public.settle_seller_cancellation(o_pending,outsider,'unauthorized'); exception when others then rejected:=true; end;
  if not rejected or (select status from public.orders where id=o_pending)<>'pending' then
    raise exception 'Unauthorized actor cancelled an order';
  end if;

  result:=public.settle_seller_cancellation(o_pending,seller,'buyer requested cancellation');
  if coalesce((result->>'complete')::boolean,false) is not true
     or (select status from public.orders where id=o_pending)<>'cancelled'
     or (select status from public.listings where id=l_pending)<>'active'
     or (select seller_cancellation_relisted_at from public.orders where id=o_pending) is null then
    raise exception 'Pending cancellation did not atomically cancel and release inventory';
  end if;
  update public.listings set status='reserved' where id=l_pending;
  result:=public.settle_seller_cancellation(o_pending,seller,'buyer requested cancellation');
  if coalesce((result->>'replayed')::boolean,false) is not true
     or (select status from public.listings where id=l_pending)<>'reserved' then
    raise exception 'Lost cancellation response replay stole a later reservation';
  end if;

  result:=public.settle_seller_cancellation(o_uncertain,seller,'cancel');
  if coalesce((result->>'ok')::boolean,true) is not false
     or (select status from public.orders where id=o_uncertain)<>'pending'
     or (select status from public.listings where id=l_uncertain)<>'reserved' then
    raise exception 'Persisted provider request cancellation released inventory';
  end if;

  result:=public.settle_seller_cancellation(o_paid,seller,'cancel');
  if coalesce((result->>'needs_refund')::boolean,false) is not true
     or (select status from public.listings where id=l_paid)<>'sold' then
    raise exception 'Paid cancellation released inventory before refund';
  end if;

  rejected:=false;
  begin perform public.settle_seller_cancellation(o_refunded,seller,'cancel'); exception when others then rejected:=true; end;
  if not rejected or (select status from public.listings where id=l_refunded)<>'sold' then
    raise exception 'Refunded cancellation without seller proof released inventory';
  end if;
  insert into public.refund_operations(
    order_id,payment_reference,amount_cents,currency,remaining_before_cents,reason,
    requested_by,actor_role,idempotency_key,refund_reference,status,provider_status
  ) values(
    o_refunded,'pi_refunded',1000,'USD',1000,'seller cancel','seller:'||seller::text,
    'seller','cancel-guard:'||o_refunded::text,'re_cancel_guard','completed','succeeded'
  );
  result:=public.settle_seller_cancellation(o_refunded,seller,'cancel');
  if coalesce((result->>'complete')::boolean,false) is not true
     or (select status from public.listings where id=l_refunded)<>'active' then
    raise exception 'Verified seller refund did not release inventory';
  end if;
end $$;

do $$
begin
  if has_function_privilege('authenticated','public.settle_seller_cancellation(uuid,uuid,text)','execute') then
    raise exception 'Client role can invoke privileged seller cancellation settlement';
  end if;
  raise notice 'all durable seller cancellation checks passed';
end $$;

rollback;
