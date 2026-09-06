begin;
create table public.return_label_requests (
 return_id uuid primary key references public.returns(id) on delete cascade,
 provider text not null,
 rated jsonb not null check(jsonb_typeof(rated)='object'),
 shipment_id uuid not null unique references public.shipments(id),
 created_at timestamptz not null default now(),
 completed_at timestamptz,
 label jsonb,
 constraint return_label_completion_pair check ((completed_at is null) = (label is null))
);
alter table public.return_label_requests enable row level security;
revoke all on public.return_label_requests from public,anon,authenticated;
grant all on public.return_label_requests to service_role;
create function public.guard_return_label_request() returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
 if new.return_id<>old.return_id or new.provider<>old.provider or new.rated<>old.rated or new.shipment_id<>old.shipment_id
 or (old.label is not null and new.label is distinct from old.label)
 or (old.completed_at is not null and new.completed_at is distinct from old.completed_at)
 then raise exception 'Return label identity is immutable'; end if;
 return new;
end $$;
create trigger return_label_identity before update on public.return_label_requests for each row execute function public.guard_return_label_request();

create function public.prepare_return_label(p_return uuid,p_actor uuid,p_provider text,p_rated jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.returns; o public.orders; saved public.return_label_requests; sid uuid:=gen_random_uuid();
begin
 select * into strict r from public.returns where id=p_return;
 select * into strict o from public.orders where id=r.order_id for update;
 select * into strict r from public.returns where id=p_return for update;
 if p_actor is null or o.buyer_id is distinct from p_actor then raise exception 'Buyer authorization required' using errcode='42501'; end if;
 select * into saved from public.return_label_requests where return_id=p_return;
 if found then
   if saved.provider<>p_provider then raise exception 'Return label provider changed'; end if;
   return to_jsonb(saved);
 end if;
 if r.status<>'awaiting_shipment' or r.responsibility<>'seller' or o.seller_id is null or (r.ship_by is not null and r.ship_by<now()) then raise exception 'Return is not eligible for a prepaid label'; end if;
 if p_provider not in ('stub','easypost') or p_rated is null or jsonb_typeof(p_rated)<>'object'
 or nullif(p_rated->>'shipmentRef','') is null or nullif(p_rated->>'rateRef','') is null
 or nullif(p_rated->>'carrier','') is null or nullif(p_rated->>'service','') is null
 or upper(p_rated->>'currency') is distinct from upper(o.currency)
 or coalesce((p_rated->>'amountCents')::integer,-1)<0 then raise exception 'Invalid return label rate'; end if;
 if exists(select 1 from public.shipments where return_id=p_return and status not in ('cancelled','failed')) then raise exception 'Return shipment already exists'; end if;
 insert into public.shipments(id,order_id,direction,return_id,provider,provider_shipment_id,fulfillment_type,carrier,service,status)
 values(sid,o.id,'return',r.id,p_provider,p_rated->>'shipmentRef','drvn_shipping',p_rated->>'carrier',p_rated->>'service','pending');
 insert into public.shipment_items(shipment_id,order_item_id)
 select sid,order_item_id from public.return_items where return_id=r.id;
 if not found then raise exception 'Return has no items'; end if;
 insert into public.return_label_requests(return_id,provider,rated,shipment_id) values(r.id,p_provider,p_rated,sid) returning * into saved;
 -- A process can die after buying postage. Its saved provider identity and
 -- delayed outbox alert must survive even if no caller catches the crash.
 insert into public.admin_alert_outbox(kind,title,detail,order_id,amount_cents,payload,dedup_key,next_attempt_at)
 values('recovery_case_opened','Return label needs reconciliation','Check the saved return_label_requests provider shipment before buying any replacement label.',o.id,(p_rated->>'amountCents')::int,
 jsonb_build_object('return_id',r.id,'shipment_id',sid),'return-label:'||r.id,now()+interval '15 minutes') on conflict(dedup_key) do nothing;
 return to_jsonb(saved);
end $$;

create function public.complete_return_label(p_return uuid,p_label jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare saved public.return_label_requests; r public.returns; o public.orders; s public.shipments; adjustment public.seller_adjustments; amount integer;
begin
 select * into strict r from public.returns where id=p_return;
 select * into strict o from public.orders where id=r.order_id for update;
 select * into strict r from public.returns where id=p_return for update;
 select * into strict saved from public.return_label_requests where return_id=p_return for update;
 amount:=(p_label->>'amountCents')::integer;
 if p_label is null or jsonb_typeof(p_label)<>'object'
 or p_label->>'shipmentRef' is distinct from saved.rated->>'shipmentRef'
 or upper(p_label->>'currency') is distinct from upper(o.currency)
 or upper(p_label->>'currency') is distinct from upper(saved.rated->>'currency')
 or p_label->>'carrier' is distinct from saved.rated->>'carrier'
 or p_label->>'service' is distinct from saved.rated->>'service'
 or amount is null or amount<0 or amount is distinct from (saved.rated->>'amountCents')::integer
 or nullif(p_label->>'labelUrl','') is null or nullif(p_label->>'trackingCode','') is null
 then raise exception 'Purchased label does not match its frozen request'; end if;
 if saved.completed_at is not null then
   if saved.label<>p_label then raise exception 'Purchased label replay changed'; end if;
   return jsonb_build_object('ok',true,'label',saved.label);
 end if;
 select * into strict s from public.shipments where id=saved.shipment_id for update;
 if s.order_id<>o.id or s.return_id<>r.id or s.provider<>saved.provider or s.provider_shipment_id is distinct from saved.rated->>'shipmentRef'
 or (s.label_reference is not null and s.label_reference is distinct from p_label->>'labelUrl')
 then raise exception 'Return shipment identity changed'; end if;
 update public.shipments set provider_tracker_id=p_label->>'trackerRef',tracking_code=p_label->>'trackingCode',label_reference=p_label->>'labelUrl',purchased_cents=amount,
 status=case when status='pending' then 'label_purchased' else status end where id=s.id;
 insert into public.shipment_items(shipment_id,order_item_id) select s.id,order_item_id from public.return_items where return_id=r.id on conflict do nothing;
 if not exists(select 1 from public.shipment_items where shipment_id=s.id) then raise exception 'Return shipment has no item links'; end if;
 insert into public.seller_adjustments(seller_id,order_id,shipment_id,return_id,kind,amount_cents,currency,external_reference,description)
 values(o.seller_id,o.id,s.id,r.id,'return_label',-amount,o.currency,'retlabel:'||r.id,(p_label->>'carrier')||' '||(p_label->>'service')||' return label')
 on conflict(kind,external_reference) where external_reference is not null do nothing;
 select * into strict adjustment from public.seller_adjustments where kind='return_label' and external_reference='retlabel:'||r.id;
 if adjustment.seller_id is distinct from o.seller_id or adjustment.order_id<>o.id or adjustment.shipment_id is distinct from s.id or adjustment.return_id is distinct from r.id or adjustment.amount_cents<>-amount or upper(adjustment.currency)<>upper(o.currency) then raise exception 'Return label seller adjustment conflicts'; end if;
 update public.return_label_requests set completed_at=now(),label=p_label where return_id=p_return;
 delete from public.admin_alert_outbox where dedup_key='return-label:'||r.id and status='pending';
 return jsonb_build_object('ok',true,'label',p_label);
end $$;
revoke all on function public.prepare_return_label(uuid,uuid,text,jsonb),public.complete_return_label(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.prepare_return_label(uuid,uuid,text,jsonb),public.complete_return_label(uuid,jsonb) to service_role;


create function public.mark_return_dispatched(p_return uuid,p_actor uuid,p_carrier text,p_tracking text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.returns; o public.orders; s public.shipments; v_carrier text:=nullif(trim(p_carrier),''); v_tracking text:=nullif(trim(p_tracking),''); applied boolean:=false;
begin
 select * into strict r from public.returns where id=p_return;
 select * into strict o from public.orders where id=r.order_id for update;
 select * into strict r from public.returns where id=p_return for update;
 if p_actor is null or o.buyer_id is distinct from p_actor then raise exception 'Buyer authorization required' using errcode='42501'; end if;
 if r.status not in ('approved','awaiting_shipment','in_transit') then raise exception 'Return is not waiting for dispatch'; end if;
 if exists(select 1 from public.return_label_requests where return_id=r.id and completed_at is null) then raise exception 'Finish reconciling the prepaid label before adding tracking'; end if;
 if (select count(*) from public.shipments where return_id=r.id and status not in ('cancelled','failed'))>1 then raise exception 'Multiple return shipments require operator review'; end if;
 select * into s from public.shipments where return_id=r.id and status not in ('cancelled','failed') for update;
 if found then
   if s.status not in ('pending','label_purchased','in_transit') then raise exception 'Return shipment has already advanced'; end if;
   if s.label_reference is not null then
     if v_tracking is not null and v_tracking is distinct from s.tracking_code then raise exception 'Tracking differs from the prepaid label'; end if;
     v_tracking:=s.tracking_code; v_carrier:=s.carrier;
   elsif s.tracking_code is distinct from v_tracking or s.carrier is distinct from v_carrier then
     raise exception 'Return tracking changed after dispatch';
   end if;
 else
   if r.status='in_transit' then raise exception 'Return shipment record is missing'; end if;
   if v_carrier is null or v_tracking is null then raise exception 'Carrier and tracking are required'; end if;
   insert into public.shipments(order_id,direction,return_id,fulfillment_type,carrier,tracking_code,status,shipped_at)
   values(o.id,'return',r.id,'seller_arranged',v_carrier,v_tracking,'in_transit',now()) returning * into s;
 end if;
 if v_tracking is null or v_carrier is null then raise exception 'Return tracking is incomplete'; end if;
 insert into public.shipment_items(shipment_id,order_item_id) select s.id,order_item_id from public.return_items where return_id=r.id on conflict do nothing;
 if not exists(select 1 from public.shipment_items where shipment_id=s.id) then raise exception 'Return has no item links'; end if;
 if r.status<>'in_transit' then
   update public.shipments set status='in_transit',shipped_at=coalesce(shipped_at,now()) where id=s.id and status in ('pending','label_purchased');
   if r.status='approved' then update public.returns set status='awaiting_shipment' where id=r.id; end if;
   update public.returns set status='in_transit',shipped_at=coalesce(shipped_at,now()) where id=r.id;
   applied:=true;
 end if;
 return jsonb_build_object('ok',true,'applied',applied,'shipment_id',s.id,'manual',s.label_reference is null,'carrier',v_carrier,'tracking',v_tracking);
end $$;
revoke all on function public.mark_return_dispatched(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.mark_return_dispatched(uuid,uuid,text,text) to service_role;
notify pgrst,'reload schema';
commit;
