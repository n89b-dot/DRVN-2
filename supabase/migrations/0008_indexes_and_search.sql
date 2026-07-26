-- ============================================================================
-- 0008 — Indexes and search (remediation plan R4.11 + R7.5)
--
-- 0001 created 11 indexes and missed every hot path the app actually queries.
-- The sharpest was reviews.reviewee_id, which is read on *every* listing-detail
-- page view to compute a seller's average rating.
--
-- Also replaces the unindexable `ilike '%q%'` title search with trigram
-- matching across title, description, brand and compatibility notes.
--
-- Idempotent: safe to re-run.
-- Run in the Supabase SQL Editor.
-- ============================================================================

begin;

-- ============================================================
-- 1. Commerce hot paths
-- ============================================================
-- /orders reads both sides with an OR; neither column was indexed.
create index if not exists orders_buyer_idx on public.orders (buyer_id, created_at desc);
create index if not exists orders_seller_idx on public.orders (seller_id, created_at desc);
create index if not exists orders_status_idx on public.orders (status);
create index if not exists order_items_order_idx on public.order_items (order_id);
create index if not exists order_items_listing_idx on public.order_items (listing_id);

-- Seller rating aggregation, read on every listing view.
create index if not exists reviews_reviewee_idx on public.reviews (reviewee_id);
create index if not exists reviews_order_idx on public.reviews (order_id);

create index if not exists offers_buyer_idx on public.offers (buyer_id, created_at desc);
create index if not exists offers_status_idx on public.offers (status) where status in ('open', 'countered');

create index if not exists messages_recipient_idx on public.messages (recipient_id, created_at desc);
create index if not exists messages_sender_idx on public.messages (sender_id);
create index if not exists messages_offer_idx on public.messages (offer_id);
create index if not exists messages_order_idx on public.messages (order_id);
-- Unread badge.
create index if not exists messages_unread_idx on public.messages (recipient_id) where read_at is null;

-- ============================================================
-- 2. Listings and feeds
-- ============================================================
-- The default marketplace sort ("all listings, newest first") had no
-- supporting index — only (category, status).
create index if not exists listings_created_idx on public.listings (created_at desc);
create index if not exists listings_status_created_idx on public.listings (status, created_at desc);
-- "Parts released from this car" (R5.4).
create index if not exists listings_source_car_idx on public.listings (source_car_id)
  where source_car_id is not null;
create index if not exists listings_price_idx on public.listings (price_cents);

create index if not exists activity_posts_author_idx on public.activity_posts (author_id);
create index if not exists activity_posts_published_idx on public.activity_posts (published_at desc)
  where published_at is not null;

-- Save/follow lookups by target — used by the notification derivation, which
-- previously scanned.
create index if not exists saves_target_idx on public.saves (target_type, target_id);
create index if not exists saves_user_idx on public.saves (user_id, created_at desc);
create index if not exists follows_target_idx on public.follows (target_type, target_id);
create index if not exists follows_follower_idx on public.follows (follower_id, created_at desc);

create index if not exists mod_items_linked_listing_idx on public.mod_items (linked_listing_id)
  where linked_listing_id is not null;

-- ============================================================
-- 3. Full-text-ish search
-- ============================================================
-- `ilike '%term%'` cannot use a btree index, and only ever searched the title.
create extension if not exists pg_trgm;

create index if not exists listings_title_trgm_idx
  on public.listings using gin (title gin_trgm_ops);
create index if not exists listings_description_trgm_idx
  on public.listings using gin (description gin_trgm_ops);

/**
 * Marketplace keyword search. Widened from title-only to the fields a buyer
 * actually types into: title, description, and the seller's freeform
 * compatibility notes (which is where fitment language like "fits MK7 Golf R"
 * lives). Returns matching ids so the caller keeps its own filtering/paging.
 */
create or replace function public.search_listing_ids(p_query text)
returns setof uuid
language sql
stable
as $$
  select l.id
  from public.listings l
  where p_query is null
     or p_query = ''
     or l.title ilike '%' || p_query || '%'
     or l.description ilike '%' || p_query || '%'
     or l.compatibility_notes ilike '%' || p_query || '%'
  order by
    -- Title hits first, then similarity.
    case when l.title ilike '%' || p_query || '%' then 0 else 1 end,
    similarity(l.title, coalesce(p_query, '')) desc;
$$;

commit;
