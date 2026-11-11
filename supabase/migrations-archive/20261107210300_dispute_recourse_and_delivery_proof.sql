-- 20261107210300 — disputes and delivery proof, eBay-style
-- (OS-W29: N6, N91, N92, N95; OS-R-disputecats). Ruled by Neil, 7 Nov 2026.
--
-- N6 "Copy eBay": a paid buyer had no way out when the seller never shipped.
--    dispute-command.ts refused a dispute before dispatch, and nothing knew
--    when an order should have arrived.
--      * Each order freezes three dates when it becomes paid (trigger
--        orders_freeze_deadlines): dispatch_by (the seller's handling time),
--        deliver_by (the latest delivery date) and, for collection,
--        available_by. They never change afterwards.
--          handling = the seller's seller_fulfillment_profiles
--                     .default_handling_days, else 3 business days;
--          transit  = the longest est_delivery_days frozen in
--                     orders.shipping_quote (rated checkout), else 5
--                     business days, or 15 when the destination country
--                     differs from the seller's ship-from country.
--      * "Item never arrived" opens from the latest delivery date (or the
--        actual delivery date, when the carrier delivered) up to 30 days
--        after it, undispatched orders included. For collection it opens
--        from available_by. open_order_dispute is the one way in.
--      * The seller has 3 business days (dispute_respond_by). Either party
--        can escalate from 3 to 21 business days after the report
--        (escalate_order_dispute). Once a not-received case is escalated and
--        the seller's 3 days are up, DRVN refunds in full through refundOrder
--        when there is no valid tracking (not_received_refund_due): no
--        delivery proof (N95) in 'verified' or 'review' for a live outbound
--        shipment, or, for collection, the item was never made available.
--      * Dispatch and tracking stay possible while a case is open:
--        mark_order_dispatched accepts a disputed order whose pre-dispute
--        status is 'paid' (unless a bank chargeback is unresolved) and moves
--        pre_dispute_status to 'shipped'; the order stays disputed.
--        Resolving such a case restores 'paid' (disputed -> paid).
--      * Adding valid tracking is the seller's answer to a not-received
--        case, so the day-10 silence auto-refund (dispute-sla.ts) skips one
--        that has it (order_has_valid_tracking); support decides it.
--      * escalate_stale_disputes (the daily cron, 0021) now waits for the
--        frozen seller-response deadline plus a day, rather than 4 calendar
--        days, so it never escalates inside the seller's 3 business days.
--
-- N91 "Resolved is final": an in-app case, once resolved, is final.
--      * order_dispute_history keeps every closed case (trigger
--        orders_record_dispute_history) and is append-only.
--      * orders_guard_dispute refuses entering 'disputed' again when the
--        order has a resolved in-app case, except a bank chargeback (a new
--        stripe_dispute_id; 20260905195518:105 is untouched) and the admin
--        reopen below.
--      * execute_admin_command('dispute.reopen') is the admin-only, audited
--        reopen: it opens a follow-up case on the same order, with the
--        previous case's category and reason, escalated to support at once,
--        on a fresh clock; the previous case and its resolution stay in
--        order_dispute_history, and the reopen is recorded there too.
--
-- N92 "Offers expire": every refund offer gets an immutable 48-hour expiry,
--      derived from its refund_offered_at (refund_offer_expires_at). Claiming
--      an expired offer (acceptRefund's compare-and-set) is refused by the
--      guard trigger, and escalation ignores an expired offer, whether or not
--      expire_refund_offers (the worker's cleanup) has run. While a case is
--      open its reason, opener and clocks cannot change, so neither a new
--      offer nor an expiry moves the dispute clock. Active-return handling is
--      unchanged.
--
-- N95 "Copy eBay": delivery_proofs is a separate verified-proof record, one
--      per delivered outbound shipment, written by record_delivery_proof from
--      the carrier's evidence. 'verified' needs the carrier's delivered date
--      (never "now"), a destination matching the order (postcode, else city
--      when the carrier gave no postcode), a shipping scan before the latest
--      delivery date and after the sale, and a signature at $750+. Anything
--      missing or contradictory is 'review'. The database copies the order's
--      own facts onto the row and a CHECK refuses a 'verified' row they don't
--      support. Proof never gates dispatch or payouts.
--
-- R-disputecats: 'counterfeit' and 'does_not_fit' join the category CHECK.
--      They take the not-as-described path (shipped orders, 30 days from
--      delivery) and the protection-return path, which is category-agnostic.
--
-- Business days are Monday to Friday in UTC, with no holiday calendar.
--
-- Unchanged: who is paid and when (available_at, 2 days after delivery), the
-- day-10 auto-refund, refund amounts and caps, fees, holds, and every
-- chargeback rule from 20261107130000.
--
-- Latest definitions restated: mark_order_dispatched and pickup_mint_pass
-- (20261107200100), pickup_redeem (20261006100000), escalate_stale_disputes
-- (0021), execute_admin_command (20261007100100).
-- No open branch redefines them. Idempotent.

begin;

-- ============================================================
-- 0. Business days and destination keys
-- ============================================================

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- Monday to Friday, counted in UTC, no holidays. Adding n business days
-- steps one calendar day at a time and counts only weekdays, keeping the time
-- of day: Thu + 3 = Tue, Fri + 1 = Mon, Sat + 1 = Mon. Mirrors
-- src/lib/domain/business-days.ts.
create or replace function private.add_business_days(p_from timestamptz, p_days integer)
returns timestamptz
language plpgsql
immutable
set search_path = pg_catalog, pg_temp
as $$
declare
  v timestamp;
  n integer := 0;
begin
  if p_from is null or p_days is null then return null; end if;
  if p_days < 0 then raise exception 'Business days cannot be negative' using errcode = '22023'; end if;
  v := p_from at time zone 'UTC';
  while n < p_days loop
    v := v + interval '1 day';
    if extract(isodow from v) < 6 then n := n + 1; end if;
  end loop;
  return v at time zone 'UTC';
end $$;

-- Postcode comparison key: letters and digits only, upper case; a US
-- ZIP+4 compares on its ZIP. Mirrors postcodeKey in
-- src/lib/shipping/delivery-proof.ts.
create or replace function private.postcode_key(p_code text, p_country text)
returns text
language sql
immutable
set search_path = pg_catalog, pg_temp
as $$
  select case
    when k = '' then null
    when k ~ '^[0-9]{9}$' and (p_country is null or upper(btrim(p_country)) in ('US', 'USA')) then left(k, 5)
    else k
  end
  from (select upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g')) as k) s;
$$;

-- City comparison key: letters and digits only, upper case. Mirrors cityKey.
create or replace function private.city_key(p_city text)
returns text
language sql
immutable
set search_path = pg_catalog, pg_temp
as $$
  select nullif(upper(regexp_replace(coalesce(p_city, ''), '[^[:alnum:]]', '', 'g')), '');
$$;

revoke all on function private.add_business_days(timestamptz, integer) from public, anon, authenticated;
revoke all on function private.postcode_key(text, text) from public, anon, authenticated;
revoke all on function private.city_key(text) from public, anon, authenticated;

-- ============================================================
-- 1. Orders: frozen deadlines, dispute clocks, offer expiry, categories
-- ============================================================

alter table public.orders
  add column if not exists dispatch_by timestamptz,
  add column if not exists deliver_by timestamptz,
  add column if not exists available_by timestamptz,
  add column if not exists delivery_estimate_source text,
  add column if not exists dispute_respond_by timestamptz,
  add column if not exists dispute_escalate_until timestamptz,
  add column if not exists refund_offer_expires_at timestamptz;

alter table public.orders drop constraint if exists orders_delivery_estimate_source_check;
alter table public.orders add constraint orders_delivery_estimate_source_check
  check (delivery_estimate_source is null or delivery_estimate_source in ('quote', 'fallback', 'collection'));

alter table public.orders drop constraint if exists orders_dispute_category_check;
alter table public.orders add constraint orders_dispute_category_check check (
  dispute_category is null or dispute_category in (
    'item_not_received',
    'item_not_as_described',
    'damaged_in_transit',
    'wrong_item',
    'counterfeit',
    'does_not_fit',
    'other'
  )
);

comment on column public.orders.dispatch_by is
  'Frozen when the order became paid (20261107210300): paid + the seller''s handling business days. Shipping orders only.';
comment on column public.orders.deliver_by is
  'Latest delivery date, frozen when paid: dispatch_by + transit business days (quote, else 5 domestic / 15 international). "Item never arrived" opens here.';
comment on column public.orders.available_by is
  'Collection orders: when the item must be made available, frozen when paid (paid + handling business days).';
comment on column public.orders.dispute_respond_by is
  'Seller response deadline: 3 business days after the report. Escalation opens here.';
comment on column public.orders.dispute_escalate_until is
  'Last moment either party can escalate: 21 business days after the report.';
comment on column public.orders.refund_offer_expires_at is
  'refund_offered_at + 48 hours, always (orders_freeze_deadlines). An expired offer cannot be accepted and does not block escalation.';

create index if not exists orders_not_received_due_idx
  on public.orders (dispute_respond_by)
  where status = 'disputed' and dispute_category = 'item_not_received';
create index if not exists orders_refund_offer_expiry_idx
  on public.orders (refund_offer_expires_at)
  where status = 'disputed' and refund_offered_at is not null;

-- The deadlines an order freezes when it becomes paid.
create or replace function private.order_deadlines(
  p_seller uuid,
  p_is_collection boolean,
  p_ship_country text,
  p_shipping_quote jsonb,
  p_paid_at timestamptz,
  out dispatch_by timestamptz,
  out deliver_by timestamptz,
  out available_by timestamptz,
  out estimate_source text
)
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare
  v_handling integer;
  v_seller_country text;
  v_transit integer;
begin
  select p.default_handling_days, p.country into v_handling, v_seller_country
    from public.seller_fulfillment_profiles p
   where p.seller_id = p_seller;
  v_handling := least(greatest(coalesce(v_handling, 3), 1), 10);

  if coalesce(p_is_collection, false) then
    available_by := private.add_business_days(p_paid_at, v_handling);
    estimate_source := 'collection';
    return;
  end if;

  select max(ceil((e ->> 'est_delivery_days')::numeric))::integer into v_transit
    from jsonb_array_elements(
           case when jsonb_typeof(p_shipping_quote) = 'array' then p_shipping_quote else '[]'::jsonb end
         ) e
   where jsonb_typeof(e -> 'est_delivery_days') = 'number'
     and (e ->> 'est_delivery_days')::numeric > 0;

  if v_transit is not null then
    estimate_source := 'quote';
    v_transit := least(v_transit, 30);
  else
    estimate_source := 'fallback';
    v_transit := case
      when p_ship_country is not null and v_seller_country is not null
           and upper(btrim(p_ship_country)) <> upper(btrim(v_seller_country)) then 15
      else 5
    end;
  end if;

  dispatch_by := private.add_business_days(p_paid_at, v_handling);
  deliver_by := private.add_business_days(dispatch_by, v_transit);
end $$;

revoke all on function private.order_deadlines(uuid, boolean, text, jsonb, timestamptz)
  from public, anon, authenticated;

-- Backfill before the guards exist: every live order gets deadlines counted
-- from when it was created, and every open case gets its clocks counted from
-- when it was reported. (On a re-run the guards are dropped first and
-- recreated below, in this same transaction.)
drop trigger if exists orders_freeze_deadlines on public.orders;
drop trigger if exists orders_guard_dispute on public.orders;
update public.orders o
   set (dispatch_by, deliver_by, available_by, delivery_estimate_source) = (
         select d.dispatch_by, d.deliver_by, d.available_by, d.estimate_source
           from private.order_deadlines(o.seller_id, o.is_collection, o.ship_country, o.shipping_quote, o.created_at) d
       )
 where o.status in ('paid', 'shipped', 'delivered', 'completed', 'disputed')
   and o.dispatch_by is null and o.deliver_by is null and o.available_by is null;

update public.orders
   set dispute_respond_by = private.add_business_days(disputed_at, 3),
       dispute_escalate_until = private.add_business_days(disputed_at, 21)
 where status = 'disputed' and disputed_at is not null
   and dispute_respond_by is null;

update public.orders
   set refund_offer_expires_at = refund_offered_at + interval '48 hours'
 where refund_offered_at is not null and refund_offer_expires_at is null;

-- ============================================================
-- 2. order_dispute_history: closed cases and reopens, append-only
-- ============================================================

create table if not exists public.order_dispute_history (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  event text not null check (event in ('resolved', 'reopened')),
  -- 'chargeback' when the case on the order was the bank's (its reason is
  -- the "Card dispute … — <id>" text apply_stripe_dispute_event writes).
  kind text not null check (kind in ('in_app', 'chargeback')),
  category text,
  reason text,
  opened_at timestamptz,
  opened_by uuid,
  respond_by timestamptz,
  escalate_until timestamptz,
  escalated_at timestamptz,
  escalated_by uuid,
  pre_dispute_status text,
  stripe_dispute_id text,
  resolved_at timestamptz,
  outcome text,
  resolved_to_status text,
  -- reopen only: the admin, their audited reason, and the case reopened.
  actor_id uuid,
  note text,
  reopened_from uuid references public.order_dispute_history (id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint order_dispute_history_note_bounds check (note is null or char_length(note) <= 4000)
);

create index if not exists order_dispute_history_order_idx
  on public.order_dispute_history (order_id, created_at);
create index if not exists order_dispute_history_reopened_from_idx
  on public.order_dispute_history (reopened_from) where reopened_from is not null;

alter table public.order_dispute_history enable row level security;
revoke all on public.order_dispute_history from anon, authenticated;

comment on table public.order_dispute_history is
  'Every closed dispute case and every admin reopen (20261107210300). Append-only: a resolved in-app case is final (N91).';

create or replace function public.reject_dispute_history_mutation()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'DELETE' and not exists (select 1 from public.orders where id = old.order_id) then
    return old; -- the order itself was deleted (cascade)
  end if;
  raise exception 'Dispute history is append-only' using errcode = '42501';
end $$;
revoke all on function public.reject_dispute_history_mutation() from public, anon, authenticated;

drop trigger if exists order_dispute_history_append_only on public.order_dispute_history;
create trigger order_dispute_history_append_only
  before update or delete on public.order_dispute_history
  for each row execute function public.reject_dispute_history_mutation();

-- Backfill: every case already resolved is on record, so finality covers
-- cases closed before this migration.
insert into public.order_dispute_history (
  order_id, event, kind, category, reason, opened_at, opened_by, escalated_at, escalated_by,
  pre_dispute_status, stripe_dispute_id, resolved_at, outcome, resolved_to_status
)
select o.id, 'resolved',
       case when o.stripe_dispute_id is not null
             and o.dispute_reason like 'Card dispute % — ' || o.stripe_dispute_id then 'chargeback' else 'in_app' end,
       o.dispute_category, o.dispute_reason, o.disputed_at, o.disputed_by,
       o.dispute_escalated_at, o.dispute_escalated_by, o.pre_dispute_status, o.stripe_dispute_id,
       o.dispute_resolved_at, o.dispute_outcome, o.status
  from public.orders o
 where o.status <> 'disputed'
   and o.disputed_at is not null
   and (o.dispute_resolved_at is not null or o.status = 'refunded')
   and not exists (select 1 from public.order_dispute_history h where h.order_id = o.id);

-- ============================================================
-- 3. Triggers on orders
-- ============================================================

-- Deadlines freeze when the order becomes paid and never move; the offer
-- expiry is always refund_offered_at + 48 hours.
create or replace function public.freeze_order_deadlines()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  d record;
begin
  if tg_op = 'UPDATE' and (
       (old.dispatch_by is not null and new.dispatch_by is distinct from old.dispatch_by)
    or (old.deliver_by is not null and new.deliver_by is distinct from old.deliver_by)
    or (old.available_by is not null and new.available_by is distinct from old.available_by)
    or (old.delivery_estimate_source is not null and new.delivery_estimate_source is distinct from old.delivery_estimate_source)
  ) then
    raise exception 'Delivery deadlines are frozen at purchase' using errcode = '42501';
  end if;

  if new.status = 'paid'
     and (tg_op = 'INSERT' or old.status is distinct from 'paid')
     and new.dispatch_by is null and new.deliver_by is null and new.available_by is null then
    select * into d from private.order_deadlines(
      new.seller_id, new.is_collection, new.ship_country, new.shipping_quote,
      case when tg_op = 'INSERT' then least(coalesce(new.created_at, now()), now()) else now() end
    );
    new.dispatch_by := d.dispatch_by;
    new.deliver_by := d.deliver_by;
    new.available_by := d.available_by;
    new.delivery_estimate_source := d.estimate_source;
  end if;

  new.refund_offer_expires_at := case
    when new.refund_offered_at is null then null
    else new.refund_offered_at + interval '48 hours'
  end;
  return new;
end $$;
revoke all on function public.freeze_order_deadlines() from public, anon, authenticated;

drop trigger if exists orders_freeze_deadlines on public.orders;
create trigger orders_freeze_deadlines
  before insert or update on public.orders
  for each row execute function public.freeze_order_deadlines();

-- Finality (N91), a fixed clock (N92) and offer expiry at acceptance (N92).
create or replace function public.guard_order_dispute()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- Entering a case.
  if new.status = 'disputed' and old.status is distinct from 'disputed' then
    if not (new.stripe_dispute_id is not null and new.stripe_dispute_id is distinct from old.stripe_dispute_id)
       and coalesce(current_setting('drvn.dispute_reopen', true), '') <> 'admin'
       and exists (
         select 1 from public.order_dispute_history h
          where h.order_id = new.id and h.event = 'resolved' and h.kind = 'in_app'
       ) then
      raise exception 'This order''s dispute was resolved and is final; only DRVN support can reopen it'
        using errcode = '42501';
    end if;
  end if;

  if old.status = 'disputed' and new.status = 'disputed' then
    -- The case's reason, opener and clocks are fixed while it is open.
    if new.disputed_at is distinct from old.disputed_at
       -- (a deleted account's ON DELETE SET NULL may clear the opener)
       or (new.disputed_by is distinct from old.disputed_by and new.disputed_by is not null)
       or new.dispute_category is distinct from old.dispute_category
       or new.dispute_reason is distinct from old.dispute_reason
       or new.dispute_respond_by is distinct from old.dispute_respond_by
       or new.dispute_escalate_until is distinct from old.dispute_escalate_until then
      raise exception 'An open dispute''s reason and clocks cannot change' using errcode = '42501';
    end if;
    -- Accepting an offer claims it (refund_offered_at -> null, amount kept).
    -- An expired offer cannot be claimed, whether or not cleanup has run.
    if old.refund_offered_at is not null and new.refund_offered_at is null
       and new.refund_offer_cents is not null
       and old.refund_offer_expires_at <= now() then
      raise exception 'This refund offer has expired' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
revoke all on function public.guard_order_dispute() from public, anon, authenticated;

drop trigger if exists orders_guard_dispute on public.orders;
create trigger orders_guard_dispute
  before update on public.orders
  for each row execute function public.guard_order_dispute();

-- Every case that closes is kept.
create or replace function public.record_dispute_history()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.order_dispute_history (
    order_id, event, kind, category, reason, opened_at, opened_by, respond_by, escalate_until,
    escalated_at, escalated_by, pre_dispute_status, stripe_dispute_id, resolved_at, outcome,
    resolved_to_status
  ) values (
    new.id, 'resolved',
    case when old.stripe_dispute_id is not null
          and old.dispute_reason like 'Card dispute % — ' || old.stripe_dispute_id then 'chargeback' else 'in_app' end,
    old.dispute_category, old.dispute_reason, old.disputed_at, old.disputed_by,
    old.dispute_respond_by, old.dispute_escalate_until, old.dispute_escalated_at,
    old.dispute_escalated_by, old.pre_dispute_status, old.stripe_dispute_id,
    coalesce(new.dispute_resolved_at, now()), new.dispute_outcome, new.status
  );
  return new;
end $$;
revoke all on function public.record_dispute_history() from public, anon, authenticated;

drop trigger if exists orders_record_dispute_history on public.orders;
create trigger orders_record_dispute_history
  after update of status on public.orders
  for each row
  when (old.status = 'disputed' and new.status is distinct from 'disputed')
  execute function public.record_dispute_history();

-- ============================================================
-- 4. Delivery proof (N95)
-- ============================================================

create table if not exists public.delivery_proofs (
  shipment_id uuid primary key references public.shipments (id) on delete cascade,
  order_id uuid not null references public.orders (id) on delete cascade,
  carrier text,
  tracking_code text,
  -- The carrier's evidence.
  carrier_delivered_at timestamptz,
  destination_postcode text,
  destination_city text,
  first_scan_at timestamptz,
  signed_by text,
  -- The newest carrier event the evidence came from. A delayed, older
  -- payload never replaces newer evidence.
  evidence_at timestamptz,
  -- The order's own facts, copied by record_delivery_proof, never by the app.
  order_postcode text,
  order_city text,
  order_country text,
  order_created_at timestamptz not null,
  deliver_by timestamptz,
  signature_required boolean not null,
  -- The judgement.
  destination_match text not null check (destination_match in ('postcode', 'city', 'mismatch', 'missing')),
  verdict text not null check (verdict in ('verified', 'review')),
  reasons text[] not null default '{}',
  evaluated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint delivery_proofs_verified_evidence check (
    verdict <> 'verified' or (
      cardinality(reasons) = 0
      and carrier_delivered_at is not null
      and carrier_delivered_at >= order_created_at
      and first_scan_at is not null
      and first_scan_at >= order_created_at
      and deliver_by is not null
      and first_scan_at <= deliver_by
      and (not signature_required or nullif(btrim(signed_by), '') is not null)
      and (
        (destination_match = 'postcode'
          and private.postcode_key(destination_postcode, order_country) is not null
          and private.postcode_key(destination_postcode, order_country) = private.postcode_key(order_postcode, order_country))
        or (destination_match = 'city'
          and private.postcode_key(destination_postcode, order_country) is null
          and private.city_key(destination_city) is not null
          and private.city_key(destination_city) = private.city_key(order_city))
      )
    )
  )
);

create index if not exists delivery_proofs_order_idx on public.delivery_proofs (order_id);

alter table public.delivery_proofs enable row level security;
revoke all on public.delivery_proofs from anon, authenticated;

comment on table public.delivery_proofs is
  'One verified-proof record per delivered outbound shipment (N95, 20261107210300). verified needs carrier date, matching destination, an in-time scan and a $750+ signature; anything else is review. Decides not-received cases; never gates dispatch or payouts.';

-- Written from the tracking path (src/lib/shipping/delivery-proof.ts). The
-- app sends the carrier's evidence and its judgement; this function copies
-- the order's frozen facts onto the row and, when the app's 'verified' is not
-- supported by them, stores 'review' instead.
create or replace function public.record_delivery_proof(
  p_shipment uuid,
  p_destination_match text,
  p_verdict text,
  p_reasons text[],
  p_carrier_delivered_at timestamptz default null,
  p_destination_postcode text default null,
  p_destination_city text default null,
  p_first_scan_at timestamptz default null,
  p_signed_by text default null,
  p_evidence_at timestamptz default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  s public.shipments;
  o public.orders;
  v_verdict text := p_verdict;
  v_reasons text[] := coalesce(p_reasons, '{}'::text[]);
  v_existing public.delivery_proofs;
begin
  if p_shipment is null or p_verdict not in ('verified', 'review')
     or p_destination_match not in ('postcode', 'city', 'mismatch', 'missing') then
    raise exception 'Invalid delivery proof' using errcode = '22023';
  end if;
  select * into s from public.shipments where id = p_shipment for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'no_shipment'); end if;
  if s.direction <> 'outbound' or s.status <> 'delivered' then
    return jsonb_build_object('ok', false, 'reason', 'not_delivered');
  end if;
  select * into strict o from public.orders where id = s.order_id;

  -- Freshness: evidence older than what is on record never replaces it (a
  -- delayed webhook after a verified delivery). Undated evidence only
  -- replaces undated evidence, such as a backfilled review record.
  select * into v_existing from public.delivery_proofs where shipment_id = s.id;
  if found and v_existing.evidence_at is not null
     and (p_evidence_at is null or p_evidence_at < v_existing.evidence_at) then
    return jsonb_build_object('ok', true, 'stale', true, 'verdict', v_existing.verdict,
      'reasons', to_jsonb(v_existing.reasons));
  end if;

  <<attempt>>
  loop
    begin
      insert into public.delivery_proofs as p (
        shipment_id, order_id, carrier, tracking_code, carrier_delivered_at, destination_postcode,
        destination_city, first_scan_at, signed_by, evidence_at, order_postcode, order_city, order_country,
        order_created_at, deliver_by, signature_required, destination_match, verdict, reasons
      ) values (
        s.id, o.id, s.carrier, s.tracking_code, p_carrier_delivered_at,
        nullif(left(btrim(p_destination_postcode), 40), ''), nullif(left(btrim(p_destination_city), 120), ''),
        p_first_scan_at, nullif(left(btrim(p_signed_by), 200), ''), p_evidence_at,
        o.ship_postcode, o.ship_city, o.ship_country, o.created_at, o.deliver_by,
        o.total_cents >= 75000, p_destination_match, v_verdict, v_reasons
      )
      on conflict (shipment_id) do update set
        carrier = excluded.carrier,
        tracking_code = excluded.tracking_code,
        carrier_delivered_at = excluded.carrier_delivered_at,
        destination_postcode = excluded.destination_postcode,
        destination_city = excluded.destination_city,
        first_scan_at = excluded.first_scan_at,
        signed_by = excluded.signed_by,
        evidence_at = excluded.evidence_at,
        order_postcode = excluded.order_postcode,
        order_city = excluded.order_city,
        order_country = excluded.order_country,
        order_created_at = excluded.order_created_at,
        deliver_by = excluded.deliver_by,
        signature_required = excluded.signature_required,
        destination_match = excluded.destination_match,
        verdict = excluded.verdict,
        reasons = excluded.reasons,
        evaluated_at = now();
      exit attempt;
    exception when check_violation then
      if v_verdict = 'review' then raise; end if;
      -- The app said verified; the order's own facts don't support it.
      v_verdict := 'review';
      v_reasons := array['evidence_check_failed'];
    end;
  end loop;

  return jsonb_build_object('ok', true, 'verdict', v_verdict, 'reasons', to_jsonb(v_reasons));
end $$;

revoke all on function public.record_delivery_proof(uuid, text, text, text[], timestamptz, text, text, timestamptz, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.record_delivery_proof(uuid, text, text, text[], timestamptz, text, text, timestamptz, text, timestamptz)
  to service_role;

-- Shipments delivered before this record existed: a 'review' record, so an
-- existing not-received case never refunds over a recorded carrier
-- delivery, and an evaluation job that re-reads the carrier's evidence
-- (tracker-registration.ts, 'evaluate_proof') when a provider is configured.
insert into public.delivery_proofs (
  shipment_id, order_id, carrier, tracking_code, order_postcode, order_city, order_country,
  order_created_at, deliver_by, signature_required, destination_match, verdict, reasons
)
select s.id, o.id, s.carrier, s.tracking_code, o.ship_postcode, o.ship_city, o.ship_country,
       o.created_at, o.deliver_by, o.total_cents >= 75000, 'missing', 'review', array['recorded_before_proof']
  from public.shipments s
  join public.orders o on o.id = s.order_id
 where s.direction = 'outbound' and s.status = 'delivered'
on conflict (shipment_id) do nothing;

insert into public.remediation_jobs (kind, dedup_key, payload)
select 'tracker_registration', 'proof:' || p.shipment_id,
       jsonb_build_object('shipment_id', p.shipment_id, 'order_id', p.order_id, 'evaluate_proof', true)
  from public.delivery_proofs p
 where p.reasons = array['recorded_before_proof']
on conflict (dedup_key) do nothing;

-- ============================================================
-- 5. Opening a case (N6, N91, R-disputecats)
-- ============================================================

create or replace function public.open_order_dispute(
  p_order uuid,
  p_buyer uuid,
  p_category text,
  p_reason text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  o public.orders;
  v_anchor timestamptz;
  v_closes timestamptz;
  v_now timestamptz := now();
  v_reason text := nullif(left(btrim(coalesce(p_reason, '')), 1000), '');
begin
  if p_order is null or p_buyer is null then raise exception 'Order and buyer are required'; end if;
  if p_category is null or p_category not in (
       'item_not_received', 'item_not_as_described', 'damaged_in_transit', 'wrong_item',
       'counterfeit', 'does_not_fit', 'other') then
    return jsonb_build_object('ok', false, 'reason', 'invalid_category');
  end if;

  select * into o from public.orders where id = p_order for update;
  if not found or o.buyer_id is distinct from p_buyer then
    return jsonb_build_object('ok', false, 'reason', 'not_your_order');
  end if;
  if o.status = 'disputed' then return jsonb_build_object('ok', false, 'reason', 'already_open'); end if;
  if exists (select 1 from public.order_dispute_history h
              where h.order_id = o.id and h.event = 'resolved' and h.kind = 'in_app') then
    return jsonb_build_object('ok', false, 'reason', 'resolved_final');
  end if;
  if o.seller_id is null then return jsonb_build_object('ok', false, 'reason', 'seller_gone'); end if;
  if private.order_has_unresolved_chargeback(o.id) then
    return jsonb_build_object('ok', false, 'reason', 'chargeback_open');
  end if;

  if p_category = 'item_not_received' then
    if o.is_collection then
      if o.status <> 'paid' then return jsonb_build_object('ok', false, 'reason', 'wrong_stage'); end if;
      v_anchor := o.available_by;
    elsif o.status in ('paid', 'shipped') then
      v_anchor := coalesce(o.delivered_at, o.deliver_by);
    elsif o.status = 'delivered' and exists (
      -- "Tracking says delivered, but it never came": only a carrier
      -- delivery, not the buyer's own confirmation.
      select 1 from public.shipments s
       where s.order_id = o.id and s.direction = 'outbound' and s.status = 'delivered'
    ) then
      v_anchor := coalesce(o.delivered_at, o.deliver_by);
    else
      return jsonb_build_object('ok', false, 'reason', 'wrong_stage');
    end if;
    if v_anchor is null then return jsonb_build_object('ok', false, 'reason', 'no_deadline'); end if;
    v_closes := v_anchor + interval '30 days';
    if v_now < v_anchor then
      return jsonb_build_object('ok', false, 'reason', 'too_early', 'opens_at', v_anchor);
    end if;
    if v_now > v_closes then
      return jsonb_build_object('ok', false, 'reason', 'window_closed', 'closed_at', v_closes);
    end if;
  else
    if o.status not in ('shipped', 'delivered', 'completed') then
      return jsonb_build_object('ok', false, 'reason', 'wrong_stage');
    end if;
    if o.delivered_at is not null and v_now > o.delivered_at + interval '30 days' then
      return jsonb_build_object('ok', false, 'reason', 'window_closed', 'closed_at', o.delivered_at + interval '30 days');
    end if;
  end if;

  update public.orders set
    status = 'disputed',
    pre_dispute_status = o.status,
    dispute_category = p_category,
    dispute_reason = v_reason,
    disputed_at = v_now,
    disputed_by = p_buyer,
    dispute_respond_by = private.add_business_days(v_now, 3),
    dispute_escalate_until = private.add_business_days(v_now, 21),
    dispute_escalated_at = null,
    dispute_escalated_by = null,
    dispute_sla_alerted_at = null,
    dispute_resolved_at = null,
    dispute_outcome = null,
    refund_offer_cents = null,
    refund_offered_at = null
  where id = o.id;

  return jsonb_build_object(
    'ok', true,
    'respond_by', private.add_business_days(v_now, 3),
    'escalate_until', private.add_business_days(v_now, 21)
  );
end $$;

revoke all on function public.open_order_dispute(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.open_order_dispute(uuid, uuid, text, text) to service_role;

-- ============================================================
-- 6. Not received: when DRVN refunds (N6)
-- ============================================================

-- Valid tracking for a not-received case: a delivery proof in 'verified' or
-- 'review' (support decides) on a live outbound shipment, a carrier-delivered
-- shipment whose proof isn't recorded yet, or, for collection, the item made
-- available.
create or replace function private.order_has_valid_tracking(p_order uuid)
returns boolean
language sql
stable
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.orders o
     where o.id = p_order
       and case
         when o.is_collection then o.pickup_ready_at is not null
         else exists (
           select 1
             from public.delivery_proofs p
             join public.shipments s on s.id = p.shipment_id
            where p.order_id = o.id
              and s.status not in ('cancelled', 'failed')
              and p.verdict in ('verified', 'review')
         )
         -- A carrier delivery whose proof isn't on record yet (still being
         -- evaluated, or a recording retry) protects the seller too.
         or exists (
           select 1 from public.shipments s
            where s.order_id = o.id and s.direction = 'outbound' and s.status = 'delivered'
              and not exists (select 1 from public.delivery_proofs p where p.shipment_id = s.id)
         )
       end
  );
$$;
revoke all on function private.order_has_valid_tracking(uuid) from public, anon, authenticated;

-- The day-10 silence sweep (dispute-sla.ts) asks this: a seller who added
-- valid tracking to a not-received case has answered it.
create or replace function public.order_has_valid_tracking(p_order uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$ select private.order_has_valid_tracking(p_order); $$;
revoke all on function public.order_has_valid_tracking(uuid) from public, anon, authenticated;
grant execute on function public.order_has_valid_tracking(uuid) to service_role;

-- True when an escalated not-received case is past the seller's 3 business
-- days with no valid tracking: no delivery proof in 'verified' or 'review'
-- on a live outbound shipment, or, for collection, the item never made
-- available. Never while a bank chargeback is unresolved (Stripe refuses
-- refunds on a disputed charge) or while a return is the live path.
create or replace function private.not_received_refund_due(p_order uuid)
returns boolean
language sql
stable
set search_path = public, pg_temp
as $$
  select exists (
    select 1
      from public.orders o
     where o.id = p_order
       and o.status = 'disputed'
       and o.dispute_category = 'item_not_received'
       and o.dispute_escalated_at is not null
       and now() >= coalesce(o.dispute_respond_by, private.add_business_days(o.disputed_at, 3))
       and o.refunded_cents < o.total_cents
       and not private.order_has_unresolved_chargeback(o.id)
       and not exists (
         select 1 from public.returns r
          where r.order_id = o.id
            and r.status in ('requested', 'approved', 'awaiting_shipment', 'in_transit', 'delivered', 'received', 'escalated')
       )
       and not private.order_has_valid_tracking(o.id)
  );
$$;
revoke all on function private.not_received_refund_due(uuid) from public, anon, authenticated;

create or replace function public.not_received_refund_due(p_order uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$ select private.not_received_refund_due(p_order); $$;

revoke all on function public.not_received_refund_due(uuid) from public, anon, authenticated;
grant execute on function public.not_received_refund_due(uuid) to service_role;

-- The worker's queue: due cases, oldest first.
create or replace function public.not_received_refunds_due(p_limit integer default 10)
returns table (order_id uuid, disputed_at timestamptz)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select o.id, o.disputed_at
    from public.orders o
   where o.status = 'disputed'
     and o.dispute_category = 'item_not_received'
     and o.dispute_escalated_at is not null
     and coalesce(o.dispute_respond_by, o.disputed_at) <= now()
     and private.not_received_refund_due(o.id)
   order by o.dispute_respond_by nulls first, o.id
   limit least(greatest(coalesce(p_limit, 10), 1), 50);
$$;

revoke all on function public.not_received_refunds_due(integer) from public, anon, authenticated;
grant execute on function public.not_received_refunds_due(integer) to service_role;

-- The not-received refund's reservation (Codex review of #108): the case's
-- identity and its eligibility are checked under the order lock, in the same
-- transaction that reserves the refund, so support resolving the case (or
-- anything else that changes it) between the worker's read and the refund
-- can never be overtaken by it. A retry adopts the case's own operation.
create or replace function public.begin_not_received_refund(
  p_order uuid,
  p_disputed_at timestamptz,
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
  v_key text;
begin
  if p_order is null or p_disputed_at is null then raise exception 'Order and case are required' using errcode = '22023'; end if;
  select * into o from public.orders where id = p_order for update;
  if not found then return jsonb_build_object('ok', false, 'ineligible', true, 'error', 'Order not found.'); end if;
  v_key := 'not_received:' || o.id || ':' || extract(epoch from p_disputed_at)::text;
  if exists (select 1 from public.refund_operations where request_key = v_key and status <> 'failed') then
    return public.begin_request_refund_operation(v_key, o.id, null, p_reason, p_requested_by, p_actor_role,
      true, p_dispute_outcome, p_payment_reference);
  end if;
  if o.disputed_at is distinct from p_disputed_at or not private.not_received_refund_due(o.id) then
    return jsonb_build_object('ok', false, 'ineligible', true,
      'error', 'This case is no longer due a not-received refund.');
  end if;
  return public.begin_request_refund_operation(v_key, o.id, null, p_reason, p_requested_by, p_actor_role,
    true, p_dispute_outcome, p_payment_reference);
end $$;

revoke all on function public.begin_not_received_refund(uuid, timestamptz, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.begin_not_received_refund(uuid, timestamptz, text, text, text, text, text) to service_role;

-- ============================================================
-- 7. Escalation (N6, N92)
-- ============================================================

create or replace function public.escalate_order_dispute(p_order uuid, p_actor uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  o public.orders;
  v_opens timestamptz;
  v_until timestamptz;
begin
  if p_order is null or p_actor is null then raise exception 'Order and actor are required'; end if;
  select * into o from public.orders where id = p_order for update;
  if not found or (p_actor is distinct from o.buyer_id and p_actor is distinct from o.seller_id) then
    return jsonb_build_object('ok', false, 'reason', 'not_party');
  end if;
  if o.status <> 'disputed' then return jsonb_build_object('ok', false, 'reason', 'not_disputed'); end if;
  if o.dispute_escalated_at is not null then
    return jsonb_build_object('ok', false, 'reason', 'already_escalated',
      'refund_due', private.not_received_refund_due(o.id));
  end if;

  v_opens := coalesce(o.dispute_respond_by, private.add_business_days(o.disputed_at, 3));
  v_until := coalesce(o.dispute_escalate_until, private.add_business_days(o.disputed_at, 21));
  if v_opens is null or now() < v_opens then
    return jsonb_build_object('ok', false, 'reason', 'too_early', 'opens_at', v_opens);
  end if;
  if now() > v_until then
    return jsonb_build_object('ok', false, 'reason', 'window_closed', 'closed_at', v_until);
  end if;
  -- A live offer is the seller's answer: the buyer accepts it or waits for
  -- its 48 hours to run out. An expired one never blocks, cleaned up or not.
  if p_actor = o.buyer_id and o.refund_offer_cents is not null
     and (o.refund_offered_at is null or o.refund_offer_expires_at > now()) then
    return jsonb_build_object('ok', false, 'reason', 'offer_pending', 'offer_expires_at', o.refund_offer_expires_at);
  end if;

  update public.orders
     set dispute_escalated_at = now(), dispute_escalated_by = p_actor
   where id = o.id;

  return jsonb_build_object('ok', true, 'refund_due', private.not_received_refund_due(o.id));
end $$;

revoke all on function public.escalate_order_dispute(uuid, uuid) from public, anon, authenticated;
grant execute on function public.escalate_order_dispute(uuid, uuid) to service_role;

-- Latest: 0021. Changed: waits for the frozen seller-response deadline plus
-- a day (legacy rows without one: disputed_at + 3 days, i.e. day 4 as before).
create or replace function public.escalate_stale_disputes()
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count int := 0;
  r record;
begin
  for r in
    select id, buyer_id, seller_id
    from public.orders
    where status = 'disputed'
      and dispute_escalated_at is null
      and now() > coalesce(dispute_respond_by, disputed_at + interval '3 days') + interval '1 day'
  loop
    update public.orders set dispute_escalated_at = now() where id = r.id;

    if r.seller_id is not null then
      perform public.notify(
        r.seller_id, 'dispute_escalated', 'marketplace',
        'A dispute needs your reply',
        'This case is past the response window and is now flagged for DRVN support. '
          || 'Unanswered disputes are refunded to the buyer automatically.',
        '/orders/' || r.id, null
      );
    end if;
    if r.buyer_id is not null then
      perform public.notify(
        r.buyer_id, 'dispute_escalated', 'marketplace',
        'Your dispute was escalated',
        'The seller has not responded in time — DRVN support is now watching this case.',
        '/orders/' || r.id, null
      );
    end if;

    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

revoke all on function public.escalate_stale_disputes() from public, anon, authenticated;
grant execute on function public.escalate_stale_disputes() to service_role;

-- ============================================================
-- 8. Offer expiry cleanup (N92)
-- ============================================================

-- Clears expired, unclaimed offers and tells both sides. Nothing else on the
-- case changes. An offer mid-acceptance (refund_offered_at null) is never
-- touched.
create or replace function public.expire_refund_offers(p_limit integer default 50)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r record;
  n integer := 0;
begin
  for r in
    select id, buyer_id, seller_id
      from public.orders
     where status = 'disputed'
       and refund_offered_at is not null
       and refund_offer_expires_at <= now()
     order by refund_offer_expires_at, id
     limit least(greatest(coalesce(p_limit, 50), 1), 200)
     for update skip locked
  loop
    update public.orders set refund_offer_cents = null, refund_offered_at = null
     where id = r.id and status = 'disputed' and refund_offered_at is not null
       and refund_offer_expires_at <= now();
    if found then
      n := n + 1;
      if r.buyer_id is not null then
        perform public.notify(r.buyer_id, 'refund_offer_expired', 'marketplace',
          'A refund offer expired', 'The seller''s offer ran out after 48 hours. The case stays open.',
          '/orders/' || r.id, null);
      end if;
      if r.seller_id is not null then
        perform public.notify(r.seller_id, 'refund_offer_expired', 'marketplace',
          'Your refund offer expired', 'The buyer didn''t accept within 48 hours. The case stays open.',
          '/orders/' || r.id, null);
      end if;
    end if;
  end loop;
  return n;
end $$;

revoke all on function public.expire_refund_offers(integer) from public, anon, authenticated;
grant execute on function public.expire_refund_offers(integer) to service_role;

-- ============================================================
-- 9. mark_order_dispatched — dispatch stays possible during a case (N6)
-- ============================================================
-- Latest: 20261107200100. Changed: a disputed order is judged by its
-- pre-dispute status. One that was 'paid' (a not-received case on an
-- undispatched order) can be dispatched unless a bank chargeback is
-- unresolved; the order stays 'disputed', its pre_dispute_status moves to
-- 'shipped' and the buyer is notified. One that was already shipped replays
-- exactly as a shipped order does. Everything else is unchanged.
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

-- ============================================================
-- 9b. Collection handoff stays possible during a case (Codex review of #108)
-- ============================================================
-- A not-received case on a collection order never handed over (pre-dispute
-- status 'paid'): making it available stops the automatic refund, so the
-- handoff itself must also work. Both functions now accept such an order
-- (never while a bank chargeback is unresolved); a redemption keeps the case
-- open and moves its pre_dispute_status to 'delivered', with the same
-- delivered/completed stamps and payout clock a handoff always sets.

-- Latest: 20261107200100. Changed: the readiness check accepts a disputed
-- order whose pre-dispute status is 'paid'. Lock order unchanged.
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

-- Latest: 20261006100000. Changed: a disputed order whose pre-dispute status
-- is 'paid' is redeemable (not during an unresolved chargeback); its case
-- stays open and pre_dispute_status becomes 'delivered'. The search_path now
-- includes pg_temp. Everything else is verbatim.
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
-- 10. execute_admin_command — the audited reopen (N91)
-- ============================================================
-- Latest: 20261007100100. Changed: one new branch, 'dispute.reopen'.
-- Everything else is verbatim; grants restated unchanged.
create or replace function public.execute_admin_command(p_action text,p_subject uuid,p_reason text,p_data jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare actor uuid:=auth.uid(); subject_type text; result jsonb:='{}'; l public.listings; ord public.orders; c public.ops_cases; ids uuid[]; n int; prior public.order_dispute_history;
begin
 if not public.is_admin() or public.admin_role()<>'admin' or not exists(
 select 1 from jsonb_array_elements(coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb->'amr','[]'::jsonb)) m
 where m->>'method' in ('totp','mfa/totp') and (m->>'timestamp')::numeric between extract(epoch from now())-900 and extract(epoch from now())+60
 ) then raise exception 'Admin step-up required' using errcode='42501'; end if;
 if length(trim(p_reason))<1 or length(p_reason)>4000 then raise exception 'A reason of 1–4000 characters is required'; end if;
 case p_action
 when 'listing.remove' then
  subject_type:='listing'; select * into strict l from public.listings where id=p_subject for update;
  if l.status in ('reserved','sold','removed') then raise exception 'Listing is not available for removal'; end if;
  update public.listings set status='removed',removed_at=now(),removed_reason=p_reason where id=p_subject;
  insert into public.notifications(user_id,kind,section,title,body,href) values(l.seller_id,'listing_removed','marketplace','A listing was removed',l.title||' — '||p_reason,'/selling');
  result:=jsonb_build_object('previousStatus',l.status);
 when 'listing.restore' then
  subject_type:='listing'; update public.listings set status='paused',removed_at=null,removed_reason=null where id=p_subject and status='removed';
  if not found then raise exception 'Listing is not removed'; end if;
 when 'user.suspend' then
  subject_type:='user';
  if actor=p_subject or exists(select 1 from public.admin_users where user_id=p_subject) then raise exception 'Admin membership is managed separately'; end if;
  update public.profiles set suspended_at=now(),suspended_reason=p_reason where id=p_subject and suspended_at is null;
  if not found then raise exception 'User is already suspended or missing'; end if;
  with paused as(update public.listings set status='paused' where seller_id=p_subject and status='active' returning id) select array_agg(id) into ids from paused;
  result:=jsonb_build_object('pausedListingIds',coalesce(ids,'{}'::uuid[]));
 when 'user.unsuspend' then
  subject_type:='user';
  perform 1 from public.profiles where id=p_subject for update;
  if exists(select 1 from public.remediation_jobs where dedup_key='delete:'||p_subject::text and status in ('pending','processing','failed')) then raise exception 'Account deletion is in progress; this account cannot be reactivated'; end if;
  if exists(select 1 from public.account_deletion_requests where user_id=p_subject) then raise exception 'This member asked for their account to be deleted; it cannot be reactivated'; end if;
  update public.profiles set suspended_at=null,suspended_reason=null where id=p_subject and suspended_at is not null;
  if not found then raise exception 'User is not suspended'; end if;
  select array(select jsonb_array_elements_text(a.metadata->'result'->'pausedListingIds')::uuid) into ids from public.admin_audit_log a where action='user.suspend' and subject_id=p_subject and metadata->'result' is not null order by created_at desc limit 1;
  with restored as(update public.listings set status='active' where id=any(coalesce(ids,'{}'::uuid[])) and seller_id=p_subject and status='paused' returning id) select array_agg(id) into ids from restored;
  result:=jsonb_build_object('reactivatedListingIds',coalesce(ids,'{}'::uuid[]));
 when 'report.actioned','report.dismissed' then
  subject_type:='report'; update public.reports set status=split_part(p_action,'.',2),resolved_by=actor,resolved_at=now(),resolution_note=p_reason where id=p_subject and status='open';
  if not found then raise exception 'Report is already resolved or missing'; end if;
 when 'recovery.recovered','recovery.written_off' then
  subject_type:='payment'; update public.payment_recoveries set status=split_part(p_action,'.',2),resolved_by=actor,resolved_at=now(),resolution_note=p_reason where id=p_subject and status='open';
  if not found then raise exception 'Recovery is already closed or missing'; end if;
 when 'note.internal' then
  subject_type:=p_data->>'subjectType';
  if subject_type not in ('user','listing','order','report','payment','dispute') then raise exception 'Invalid note subject'; end if;
 when 'dispute.resolve_for_seller' then
  subject_type:='dispute'; select * into strict ord from public.orders where id=p_subject for update;
  if ord.status<>'disputed' then raise exception 'Order is not disputed'; end if;
  update public.orders set status=coalesce(pre_dispute_status,'delivered'),dispute_resolved_at=now(),dispute_outcome='admin_resolved',refund_offer_cents=null,refund_offered_at=null where id=p_subject;
  insert into public.notifications(user_id,kind,section,title,body,href)
  select uid,'admin_action','marketplace','DRVN support resolved this dispute','The dispute was closed in the seller''s favour after review.','/orders/'||p_subject from unnest(array[ord.buyer_id,ord.seller_id]) uid where uid is not null;
  result:=jsonb_build_object('restored',ord.pre_dispute_status);
 when 'dispute.reopen' then
  -- 20261107210300 (N91): a resolved in-app case is final for the members;
  -- support may open a follow-up case. The previous case and its resolution
  -- stay in order_dispute_history; the follow-up starts with support, on a
  -- fresh clock, with the previous category and reason.
  subject_type:='dispute'; select * into strict ord from public.orders where id=p_subject for update;
  if ord.status='disputed' then raise exception 'The dispute is already open'; end if;
  if ord.status not in ('paid','shipped','delivered','completed') then raise exception 'Only a paid, unrefunded order can have a dispute reopened'; end if;
  if private.order_has_unresolved_chargeback(p_subject) then raise exception 'A bank chargeback is open on this order'; end if;
  select * into prior from public.order_dispute_history h
   where h.order_id=p_subject and h.event='resolved' and h.kind='in_app'
   order by h.created_at desc, h.id desc limit 1;
  if not found then raise exception 'This order has no resolved dispute to reopen'; end if;
  perform set_config('drvn.dispute_reopen','admin',true);
  update public.orders set status='disputed',pre_dispute_status=ord.status,
   dispute_category=prior.category,dispute_reason=prior.reason,disputed_at=now(),disputed_by=(select p.id from public.profiles p where p.id=prior.opened_by),
   dispute_respond_by=private.add_business_days(now(),3),dispute_escalate_until=private.add_business_days(now(),21),
   dispute_escalated_at=now(),dispute_escalated_by=(select p.id from public.profiles p where p.id=actor),dispute_sla_alerted_at=null,
   dispute_resolved_at=null,dispute_outcome=null,refund_offer_cents=null,refund_offered_at=null
  where id=p_subject;
  perform set_config('drvn.dispute_reopen','',true);
  insert into public.order_dispute_history(order_id,event,kind,category,reason,opened_at,opened_by,pre_dispute_status,actor_id,note,reopened_from)
  values(p_subject,'reopened','in_app',prior.category,prior.reason,now(),prior.opened_by,ord.status,actor,p_reason,prior.id);
  insert into public.notifications(user_id,kind,section,title,body,href)
  select uid,'admin_action','marketplace','DRVN support reopened this dispute','Support reopened the case to review it again. The earlier decision stays on record.','/orders/'||p_subject from unnest(array[ord.buyer_id,ord.seller_id]) uid where uid is not null;
  result:=jsonb_build_object('reopenedFrom',prior.id,'previousOutcome',prior.outcome,'restoredFrom',ord.status);
 when 'order.message_parties' then
  subject_type:='order'; select * into strict ord from public.orders where id=p_subject for update;
  insert into public.notifications(user_id,kind,section,title,body,href)
  select uid,'admin_action','marketplace','A message from DRVN support',p_reason,'/orders/'||p_subject from unnest(array[ord.buyer_id,ord.seller_id]) uid where uid is not null;
  get diagnostics n=row_count; result:=jsonb_build_object('recipients',n);
 when 'case.claim','case.release','case.update' then
  select * into strict c from public.ops_cases where order_id=p_subject or report_id=p_subject for update;
  subject_type:=case when c.kind='dispute' then 'order' else 'report' end;
  if c.status='resolved' then raise exception 'Case is closed'; end if;
  if p_action='case.claim' then
   if c.assigned_to is not null and c.assigned_to<>actor then raise exception 'Case is already assigned'; end if;
   update public.ops_cases set assigned_to=actor,status='claimed',updated_at=now() where id=c.id;
   result:=jsonb_build_object('released',false);
  elsif p_action='case.release' then
   if c.assigned_to is distinct from actor then raise exception 'Only the assignee may release a case'; end if;
   update public.ops_cases set assigned_to=null,status='open',updated_at=now() where id=c.id;
   result:=jsonb_build_object('released',true);
  else
   if p_data->>'priority' not in ('normal','high') or jsonb_typeof(p_data->'labels')<>'array' or jsonb_array_length(p_data->'labels')>6 then raise exception 'Invalid case update'; end if;
   if exists(select 1 from jsonb_array_elements_text(p_data->'labels') label where length(label)>30) then raise exception 'Case label too long'; end if;
   update public.ops_cases set priority=p_data->>'priority',labels=array(select jsonb_array_elements_text(p_data->'labels')),updated_at=now() where id=c.id;
   result:=jsonb_build_object('priority',p_data->>'priority','labels',p_data->'labels');
  end if;

 else raise exception 'Unsupported admin command';
 end case;
 insert into public.admin_audit_log(actor_id,action,subject_type,subject_id,order_id,reason,metadata)
 values(actor,p_action,subject_type,p_subject,(p_data->>'orderId')::uuid,p_reason,jsonb_build_object('phase','completed','result',result));
 return result;
end $$;
revoke all on function public.execute_admin_command(text,uuid,text,jsonb) from public,anon;
grant execute on function public.execute_admin_command(text,uuid,text,jsonb) to authenticated;

-- ============================================================
-- 11. Self-checks
-- ============================================================
do $$
declare
  fn text;
begin
  -- Thu 2026-11-05 10:00 UTC + 3 business days = Tue 2026-11-10 10:00 UTC.
  if private.add_business_days('2026-11-05 10:00+00', 3) <> '2026-11-10 10:00+00'::timestamptz
     or private.add_business_days('2026-11-07 10:00+00', 1) <> '2026-11-09 10:00+00'::timestamptz then
    raise exception 'SELF-CHECK FAILED: business days';
  end if;
  foreach fn in array array[
    'public.open_order_dispute(uuid,uuid,text,text)',
    'public.escalate_order_dispute(uuid,uuid)',
    'public.not_received_refund_due(uuid)',
    'public.not_received_refunds_due(integer)',
    'public.order_has_valid_tracking(uuid)',
    'public.begin_not_received_refund(uuid,timestamp with time zone,text,text,text,text,text)',
    'public.pickup_mint_pass(uuid,uuid,text,text,timestamp with time zone)',
    'public.pickup_redeem(uuid,uuid,text)',
    'public.expire_refund_offers(integer)',
    'public.record_delivery_proof(uuid,text,text,text[],timestamp with time zone,text,text,timestamp with time zone,text,timestamp with time zone)',
    'public.mark_order_dispatched(uuid,uuid,text,text,text,text)',
    'public.escalate_stale_disputes()'
  ] loop
    if has_function_privilege('anon', fn, 'execute') or has_function_privilege('authenticated', fn, 'execute') then
      raise exception 'SELF-CHECK FAILED: % is client-callable', fn;
    end if;
  end loop;
  if position('dispute.reopen' in pg_get_functiondef('public.execute_admin_command(text,uuid,text,jsonb)'::regprocedure)) = 0 then
    raise exception 'SELF-CHECK FAILED: the audited reopen is missing';
  end if;
end $$;

notify pgrst, 'reload schema';

commit;
