-- Architecture remediation plan 2, item A2, first of two: the database owns
-- every change to an order's status.
--
-- The application wrote orders.status, or the status a dispute will resolve
-- to (pre_dispute_status), directly in four places that still run:
--
--   src/lib/shipping/apply-tracking.ts      paid -> shipped             (carrier tracking)
--   src/lib/shipping/apply-tracking.ts      shipped -> delivered        (carrier tracking)
--   src/lib/admin/actions.ts                disputed -> the status before the dispute (support resolves for the seller)
--   src/features/commerce/dispute-actions.ts disputed -> the status before the dispute (the buyer closes their own dispute)
--
-- Each becomes a function here, with the same conditions the application's
-- update carried: the same compare-and-set on the current status, the same
-- columns, the same fallbacks. Nothing about when an order may move changes.
-- The second migration of A2 adds the guard that makes these functions, and
-- the twelve that already existed, the only way a status changes.
--
-- (Two more direct writes, in src/lib/payments/settlement.ts, were for a card
-- dispute being opened and being won. apply_stripe_dispute_event has done
-- both since 20261107130000, and the application code was no longer reached;
-- it is removed in the same pull request, with no function here.)
--
-- Every function is closed to PUBLIC, anon and authenticated, and granted to
-- service_role only: the application calls them with its server key, after
-- its own checks of who is asking, exactly as it made the updates.

begin;

-- ---------------------------------------------------------------------------
-- Carrier tracking says the parcel is moving: paid -> shipped, once.
--
-- Returns 'moved' when the order went from paid to shipped; 'moved_in_case'
-- when the order is in an open not-received case on an undispatched order
-- (N6): the case stays open and now resolves to 'shipped'; otherwise
-- 'unchanged:<status>' with the status the order has, or null when there is
-- no such order. The caller decides what an unchanged status means, as it
-- did when it read the row back itself.
-- ---------------------------------------------------------------------------
create or replace function public.order_mark_shipped_from_tracking(
  p_order uuid,
  p_shipped_at timestamptz,
  -- A shipment may have no carrier or code recorded; the order then holds
  -- null for it, as it did when the application wrote these columns.
  p_carrier text default null,
  p_tracking text default null
) returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  moved uuid;
  current_status text;
begin
  if p_order is null or p_shipped_at is null then
    raise exception 'An order and the time it shipped are required';
  end if;

  update public.orders
     set status = 'shipped',
         shipped_at = p_shipped_at,
         carrier = p_carrier,
         tracking_number = p_tracking
   where id = p_order and status = 'paid'
  returning id into moved;
  if moved is not null then return 'moved'; end if;

  update public.orders
     set pre_dispute_status = 'shipped',
         shipped_at = p_shipped_at,
         carrier = p_carrier,
         tracking_number = p_tracking
   where id = p_order and status = 'disputed' and pre_dispute_status = 'paid'
  returning id into moved;
  if moved is not null then return 'moved_in_case'; end if;

  select status into current_status from public.orders where id = p_order;
  if not found then return null; end if;
  return 'unchanged:' || current_status;
end $$;

revoke all on function public.order_mark_shipped_from_tracking(uuid, timestamptz, text, text) from public, anon, authenticated;
grant execute on function public.order_mark_shipped_from_tracking(uuid, timestamptz, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- Carrier tracking says every live outbound parcel arrived: shipped ->
-- delivered. The caller has already checked the shipments, as before.
--
-- Returns 'moved', 'moved_in_case' (delivered while a case is open: the case
-- stays open and now resolves to 'delivered', with this delivery's date),
-- 'unchanged:<status>', or null when there is no such order.
-- ---------------------------------------------------------------------------
create or replace function public.order_mark_delivered_from_tracking(
  p_order uuid,
  p_delivered_at timestamptz
) returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  moved uuid;
  current_status text;
begin
  if p_order is null or p_delivered_at is null then
    raise exception 'An order and the time it was delivered are required';
  end if;

  update public.orders
     set status = 'delivered',
         delivered_at = p_delivered_at
   where id = p_order and status = 'shipped'
  returning id into moved;
  if moved is not null then return 'moved'; end if;

  update public.orders
     set pre_dispute_status = 'delivered',
         delivered_at = p_delivered_at
   where id = p_order and status = 'disputed' and pre_dispute_status = 'shipped'
  returning id into moved;
  if moved is not null then return 'moved_in_case'; end if;

  select status into current_status from public.orders where id = p_order;
  if not found then return null; end if;
  return 'unchanged:' || current_status;
end $$;

revoke all on function public.order_mark_delivered_from_tracking(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.order_mark_delivered_from_tracking(uuid, timestamptz) to service_role;

-- ---------------------------------------------------------------------------
-- A dispute closes with no money moving: the order goes back to the status
-- it had before the dispute ('delivered' when none was recorded), and any
-- refund offer is withdrawn.
--
-- Two callers, two outcomes, and each must say who it is:
--   'closed_by_buyer'  the buyer closes their own dispute; p_buyer is that
--                      buyer, and the order must be theirs;
--   'admin_resolved'   support resolves for the seller; p_buyer is null.
--
-- Returns the status the order was restored to, or null when the order is
-- not in dispute (already settled, not this buyer's, or no such order).
--
-- The application read pre_dispute_status and wrote it back in a second
-- statement. Here it is one statement, so a delivery recorded in between
-- (which moves pre_dispute_status) is never overwritten with the older value.
-- ---------------------------------------------------------------------------
create or replace function public.order_close_dispute(
  p_order uuid,
  p_outcome text,
  p_resolved_at timestamptz,
  p_buyer uuid default null
) returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  restored text;
begin
  if p_order is null or p_resolved_at is null then
    raise exception 'An order and the time the dispute closed are required';
  end if;
  if p_outcome is null or p_outcome not in ('closed_by_buyer', 'admin_resolved') then
    raise exception 'A dispute closes without a refund as closed_by_buyer or admin_resolved, not %', coalesce(p_outcome, 'null');
  end if;
  if (p_outcome = 'closed_by_buyer') <> (p_buyer is not null) then
    raise exception 'closed_by_buyer needs the buyer, and admin_resolved must not name one';
  end if;

  update public.orders
     set status = coalesce(pre_dispute_status, 'delivered'),
         dispute_resolved_at = p_resolved_at,
         dispute_outcome = p_outcome,
         refund_offer_cents = null,
         refund_offered_at = null
   where id = p_order
     and status = 'disputed'
     and (p_buyer is null or buyer_id = p_buyer)
  returning status into restored;
  return restored;
end $$;

revoke all on function public.order_close_dispute(uuid, text, timestamptz, uuid) from public, anon, authenticated;
grant execute on function public.order_close_dispute(uuid, text, timestamptz, uuid) to service_role;

commit;
