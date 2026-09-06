begin;

-- A label refund is an external write which may take weeks to settle. Freeze
-- its exact provider and ledger identity before the first POST, then require
-- retries to reconcile that same provider Shipment instead of submitting a
-- second refund blindly.
create table public.outbound_label_void_requests (
  shipment_id uuid primary key references public.shipments(id),
  order_id uuid not null references public.orders(id),
  seller_id uuid not null references public.profiles(id),
  provider text not null,
  provider_shipment_reference text not null,
  amount_cents integer not null check (amount_cents >= 0),
  currency text not null,
  status text not null default 'requested'
    check (status in ('requested','provider_pending','completed','rejected')),
  provider_state text
    check (provider_state in ('not_requested','submitted','refunded','rejected','unknown')),
  claim_owner uuid,
  claim_expires_at timestamptz,
  provider_observed_at timestamptz,
  attempts integer not null default 0 check (attempts >= 0),
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  rejected_at timestamptz
);

alter table public.outbound_label_void_requests enable row level security;
revoke all on public.outbound_label_void_requests from public, anon, authenticated;
grant all on public.outbound_label_void_requests to service_role;

create function public.guard_outbound_label_void_request()
returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
  if new.shipment_id<>old.shipment_id or new.order_id<>old.order_id
     or new.seller_id<>old.seller_id or new.provider<>old.provider
     or new.provider_shipment_reference<>old.provider_shipment_reference
     or new.amount_cents<>old.amount_cents or new.currency<>old.currency
     or new.created_at<>old.created_at
     or (old.completed_at is not null and new.completed_at is distinct from old.completed_at)
     or (old.rejected_at is not null and new.rejected_at is distinct from old.rejected_at) then
    raise exception 'Outbound label void identity is immutable';
  end if;
  return new;
end $$;
revoke all on function public.guard_outbound_label_void_request() from public,anon,authenticated;
create trigger outbound_label_void_identity before update on public.outbound_label_void_requests
for each row execute function public.guard_outbound_label_void_request();

create function public.prepare_outbound_label_void(
  p_shipment uuid, p_actor uuid, p_provider text
) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare
  shipment_order uuid;
  s public.shipments;
  o public.orders;
  original public.seller_adjustments;
  saved public.outbound_label_void_requests;
begin
  select order_id into strict shipment_order from public.shipments where id=p_shipment;
  select * into strict o from public.orders where id=shipment_order for update;
  select * into strict s from public.shipments where id=p_shipment for update;
  if s.order_id<>o.id then raise exception 'Shipment order changed'; end if;
  if p_actor is null or o.seller_id is distinct from p_actor then
    raise exception 'Seller authorization required' using errcode='42501';
  end if;
  if p_provider is null then raise exception 'Shipping provider required'; end if;

  select * into saved from public.outbound_label_void_requests where shipment_id=s.id for update;
  if found then
    if saved.order_id<>o.id or saved.seller_id is distinct from o.seller_id
       or saved.provider<>p_provider or saved.provider is distinct from s.provider
       or saved.provider_shipment_reference is distinct from s.provider_shipment_id
       or saved.amount_cents is distinct from s.purchased_cents
       or upper(saved.currency)<>upper(o.currency) then
      raise exception 'Saved outbound label void identity conflicts';
    end if;
    return to_jsonb(saved);
  end if;

  if s.direction<>'outbound' or s.fulfillment_type<>'drvn_shipping'
     or s.status<>'label_purchased' or p_provider not in ('stub','easypost')
     or s.provider is distinct from p_provider
     or nullif(s.provider_shipment_id,'') is null
     or s.purchased_cents is null or s.purchased_cents<0
     or nullif(o.currency,'') is null then
    raise exception 'Shipment is not eligible for label void';
  end if;

  select * into strict original from public.seller_adjustments
  where kind='outbound_label' and external_reference='label:'||s.id;
  if original.seller_id is distinct from o.seller_id or original.order_id is distinct from o.id
     or original.shipment_id is distinct from s.id or original.return_id is not null
     or original.amount_cents<>-s.purchased_cents or upper(original.currency)<>upper(o.currency)
     or original.voided_at is not null then
    raise exception 'Outbound label purchase adjustment does not match shipment';
  end if;

  insert into public.outbound_label_void_requests(
    shipment_id,order_id,seller_id,provider,provider_shipment_reference,amount_cents,currency
  ) values(s.id,o.id,o.seller_id,p_provider,s.provider_shipment_id,s.purchased_cents,o.currency)
  returning * into saved;

  insert into public.admin_alert_outbox(
    kind,title,detail,order_id,amount_cents,payload,dedup_key,next_attempt_at
  ) values(
    'recovery_case_opened','Outbound label refund needs reconciliation',
    'Reconcile the frozen provider shipment before submitting another label refund.',
    o.id,s.purchased_cents,jsonb_build_object('shipment_id',s.id),
    'outbound-label-void:'||s.id,now()+interval '15 minutes'
  ) on conflict(dedup_key) do nothing;
  return to_jsonb(saved);
end $$;

create function public.claim_outbound_label_void(
  p_shipment uuid, p_worker uuid
) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare saved public.outbound_label_void_requests;
begin
  if p_worker is null then raise exception 'Worker identity required'; end if;
  select * into strict saved from public.outbound_label_void_requests
  where shipment_id=p_shipment for update;
  if saved.status='completed' then
    return jsonb_build_object('action','completed','request',to_jsonb(saved));
  elsif saved.status='rejected' then
    return jsonb_build_object('action','rejected','request',to_jsonb(saved));
  elsif saved.status='provider_pending' and saved.claim_owner=p_worker
        and saved.claim_expires_at>now() then
    -- A second call by the same worker is the final fence immediately before
    -- POST. A stale worker whose lease was reassigned receives reconcile.
    return jsonb_build_object('action','dispatch','request',to_jsonb(saved));
  elsif saved.status='requested' or (
    saved.status='provider_pending'
    and saved.claim_expires_at<=now()
    and saved.provider_state='not_requested'
    and saved.provider_observed_at>=saved.claim_expires_at
  ) then
    update public.outbound_label_void_requests
    set status='provider_pending',claim_owner=p_worker,
        claim_expires_at=now()+interval '2 minutes',attempts=attempts+1,
        provider_state=null,provider_observed_at=null,last_error=null,updated_at=now()
    where shipment_id=p_shipment returning * into saved;
    return jsonb_build_object('action','dispatch','request',to_jsonb(saved));
  end if;
  return jsonb_build_object('action','reconcile','request',to_jsonb(saved));
end $$;

create function public.record_outbound_label_void_observation(
  p_shipment uuid, p_worker uuid, p_source text, p_state text, p_detail text default null
) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare
  saved public.outbound_label_void_requests;
  s public.shipments;
  o public.orders;
  original public.seller_adjustments;
  reversal public.seller_adjustments;
begin
  if p_worker is null or p_source is null or p_source not in ('dispatch','reconcile')
     or p_state is null or p_state not in ('not_requested','submitted','refunded','rejected','unknown') then
    raise exception 'Invalid outbound label void observation';
  end if;
  select * into strict saved from public.outbound_label_void_requests
  where shipment_id=p_shipment;
  select * into strict o from public.orders where id=saved.order_id for update;
  select * into strict s from public.shipments where id=p_shipment for update;
  select * into strict saved from public.outbound_label_void_requests
  where shipment_id=p_shipment for update;

  if p_source='dispatch' and saved.claim_owner is distinct from p_worker then
    raise exception 'Outbound label void worker does not own provider dispatch' using errcode='42501';
  end if;
  if p_source='dispatch' and p_state='not_requested' then
    raise exception 'A dispatch response cannot prove no request exists';
  end if;
  if saved.status='completed' then
    if p_state<>'refunded' then raise exception 'Completed label void cannot regress'; end if;
    return jsonb_build_object('state','refunded','replayed',true);
  elsif saved.status='rejected' then
    if p_state<>'rejected' then raise exception 'Rejected label void cannot change outcome'; end if;
    return jsonb_build_object('state','rejected','replayed',true);
  elsif saved.status<>'provider_pending' then
    raise exception 'Outbound label void has not been claimed';
  end if;

  if saved.order_id<>o.id or saved.seller_id is distinct from o.seller_id
     or s.order_id<>o.id or saved.provider is distinct from s.provider
     or saved.provider_shipment_reference is distinct from s.provider_shipment_id
     or saved.amount_cents is distinct from s.purchased_cents
     or upper(saved.currency)<>upper(o.currency) then
    raise exception 'Outbound label void identity changed';
  end if;

  if p_state in ('not_requested','submitted','unknown') then
    update public.outbound_label_void_requests
    set provider_state=p_state,provider_observed_at=now(),last_error=left(p_detail,500),updated_at=now()
    where shipment_id=p_shipment returning * into saved;
    return jsonb_build_object('state','pending','request',to_jsonb(saved));
  elsif p_state='rejected' then
    update public.outbound_label_void_requests
    set status='rejected',provider_state='rejected',provider_observed_at=now(),
        rejected_at=now(),claim_owner=null,claim_expires_at=null,last_error=left(p_detail,500),updated_at=now()
    where shipment_id=p_shipment;
    delete from public.admin_alert_outbox
    where dedup_key='outbound-label-void:'||p_shipment and status='pending';
    return jsonb_build_object('state','rejected','replayed',false);
  end if;

  if s.status<>'label_purchased' then raise exception 'Outbound shipment is no longer voidable'; end if;
  select * into strict original from public.seller_adjustments
  where kind='outbound_label' and external_reference='label:'||s.id;
  if original.seller_id is distinct from saved.seller_id or original.order_id is distinct from saved.order_id
     or original.shipment_id is distinct from saved.shipment_id or original.return_id is not null
     or original.amount_cents<>-saved.amount_cents
     or upper(original.currency)<>upper(saved.currency) or original.voided_at is not null then
    raise exception 'Outbound label purchase adjustment changed';
  end if;

  if saved.amount_cents>0 then
    insert into public.seller_adjustments(
      seller_id,order_id,shipment_id,kind,amount_cents,currency,external_reference,description
    ) values(
      saved.seller_id,saved.order_id,saved.shipment_id,'label_refund',saved.amount_cents,
      saved.currency,'label:'||saved.shipment_id||':refund','Label voided/refunded'
    ) on conflict(kind,external_reference) where external_reference is not null do nothing;
    select * into strict reversal from public.seller_adjustments
    where kind='label_refund' and external_reference='label:'||saved.shipment_id||':refund';
    if reversal.seller_id is distinct from saved.seller_id or reversal.order_id is distinct from saved.order_id
       or reversal.shipment_id is distinct from saved.shipment_id or reversal.return_id is not null
       or reversal.amount_cents<>saved.amount_cents
       or upper(reversal.currency)<>upper(saved.currency) or reversal.voided_at is not null then
      raise exception 'Outbound label refund adjustment conflicts';
    end if;
  elsif exists(
    select 1 from public.seller_adjustments
    where kind='label_refund' and external_reference='label:'||saved.shipment_id||':refund'
  ) then
    raise exception 'Zero-cost outbound label has a conflicting refund adjustment';
  end if;

  update public.shipments set status='cancelled' where id=s.id;
  update public.outbound_label_void_requests
  set status='completed',provider_state='refunded',provider_observed_at=now(),completed_at=now(),
      claim_owner=null,claim_expires_at=null,last_error=null,updated_at=now()
  where shipment_id=s.id;
  delete from public.admin_alert_outbox
  where dedup_key='outbound-label-void:'||s.id and status='pending';
  return jsonb_build_object('state','refunded','replayed',false);
end $$;

revoke all on function public.prepare_outbound_label_void(uuid,uuid,text) from public,anon,authenticated;
revoke all on function public.claim_outbound_label_void(uuid,uuid) from public,anon,authenticated;
revoke all on function public.record_outbound_label_void_observation(uuid,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.prepare_outbound_label_void(uuid,uuid,text) to service_role;
grant execute on function public.claim_outbound_label_void(uuid,uuid) to service_role;
grant execute on function public.record_outbound_label_void_observation(uuid,uuid,text,text,text) to service_role;

notify pgrst,'reload schema';
commit;
