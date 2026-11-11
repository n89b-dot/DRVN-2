begin;

create function public.create_protection_return(
  p_order uuid,
  p_seller uuid,
  p_item_ids uuid[] default null,
  p_ship_days integer default 7
) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare
  o public.orders;
  selected_ids uuid[];
  selected_count integer;
  entitlement integer;
  existing_return uuid;
  new_return uuid;
  stamped_at timestamptz:=now();
begin
  if p_order is null or p_seller is null or p_ship_days is null or p_ship_days<1 or p_ship_days>30 then
    raise exception 'Invalid protection return request';
  end if;
  select * into strict o from public.orders where id=p_order for update;
  if o.seller_id is distinct from p_seller then raise exception 'Seller authorization required' using errcode='42501'; end if;
  if o.buyer_id is null then raise exception 'Protection return requires a buyer'; end if;

  perform 1 from public.order_items where order_id=o.id order by id for update;
  if coalesce(cardinality(p_item_ids),0)=0 then
    select array_agg(id order by id) into selected_ids from public.order_items where order_id=o.id;
  else
    select array_agg(distinct id order by id) into selected_ids from unnest(p_item_ids) id;
  end if;
  select count(*),coalesce(sum(price_cents+coalesce(shipping_cents,0)),0)
  into selected_count,entitlement from public.order_items
  where order_id=o.id and id=any(selected_ids);
  if coalesce(cardinality(selected_ids),0)=0 or selected_count<>cardinality(selected_ids) then
    raise exception 'Return items do not belong to this order';
  end if;

  select r.id into existing_return
  from public.returns r
  join public.return_items ri on ri.return_id=r.id
  where r.order_id=o.id and r.return_type='protection'
    and r.status in ('requested','approved','awaiting_shipment','in_transit','delivered','received','escalated')
  group by r.id
  having array_agg(ri.order_item_id order by ri.order_item_id)=selected_ids
  order by r.id limit 1;
  if found then
    return jsonb_build_object('ok',true,'return_id',existing_return,'order_id',o.id,'replayed',true);
  end if;
  if o.status<>'disputed' then raise exception 'Protection return requires an open dispute'; end if;

  delete from public.returns r where r.order_id=o.id and r.return_type='protection'
    and r.status in ('requested','approved','awaiting_shipment')
    and not exists(select 1 from public.return_items ri where ri.return_id=r.id)
    and not exists(select 1 from public.shipments s where s.return_id=r.id)
    and r.refund_operation_id is null;

  insert into public.returns(
    order_id,requested_by,return_type,reason,responsibility,status,
    approved_at,ship_by,refund_amount_cents
  ) values(
    o.id,o.buyer_id,'protection',o.dispute_reason,'seller','awaiting_shipment',
    stamped_at,stamped_at+make_interval(days=>p_ship_days),entitlement
  ) returning id into new_return;
  insert into public.return_items(return_id,order_item_id,reason)
  select new_return,id,o.dispute_reason from public.order_items
  where order_id=o.id and id=any(selected_ids);
  return jsonb_build_object('ok',true,'return_id',new_return,'order_id',o.id,'replayed',false);
end $$;

create function public.create_shop_policy_return(
  p_order uuid,
  p_buyer uuid,
  p_reason text default null
) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare
  o public.orders;
  item_ids uuid[];
  item_count integer;
  entitlement integer;
  policy_ok boolean;
  window_min integer;
  window_max integer;
  existing_return uuid;
  new_return uuid;
  saved_reason text:=coalesce(nullif(left(trim(coalesce(p_reason,'')),1000),''),'Preference return within the shop''s window');
begin
  if p_order is null or p_buyer is null then raise exception 'Order and buyer are required'; end if;
  select * into strict o from public.orders where id=p_order for update;
  if o.buyer_id is distinct from p_buyer then raise exception 'Buyer authorization required' using errcode='42501'; end if;
  if o.status not in ('delivered','completed') or o.delivered_at is null then
    raise exception 'Preference returns require delivery';
  end if;
  perform 1 from public.order_items where order_id=o.id order by id for update;
  select array_agg(id order by id),count(*),coalesce(sum(price_cents),0),
    bool_and(coalesce((commercial_snapshot#>>'{commercial,return_policy,returns_accepted}')::boolean,false)),
    min((commercial_snapshot#>>'{commercial,return_policy,window_days}')::integer),
    max((commercial_snapshot#>>'{commercial,return_policy,window_days}')::integer)
  into item_ids,item_count,entitlement,policy_ok,window_min,window_max
  from public.order_items where order_id=o.id;
  if item_count=0 then raise exception 'Order has no returnable items'; end if;
  if not coalesce(policy_ok,false) or window_min is null or window_min<>window_max or window_min not in (14,30,60) then
    raise exception 'Order does not have a consistent shop return policy';
  end if;

  select r.id into existing_return
  from public.returns r join public.return_items ri on ri.return_id=r.id
  where r.order_id=o.id and r.return_type='shop_policy' and r.requested_by=p_buyer
    and r.status in ('requested','approved','awaiting_shipment','in_transit','delivered','received','escalated')
  group by r.id
  having array_agg(ri.order_item_id order by ri.order_item_id)=item_ids
  order by r.id limit 1;
  if found then
    return jsonb_build_object('ok',true,'return_id',existing_return,'order_id',o.id,'replayed',true);
  end if;
  if o.delivered_at+make_interval(days=>window_min)<now() then raise exception 'Shop return window has closed'; end if;

  delete from public.returns r where r.order_id=o.id and r.return_type='shop_policy'
    and r.status in ('requested','approved','awaiting_shipment')
    and not exists(select 1 from public.return_items ri where ri.return_id=r.id)
    and not exists(select 1 from public.shipments s where s.return_id=r.id)
    and r.refund_operation_id is null;

  insert into public.returns(
    order_id,requested_by,return_type,reason,responsibility,status,refund_amount_cents
  ) values(o.id,p_buyer,'shop_policy',saved_reason,'buyer','requested',entitlement)
  returning id into new_return;
  insert into public.return_items(return_id,order_item_id,reason)
  select new_return,id,saved_reason from public.order_items where order_id=o.id;
  return jsonb_build_object('ok',true,'return_id',new_return,'order_id',o.id,'replayed',false);
end $$;

create function public.respond_shop_policy_return(
  p_return uuid,
  p_seller uuid,
  p_decision text,
  p_ship_days integer default 7
) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare
  r public.returns;
  o public.orders;
  return_order uuid;
  stamped_at timestamptz:=now();
begin
  if p_return is null or p_seller is null or p_decision not in ('approve','reject')
     or p_ship_days is null or p_ship_days<1 or p_ship_days>30 then
    raise exception 'Invalid shop return response';
  end if;
  select order_id into strict return_order from public.returns where id=p_return;
  select * into strict o from public.orders where id=return_order for update;
  select * into strict r from public.returns where id=p_return for update;
  if r.order_id<>o.id then raise exception 'Return order changed'; end if;
  if o.seller_id is distinct from p_seller then raise exception 'Seller authorization required' using errcode='42501'; end if;
  if r.return_type<>'shop_policy' then raise exception 'Return is not a shop-policy request'; end if;

  if p_decision='approve' and r.status='awaiting_shipment' and r.approved_at is not null and r.ship_by is not null then
    return jsonb_build_object('ok',true,'order_id',o.id,'return_id',r.id,'replayed',true,'status',r.status);
  elsif p_decision='approve' and r.status='approved' and r.approved_at is not null and r.ship_by is not null then
    update public.returns set status='awaiting_shipment' where id=r.id;
    return jsonb_build_object('ok',true,'order_id',o.id,'return_id',r.id,'replayed',false,'repaired',true,'status','awaiting_shipment');
  elsif p_decision='reject' and r.status='rejected' then
    return jsonb_build_object('ok',true,'order_id',o.id,'return_id',r.id,'replayed',true,'status',r.status);
  elsif r.status<>'requested' then
    return jsonb_build_object('ok',false,'order_id',o.id,'return_id',r.id,'reason','This return has already been handled.');
  end if;

  if p_decision='reject' then
    update public.returns set status='rejected' where id=r.id;
  else
    update public.returns set status='approved',approved_at=stamped_at,
      ship_by=stamped_at+make_interval(days=>p_ship_days) where id=r.id;
    update public.returns set status='awaiting_shipment' where id=r.id;
  end if;
  return jsonb_build_object('ok',true,'order_id',o.id,'return_id',r.id,'replayed',false,
    'status',case when p_decision='approve' then 'awaiting_shipment' else 'rejected' end);
end $$;

revoke all on function public.create_protection_return(uuid,uuid,uuid[],integer) from public,anon,authenticated;
revoke all on function public.create_shop_policy_return(uuid,uuid,text) from public,anon,authenticated;
revoke all on function public.respond_shop_policy_return(uuid,uuid,text,integer) from public,anon,authenticated;
grant execute on function public.create_protection_return(uuid,uuid,uuid[],integer) to service_role;
grant execute on function public.create_shop_policy_return(uuid,uuid,text) to service_role;
grant execute on function public.respond_shop_policy_return(uuid,uuid,text,integer) to service_role;

notify pgrst,'reload schema';
commit;
