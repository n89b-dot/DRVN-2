-- 20261005110000 — an accepted offer the buyer collects charges no shipping.
--
-- offer_accept_begin reserves the part before the buyer has said how they'll
-- take it, so it prices the order with the listing's flat delivery charge.
-- freeze_accepted_offer_checkout then recorded the buyer's choice but never
-- took that charge off when they chose to collect: they paid for delivery
-- that wasn't going to happen, and DRVN's 10% fee was taken on it too. Cart
-- checkout has always charged a collected order no shipping.
--
-- Now, when the buyer collects, the same transaction that freezes the choice
-- prices the order the way purchase_begin prices a collected cart line:
-- shipping 0 on the order, its line and the line's commercial snapshot; the
-- fee on goods alone; the pending payment's amount to match. The total must
-- still be a charge Stripe will make (charge_cents_in_bounds, 20261004130000):
-- an offer that only reached 50¢ with shipping can't be collected.
--
-- Pickup eligibility was already enforced, but only as an exception from the
-- orders_collection_guard trigger, which the app could only report as
-- "delivery details could not be confirmed". It is now checked first and
-- answered as a reason, as cart checkout does; so is the reverse, delivery of
-- a pickup-only part.
--
-- order_items are immutable once written (guard_order_item_immutable). The
-- guard gains one narrow exception: a line's delivery charge may drop to zero,
-- with the same change in its snapshot and nothing else, while its order is a
-- pending accepted-offer reservation already frozen for collection with no
-- shipping charged. That is exactly the state this function leaves behind,
-- and no other path produces it.
--
-- Nothing changes after a payment has been started: the freeze happens before
-- the app asks Stripe for anything, and the function refuses to re-price an
-- order that already has a payment request or a provider reference.
--
-- Both functions are the latest definitions (20260905223236 and 0049) with
-- only the additions marked "20261005110000". Idempotent: create or replace.

begin;

create or replace function public.freeze_accepted_offer_checkout(
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
end $$;

revoke all on function public.freeze_accepted_offer_checkout(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.freeze_accepted_offer_checkout(uuid,uuid,jsonb) to service_role;

create or replace function public.guard_order_item_immutable()
returns trigger
language plpgsql
set search_path = public, extensions, pg_temp
as $$
begin
  -- 20261005110000: the one permitted change — a collected accepted offer's
  -- delivery charge taken off its line (see freeze_accepted_offer_checkout).
  if old.shipping_cents <> 0
     and new.shipping_cents = 0
     and new.commercial_snapshot is not distinct from
         jsonb_set(old.commercial_snapshot, '{commercial,shipping_cents}', '0'::jsonb)
     and new.snapshot_version is not distinct from old.snapshot_version
     and new.condition_snapshot is not distinct from old.condition_snapshot
     and new.price_cents is not distinct from old.price_cents
     and new.quantity is not distinct from old.quantity
     and new.title is not distinct from old.title
     and new.order_id is not distinct from old.order_id
     and exists (
       select 1 from public.orders o
       where o.id = old.order_id
         and o.status = 'pending'
         and o.origin_offer_id is not null
         and o.accepted_checkout_shipping is not null
         and o.is_collection
         and o.shipping_cents = 0
     )
  then
    return new;
  end if;

  if new.commercial_snapshot is distinct from old.commercial_snapshot
     or new.snapshot_version is distinct from old.snapshot_version
     or (old.condition_snapshot is not null
         and new.condition_snapshot is distinct from old.condition_snapshot)
     or new.price_cents is distinct from old.price_cents
     or new.shipping_cents is distinct from old.shipping_cents
     or new.quantity is distinct from old.quantity
     or new.title is distinct from old.title
     or new.order_id is distinct from old.order_id
  then
    raise exception 'order_items purchase record is immutable'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

notify pgrst, 'reload schema';

commit;
