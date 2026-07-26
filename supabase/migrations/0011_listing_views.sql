-- View counts on listings (Werkbank C1).
--
-- The seller's ledger shows VIEWS next to WATCH so a seller can tell "nobody
-- has seen it" apart from "people look and don't save it" — two very different
-- problems with two different fixes (discovery vs price/photos).
--
-- Honest scope: this counts *page loads* of the public part sheet, not unique
-- humans. It is deliberately not a analytics pipeline. The seller's own views
-- are excluded at the call site so a seller refreshing their own listing does
-- not inflate it.
alter table public.listings add column if not exists view_count integer not null default 0;

comment on column public.listings.view_count is
  'Public part-sheet loads, excluding the seller. Counts loads, not unique viewers.';

-- Incremented from a server component, so it must not require the caller to
-- have update rights on the listing (buyers do not). security definer keeps the
-- grant narrow: this function can only ever bump the counter.
create or replace function public.bump_listing_view(p_listing uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.listings
     set view_count = view_count + 1
   where id = p_listing
     and status = 'active';
$$;

revoke all on function public.bump_listing_view(uuid) from public;
grant execute on function public.bump_listing_view(uuid) to anon, authenticated;
