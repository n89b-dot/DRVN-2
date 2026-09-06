begin;

do $$
declare
  seller uuid:=gen_random_uuid();
  buyer uuid:=gen_random_uuid();
  outsider uuid:=gen_random_uuid();
  listing uuid;
  offer_id uuid;
  oid uuid;
  direct_order uuid;
  first_snapshot jsonb:=jsonb_build_object(
    'name','Buyer One','line1','10 Main Street','line2',null,'city','Detroit',
    'postcode','48201','country','US','state','MI','phone',null,'isCollection',false
  );
  changed_snapshot jsonb:=jsonb_build_object(
    'name','Buyer One','line1','99 Changed Street','line2',null,'city','Detroit',
    'postcode','48201','country','US','state','MI','phone',null,'isCollection',false
  );
  result jsonb;
  rejected boolean;
begin
  insert into auth.users(id,email) values
    (seller,'accepted-checkout-seller@drvn.test'),
    (buyer,'accepted-checkout-buyer@drvn.test'),
    (outsider,'accepted-checkout-outsider@drvn.test');
  insert into public.listings(seller_id,title,category,price_cents,shipping_cents,currency,status)
  values(seller,'Accepted checkout fixture','engine',5000,500,'USD','reserved') returning id into listing;
  update public.listings set reserved_until=now()+interval '15 minutes' where id=listing;
  insert into public.offers(listing_id,buyer_id,amount_cents,status,responded_at)
  values(listing,buyer,4500,'accepted',now()) returning id into offer_id;
  insert into public.orders(
    buyer_id,seller_id,status,subtotal_cents,shipping_cents,platform_fee_cents,total_cents,
    currency,is_collection,origin_offer_id
  ) values(buyer,seller,'pending',4500,500,500,5000,'USD',false,offer_id) returning id into oid;
  insert into public.order_items(order_id,listing_id,title,price_cents,shipping_cents)
  values(oid,listing,'Accepted checkout fixture',4500,500);

  rejected:=false;
  begin perform public.freeze_accepted_offer_checkout(oid,outsider,first_snapshot); exception when others then rejected:=true; end;
  if not rejected or (select accepted_checkout_shipping from public.orders where id=oid) is not null then
    raise exception 'Unauthorized actor froze accepted-offer checkout';
  end if;

  update public.offers set status='open' where id=offer_id;
  rejected:=false;
  begin perform public.freeze_accepted_offer_checkout(oid,buyer,first_snapshot); exception when others then rejected:=true; end;
  if not rejected then raise exception 'Non-accepted offer crossed the payment boundary'; end if;
  update public.offers set status='accepted' where id=offer_id;
  update public.listings set reserved_until=now()-interval '1 minute' where id=listing;
  rejected:=false;
  begin perform public.freeze_accepted_offer_checkout(oid,buyer,first_snapshot); exception when others then rejected:=true; end;
  if not rejected then raise exception 'Expired accepted-offer reservation crossed the payment boundary'; end if;
  update public.listings set reserved_until=now()+interval '15 minutes' where id=listing;

  result:=public.freeze_accepted_offer_checkout(oid,buyer,first_snapshot);
  if coalesce((result->>'applied')::boolean,false) is not true
     or (select accepted_checkout_shipping from public.orders where id=oid)<>first_snapshot
     or (select ship_line1 from public.orders where id=oid)<>'10 Main Street' then
    raise exception 'Accepted-offer delivery snapshot was not frozen atomically';
  end if;
  result:=public.freeze_accepted_offer_checkout(oid,buyer,first_snapshot);
  if coalesce((result->>'replayed')::boolean,false) is not true then
    raise exception 'Exact accepted-offer checkout replay was not accepted';
  end if;

  rejected:=false;
  begin perform public.freeze_accepted_offer_checkout(oid,buyer,changed_snapshot); exception when others then rejected:=true; end;
  if not rejected or (select ship_line1 from public.orders where id=oid)<>'10 Main Street' then
    raise exception 'Changed accepted-offer replay replaced the frozen destination';
  end if;
  rejected:=false;
  begin update public.orders set ship_line1='Direct mutation' where id=oid; exception when others then rejected:=true; end;
  if not rejected or (select ship_line1 from public.orders where id=oid)<>'10 Main Street' then
    raise exception 'Direct write bypassed the immutable accepted-offer snapshot';
  end if;

  insert into public.orders(
    buyer_id,seller_id,status,subtotal_cents,shipping_cents,platform_fee_cents,total_cents,currency,is_collection
  ) values(buyer,seller,'pending',1000,100,110,1100,'USD',false) returning id into direct_order;
  rejected:=false;
  begin perform public.freeze_accepted_offer_checkout(direct_order,buyer,first_snapshot); exception when others then rejected:=true; end;
  if not rejected then raise exception 'Non-offer order entered accepted-offer checkout'; end if;

  update public.orders set status='cancelled' where id=oid;
  result:=public.freeze_accepted_offer_checkout(oid,buyer,first_snapshot);
  if coalesce((result->>'ok')::boolean,true) is not false
     or (select status from public.orders where id=oid)<>'cancelled' then
    raise exception 'Terminal accepted-offer reservation regressed during checkout replay';
  end if;
end $$;

do $$
begin
  if has_function_privilege('authenticated','public.freeze_accepted_offer_checkout(uuid,uuid,jsonb)','execute') then
    raise exception 'Client role can freeze privileged accepted-offer checkout state';
  end if;
  raise notice 'all accepted-offer checkout boundary checks passed';
end $$;

rollback;
