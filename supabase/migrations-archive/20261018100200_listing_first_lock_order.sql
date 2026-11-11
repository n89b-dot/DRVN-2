-- 20261018100200 — every path that sells a listing locks the listing first
-- (negotiation v2 §5; docs/decisions/agent-foundations.md §4).
--
-- Acceptance (offer_move → offer_accept_begin) already locks listing, then
-- offer, then creates the order. These six took the order first, so a
-- checkout freeze racing an offer move could each hold what the other needed:
--   freeze_accepted_offer_checkout   order → offer + listing
--   settle_seller_cancellation       order → listings → payment
--   purchase_finalize                order → listings → offers
--   settle_payment_capture, record_payment_request_rejection,
--   finish_reservation_expiry        order(s) → purchase_finalize
-- Each now locks the order's listings (in id order) before anything else,
-- and the freeze also locks the offer before the order. Nothing else in
-- their bodies changes: the later locks they already took are re-taken by
-- the same transaction and cost nothing. order_items is immutable once
-- written, so reading it unlocked to find the listings is safe.
-- Cart checkout preparation (prepare_payment_request, bind/freeze cart
-- checkout) never touches offers and keeps its order-first sequence.
-- Idempotent.

begin;

-- freeze_accepted_offer_checkout (20261005110000): listing locks first; body otherwise unchanged.
CREATE OR REPLACE FUNCTION public.freeze_accepted_offer_checkout(p_order uuid, p_actor uuid, p_shipping jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  o public.orders;
  collection boolean;
  offer_status text;
  listing_status text;
  listing_reserved_until timestamptz;
  -- 20261005110000
  collected_total int;
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

  -- One lock order for every path that sells a listing: listing → offer →
  -- order → payment (docs/decisions/agent-foundations.md §4, 20261018100200).
  perform 1 from public.listings where id in (
    select oi.listing_id from public.order_items oi where oi.order_id=p_order and oi.listing_id is not null
  ) order by id for update;
  perform 1 from public.offers where id = (select x.origin_offer_id from public.orders x where x.id=p_order) for update;
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
    -- 20261005110000: the total the payment must be for.
    return jsonb_build_object('ok',true,'applied',false,'replayed',true,'status',o.status,'total_cents',o.total_cents);
  end if;
  if offer_status<>'accepted' or listing_status<>'reserved'
     or listing_reserved_until is null or listing_reserved_until<=now() then
    raise exception 'Accepted-offer reservation is no longer available';
  end if;

  -- 20261005110000: the same eligibility cart checkout applies, read from
  -- what the order froze when the offer was accepted.
  if collection and exists (
    select 1 from public.order_items oi
    where oi.order_id=o.id
      and coalesce((oi.commercial_snapshot->'commercial'->>'allows_collection')::boolean,false)=false
  ) then
    return jsonb_build_object('ok',false,'applied',false,'status',o.status,
      'reason','Local pickup isn''t offered for this part — choose delivery instead.');
  end if;
  if not collection and exists (
    select 1 from public.order_items oi
    where oi.order_id=o.id
      and oi.commercial_snapshot->'commercial'->>'shipping_mode'='pickup_only'
  ) then
    return jsonb_build_object('ok',false,'applied',false,'status',o.status,
      'reason','This part is local pickup only — choose to collect it.');
  end if;
  if collection and o.shipping_cents<>0 then
    if exists (select 1 from public.payments where order_id=o.id and provider_reference is not null)
       or exists (select 1 from public.payment_requests where (request->'orderIds') ? o.id::text) then
      raise exception 'Accepted-offer payment already started; its amount cannot change'
        using errcode='55000';
    end if;
    collected_total:=o.subtotal_cents;
    if not public.charge_cents_in_bounds(collected_total::bigint) then
      raise exception 'An accepted offer must come to between $0.50 and $999,999.99'
        using errcode='22003';
    end if;
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

  -- 20261005110000: a collected order is priced as purchase_begin prices a
  -- collected cart line — no shipping, and the fee on what the buyer pays.
  if collected_total is not null then
    update public.orders set
      shipping_cents=0,
      platform_fee_cents=round(collected_total*1000.0/10000.0),
      total_cents=collected_total
    where id=o.id;
    update public.order_items set
      shipping_cents=0,
      commercial_snapshot=jsonb_set(commercial_snapshot,'{commercial,shipping_cents}','0'::jsonb)
    where order_id=o.id;
    update public.payments set amount_cents=collected_total
    where order_id=o.id and status='pending';
    o.total_cents:=collected_total;
  end if;

  return jsonb_build_object('ok',true,'applied',true,'replayed',false,'status',o.status,'total_cents',o.total_cents);
end $function$;

-- settle_seller_cancellation (20261017160000): listing locks first; body otherwise unchanged.
CREATE OR REPLACE FUNCTION public.settle_seller_cancellation(p_order uuid, p_actor uuid, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  o public.orders;
  payment public.payments;
  listing_ids uuid[];
  bad_listings integer;
  reason text:=coalesce(nullif(left(trim(coalesce(p_reason,'')),500),''),'cancelled by seller');
begin
  if p_order is null or p_actor is null then raise exception 'Order and actor are required'; end if;
  -- One lock order for every path that sells a listing: listing → offer →
  -- order → payment (docs/decisions/agent-foundations.md §4, 20261018100200).
  perform 1 from public.listings where id in (
    select oi.listing_id from public.order_items oi where oi.order_id=p_order and oi.listing_id is not null
  ) order by id for update;
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

  -- Cancel only before checkout begins (negotiation v2, O-5): once the buyer
  -- has frozen the accepted offer's delivery, the order runs its course.
  if o.status='pending' and o.accepted_checkout_shipping is not null then
    return jsonb_build_object('ok',false,'complete',false,'reason','The buyer has started checkout, so this order can no longer be cancelled.');
  end if;

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
end $function$;

-- purchase_finalize (0012): listing locks first; body otherwise unchanged.
CREATE OR REPLACE FUNCTION public.purchase_finalize(p_order_id uuid, p_success boolean, p_provider text DEFAULT 'stub'::text, p_reference text DEFAULT NULL::text, p_failure_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_order record;
  v_listing_ids uuid[];
  v_applied boolean := false;
begin
  -- One lock order for every path that sells a listing: listing → offer →
  -- order → payment (docs/decisions/agent-foundations.md §4, 20261018100200).
  perform 1 from public.listings where id in (
    select oi.listing_id from public.order_items oi where oi.order_id=p_order_id and oi.listing_id is not null
  ) order by id for update;

  -- Lock the order so two concurrent finalizes (a webhook retry racing the
  -- inline call) serialise rather than interleave.
  select id, status into v_order
  from public.orders
  where id = p_order_id
  for update;

  if not found then
    return jsonb_build_object('applied', false, 'reason', 'order not found');
  end if;

  -- Terminal states are terminal. Without this, a late `failed` webhook could
  -- drag a paid, shipped, delivered order backwards to payment_failed.
  if v_order.status not in ('pending', 'requires_action') then
    return jsonb_build_object(
      'applied', false,
      'reason', 'order already settled',
      'status', v_order.status
    );
  end if;

  select coalesce(array_agg(listing_id), array[]::uuid[])
  into v_listing_ids
  from public.order_items
  where order_id = p_order_id and listing_id is not null;

  if p_success then
    update public.orders set status = 'paid' where id = p_order_id;

    update public.listings
    set status = 'sold', sold_at = now(), reserved_until = null
    where id = any (v_listing_ids) and status = 'reserved';

    update public.payments
    set status = 'succeeded',
        provider = p_provider,
        provider_reference = coalesce(p_reference, provider_reference)
    where order_id = p_order_id and status in ('pending', 'requires_action');

    update public.offers
    set status = 'expired', responded_at = now()
    where listing_id = any (v_listing_ids) and status in ('open', 'countered');
  else
    update public.orders
    set status = 'payment_failed',
        cancelled_at = now(),
        cancel_reason = p_failure_reason
    where id = p_order_id;

    update public.listings
    set status = 'active', reserved_until = null
    where id = any (v_listing_ids) and status = 'reserved';

    update public.payments
    set status = 'failed',
        provider = p_provider,
        failure_reason = p_failure_reason
    where order_id = p_order_id and status in ('pending', 'requires_action');
  end if;

  v_applied := true;
  return jsonb_build_object('applied', v_applied, 'status',
    case when p_success then 'paid' else 'payment_failed' end);
end;
$function$;

-- settle_payment_capture: listing locks first; body otherwise unchanged.
CREATE OR REPLACE FUNCTION public.settle_payment_capture(p_reference text, p_order_ids uuid[], p_amount integer, p_currency text, p_source text, p_buyer uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare o public.orders; v_sum bigint; v_count int; v_result jsonb; v_op jsonb; v_late boolean:=false; v_ids uuid[];
begin
 select array_agg(distinct x order by x) into v_ids from unnest(p_order_ids) x;
 if coalesce(cardinality(v_ids),0)=0 then raise exception 'No orders for captured payment'; end if;
 -- One lock order for every path that sells a listing: listing → offer →
 -- order → payment (docs/decisions/agent-foundations.md §4, 20261018100200).
 perform 1 from public.listings where id in (
   select oi.listing_id from public.order_items oi where oi.order_id=any(v_ids) and oi.listing_id is not null
 ) order by id for update;
 perform 1 from public.orders where id=any(v_ids) order by id for update;
 select sum(total_cents),count(*) into v_sum,v_count from public.orders where id=any(v_ids) and lower(currency)=lower(p_currency) and buyer_id=p_buyer;
 if v_count<>cardinality(v_ids) or v_sum<>p_amount then raise exception 'Captured payment does not match orders'; end if;
 for o in select * from public.orders where id=any(v_ids) order by id loop
   if exists(select 1 from public.payments where order_id=o.id and provider_reference is not null and provider_reference<>p_reference) then raise exception 'Payment reference mismatch'; end if;
   if not exists(select 1 from public.payments where order_id=o.id) then raise exception 'Missing payment ledger'; end if;
   if o.status in ('pending','requires_action') then
     v_result:=public.purchase_finalize(o.id,true,'stripe',p_reference,null);
     if not coalesce((v_result->>'applied')::boolean,false) then raise exception 'Settlement refused'; end if;
     select * into o from public.orders where id=o.id;
   end if;
   if o.status in ('cancelled','payment_failed') then
     v_late:=true;
     update public.payments set provider='stripe',provider_reference=p_reference,status=case when coalesce(refunded_cents,0)>=amount_cents then 'refunded' else 'succeeded' end where order_id=o.id;
     if not exists(select 1 from public.refund_operations where order_id=o.id and purpose='late_capture') then
       v_op:=public.begin_refund_operation(o.id,null,'Payment captured after order cancellation','system:late_capture','system',false,null,p_reference,null,false);
       if not coalesce((v_op->>'ok')::boolean,false) then raise exception 'Cannot reserve compensation: %',v_op; end if;
       update public.refund_operations set purpose='late_capture' where id=(v_op->>'operation_id')::uuid;
     end if;
   elsif o.status in ('paid','shipped','delivered','completed','disputed') then
    if o.refunded_cents<o.total_cents and o.transfer_reference is null then
     insert into public.transfer_intents(order_id,seller_id,amount_cents,currency,status,source_transaction)
       values(o.id,o.seller_id,o.total_cents-o.platform_fee_cents,o.currency,'holding',p_source) on conflict(order_id) do nothing;
     if not exists(select 1 from public.transfer_intents where order_id=o.id and seller_id=o.seller_id and currency=o.currency and amount_cents=o.total_cents-o.platform_fee_cents and (p_source is null or source_transaction=p_source)) then raise exception 'Payout obligation conflict'; end if;
    end if;
   elsif o.status <> 'refunded' then
     raise exception 'Unhandled captured order state: %',o.status;
   end if;
 end loop;
 insert into public.remediation_jobs(kind,dedup_key,payload) values('receipt','receipt:'||p_reference,jsonb_build_object('buyer_id',p_buyer,'order_ids',v_ids,'compensation',v_late)) on conflict(dedup_key) do nothing;
 return jsonb_build_object('outcome',case when v_late then 'compensation_queued' else 'settled' end);
end $function$;

-- record_payment_request_rejection: listing locks first; body otherwise unchanged.
CREATE OR REPLACE FUNCTION public.record_payment_request_rejection(p_key text, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  r public.payment_requests;
  v_order uuid;
  v_result jsonb;
  v_released int := 0;
  v_reason text := left(coalesce(nullif(trim(p_reason), ''), 'Payment provider refused the request'), 500);
begin
  -- One lock order for every path that sells a listing: listing → offer →
  -- order → payment (docs/decisions/agent-foundations.md §4, 20261018100200).
  perform 1 from public.listings where id in (
    select oi.listing_id from public.order_items oi
    where oi.listing_id is not null and oi.order_id::text in (
      select jsonb_array_elements_text(request->'orderIds') from public.payment_requests where operation_key = p_key)
  ) order by id for update;
  -- Same lock order as prepare_payment_request: orders, then the request.
  perform 1 from public.orders
  where id::text in (
    select jsonb_array_elements_text(request->'orderIds')
    from public.payment_requests where operation_key = p_key
  )
  order by id for update;
  select * into r from public.payment_requests where operation_key = p_key for update;
  if not found then
    raise exception 'Payment request not found' using errcode = 'P0002';
  end if;
  -- Any recorded reference means a PaymentIntent may exist. Never release.
  if r.provider_reference is not null or exists(
    select 1 from public.payments
    where order_id::text in (select jsonb_array_elements_text(r.request->'orderIds'))
      and provider_reference is not null
  ) then
    raise exception 'Payment request has a provider reference; reconcile it instead'
      using errcode = '55000';
  end if;

  update public.payment_requests
  set provider_rejected_at = coalesce(provider_rejected_at, now()),
      provider_rejection = coalesce(provider_rejection, v_reason)
  where operation_key = p_key;

  for v_order in
    select o.id from public.orders o
    where o.id::text in (select jsonb_array_elements_text(r.request->'orderIds'))
      and o.status in ('pending', 'requires_action')
    order by o.id
  loop
    v_result := public.purchase_finalize(v_order, false, 'stripe', null, v_reason);
    if coalesce((v_result->>'applied')::boolean, false) then
      v_released := v_released + 1;
    end if;
  end loop;

  return jsonb_build_object('rejected', true, 'released', v_released);
end;
$function$;

-- finish_reservation_expiry: listing locks first; body otherwise unchanged.
CREATE OR REPLACE FUNCTION public.finish_reservation_expiry(p_job uuid, p_lease uuid, p_reference text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare j public.remediation_jobs; o public.orders; ref text; result jsonb;
begin
 select * into j from public.remediation_jobs where id=p_job for update;
 if not found or j.kind<>'reservation_expiry' or j.status<>'processing' or j.lease_id is distinct from p_lease or j.locked_until<=now() then raise exception 'Expiry lease lost'; end if;
 -- One lock order for every path that sells a listing: listing → offer →
 -- order → payment (docs/decisions/agent-foundations.md §4, 20261018100200).
 perform 1 from public.listings where id in (
   select oi.listing_id from public.order_items oi where oi.order_id=(j.payload->>'order_id')::uuid and oi.listing_id is not null
 ) order by id for update;
 select * into o from public.orders where id=(j.payload->>'order_id')::uuid for update;
 if not found or o.status not in ('pending','requires_action') then return jsonb_build_object('outcome','already_resolved'); end if;
 select provider_reference into ref from public.payments where order_id=o.id;
 if p_reference is null then
   if ref is not null or exists(
     select 1 from public.payment_requests
     where (request->'orderIds') ? o.id::text
       and (provider_reference is not null or provider_rejected_at is null)
   ) then
     raise exception 'Payment outcome unresolved; retain reservation';
   end if;
 elsif ref is distinct from p_reference then raise exception 'Expiry payment reference mismatch';
 end if;
 if not exists(select 1 from public.order_items oi join public.listings l on l.id=oi.listing_id where oi.order_id=o.id and l.status='reserved' and l.reserved_until<now()) then
   raise exception 'Reservation is not expired';
 end if;
 result:=public.purchase_finalize(o.id,false,'stripe',p_reference,'checkout expired after payment cancellation or verified absence');
 if not coalesce((result->>'applied')::boolean,false) then raise exception 'Expiry transition refused'; end if;
 return jsonb_build_object('outcome','expired');
end $function$;

commit;
