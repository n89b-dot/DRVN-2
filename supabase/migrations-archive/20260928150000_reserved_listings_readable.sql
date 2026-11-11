-- A part that is being paid for stays visible.
--
-- Checkout holds a listing for 15 minutes and an accepted offer for 24 hours
-- (status 'reserved'). The read policies only admitted 'active' and 'sold',
-- so for everyone but the seller a held part became a 404: the buyer paying
-- for it lost its page, carts showed "a listing that's since been deleted",
-- and other buyers' offers on it vanished. The app already has the reserved
-- states (cart reason, "This listing is reserved", no buy buttons); only the
-- rows were hidden.
--
-- 'reserved' joins 'active' and 'sold' in the listing read policy and in the
-- four child policies that follow it (photos, fitment, part numbers, Q&A),
-- each otherwise unchanged. Every browse, feed, store and search query
-- already filters to status = 'active' itself, so no grid starts showing a
-- held part as buyable. Drafts, paused and archived listings stay private.
--
-- Idempotent: drop and re-create each policy.

begin;

drop policy if exists "active listings readable" on public.listings;
create policy "active listings readable" on public.listings
  for select using (
    (status in ('active', 'reserved', 'sold') and not public.is_suspended(seller_id))
    or auth.uid() = seller_id
    or public.is_admin()
  );

drop policy if exists "listing images follow listing" on public.listing_images;
create policy "listing images follow listing" on public.listing_images
  for select using (
    exists (
      select 1 from public.listings l
      where l.id = listing_images.listing_id
        and (
          (l.status in ('active', 'reserved', 'sold') and not public.is_suspended(l.seller_id))
          or l.seller_id = auth.uid()
          or public.is_admin()
        )
    )
  );

drop policy if exists "fitment follows listing" on public.listing_fitments;
create policy "fitment follows listing" on public.listing_fitments
  for select using (
    exists (
      select 1 from public.listings l
      where l.id = listing_fitments.listing_id
        and (l.status in ('active', 'reserved', 'sold') or l.seller_id = auth.uid())
    )
  );

drop policy if exists "listing part numbers follow listing" on public.listing_part_numbers;
create policy "listing part numbers follow listing" on public.listing_part_numbers
  for select using (
    exists (
      select 1 from public.listings l
      where l.id = listing_part_numbers.listing_id
        and (l.status in ('active', 'reserved', 'sold') or l.seller_id = auth.uid())
    )
  );

drop policy if exists "questions follow listing visibility" on public.listing_questions;
create policy "questions follow listing visibility" on public.listing_questions
  for select using (
    exists (
      select 1 from public.listings l
      where l.id = listing_questions.listing_id
        and (l.status in ('active', 'reserved', 'sold') or l.seller_id = auth.uid())
    )
  );

commit;
