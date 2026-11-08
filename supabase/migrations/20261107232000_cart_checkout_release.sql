-- 20261107232000 — OS-W17: release a cart checkout the buyer is restarting.
--
-- The address step reserves the basket (purchase_begin) and binds it to one
-- PaymentIntent. A buyer who then edits the address, picks another shipping
-- service or changes the cart used to be refused ("details changed") and stay
-- locked out of their own parts until the 15-minute reservation lapsed.
--
-- The server now cancels the unconfirmed PaymentIntent first (the same
-- resolveExpiryIntent rule the expiry sweep uses: a captured intent is
-- settled, a processing one keeps the hold) and only then calls this to put
-- the parts back on sale, so the restarted checkout can reserve them again.
--
-- This is the expiry transition brought forward for the buyer's own,
-- unconfirmed checkout. It changes nothing about who is paid, refunds, fees
-- or payout holds: no order it touches has been paid, and it refuses any
-- that has. The same reference checks as finish_reservation_expiry apply:
--   * with a provider reference, every order must carry exactly that one;
--   * without one, there must be no payment request that could still map an
--     intent to these orders.
--
-- Lock order (docs/decisions/agent-foundations.md §4; cart preparation's
-- buyer → attempt sequence from purchase_begin / bind_cart_checkout_payment):
-- buyer advisory lock → purchase attempt → listings (id order) → orders (id
-- order) → payments. purchase_finalize re-takes the listing and order locks
-- in the same transaction, which costs nothing.
--
-- Service role only. New function; nothing existing is redefined.

begin;

create or replace function public.release_cart_checkout(
  p_buyer uuid,
  p_idempotency_key text,
  p_reference text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  a public.purchase_attempts;
  v_order_ids uuid[];
  o public.orders;
  pay public.payments;
  v_result jsonb;
  v_released int := 0;
begin
  if p_buyer is null or p_idempotency_key is null then
    raise exception 'Invalid checkout release' using errcode = '22023';
  end if;

  -- Serialise with purchase_begin for this buyer, so a restart cannot race
  -- the attempt it is replacing.
  perform pg_advisory_xact_lock(hashtextextended(p_buyer::text, 0));

  select * into a
  from public.purchase_attempts
  where idempotency_key = p_idempotency_key
  for update;
  if not found or a.buyer_id is distinct from p_buyer or a.checkout_request_key is null then
    raise exception 'Checkout attempt not found for this buyer' using errcode = '42501';
  end if;

  select coalesce(array_agg(distinct (x ->> 'order_id')::uuid), array[]::uuid[])
    into v_order_ids
  from jsonb_array_elements(coalesce(a.result -> 'orders', '[]'::jsonb)) x;

  -- listing → order → payment.
  perform 1 from public.listings
  where id in (
    select oi.listing_id from public.order_items oi
    where oi.order_id = any (v_order_ids) and oi.listing_id is not null
  )
  order by id
  for update;

  perform 1 from public.orders where id = any (v_order_ids) order by id for update;

  -- Check every order before releasing any, so a refusal leaves the whole
  -- basket exactly as it was.
  for o in select * from public.orders where id = any (v_order_ids) order by id loop
    if o.buyer_id is distinct from p_buyer then
      raise exception 'Checkout order belongs to another buyer' using errcode = '42501';
    end if;
    if o.origin_offer_id is not null then
      raise exception 'An accepted offer is not a cart checkout' using errcode = '42501';
    end if;
    if o.status in ('payment_failed', 'cancelled') then
      continue;
    end if;
    if o.status not in ('pending', 'requires_action') then
      raise exception 'Checkout already settled; nothing released' using errcode = '55000';
    end if;

    select * into pay from public.payments where order_id = o.id for update;
    if p_reference is null then
      if pay.provider_reference is not null or exists (
        select 1 from public.payment_requests pr
        where (pr.request -> 'orderIds') ? o.id::text
          and (pr.provider_reference is not null or pr.provider_rejected_at is null)
      ) then
        raise exception 'Payment outcome unresolved; retain reservation' using errcode = '55000';
      end if;
    elsif pay.provider_reference is distinct from p_reference then
      raise exception 'Checkout payment reference mismatch' using errcode = '55000';
    end if;
  end loop;

  for o in
    select * from public.orders
    where id = any (v_order_ids) and status in ('pending', 'requires_action')
    order by id
  loop
    select * into pay from public.payments where order_id = o.id;
    v_result := public.purchase_finalize(
      o.id,
      false,
      coalesce(pay.provider, 'stripe'),
      p_reference,
      'buyer restarted checkout before paying'
    );
    if not coalesce((v_result ->> 'applied')::boolean, false) then
      raise exception 'Checkout release refused' using errcode = '55000';
    end if;
    v_released := v_released + 1;
  end loop;

  return jsonb_build_object('ok', true, 'released', v_released);
end;
$$;

revoke all on function public.release_cart_checkout(uuid, text, text) from public, anon, authenticated;
grant execute on function public.release_cart_checkout(uuid, text, text) to service_role;

commit;
