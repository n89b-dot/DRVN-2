-- ============================================================================
-- 20261107210050 — Payout readiness before any new payment; content frozen on
-- locked listings (OS-W16 follow-up to 20261107210000, review of #89)
--
-- 1. N244, P1. 20261107210000 checked a seller's payouts when a part was
--    reserved. An accepted offer reserves its part for up to a day, so a
--    seller whose payouts were switched off inside that window could still
--    be paid for: completeReservedOrder (and cart checkout) start the Stripe
--    payment without a new reservation. Every new Stripe payment is first
--    persisted by prepare_payment_request, so the check now also runs there,
--    for the first request of an operation key: a new payment for a seller
--    who can't take one is refused with LS001 before Stripe is called. A
--    request already persisted (a retry, a lost answer, reconciliation of a
--    PaymentIntent that may exist) is the same payment and is never refused.
--    The stub provider doesn't persist payment requests, and
--    job_config.payments_mode = 'stub' exempts it anyway.
--    prepare_payment_request is restated from 20261004130000 with only that
--    check added.
--
-- 2. N5/N69, P2. listings_aa_member_write_guard froze server-owned columns
--    but not the seller's own content: a seller's key could still change
--    condition, description, title and the rest of a reserved, sold or
--    removed listing (guard_listing_status freezes only price and shipping
--    while reserved; the editor already refused all of it). The guard now
--    refuses any content change by a member on a listing in those states.
--    guard_listing_member_write is restated from 20261107210000 with only
--    that check added.
--
-- Money rules don't change: who is paid and when is untouched; a payment
-- the documented rule forbids is no longer started.
--
-- Idempotent.
-- ============================================================================

begin;

-- ============================================================
-- 1. A new payment needs payable sellers
-- ============================================================

create or replace function public.prepare_payment_request(p_key text,p_request jsonb) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.payment_requests;
begin
 perform 1 from public.orders where id::text in (select jsonb_array_elements_text(p_request->'orderIds')) order by id for update;
 if not exists(select 1 from public.payment_requests where operation_key=p_key) and exists(
   select 1 from public.orders o where o.id::text in (select jsonb_array_elements_text(p_request->'orderIds'))
   and (o.status not in ('pending','requires_action') or exists(select 1 from public.remediation_jobs where dedup_key='expiry:'||o.id))
 ) then raise exception 'Checkout is closing; payment creation refused'; end if;
 -- 20261107210050 (N244): a NEW payment needs every seller it
 -- pays to be able to receive payouts now, not only when the part was
 -- reserved (an accepted offer holds its part for up to a day). A request
 -- already persisted is the same payment, and its replay or reconciliation
 -- is never refused here.
 if not exists(select 1 from public.payment_requests where operation_key=p_key) and exists(
   select 1 from public.orders o where o.id::text in (select jsonb_array_elements_text(p_request->'orderIds'))
   and not private.seller_can_take_payment(o.seller_id)
 ) then
   raise exception 'This seller can''t take payment yet: their payouts aren''t set up' using errcode='LS001';
 end if;
 insert into public.payment_requests(operation_key,request) values(p_key,p_request) on conflict do nothing;
 select * into r from public.payment_requests where operation_key=p_key for update;
 if r.request<>p_request then raise exception 'Payment parameters changed'; end if;
 return jsonb_build_object('request',r.request,'correlation_id',r.correlation_id,'reference',r.provider_reference,'created_at',r.created_at,'rejected',r.provider_rejected_at is not null);
end $$;

-- ============================================================
-- 2. A locked listing's content is frozen for its seller
-- ============================================================

create or replace function public.guard_listing_member_write()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if public.is_trusted_writer() then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.status not in ('draft', 'active') then
      raise exception 'A new listing is a draft or goes live; % is set by DRVN', new.status
        using errcode = '42501';
    end if;
    new.created_at := now();
    new.view_count := 0;
    new.sold_at := null;
    new.reserved_until := null;
    new.removed_at := null;
    new.removed_reason := null;
    new.currency := 'USD';
    return new;
  end if;

  if new.id is distinct from old.id
     or new.seller_id is distinct from old.seller_id
     or new.created_at is distinct from old.created_at
     or new.view_count is distinct from old.view_count
     or new.published_at is distinct from old.published_at
     or new.sold_at is distinct from old.sold_at
     or new.reserved_until is distinct from old.reserved_until
     or new.removed_at is distinct from old.removed_at
     or new.removed_reason is distinct from old.removed_reason
     or new.currency is distinct from old.currency
     or new.updated_at is distinct from old.updated_at then
    raise exception 'That listing field is set by DRVN, not by the seller'
      using errcode = '42501';
  end if;
  -- A reserved, sold or removed listing is what a buyer agreed to, or what
  -- moderation took down: its content is frozen for the seller, as the
  -- editor (update_listing_atomic) already refuses. Status moves out of these
  -- states are guard_listing_status's to judge.
  if old.status in ('reserved', 'sold', 'removed')
     and (to_jsonb(new) - 'status') is distinct from (to_jsonb(old) - 'status') then
    raise exception 'A sold, reserved or removed listing can''t be edited'
      using errcode = '55000';
  end if;
  return new;
end;
$$;

notify pgrst, 'reload schema';

commit;
