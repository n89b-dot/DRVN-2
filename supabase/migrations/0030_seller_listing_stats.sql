-- Seller ledger aggregates in SQL (Werkbank C1, remediation P3.1).
--
-- /listings used to pull every listing a seller owns (ceiling 2000) plus ALL
-- of their offers, questions, images and saves, then filter, tally, sort and
-- slice in JS. These two functions move that work into one round trip each:
--
--   seller_listing_stats   → one page of ledger rows for a register + sort,
--                            each row carrying its aggregates and a window
--                            count of the whole filtered register.
--   seller_register_tally  → the chip counts, one grouped scan.
--
-- Both are SECURITY INVOKER: they read only tables the seller can already
-- read under RLS (own listings, offers on own listings, public saves and
-- questions), so the caller's policies keep applying inside the function.
-- The p_seller = auth.uid() guard is belt-and-braces on top of that — a
-- mismatched caller gets zero rows, not an error.

-- Register semantics (must match matchesRegister in
-- src/app/(product)/listings/page.tsx):
--   'all'   → every listing
--   'live'  → status = 'active' AND no live offer
--   'offer' → has a live offer, regardless of status
--   other   → status = register (draft/paused/reserved/archived/sold)
-- A "live offer" is one in status 'open' or 'countered'; its value is
-- coalesce(counter_amount_cents, amount_cents).

create or replace function public.seller_listing_stats(
  p_seller uuid,
  p_register text default 'all',
  p_sort text default 'top_offer',
  p_limit int default 50,
  p_offset int default 0
)
returns table (
  id uuid,
  title text,
  part_number text,
  price_cents int,
  status text,
  view_count int,
  created_at timestamptz,
  source_car_id uuid,
  cover_url text,
  watch_count int,
  top_offer_cents int,
  soonest_offer_expiry timestamptz,
  unanswered_questions int,
  total_count bigint
)
language sql
security invoker
set search_path = public
stable
as $$
  with base as (
    select
      l.id, l.title, l.part_number, l.price_cents, l.status, l.view_count,
      l.created_at, l.source_car_id,
      (select li.url from listing_images li
        where li.listing_id = l.id
        order by li.position, li.created_at
        limit 1) as cover_url,
      (select count(*) from saves s
        where s.target_type = 'listing' and s.target_id = l.id)::int as watch_count,
      (select max(coalesce(o.counter_amount_cents, o.amount_cents)) from offers o
        where o.listing_id = l.id and o.status in ('open', 'countered'))::int as top_offer_cents,
      (select min(o.expires_at) from offers o
        where o.listing_id = l.id and o.status in ('open', 'countered')) as soonest_offer_expiry,
      -- A root question counts as unanswered while no reply points at it —
      -- same definition the page used to compute in JS (unansweredFor).
      (select count(*) from listing_questions q
        where q.listing_id = l.id
          and q.parent_id is null
          and not exists (select 1 from listing_questions a where a.parent_id = q.id)
      )::int as unanswered_questions
    from listings l
    where l.seller_id = p_seller
      and p_seller = auth.uid()
  ),
  filtered as (
    select * from base b
    where case p_register
      when 'live'  then b.status = 'active' and b.top_offer_cents is null
      when 'offer' then b.top_offer_cents is not null
      when 'all'   then true
      else b.status = p_register
    end
  )
  select f.*, count(*) over () as total_count
  from filtered f
  -- Every measure sorts descending (the seller wants the loudest row first);
  -- created_at desc is both the 'newest' sort and the tiebreak, matching the
  -- old in-memory stable sort over a newest-first fetch. Unknown sort keys
  -- fall through to newest.
  order by
    case when p_sort = 'top_offer' then f.top_offer_cents end desc nulls last,
    case when p_sort = 'views'     then f.view_count end desc,
    case when p_sort = 'watch'     then f.watch_count end desc,
    case when p_sort = 'asking'    then f.price_cents end desc,
    f.created_at desc
  limit greatest(p_limit, 0)
  offset greatest(p_offset, 0);
$$;

revoke all on function public.seller_listing_stats(uuid, text, text, int, int) from public, anon;
grant execute on function public.seller_listing_stats(uuid, text, text, int, int) to authenticated;

-- Chip counts for every register in one scan. A listing can appear in more
-- than one bucket ('offer' overlaps the status buckets), so this is a single
-- row of filtered counts, not a GROUP BY.
create or replace function public.seller_register_tally(p_seller uuid)
returns table (
  all_count bigint,
  live_count bigint,
  offer_count bigint,
  draft_count bigint,
  paused_count bigint,
  reserved_count bigint,
  archived_count bigint,
  sold_count bigint
)
language sql
security invoker
set search_path = public
stable
as $$
  with base as (
    select
      l.status,
      exists (select 1 from offers o
        where o.listing_id = l.id and o.status in ('open', 'countered')) as under_offer
    from listings l
    where l.seller_id = p_seller
      and p_seller = auth.uid()
  )
  select
    count(*) as all_count,
    count(*) filter (where status = 'active' and not under_offer) as live_count,
    count(*) filter (where under_offer) as offer_count,
    count(*) filter (where status = 'draft') as draft_count,
    count(*) filter (where status = 'paused') as paused_count,
    count(*) filter (where status = 'reserved') as reserved_count,
    count(*) filter (where status = 'archived') as archived_count,
    count(*) filter (where status = 'sold') as sold_count
  from base;
$$;

revoke all on function public.seller_register_tally(uuid) from public, anon;
grant execute on function public.seller_register_tally(uuid) to authenticated;

-- The answered-question NOT EXISTS probes by parent_id; everything else the
-- functions touch is already indexed (0001/0008).
create index if not exists listing_questions_parent_idx
  on public.listing_questions (parent_id)
  where parent_id is not null;

-- The ledger's default order within a seller's rows.
create index if not exists listings_seller_created_idx
  on public.listings (seller_id, created_at desc);
