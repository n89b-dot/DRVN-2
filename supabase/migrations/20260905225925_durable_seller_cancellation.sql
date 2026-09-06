begin;

alter table public.orders add column if not exists seller_cancellation_relisted_at timestamptz;

-- Before payment this cancels and releases inventory in one commit. After
-- payment it first reports that the refund engine must run; only a verified
-- completed/recovery-tracked seller refund may release sold inventory. The
-- marker makes a lost response replay safe even if another buyer has since
-- reserved the relisted part.
create function public.settle_seller_cancellation(
  p_order uuid,
  p_actor uuid,
  p_reason text default null
) returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  o public.orders;
  payment public.payments;
  listing_ids uuid[];
  bad_listings integer;
  reason text:=coalesce(nullif(left(trim(coalesce(p_reason,'')),500),''),'cancelled by seller');
begin
  if p_order is null or p_actor is null then raise exception 'Order and actor are required'; end if;
  select * into strict o from public.orders where id=p_order for update;
  if o.seller_id is distinct from p_actor then raise exception 'Seller authorization required' using errcode='42501'; end if;

  select coalesce(array_agg(listing_id order by listing_id),array[]::uuid[])
  into listing_ids from public.order_items where order_id=o.id and listing_id is not null;
  if cardinality(listing_ids)=0 then raise exception 'Order has no inventory items'; end if;
  perform 1 from public.listings where id=any(listing_ids) order by id for update;

  if o.seller_cancellation_relisted_at is not null then
    return jsonb_build_object('ok',true,'complete',true,'replayed',true,'status',o.status);
  end if;
  select * into payment from public.payments where order_id=o.id for update;

  if o.status='pending' then
    if not found or payment.status not in ('pending','failed') or payment.provider_reference is not null
       or exists(
         select 1 from public.payment_requests request
         where request.request->'orderIds' ? o.id::text
       ) then
      return jsonb_build_object('ok',false,'complete',false,'reason','Payment state requires reconciliation before cancellation.');
    end if;
    update public.orders set status='cancelled',cancelled_at=coalesce(cancelled_at,now()),
      cancel_reason=reason,seller_cancellation_relisted_at=now() where id=o.id;
    update public.listings set status='active',sold_at=null,reserved_until=null
      where id=any(listing_ids) and status='reserved';
  elsif o.status='paid' then
    return jsonb_build_object('ok',true,'complete',false,'needs_refund',true,'status',o.status);
  elsif o.status='refunded' then
    if not found or payment.status<>'refunded' or payment.refunded_cents<payment.amount_cents
       or not exists(
         select 1 from public.refund_operations r where r.order_id=o.id
         and r.requested_by='seller:'||p_actor::text
         and r.status in ('completed','recovery_required')
       ) then
      raise exception 'Seller cancellation refund is not durably complete';
    end if;
    update public.listings set status='active',sold_at=null,reserved_until=null
      where id=any(listing_ids) and status='sold';
    update public.orders set cancel_reason=coalesce(cancel_reason,reason),
      cancelled_at=coalesce(cancelled_at,now()),seller_cancellation_relisted_at=now()
      where id=o.id;
  elsif o.status='cancelled' and found and payment.provider_reference is null then
    update public.listings set status='active',sold_at=null,reserved_until=null
      where id=any(listing_ids) and status='reserved';
    update public.orders set cancel_reason=coalesce(cancel_reason,reason),
      cancelled_at=coalesce(cancelled_at,now()),seller_cancellation_relisted_at=now()
      where id=o.id;
  else
    return jsonb_build_object('ok',false,'complete',false,'status',o.status,'reason','This order cannot be cancelled by the seller.');
  end if;

  select count(*) into bad_listings from public.listings where id=any(listing_ids) and status<>'active';
  if bad_listings<>0 then raise exception 'Cancellation inventory could not be released safely'; end if;
  return jsonb_build_object('ok',true,'complete',true,'replayed',false,'status',(select status from public.orders where id=o.id));
end $$;

revoke all on function public.settle_seller_cancellation(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.settle_seller_cancellation(uuid,uuid,text) to service_role;

notify pgrst,'reload schema';
commit;
