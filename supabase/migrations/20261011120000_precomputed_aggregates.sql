-- Totals and rankings read from small tables, not computed per request; the
-- Explore cards and wall at volume.
--
-- WHAT PAGES SHOW DOES NOT CHANGE, except that the totals and rankings below
-- can be up to a minute (counts) or ten minutes (rankings) behind — the app
-- already caches the counts for a minute and trending for five.
-- supabase/tests/precomputed_aggregates_guard.sql holds each table to the
-- function it replaces, and the cards to their old answer.
--
-- 1. Marketplace totals. Category, brand and condition counts grouped every
--    part for sale on each view: at 600,000 parts, 190-220 ms each, growing
--    with the catalogue. marketplace_facet_counts holds them, refreshed every
--    minute by pg_cron in one pass (grouping sets) over the parts for sale.
--    The counts are what a signed-out visitor sees, as they always were (the
--    app asks them signed out): parts for sale whose seller isn't suspended.
--
-- 2. Explore rankings. trending_models and suggested_builders grouped every
--    recent update (and, for builders, every public car) on each view: 1.2 s
--    and a timeout at 600,000 parts. explore_trending_models and
--    explore_builder_rankings hold them, refreshed every ten minutes and
--    every hour. The
--    functions keep their arguments and answers; a request the table can't
--    answer (another trending window; no refresh yet) is computed live.
--
-- 3. Explore cards. feed_hydration asked for "the posts whose id is in this
--    list" in a form the planner, planning the function once for any list,
--    answered by reading every published update and every part (at 600,000
--    parts it timed out — every Explore page failed). It now asks
--    "id in (the list)", which is answered from the primary keys whatever
--    the list. Likes are read through their index (target type and id): a
--    like is only ever on a part or a car (likes_target_type_check), so the
--    answer is the same.
--
-- 4. The Explore wall reads from where the last page ended: feed_event_page
--    takes the last item shown (p_before_at, p_before_id). Skipping
--    (p_offset) still works for older callers.
--
-- All tables here are readable by anyone and hold only what the pages
-- already show: totals, ids, counts. Only the refresh functions write them;
-- they are SECURITY DEFINER and callable by no client.

-- ── 1. Marketplace totals ────────────────────────────────────────────────

create table if not exists public.marketplace_facet_counts (
  facet text not null check (facet in ('category', 'brand', 'condition')),
  key text not null,
  subkey text not null default '',
  total bigint not null,
  primary key (facet, key, subkey)
);
alter table public.marketplace_facet_counts enable row level security;
revoke all on table public.marketplace_facet_counts from public, anon, authenticated;
grant select on table public.marketplace_facet_counts to anon, authenticated;
grant all on table public.marketplace_facet_counts to service_role;
drop policy if exists "facet counts are public" on public.marketplace_facet_counts;
create policy "facet counts are public" on public.marketplace_facet_counts for select to anon, authenticated using (true);

-- The refreshes read these instead of the tables: each is a compact index
-- that stays in memory, read without visiting the rows (an index-only
-- scan). Without them, at 2M parts the minute's totals read every part for
-- sale from disk (47 s) and trending every recent update (minutes).
create index if not exists listings_active_facets_idx
  on public.listings (category, subcategory, brand, condition) include (seller_id) where status = 'active';
create index if not exists activity_posts_published_car_idx
  on public.activity_posts (published_at, car_id) where published_at is not null;
create index if not exists activity_posts_car_published_idx
  on public.activity_posts (car_id, published_at desc, id desc) where published_at is not null;

create or replace function public.refresh_marketplace_facet_counts()
returns void
language sql
security definer
set search_path to 'public', 'pg_temp'
as $function$
  with fresh as (
    select case when grouping(l.category) = 0 then 'category' when grouping(l.brand) = 0 then 'brand' else 'condition' end as facet,
           coalesce(l.category, l.brand, l.condition) as key,
           coalesce(l.subcategory, '') as subkey,
           count(*) as total
    from public.listings l
    where l.status = 'active' and l.seller_id not in (select public.suspended_profile_ids())
    group by grouping sets ((l.category, l.subcategory), (l.brand), (l.condition))
    having (grouping(l.category) = 0) or (grouping(l.brand) = 0 and l.brand is not null)
        or (grouping(l.condition) = 0 and l.condition is not null)
  ),
  gone as (
    delete from public.marketplace_facet_counts t
    where not exists (select 1 from fresh f where f.facet = t.facet and f.key = t.key and f.subkey = t.subkey)
  )
  insert into public.marketplace_facet_counts (facet, key, subkey, total)
  select facet, key, subkey, total from fresh
  on conflict (facet, key, subkey) do update set total = excluded.total
  where public.marketplace_facet_counts.total is distinct from excluded.total;
$function$;
revoke all on function public.refresh_marketplace_facet_counts() from public, anon, authenticated;

-- Same names, same answers, read from the table.
create or replace function public.marketplace_category_counts()
returns table(category text, subcategory text, total bigint)
language sql
stable
set search_path to 'public', 'pg_temp'
as $function$
  select f.key, nullif(f.subkey, ''), f.total
  from public.marketplace_facet_counts f where f.facet = 'category';
$function$;

create or replace function public.marketplace_brand_counts()
returns table(brand text, total bigint)
language sql
stable
set search_path to 'public', 'pg_temp'
as $function$
  select f.key, f.total
  from public.marketplace_facet_counts f where f.facet = 'brand'
  order by f.total desc, f.key;
$function$;

-- ── 2. Explore rankings ──────────────────────────────────────────────────

create table if not exists public.explore_trending_models (
  rank integer primary key,
  make text not null,
  model text not null,
  builds bigint not null,
  updates bigint not null,
  catalog_make_id bigint,
  catalog_model_id bigint
);
create table if not exists public.explore_builder_rankings (
  rank integer primary key,
  profile_id uuid not null unique,
  car_count bigint not null,
  update_count bigint not null
);
alter table public.explore_trending_models enable row level security;
alter table public.explore_builder_rankings enable row level security;
revoke all on table public.explore_trending_models, public.explore_builder_rankings from public, anon, authenticated;
grant select on table public.explore_trending_models, public.explore_builder_rankings to anon, authenticated;
grant all on table public.explore_trending_models, public.explore_builder_rankings to service_role;
drop policy if exists "trending is public" on public.explore_trending_models;
create policy "trending is public" on public.explore_trending_models for select to anon, authenticated using (true);
drop policy if exists "builder rankings are public" on public.explore_builder_rankings;
create policy "builder rankings are public" on public.explore_builder_rankings for select to anon, authenticated using (true);

-- The live answer, as trending_models computed it (20260928182100), with the
-- signed-out visitor's read rule written in: it ran under row security as a
-- visitor (public cars of members who aren't suspended, published updates on
-- them), and the refresh below runs with the owner's rights, which skip row
-- security. Also the answer for a window the table doesn't hold.
create or replace function public.trending_models_live(p_days integer, p_limit integer)
returns table(make text, model text, builds bigint, updates bigint, catalog_make_id bigint, catalog_model_id bigint)
language sql
stable
set search_path to 'public', 'pg_temp'
as $function$
  -- count(*) is count(a.id) (every joined update has an id) and can be
  -- answered from activity_posts_published_car_idx without reading updates.
  select c.make, c.model, count(distinct c.id), count(*), min(c.catalog_make_id), min(c.catalog_model_id)
  from public.cars c
  join public.activity_posts a
    on a.car_id = c.id
   and a.published_at is not null
   and a.published_at > now() - make_interval(days => greatest(1, least(p_days, 365)))
  where c.is_public
    and c.owner_id not in (select public.suspended_profile_ids())
    and c.make is not null
    and c.model is not null
  group by c.make, c.model
  order by count(*) desc, count(distinct c.id) desc, c.make, c.model
  limit greatest(1, least(p_limit, 24));
$function$;
revoke all on function public.trending_models_live(integer, integer) from public;
grant execute on function public.trending_models_live(integer, integer) to anon, authenticated, service_role;

create or replace function public.refresh_explore_trending()
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  delete from public.explore_trending_models;
  insert into public.explore_trending_models (rank, make, model, builds, updates, catalog_make_id, catalog_model_id)
  select row_number() over (), t.* from public.trending_models_live(45, 24) t;
end;
$function$;
revoke all on function public.refresh_explore_trending() from public, anon, authenticated;

create or replace function public.refresh_explore_builders()
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  -- Every eligible builder's public cars (with a cover) and the published
  -- updates on them; each update is on one car, so counting the updates
  -- per owner equals the old count(distinct). Updates are counted per car
  -- in one pass, not looked up car by car (at 2M parts that was 3.6M reads
  -- from disk). The top 2,000, so a member who follows many builders still
  -- gets a full list.
  delete from public.explore_builder_rankings;
  insert into public.explore_builder_rankings (rank, profile_id, car_count, update_count)
  select row_number() over (order by s.car_count desc, s.update_count desc, s.owner_id), s.owner_id, s.car_count, s.update_count
  from (
    select c.owner_id, count(*) as car_count, coalesce(sum(u.n), 0)::bigint as update_count
    from public.cars c
    join public.profiles p on p.id = c.owner_id
    left join (select a.car_id, count(*) as n from public.activity_posts a
                where a.published_at is not null group by a.car_id) u on u.car_id = c.id
    -- Suspension is checked when the list is read, so a member who is
    -- suspended and restored keeps their place.
    where c.is_public and c.cover_image_url is not null and p.username is not null
    group by c.owner_id
  ) s
  order by s.car_count desc, s.update_count desc, s.owner_id
  limit 2000;
end;
$function$;
revoke all on function public.refresh_explore_builders() from public, anon, authenticated;

create or replace function public.refresh_explore_rankings()
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  perform public.refresh_explore_trending();
  perform public.refresh_explore_builders();
end;
$function$;
revoke all on function public.refresh_explore_rankings() from public, anon, authenticated;

create or replace function public.trending_models(p_days integer default 45, p_limit integer default 12)
returns table(make text, model text, builds bigint, updates bigint, catalog_make_id bigint, catalog_model_id bigint)
language plpgsql
stable
set search_path to 'public', 'pg_temp'
as $function$
begin
  if greatest(1, least(p_days, 365)) = 45 and exists (select 1 from public.explore_trending_models) then
    return query
      select t.make, t.model, t.builds, t.updates, t.catalog_make_id, t.catalog_model_id
      from public.explore_trending_models t
      order by t.rank
      limit greatest(1, least(p_limit, 24));
  else
    return query select * from public.trending_models_live(p_days, p_limit);
  end if;
end;
$function$;

create or replace function public.suggested_builders(p_viewer uuid default null, p_limit integer default 6)
returns table(id uuid, username text, display_name text, avatar_url text, headline text, car_count bigint, update_count bigint)
language plpgsql
stable
set search_path to 'public', 'pg_temp'
as $function$
begin
  if not exists (select 1 from public.explore_builder_rankings) then
    -- Not refreshed yet: the old live answer.
    return query
      select p.id, p.username, p.display_name, p.avatar_url, p.headline,
             count(distinct c.id), count(distinct a.id)
      from public.profiles p
      join public.cars c on c.owner_id = p.id and c.is_public and c.cover_image_url is not null
      left join public.activity_posts a on a.car_id = c.id and a.published_at is not null
      where p.username is not null
        and public.profile_is_visible(p.id)
        and (p_viewer is null or p.id <> p_viewer)
        and not exists (select 1 from public.follows f
                         where p_viewer is not null and f.follower_id = p_viewer
                           and f.target_type = 'profile' and f.target_id = p.id)
      group by p.id, p.username, p.display_name, p.avatar_url, p.headline
      order by count(distinct c.id) desc, count(distinct a.id) desc, p.id
      limit greatest(1, least(p_limit, 24));
    return;
  end if;
  -- Names, pictures and suspension are read now; only the counts are stored.
  return query
    select p.id, p.username, p.display_name, p.avatar_url, p.headline, r.car_count, r.update_count
    from public.explore_builder_rankings r
    join public.profiles p on p.id = r.profile_id
    where p.username is not null
      and p.id not in (select public.suspended_profile_ids())
      and (p_viewer is null or p.id <> p_viewer)
      and not exists (select 1 from public.follows f
                       where p_viewer is not null and f.follower_id = p_viewer
                         and f.target_type = 'profile' and f.target_id = p.id)
    order by r.rank
    limit greatest(1, least(p_limit, 24));
end;
$function$;

-- ── 3. Explore cards ─────────────────────────────────────────────────────
-- Restated from its latest definition (20261003150000); the only changes are
-- the three "id in (the list)" lookups and the two likes reads (see the
-- header).

CREATE OR REPLACE FUNCTION public.feed_hydration(p_post_ids uuid[], p_car_ids uuid[], p_listing_ids uuid[], p_viewer uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  with
  viewer as (
    select case when p_viewer is not null and p_viewer = auth.uid() then p_viewer end as id
  ),
  page_posts as (
    select p.id, p.title, p.intro, p.car_id, p.author_id, p.published_at, p.body
    from public.activity_posts p
    where p.id in (select unnest(coalesce(p_post_ids, '{}'::uuid[])))
  ),
  page_cars as (
    select c.id, c.slug, c.name, c.make, c.model, c.year, c.cover_image_url, c.owner_id, c.created_at
    from public.cars c
    where c.id in (select unnest(coalesce(p_car_ids, '{}'::uuid[])))
  ),
  page_listings as (
    select l.id, l.title, l.price_cents, l.shipping_cents, l.condition, l.grade, l.location,
           l.part_number, l.seller_id, l.source_car_id, l.created_at
    from public.listings l
    where l.id in (select unnest(coalesce(p_listing_ids, '{}'::uuid[])))
  ),
  owner_ids as (
    select owner_id as id from page_cars
    union select author_id from page_posts
    union select seller_id from page_listings
  ),
  liked_ids as (
    select unnest(coalesce(p_listing_ids, '{}') || coalesce(p_car_ids, '{}')) as id
  )
  select jsonb_build_object(
    'posts', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id, 'title', p.title, 'intro', p.intro, 'car_id', p.car_id,
        'author_id', p.author_id, 'published_at', p.published_at, 'body', p.body,
        'cover_url', (select i.url from public.activity_images i where i.post_id = p.id order by i.position limit 1),
        'image_count', (select count(*) from public.activity_images i where i.post_id = p.id),
        'reactions', (select count(*) from public.activity_reactions r where r.post_id = p.id and r.emoji = '🔥'),
        'comments', (select count(*) from public.activity_comments c where c.post_id = p.id)
      )) from page_posts p), '[]'::jsonb),

    'cars', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id, 'slug', c.slug, 'name', c.name, 'make', c.make, 'model', c.model, 'year', c.year,
        'cover_image_url', c.cover_image_url, 'owner_id', c.owner_id, 'created_at', c.created_at,
        'update_count', (select count(*) from public.activity_posts a
                          where a.car_id = c.id and a.published_at is not null),
        'last_activity_at', (select max(a.published_at) from public.activity_posts a
                              where a.car_id = c.id and a.published_at is not null),
        'for_sale_count', (select count(*) from public.listings l
                            where l.source_car_id = c.id and l.status = 'active')
      )) from page_cars c), '[]'::jsonb),

    'listings', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', l.id, 'title', l.title, 'price_cents', l.price_cents, 'shipping_cents', l.shipping_cents,
        'condition', l.condition, 'grade', l.grade, 'location', l.location, 'part_number', l.part_number,
        'seller_id', l.seller_id, 'source_car_id', l.source_car_id, 'created_at', l.created_at,
        'cover_url', (select i.url from public.listing_images i where i.listing_id = l.id order by i.position limit 1),
        'watch_count', (select w.watchers from public.listing_watch_counts(array[l.id]) w),
        'question_count', (select count(*) from public.listing_questions q where q.listing_id = l.id)
      )) from page_listings l), '[]'::jsonb),

    -- The car of each post: names the build, lends its cover, and is the
    -- visibility gate (a post on a car the caller can't see is dropped).
    'post_cars', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id, 'slug', c.slug, 'name', c.name, 'year', c.year, 'make', c.make, 'model', c.model,
        'is_public', c.is_public, 'cover_image_url', c.cover_image_url
      )) from public.cars c
      where c.id in (select car_id from page_posts where car_id is not null)), '[]'::jsonb),

    -- The source car of each part: the provenance line and fitment source.
    'source_cars', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id, 'year', c.year, 'make', c.make, 'model', c.model, 'slug', c.slug, 'is_public', c.is_public
      )) from public.cars c
      where c.id in (select source_car_id from page_listings where source_car_id is not null)), '[]'::jsonb),

    'owners', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', pr.id, 'display_name', pr.display_name, 'username', pr.username, 'avatar_url', pr.avatar_url
      )) from public.profiles pr where pr.id in (select id from owner_ids)), '[]'::jsonb),

    -- Public like counts over the page's listings and cars (0037).
    'likes', coalesce((
      select jsonb_agg(jsonb_build_object('target_type', k.target_type, 'target_id', k.target_id, 'count', k.n))
      from (select lk.target_type, lk.target_id, count(*) as n
              from public.likes lk
             where lk.target_type in ('listing', 'car') and lk.target_id in (select id from liked_ids)
             group by lk.target_type, lk.target_id) k), '[]'::jsonb),

    -- The viewer's garage, for "Fits your <car>" hints.
    'garage', coalesce((
      select jsonb_agg(jsonb_build_object('name', c.name, 'make', c.make, 'model', c.model))
      from public.cars c where c.owner_id = (select id from viewer)), '[]'::jsonb),

    -- The viewer's own marks, so every card renders its toggles pre-fired.
    'viewer_saves', coalesce((
      select jsonb_agg(jsonb_build_object('target_type', s.target_type, 'target_id', s.target_id))
      from public.saves s
      where s.user_id = (select id from viewer)
        and s.target_id = any(coalesce(p_listing_ids, '{}') || coalesce(p_car_ids, '{}') || coalesce(p_post_ids, '{}'))), '[]'::jsonb),
    'viewer_reactions', coalesce((
      select jsonb_agg(r.post_id)
      from public.activity_reactions r
      where r.user_id = (select id from viewer) and r.emoji = '🔥' and r.post_id = any(coalesce(p_post_ids, '{}'))), '[]'::jsonb),
    'viewer_likes', coalesce((
      select jsonb_agg(jsonb_build_object('target_type', lk.target_type, 'target_id', lk.target_id))
      from public.likes lk
      where lk.user_id = (select id from viewer) and lk.target_type in ('listing', 'car') and lk.target_id in (select id from liked_ids)), '[]'::jsonb)
  );
$function$;

-- ── 4. The Explore wall, from where the last page ended ──────────────────

drop function if exists public.feed_event_page(text[], integer, integer, uuid);
create or replace function public.feed_event_page(
  p_kinds text[], p_limit integer, p_offset integer default 0, p_exclude_owner uuid default null,
  p_before_at timestamptz default null, p_before_id uuid default null)
returns table(kind text, id uuid, happened_at timestamptz)
language sql
stable
set search_path to 'public', 'pg_temp'
as $function$
  -- Without a position the comparison is with "the end of time": every row.
  -- Written as one row comparison either way, so it is always a range read
  -- of the index rather than a filter.
  select e.kind, e.id, e.happened_at from (
    (select 'car'::text as kind, c.id, c.created_at as happened_at
       from public.cars c
      where 'car' = any(p_kinds) and c.is_public
        and (p_exclude_owner is null or c.owner_id <> p_exclude_owner)
        and (c.created_at, c.id) < (coalesce(p_before_at, 'infinity'::timestamptz), coalesce(p_before_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid))
      order by c.created_at desc, c.id desc
      limit greatest(0, least(p_limit, 200)) + greatest(0, p_offset))
    union all
    (select 'update'::text, p.id, p.published_at
       from public.activity_posts p
      where 'update' = any(p_kinds) and p.published_at is not null
        -- A scalar lookup per row read, not EXISTS: the planner answers EXISTS
        -- by loading every public car first, which costs more than the page.
        and (p.car_id is null or coalesce((select c.is_public from public.cars c where c.id = p.car_id), false))
        and (p_exclude_owner is null or p.author_id <> p_exclude_owner)
        and (p.published_at, p.id) < (coalesce(p_before_at, 'infinity'::timestamptz), coalesce(p_before_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid))
      order by p.published_at desc, p.id desc
      limit greatest(0, least(p_limit, 200)) + greatest(0, p_offset))
    union all
    (select 'part'::text, l.id, l.created_at
       from public.listings l
      where 'part' = any(p_kinds) and l.status = 'active'
        and (p_exclude_owner is null or l.seller_id <> p_exclude_owner)
        and (l.created_at, l.id) < (coalesce(p_before_at, 'infinity'::timestamptz), coalesce(p_before_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid))
      order by l.created_at desc, l.id desc
      limit greatest(0, least(p_limit, 200)) + greatest(0, p_offset))
  ) e
  order by e.happened_at desc, e.id desc
  limit greatest(0, least(p_limit, 200)) offset greatest(0, p_offset);
$function$;
revoke all on function public.feed_event_page(text[], integer, integer, uuid, timestamptz, uuid) from public;
grant execute on function public.feed_event_page(text[], integer, integer, uuid, timestamptz, uuid) to anon, authenticated, service_role;


-- ── 5. Explore's Updates, filtered by vehicle or year ────────────────────
-- explore_update_rows answers "updates on public cars of this make and
-- model, newest first" by joining every such car to every update and
-- sorting them: at 2M parts it timed out for the commonest model, and it
-- carries its search arm even with no words. explore_update_page answers it
-- one page at a time, from where the last page ended, planned with the
-- shopper's choices written in: for a vehicle with few public cars it reads
-- each car's newest updates and merges them; for a common one it reads
-- updates newest first and checks each one's car by key. Same rows as
-- explore_update_rows with no words (precomputed_aggregates_guard.sql);
-- ties on the exact same time now break by id descending, like the wall.
--
-- Cars matched by name (the ones with no catalogue ids) are found through
-- lower-cased copies of make and model. lower() is not "leakproof", so
-- under row security "lower(make) = 'bmw'" cannot use an index and every
-- public car was read (90-370 ms at 2M parts); "make_key = 'bmw'" is plain
-- equality and can. The copies are generated by the database and readable
-- like make and model. explore_build_rows returns whole car rows, so it is
-- restated with them.
alter table public.cars add column if not exists make_key text generated always as (lower(make)) stored;
alter table public.cars add column if not exists model_key text generated always as (lower(model)) stored;
grant select (make_key, model_key) on public.cars to anon, authenticated;
create index if not exists cars_catalog_model_idx on public.cars (catalog_model_id) where is_public;
create index if not exists cars_catalog_make_idx on public.cars (catalog_make_id) where is_public;
create index if not exists cars_make_model_key_idx on public.cars (make_key, model_key) where is_public;

create or replace function public.explore_build_rows(p_query text)
returns setof public.cars
language sql
stable
as $function$
 select c.id, c.owner_id, c.slug, c.name, c.make, c.model, c.year, c.color, c.about, c.tags,
        c.cover_image_url, c.is_public, c.created_at, c.updated_at, null::text as vin, c.trim,
        c.engine, c.drivetrain, c.body_class, c.vin_decoded_at, c.catalog_make_id, c.catalog_model_id,
        c.identity_source, c.cover_focal_x, c.cover_focal_y, c.make_key, c.model_key
 from public.search_car_ids(p_query) with ordinality ranked(id,rank)
 join public.cars c on c.id=ranked.id where c.is_public order by ranked.rank,c.id;
$function$;

create or replace function public.explore_update_page(
  p_make text default '', p_model text default '', p_make_id integer default 0, p_model_id integer default 0,
  p_ymin integer default 0, p_ymax integer default 9999,
  p_before_at timestamptz default null, p_before_id uuid default null,
  p_offset integer default 0, p_limit integer default 25,
  -- Up to this many matching public cars, read car by car; more, update by
  -- update. A knob for the guard, which tries both on a small database.
  p_by_car_up_to integer default 5000)
returns setof public.activity_posts
language plpgsql
stable
set search_path to 'public', 'pg_temp'
as $function$
declare
  lim integer := least(greatest(coalesce(p_limit, 25), 1), 101);
  skip integer := least(greatest(coalesce(p_offset, 0), 0), 10000);
  car_rule text := 'c.is_public';
  keyset text := '';
  cars integer;
begin
  -- explore_update_rows' vehicle and year rules, with the values written in.
  if coalesce(p_make, '') <> '' then
    car_rule := car_rule || ' and (' || case when coalesce(p_model_id, 0) <> 0
        then format('c.catalog_model_id = %s', p_model_id) else format('c.catalog_make_id = %s', coalesce(p_make_id, 0)) end
      || format(' or (c.make_key = %L%s))', lower(p_make),
           case when coalesce(p_model, '') <> '' then format(' and c.model_key = %L', lower(p_model)) else '' end);
  end if;
  if not (coalesce(p_ymin, 0) = 0 and coalesce(p_ymax, 9999) = 9999) then
    car_rule := car_rule || format(' and c.year between %s and %s', coalesce(p_ymin, 0), coalesce(p_ymax, 9999));
  end if;
  if p_before_at is not null and p_before_id is not null then
    keyset := format(' and (p.published_at, p.id) < (%L::timestamptz, %L::uuid)', p_before_at, p_before_id);
  end if;

  execute format('select count(*) from (select 1 from public.cars c where %s limit %s) s', car_rule, greatest(coalesce(p_by_car_up_to, 5000), 0) + 1) into cars;
  if cars <= greatest(coalesce(p_by_car_up_to, 5000), 0) then
    return query execute format(
      'select p.* from public.cars c cross join lateral ('
      '  select p.* from public.activity_posts p where p.car_id = c.id and p.published_at is not null%s'
      '  order by p.published_at desc, p.id desc limit %s) p'
      ' where %s order by p.published_at desc, p.id desc limit %s offset %s',
      keyset, lim + skip, car_rule, lim, skip);
  else
    return query execute format(
      'select p.* from public.activity_posts p where p.published_at is not null%s'
      ' and coalesce((select %s from public.cars c where c.id = p.car_id), false)'
      ' order by p.published_at desc, p.id desc limit %s offset %s',
      keyset, car_rule, lim, skip);
  end if;
end;
$function$;
revoke all on function public.explore_update_page(text,text,integer,integer,integer,integer,timestamptz,uuid,integer,integer,integer) from public;
grant execute on function public.explore_update_page(text,text,integer,integer,integer,integer,timestamptz,uuid,integer,integer,integer) to anon, authenticated, service_role;

-- ── Fill the tables, and keep them filled ────────────────────────────────

select public.refresh_marketplace_facet_counts();
select public.refresh_explore_rankings();

do $$
declare
  j record;
begin
  for j in select jobid from cron.job
           where jobname in ('drvn-marketplace-counts', 'drvn-explore-rankings', 'drvn-explore-trending', 'drvn-explore-builders') loop
    perform cron.unschedule(j.jobid);
  end loop;
end $$;
-- Totals every minute; trending every ten (the app caches it for five);
-- builders, which change slowly and cost a pass over every update, hourly.
select cron.schedule('drvn-marketplace-counts', '* * * * *', $job$select public.refresh_marketplace_facet_counts();$job$);
select cron.schedule('drvn-explore-trending', '*/10 * * * *', $job$select public.refresh_explore_trending();$job$);
select cron.schedule('drvn-explore-builders', '7 * * * *', $job$select public.refresh_explore_builders();$job$);
