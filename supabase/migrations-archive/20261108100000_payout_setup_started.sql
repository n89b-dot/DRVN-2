-- ============================================================================
-- 20261108100000 — Payout setup: started to sell, enabled to be paid, 14 days
-- to finish (N244, Neil's ruling 8 Nov 2026: "go with the eBay approach,
-- 14 days"; docs/decisions/seller-payout-setup.md)
--
-- Replaces the readiness rule of 20261107210000 / 20261107210050, where with
-- real payments a seller could neither publish nor be bought from until
-- Stripe reported payouts enabled.
--
-- 1. Setup started. profiles.payout_details_submitted mirrors Stripe's
--    account.details_submitted, written only by the Connect sync (as
--    payouts_enabled is, 0017): not granted to clients, and the column guard
--    refuses it. Backfilled true where Stripe already enables payouts
--    (Stripe enables payouts only on a submitted account); every other
--    account is set by its next sync or account.updated.
--
-- 2. private.seller_can_take_payment is the one answer every gate asks
--    (publishing, reserving, purchase_begin's skip, prepare_payment_request).
--    It now says yes when payouts are enabled, or when the seller has a
--    connected account with details submitted and isn't restricted. Stub
--    payments: no gate, as before. Restated from 20261107210000.
--
-- 3. Payout waits for payouts enabled. Unchanged: the transfer worker parks
--    the intent as blocked_unpayable and account.updated releases it.
--
-- 4. Fourteen days after a sale, payouts still not enabled (the sale is the
--    capture, which writes its transfer_intents row; the intent hasn't been
--    paid out or cancelled):
--      * the seller is restricted (profiles.payout_restricted_at): their
--        live listings are paused and recorded, and no publish or new sale is
--        allowed until payouts are enabled;
--      * an order not yet dispatched (status 'paid', no shipped_at) is
--        claimed for cancellation (private.payout_deadline_cancellations):
--        from then on it can't be dispatched, and the money worker refunds it
--        in full through the one refund path, with the request key
--        payout_deadline:<order>, so a retry adopts the same refund and never
--        starts a second one (src/lib/payments/payout-deadline.ts). Settling
--        puts the part back as the seller's paused listing.
--    When Stripe enables payouts, the restriction clears and the listings
--    paused by it go back on sale.
--    An order already dispatched or delivered by day 14 is NOT refunded: its
--    payout keeps waiting. That case hasn't been ruled (see the decision doc).
--
-- 5. The money worker gains a family, payoutDeadlines, on the existing
--    drvn-transfer-worker job (no new cron job). scheduled_job_inventory is
--    restated from 20261107210100 with only that family added.
--
-- Idempotent.
-- ============================================================================

begin;

create schema if not exists private;

-- ============================================================
-- 1. Setup started, and the day-14 restriction
-- ============================================================

alter table public.profiles
  add column if not exists payout_details_submitted boolean not null default false,
  add column if not exists payout_restricted_at timestamptz;

comment on column public.profiles.payout_details_submitted is
  'Stripe account.details_submitted for the seller''s connected account, written only by the Connect sync (20261108100000).';
comment on column public.profiles.payout_restricted_at is
  'Set when a sale is 14 days old and the seller''s payouts still aren''t enabled; cleared when they are (20261108100000).';

-- Stripe only enables payouts on an account whose details are submitted.
update public.profiles
set payout_details_submitted = true
where payouts_enabled and stripe_account_id is not null and not payout_details_submitted;

-- Server-side only, as payouts_enabled's write is: no client grant (0017
-- replaced the table grants with column lists, so a new column has none)
-- and the guard below.
revoke update (payout_details_submitted, payout_restricted_at) on public.profiles from anon, authenticated;

-- Latest: 0018_admin.sql (search_path pinned by 20260905143949, kept here).
-- Added: the two payout setup columns.
create or replace function public.guard_profile_columns()
returns trigger
language plpgsql
set search_path = public, extensions, pg_temp
as $$
begin
  if public.is_trusted_writer() then
    return new;
  end if;

  if new.profile_type is distinct from old.profile_type then
    raise exception 'profile_type cannot be changed by the account holder'
      using errcode = '42501';
  end if;

  if old.username is not null and new.username is distinct from old.username then
    raise exception 'username cannot be changed once set'
      using errcode = '42501';
  end if;

  if new.payouts_enabled is distinct from old.payouts_enabled then
    raise exception 'payouts_enabled is set by Stripe onboarding, not by the account holder'
      using errcode = '42501';
  end if;

  -- 20261108100000: whether setup has started, and the day-14 restriction,
  -- come from Stripe and the money worker, never the account holder.
  if new.payout_details_submitted is distinct from old.payout_details_submitted
     or new.payout_restricted_at is distinct from old.payout_restricted_at then
    raise exception 'payout setup state is set by Stripe onboarding, not by the account holder'
      using errcode = '42501';
  end if;

  if new.stripe_account_id is distinct from old.stripe_account_id
     or new.stripe_customer_id is distinct from old.stripe_customer_id then
    raise exception 'Stripe account references are managed server-side'
      using errcode = '42501';
  end if;

  if new.suspended_at is distinct from old.suspended_at
     or new.suspended_reason is distinct from old.suspended_reason then
    raise exception 'suspension is managed by moderation'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

-- ============================================================
-- 2. The one answer: can this seller take a sale?
-- ============================================================

-- Latest: 20261107210000_listing_write_boundary.sql. Changed: setup started
-- (details submitted, not restricted) is enough; payouts enabled still is.
create or replace function private.seller_can_take_payment(p_seller uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select not private.payout_readiness_required()
      or coalesce((
        select p.payouts_enabled
            or (p.stripe_account_id is not null
                and p.payout_details_submitted
                and p.payout_restricted_at is null)
        from public.profiles p where p.id = p_seller
      ), false);
$$;
revoke all on function private.seller_can_take_payment(uuid) from public, anon, authenticated;

comment on function private.seller_can_take_payment(uuid) is
  'Whether this seller can publish and be bought from: payouts enabled, or Stripe setup started (details submitted) and not restricted at day 14, or job_config.payments_mode is ''stub'' (20261108100000).';

-- ============================================================
-- 3. Day 14: what the sweep records
-- ============================================================

-- An order the day-14 rule cancels. Inserted under the order's lock while it
-- is still undispatched; from then on it can't be dispatched, and settled_at
-- is stamped once the refund is complete and the part is back.
create table if not exists private.payout_deadline_cancellations (
  order_id uuid primary key references public.orders(id) on delete cascade,
  seller_id uuid not null references public.profiles(id) on delete cascade,
  claimed_at timestamptz not null default now(),
  settled_at timestamptz
);
create index if not exists payout_deadline_cancellations_seller_idx
  on private.payout_deadline_cancellations (seller_id);
create index if not exists payout_deadline_cancellations_open_idx
  on private.payout_deadline_cancellations (claimed_at) where settled_at is null;
revoke all on private.payout_deadline_cancellations from public, anon, authenticated;

-- A listing the restriction took off sale, so it goes back when payouts are
-- enabled. A listing the seller paused themselves is never in here.
create table if not exists private.payout_deadline_paused_listings (
  listing_id uuid primary key references public.listings(id) on delete cascade,
  seller_id uuid not null references public.profiles(id) on delete cascade,
  paused_at timestamptz not null default now()
);
create index if not exists payout_deadline_paused_listings_seller_idx
  on private.payout_deadline_paused_listings (seller_id);
revoke all on private.payout_deadline_paused_listings from public, anon, authenticated;

-- ============================================================
-- 4. Day 14: restrict, pause, claim
-- ============================================================

-- One pass of the rule. Restricts every seller with a sale 14 days old whose
-- payouts aren't enabled, pauses (and records) their live listings, claims
-- each such order not yet dispatched, and returns the open claims whose
-- orders the worker can act on ('paid' to refund, 'refunded' to settle).
-- Safe to run any number of times: each step is guarded by the state it
-- leaves. Stub payments: nothing to do.
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
  v_order record;
  v_listing_ids uuid[];
  v_status text;
  v_shipped timestamptz;
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

  -- Claim each overdue order that hasn't been dispatched. Listing first,
  -- then order (docs/decisions/agent-foundations.md §4), and re-read under
  -- the lock so a dispatch that won the race keeps its order.
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
    limit greatest(coalesce(p_limit, 5), 1)
  loop
    select coalesce(array_agg(oi.listing_id order by oi.listing_id), array[]::uuid[])
      into v_listing_ids
    from public.order_items oi where oi.order_id = v_order.id and oi.listing_id is not null;
    perform 1 from public.listings where id = any(v_listing_ids) order by id for update;
    select o.status, o.shipped_at into v_status, v_shipped
    from public.orders o where o.id = v_order.id for update;
    if v_status = 'paid' and v_shipped is null
       and not coalesce((select payouts_enabled from public.profiles where id = v_order.seller_id), false) then
      insert into private.payout_deadline_cancellations (order_id, seller_id)
      values (v_order.id, v_order.seller_id)
      on conflict (order_id) do nothing;
      if found then v_claimed := v_claimed + 1; end if;
    end if;
  end loop;

  -- The open claims the worker can act on now. A claim on an order that
  -- moved elsewhere (a buyer's dispute) waits until it is back.
  select coalesce(jsonb_agg(jsonb_build_object('order_id', c.order_id, 'status', o.status) order by c.claimed_at), '[]'::jsonb)
    into v_open
  from (
    select c.order_id, c.claimed_at
    from private.payout_deadline_cancellations c
    join public.orders o on o.id = c.order_id
    where c.settled_at is null and o.status in ('paid', 'refunded')
    order by c.claimed_at
    limit greatest(coalesce(p_limit, 5), 1)
  ) c
  join public.orders o on o.id = c.order_id;

  return jsonb_build_object('restricted', v_restricted, 'paused', v_paused, 'claimed', v_claimed, 'orders', v_open);
end;
$$;
revoke all on function public.claim_payout_deadline_cancellations(integer) from public, anon, authenticated;
grant execute on function public.claim_payout_deadline_cancellations(integer) to service_role;

-- After the refund: the part is the seller's again, paused while they are
-- restricted (and back on sale with the rest when payouts are enabled), or
-- live if payouts were enabled meanwhile. Idempotent; a claim whose order
-- isn't refunded yet is reported, not settled.
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
  v_payable boolean;
begin
  if p_order is null then raise exception 'Order is required'; end if;
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

  select coalesce(p.payouts_enabled, false) into v_payable from public.profiles p where p.id = v_claim.seller_id;
  if coalesce(v_payable, false) and not public.is_suspended(v_claim.seller_id) then
    update public.listings set status = 'active', sold_at = null, reserved_until = null
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
-- 5. A claimed order can't be dispatched
-- ============================================================

-- Without this, a seller could mark the order dispatched between the claim
-- and the refund, and the buyer would be refunded for a part on its way. No
-- exemption: dispatch runs as a definer function (mark_order_dispatched).
create or replace function private.guard_payout_deadline_dispatch()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if old.status = 'paid'
     and new.status in ('shipped', 'delivered', 'completed')
     and exists (select 1 from private.payout_deadline_cancellations c
                 where c.order_id = new.id and c.settled_at is null) then
    raise exception 'This order is being cancelled and refunded: payouts weren''t set up within 14 days of the sale'
      using errcode = 'LS002';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_payout_deadline_dispatch() from public, anon, authenticated;

drop trigger if exists orders_payout_deadline_dispatch_guard on public.orders;
create trigger orders_payout_deadline_dispatch_guard
  before update of status on public.orders
  for each row execute function private.guard_payout_deadline_dispatch();

-- ============================================================
-- 6. Payouts enabled: the restriction ends, the listings come back
-- ============================================================

create or replace function private.clear_payout_restriction()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.payouts_enabled and not coalesce(old.payouts_enabled, false) then
    new.payout_restricted_at := null;
  end if;
  return new;
end;
$$;
revoke all on function private.clear_payout_restriction() from public, anon, authenticated;

drop trigger if exists profiles_payout_restriction_clear on public.profiles;
create trigger profiles_payout_restriction_clear
  before update of payouts_enabled on public.profiles
  for each row execute function private.clear_payout_restriction();

create or replace function private.restore_payout_paused_listings()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.payouts_enabled and not coalesce(old.payouts_enabled, false)
     and not public.is_suspended(new.id) then
    perform 1 from public.listings l
    where l.id in (select pl.listing_id from private.payout_deadline_paused_listings pl where pl.seller_id = new.id)
    order by l.id for update;
    update public.listings l set status = 'active'
    where l.status = 'paused'
      and l.id in (select pl.listing_id from private.payout_deadline_paused_listings pl where pl.seller_id = new.id);
    delete from private.payout_deadline_paused_listings where seller_id = new.id;
  end if;
  return new;
end;
$$;
revoke all on function private.restore_payout_paused_listings() from public, anon, authenticated;

drop trigger if exists profiles_payout_paused_listings_restore on public.profiles;
create trigger profiles_payout_paused_listings_restore
  after update of payouts_enabled on public.profiles
  for each row execute function private.restore_payout_paused_listings();

-- ============================================================
-- 7. The worker family
-- ============================================================

-- Latest: 20261107210100_settlement_reconciliation.sql. Added: the
-- payoutDeadlines family on drvn-transfer-worker.
create or replace function private.scheduled_job_inventory()
returns table(job text, schedule text, command text, families text[], budget interval)
language sql
immutable
set search_path = public, pg_temp
as $$
  values
    ('drvn-agent-worker', '*/5 * * * *', 'select public.invoke_remediation_worker(''agent'');', array['agent'], interval '30 minutes'),
    ('drvn-cron-history-prune', '27 4 * * *', 'select private.prune_cron_history();', array[]::text[], interval '26 hours'),
    ('drvn-deletion-worker', '*/5 * * * *', 'select public.invoke_remediation_worker(''account-deletions'');', array['deletions'], interval '30 minutes'),
    ('drvn-delivery-auto-confirm', '23 * * * *', 'select public.auto_confirm_untracked_deliveries();', array['deliveryAutoConfirm'], interval '3 hours'),
    ('drvn-dispute-sla', '5 8 * * *', 'select public.escalate_stale_disputes();', array[]::text[], interval '26 hours'),
    ('drvn-explore-builders', '*/10 * * * *', 'select public.refresh_explore_builders();', array[]::text[], interval '30 minutes'),
    ('drvn-explore-trending', '*/2 * * * *', 'select public.refresh_explore_trending();', array[]::text[], interval '30 minutes'),
    ('drvn-grow-products', '17 * * * *', 'select public.grow_products()', array[]::text[], interval '3 hours'),
    ('drvn-grow-products-full', '47 4 * * *', 'select public.grow_products(true)', array[]::text[], interval '26 hours'),
    ('drvn-ledger-reconciliation', '50 5 * * *', 'select public.invoke_remediation_worker(''ledger-reconciliation'');', array['ledgerReconciliation'], interval '26 hours'),
    ('drvn-listing-edit-sweep', '45 3 * * *', 'select public.prune_listing_edit_requests();', array[]::text[], interval '26 hours'),
    ('drvn-listing-import-sweep', '37 3 * * *', 'select public.invoke_remediation_worker(''listing-imports'');', array['listingImports'], interval '26 hours'),
    ('drvn-marketplace-counts', '30 seconds', 'select public.refresh_marketplace_facet_counts();', array[]::text[], interval '10 minutes'),
    ('drvn-media-gc', '17 3 * * *', 'select public.invoke_remediation_worker(''media-gc'');', array['media'], interval '26 hours'),
    ('drvn-prune-rate-limits', '15 3 * * *', 'select public.prune_rate_limits();', array[]::text[], interval '26 hours'),
    ('drvn-release-reservations', '*/5 * * * *', 'select public.release_expired_reservations();', array[]::text[], interval '30 minutes'),
    ('drvn-saved-search-digests', '41 * * * *', 'select public.invoke_remediation_worker(''saved-search-digests'');', array['savedSearchDigests'], interval '3 hours'),
    ('drvn-saved-search-worker', '*/30 * * * *', 'select public.invoke_remediation_worker(''saved-searches'');', array['savedSearches'], interval '90 minutes'),
    ('drvn-search-words', '23 * * * *', 'select public.refresh_search_words();', array[]::text[], interval '3 hours'),
    ('drvn-search-worker', '*/2 * * * *', 'select public.invoke_remediation_worker(''search'');', array['search'], interval '30 minutes'),
    ('drvn-transfer-worker', '*/10 * * * *', 'select public.mark_due_transfer_intents(); select public.invoke_transfer_worker();',
      array['expiries','captures','transfers','transferReconciliation','refunds','labelVoids','returns','disputes','payoutDeadlines','alerts','receipts','analytics'],
      interval '30 minutes')
$$;
revoke all on function private.scheduled_job_inventory() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Self-check
-- ---------------------------------------------------------------------------
do $$
begin
  if has_column_privilege('authenticated', 'public.profiles', 'payout_details_submitted', 'update')
     or has_column_privilege('authenticated', 'public.profiles', 'payout_restricted_at', 'update') then
    raise exception 'SELF-CHECK FAILED: a client can write payout setup state';
  end if;
  if has_function_privilege('authenticated', 'public.claim_payout_deadline_cancellations(integer)', 'execute')
     or has_function_privilege('anon', 'public.claim_payout_deadline_cancellations(integer)', 'execute')
     or has_function_privilege('authenticated', 'public.settle_payout_deadline_cancellation(uuid)', 'execute')
     or has_function_privilege('anon', 'public.settle_payout_deadline_cancellation(uuid)', 'execute') then
    raise exception 'SELF-CHECK FAILED: the payout deadline sweep is client-callable';
  end if;
  if not exists (select 1 from jsonb_array_elements(public.worker_health_snapshot()->'families') f
                 where f->>'family' = 'payoutDeadlines') then
    raise exception 'SELF-CHECK FAILED: the payout deadline family is not in worker health';
  end if;
end $$;

notify pgrst, 'reload schema';
commit;
