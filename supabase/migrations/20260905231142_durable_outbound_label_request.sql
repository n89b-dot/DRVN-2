begin;

create table public.outbound_label_requests(
  shipment_id uuid primary key references public.shipments(id) on delete cascade,
  provider text not null,
  rated jsonb not null check(jsonb_typeof(rated)='object'),
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  label jsonb
);
alter table public.outbound_label_requests enable row level security;
revoke all on public.outbound_label_requests from public,anon,authenticated;
grant all on public.outbound_label_requests to service_role;

create function public.guard_outbound_label_request() returns trigger
language plpgsql set search_path=public,pg_temp as $$
begin
  if new.shipment_id<>old.shipment_id or new.provider<>old.provider or new.rated<>old.rated
     or (old.label is not null and new.label is distinct from old.label)
     or (old.completed_at is not null and new.completed_at is distinct from old.completed_at) then
    raise exception 'Outbound label identity is immutable';
  end if;
  return new;
end $$;
revoke all on function public.guard_outbound_label_request() from public,anon,authenticated;
create trigger outbound_label_identity before update on public.outbound_label_requests
for each row execute function public.guard_outbound_label_request();

create function public.prepare_outbound_label(
  p_shipment uuid,p_actor uuid,p_provider text,p_rated jsonb
) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare
  shipment_order uuid;
  s public.shipments;
  o public.orders;
  saved public.outbound_label_requests;
begin
  select order_id into strict shipment_order from public.shipments where id=p_shipment;
  select * into strict o from public.orders where id=shipment_order for update;
  select * into strict s from public.shipments where id=p_shipment for update;
  if s.order_id<>o.id then raise exception 'Shipment order changed'; end if;
  if p_actor is null or o.seller_id is distinct from p_actor then raise exception 'Seller authorization required' using errcode='42501'; end if;
  select * into saved from public.outbound_label_requests where shipment_id=s.id;
  if found then
    if saved.provider<>p_provider then raise exception 'Outbound label provider changed'; end if;
    return to_jsonb(saved);
  end if;
  if o.status<>'paid' or o.is_collection or s.direction<>'outbound'
     or s.fulfillment_type<>'drvn_shipping' or s.status<>'pending' then
    raise exception 'Shipment is not eligible for label purchase';
  end if;
  if p_provider not in ('stub','easypost') or p_rated is null or jsonb_typeof(p_rated)<>'object'
     or nullif(p_rated->>'shipmentRef','') is null or nullif(p_rated->>'rateRef','') is null
     or nullif(p_rated->>'carrier','') is null or nullif(p_rated->>'service','') is null
     or upper(p_rated->>'currency') is distinct from upper(o.currency)
     or coalesce((p_rated->>'amountCents')::integer,-1)<0 then
    raise exception 'Invalid outbound label rate';
  end if;
  if not exists(select 1 from public.shipment_items where shipment_id=s.id) then
    raise exception 'Outbound shipment has no item links';
  end if;
  update public.shipments set provider=p_provider,
    provider_shipment_id=p_rated->>'shipmentRef',carrier=p_rated->>'carrier',service=p_rated->>'service'
  where id=s.id;
  insert into public.outbound_label_requests(shipment_id,provider,rated)
  values(s.id,p_provider,p_rated) returning * into saved;
  insert into public.admin_alert_outbox(kind,title,detail,order_id,amount_cents,payload,dedup_key,next_attempt_at)
  values('recovery_case_opened','Outbound label needs reconciliation',
    'Check the saved outbound_label_requests provider shipment before buying any replacement label.',
    o.id,(p_rated->>'amountCents')::integer,jsonb_build_object('shipment_id',s.id),
    'outbound-label:'||s.id,now()+interval '15 minutes') on conflict(dedup_key) do nothing;
  return to_jsonb(saved);
end $$;

create function public.complete_outbound_label(p_shipment uuid,p_label jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
  shipment_order uuid;
  saved public.outbound_label_requests;
  s public.shipments;
  o public.orders;
  adjustment public.seller_adjustments;
  amount integer;
begin
  select order_id into strict shipment_order from public.shipments where id=p_shipment;
  select * into strict o from public.orders where id=shipment_order for update;
  select * into strict s from public.shipments where id=p_shipment for update;
  select * into strict saved from public.outbound_label_requests where shipment_id=p_shipment for update;
  amount:=(p_label->>'amountCents')::integer;
  if p_label is null or jsonb_typeof(p_label)<>'object'
     or p_label->>'shipmentRef' is distinct from saved.rated->>'shipmentRef'
     or upper(p_label->>'currency') is distinct from upper(o.currency)
     or upper(p_label->>'currency') is distinct from upper(saved.rated->>'currency')
     or p_label->>'carrier' is distinct from saved.rated->>'carrier'
     or p_label->>'service' is distinct from saved.rated->>'service'
     or amount is null or amount<0 or amount is distinct from (saved.rated->>'amountCents')::integer
     or nullif(p_label->>'labelUrl','') is null or nullif(p_label->>'trackingCode','') is null then
    raise exception 'Purchased outbound label does not match its frozen request';
  end if;
  if saved.completed_at is not null then
    if saved.label<>p_label then raise exception 'Purchased outbound label replay changed'; end if;
    return jsonb_build_object('ok',true,'label',saved.label,'replayed',true);
  end if;
  if s.order_id<>o.id or s.direction<>'outbound' or s.fulfillment_type<>'drvn_shipping'
     or s.provider<>saved.provider or s.provider_shipment_id is distinct from saved.rated->>'shipmentRef'
     or s.status<>'pending' then raise exception 'Outbound shipment identity changed'; end if;

  update public.shipments set status='label_purchased',purchased_cents=amount,
    label_reference=p_label->>'labelUrl',tracking_code=p_label->>'trackingCode',
    provider_tracker_id=p_label->>'trackerRef',carrier=p_label->>'carrier',service=p_label->>'service'
  where id=s.id;
  insert into public.seller_adjustments(
    seller_id,order_id,shipment_id,kind,amount_cents,currency,external_reference,description
  ) values(
    o.seller_id,o.id,s.id,'outbound_label',-amount,o.currency,'label:'||s.id,
    (p_label->>'carrier')||' '||(p_label->>'service')||' outbound label'
  ) on conflict(kind,external_reference) where external_reference is not null do nothing;
  select * into strict adjustment from public.seller_adjustments
  where kind='outbound_label' and external_reference='label:'||s.id;
  if adjustment.seller_id is distinct from o.seller_id or adjustment.order_id<>o.id
     or adjustment.shipment_id is distinct from s.id or adjustment.amount_cents<>-amount
     or upper(adjustment.currency)<>upper(o.currency) then
    raise exception 'Outbound label seller adjustment conflicts';
  end if;
  update public.outbound_label_requests set completed_at=now(),label=p_label where shipment_id=s.id;
  delete from public.admin_alert_outbox where dedup_key='outbound-label:'||s.id and status='pending';
  return jsonb_build_object('ok',true,'label',p_label,'replayed',false);
end $$;

-- Repairs the old application sequence where shipment label fields could
-- commit before the seller adjustment. It never calls the provider and only
-- trusts a complete, internally consistent purchased shipment.
create function public.repair_completed_outbound_label(p_shipment uuid,p_actor uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
  shipment_order uuid;
  s public.shipments;
  o public.orders;
  adjustment public.seller_adjustments;
begin
  select order_id into strict shipment_order from public.shipments where id=p_shipment;
  select * into strict o from public.orders where id=shipment_order for update;
  select * into strict s from public.shipments where id=p_shipment for update;
  if p_actor is null or o.seller_id is distinct from p_actor then raise exception 'Seller authorization required' using errcode='42501'; end if;
  if s.order_id<>o.id or s.direction<>'outbound' or s.fulfillment_type<>'drvn_shipping'
     or s.status<>'label_purchased' or s.purchased_cents is null or s.purchased_cents<0
     or nullif(s.provider_shipment_id,'') is null or nullif(s.label_reference,'') is null
     or nullif(s.tracking_code,'') is null or nullif(s.carrier,'') is null or nullif(s.service,'') is null
     or not exists(select 1 from public.shipment_items where shipment_id=s.id) then
    raise exception 'Completed outbound shipment is incomplete';
  end if;
  insert into public.seller_adjustments(
    seller_id,order_id,shipment_id,kind,amount_cents,currency,external_reference,description
  ) values(
    o.seller_id,o.id,s.id,'outbound_label',-s.purchased_cents,o.currency,'label:'||s.id,
    s.carrier||' '||s.service||' outbound label'
  ) on conflict(kind,external_reference) where external_reference is not null do nothing;
  select * into strict adjustment from public.seller_adjustments
  where kind='outbound_label' and external_reference='label:'||s.id;
  if adjustment.seller_id is distinct from o.seller_id or adjustment.order_id<>o.id
     or adjustment.shipment_id is distinct from s.id or adjustment.amount_cents<>-s.purchased_cents
     or upper(adjustment.currency)<>upper(o.currency) then
    raise exception 'Completed outbound label seller adjustment conflicts';
  end if;
  return jsonb_build_object('ok',true,'label_url',s.label_reference);
end $$;

revoke all on function public.prepare_outbound_label(uuid,uuid,text,jsonb) from public,anon,authenticated;
revoke all on function public.complete_outbound_label(uuid,jsonb) from public,anon,authenticated;
revoke all on function public.repair_completed_outbound_label(uuid,uuid) from public,anon,authenticated;
grant execute on function public.prepare_outbound_label(uuid,uuid,text,jsonb) to service_role;
grant execute on function public.complete_outbound_label(uuid,jsonb) to service_role;
grant execute on function public.repair_completed_outbound_label(uuid,uuid) to service_role;

notify pgrst,'reload schema';
commit;
