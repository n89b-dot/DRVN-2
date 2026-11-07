-- 20261107180000: social retrieval at scale (OS-W22: N30, N31, N56, N60, N68).
--
-- A Supabase request returns at most 1,000 rows and says nothing when it
-- stops. Several pages counted by fetching every row and counting in the app,
-- and several "everything I follow / saved" reads put every id into one URL.
-- Past 1,000 rows the numbers were quietly short; past a few hundred ids the
-- URL was too long, the error was swallowed and the page showed empty. Every
-- function here answers in the database instead: counts are counted there,
-- relationships are joined there, and lists come back one page at a time from
-- a stable position (newest first, id breaking ties), so a page never repeats
-- or skips a row however many there are.
--
-- All of them run with the CALLER'S rights (security invoker): each answers
-- exactly what the reads it replaces answered under row-level security, only
-- complete. None returns anything those reads didn't.
--
--  1. Counts (N30)
--     listing_engagement_counts(ids)  likes and questions per part card
--     seller_review_summaries(ids)    review count and average per seller
--     post_reaction_counts(post)      reactions per emoji, and the viewer's own
--  2. Pages
--     post_comment_page(post, …)      a post's replies, newest page first, with
--                                     the author's name joined in (N56)
--     car_update_page(car, …)         a build's published updates (N60)
--     followed_feed_rows(…)           Home's Following feed, joined to the
--                                     caller's follows in the database (N31)
--     saved_counts()                  Saved's header and section totals, of
--                                     targets that still exist and the caller
--                                     can see (N31, N61)
--     saved_listing_page(…)           Saved parts: search, sort, offset page
--     saved_page(collection, …)       every other Saved section, each paged on
--                                     its own (N31, N68)
--
-- Positions are (timestamp, id) pairs. A position with either half missing
-- is no position: the first page.
--
-- Indexes: one per new page shape, each the order the page reads in. No
-- foreign key is added.

begin;

-- ── Indexes ───────────────────────────────────────────────────────────────

-- A post's replies, newest first, from a position.
create index if not exists activity_comments_post_page_idx
  on public.activity_comments (post_id, created_at desc, id desc);
-- Following feed lanes: each reads one followed thing's newest rows.
create index if not exists activity_posts_author_published_idx
  on public.activity_posts (author_id, published_at desc, id desc) where published_at is not null;
create index if not exists cars_owner_public_feed_idx
  on public.cars (owner_id, created_at desc, id desc) where is_public;
create index if not exists listings_source_car_active_feed_idx
  on public.listings (source_car_id, created_at desc, id desc) where status = 'active';
-- Saved sections: one member's saves/follows of one kind, newest first.
create index if not exists saves_user_type_page_idx
  on public.saves (user_id, target_type, created_at desc, target_id desc);
create index if not exists follows_follower_type_page_idx
  on public.follows (follower_id, target_type, created_at desc, target_id desc);

-- ── 1. Counts ─────────────────────────────────────────────────────────────

create or replace function public.listing_engagement_counts(p_listings uuid[])
returns table(listing_id uuid, likes integer, questions integer)
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $function$
begin
  if cardinality(coalesce(p_listings, '{}')) > 200 then
    raise exception 'At most 200 listings per call' using errcode = '22023';
  end if;
  return query
  select ids.id,
         (select count(*)::integer from public.likes lk
           where lk.target_type = 'listing' and lk.target_id = ids.id),
         (select count(*)::integer from public.listing_questions q
           where q.listing_id = ids.id)
  from (select distinct unnest(coalesce(p_listings, '{}')) as id) ids;
end;
$function$;

comment on function public.listing_engagement_counts(uuid[]) is
  'Likes and questions per listing, counted in the database (N30). Caller''s rights. At most 200 ids.';

create or replace function public.seller_review_summaries(p_sellers uuid[])
returns table(seller_id uuid, review_count integer, rating_avg numeric)
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $function$
begin
  if cardinality(coalesce(p_sellers, '{}')) > 200 then
    raise exception 'At most 200 sellers per call' using errcode = '22023';
  end if;
  return query
  select r.reviewee_id, count(*)::integer, avg(r.rating)::numeric
  from public.reviews r
  where r.reviewee_id = any(coalesce(p_sellers, '{}'))
  group by r.reviewee_id;
end;
$function$;

comment on function public.seller_review_summaries(uuid[]) is
  'Review count and average rating per seller, over every review (N30). A seller with none is absent. Caller''s rights. At most 200 ids.';

create or replace function public.post_reaction_counts(p_post uuid)
returns table(emoji text, total integer, reacted boolean)
language sql
stable
security invoker
set search_path = public, pg_temp
as $function$
  select r.emoji,
         count(*)::integer,
         coalesce(bool_or(r.user_id = auth.uid()), false)
  from public.activity_reactions r
  where r.post_id = p_post
  group by r.emoji;
$function$;

comment on function public.post_reaction_counts(uuid) is
  'Reactions on one post per emoji, and whether the caller is among them (N56). Never who else reacted.';

-- ── 2. Pages ──────────────────────────────────────────────────────────────

-- N56. A page of a post's replies, newest first (the caller shows them oldest
-- first), with the author's public name joined in: the old read asked for
-- every commenter's profile in one URL, and a long thread lost them all to
-- "User".
create or replace function public.post_comment_page(
  p_post uuid,
  p_limit integer default 50,
  p_before_at timestamptz default null,
  p_before_id uuid default null
)
returns table(
  id uuid,
  author_id uuid,
  body text,
  created_at timestamptz,
  author_display_name text,
  author_username text
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $function$
  select c.id, c.author_id, c.body, c.created_at, p.display_name, p.username
  from public.activity_comments c
  left join public.profiles p on p.id = c.author_id
  where c.post_id = p_post
    and (p_before_at is null or p_before_id is null
         or (c.created_at, c.id) < (p_before_at, p_before_id))
  order by c.created_at desc, c.id desc
  limit least(greatest(coalesce(p_limit, 50), 1), 101);
$function$;

comment on function public.post_comment_page(uuid, integer, timestamptz, uuid) is
  'One page of a post''s replies, newest first from a (created_at, id) position, with author names (N56). At most 101 rows.';

-- N60. A page of a build's published updates, newest first.
create or replace function public.car_update_page(
  p_car uuid,
  p_limit integer default 50,
  p_before_at timestamptz default null,
  p_before_id uuid default null
)
returns table(id uuid, title text, intro text, body jsonb, published_at timestamptz)
language sql
stable
security invoker
set search_path = public, pg_temp
as $function$
  select p.id, p.title, p.intro, p.body, p.published_at
  from public.activity_posts p
  where p.car_id = p_car
    and p.published_at is not null
    and (p_before_at is null or p_before_id is null
         or (p.published_at, p.id) < (p_before_at, p_before_id))
  order by p.published_at desc, p.id desc
  limit least(greatest(coalesce(p_limit, 50), 1), 101);
$function$;

comment on function public.car_update_page(uuid, integer, timestamptz, uuid) is
  'One page of a car''s published updates, newest first from a (published_at, id) position (N60). At most 101 rows.';

-- N31. Home's Following feed. The app used to read every follow (stopping at
-- 1,000), then put every followed id into each lane's URL. Here each lane is
-- read per followed thing off its own index, newest first, and the lanes are
-- merged in the database. A part reached two ways (its seller and the car it
-- came off are both followed) is one row. Order is the feed's own: newest,
-- then id, then kind (src/lib/feed-merge.ts); seller spacing stays in the app,
-- inside the page.
create or replace function public.followed_feed_rows(
  p_limit integer default 21,
  p_offset integer default 0,
  p_before_at timestamptz default null,
  p_before_id uuid default null
)
returns table(kind text, id uuid, happened_at timestamptz, seller_id uuid)
language sql
stable
security invoker
set search_path = public, pg_temp
as $function$
  with
  bounds as (
    select least(greatest(coalesce(p_limit, 21), 1), 101) as lim,
           least(greatest(coalesce(p_offset, 0), 0), 2000) as skip,
           (p_before_at is not null and p_before_id is not null) as positioned
  ),
  lane as (select lim + case when positioned then 0 else skip end as n from bounds),
  fc as (
    select f.target_id from public.follows f
    where f.follower_id = auth.uid() and f.target_type = 'car'
  ),
  fp as (
    select f.target_id from public.follows f
    where f.follower_id = auth.uid() and f.target_type = 'profile'
  ),
  merged as (
    select x.* from fc cross join lateral (
      select 'update'::text as kind, p.id, p.published_at as happened_at, null::uuid as seller_id
      from public.activity_posts p, bounds b
      where p.car_id = fc.target_id and p.published_at is not null
        and (not b.positioned or (p.published_at, p.id) < (p_before_at, p_before_id))
      order by p.published_at desc, p.id desc
      limit (select n from lane)
    ) x
    union
    select x.* from fp cross join lateral (
      select 'update'::text, p.id, p.published_at, null::uuid
      from public.activity_posts p, bounds b
      where p.author_id = fp.target_id and p.published_at is not null
        and (not b.positioned or (p.published_at, p.id) < (p_before_at, p_before_id))
      order by p.published_at desc, p.id desc
      limit (select n from lane)
    ) x
    union
    select x.* from fc cross join lateral (
      select 'car'::text, c.id, c.created_at, null::uuid
      from public.cars c, bounds b
      where c.id = fc.target_id and c.is_public
        and (not b.positioned or (c.created_at, c.id) < (p_before_at, p_before_id))
    ) x
    union
    select x.* from fp cross join lateral (
      select 'car'::text, c.id, c.created_at, null::uuid
      from public.cars c, bounds b
      where c.owner_id = fp.target_id and c.is_public
        and (not b.positioned or (c.created_at, c.id) < (p_before_at, p_before_id))
      order by c.created_at desc, c.id desc
      limit (select n from lane)
    ) x
    union
    select x.* from fp cross join lateral (
      select 'part'::text, l.id, l.created_at, l.seller_id
      from public.listings l, bounds b
      where l.seller_id = fp.target_id and l.status = 'active'
        and (not b.positioned or (l.created_at, l.id) < (p_before_at, p_before_id))
      order by l.created_at desc, l.id desc
      limit (select n from lane)
    ) x
    union
    select x.* from fc cross join lateral (
      select 'part'::text, l.id, l.created_at, l.seller_id
      from public.listings l, bounds b
      where l.source_car_id = fc.target_id and l.status = 'active'
        and (not b.positioned or (l.created_at, l.id) < (p_before_at, p_before_id))
      order by l.created_at desc, l.id desc
      limit (select n from lane)
    ) x
  )
  select m.kind, m.id, m.happened_at, m.seller_id
  from merged m
  order by m.happened_at desc, m.id desc, m.kind desc
  offset (select case when positioned then 0 else skip end from bounds)
  limit (select lim from bounds);
$function$;

comment on function public.followed_feed_rows(integer, integer, timestamptz, uuid) is
  'Home''s Following feed: updates, public cars and active parts from the caller''s followed cars and people, newest first, one page from a (happened_at, id) position or an offset of at most 2,000 (N31).';

-- N31 / N61. Saved's totals: only what still exists and the caller can see.
-- A save of a deleted or hidden thing is no longer counted as one.
create or replace function public.saved_counts()
returns table(
  parts integer,
  unavailable_parts integer,
  builds integer,
  posts integer,
  followed_builds integer,
  followed_sellers integer
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $function$
  select
    (select count(*)::integer from public.saves s
      where s.user_id = auth.uid() and s.target_type = 'listing'
        and exists (select 1 from public.listings l where l.id = s.target_id)),
    (select count(*)::integer from public.saves s
      where s.user_id = auth.uid() and s.target_type = 'listing'
        and not exists (select 1 from public.listings l where l.id = s.target_id)),
    (select count(*)::integer from public.saves s
      where s.user_id = auth.uid() and s.target_type = 'car'
        and exists (select 1 from public.cars c where c.id = s.target_id)),
    (select count(*)::integer from public.saves s
      where s.user_id = auth.uid() and s.target_type = 'post'
        and exists (select 1 from public.activity_posts p
                     where p.id = s.target_id and p.published_at is not null)),
    (select count(*)::integer from public.follows f
      where f.follower_id = auth.uid() and f.target_type = 'car'
        and exists (select 1 from public.cars c where c.id = f.target_id)),
    (select count(*)::integer from public.follows f
      where f.follower_id = auth.uid() and f.target_type = 'profile'
        and exists (select 1 from public.profiles pr where pr.id = f.target_id));
$function$;

comment on function public.saved_counts() is
  'The caller''s Saved totals, of targets that exist and they can see; unavailable_parts are saves of parts they no longer can (N31, N61).';

-- Saved parts: the grid's own page. Searchable by title and sorted newest or
-- by price, so it pages by offset over the caller's own saves — bounded by
-- them, whatever the catalogue holds — with a total on every row.
create or replace function public.saved_listing_page(
  p_query text default null,
  p_sort text default 'newest',
  p_limit integer default 24,
  p_offset integer default 0
)
returns table(listing_id uuid, total integer)
language sql
stable
security invoker
set search_path = public, pg_temp
as $function$
  with mine as (
    select l.id, l.created_at, l.price_cents
    from public.saves s
    join public.listings l on l.id = s.target_id
    where s.user_id = auth.uid() and s.target_type = 'listing'
      and (nullif(btrim(coalesce(p_query, '')), '') is null
           or l.title ilike '%' || replace(replace(replace(btrim(p_query), '\', '\\'), '%', '\%'), '_', '\_') || '%')
  )
  select m.id, (count(*) over ())::integer
  from mine m
  order by
    case when p_sort = 'price' then m.price_cents end asc,
    case when p_sort = 'price' then m.id end asc,
    m.created_at desc,
    m.id desc
  offset greatest(coalesce(p_offset, 0), 0)
  limit least(greatest(coalesce(p_limit, 24), 1), 100);
$function$;

comment on function public.saved_listing_page(text, text, integer, integer) is
  'One page of the caller''s saved parts they can still see, by title search, newest or price, with the total (N31).';

-- Every other Saved section, each paged on its own from a (saved_at, id)
-- position (N68: they stopped at 100 with no way on).
create or replace function public.saved_page(
  p_collection text,
  p_limit integer default 24,
  p_before_at timestamptz default null,
  p_before_id uuid default null
)
returns table(target_id uuid, saved_at timestamptz)
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $function$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 24), 1), 101);
  v_positioned boolean := p_before_at is not null and p_before_id is not null;
begin
  if p_collection = 'build' then
    return query
    select s.target_id, s.created_at from public.saves s
    where s.user_id = auth.uid() and s.target_type = 'car'
      and exists (select 1 from public.cars c where c.id = s.target_id)
      and (not v_positioned or (s.created_at, s.target_id) < (p_before_at, p_before_id))
    order by s.created_at desc, s.target_id desc limit v_limit;
  elsif p_collection = 'post' then
    return query
    select s.target_id, s.created_at from public.saves s
    where s.user_id = auth.uid() and s.target_type = 'post'
      and exists (select 1 from public.activity_posts p
                   where p.id = s.target_id and p.published_at is not null)
      and (not v_positioned or (s.created_at, s.target_id) < (p_before_at, p_before_id))
    order by s.created_at desc, s.target_id desc limit v_limit;
  elsif p_collection = 'unavailable_part' then
    return query
    select s.target_id, s.created_at from public.saves s
    where s.user_id = auth.uid() and s.target_type = 'listing'
      and not exists (select 1 from public.listings l where l.id = s.target_id)
      and (not v_positioned or (s.created_at, s.target_id) < (p_before_at, p_before_id))
    order by s.created_at desc, s.target_id desc limit v_limit;
  elsif p_collection = 'followed_build' then
    return query
    select f.target_id, f.created_at from public.follows f
    where f.follower_id = auth.uid() and f.target_type = 'car'
      and exists (select 1 from public.cars c where c.id = f.target_id)
      and (not v_positioned or (f.created_at, f.target_id) < (p_before_at, p_before_id))
    order by f.created_at desc, f.target_id desc limit v_limit;
  elsif p_collection = 'followed_seller' then
    return query
    select f.target_id, f.created_at from public.follows f
    where f.follower_id = auth.uid() and f.target_type = 'profile'
      and exists (select 1 from public.profiles pr where pr.id = f.target_id)
      and (not v_positioned or (f.created_at, f.target_id) < (p_before_at, p_before_id))
    order by f.created_at desc, f.target_id desc limit v_limit;
  else
    raise exception 'Unknown saved collection' using errcode = '22023';
  end if;
end;
$function$;

comment on function public.saved_page(text, integer, timestamptz, uuid) is
  'One page of a Saved section (build, post, unavailable_part, followed_build, followed_seller) the caller can see, newest first from a (saved_at, id) position (N68).';

-- ── Grants ────────────────────────────────────────────────────────────────

revoke all on function public.listing_engagement_counts(uuid[]) from public;
revoke all on function public.seller_review_summaries(uuid[]) from public;
revoke all on function public.post_reaction_counts(uuid) from public;
revoke all on function public.post_comment_page(uuid, integer, timestamptz, uuid) from public;
revoke all on function public.car_update_page(uuid, integer, timestamptz, uuid) from public;
revoke all on function public.followed_feed_rows(integer, integer, timestamptz, uuid) from public, anon;
revoke all on function public.saved_counts() from public, anon;
revoke all on function public.saved_listing_page(text, text, integer, integer) from public, anon;
revoke all on function public.saved_page(text, integer, timestamptz, uuid) from public, anon;

-- Public pages: anyone who can read the page.
grant execute on function public.listing_engagement_counts(uuid[]) to anon, authenticated, service_role;
grant execute on function public.seller_review_summaries(uuid[]) to anon, authenticated, service_role;
grant execute on function public.post_reaction_counts(uuid) to anon, authenticated, service_role;
grant execute on function public.post_comment_page(uuid, integer, timestamptz, uuid) to anon, authenticated, service_role;
grant execute on function public.car_update_page(uuid, integer, timestamptz, uuid) to anon, authenticated, service_role;
-- Signed-in pages: each answers only for the caller.
grant execute on function public.followed_feed_rows(integer, integer, timestamptz, uuid) to authenticated, service_role;
grant execute on function public.saved_counts() to authenticated, service_role;
grant execute on function public.saved_listing_page(text, text, integer, integer) to authenticated, service_role;
grant execute on function public.saved_page(text, integer, timestamptz, uuid) to authenticated, service_role;

notify pgrst, 'reload schema';

commit;
