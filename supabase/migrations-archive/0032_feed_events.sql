-- 0032: feed_events — one globally-ordered timeline for the Explore feed.
--
-- Before this, src/lib/feed.ts assembled each feed page by pulling the top
-- `page * pageSize` rows from three separately-sorted tables (cars,
-- activity_posts, listings), merging and sorting in memory, and slicing —
-- so query cost grew with page depth and `hasMore` lied past a hard cap.
-- This view gives the merge a single ordered source: each page is one
-- indexed scan with `range()`, flat cost at any depth.
--
-- security_invoker: the view runs with the caller's rights, so each branch's
-- RLS select policy (0001) still applies — "public cars readable",
-- "published activity readable", "active listings readable" all admit anon
-- and authenticated for exactly the rows the WHERE clauses below select.
-- The WHERE clauses additionally exclude what RLS would let an *owner* see
-- of their own private/draft rows: a feed is public material only.
--
-- Parts stay login-gated in app code (fetchFeed only asks for kind='part'
-- when the viewer is signed in); anon selecting part rows here would leak
-- nothing anyway — active listings are already anon-readable under RLS.

create or replace view public.feed_events
  with (security_invoker = true)
as
  select
    'car'::text        as kind,
    c.id               as id,
    c.created_at       as happened_at,
    c.id               as car_id
  from public.cars c
  where c.is_public

  union all

  select
    'update'::text     as kind,
    p.id               as id,
    p.published_at     as happened_at,
    p.car_id           as car_id
  from public.activity_posts p
  where p.published_at is not null
    and exists (select 1 from public.cars c where c.id = p.car_id and c.is_public)

  union all

  select
    'part'::text       as kind,
    l.id               as id,
    l.created_at       as happened_at,
    l.source_car_id    as car_id
  from public.listings l
  where l.status = 'active';

comment on view public.feed_events is
  'Explore feed timeline: public cars, published build updates, active listings — one recency-ordered source (see src/lib/feed.ts).';

grant select on public.feed_events to anon, authenticated;

-- Supporting indexes so each branch of the union resolves its slice of an
-- ORDER BY happened_at DESC page from an index rather than a sort.
create index if not exists cars_public_created_idx
  on public.cars (created_at desc)
  where is_public;

create index if not exists activity_posts_published_idx
  on public.activity_posts (published_at desc)
  where published_at is not null;

create index if not exists listings_active_created_idx
  on public.listings (created_at desc)
  where status = 'active';
