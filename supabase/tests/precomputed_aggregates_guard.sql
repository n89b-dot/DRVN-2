-- Totals and rankings from small tables; the Explore cards and wall at volume
-- (migration 20261011120000). Transactional; disposable local database only.
--
-- Each table is held to the function it replaced, computed the old way as a
-- signed-out visitor (and, for suggested builders, as a member who follows
-- someone): marketplace_facet_counts to the category and brand counts,
-- explore_trending_models to trending_models, explore_builder_rankings to
-- suggested_builders. feed_hydration is held to its old self card for card,
-- and the Explore wall read by position to the wall read by skipping. The
-- tables are readable and nothing a client can call writes them.
begin;

create function pg_temp.old_hydration(p_post_ids uuid[], p_car_ids uuid[], p_listing_ids uuid[], p_viewer uuid DEFAULT NULL::uuid)
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

-- The old answers, as the old functions computed them, run as the caller.
create function pg_temp.old_category_counts() returns table(category text, subcategory text, total bigint) language sql as $$
  select l.category, l.subcategory, count(*) from public.marketplace_browse_rows() l group by l.category, l.subcategory $$;
create function pg_temp.old_brand_counts() returns table(brand text, total bigint) language sql as $$
  select l.brand, count(*)::bigint from public.listings l where l.status = 'active' and l.brand is not null
  group by l.brand order by count(*) desc, l.brand $$;
create function pg_temp.old_trending(p_days int, p_limit int)
returns table(make text, model text, builds bigint, updates bigint, catalog_make_id bigint, catalog_model_id bigint) language sql as $$
  select c.make, c.model, count(distinct c.id), count(a.id), min(c.catalog_make_id), min(c.catalog_model_id)
  from public.cars c join public.activity_posts a on a.car_id = c.id and a.published_at is not null
   and a.published_at > now() - make_interval(days => greatest(1, least(p_days, 365)))
  where c.is_public and c.make is not null and c.model is not null
  group by c.make, c.model order by count(a.id) desc, count(distinct c.id) desc, c.make, c.model
  limit greatest(1, least(p_limit, 24)) $$;
create function pg_temp.old_builders(p_viewer uuid, p_limit int)
returns table(id uuid, username text, display_name text, avatar_url text, headline text, car_count bigint, update_count bigint) language sql as $$
  select p.id, p.username, p.display_name, p.avatar_url, p.headline, count(distinct c.id), count(distinct a.id)
  from public.profiles p
  join public.cars c on c.owner_id = p.id and c.is_public and c.cover_image_url is not null
  left join public.activity_posts a on a.car_id = c.id and a.published_at is not null
  where p.username is not null and public.profile_is_visible(p.id) and (p_viewer is null or p.id <> p_viewer)
    and not exists (select 1 from public.follows f where p_viewer is not null and f.follower_id = p_viewer
                     and f.target_type = 'profile' and f.target_id = p.id)
  group by p.id, p.username, p.display_name, p.avatar_url, p.headline
  order by count(distinct c.id) desc, count(distinct a.id) desc, p.id
  limit greatest(1, least(p_limit, 24)) $$;
-- jsonb arrays compared as sets: aggregation order was never part of the answer.
create function pg_temp.normal(j jsonb) returns jsonb language sql as $$
  select jsonb_object_agg(k, (select coalesce(jsonb_agg(e order by e::text), '[]') from jsonb_array_elements(j->k) e))
  from jsonb_object_keys(j) k $$;

do $$
declare
  u uuid[] := array(select gen_random_uuid() from generate_series(1, 8));
  car_ids uuid[] := array(select gen_random_uuid() from generate_series(1, 14));
  posts uuid[];
  parts uuid[];
  who text; viewer uuid;
  a jsonb; b jsonb;
  ids uuid[]; walk uuid[]; step record; last_at timestamptz; f record; step_count int;
  n int;
begin
  insert into auth.users(id, email) select x, 'agg-' || o || '@drvn.test' from unnest(u) with ordinality t(x, o);
  -- u[1..5] builders (u[4] suspended, u[5] without a username), u[6] a
  -- member who follows u[2], u[7] a seller, u[8] a suspended seller.
  insert into public.profiles(id, username, display_name, avatar_url)
  select x, case when o = 5 then null else 'agg_user_' || o end, 'Agg ' || o, 'https://example.test/' || o || '.jpg'
  from unnest(u) with ordinality t(x, o)
  on conflict (id) do update set username = excluded.username, display_name = excluded.display_name, avatar_url = excluded.avatar_url;
  update public.profiles set username = null where id = u[5];
  insert into public.cars(id, owner_id, slug, name, make, model, year, is_public, cover_image_url, catalog_make_id, catalog_model_id)
  select car_ids[o], u[case when o <= 4 then 1 when o <= 7 then 2 when o <= 9 then 3 when o <= 11 then 4 when o <= 12 then 5 else 6 end],
         'agg-car-' || o, 'Agg car ' || o, 'Zzaggmake' || (o % 3), 'Zzaggmodel' || (o % 2), 2000 + o,
         o not in (3, 13), case when o = 2 then null else 'https://example.test/c' || o || '.jpg' end, null, null
  from generate_series(1, 14) o;
  posts := array(select gen_random_uuid() from generate_series(1, 30));
  insert into public.activity_posts(id, car_id, author_id, title, body, published_at, draft_archived_at)
  select posts[o], car_ids[1 + o % 14], (select owner_id from public.cars where id = car_ids[1 + o % 14]),
         'Agg post ' || o, '{"type":"doc","content":[]}'::jsonb,
         case when o % 7 = 0 then null when o % 5 = 0 then now() - interval '90 days' else now() - o * interval '1 day' end,
         case when o % 7 = 0 then now() end
  from generate_series(1, 30) o;
  parts := array(select gen_random_uuid() from generate_series(1, 12));
  insert into public.listings(id, seller_id, source_car_id, title, category, subcategory, condition, price_cents, currency, status, brand)
  select parts[o], case when o = 12 then u[8] else u[7] end, null, 'Agg part ' || o,
         (array['engine','performance'])[1 + o % 2], case when o % 3 = 0 then null when o % 2 = 0 then 'internals' else 'exhaust' end,
         (array['new','used',null])[1 + o % 3], 1000 + o, 'USD', case when o = 11 then 'draft' else 'active' end,
         (array['Zzaggbrand','Zzaggother',null])[1 + o % 3]
  from generate_series(1, 12) o;
  insert into public.follows(follower_id, target_type, target_id) values (u[6], 'profile', u[2]);
  insert into public.likes(user_id, target_type, target_id) values (u[6], 'listing', parts[1]), (u[7], 'listing', parts[1]), (u[6], 'car', car_ids[1]);
  update public.profiles set suspended_at = now(), suspended_reason = 'guard' where id in (u[4], u[8]);

  perform public.refresh_marketplace_facet_counts();
  perform public.refresh_explore_rankings();

  perform set_config('role', 'anon', true);
  perform set_config('request.jwt.claims', '', true);

  -- 1. Marketplace totals.
  if exists (select * from public.marketplace_category_counts() except select * from pg_temp.old_category_counts())
     or exists (select * from pg_temp.old_category_counts() except select * from public.marketplace_category_counts()) then
    raise exception 'marketplace_category_counts differs from counting the parts for sale';
  end if;
  if array(select row(brand, total)::text from public.marketplace_brand_counts())
     <> array(select row(brand, total)::text from pg_temp.old_brand_counts()) then
    raise exception 'marketplace_brand_counts differs from counting the parts for sale, or its order does';
  end if;
  if not exists (select 1 from public.marketplace_brand_counts() where brand = 'Zzaggbrand') then
    raise exception 'The guard parts should appear in the brand counts';
  end if;

  -- 2. Trending, from the table and live.
  if array(select row(t.*)::text from public.trending_models(45, 10) t) <> array(select row(t.*)::text from pg_temp.old_trending(45, 10) t)
     or array(select row(t.*)::text from public.trending_models(7, 10) t) <> array(select row(t.*)::text from pg_temp.old_trending(7, 10) t) then
    raise exception 'trending_models differs from the old answer';
  end if;
  if not exists (select 1 from public.trending_models(45, 24)) then
    raise exception 'Trending should not be empty';
  end if;

  -- 3. Suggested builders, for a visitor and for a member who follows someone.
  foreach who in array array['anon', 'member'] loop
    viewer := case who when 'member' then u[6] end;
    if who = 'member' then
      perform set_config('role', 'authenticated', true);
      perform set_config('request.jwt.claims', json_build_object('sub', viewer, 'role', 'authenticated')::text, true);
    end if;
    for n in 1..3 loop
      if array(select row(b.*)::text from public.suggested_builders(viewer, n * 4) b)
         <> array(select row(b.*)::text from pg_temp.old_builders(viewer, n * 4) b) then
        raise exception 'suggested_builders(%, %) as % differs from the old answer: % vs %', viewer, n * 4, who,
          array(select b.username from public.suggested_builders(viewer, n * 4) b), array(select b.username from pg_temp.old_builders(viewer, n * 4) b);
      end if;
    end loop;
  end loop;
  if exists (select 1 from public.suggested_builders(u[6], 24) where id in (u[2], u[4], u[5], u[6])) then
    raise exception 'suggested_builders offered a followed, suspended, nameless or own profile';
  end if;

  -- 4. Cards, as a member (their own marks included) and as a visitor.
  foreach who in array array['member', 'anon'] loop
    if who = 'anon' then
      perform set_config('role', 'anon', true);
      perform set_config('request.jwt.claims', '', true);
    end if;
    a := public.feed_hydration(posts, car_ids, parts, u[6]);
    b := pg_temp.old_hydration(posts, car_ids, parts, u[6]);
    if pg_temp.normal(a) <> pg_temp.normal(b) then
      raise exception 'feed_hydration as % differs from its old answer', who;
    end if;
    if jsonb_array_length(a->'posts') = 0 or jsonb_array_length(a->'likes') = 0 then
      raise exception 'The guard cards should hydrate posts and likes';
    end if;
  end loop;

  -- 5. The wall by position equals the wall by skipping, over its first 200.
  ids := array(select e.id from public.feed_event_page(array['car','update','part'], 200, 0) e);
  walk := '{}';
  last_at := null;
  while cardinality(walk) < cardinality(ids) loop
    n := cardinality(walk);
    for step in select e.* from public.feed_event_page(array['car','update','part'], 7, 0, null, last_at, walk[cardinality(walk)]) e loop
      walk := walk || step.id;
      last_at := step.happened_at;
    end loop;
    exit when cardinality(walk) = n;
  end loop;
  if walk[1:cardinality(ids)] <> ids or cardinality(ids) < 10 then
    raise exception 'feed_event_page by position differs from by skipping (% items)', cardinality(ids);
  end if;


  -- 5b. Explore's Updates by vehicle and year: explore_update_page gives
  --     explore_update_rows' rows (no words), page by page, either way it reads.
  for f in select * from (values ('Zzaggmake1', 'Zzaggmodel1', 0, 9999), ('Zzaggmake2', '', 0, 9999), ('', '', 2003, 2010),
                                 ('Zzaggmake1', 'Zzaggmodel1', 2000, 2005)) v(mk, md, ymin, ymax) loop
    ids := array(select r.id from public.explore_update_rows('', f.mk, f.md, 0, 0, f.ymin, f.ymax) r order by r.published_at desc, r.id desc);
    foreach n in array array[0, 5000] loop
      walk := '{}'; last_at := null;
      loop
        step_count := cardinality(walk);
        for step in select e.id, e.published_at as happened_at from public.explore_update_page(f.mk, f.md, 0, 0, f.ymin, f.ymax, last_at,
                      walk[cardinality(walk)], 0, 3, n) e loop
          walk := walk || step.id; last_at := step.happened_at;
        end loop;
        exit when cardinality(walk) = step_count;
      end loop;
      if walk <> ids then
        raise exception 'explore_update_page(%, %, %-%, by car up to %) gave % updates, explore_update_rows %', f.mk, f.md, f.ymin, f.ymax, n, cardinality(walk), cardinality(ids);
      end if;
      if array(select e.id from public.explore_update_page(f.mk, f.md, 0, 0, f.ymin, f.ymax, null, null, 2, 3, n) e) <> coalesce(ids[3:5], '{}') then
        raise exception 'explore_update_page skipping two differs from explore_update_rows';
      end if;
    end loop;
  end loop;
  if cardinality(array(select r.id from public.explore_update_rows('', 'Zzaggmake1', 'Zzaggmodel1', 0, 0, 0, 9999) r)) < 2 then
    raise exception 'The guard updates should match the Zzaggmake1 filter';
  end if;

  -- 6. Readable by anyone; written by nothing a client can call.
  begin
    insert into public.marketplace_facet_counts(facet, key, total) values ('brand', 'x', 1);
    raise exception 'A visitor could write marketplace_facet_counts';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.refresh_explore_rankings();
    raise exception 'A visitor could refresh the Explore rankings';
  exception when insufficient_privilege then null;
  end;
  perform set_config('role', 'supabase_admin', true);

  -- 7. Kept filled.
  if (select count(*) from cron.job where jobname in ('drvn-marketplace-counts', 'drvn-explore-trending', 'drvn-explore-builders')) <> 3 then
    raise exception 'The refresh jobs are not scheduled';
  end if;

  raise notice 'all precomputed aggregates checks passed';
end $$;

rollback;
