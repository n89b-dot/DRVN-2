-- 20260919198000: a post without a car reaches people (WS14b, W-5).
--
-- 197000 made `activity_posts.car_id` nullable, so a post can now be about a
-- part alone. Everything that finds or announces a post, though, was written
-- when every post had a car, and each of those places joins `cars` INNER —
-- so a carless post silently vanishes from Explore, from search, and from
-- its author's notifications. That is worse than refusing the post: the
-- member sees it publish and then hears nothing.
--
-- Five readers, one shared idea: the car is optional; a post's visibility is
-- its own `published_at` plus, when it HAS a car, that car being public.
--
-- `feed_events` also gains `owner_id` here, because Local (H-2) has to ask
-- "whose is this" of the feed and a second view would drift from this one.

begin;

-- ============================================================
-- The SQL twin of src/lib/activity/href.ts
-- ============================================================
-- Three notification functions built this string by hand. They now ask one
-- function, so a carless post can never produce `/cars//activity/<id>`.
create or replace function public.post_href(p_post_id uuid)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case
           when c.slug is null then '/posts/' || p.id
           else '/cars/' || c.slug || '/activity/' || p.id
         end
  from public.activity_posts p
  left join public.cars c on c.id = p.car_id
  where p.id = p_post_id;
$$;

comment on function public.post_href(uuid) is
  'Where a post lives — /cars/{slug}/activity/{id}, or /posts/{id} with no car. Twin of postHref() in src/lib/activity/href.ts.';

revoke all on function public.post_href(uuid) from public;
grant execute on function public.post_href(uuid) to authenticated, service_role;

-- ============================================================
-- Notifications: save, comment, reaction
-- ============================================================
-- Each kept its own inner join to cars. The author lookup now stands on the
-- post alone; the href comes from post_href.
create or replace function public.notify_on_save()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
  v_href text;
  v_title text;
  v_kind text := 'save';
  -- A saved *part* is market interest, not someone admiring your build. The PRD
  -- keeps the two columns separate, and the two have different preferences.
  v_section text := 'engagement';
begin
  if new.target_type = 'car' then
    select c.owner_id, '/cars/' || c.slug into v_owner, v_href
    from public.cars c where c.id = new.target_id;
    v_title := public.actor_name(new.user_id) || ' saved your build';
  elsif new.target_type = 'listing' then
    select l.seller_id, '/listings/' || l.id into v_owner, v_href
    from public.listings l where l.id = new.target_id;
    v_title := public.actor_name(new.user_id) || ' saved your part';
    v_kind := 'listing_save';
    v_section := 'marketplace';
  elsif new.target_type = 'post' then
    select p.author_id, public.post_href(p.id)
      into v_owner, v_href
    from public.activity_posts p
    where p.id = new.target_id;
    v_title := public.actor_name(new.user_id) || ' saved your update';
  elsif new.target_type = 'profile' then
    v_owner := new.target_id;
    v_title := public.actor_name(new.user_id) || ' saved your profile';
    select '/u/' || username into v_href from public.profiles where id = new.user_id;
  end if;

  -- Unknown target or vanished owner: the save still stands, silently.
  if v_owner is not null then
    perform public.notify(v_owner, v_kind, v_section, v_title, null, v_href, new.user_id);
  end if;
  return new;
end;
$$;

create or replace function public.notify_on_activity_comment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_author uuid;
  v_href text;
begin
  select p.author_id, public.post_href(p.id)
  into v_author, v_href
  from public.activity_posts p
  where p.id = new.post_id;

  perform public.notify(
    v_author, 'comment', 'engagement',
    public.actor_name(new.author_id) || ' commented on your update',
    left(new.body, 140), v_href, new.author_id
  );
  return new;
end;
$$;

create or replace function public.notify_on_activity_reaction()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_author uuid;
  v_href text;
begin
  select p.author_id, public.post_href(p.id)
  into v_author, v_href
  from public.activity_posts p
  where p.id = new.post_id;

  perform public.notify(
    v_author, 'reaction', 'engagement',
    public.actor_name(new.user_id) || ' reacted ' || new.emoji,
    null, v_href, new.user_id
  );
  return new;
end;
$$;

-- ============================================================
-- feed_events — carless updates, plus owner_id for Local
-- ============================================================
-- Body copied from 0032 with two changes: the update branch's `exists` now
-- admits a null car_id, and every branch projects an owner. The view is
-- still security_invoker, so RLS decides what each caller actually sees.
create or replace view public.feed_events
  with (security_invoker = true)
as
  select
    'car'::text        as kind,
    c.id               as id,
    c.created_at       as happened_at,
    c.id               as car_id,
    c.owner_id         as owner_id
  from public.cars c
  where c.is_public

  union all

  select
    'update'::text     as kind,
    p.id               as id,
    p.published_at     as happened_at,
    p.car_id           as car_id,
    p.author_id        as owner_id
  from public.activity_posts p
  where p.published_at is not null
    and (
      p.car_id is null
      or exists (select 1 from public.cars c where c.id = p.car_id and c.is_public)
    )

  union all

  select
    'part'::text       as kind,
    l.id               as id,
    l.created_at       as happened_at,
    l.source_car_id    as car_id,
    l.seller_id        as owner_id
  from public.listings l
  where l.status = 'active';

comment on view public.feed_events is
  'Explore feed timeline: public cars, published build updates (with or without a car), active listings — one recency-ordered source (see src/lib/feed.ts).';

grant select on public.feed_events to anon, authenticated;

-- A carless post is ordered by published_at like any other; the 0032 partial
-- index already covers it.

-- ============================================================
-- Local — same change, so the two agree
-- ============================================================
create or replace function public.local_feed_rows(p_country text, p_region text default null)
returns table(kind text, id uuid, happened_at timestamptz)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select 'car'::text, c.id, c.created_at
    from public.cars c
    join public.profiles p on p.id = c.owner_id
   where c.is_public
     and p.country = p_country
     and (p_region is null or p.region = p_region)
  union all
  select 'update'::text, a.id, a.published_at
    from public.activity_posts a
    left join public.cars c on c.id = a.car_id
    join public.profiles p on p.id = a.author_id
   where a.published_at is not null
     and (a.car_id is null or c.is_public)
     and p.country = p_country
     and (p_region is null or p.region = p_region)
  union all
  select 'part'::text, l.id, l.created_at
    from public.listings l
    join public.profiles p on p.id = l.seller_id
   where l.status = 'active'
     and p.country = p_country
     and (p_region is null or p.region = p_region)
  order by 3 desc, 2 desc;
$$;

-- ============================================================
-- Search — a carless post is still findable
-- ============================================================
-- Body from 20260905135050 with the cars join made outer. The car's name,
-- make, model and year simply contribute nothing when there is no car, and
-- `title` is nullable since 194000, so it is coalesced before scoring.
create or replace function public.search_update_ids(p_query text)
returns setof uuid
language sql
stable
set search_path=public,extensions,pg_temp
as $$
  with terms as (
    select distinct t
    from regexp_split_to_table(lower(coalesce(p_query, '')), '\s+') as t
    where length(t) >= 1
  ),
  post_text as (
    select
      p.id,
      coalesce(p.title, '') as title,
      p.published_at,
      concat_ws(' ',
        p.title, p.intro, p.search_text,
        c.name, c.make, c.model, c.year::text
      ) as blob
    from public.activity_posts p
    left join public.cars c on c.id = p.car_id
    where p.published_at is not null
      and (p.car_id is null or c.is_public)
  ),
  scored as (
    select
      pt.id,
      pt.published_at,
      count(*) filter (
        where pt.blob ilike '%' || t.t || '%'
           or word_similarity(t.t, pt.title) >= 0.45
      ) as hits,
      bool_or(pt.title ilike '%' || t.t || '%') as title_hit,
      max(similarity(pt.title, lower(coalesce(p_query, '')))) as sim
    from post_text pt
    cross join terms t
    group by pt.id, pt.title, pt.published_at
  )
  select id from scored
  where hits > 0
  order by hits desc, title_hit desc, sim desc, published_at desc, id
$$;

do $$
begin
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('notify_on_save', 'notify_on_activity_comment', 'notify_on_activity_reaction')
      and pg_get_functiondef(p.oid) like '%/cars/'' || c.slug || ''/activity/%'
  ) then
    raise exception 'a notification function still hand-builds an activity href';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'feed_events' and column_name = 'owner_id'
  ) then
    raise exception 'feed_events is missing owner_id';
  end if;

  raise notice '198000 self-checks pass';
end $$;

commit;
