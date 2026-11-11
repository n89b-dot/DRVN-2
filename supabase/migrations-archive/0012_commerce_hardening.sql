-- ============================================================================
-- 0012 — Commerce hardening (fixes C1–C6 from the 30 July review)
--
-- 0007 introduced claim → pay → finalize, which correctly closed the
-- double-sell race. A follow-up review found that the *failure* paths were
-- never exercised, because StubPaymentProvider can only return `succeeded`.
-- Everything below is a bug that appears the moment a real processor can
-- decline, time out, or retry a webhook.
--
--  C1  release_expired_reservations() was never scheduled. An abandoned
--      checkout left the listing `reserved` forever — and RLS hides `reserved`
--      from everyone but the seller, so the part silently left the market with
--      no recovery path. Now scheduled via pg_cron, and it now also cancels the
--      stranded order and fails its payment instead of freeing the listing
--      alone.
--
--  C2  purchase_finalize() guarded only one of its writes. A retry after a
--      declined payment could produce a `succeeded` payment on a
--      `payment_failed` order with the listing back on sale — buyer charged,
--      owning nothing. It is now strictly idempotent and refuses to move an
--      order backwards, which a webhook *will* exercise: Stripe redelivers the
--      same event for up to three days.
--
--  C3  The reservation window (15 min) and the pending-order cancel window
--      (60 min) disagreed, leaving 45 minutes where a listing was back on sale
--      while its original order could still be finalized — two paid orders, one
--      part. The sweeper now handles listing and order together, so the two
--      cannot drift apart by construction.
--
--  C4  offer_accept_begin() charged the buyer on the seller's click: no
--      shipping address, no consent, no idempotency key. It now reserves the
--      listing and creates a `pending` order for the buyer to complete, and it
--      honours offers.expires_at, which was previously decorative.
--
--  C5  Listing status transitions were enforced only in TypeScript. The anon
--      key is public, so a seller could PATCH a `reserved` listing back to
--      `active` mid-checkout and be paid twice for one part. Now a trigger.
--
--  C6  (fixed in application code — see requestCancellation)
--
-- Idempotent: safe to re-run.
-- ============================================================================

begin;

-- ============================================================
-- C5 — listing status transitions belong in the database
-- ============================================================
-- `sellers update listings` has USING/WITH CHECK on seller_id only; nothing
-- constrains `status`. These are the same rules setListingStatus applies in
-- TypeScript, moved to where they cannot be bypassed by a direct REST call.
create or replace function public.guard_listing_status()
returns trigger
language plpgsql
as $$
begin
  if public.is_trusted_writer() then
    return new;
  end if;

  if new.status is distinct from old.status then
    -- `reserved` and `sold` are outcomes of checkout, never a seller's choice.
    if new.status in ('reserved', 'sold') then
      raise exception 'listing status % is set by checkout, not by the seller', new.status
        using errcode = '42501';
    end if;

    -- A listing held by an in-flight checkout must not be yanked out from
    -- under the buyer. Only the sweeper or a finalize may release it.
    if old.status = 'reserved' then
      raise exception 'listing is reserved by a checkout in progress'
        using errcode = '42501';
    end if;

    -- A sold part stays sold. Relisting means creating a new listing, so the
    -- order history keeps pointing at what was actually bought.
    if old.status = 'sold' then
      raise exception 'a sold listing cannot be relisted — create a new one'
        using errcode = '42501';
    end if;
  end if;

  -- Price and shipping are part of what a buyer agreed to; freeze them while a
  -- checkout holds the row.
  if old.status = 'reserved'
     and (new.price_cents is distinct from old.price_cents
          or new.shipping_cents is distinct from old.shipping_cents) then
    raise exception 'cannot change price while a checkout is in progress'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists listings_guard_status on public.listings;
create trigger listings_guard_status
  before update on public.listings
  for each row execute function public.guard_listing_status();

-- Deleting a listing mid-checkout nulls order_items.listing_id, which made
-- purchase_finalize collect an empty array and mark the order paid for a part
-- that no longer existed.
create or replace function public.guard_listing_delete()
returns trigger
language plpgsql
as $$
begin
  if public.is_trusted_writer() then
    return old;
  end if;
  if old.status in ('reserved', 'sold') then
    raise exception 'cannot delete a listing that is reserved or sold'
      using errcode = '42501';
  end if;
  return old;
end;
$$;

drop trigger if exists listings_guard_delete on public.listings;
create trigger listings_guard_delete
  before delete on public.listings
  for each row execute function public.guard_listing_delete();

-- ============================================================
-- C2 — purchase_finalize must be strictly idempotent
-- ============================================================
drop function if exists public.purchase_finalize(uuid, boolean, text, text, text);
create or replace function public.purchase_finalize(
  p_order_id uuid,
  p_success boolean,
  p_provider text default 'stub',
  p_reference text default null,
  p_failure_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order record;
  v_listing_ids uuid[];
  v_applied boolean := false;
begin
  -- Lock the order so two concurrent finalizes (a webhook retry racing the
  -- inline call) serialise rather than interleave.
  select id, status into v_order
  from public.orders
  where id = p_order_id
  for update;

  if not found then
    return jsonb_build_object('applied', false, 'reason', 'order not found');
  end if;

  -- Terminal states are terminal. Without this, a late `failed` webhook could
  -- drag a paid, shipped, delivered order backwards to payment_failed.
  if v_order.status not in ('pending', 'requires_action') then
    return jsonb_build_object(
      'applied', false,
      'reason', 'order already settled',
      'status', v_order.status
    );
  end if;

  select coalesce(array_agg(listing_id), array[]::uuid[])
  into v_listing_ids
  from public.order_items
  where order_id = p_order_id and listing_id is not null;

  if p_success then
    update public.orders set status = 'paid' where id = p_order_id;

    update public.listings
    set status = 'sold', sold_at = now(), reserved_until = null
    where id = any (v_listing_ids) and status = 'reserved';

    update public.payments
    set status = 'succeeded',
        provider = p_provider,
        provider_reference = coalesce(p_reference, provider_reference)
    where order_id = p_order_id and status in ('pending', 'requires_action');

    update public.offers
    set status = 'expired', responded_at = now()
    where listing_id = any (v_listing_ids) and status in ('open', 'countered');
  else
    update public.orders
    set status = 'payment_failed',
        cancelled_at = now(),
        cancel_reason = p_failure_reason
    where id = p_order_id;

    update public.listings
    set status = 'active', reserved_until = null
    where id = any (v_listing_ids) and status = 'reserved';

    update public.payments
    set status = 'failed',
        provider = p_provider,
        failure_reason = p_failure_reason
    where order_id = p_order_id and status in ('pending', 'requires_action');
  end if;

  v_applied := true;
  return jsonb_build_object('applied', v_applied, 'status',
    case when p_success then 'paid' else 'payment_failed' end);
end;
$$;

-- ============================================================
-- C1 + C3 — one sweeper, one window, listing and order together
-- ============================================================
drop function if exists public.release_expired_reservations();
create or replace function public.release_expired_reservations()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_orders uuid[];
  v_listings int := 0;
  v_cancelled int := 0;
begin
  -- Find the orders whose reservation has lapsed. Driving from the listing
  -- keeps the two in lockstep: the previous version freed listings on a 15
  -- minute clock and cancelled orders on a 60 minute one, leaving 45 minutes
  -- where a listing was back on sale but its order could still be finalized.
  select coalesce(array_agg(distinct oi.order_id), array[]::uuid[])
  into v_orders
  from public.listings l
  join public.order_items oi on oi.listing_id = l.id
  join public.orders o on o.id = oi.order_id
  where l.status = 'reserved'
    and l.reserved_until < now()
    and o.status in ('pending', 'requires_action');

  -- Cancel first, so a finalize arriving mid-sweep finds a non-pending order
  -- and refuses (see purchase_finalize's terminal-state guard).
  if array_length(v_orders, 1) is not null then
    update public.orders
    set status = 'cancelled',
        cancelled_at = now(),
        cancel_reason = 'checkout not completed in time'
    where id = any (v_orders) and status in ('pending', 'requires_action');
    get diagnostics v_cancelled = row_count;

    update public.payments
    set status = 'failed', failure_reason = 'checkout not completed in time'
    where order_id = any (v_orders) and status in ('pending', 'requires_action');
  end if;

  with released as (
    update public.listings
    set status = 'active', reserved_until = null
    where status = 'reserved' and reserved_until < now()
    returning id
  )
  select count(*) into v_listings from released;

  -- Lapsed offers, which were previously advisory only: expires_at was set and
  -- never read, so the UI showed offers as open that no longer were.
  update public.offers
  set status = 'expired', responded_at = now()
  where status in ('open', 'countered')
    and expires_at is not null
    and expires_at < now();

  return jsonb_build_object(
    'listings_released', v_listings,
    'orders_cancelled', v_cancelled
  );
end;
$$;

-- ============================================================
-- C4 — accepting an offer reserves; the buyer completes checkout
-- ============================================================
-- Previously this charged on the seller's click, producing an order with every
-- ship_* column NULL. A buyer cannot be charged for delivery to nowhere, and
-- off-session charging needs a stored mandate that does not exist. The offer
-- now converts to a held order the buyer finishes.
create or replace function public.offer_accept_begin(
  p_offer_id uuid,
  p_seller_id uuid,
  p_reservation_window interval default interval '24 hours'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_offer record;
  v_listing record;
  v_price int;
  v_fee int;
  v_order_id uuid;
begin
  select o.id, o.listing_id, o.buyer_id, o.amount_cents, o.counter_amount_cents,
         o.status, o.expires_at
  into v_offer
  from public.offers o
  where o.id = p_offer_id
  for update;

  if not found or v_offer.status not in ('open', 'countered') then
    return null;
  end if;

  -- Honour expiry. A months-old offer must not be acceptable at its old price.
  if v_offer.expires_at is not null and v_offer.expires_at < now() then
    update public.offers
    set status = 'expired', responded_at = now()
    where id = p_offer_id;
    return null;
  end if;

  v_price := coalesce(v_offer.counter_amount_cents, v_offer.amount_cents);

  update public.listings l
  set status = 'reserved', reserved_until = now() + p_reservation_window
  where l.id = v_offer.listing_id
    and l.seller_id = p_seller_id
    and l.status = 'active'
  returning l.id, l.title, l.shipping_cents, l.currency
  into v_listing;

  if not found then
    return null;
  end if;

  v_fee := round(v_price * 1000.0 / 10000.0);

  insert into public.orders (
    buyer_id, seller_id, status,
    subtotal_cents, shipping_cents, platform_fee_cents, total_cents, currency
  )
  values (
    v_offer.buyer_id, p_seller_id, 'pending',
    v_price, v_listing.shipping_cents, v_fee,
    v_price + v_listing.shipping_cents, v_listing.currency
  )
  returning id into v_order_id;

  insert into public.order_items (order_id, listing_id, title, price_cents, shipping_cents)
  values (v_order_id, v_listing.id, v_listing.title, v_price, v_listing.shipping_cents);

  -- Keyed on the order so a replayed completion cannot double-charge.
  insert into public.payments (order_id, amount_cents, currency, status, idempotency_key)
  values (
    v_order_id,
    v_price + v_listing.shipping_cents,
    v_listing.currency,
    'pending',
    'offer:' || p_offer_id::text || ':' || v_order_id::text
  );

  update public.offers
  set status = 'accepted', responded_at = now()
  where id = p_offer_id;

  return v_order_id;
end;
$$;

-- ============================================================
-- Idempotency: claim the key before doing the work
-- ============================================================
-- purchase_begin read purchase_attempts, did the work, then inserted with
-- `on conflict do nothing`. Two concurrent submits with the same key both
-- missed the read; the loser claimed no listings and discarded its write, then
-- returned an empty result — telling a buyer "nothing was available" for the
-- item they had just successfully bought. Claiming the key first turns the
-- race into a lock.
create or replace function public.purchase_claim_key(
  p_idempotency_key text,
  p_buyer_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing jsonb;
begin
  if p_idempotency_key is null then
    return null;
  end if;

  insert into public.purchase_attempts (idempotency_key, buyer_id, result)
  values (p_idempotency_key, p_buyer_id, 'null'::jsonb)
  on conflict (idempotency_key) do nothing;

  -- Either we just claimed it (result = 'null') or someone else owns it.
  select result into v_existing
  from public.purchase_attempts
  where idempotency_key = p_idempotency_key
    and buyer_id is not distinct from p_buyer_id
  for update;

  return v_existing;
end;
$$;

-- ============================================================
-- F1 (CRITICAL) — offers were unguarded on INSERT
-- ============================================================
-- The INSERT policy checked only `auth.uid() = buyer_id`. Everything
-- guard_offer_columns protects on UPDATE could simply be *set* at insert time:
-- a user could POST an offer with status='countered' and
-- counter_amount_cents=1, which the UI then renders as a genuine seller
-- counter with an Accept button. Accepting it ran offer_accept_begin at 1 cent
-- — buying any active listing for £0.01, bypassing price, offer floor, the
-- not-your-own-listing rule, the one-live-offer rule and the rate limit.
create or replace function public.guard_offer_insert()
returns trigger
language plpgsql
-- Deliberately NOT security definer: is_trusted_writer() reads current_user,
-- and a definer function runs as the owner (postgres), which would make the
-- guard consider every caller trusted and disable itself. Invoker rights also
-- mean the listing lookup below is subject to the caller's RLS, which is what
-- we want — you cannot offer on something you cannot see.
set search_path = public
as $$
declare
  v_listing record;
begin
  if public.is_trusted_writer() then
    return new;
  end if;

  -- A buyer opens an offer. Countering is the seller's move and runs
  -- server-side, so neither the countered state nor its amount may be
  -- self-assigned.
  if new.status is distinct from 'open' then
    raise exception 'a new offer must start as open' using errcode = '42501';
  end if;
  if new.counter_amount_cents is not null or new.countered_at is not null then
    raise exception 'only the seller can counter, and not at offer time'
      using errcode = '42501';
  end if;
  if new.responded_at is not null then
    raise exception 'responded_at is set when the seller responds'
      using errcode = '42501';
  end if;

  select id, seller_id, status, price_cents, offer_floor_cents
  into v_listing
  from public.listings
  where id = new.listing_id;

  if not found or v_listing.status <> 'active' then
    raise exception 'that part is not on sale' using errcode = '42501';
  end if;
  if v_listing.seller_id = new.buyer_id then
    raise exception 'you cannot offer on your own listing' using errcode = '42501';
  end if;
  if new.amount_cents > v_listing.price_cents then
    raise exception 'an offer cannot exceed the asking price' using errcode = '42501';
  end if;
  if v_listing.offer_floor_cents is not null
     and new.amount_cents < v_listing.offer_floor_cents then
    raise exception 'that offer is below the seller''s minimum' using errcode = '42501';
  end if;

  -- One live offer per buyer per listing.
  if exists (
    select 1 from public.offers o
    where o.listing_id = new.listing_id
      and o.buyer_id = new.buyer_id
      and o.status in ('open', 'countered')
  ) then
    raise exception 'you already have a live offer on this part' using errcode = '42501';
  end if;

  -- The window is the platform's to set, not the buyer's.
  new.expires_at := now() + interval '72 hours';

  return new;
end;
$$;

drop trigger if exists offers_guard_insert on public.offers;
create trigger offers_guard_insert
  before insert on public.offers
  for each row execute function public.guard_offer_insert();

-- F12 — a buyer could walk a countered offer back to 'open', or set
-- 'countered' themselves and fire a spoofed "seller countered" notification.
drop policy if exists "buyers withdraw own offers" on public.offers;
create policy "buyers withdraw own offers" on public.offers for update
  using (auth.uid() = buyer_id and status in ('open', 'countered'))
  with check (auth.uid() = buyer_id and status = 'withdrawn');

-- ============================================================
-- F2 — an activity post could be moved onto someone else's car
-- ============================================================
-- INSERT correctly proves car ownership; UPDATE's WITH CHECK pinned only
-- author_id, so a PATCH could repoint car_id at any public car and publish
-- into that build's thread.
create or replace function public.guard_activity_post_columns()
returns trigger
language plpgsql
as $$
begin
  if public.is_trusted_writer() then
    return new;
  end if;
  if new.car_id is distinct from old.car_id then
    raise exception 'an update belongs to the car it was filed against'
      using errcode = '42501';
  end if;
  if new.author_id is distinct from old.author_id then
    raise exception 'author is immutable' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists activity_posts_guard_columns on public.activity_posts;
create trigger activity_posts_guard_columns
  before update on public.activity_posts
  for each row execute function public.guard_activity_post_columns();

create or replace function public.guard_activity_comment_columns()
returns trigger
language plpgsql
as $$
begin
  if public.is_trusted_writer() then
    return new;
  end if;
  if new.post_id is distinct from old.post_id or new.author_id is distinct from old.author_id then
    raise exception 'a comment stays on its post' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists activity_comments_guard_columns on public.activity_comments;
create trigger activity_comments_guard_columns
  before update on public.activity_comments
  for each row execute function public.guard_activity_comment_columns();

-- ============================================================
-- F3 — a review could be retargeted at anyone after the fact
-- ============================================================
-- The INSERT policy proves the reviewee is the counterparty of a real,
-- delivered order. UPDATE checked only reviewer_id, so the row could then be
-- PATCHed to point at any user — and seller ratings are read straight off
-- reviewee_id, so one real order bought unlimited 1-star reviews of every
-- competitor.
create or replace function public.guard_review_columns()
returns trigger
language plpgsql
as $$
begin
  if public.is_trusted_writer() then
    return new;
  end if;
  if new.reviewee_id is distinct from old.reviewee_id
     or new.reviewer_id is distinct from old.reviewer_id
     or new.order_id is distinct from old.order_id then
    raise exception 'a review stays attached to its order and its subject'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists reviews_guard_columns on public.reviews;
create trigger reviews_guard_columns
  before update on public.reviews
  for each row execute function public.guard_review_columns();

-- ============================================================
-- F4 — messages could be injected into any stranger's thread
-- ============================================================
-- The INSERT policy validated only sender_id, so a direct POST could place a
-- message in anyone's order conversation — an in-product phishing channel
-- ("payment failed, pay here instead") wearing the order's own UI.
drop policy if exists "senders create messages" on public.messages;
create policy "senders create messages" on public.messages for insert
  with check (
    auth.uid() = sender_id
    and auth.uid() is distinct from recipient_id
    and (
      -- Party to the order…
      (order_id is not null and exists (
        select 1 from public.orders o
        where o.id = order_id
          and auth.uid() in (o.buyer_id, o.seller_id)
          and recipient_id in (o.buyer_id, o.seller_id)
      ))
      -- …or to the offer…
      or (offer_id is not null and exists (
        select 1 from public.offers f
        join public.listings l on l.id = f.listing_id
        where f.id = offer_id
          and auth.uid() in (f.buyer_id, l.seller_id)
          and recipient_id in (f.buyer_id, l.seller_id)
      ))
      -- …or writing to the seller of a listing that is actually on sale.
      or (order_id is null and offer_id is null and exists (
        select 1 from public.listings l
        where l.id = listing_id
          and l.status in ('active', 'sold')
          and recipient_id = l.seller_id
      ))
    )
  );

-- ============================================================
-- F7/F8 — Q&A visibility, and the parent-reply check that never worked
-- ============================================================
-- 0006 intended to keep replies on the same listing, but the subquery compared
-- q.id to its own parent_id instead of the incoming row's, making the clause
-- constant-false — so seller replies were silently impossible. It failed
-- closed, which is why nothing looked broken.
drop policy if exists "authed users ask questions" on public.listing_questions;
create policy "authed users ask questions" on public.listing_questions for insert
  with check (
    auth.uid() = author_id
    and char_length(body) between 1 and 2000
    and exists (
      select 1 from public.listings l
      where l.id = listing_questions.listing_id
        and (l.status in ('active', 'sold') or l.seller_id = auth.uid())
    )
    and (
      parent_id is null
      or exists (
        select 1 from public.listing_questions q
        where q.id = listing_questions.parent_id
          and q.listing_id = listing_questions.listing_id
      )
    )
  );

-- Q&A was world-readable regardless of the listing's state, so questions (and
-- the identity of who asked) survived a listing being drafted or archived.
drop policy if exists "questions are public" on public.listing_questions;
drop policy if exists "questions follow listing visibility" on public.listing_questions;
create policy "questions follow listing visibility" on public.listing_questions for select
  using (
    exists (
      select 1 from public.listings l
      where l.id = listing_questions.listing_id
        and (l.status in ('active', 'sold') or l.seller_id = auth.uid())
    )
  );

-- ============================================================
-- F5 — the view counter was an open, unauthenticated write
-- ============================================================
-- Granted to anon with no dedup or limit, so any listing's view_count could be
-- driven up (or a competitor's distorted) with a curl loop. The seller console
-- presents this as a pricing signal, so the harm is bad decisions, not vanity.
-- Counting only signed-in views loses volume but makes the number mean
-- something; it is also now rate limited per viewer.
revoke execute on function public.bump_listing_view(uuid) from anon;

create or replace function public.bump_listing_view(p_listing uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return;
  end if;

  -- One counted view per viewer per listing per hour.
  if not public.consume_rate_limit(
       'view:' || p_listing::text || ':' || auth.uid()::text, 1, interval '1 hour'
     ) then
    return;
  end if;

  update public.listings
  set view_count = coalesce(view_count, 0) + 1
  where id = p_listing and status in ('active', 'sold') and seller_id <> auth.uid();
end;
$$;

revoke all on function public.purchase_finalize(uuid, boolean, text, text, text) from public, anon, authenticated;
revoke all on function public.release_expired_reservations() from public, anon, authenticated;
revoke all on function public.offer_accept_begin(uuid, uuid, interval) from public, anon, authenticated;
revoke all on function public.purchase_claim_key(text, uuid) from public, anon, authenticated;

commit;
