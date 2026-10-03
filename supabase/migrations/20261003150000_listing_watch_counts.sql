-- 20261003150000 — buyers see how many people watch a part, never who (R2-09).
--
-- The listing page and cards show "N watching", but `saves` RLS lets only the
-- saver and the listing's seller read a listing's save rows. Everyone else
-- counted their way to 0, so the line never appeared for a buyer, and widening
-- `saves` to make it work would expose who saved what.
--
-- listing_watch_counts(p_listings) returns (listing_id, watchers) — a number,
-- never a saver — for each requested listing the caller can see. Visibility
-- mirrors the listings read policies exactly: the permissive "active listings
-- readable" (active/reserved/sold from an unsuspended seller, the seller
-- themself, an admin) AND the restrictive "suspended listing visibility"
-- (seller is the caller or their profile is visible). A listing the caller
-- can't see is simply absent — so absent means "no answer", 0 means "nobody",
-- and the client keeps those apart. At most 200 ids per call.
--
-- SECURITY DEFINER only to count rows the caller can't read; it returns
-- nothing else. feed_hydration now takes its watch_count from it, otherwise
-- unchanged from 20260928170000.
--
-- Idempotent: create or replace.

begin;

create or replace function public.listing_watch_counts(p_listings uuid[])
returns table(listing_id uuid, watchers integer)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if cardinality(coalesce(p_listings, '{}')) > 200 then
    raise exception 'At most 200 listings per call' using errcode = '22023';
  end if;
  return query
  select l.id,
         (select count(*)::integer from public.saves s
           where s.target_type = 'listing' and s.target_id = l.id)
  from public.listings l
  where l.id = any(coalesce(p_listings, '{}'))
    and (
      l.seller_id = auth.uid()
      or (
        public.profile_is_visible(l.seller_id)
        and (
          (l.status in ('active', 'reserved', 'sold') and not public.is_suspended(l.seller_id))
          or public.is_admin()
        )
      )
    );
end;
$$;

revoke all on function public.listing_watch_counts(uuid[]) from public;
grant execute on function public.listing_watch_counts(uuid[]) to anon, authenticated, service_role;

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
    where p.id = any(coalesce(p_post_ids, '{}'))
  ),
  page_cars as (
    select c.id, c.slug, c.name, c.make, c.model, c.year, c.cover_image_url, c.owner_id, c.created_at
    from public.cars c
    where c.id = any(coalesce(p_car_ids, '{}'))
  ),
  page_listings as (
    select l.id, l.title, l.price_cents, l.shipping_cents, l.condition, l.grade, l.location,
           l.part_number, l.seller_id, l.source_car_id, l.created_at
    from public.listings l
    where l.id = any(coalesce(p_listing_ids, '{}'))
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
             where lk.target_id in (select id from liked_ids)
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
      where lk.user_id = (select id from viewer) and lk.target_id in (select id from liked_ids)), '[]'::jsonb)
  );
$function$;

notify pgrst, 'reload schema';

commit;
