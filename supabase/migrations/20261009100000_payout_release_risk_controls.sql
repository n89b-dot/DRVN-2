-- 20261009100000 — sellers are paid days after delivery, not weeks; the
-- money that leaves early is protected another way (Neil, 4 October 2026).
--
-- 20261006100200 held every payout until the 30-day problem window and the
-- shop's return window had closed. For an untracked parcel the buyer never
-- confirms, that was about 51 days after dispatch. The owner's decision
-- (docs/decisions/payout-hold.md) replaces it with the eBay/Vinted shape: pay
-- soon after delivery, keep the buyer's 30 days of protection, and take a
-- refund back from a seller already paid (transfer reversal, then the seller's
-- bank through Stripe's debit_negative_balances).
--
-- The release rule, in fixed mode:
--   * the buyer presses "received"                  → released now, if the
--     parcel plausibly arrived: a carrier delivery scan on a parcel DRVN
--     tracks, or dispatch at least receipt_release_after_days (3) ago.
--     Otherwise delivery + payout_hold_days, like a carrier scan. A buyer
--     confirming a minute after buying is the pattern of a stolen card
--     paying the buyer's own seller account; that waits.
--   * a carrier delivery scan, or a collection handover → delivery +
--     payout_hold_days (2).
--   * the untracked auto-confirm (21 days after dispatch, the buyer warned
--     first)                                         → released at the
--     auto-confirm; the buyer has already had three weeks to say something.
-- claim_window mode keeps its meaning and ignores the early releases, so
-- switching back to it is still one update.
--
-- And one exposure is closed at dispatch: an order of
-- tracking_required_from_cents ($1,000) or more can only be dispatched with
-- tracking DRVN follows — a DRVN label, or a tracking number DRVN registered
-- with its carrier tracker. A seller can't defend a "never arrived" claim on
-- an untracked parcel, and DRVN would be refunding money already paid out.
-- mark_order_dispatched gains two optional parameters for the tracker the
-- app registered first.
--
-- card_verification_from_cents ($500) is read by the app: at or above it the
-- PaymentIntent asks the card's bank to verify the buyer (3D Secure), which
-- generally moves a stolen-card chargeback to the issuer.
--
-- Payout dates already set are never moved. Idempotent.

begin;

alter table public.settlement_settings
  add column if not exists receipt_release_after_days integer not null default 3,
  add column if not exists tracking_required_from_cents bigint,
  add column if not exists card_verification_from_cents bigint;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'settlement_settings_receipt_release_days') then
    alter table public.settlement_settings add constraint settlement_settings_receipt_release_days
      check (receipt_release_after_days between 0 and 30);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'settlement_settings_tracking_required_from') then
    alter table public.settlement_settings add constraint settlement_settings_tracking_required_from
      check (tracking_required_from_cents is null or tracking_required_from_cents > 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'settlement_settings_card_verification_from') then
    alter table public.settlement_settings add constraint settlement_settings_card_verification_from
      check (card_verification_from_cents is null or card_verification_from_cents > 0);
  end if;
end $$;

update public.settlement_settings
   set payout_hold_mode = 'fixed',
       payout_hold_days = 2,
       receipt_release_after_days = 3,
       tracking_required_from_cents = 100000,
       card_verification_from_cents = 50000
 where id;

-- When a delivered order's payout is released, given how delivery happened.
-- p_now: the delivery itself proves the money can go (a plausible receipt,
-- or the auto-confirm). Only fixed mode releases early; claim_window waits
-- for its windows whatever happened.
create or replace function public.payout_release_at(p_order uuid, p_delivered_at timestamptz, p_now boolean)
returns timestamptz
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case
    when p_now and coalesce((select s.payout_hold_mode from public.settlement_settings s where s.id), 'fixed') = 'fixed'
      then p_delivered_at
    else public.payout_available_at(p_order, p_delivered_at)
  end
  where p_delivered_at is not null;
$$;

revoke all on function public.payout_release_at(uuid, timestamptz, boolean) from public, anon, authenticated;
grant execute on function public.payout_release_at(uuid, timestamptz, boolean) to service_role;

-- Latest: 20261006100000. Changed: the available_at expression releases at
-- delivery when the transaction marked the delivery as proof enough — the
-- auto-confirm (drvn.delivery_source, 20261006100100) or a plausible receipt
-- (drvn.release_on_delivery, set by mark_order_received below). The trigger
-- runs inside the delivering statement, before either function's own
-- coalesce(available_at, …), so this is the value that sticks.
create or replace function public.start_payout_clock_on_delivery()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.status = 'delivered' and old.status is distinct from 'delivered' and new.delivered_at is not null then
    update public.transfer_intents
       set available_at = coalesce(available_at, public.payout_release_at(
             new.id,
             new.delivered_at,
             coalesce(current_setting('drvn.delivery_source', true), '') = 'auto_confirm'
               or coalesce(current_setting('drvn.release_on_delivery', true), '') = 'on'
           )),
           updated_at = now()
     where order_id = new.id
       and status = 'holding'
       and available_at is null;
  end if;
  return new;
end;
$$;

-- Latest: 20261006100000. Changed: before the shipped → delivered update,
-- decide whether the receipt is plausible and say so to the payout trigger
-- through drvn.release_on_delivery; the final transfer-intent update uses the
-- same rule for an intent the trigger didn't see.
create or replace function public.mark_order_received(
  p_order uuid,
  p_actor uuid,
  p_hold_days integer default null
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
  plausible boolean:=false;
begin
  if p_order is null or p_actor is null or p_hold_days<0 or p_hold_days>30 then
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
    -- Plausibly arrived: a carrier says so, or it has been in transit long
    -- enough. Read before this receipt marks the shipments delivered itself.
    plausible:=exists(
      select 1 from public.shipments s
      where s.order_id=o.id and s.direction='outbound'
        and s.provider_tracker_id is not null and s.status='delivered'
    ) or (o.shipped_at is not null and o.shipped_at<=stamped_at-make_interval(days=>coalesce(
      (select s.receipt_release_after_days from public.settlement_settings s where s.id),3)));

    perform set_config('drvn.release_on_delivery',case when plausible then 'on' else '' end,true);
    update public.orders set status='delivered',delivered_at=stamped_at,completed_at=stamped_at where id=o.id;
    perform set_config('drvn.release_on_delivery','',true);
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
      available_at=coalesce(available_at,case
        when p_hold_days is null then public.payout_release_at(o.id,o.delivered_at,plausible)
        else o.delivered_at+make_interval(days=>p_hold_days)
      end),
      updated_at=now()
    where order_id=o.id and status='holding';
  end if;

  return jsonb_build_object(
    'ok',true,'applied',applied,'replayed',not applied,'status',o.status,
    'available_at',(select available_at from public.transfer_intents where order_id=o.id)
  );
end $$;

-- Latest: 20260905223236. Changed: two optional parameters carry the carrier
-- tracker the app registered before calling (provider name and tracker id);
-- a first dispatch of an order at or above tracking_required_from_cents is
-- refused unless DRVN follows its tracking — that tracker, or a live DRVN
-- label shipment with the same tracking number; the tracker is stored on the
-- shipment the dispatch uses. The replay branch is unchanged.
drop function if exists public.mark_order_dispatched(uuid,uuid,text,text);
create or replace function public.mark_order_dispatched(
  p_order uuid,
  p_actor uuid,
  p_carrier text,
  p_tracking text,
  p_tracker_provider text default null,
  p_tracker_ref text default null
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
  tracker_provider text:=nullif(left(trim(coalesce(p_tracker_provider,'')),50),'');
  tracker_ref text:=nullif(left(trim(coalesce(p_tracker_ref,'')),200),'');
  required_from bigint;
  stamped_at timestamptz:=now();
  live_count integer;
begin
  if p_order is null or p_actor is null then raise exception 'Order and actor are required'; end if;
  select * into strict o from public.orders where id=p_order for update;
  if o.seller_id is distinct from p_actor then raise exception 'Seller authorization required' using errcode='42501'; end if;
  if o.is_collection then raise exception 'Collection orders use the pickup handoff'; end if;
  if normalized_carrier is null or normalized_tracking is null then raise exception 'Carrier and tracking are required'; end if;
  if (tracker_ref is null) <> (tracker_provider is null) then raise exception 'A tracker needs both its provider and its id'; end if;

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

  select s.tracking_required_from_cents into required_from from public.settlement_settings s where s.id;
  if required_from is not null and o.total_cents>=required_from and tracker_ref is null and not exists(
    select 1 from public.shipments s
    where s.order_id=o.id and s.direction='outbound' and s.status not in ('cancelled','failed')
      and s.provider_tracker_id is not null
      and s.tracking_code is not distinct from normalized_tracking
      and s.carrier is not distinct from normalized_carrier
  ) then
    return jsonb_build_object('ok',false,'applied',false,'status',o.status,'reason',
      'Orders of $' || to_char(required_from/100,'FM999,999,990') || ' or more need tracking DRVN can follow. '
      || 'Buy a DRVN label, or check the carrier and tracking number and try again.');
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
      if tracker_ref is not null and shipment.provider_tracker_id is null then
        update public.shipments set provider=tracker_provider,provider_tracker_id=tracker_ref
        where id=shipment.id returning * into shipment;
      end if;
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
      order_id,direction,fulfillment_type,carrier,status,tracking_code,shipped_at,provider,provider_tracker_id
    ) values(
      o.id,'outbound','seller_arranged',normalized_carrier,'in_transit',normalized_tracking,stamped_at,tracker_provider,tracker_ref
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

revoke all on function public.mark_order_dispatched(uuid,uuid,text,text,text,text) from public,anon,authenticated;
grant execute on function public.mark_order_dispatched(uuid,uuid,text,text,text,text) to service_role;

do $$
declare
  t timestamptz := timestamptz '2026-01-01 00:00+00';
begin
  if (select payout_hold_mode from public.settlement_settings where id) <> 'fixed'
     or (select payout_hold_days from public.settlement_settings where id) <> 2 then
    raise exception 'SELF-CHECK FAILED: the payout rule is not fixed, 2 days';
  end if;
  if public.payout_release_at(null, t, true) <> t
     or public.payout_release_at(null, t, false) <> t + interval '2 days' then
    raise exception 'SELF-CHECK FAILED: payout_release_at';
  end if;
  if has_function_privilege('anon', 'public.payout_release_at(uuid,timestamptz,boolean)', 'execute')
     or has_function_privilege('authenticated', 'public.mark_order_dispatched(uuid,uuid,text,text,text,text)', 'execute') then
    raise exception 'SELF-CHECK FAILED: a settlement function is client-callable';
  end if;
end $$;

notify pgrst, 'reload schema';

commit;
