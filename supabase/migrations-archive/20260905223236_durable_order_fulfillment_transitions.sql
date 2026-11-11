begin;

-- The first accepted-offer checkout attempt freezes the delivery snapshot
-- before crossing the provider boundary. Later retries may replay that exact
-- snapshot, but cannot silently move an already-created payment to a new
-- destination.
alter table public.orders add column if not exists accepted_checkout_shipping jsonb;

update public.orders o set accepted_checkout_shipping=jsonb_build_object(
  'name',o.ship_name,'line1',o.ship_line1,'line2',o.ship_line2,'city',o.ship_city,
  'postcode',o.ship_postcode,'country',o.ship_country,'state',o.ship_state,
  'phone',o.ship_phone,'isCollection',o.is_collection
)
where o.origin_offer_id is not null and o.accepted_checkout_shipping is null
and exists(
  select 1 from public.payment_requests p
  where p.request->'orderIds' ? o.id::text
);

create or replace function public.guard_accepted_checkout_shipping()
returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
  if old.accepted_checkout_shipping is not null and (
    new.accepted_checkout_shipping is distinct from old.accepted_checkout_shipping
    or new.ship_name is distinct from old.ship_name
    or new.ship_line1 is distinct from old.ship_line1
    or new.ship_line2 is distinct from old.ship_line2
    or new.ship_city is distinct from old.ship_city
    or new.ship_postcode is distinct from old.ship_postcode
    or new.ship_country is distinct from old.ship_country
    or new.ship_state is distinct from old.ship_state
    or new.ship_phone is distinct from old.ship_phone
    or new.is_collection is distinct from old.is_collection
  ) then raise exception 'Accepted-offer delivery details are immutable after checkout starts'; end if;
  return new;
end $$;
revoke all on function public.guard_accepted_checkout_shipping() from public,anon,authenticated;

drop trigger if exists orders_accepted_checkout_shipping_guard on public.orders;
create trigger orders_accepted_checkout_shipping_guard
before update on public.orders for each row execute function public.guard_accepted_checkout_shipping();

create function public.freeze_accepted_offer_checkout(
  p_order uuid,
  p_actor uuid,
  p_shipping jsonb
) returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  o public.orders;
  collection boolean;
  offer_status text;
  listing_status text;
  listing_reserved_until timestamptz;
begin
  if p_order is null or p_actor is null or p_shipping is null or jsonb_typeof(p_shipping)<>'object' then
    raise exception 'Invalid accepted-offer checkout';
  end if;
  collection:=(p_shipping->>'isCollection')::boolean;
  if nullif(trim(p_shipping->>'name'),'') is null or collection is null then
    raise exception 'Invalid accepted-offer delivery details';
  end if;
  if not collection and (
    nullif(trim(p_shipping->>'line1'),'') is null
    or nullif(trim(p_shipping->>'city'),'') is null
    or nullif(trim(p_shipping->>'postcode'),'') is null
    or nullif(trim(p_shipping->>'country'),'') is null
  ) then raise exception 'Delivery address is incomplete'; end if;

  select * into strict o from public.orders where id=p_order for update;
  if o.buyer_id is distinct from p_actor then raise exception 'Buyer authorization required' using errcode='42501'; end if;
  if o.origin_offer_id is null then raise exception 'Order is not an accepted-offer reservation'; end if;
  select ofr.status,l.status,l.reserved_until
  into offer_status,listing_status,listing_reserved_until
  from public.offers ofr
  join public.order_items oi on oi.order_id=o.id and oi.listing_id=ofr.listing_id
  join public.listings l on l.id=ofr.listing_id
  where ofr.id=o.origin_offer_id and ofr.buyer_id=o.buyer_id and l.seller_id=o.seller_id
  for update of ofr,l;
  if not found then raise exception 'Accepted-offer reservation identity is inconsistent'; end if;
  if o.status<>'pending' then
    return jsonb_build_object('ok',false,'applied',false,'status',o.status,'reason','Accepted-offer reservation is no longer pending.');
  end if;
  if o.accepted_checkout_shipping is not null then
    if o.accepted_checkout_shipping<>p_shipping then
      raise exception 'Accepted-offer delivery details changed after checkout started';
    end if;
    return jsonb_build_object('ok',true,'applied',false,'replayed',true,'status',o.status);
  end if;
  if offer_status<>'accepted' or listing_status<>'reserved'
     or listing_reserved_until is null or listing_reserved_until<=now() then
    raise exception 'Accepted-offer reservation is no longer available';
  end if;

  update public.orders set
    ship_name=p_shipping->>'name',
    ship_line1=coalesce(p_shipping->>'line1',''),
    ship_line2=nullif(p_shipping->>'line2',''),
    ship_city=coalesce(p_shipping->>'city',''),
    ship_postcode=coalesce(p_shipping->>'postcode',''),
    ship_country=coalesce(p_shipping->>'country',''),
    ship_state=nullif(p_shipping->>'state',''),
    ship_phone=nullif(p_shipping->>'phone',''),
    is_collection=collection,
    accepted_checkout_shipping=p_shipping
  where id=o.id;
  return jsonb_build_object('ok',true,'applied',true,'replayed',false,'status',o.status);
end $$;

revoke all on function public.freeze_accepted_offer_checkout(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.freeze_accepted_offer_checkout(uuid,uuid,jsonb) to service_role;

-- Dispatch is one local transaction: the order transition, authoritative
-- shipment row, and item links either all commit or all roll back. Exact
-- replays return the existing result after a lost Server Action response.
create function public.mark_order_dispatched(
  p_order uuid,
  p_actor uuid,
  p_carrier text,
  p_tracking text
) returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  o public.orders;
  shipment public.shipments;
  normalized_carrier text:=nullif(left(trim(coalesce(p_carrier,'')),200),'');
  normalized_tracking text:=nullif(left(trim(coalesce(p_tracking,'')),200),'');
  stamped_at timestamptz:=now();
  live_count integer;
begin
  if p_order is null or p_actor is null then raise exception 'Order and actor are required'; end if;
  select * into strict o from public.orders where id=p_order for update;
  if o.seller_id is distinct from p_actor then raise exception 'Seller authorization required' using errcode='42501'; end if;
  if o.is_collection then raise exception 'Collection orders use the pickup handoff'; end if;
  if normalized_carrier is null or normalized_tracking is null then raise exception 'Carrier and tracking are required'; end if;

  if o.status in ('shipped','delivered','completed') then
    if o.shipped_at is null or o.carrier is distinct from normalized_carrier or o.tracking_number is distinct from normalized_tracking then
      raise exception 'Dispatch replay does not match the recorded shipment';
    end if;
    select count(*) into live_count from public.shipments
    where order_id=o.id and direction='outbound' and status not in ('cancelled','failed');
    if live_count>1 then raise exception 'Order has multiple live outbound shipments'; end if;
    select * into shipment from public.shipments
    where order_id=o.id and direction='outbound' and status not in ('cancelled','failed')
    order by created_at,id limit 1 for update;
    if found then
      if shipment.tracking_code is distinct from normalized_tracking
         or shipment.carrier is distinct from normalized_carrier then
        raise exception 'Dispatch replay does not match the live shipment';
      end if;
      if shipment.status in ('pending','label_purchased') then
        update public.shipments set status='in_transit',shipped_at=coalesce(shipped_at,o.shipped_at)
        where id=shipment.id returning * into shipment;
      end if;
    else
      insert into public.shipments(
        order_id,direction,fulfillment_type,carrier,status,tracking_code,shipped_at
      ) values(
        o.id,'outbound','seller_arranged',normalized_carrier,'in_transit',normalized_tracking,o.shipped_at
      ) returning * into shipment;
    end if;
    insert into public.shipment_items(shipment_id,order_item_id)
    select shipment.id,id from public.order_items where order_id=o.id
    on conflict do nothing;
    if not exists(select 1 from public.shipment_items where shipment_id=shipment.id) then
      raise exception 'Dispatch shipment has no order items';
    end if;
    return jsonb_build_object('ok',true,'applied',false,'replayed',true,'status',o.status,'shipment_id',shipment.id);
  end if;
  if o.status<>'paid' then
    return jsonb_build_object('ok',false,'applied',false,'status',o.status,'reason','Only a paid order can be dispatched.');
  end if;

  select count(*) into live_count from public.shipments
  where order_id=o.id and direction='outbound' and status not in ('cancelled','failed');
  if live_count>1 then raise exception 'Order has multiple live outbound shipments'; end if;
  select * into shipment from public.shipments
  where order_id=o.id and direction='outbound' and status not in ('cancelled','failed')
  order by created_at,id limit 1 for update;
  if found then
    if shipment.tracking_code is distinct from normalized_tracking or shipment.carrier is distinct from normalized_carrier then
      if shipment.fulfillment_type='drvn_shipping' and shipment.status='pending' then
        update public.shipments set status='cancelled' where id=shipment.id;
        shipment:=null;
      else
        raise exception 'A live outbound shipment already has different tracking';
      end if;
    elsif shipment.status in ('pending','label_purchased') then
      update public.shipments set status='in_transit',shipped_at=coalesce(shipped_at,stamped_at)
      where id=shipment.id returning * into shipment;
    end if;
    if shipment.id is not null then
      insert into public.shipment_items(shipment_id,order_item_id)
      select shipment.id,id from public.order_items where order_id=o.id
      on conflict do nothing;
      if not exists(select 1 from public.shipment_items where shipment_id=shipment.id) then
        raise exception 'Dispatch shipment has no order items';
      end if;
    end if;
  end if;

  if shipment.id is null then
    insert into public.shipments(
      order_id,direction,fulfillment_type,carrier,status,tracking_code,shipped_at
    ) values(
      o.id,'outbound','seller_arranged',normalized_carrier,'in_transit',normalized_tracking,stamped_at
    ) returning * into shipment;
    insert into public.shipment_items(shipment_id,order_item_id)
    select shipment.id,id from public.order_items where order_id=o.id
    on conflict do nothing;
    if not exists(select 1 from public.shipment_items where shipment_id=shipment.id) then
      raise exception 'Dispatch shipment has no order items';
    end if;
  end if;

  update public.orders set
    status='shipped',carrier=normalized_carrier,tracking_number=normalized_tracking,shipped_at=stamped_at
  where id=o.id;
  return jsonb_build_object('ok',true,'applied',true,'replayed',false,'status','shipped','shipment_id',shipment.id);
end $$;

revoke all on function public.mark_order_dispatched(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.mark_order_dispatched(uuid,uuid,text,text) to service_role;

-- Receipt and payout scheduling share one commit. A replay repairs a legacy
-- missing schedule from the original delivered_at rather than extending the
-- clearing window from the retry time.
create function public.mark_order_received(
  p_order uuid,
  p_actor uuid,
  p_hold_days integer default 7
) returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  o public.orders;
  intent public.transfer_intents;
  stamped_at timestamptz:=now();
  applied boolean:=false;
  stub_settlement boolean:=false;
begin
  if p_order is null or p_actor is null or p_hold_days is null or p_hold_days<0 or p_hold_days>30 then
    raise exception 'Invalid receipt transition';
  end if;
  select * into strict o from public.orders where id=p_order for update;
  if o.buyer_id is distinct from p_actor then raise exception 'Buyer authorization required' using errcode='42501'; end if;
  if o.is_collection then raise exception 'Collection orders use the pickup handoff'; end if;
  if o.status not in ('shipped','delivered','completed') then
    return jsonb_build_object('ok',false,'applied',false,'status',o.status,'reason','Only a dispatched order can be received.');
  end if;

  select * into intent from public.transfer_intents where order_id=o.id for update;
  if not found then
    select exists(
      select 1 from public.payments p where p.order_id=o.id
      and p.provider='stub' and p.status='succeeded' and p.provider_reference is not null
      and p.amount_cents=o.total_cents and lower(p.currency)=lower(o.currency)
    ) into stub_settlement;
    if not stub_settlement then raise exception 'Seller transfer obligation is missing'; end if;
  end if;

  if o.status='shipped' then
    update public.orders set status='delivered',delivered_at=stamped_at,completed_at=stamped_at where id=o.id;
    o.status:='delivered';
    o.delivered_at:=stamped_at;
    applied:=true;
    update public.shipments set status='delivered',delivered_at=coalesce(delivered_at,stamped_at)
    where order_id=o.id and direction='outbound' and status in ('label_purchased','in_transit','out_for_delivery');
  elsif o.delivered_at is null then
    raise exception 'Delivered order is missing its receipt timestamp';
  end if;

  if not stub_settlement then
    update public.transfer_intents set
      available_at=coalesce(available_at,o.delivered_at+make_interval(days=>p_hold_days)),
      updated_at=now()
    where order_id=o.id and status='holding';
  end if;

  return jsonb_build_object(
    'ok',true,'applied',applied,'replayed',not applied,'status',o.status,
    'available_at',(select available_at from public.transfer_intents where order_id=o.id)
  );
end $$;

revoke all on function public.mark_order_received(uuid,uuid,integer) from public,anon,authenticated;
grant execute on function public.mark_order_received(uuid,uuid,integer) to service_role;

notify pgrst,'reload schema';
commit;
