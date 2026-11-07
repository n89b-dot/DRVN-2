-- 20261107200100 — fulfilment integrity (OS-W19 N93/N94, OS-W30 N110).
--
-- 1. N93: re-generating a pickup pass could erase a completed handoff. The
--    app minted the pass with a check-then-upsert that wrote
--    redeemed_at = null, outside the order lock pickup_redeem takes; a mint
--    racing a redemption wiped the proof of collection. pickup_mint_pass
--    mints under the same lock order as pickup_redeem (the order row, then
--    the pass row), refuses once the order has left 'paid' or the pass is
--    redeemed, and never writes redeemed_at or redeemed_by: an existing
--    redemption is only ever set by pickup_redeem.
--
-- 2. N110 (Neil, "similar to eBay", no limits on $1,000+ orders):
--    mark_order_dispatched no longer refuses a first dispatch at or above
--    settlement_settings.tracking_required_from_cents. The column stays, set
--    to null and unused. Payouts keep their release rules; no new hold.
--
-- 3. N110: tracking is separated from label buying. A dispatch whose
--    shipment carries tracking but no carrier tracker queues a
--    'tracker_registration' remediation job in the same transaction, after
--    the seller check. The app tries it at once (after the response) and the
--    money worker retries it with the shared remediation backoff, whether or
--    not DRVN Shipping (labels, rates) is on. With no tracking provider
--    configured the job waits; dispatch never depends on it.
--
-- Latest definitions restated: mark_order_dispatched (20261009100000,
-- nothing later on main or on an open branch), remediation_jobs_kind_check
-- (20260905185725). Idempotent.

begin;

-- ============================================================
-- remediation_jobs: the tracker registration queue
-- ============================================================
alter table public.remediation_jobs drop constraint if exists remediation_jobs_kind_check;
alter table public.remediation_jobs add constraint remediation_jobs_kind_check
  check (kind in ('receipt','search','delete_account','account_export','reservation_expiry','analytics','tracker_registration'));

-- ============================================================
-- settlement_settings: the $1,000 dispatch rule is off and unused
-- ============================================================
update public.settlement_settings set tracking_required_from_cents = null where id;

comment on column public.settlement_settings.tracking_required_from_cents is
  'Unused since 20261107200100 (N110: no amount-based dispatch refusal). Kept so older apps still read it; nothing enforces it.';

-- ============================================================
-- pickup_mint_pass — mint/rotate under the redemption lock
-- ============================================================
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
  select o.id, o.buyer_id, o.status, o.is_collection, o.pickup_ready_at
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
  if not v_order.is_collection or v_order.status <> 'paid' or v_order.pickup_ready_at is null then
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

-- ============================================================
-- mark_order_dispatched
-- ============================================================
-- Latest: 20261009100000. Changed: the tracking_required_from_cents refusal
-- is gone (N110), and a first dispatch whose shipment has tracking but no
-- carrier tracker queues a tracker_registration job (dedup 'tracker:' ||
-- shipment id, first try in 5 minutes so the app's immediate attempt goes
-- first). The two optional tracker parameters stay for callers that already
-- hold a tracker. Seller and state checks, and the replay branch, are
-- unchanged.
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

  update public.orders set
    status='shipped',carrier=normalized_carrier,tracking_number=normalized_tracking,shipped_at=stamped_at
  where id=o.id;
  return jsonb_build_object('ok',true,'applied',true,'replayed',false,'status','shipped','shipment_id',shipment.id);
end $$;

revoke all on function public.mark_order_dispatched(uuid,uuid,text,text,text,text) from public,anon,authenticated;
grant execute on function public.mark_order_dispatched(uuid,uuid,text,text,text,text) to service_role;

-- ============================================================
-- Self-checks
-- ============================================================
do $$
begin
  if to_regprocedure('public.pickup_mint_pass(uuid, uuid, text, text, timestamptz)') is null then
    raise exception 'SELF-CHECK FAILED: pickup_mint_pass missing';
  end if;
  if has_function_privilege('authenticated', 'public.pickup_mint_pass(uuid,uuid,text,text,timestamptz)', 'execute')
     or has_function_privilege('anon', 'public.pickup_mint_pass(uuid,uuid,text,text,timestamptz)', 'execute')
     or has_function_privilege('authenticated', 'public.mark_order_dispatched(uuid,uuid,text,text,text,text)', 'execute') then
    raise exception 'SELF-CHECK FAILED: a fulfilment function is client-callable';
  end if;
  if position('tracking_required_from_cents' in pg_get_functiondef(
       'public.mark_order_dispatched(uuid,uuid,text,text,text,text)'::regprocedure)) > 0 then
    raise exception 'SELF-CHECK FAILED: mark_order_dispatched still reads the amount threshold';
  end if;
  if (select tracking_required_from_cents from public.settlement_settings where id) is not null then
    raise exception 'SELF-CHECK FAILED: the amount threshold is still set';
  end if;
end $$;

notify pgrst, 'reload schema';

commit;
