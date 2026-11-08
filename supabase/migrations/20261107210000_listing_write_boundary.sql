-- ============================================================================
-- 20261107210000 — The listing write boundary (OS-W16: N5, N69, N244, N72,
-- N26; OS-R-audit-sell is app-only)
--
-- A member's sign-in key reaches the database directly (PostgREST), so every
-- listing rule the app checks must also hold for a write made with that key
-- and nothing else. This is the inventory of those direct-write surfaces for
-- listings, and where each invariant now lives (N5). Social quotas (listing
-- questions, saves) are W21's; photo URLs were made database-owned by
-- 20261107203000 (#73).
--
--   public.listings, INSERT / UPDATE / DELETE on the member's own rows (RLS)
--     * which columns a member may write          column grants (this, N69)
--     * server-owned fields (id, seller, created,
--       views, published, sold, reserved, removed,
--       currency, version)                        not granted + freeze trigger
--                                                 listings_aa_member_write_guard
--                                                 (this, N69)
--     * a new row is a draft or live, never sold,
--       reserved or removed                       listings_aa_member_write_guard
--     * status moves                              guard_listing_status (0012..)
--     * price bounds                              guard_listing_price_bounds
--     * published_at                              stamp_listing_published_at (#71)
--     * payouts set up before going live          listings_publish_payouts_guard
--                                                 (this, N244)
--     * a live listing has a photo                listings_live_needs_photo,
--                                                 checked at commit (this, N69)
--     * deleting a reserved/sold listing          guard_listing_delete (0012);
--                                                 withdrawal is W33's
--   public.listing_images, own listing's rows
--     * the URL is the seller's own upload        member_media_ref_guard (#73)
--     * at most 12, none on a reserved, sold or
--       removed listing                           listing_images_member_write_guard
--                                                 (this, N69)
--     * the last photo of a live listing stays    listing_images_live_keeps_photo,
--                                                 checked at commit (this, N69)
--     * which columns a member may write          column grants (this)
--   public.listing_fitments / listing_part_numbers, own listing's rows
--     * at most 10 / 5, none on a reserved, sold
--       or removed listing, never moved           *_member_write_guard (this)
--   public.listing_private_terms                  no client grant; only
--                                                 set_listing_offer_floor writes
--   RPCs a member calls
--     * save_listing_creation, update_listing_atomic, save_listing_edit run
--       with the caller's rights, so every grant and trigger above applies
--       to them unchanged.
--     * claim_listing_creation: a changed request may take over a claim that
--       never produced a listing; a listing that exists keeps its request
--       (this, N72).
--   Checkout (purchase_begin, offer_accept_begin, any later path)
--     * the seller can take payment               purchase_begin skips the part;
--                                                 any other reservation is
--                                                 refused by
--                                                 listings_reserve_payouts_guard
--                                                 (this, N244)
--   public.settlement_settings (N26)
--     * the hold policy is public, the fraud
--       threshold is not                        settlement_hold_policy();
--                                                 the table is service-role only
--
-- Payout readiness (N244). The rule is the app's (sellerCanPublish,
-- src/lib/payments/connect.ts): with real payments a seller can't go live,
-- or be bought from, until Stripe reports payouts enabled
-- (profiles.payouts_enabled, written only by the Connect sync, 0017). With the
-- stub provider there is no money to send, so there is no gate. The database
-- can't see the app's PAYMENTS_MODE, so the stub exemption is one row,
-- job_config.payments_mode = 'stub', and anything else (including no row)
-- enforces the rule: a production database needs nothing recorded. CI's
-- stub-mode jobs and the SQL guard runner record it (scripts/
-- prepare-ci-supabase.mjs, scripts/test-sql-guards.sh).
--
-- Who is a member here. Two senses, each where it fits:
--   * is_trusted_writer() (current_user): the freeze and child-row guards are
--     invoker triggers, so a write made with member rights (directly or
--     through an invoker RPC) is checked and the database's own definer
--     functions, the service role and migrations are not.
--   * auth.role() = 'authenticated' and the listing is the caller's own (as
--     #73's photo guard does): the payouts and photo rules on publishing. A
--     member publishing their own listing by any path is checked; an admin
--     restoring someone else's listing, a checkout releasing one, the
--     service role and fixtures are not.
-- The reservation check has no exemption: checkout runs as definer
-- functions, and taking a buyer's money for a seller who can't be paid is
-- wrong whoever asks.
--
-- Money rules don't change: the readiness rule is the documented one, now
-- held where a direct call can't skip it. The projection exposes the same
-- hold numbers the terms already quote.
--
-- Idempotent.
-- ============================================================================

begin;

create schema if not exists private;

-- ============================================================
-- 1. Payout readiness, one answer
-- ============================================================

create or replace function private.payout_readiness_required()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce((select c.value from public.job_config c where c.key = 'payments_mode'), 'stripe') <> 'stub';
$$;
revoke all on function private.payout_readiness_required() from public, anon, authenticated;

create or replace function private.seller_can_take_payment(p_seller uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select not private.payout_readiness_required()
      or coalesce((select p.payouts_enabled from public.profiles p where p.id = p_seller), false);
$$;
revoke all on function private.seller_can_take_payment(uuid) from public, anon, authenticated;

comment on function private.seller_can_take_payment(uuid) is
  'Whether a sale from this seller can be paid out: Stripe reports payouts enabled, or job_config.payments_mode is ''stub'' (20261107210000).';

-- ============================================================
-- 2. listings: what a member may write (N69)
-- ============================================================

-- Column grants, as profiles has had since 0017. A member writes the fields
-- the sell form and the editor send, and status (guarded by
-- guard_listing_status). Everything else is the database's: the id and
-- seller are fixed at insert, and created_at, view_count, published_at,
-- sold_at, reserved_until, removed_*, currency and updated_at are set by
-- defaults, triggers and definer functions. Revoking the table privilege
-- also drops any column privilege, so the grants below are the whole list.
revoke insert, update, truncate, references, trigger on public.listings from anon, authenticated;
revoke delete on public.listings from anon;

grant insert (
  id, seller_id, source_car_id, title, description, category, subcategory,
  condition, grade, condition_checklist, price_cents, shipping_cents,
  shipping_mode, weight_oz, length_in, width_in, height_in, show_offer_floor,
  allows_collection, location, compatibility_notes, part_number, status,
  brand, part_miles, part_miles_unit
) on public.listings to authenticated;

grant update (
  source_car_id, title, description, category, subcategory, condition, grade,
  condition_checklist, price_cents, shipping_cents, shipping_mode, weight_oz,
  length_in, width_in, height_in, show_offer_floor, allows_collection,
  location, compatibility_notes, part_number, status, brand, part_miles,
  part_miles_unit
) on public.listings to authenticated;

-- The same line held by a trigger, so a later grant can't quietly reopen it.
-- Named to run before every other BEFORE trigger on listings, so it sees the
-- writer's own values (published_at and updated_at are stamped after it).
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
  return new;
end;
$$;
revoke all on function public.guard_listing_member_write() from public, anon, authenticated;

drop trigger if exists listings_aa_member_write_guard on public.listings;
create trigger listings_aa_member_write_guard
  before insert or update on public.listings
  for each row execute function public.guard_listing_member_write();

-- ============================================================
-- 3. Going live needs payouts (N244)
-- ============================================================

-- Publishing is a move into active from a state that wasn't on sale: an
-- insert as active, or draft / paused / archived to active. A checkout
-- releasing a reservation (reserved to active) or a cancellation putting a
-- part back (sold to active) is not a publish.
create or replace function private.guard_member_listing_publish()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if coalesce(auth.role(), '') <> 'authenticated'
     or new.seller_id is distinct from auth.uid()
     or new.status is distinct from 'active'
     or (tg_op = 'UPDATE' and old.status not in ('draft', 'paused', 'archived')) then
    return new;
  end if;
  if not private.seller_can_take_payment(new.seller_id) then
    raise exception 'Publishing needs payouts set up first, so a sale has somewhere to send the money'
      using errcode = 'LS001';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_member_listing_publish() from public, anon, authenticated;

drop trigger if exists listings_publish_payouts_guard on public.listings;
create trigger listings_publish_payouts_guard
  before insert or update of status on public.listings
  for each row execute function private.guard_member_listing_publish();

-- ============================================================
-- 4. Checkout needs a seller who can be paid (N244)
-- ============================================================

-- Checked when a part is reserved, which is where every checkout path
-- (purchase_begin, offer_accept_begin and anything later) takes it off the
-- market, so readiness that lapsed after publishing still stops the sale
-- before a payment is requested. purchase_begin (below) skips such a part
-- rather than failing the whole basket; any other path is refused here.
create or replace function private.guard_listing_reservation_payable()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.status = 'reserved'
     and old.status is distinct from 'reserved'
     and not private.seller_can_take_payment(new.seller_id) then
    raise exception 'This seller can''t take payment yet: their payouts aren''t set up'
      using errcode = 'LS001';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_listing_reservation_payable() from public, anon, authenticated;

drop trigger if exists listings_reserve_payouts_guard on public.listings;
create trigger listings_reserve_payouts_guard
  before update of status on public.listings
  for each row execute function private.guard_listing_reservation_payable();

-- ============================================================
-- 5. A live listing has a photo, checked at commit (N69)
-- ============================================================

-- Deferred, because the sell form's one transaction inserts the listing
-- before its photos, and the editor replaces a gallery by deleting and
-- re-inserting it. What matters is the state the transaction leaves: a
-- member's own listing, live, with no photo, doesn't commit. Rows that were
-- live without one before this (legacy) are left alone until a member
-- publishes them again or removes a photo.
create or replace function private.check_member_live_listing_photo()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_listing uuid;
  v_seller uuid;
  v_status text;
begin
  if coalesce(auth.role(), '') <> 'authenticated' then
    return null;
  end if;
  if tg_table_name = 'listings' then
    if tg_op = 'UPDATE' and old.status not in ('draft', 'paused', 'archived') then
      return null;
    end if;
    v_listing := new.id;
  else
    v_listing := old.listing_id;
  end if;

  select l.seller_id, l.status into v_seller, v_status
  from public.listings l
  where l.id = v_listing;
  if not found or v_status is distinct from 'active' or v_seller is distinct from auth.uid() then
    return null;
  end if;
  if not exists (select 1 from public.listing_images i where i.listing_id = v_listing) then
    raise exception 'A live listing needs at least one photo' using errcode = '23514';
  end if;
  return null;
end;
$$;
revoke all on function private.check_member_live_listing_photo() from public, anon, authenticated;

drop trigger if exists listings_live_needs_photo on public.listings;
create constraint trigger listings_live_needs_photo
  after insert or update of status on public.listings
  deferrable initially deferred
  for each row when (new.status = 'active')
  execute function private.check_member_live_listing_photo();

drop trigger if exists listing_images_live_keeps_photo on public.listing_images;
create constraint trigger listing_images_live_keeps_photo
  after delete or update of listing_id on public.listing_images
  deferrable initially deferred
  for each row
  execute function private.check_member_live_listing_photo();

-- ============================================================
-- 6. Gallery, fitment and part numbers: bounded, frozen while sold (N69)
-- ============================================================

-- The editor's own rules (update_listing_atomic: 12 photos, 10 fitment rows,
-- 5 part numbers, nothing on a sold, reserved or removed listing) held for a
-- member writing the rows directly. The listing row is locked first (the
-- listing-first order every sale path uses, 20261018100200), so two writes
-- can't both slip under the cap. tg_argv[0] is the cap.
create or replace function public.guard_listing_child_member_write()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_listing uuid;
  v_status text;
  v_count integer;
  v_cap integer := tg_argv[0]::integer;
begin
  if public.is_trusted_writer() then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_op = 'UPDATE' and new.listing_id is distinct from old.listing_id then
    raise exception 'A listing''s % can''t be moved to another listing', tg_table_name
      using errcode = '42501';
  end if;
  v_listing := case when tg_op = 'DELETE' then old.listing_id else new.listing_id end;

  select l.status into v_status from public.listings l where l.id = v_listing for update;
  if not found then
    -- The listing is being deleted with its rows, or isn't the caller's
    -- (the table's own policy refuses that write).
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if v_status in ('reserved', 'sold', 'removed') then
    raise exception 'A sold, reserved or removed listing can''t be edited' using errcode = '55000';
  end if;
  if tg_op = 'INSERT' then
    execute format('select count(*) from public.%I where listing_id = $1', tg_table_name)
      into v_count using v_listing;
    if v_count >= v_cap then
      raise exception 'A listing holds at most % rows in %', v_cap, tg_table_name
        using errcode = '54000';
    end if;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
revoke all on function public.guard_listing_child_member_write() from public, anon, authenticated;

drop trigger if exists listing_images_member_write_guard on public.listing_images;
create trigger listing_images_member_write_guard
  before insert or update or delete on public.listing_images
  for each row execute function public.guard_listing_child_member_write('12');

drop trigger if exists listing_fitments_member_write_guard on public.listing_fitments;
create trigger listing_fitments_member_write_guard
  before insert or update or delete on public.listing_fitments
  for each row execute function public.guard_listing_child_member_write('10');

drop trigger if exists listing_part_numbers_member_write_guard on public.listing_part_numbers;
create trigger listing_part_numbers_member_write_guard
  before insert or update or delete on public.listing_part_numbers
  for each row execute function public.guard_listing_child_member_write('5');

-- The gallery's columns: a member writes the photo, its words and its place;
-- the row's id, listing and timestamp are the database's.
revoke insert, update, truncate, references, trigger on public.listing_images from anon, authenticated;
revoke delete on public.listing_images from anon;
grant insert (listing_id, url, alt, position) on public.listing_images to authenticated;
grant update (url, alt, position) on public.listing_images to authenticated;

-- ============================================================
-- 7. purchase_begin skips a part whose seller can't be paid (N244)
-- ============================================================

-- purchase_begin (20261004130000): unchanged except one line in the claim,
-- `and private.seller_can_take_payment(l.seller_id)`. Such a part is left on
-- the market and reported in `skipped` as unavailable, as a part that sold a
-- moment ago is, so the rest of the basket still checks out.

create or replace function public.purchase_begin(
  p_buyer_id uuid,
  p_listing_ids uuid[],
  p_idempotency_key text default null,
  p_reservation_window interval default interval '15 minutes',
  p_shipping_overrides jsonb default null,
  p_checkout_request_key text default null,
  p_checkout_context jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_previous jsonb;
  v_owner uuid;
  v_bound_owner uuid;
  v_bound_idempotency_key text;
  v_bound_context jsonb;
  v_fingerprint jsonb;
  v_orders jsonb := '[]'::jsonb;
  v_skipped jsonb := '[]'::jsonb;
  v_group record;
  v_order_id uuid;
  v_fee int;
  v_requested uuid[];
  v_claimed uuid[];
  v_basket_total bigint;
begin
  if p_checkout_request_key is not null and (
    p_idempotency_key is null
    or p_checkout_context is null
    or jsonb_typeof(p_checkout_context) <> 'object'
  ) then
    raise exception 'Checkout request binding requires an idempotency key and context' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_buyer_id::text, 0));
  if exists(select 1 from public.profiles where id=p_buyer_id and suspended_at is not null) then raise exception 'Account unavailable'; end if;
  if p_checkout_request_key is not null then
    perform pg_advisory_xact_lock(hashtextextended(p_checkout_request_key, 2));
    select buyer_id, idempotency_key, checkout_context
      into v_bound_owner, v_bound_idempotency_key, v_bound_context
    from public.purchase_attempts
    where checkout_request_key = p_checkout_request_key;
    if found and (
      v_bound_owner is distinct from p_buyer_id
      or v_bound_idempotency_key is distinct from p_idempotency_key
      or v_bound_context is distinct from p_checkout_context
    ) then
      raise exception 'Checkout request is already bound to a different purchase' using errcode='42501';
    end if;
  end if;
  v_fingerprint := jsonb_build_object('ids', (select jsonb_agg(x order by x) from (select distinct unnest(p_listing_ids) x) t), 'shipping', coalesce(p_shipping_overrides, '{}'::jsonb));
  if p_idempotency_key is not null then
    perform pg_advisory_xact_lock(hashtextextended(p_idempotency_key, 1));
    select buyer_id, request_fingerprint into v_owner, v_previous from public.purchase_attempts where idempotency_key=p_idempotency_key;
    if found and (v_owner is distinct from p_buyer_id or v_previous is distinct from v_fingerprint) then
      raise exception 'Checkout attempt does not match this buyer or basket' using errcode='42501';
    end if;
    select result into v_previous
    from public.purchase_attempts
    where idempotency_key = p_idempotency_key;

    if v_previous is not null then
      return v_previous;
    end if;
  end if;

  if (select count(*) from public.orders where buyer_id=p_buyer_id and status in ('pending','requires_action')) >= 5 then
    raise exception 'Too many unresolved checkouts';
  end if;
  if (select count(distinct currency) from public.listings where id=any(p_listing_ids)) > 1 then raise exception 'A checkout must use one currency'; end if;
  if cardinality(p_listing_ids)>50 then raise exception 'Checkout supports at most 50 items'; end if;
  if (select count(distinct seller_id) from public.listings where id=any(p_listing_ids))>13 then raise exception 'Split this basket into checkouts with at most 13 sellers'; end if;
  v_requested := coalesce(p_listing_ids, array[]::uuid[]);
  if array_length(v_requested, 1) is null then
    return jsonb_build_object('orders', v_orders, 'skipped', v_skipped);
  end if;

  drop table if exists _claimed;
  create temp table _claimed on commit drop as
  with claimed as (
    update public.listings l
    set status = 'reserved',
        reserved_until = now() + p_reservation_window
    where l.id = any (v_requested)
      and l.status = 'active'
      and l.seller_id <> p_buyer_id
      and private.seller_can_take_payment(l.seller_id)
    returning
      l.id, l.seller_id, l.title, l.price_cents, l.shipping_cents, l.currency
  )
  select
    c.id, c.seller_id, c.title, c.price_cents, c.currency,
    greatest(
      coalesce((p_shipping_overrides ->> c.id::text)::int, c.shipping_cents),
      0
    ) as shipping_cents
  from claimed c;

  select coalesce(array_agg(id), array[]::uuid[]) into v_claimed from _claimed;

  -- One payment covers the whole basket, so the bound is on the basket. Summed
  -- as bigint: a basket of large prices must be refused, not overflow below.
  select coalesce(sum(price_cents::bigint + shipping_cents::bigint), 0)
    into v_basket_total from _claimed;
  if cardinality(v_claimed) > 0 and not public.charge_cents_in_bounds(v_basket_total) then
    raise exception 'A checkout total must be between $0.50 and $999,999.99'
      using errcode = '22003';
  end if;

  select coalesce(
    jsonb_agg(jsonb_build_object('listing_id', missing.id, 'reason', 'unavailable')),
    '[]'::jsonb
  )
  into v_skipped
  from (select unnest(v_requested) as id except select unnest(v_claimed)) as missing;

  for v_group in
    select
      c.seller_id,
      c.currency,
      sum(c.price_cents)::int as subtotal,
      sum(c.shipping_cents)::int as shipping
    from _claimed c
    group by c.seller_id, c.currency
  loop
    v_fee := round((v_group.subtotal + v_group.shipping) * 1000.0 / 10000.0);

    insert into public.orders (
      buyer_id, seller_id, status,
      subtotal_cents, shipping_cents, platform_fee_cents, total_cents, currency
    )
    values (
      p_buyer_id, v_group.seller_id, 'pending',
      v_group.subtotal, v_group.shipping, v_fee,
      v_group.subtotal + v_group.shipping, v_group.currency
    )
    returning id into v_order_id;

    insert into public.order_items (order_id, listing_id, title, price_cents, shipping_cents)
    select v_order_id, c.id, c.title, c.price_cents, c.shipping_cents
    from _claimed c
    where c.seller_id = v_group.seller_id and c.currency = v_group.currency;

    insert into public.payments (order_id, amount_cents, currency, idempotency_key, status)
    values (
      v_order_id,
      v_group.subtotal + v_group.shipping,
      v_group.currency,
      case
        when p_idempotency_key is null then null
        else p_idempotency_key || ':' || v_order_id::text
      end,
      'pending'
    );

    v_orders := v_orders || jsonb_build_object(
      'order_id', v_order_id,
      'seller_id', v_group.seller_id,
      'currency', v_group.currency,
      'subtotal_cents', v_group.subtotal,
      'shipping_cents', v_group.shipping,
      'platform_fee_cents', v_fee,
      'total_cents', v_group.subtotal + v_group.shipping,
      'listing_ids', (
        select jsonb_agg(c.id)
        from _claimed c
        where c.seller_id = v_group.seller_id and c.currency = v_group.currency
      )
    );
  end loop;

  v_previous := jsonb_build_object('orders', v_orders, 'skipped', v_skipped);

  if p_idempotency_key is not null then
    insert into public.purchase_attempts (
      idempotency_key, buyer_id, result, request_fingerprint,
      checkout_request_key, checkout_context
    )
    values (
      p_idempotency_key, p_buyer_id, v_previous, v_fingerprint,
      p_checkout_request_key, p_checkout_context
    )
    on conflict (idempotency_key) do nothing;
  end if;

  return v_previous;
end;
$$;

revoke all on function public.purchase_begin(uuid, uuid[], text, interval, jsonb, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.purchase_begin(uuid, uuid[], text, interval, jsonb, text, jsonb)
  to service_role;

-- ============================================================
-- 8. A refused create-listing doesn't trap its request (N72)
-- ============================================================

-- claim_listing_creation (20260905233517): unchanged except that a changed
-- payload may rebind a claim that has no listing yet (see the comment in
-- the body). The app also checks every bounded field and payout readiness
-- before it claims (src/app/(product)/sell/actions.ts).

create or replace function public.claim_listing_creation(p_request uuid, p_payload_hash text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_request private.listing_creation_requests%rowtype;
  v_inserted integer;
begin
  if v_actor is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if not exists (
       select 1 from public.profiles p
       where p.id = v_actor and p.suspended_at is null
     )
     or not private.beta_member_eligible(v_actor, 'seller') then
    raise exception 'Selling is unavailable for this account' using errcode = '42501';
  end if;
  if p_request is null or coalesce(p_payload_hash, '') !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid listing creation request' using errcode = '22023';
  end if;

  insert into private.listing_creation_requests(seller_id, request_id, payload_hash)
  values(v_actor, p_request, p_payload_hash)
  on conflict(seller_id, request_id) do nothing;
  get diagnostics v_inserted = row_count;

  select * into strict v_request
  from private.listing_creation_requests
  where seller_id = v_actor and request_id = p_request
  for update;

  -- A claim that never produced a listing was refused or abandoned before
  -- anything committed (the listing and its completion commit together), so
  -- a changed request may take it over: same listing id, new details. Once
  -- the listing exists the request is spent on those details, and a
  -- different payload is still refused, so a completed request replays and
  -- never re-edits. The row lock above waits for any save of this request in
  -- flight, and re-reads it after.
  if v_request.payload_hash <> p_payload_hash then
    if v_request.completed_at is not null
       or exists (select 1 from public.listings l where l.id = v_request.listing_id) then
      raise exception 'Listing request was already used with different details'
        using errcode = '22023';
    end if;
    update private.listing_creation_requests r
    set payload_hash = p_payload_hash
    where r.seller_id = v_actor and r.request_id = p_request;
    v_request.payload_hash := p_payload_hash;
  end if;

  return jsonb_build_object(
    'listing_id', v_request.listing_id,
    'completed', v_request.completed_at is not null,
    'fresh', v_inserted = 1
  );
end;
$$;

revoke all on function public.claim_listing_creation(uuid, text) from public, anon;
grant execute on function public.claim_listing_creation(uuid, text) to authenticated;

-- ============================================================
-- 9. Settlement settings: the hold policy is public, the threshold isn't (N26)
-- ============================================================

-- The terms and a seller's payouts page quote the hold, the receipt release
-- and the auto-confirm period, so those stay readable by anyone. The amount
-- above which a card must be verified is a fraud control: knowing it lets
-- someone price just under it. The projection says only whether it is on
-- (tracking_required_from_cents is no longer read at all, 20261107200100).
-- The row itself is read by the server (service role) and by the definer
-- functions that apply it.
revoke all on public.settlement_settings from anon, authenticated;
grant select on public.settlement_settings to service_role;
drop policy if exists "settlement settings are public" on public.settlement_settings;

create or replace function public.settlement_hold_policy()
returns table (
  payout_hold_days integer,
  payout_hold_mode text,
  receipt_release_after_days integer,
  auto_confirm_after_days integer,
  auto_confirm_notice_days integer,
  card_verification_on boolean
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select s.payout_hold_days,
         s.payout_hold_mode,
         s.receipt_release_after_days,
         s.auto_confirm_after_days,
         s.auto_confirm_notice_days,
         s.card_verification_from_cents is not null
  from public.settlement_settings s
  where s.id;
$$;

comment on function public.settlement_hold_policy() is
  'The public part of settlement_settings: hold, release and auto-confirm periods, and whether card verification is on, never its amount (20261107210000).';

revoke all on function public.settlement_hold_policy() from public;
grant execute on function public.settlement_hold_policy() to anon, authenticated, service_role;

notify pgrst, 'reload schema';

commit;
