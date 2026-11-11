-- ============================================================================
-- 20261108110000 — Payout deadline: fences, fair retries, complete refunds and
-- safe restoration (N244 follow-up to 20261108100000, from the review of
-- #123). The rule is Neil's of 8 Nov 2026 and is unchanged
-- (docs/decisions/seller-payout-setup.md): 14 days after a sale with payouts
-- still off, an undispatched order is cancelled and refunded in full, the
-- seller's listings come down, and they come back when payouts are enabled.
-- Only how it is held changes.
--
-- 1. P1. A claimed order could still be dispatched. The fence was a trigger
--    on orders.status, from 'paid'. A buyer's not-received case keeps the
--    order 'disputed', and mark_order_dispatched then moves only
--    pre_dispute_status and shipped_at, so the trigger never ran and the
--    worker could refund a part already on its way. The fence now holds on
--    the claim whatever the dispute status: mark_order_dispatched,
--    pickup_mint_pass and pickup_redeem refuse a claimed order (restated
--    from 20261107210300 with only that check added), and the trigger covers
--    the fulfilment fields too (status, pre_dispute_status, shipped_at,
--    delivered_at), so no other path can record a handoff either.
--
-- 2. P1. Five stuck refunds starved the queue: every pass handed the worker
--    the same five oldest open claims, so later claims (already fenced from
--    dispatch) were never refunded. Each claim now carries its attempt
--    schedule (attempts, next_attempt_at, last_attempt_at); a pass hands out
--    only claims that are due, oldest due first, and pushes each one it hands
--    out back by a doubling backoff (5 minutes, capped at 6 hours), so a
--    stuck claim goes to the back and the rest rotate through.
--
-- 3. P1. A refund in flight could block the full refund for good. The
--    deadline asked for "everything not yet refunded" under a fixed request
--    key: on a $100 order with a $20 refund in flight it reserved $80; if the
--    $20 then failed, every retry adopted the completed $80 operation under
--    the same key, settling never completed and $20 stayed unrefunded.
--    begin_payout_deadline_refund reserves under the order lock: it adopts
--    the deadline's own refund while one is in flight; waits (reserving
--    nothing) while any other refund of the order is in flight; and
--    otherwise reserves the whole remainder, so a deadline refund that
--    completed short is topped up under the next free key of the request.
--
-- 4. P2. Payouts enabled could miss a restoration. Settlement read payouts
--    without a lock: if Stripe enabled them and the restore trigger finished
--    in between, settlement paused and recorded the part afterwards, and
--    nothing restored it again (the trigger ran only on the false-to-true
--    change). Settlement, and the sweep's pausing and claiming, now lock the
--    seller's profile before the listings (profile, listing, order: the
--    order a payouts update and its restore trigger take), so one of them
--    always sees the other. The restore trigger also runs on every sync
--    that reports payouts enabled, so a leftover record is restored.
--
-- 5. P2. Restoration skipped the publish rules: a seller who removed every
--    photo while the rule had the listing paused got it back on sale through
--    the service role, which the photo guard exempts. A part goes back on
--    sale (at payouts enabled, or at settlement) only if it meets what a
--    member's own publish needs (20261107210000: payouts, not suspended, at
--    least one photo); one that doesn't stays paused, the seller's to finish
--    and publish.
--
-- Money rules don't change. Idempotent.
-- ============================================================================

begin;

create schema if not exists private;

-- ============================================================
-- Shared: is this order claimed by the deadline, and can a part go live?
-- ============================================================

create or replace function private.payout_deadline_open_claim(p_order uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (select 1 from private.payout_deadline_cancellations c
                 where c.order_id = p_order and c.settled_at is null);
$$;
revoke all on function private.payout_deadline_open_claim(uuid) from public, anon, authenticated;

-- What a member's own publish needs (20261107210000: the payouts guard and
-- the photo guard), for a part DRVN itself puts back on sale.
create or replace function private.listing_can_go_live(p_listing uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce((
    select private.seller_can_take_payment(l.seller_id)
       and not public.is_suspended(l.seller_id)
       and exists (select 1 from public.listing_images i where i.listing_id = l.id)
    from public.listings l where l.id = p_listing
  ), false);
$$;
revoke all on function private.listing_can_go_live(uuid) from public, anon, authenticated;

-- ============================================================
-- 1. The dispatch fence holds on the claim
-- ============================================================

-- Latest: 20261108100000. Changed: any handoff recorded on a claimed order
-- is refused, not only a move out of 'paid' in orders.status.
create or replace function private.guard_payout_deadline_dispatch()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if ((old.shipped_at is null and new.shipped_at is not null)
      or (old.delivered_at is null and new.delivered_at is not null)
      or (new.status in ('shipped', 'delivered', 'completed') and new.status is distinct from old.status)
      or (new.pre_dispute_status in ('shipped', 'delivered', 'completed')
          and new.pre_dispute_status is distinct from old.pre_dispute_status))
     and private.payout_deadline_open_claim(new.id) then
    raise exception 'This order is being cancelled and refunded: payouts weren''t set up within 14 days of the sale'
      using errcode = 'LS002';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_payout_deadline_dispatch() from public, anon, authenticated;

drop trigger if exists orders_payout_deadline_dispatch_guard on public.orders;
create trigger orders_payout_deadline_dispatch_guard
  before update of status, pre_dispute_status, shipped_at, delivered_at on public.orders
  for each row execute function private.guard_payout_deadline_dispatch();

-- Latest: 20261107210300. Changed: a claimed order is refused (LS002) right
-- after the seller and collection checks, before anything is written.
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
  stamped_at timestamptz:=now();
  live_count integer;
  effective text;
begin
  if p_order is null or p_actor is null then raise exception 'Order and actor are required'; end if;
  select * into strict o from public.orders where id=p_order for update;
  if o.seller_id is distinct from p_actor then raise exception 'Seller authorization required' using errcode='42501'; end if;
  if o.is_collection then raise exception 'Collection orders use the pickup handoff'; end if;
  -- 20261108110000: an order the payout deadline claimed is being refunded,
  -- whatever its dispute status (a not-received case keeps it 'disputed'
  -- and dispatch moves only pre_dispute_status, which the status trigger
  -- never saw). Refused before any shipment or tracker job is written.
  if private.payout_deadline_open_claim(o.id) then
    raise exception 'This order is being cancelled and refunded: payouts weren''t set up within 14 days of the sale'
      using errcode = 'LS002';
  end if;
  if normalized_carrier is null or normalized_tracking is null then raise exception 'Carrier and tracking are required'; end if;
  if (tracker_ref is null) <> (tracker_provider is null) then raise exception 'A tracker needs both its provider and its id'; end if;

  effective:=case when o.status='disputed' then coalesce(o.pre_dispute_status,'') else o.status end;

  if effective in ('shipped','delivered','completed') then
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
  if effective<>'paid' then
    return jsonb_build_object('ok',false,'applied',false,'status',o.status,'reason','Only a paid order can be dispatched.');
  end if;
  if o.status='disputed' and private.order_has_unresolved_chargeback(o.id) then
    return jsonb_build_object('ok',false,'applied',false,'status',o.status,'reason','A bank chargeback is open on this order.');
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

  -- Tracking DRVN can follow, registered off the request path (N110).
  if shipment.tracking_code is not null and shipment.provider_tracker_id is null then
    insert into public.remediation_jobs(kind,dedup_key,payload,next_attempt_at)
    values('tracker_registration','tracker:'||shipment.id,
           jsonb_build_object('shipment_id',shipment.id,'order_id',o.id),
           now()+interval '5 minutes')
    on conflict(dedup_key) do nothing;
  end if;

  if o.status='disputed' then
    -- The case stays open; resolving it lands on 'shipped'.
    update public.orders set
      pre_dispute_status='shipped',carrier=normalized_carrier,tracking_number=normalized_tracking,shipped_at=stamped_at
    where id=o.id;
    if o.buyer_id is not null then
      perform public.notify(o.buyer_id,'order_shipped','marketplace','Your part is on its way',
        normalized_carrier||' · '||normalized_tracking,'/orders/'||o.id,o.seller_id);
    end if;
    return jsonb_build_object('ok',true,'applied',true,'replayed',false,'status','disputed','shipment_id',shipment.id);
  end if;

  update public.orders set
    status='shipped',carrier=normalized_carrier,tracking_number=normalized_tracking,shipped_at=stamped_at
  where id=o.id;
  return jsonb_build_object('ok',true,'applied',true,'replayed',false,'status','shipped','shipment_id',shipment.id);
end $$;

revoke all on function public.mark_order_dispatched(uuid,uuid,text,text,text,text) from public,anon,authenticated;
grant execute on function public.mark_order_dispatched(uuid,uuid,text,text,text,text) to service_role;

-- Latest: 20261107210300. Changed: no pass for a claimed order.
create or replace function public.pickup_mint_pass(
  p_order_id uuid,
  p_buyer_id uuid,
  p_token_hash text,
  p_code_hash text,
  p_expires_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_order record;
  v_pass record;
begin
  if p_order_id is null or p_buyer_id is null
     or nullif(p_token_hash, '') is null or nullif(p_code_hash, '') is null
     or p_expires_at is null then
    raise exception 'Pass mint needs an order, a buyer, both hashes and an expiry'
      using errcode = '22023';
  end if;

  -- The same lock order as pickup_redeem: the order row, then the pass row.
  select o.id, o.buyer_id, o.status, o.pre_dispute_status, o.is_collection, o.pickup_ready_at
    into v_order
    from public.orders o
   where o.id = p_order_id
   for update;

  if not found or v_order.buyer_id is distinct from p_buyer_id then
    return jsonb_build_object('ok', false, 'reason', 'not_your_order');
  end if;

  select pc.redeemed_at into v_pass
    from public.pickup_confirmations pc
   where pc.order_id = p_order_id
   for update;

  if found and v_pass.redeemed_at is not null then
    return jsonb_build_object('ok', false, 'reason', 'already_redeemed');
  end if;
  -- 20261108110000: no pass for an order the payout deadline is refunding.
  if private.payout_deadline_open_claim(p_order_id) then
    return jsonb_build_object('ok', false, 'reason', 'payout_deadline');
  end if;
  if not v_order.is_collection or v_order.pickup_ready_at is null
     or not (v_order.status = 'paid'
             or (v_order.status = 'disputed' and v_order.pre_dispute_status = 'paid'
                 and not private.order_has_unresolved_chargeback(v_order.id))) then
    return jsonb_build_object('ok', false, 'reason', 'not_ready');
  end if;

  -- Rotate. redeemed_at and redeemed_by are never written here, and a
  -- redeemed row is never updated (the where clause), so no ordering of
  -- calls can erase a handoff.
  insert into public.pickup_confirmations as pc
    (order_id, token_hash, code_hash, attempts, expires_at)
  values (p_order_id, p_token_hash, p_code_hash, 0, p_expires_at)
  on conflict (order_id) do update
     set token_hash = excluded.token_hash,
         code_hash = excluded.code_hash,
         attempts = 0,
         expires_at = excluded.expires_at
   where pc.redeemed_at is null;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'already_redeemed');
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.pickup_mint_pass(uuid, uuid, text, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.pickup_mint_pass(uuid, uuid, text, text, timestamptz)
  to service_role;

-- Latest: 20261107210300. Changed: a claimed order isn't redeemable, in a
-- case or not, and its pass isn't burned.
create or replace function public.pickup_redeem(
  p_order_id uuid,
  p_seller_id uuid,
  p_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_order record;
  v_pass record;
  v_in_case boolean;
begin
  select o.id, o.seller_id, o.status, o.pre_dispute_status, o.is_collection
    into v_order
    from public.orders o
   where o.id = p_order_id
   for update;

  if not found or v_order.seller_id is distinct from p_seller_id then
    return jsonb_build_object('ok', false, 'reason', 'not_your_order');
  end if;
  if not v_order.is_collection then
    return jsonb_build_object('ok', false, 'reason', 'not_pickup');
  end if;
  v_in_case := v_order.status = 'disputed' and v_order.pre_dispute_status = 'paid'
    and not private.order_has_unresolved_chargeback(v_order.id);
  if v_order.status <> 'paid' and not v_in_case then
    return jsonb_build_object('ok', false, 'reason', 'not_redeemable');
  end if;
  -- 20261108110000: an order the payout deadline claimed is being refunded,
  -- in a case or not; the pass is not burned.
  if private.payout_deadline_open_claim(p_order_id) then
    return jsonb_build_object('ok', false, 'reason', 'payout_deadline');
  end if;

  select * into v_pass
    from public.pickup_confirmations
   where order_id = p_order_id
   for update;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'no_pass');
  end if;
  if v_pass.redeemed_at is not null then
    return jsonb_build_object('ok', false, 'reason', 'already_redeemed');
  end if;
  if v_pass.expires_at < now() then
    return jsonb_build_object('ok', false, 'reason', 'expired');
  end if;
  if v_pass.attempts >= 10 then
    return jsonb_build_object('ok', false, 'reason', 'locked');
  end if;

  if v_pass.token_hash <> p_hash and v_pass.code_hash <> p_hash then
    update public.pickup_confirmations
       set attempts = attempts + 1
     where order_id = p_order_id;
    return jsonb_build_object('ok', false, 'reason', 'mismatch');
  end if;

  -- Handoff proven: single-use stamp + the same delivered/clearing entry a
  -- shipped order gets from the buyer''s confirm.
  update public.pickup_confirmations
     set redeemed_at = now(), redeemed_by = p_seller_id
   where order_id = p_order_id
     and redeemed_at is null;

  if v_in_case then
    -- The case stays open; resolving it lands on 'delivered'.
    update public.orders
       set pre_dispute_status = 'delivered',
           delivered_at = now(),
           completed_at = now()
     where id = p_order_id
       and status = 'disputed';
  else
    update public.orders
       set status = 'delivered',
           delivered_at = now(),
           completed_at = now()
     where id = p_order_id
       and status = 'paid';
  end if;

  -- The handoff starts the payout clock exactly as a buyer's receipt does
  -- for a shipped order (confirm_order_receipt): available when the owner's
  -- clearing hold (settlement_settings, 20261006100000) has passed since
  -- delivery. Without this the intent stayed 'holding' with no
  -- available_at, and mark_due_transfer_intents never released it. While a
  -- case is open, readiness still waits for the order to leave 'disputed'.
  update public.transfer_intents
     set available_at = coalesce(available_at, public.payout_available_at(p_order_id, now())),
         updated_at = now()
   where order_id = p_order_id
     and status = 'holding';

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.pickup_redeem(uuid, uuid, text)
  from public, anon, authenticated;


-- ============================================================
-- 2. Each claim keeps its own attempt schedule
-- ============================================================

alter table private.payout_deadline_cancellations
  add column if not exists attempts integer not null default 0,
  add column if not exists next_attempt_at timestamptz not null default now(),
  add column if not exists last_attempt_at timestamptz;

comment on column private.payout_deadline_cancellations.next_attempt_at is
  'When the worker may next be handed this claim; each hand-out pushes it back by a doubling backoff (20261108110000).';

drop index if exists private.payout_deadline_cancellations_open_idx;
create index if not exists payout_deadline_cancellations_due_idx
  on private.payout_deadline_cancellations (next_attempt_at, claimed_at) where settled_at is null;

-- Latest: 20261108100000. Changed: profiles are locked before listings
-- (item 4), and the open claims handed out are the due ones, each pushed
-- back as it is handed out (item 2). The restriction step is unchanged.
create or replace function public.claim_payout_deadline_cancellations(p_limit integer default 5)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_restricted integer := 0;
  v_paused integer := 0;
  v_claimed integer := 0;
  v_limit integer := greatest(coalesce(p_limit, 5), 1);
  v_order record;
  v_listing_ids uuid[];
  v_status text;
  v_shipped timestamptz;
  v_payable boolean;
  v_open jsonb;
begin
  if not private.payout_readiness_required() then
    return jsonb_build_object('restricted', 0, 'paused', 0, 'claimed', 0, 'orders', '[]'::jsonb);
  end if;

  -- Sellers with a sale at least 14 days old, still unpaid and payouts off.
  with overdue as (
    select distinct o.seller_id
    from public.transfer_intents ti
    join public.orders o on o.id = ti.order_id
    join public.profiles p on p.id = o.seller_id
    where ti.created_at <= now() - interval '14 days'
      and ti.status in ('holding', 'ready', 'blocked_unpayable', 'failed')
      and o.status not in ('refunded', 'cancelled')
      and not p.payouts_enabled
  ), restricted as (
    update public.profiles p
    set payout_restricted_at = now()
    where p.id in (select seller_id from overdue)
      and p.payout_restricted_at is null
      and not p.payouts_enabled
    returning p.id
  )
  select count(*) into v_restricted from restricted;

  -- 20261108110000: the restricted sellers' profiles first, then their
  -- listings. Payouts enabled (an update of the profile, whose trigger then
  -- restores the listings) either committed before this lock, and the
  -- profile is skipped here as payable, or waits for these pauses and then
  -- restores them.
  perform 1 from public.profiles p
  where p.payout_restricted_at is not null and not p.payouts_enabled
  order by p.id
  for share;

  -- Their live listings come down. Every pass, so a part released from an
  -- expired checkout back to active doesn't stay on sale.
  with live as (
    select l.id, l.seller_id
    from public.listings l
    join public.profiles p on p.id = l.seller_id
    where l.status = 'active'
      and p.payout_restricted_at is not null
      and not p.payouts_enabled
    order by l.id
    for update of l
  ), recorded as (
    insert into private.payout_deadline_paused_listings (listing_id, seller_id)
    select id, seller_id from live
    on conflict (listing_id) do nothing
    returning listing_id
  )
  select count(*) into v_paused from recorded;
  update public.listings l
  set status = 'paused'
  from private.payout_deadline_paused_listings pl
  where pl.listing_id = l.id and l.status = 'active'
    and exists (select 1 from public.profiles p
                where p.id = l.seller_id and p.payout_restricted_at is not null and not p.payouts_enabled);

  -- Claim each overdue order that hasn't been dispatched. Profile, then
  -- listing, then order (docs/decisions/agent-foundations.md §4), and
  -- re-read under the locks, so a dispatch or a payouts update that won the
  -- race keeps its order.
  for v_order in
    select o.id, o.seller_id
    from public.transfer_intents ti
    join public.orders o on o.id = ti.order_id
    join public.profiles p on p.id = o.seller_id
    where ti.created_at <= now() - interval '14 days'
      and ti.status in ('holding', 'ready', 'blocked_unpayable', 'failed')
      and o.status = 'paid'
      and o.shipped_at is null
      and not p.payouts_enabled
      and not exists (select 1 from private.payout_deadline_cancellations c where c.order_id = o.id)
    order by ti.created_at
    limit v_limit
  loop
    select p.payouts_enabled into v_payable from public.profiles p where p.id = v_order.seller_id for share;
    select coalesce(array_agg(oi.listing_id order by oi.listing_id), array[]::uuid[])
      into v_listing_ids
    from public.order_items oi where oi.order_id = v_order.id and oi.listing_id is not null;
    perform 1 from public.listings where id = any(v_listing_ids) order by id for update;
    select o.status, o.shipped_at into v_status, v_shipped
    from public.orders o where o.id = v_order.id for update;
    if v_status = 'paid' and v_shipped is null and not coalesce(v_payable, false) then
      insert into private.payout_deadline_cancellations (order_id, seller_id)
      values (v_order.id, v_order.seller_id)
      on conflict (order_id) do nothing;
      if found then v_claimed := v_claimed + 1; end if;
    end if;
  end loop;

  -- The open claims due now, oldest due first. A claim on an order that
  -- moved elsewhere (a buyer's dispute) waits until it is back, keeping its
  -- place. Each claim handed out is pushed back (5, 10, 20 ... minutes, at
  -- most 6 hours) before the worker tries it, so one that keeps failing
  -- can't hold the batch, and a worker that dies mid-pass loses nothing.
  -- skip locked: two passes never take the same claim.
  with due as (
    select c.order_id
    from private.payout_deadline_cancellations c
    join public.orders o on o.id = c.order_id
    where c.settled_at is null
      and o.status in ('paid', 'refunded')
      and c.next_attempt_at <= now()
    order by c.next_attempt_at, c.claimed_at, c.order_id
    limit v_limit
    for update of c skip locked
  ), handed as (
    update private.payout_deadline_cancellations c
    set attempts = c.attempts + 1,
        last_attempt_at = now(),
        next_attempt_at = now() + least(interval '5 minutes' * power(2, least(c.attempts, 7))::integer,
                                        interval '6 hours')
    from due
    where c.order_id = due.order_id
    returning c.order_id, c.claimed_at, c.attempts
  )
  select coalesce(jsonb_agg(jsonb_build_object('order_id', h.order_id, 'status', o.status, 'attempt', h.attempts)
                            order by h.claimed_at, h.order_id), '[]'::jsonb)
    into v_open
  from handed h
  join public.orders o on o.id = h.order_id;

  return jsonb_build_object('restricted', v_restricted, 'paused', v_paused, 'claimed', v_claimed, 'orders', v_open);
end;
$$;
revoke all on function public.claim_payout_deadline_cancellations(integer) from public, anon, authenticated;
grant execute on function public.claim_payout_deadline_cancellations(integer) to service_role;

-- ============================================================
-- 3. The full refund waits for other refunds, and tops up a short one
-- ============================================================

-- The deadline's refund reservation, under the order lock (as
-- begin_not_received_refund is for a case):
--   * the deadline's own refund still in flight is adopted (a retry after a
--     crash or a lost answer never starts a second one);
--   * any other refund of the order still in flight (its money not yet in
--     refunded_cents: the same set begin_refund_operation reserves against)
--     means wait: nothing is reserved, and the worker tries again later.
--     Reserving "the rest" around it would leave its amount unrefunded if it
--     then failed;
--   * otherwise the whole remainder (total - refunded_cents) is reserved
--     under the request key payout_deadline:<order>. If an earlier deadline
--     refund completed short of the total, that key is taken, so the top-up
--     takes the next free one (payout_deadline:<order>:1, :2 ...). A failed
--     attempt frees its key, as with any request key (20261004110000).
create or replace function public.begin_payout_deadline_refund(
  p_order uuid,
  p_reason text,
  p_requested_by text,
  p_actor_role text,
  p_dispute_outcome text,
  p_payment_reference text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  o public.orders;
  v_base text;
  v_key text;
  v_n integer := 0;
  v_remaining integer;
begin
  if p_order is null then raise exception 'Order is required' using errcode = '22023'; end if;
  v_base := 'payout_deadline:' || p_order;

  select * into o from public.orders where id = p_order for update;
  if not found then
    return jsonb_build_object('ok', false, 'ineligible', true, 'error', 'Order not found.');
  end if;
  if not private.payout_deadline_open_claim(p_order) then
    return jsonb_build_object('ok', false, 'ineligible', true,
      'error', 'This order is not being cancelled by the payout deadline.');
  end if;

  -- The deadline's own refund, still in flight: adopt it.
  select ro.request_key into v_key
  from public.refund_operations ro
  where ro.order_id = p_order
    and (ro.request_key = v_base or starts_with(ro.request_key, v_base || ':'))
    and ro.status in ('requested', 'provider_pending', 'provider_succeeded',
                      'effects_pending', 'reversal_pending', 'recovery_required')
    and ro.effects_completed_at is null
  order by ro.created_at desc
  limit 1;
  if found then
    return public.begin_request_refund_operation(v_key, p_order, null, p_reason, p_requested_by,
      p_actor_role, false, p_dispute_outcome, p_payment_reference);
  end if;

  -- Any other refund still in flight: wait for it.
  if exists (select 1 from public.refund_operations ro
             where ro.order_id = p_order
               and ro.status in ('requested', 'provider_pending', 'provider_succeeded',
                                 'effects_pending', 'reversal_pending', 'recovery_required')
               and ro.effects_completed_at is null) then
    return jsonb_build_object('ok', false, 'waiting', true,
      'error', 'Another refund on this order is still being made; the full refund waits for it.');
  end if;

  v_remaining := o.total_cents - o.refunded_cents;
  if v_remaining <= 0 then
    return jsonb_build_object('ok', false, 'error', 'Nothing left to refund on this order.');
  end if;
  if o.status is distinct from 'paid' then
    -- Moved since the claim was handed out (a buyer's case): the claim waits
    -- until the order is back.
    return jsonb_build_object('ok', false, 'waiting', true, 'status', o.status,
      'error', 'The order is not waiting for its refund right now.');
  end if;

  loop
    v_key := v_base || case when v_n = 0 then '' else ':' || v_n end;
    exit when not exists (select 1 from public.refund_operations
                          where request_key = v_key and status <> 'failed');
    v_n := v_n + 1;
  end loop;

  return public.begin_request_refund_operation(v_key, p_order, v_remaining, p_reason, p_requested_by,
    p_actor_role, false, p_dispute_outcome, p_payment_reference);
end;
$$;
revoke all on function public.begin_payout_deadline_refund(uuid, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.begin_payout_deadline_refund(uuid, text, text, text, text, text) to service_role;

-- ============================================================
-- 4 + 5. Settling: profile first, and only a complete listing goes live
-- ============================================================

-- Latest: 20261108100000. Changed: the seller's profile is locked (for
-- share) before the listings, so a payouts update can't land between the
-- read and the pause (item 4); a part goes back on sale only if it meets
-- the publish rules, else it is paused for the seller (item 5).
create or replace function public.settle_payout_deadline_cancellation(p_order uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_claim private.payout_deadline_cancellations;
  v_order public.orders;
  v_listing_ids uuid[];
  v_seller uuid;
  v_payable boolean;
begin
  if p_order is null then raise exception 'Order is required'; end if;
  select c.seller_id into v_seller from private.payout_deadline_cancellations c where c.order_id = p_order;
  if v_seller is null then
    raise exception 'This order was not cancelled by the payout deadline';
  end if;
  -- Profile, then listing, then order: the order a payouts update and its
  -- restore trigger take.
  select coalesce(p.payouts_enabled, false) into v_payable
  from public.profiles p where p.id = v_seller for share;
  select coalesce(array_agg(oi.listing_id order by oi.listing_id), array[]::uuid[])
    into v_listing_ids
  from public.order_items oi where oi.order_id = p_order and oi.listing_id is not null;
  perform 1 from public.listings where id = any(v_listing_ids) order by id for update;
  select * into v_order from public.orders where id = p_order for update;
  select * into v_claim from private.payout_deadline_cancellations where order_id = p_order for update;
  if v_claim.order_id is null then
    raise exception 'This order was not cancelled by the payout deadline';
  end if;
  if v_claim.settled_at is not null then
    return jsonb_build_object('ok', true, 'complete', true, 'replayed', true);
  end if;
  if v_order.status is distinct from 'refunded' or v_order.refunded_cents < v_order.total_cents then
    return jsonb_build_object('ok', false, 'complete', false, 'status', v_order.status,
                              'reason', 'The refund is not complete yet.');
  end if;

  if coalesce(v_payable, false) and not public.is_suspended(v_claim.seller_id) then
    -- Back on sale only if it could be published; otherwise the seller's,
    -- paused, to finish and publish.
    update public.listings set status = 'active', sold_at = null, reserved_until = null
    where id = any(v_listing_ids) and status = 'sold' and private.listing_can_go_live(id);
    update public.listings set status = 'paused', sold_at = null, reserved_until = null
    where id = any(v_listing_ids) and status = 'sold';
  else
    insert into private.payout_deadline_paused_listings (listing_id, seller_id)
    select l.id, l.seller_id from public.listings l where l.id = any(v_listing_ids) and l.status = 'sold'
    on conflict (listing_id) do nothing;
    update public.listings set status = 'paused', sold_at = null, reserved_until = null
    where id = any(v_listing_ids) and status = 'sold';
  end if;
  update private.payout_deadline_cancellations set settled_at = now() where order_id = p_order;
  return jsonb_build_object('ok', true, 'complete', true, 'replayed', false);
end;
$$;
revoke all on function public.settle_payout_deadline_cancellation(uuid) from public, anon, authenticated;
grant execute on function public.settle_payout_deadline_cancellation(uuid) to service_role;

-- ============================================================
-- 4 + 5. Payouts enabled: every such sync, and only complete listings
-- ============================================================

-- Latest: 20261108100000. Changed: any update that reports payouts enabled
-- clears a restriction, not only the false-to-true change.
create or replace function private.clear_payout_restriction()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.payouts_enabled and new.payout_restricted_at is not null then
    new.payout_restricted_at := null;
  end if;
  return new;
end;
$$;
revoke all on function private.clear_payout_restriction() from public, anon, authenticated;

-- Latest: 20261108100000. Changed: runs on any sync that reports payouts
-- enabled while the rule still holds a pause for the seller (so a record
-- left behind is restored by the next sync), and puts back on sale only the
-- listings that meet the publish rules. The others stay paused, now the
-- seller's own (their record goes), to finish and publish.
create or replace function private.restore_payout_paused_listings()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.payouts_enabled
     and not public.is_suspended(new.id)
     and exists (select 1 from private.payout_deadline_paused_listings pl where pl.seller_id = new.id) then
    perform 1 from public.listings l
    where l.id in (select pl.listing_id from private.payout_deadline_paused_listings pl where pl.seller_id = new.id)
    order by l.id for update;
    update public.listings l set status = 'active'
    where l.status = 'paused'
      and l.id in (select pl.listing_id from private.payout_deadline_paused_listings pl where pl.seller_id = new.id)
      and private.listing_can_go_live(l.id);
    delete from private.payout_deadline_paused_listings where seller_id = new.id;
  end if;
  return new;
end;
$$;
revoke all on function private.restore_payout_paused_listings() from public, anon, authenticated;

-- The triggers themselves (20261108100000) are unchanged: before and after
-- update of payouts_enabled on public.profiles.

-- ---------------------------------------------------------------------------
-- Self-check
-- ---------------------------------------------------------------------------
do $$
begin
  if has_function_privilege('authenticated', 'public.begin_payout_deadline_refund(uuid,text,text,text,text,text)', 'execute')
     or has_function_privilege('anon', 'public.begin_payout_deadline_refund(uuid,text,text,text,text,text)', 'execute') then
    raise exception 'SELF-CHECK FAILED: the payout deadline refund is client-callable';
  end if;
  if not exists (select 1 from pg_trigger t
                 where t.tgname = 'orders_payout_deadline_dispatch_guard'
                   and t.tgrelid = 'public.orders'::regclass
                   and (select array_agg(a.attname::text order by a.attname)
                        from pg_attribute a
                        where a.attrelid = t.tgrelid and a.attnum = any(t.tgattr::smallint[]))
                       = array['delivered_at', 'pre_dispute_status', 'shipped_at', 'status']) then
    raise exception 'SELF-CHECK FAILED: the dispatch fence does not cover the fulfilment fields';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'profiles_payout_paused_listings_restore')
     or not exists (select 1 from pg_trigger where tgname = 'profiles_payout_restriction_clear') then
    raise exception 'SELF-CHECK FAILED: the payouts-enabled triggers are missing';
  end if;
end $$;

notify pgrst, 'reload schema';
commit;
