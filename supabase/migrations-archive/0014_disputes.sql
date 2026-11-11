-- ============================================================================
-- 0014 — Disputes & partial refunds (production-readiness: "Refunds & disputes")
--
-- APPLIED to the live database on 31 Jul 2026 (direct connection), columns
-- and trigger verified post-apply.
--
-- Context: pre-dispatch cancellation + refund already worked (requestCancellation
-- in src/features/commerce/actions.ts), and `orders.status` already declares
-- 'disputed' (0007) and `payments` already carries `refunded_cents` and a
-- `partially_refunded` status (0007/0009 hand-written types). What was missing
-- was (a) somewhere on `orders` to hold a dispute's reason, who opened it and
-- what to resolve back to, and (b) a refund-offer handshake so a seller's
-- offered amount needs the buyer's acceptance before money moves.
--
-- `orders` has no user-facing UPDATE policy at all (0001/0006) — every status
-- change already goes through the service-role admin client from server
-- actions, exactly like markShipped/markReceived/requestCancellation. So there
-- is no RLS-bypassing transition to guard here the way 0012 guards `listings`;
-- the new columns below are additive and the enforcement lives in
-- src/features/commerce/actions.ts, matching the existing pattern for
-- fulfilment actions.
--
-- Idempotent: safe to re-run.
-- ============================================================================

begin;

-- ============================================================
-- orders — dispute + refund-offer state
-- ============================================================
alter table public.orders
  add column if not exists dispute_category text,
  add column if not exists dispute_reason text,
  add column if not exists disputed_at timestamptz,
  add column if not exists disputed_by uuid references public.profiles (id) on delete set null,
  add column if not exists dispute_resolved_at timestamptz,
  -- What to restore the order to when a dispute resolves without a full
  -- refund ('shipped' | 'delivered' | 'completed') — a dispute can only be
  -- opened after dispatch, so one of those three is always what's here.
  add column if not exists pre_dispute_status text,
  -- The seller's outstanding refund offer, awaiting the buyer's acceptance.
  -- Null when there is no live offer.
  add column if not exists refund_offer_cents int,
  add column if not exists refund_offered_at timestamptz;

alter table public.orders
  drop constraint if exists orders_dispute_category_check;
alter table public.orders
  add constraint orders_dispute_category_check check (
    dispute_category is null or dispute_category in (
      'item_not_received',
      'item_not_as_described',
      'damaged_in_transit',
      'wrong_item',
      'other'
    )
  );

alter table public.orders
  drop constraint if exists orders_refund_offer_cents_check;
alter table public.orders
  add constraint orders_refund_offer_cents_check check (
    refund_offer_cents is null or (refund_offer_cents > 0 and refund_offer_cents <= total_cents)
  );

create index if not exists orders_disputed_idx on public.orders (status) where status = 'disputed';

-- ============================================================
-- notify_on_order_status — teach it about disputed / resolved
-- ============================================================
-- Extends the function from 0009. 'disputed' was declared in the status
-- constraint since 0007 but nothing ever set it and nothing ever notified on
-- it — this is the "pipeline renders 'In dispute' for a state nothing can
-- set" gap. Dispute resolution can land the order back on a *non-terminal*
-- status (shipped/delivered/completed), which — without the dedicated branch
-- below — would silently fall into the existing 'shipped'/'delivered'
-- branches and send a misleading "your part is on its way" / "delivery
-- confirmed" notification for an order that isn't newly shipped or delivered
-- at all. So the disputed-resolution branch is checked first and the
-- ordinary forward-lifecycle branches are left untouched for the normal path.
create or replace function public.notify_on_order_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = old.status then
    return new;
  end if;

  if new.status = 'disputed' then
    perform public.notify(
      new.seller_id, 'order_disputed', 'marketplace',
      'A buyer opened a dispute',
      coalesce(new.dispute_reason, 'See the order for details'),
      '/orders/' || new.id, new.disputed_by
    );
  elsif old.status = 'disputed' and new.status <> 'refunded' then
    -- Resolved without a full refund: buyer closed it, or a partial refund
    -- was accepted and the order settled back to pre_dispute_status. The
    -- order/payment rows themselves carry whether money moved, so the
    -- notification just points both parties back at the order.
    perform public.notify(
      new.buyer_id, 'dispute_resolved', 'marketplace',
      'Dispute resolved', 'The order is settled', '/orders/' || new.id, null
    );
    perform public.notify(
      new.seller_id, 'dispute_resolved', 'marketplace',
      'Dispute resolved', 'The order is settled', '/orders/' || new.id, null
    );
  elsif new.status = 'paid' then
    perform public.notify(
      new.seller_id, 'order_sold', 'marketplace',
      'You made a sale',
      'Order ' || left(new.id::text, 8) || ' — dispatch when ready',
      '/orders/' || new.id, new.buyer_id
    );
    perform public.notify(
      new.buyer_id, 'order_paid', 'marketplace',
      'Payment confirmed', 'Your order is with the seller',
      '/orders/' || new.id, new.seller_id
    );
  elsif new.status = 'shipped' then
    perform public.notify(
      new.buyer_id, 'order_shipped', 'marketplace',
      'Your part is on its way',
      coalesce(new.carrier || ' · ' || new.tracking_number, 'Dispatched'),
      '/orders/' || new.id, new.seller_id
    );
  elsif new.status = 'delivered' then
    perform public.notify(
      new.seller_id, 'order_delivered', 'marketplace',
      'Delivery confirmed', 'The buyer marked the order received',
      '/orders/' || new.id, new.buyer_id
    );
  elsif new.status in ('cancelled', 'refunded', 'payment_failed') then
    perform public.notify(
      new.buyer_id, 'order_' || new.status, 'marketplace',
      'Order ' || replace(new.status, '_', ' '),
      coalesce(new.cancel_reason, null), '/orders/' || new.id, null
    );
    perform public.notify(
      new.seller_id, 'order_' || new.status, 'marketplace',
      'Order ' || replace(new.status, '_', ' '),
      coalesce(new.cancel_reason, null), '/orders/' || new.id, null
    );
  end if;

  return new;
end;
$$;

-- Function is `create or replace`d in place; the trigger already created in
-- 0009 keeps pointing at it, but re-stating it here keeps this file
-- self-sufficient (and idempotent) if 0009 is ever reordered.
drop trigger if exists orders_notify_status on public.orders;
create trigger orders_notify_status after update on public.orders
  for each row execute function public.notify_on_order_status();

commit;
