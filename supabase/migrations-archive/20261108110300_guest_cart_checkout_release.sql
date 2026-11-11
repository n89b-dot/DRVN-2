-- 20261108110300 — OS-W17 follow-up: a guest can release their own cart
-- checkout too, so "Edit cart" (Remove on a held part) works for them.
--
-- Latest definition: 20261107232000_cart_checkout_release.sql. The one
-- change: the attempt no longer has to carry a checkout_request_key, which
-- only signed-in checkouts are bound with. A guest's attempt is found by the
-- app from the orders named in the browser's HMAC-signed checkout receipt;
-- p_buyer is that order's buyer. Every other check is unchanged:
--   * the attempt and every order belong to p_buyer;
--   * no accepted-offer order, nothing paid or settled;
--   * with a provider reference every order carries exactly that one;
--     without one, no payment request could still map an intent to them.
--
-- This is still the reservation-expiry transition brought forward for the
-- buyer's own unconfirmed checkout. No money rule changes: nothing it
-- touches has been paid, and it refuses anything that has.
--
-- Lock order unchanged: buyer advisory lock → purchase attempt → listings
-- (id order) → orders (id order) → payments. Service role only.

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
  -- 20261108110300: a guest's attempt (no checkout_request_key) is released
  -- too. Every attempt is a cart basket (only purchase_begin writes them),
  -- and the per-order checks below refuse an accepted offer regardless.
  if not found or a.buyer_id is distinct from p_buyer then
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
