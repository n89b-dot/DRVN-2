-- 20261004120000 — a collected order's payout clock starts at the handoff.
--
-- A shipped order's transfer intent gets its available_at when the buyer
-- confirms receipt (confirm_order_receipt, 20260905223236). pickup_redeem
-- (0054) marked a collected order delivered but never set it, so the intent
-- stayed 'holding' forever — mark_due_transfer_intents only releases intents
-- with an available_at — and the seller was never paid, while the app told
-- them "payout clearing has started".
--
-- pickup_redeem now sets it (handoff + 7 days, the same CLEARING_HOLD_DAYS
-- the receipt path uses). Collected orders already stranded are backfilled
-- from their delivered_at. Idempotent.

begin;

create or replace function public.pickup_redeem(
  p_order_id uuid,
  p_seller_id uuid,
  p_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order record;
  v_pass record;
begin
  select o.id, o.seller_id, o.status, o.is_collection
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
  if v_order.status <> 'paid' then
    return jsonb_build_object('ok', false, 'reason', 'not_redeemable');
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

  update public.orders
     set status = 'delivered',
         delivered_at = now(),
         completed_at = now()
   where id = p_order_id
     and status = 'paid';

  -- The handoff starts the payout clock exactly as a buyer's receipt does
  -- for a shipped order (confirm_order_receipt): available CLEARING_HOLD_DAYS
  -- after delivery. Without this the intent stayed 'holding' with no
  -- available_at, and mark_due_transfer_intents never released it.
  update public.transfer_intents
     set available_at = coalesce(available_at, now() + interval '7 days'),
         updated_at = now()
   where order_id = p_order_id
     and status = 'holding';

  return jsonb_build_object('ok', true);
end;
$$;

-- Collected orders redeemed before this fix: start their clock from the
-- handoff that already happened.
update public.transfer_intents ti
   set available_at = o.delivered_at + interval '7 days',
       updated_at = now()
  from public.orders o
  join public.pickup_confirmations pc on pc.order_id = o.id and pc.redeemed_at is not null
 where ti.order_id = o.id
   and ti.status = 'holding'
   and ti.available_at is null
   and o.delivered_at is not null
   and o.status in ('delivered', 'completed');

notify pgrst, 'reload schema';

commit;
