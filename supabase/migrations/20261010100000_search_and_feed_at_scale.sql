-- Search, browse and the Explore wall at volume.
--
-- Measured on a disposable database seeded to about 100x the invited beta
-- (60,000 parts, 120,000 updates, 12,000 cars; scripts/perf/), through
-- PostgREST as a signed-out visitor. Before this file: Explore "search
-- updates" 123 s, "search builds" 7.6 s, marketplace text search timed out,
-- the Explore wall 0.7 s a page. Results are in
-- docs/performance/query-plans.md.
--
-- Three causes, three fixes. No function here changes WHAT is returned —
-- supabase/tests/search_at_volume_guard.sql holds each to its old answer.
--
-- 1. Search read every row. The word-matching functions compared every car,
--    update and part against every word. They now start from trigram
--    indexes over one "search document" per row and only ever read rows
--    that matched.
--
-- 2. Row security hid those indexes. A text match is not a "leakproof"
--    operator, so under row security Postgres must run the visibility rule
--    on every row BEFORE it may use a text index — which means reading every
--    row. The three id-returning search functions therefore run with the
--    definer's rights and apply the visitor's read rule themselves (public,
--    published, owner not suspended). They return ids only; every caller
--    joins those ids back to the tables under the caller's own row security.
--
-- 3. Wrappers were optimisation fences. A SQL function with a SET clause, or
--    a WITH in its body, is planned on its own: the caller's ORDER BY and
--    LIMIT apply only after it has produced every row. The row-returning
--    wrappers (browse, Explore search) lose both so the planner can read the
--    first page off an index. They are SECURITY INVOKER and every name in
--    them is schema-qualified, which is what the search_path pin protected.
--    PostgREST passes arguments as a joined row rather than literals, so an
--    "empty query OR id in (search)" clause is re-run per row; searching
--    gets its own entry points that start from the matched ids instead.

-- ── Search documents and their indexes ───────────────────────────────────

create or replace function public.listing_search_doc(p_title text, p_description text, p_compatibility_notes text, p_category text, p_brand text)
returns text language sql immutable parallel safe
as $$ select concat_ws(' ', p_title, p_description, p_compatibility_notes, p_category, p_brand) $$;

create index if not exists listings_search_doc_trgm_idx on public.listings
  using gin (public.listing_search_doc(title, description, compatibility_notes, category, brand) gin_trgm_ops);
create index if not exists listings_part_number_compact_trgm_idx on public.listings
  using gin (part_number_compact gin_trgm_ops) where part_number_compact is not null;

create or replace function public.car_search_doc(p_name text, p_make text, p_model text, p_year integer, p_tags text[], p_about text)
returns text language sql immutable parallel safe
as $$ select concat_ws(' ', p_name, p_make, p_model, p_year::text, array_to_string(p_tags, ' '), p_about) $$;
create or replace function public.mod_search_doc(p_brand text, p_product text, p_part_number text)
returns text language sql immutable parallel safe
as $$ select concat_ws(' ', p_brand, p_product, p_part_number) $$;
create or replace function public.post_search_doc(p_title text, p_intro text, p_search_text text)
returns text language sql immutable parallel safe
as $$ select concat_ws(' ', p_title, p_intro, p_search_text) $$;

create index if not exists cars_search_doc_trgm_idx on public.cars
  using gin (public.car_search_doc(name, make, model, year, tags, about) gin_trgm_ops) where is_public;
create index if not exists mod_items_search_doc_trgm_idx on public.mod_items
  using gin (public.mod_search_doc(brand, product, part_number) gin_trgm_ops) where status = 'installed';
create index if not exists activity_posts_search_doc_trgm_idx on public.activity_posts
  using gin (public.post_search_doc(title, intro, search_text) gin_trgm_ops) where published_at is not null;

-- ── Word search: ids only, definer, visibility applied inside ────────────

create or replace function public.search_car_ids(p_query text)
returns setof uuid language sql stable security definer
set search_path to 'public', 'extensions', 'pg_temp'
set pg_trgm.word_similarity_threshold to '0.45'
as $function$
  with terms as (
    select distinct t
    from regexp_split_to_table(lower(coalesce(p_query, '')), '\s+') as t
    where length(t) >= 1
  ),
  -- One row per (car, word it matched). Each arm is answered by a trigram
  -- index, so only matching rows are ever read.
  hits as (
    select c.id, t.t from terms t join public.cars c
      on public.car_search_doc(c.name, c.make, c.model, c.year, c.tags, c.about) ilike '%' || t.t || '%'
     where c.is_public
    union
    select m.car_id, t.t from terms t join public.mod_items m
      on public.mod_search_doc(m.brand, m.product, m.part_number) ilike '%' || t.t || '%'
     where m.status = 'installed'
    union
    select c.id, t.t from terms t join public.cars c on t.t <% c.name
     where c.is_public
  ),
  scored as (
    select
      c.id,
      count(*) as hits,
      bool_or(c.name ilike '%' || h.t || '%') as name_hit,
      similarity(c.name, lower(coalesce(p_query, ''))) as sim
    from hits h
    join public.cars c on c.id = h.id
    join public.profiles o on o.id = c.owner_id
    where c.is_public and o.suspended_at is null
    group by c.id, c.name
  )
  select id from scored
  order by hits desc, name_hit desc, sim desc, id
$function$;

create or replace function public.search_update_ids(p_query text)
returns setof uuid language sql stable security definer
set search_path to 'public', 'extensions', 'pg_temp'
set pg_trgm.word_similarity_threshold to '0.45'
as $function$
  with terms as (
    select distinct t
    from regexp_split_to_table(lower(coalesce(p_query, '')), '\s+') as t
    where length(t) >= 1
  ),
  -- Cars whose name, make, model or year carry the word. The index covers
  -- the whole car document, so the narrower test is applied to what it finds.
  car_hits as (
    select c.id, t.t from terms t join public.cars c
      on public.car_search_doc(c.name, c.make, c.model, c.year, c.tags, c.about) ilike '%' || t.t || '%'
     where c.is_public
       and concat_ws(' ', c.name, c.make, c.model, c.year::text) ilike '%' || t.t || '%'
  ),
  -- One row per (update, word it matched), each arm answered by an index.
  hits as (
    select p.id, t.t from terms t join public.activity_posts p
      on public.post_search_doc(p.title, p.intro, p.search_text) ilike '%' || t.t || '%'
     where p.published_at is not null
    union
    select p.id, ch.t from car_hits ch join public.activity_posts p on p.car_id = ch.id
     where p.published_at is not null
    union
    select p.id, t.t from terms t join public.activity_posts p on t.t <% p.title
     where p.published_at is not null
  ),
  scored as (
    select
      p.id,
      p.published_at,
      count(*) as hits,
      bool_or(p.title ilike '%' || h.t || '%') as title_hit,
      similarity(coalesce(p.title, ''), lower(coalesce(p_query, ''))) as sim
    from hits h
    join public.activity_posts p on p.id = h.id
    left join public.cars c on c.id = p.car_id
    left join public.profiles o on o.id = c.owner_id
    where p.published_at is not null
      and (p.car_id is null or (c.is_public and o.suspended_at is null))
    group by p.id, p.title, p.published_at
  )
  select id from scored
  order by hits desc, title_hit desc, sim desc, published_at desc, id
$function$;
create or replace function public.search_listing_ids(p_query text)
returns setof uuid language sql stable security definer
set search_path to 'public', 'extensions', 'pg_temp'
set pg_trgm.word_similarity_threshold to '0.45'
as $function$
  with terms as (
    select distinct t
    from regexp_split_to_table(lower(coalesce(p_query, '')), '\s+') as t
    where length(t) >= 1
  ),
  -- One row per (part, word it matched), each arm answered by a trigram index.
  hits as (
    select l.id, t.t from terms t join public.listings l
      on public.listing_search_doc(l.title, l.description, l.compatibility_notes, l.category, l.brand) ilike '%' || t.t || '%'
    union
    select l.id, t.t from terms t join public.listings l on t.t <% l.title
  ),
  -- What a signed-out visitor may see: this runs with the definer's rights
  -- so the indexes can be used, and so applies the read rule itself.
  visible as (
    select l.id, l.title from public.listings l
    join public.profiles o on o.id = l.seller_id
    where l.status in ('active', 'reserved', 'sold') and o.suspended_at is null
  ),
  scored as (
    select
      v.id,
      count(*) as hits,
      bool_or(v.title ilike '%' || h.t || '%') as title_hit,
      similarity(v.title, lower(coalesce(p_query, ''))) as sim
    from hits h join visible v on v.id = h.id
    group by v.id, v.title
  )
  select id from (
    select id, hits, title_hit, sim, 0 as ord from scored
    union all
    -- No usable words (empty / whitespace query): the unfiltered set.
    select v.id, 0, false, 0::real, 1 as ord
    from visible v
    where not exists (select 1 from terms)
  ) ranked
  order by ord, hits desc, title_hit desc, sim desc, id
$function$;

create or replace function public.marketplace_search_ids(p_query text)
returns setof uuid language sql stable security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $function$
 with cleaned as(select trim(regexp_replace(p_query,'[,()]',' ','g')) term),
 q as(select term,lower(regexp_replace(term,'[^a-zA-Z0-9]','','g')) compact from cleaned),
 classified as(select *,term !~ '\s' and length(compact)>=5 and length(regexp_replace(compact,'[^0-9]','','g'))>=2 identifier from q),
 -- The number as typed plus its known interchange numbers; none unless it
 -- could be a part number at all (identifier_matches_listing's own rule).
 variants as(
   select q.compact from classified q where length(q.compact)>=4 and q.compact ~ '[0-9]'
   union
   select case when k.from_compact=q.compact then k.to_compact else k.from_compact end
   from classified q join public.part_number_links k on k.from_compact=q.compact or k.to_compact=q.compact
   where length(q.compact)>=4 and q.compact ~ '[0-9]'),
 numbered as(
   select l.id from variants v join public.listings l on l.part_number_compact like '%'||v.compact||'%'
   union
   select n.listing_id from variants v join public.listing_part_numbers n on n.number_compact=v.compact)
 select l.id from public.listings l join public.profiles o on o.id=l.seller_id
 where l.status='active' and o.suspended_at is null and l.id in(select id from numbered)
 union
 select s.id from classified q cross join lateral public.search_listing_ids(q.term) s(id) where not q.identifier;
$function$;
revoke all on function public.marketplace_search_ids(text) from public;
grant execute on function public.marketplace_search_ids(text) to anon, authenticated, service_role;

create or replace function public.marketplace_search_rows(p_query text)
returns setof public.listings language sql stable
as $function$
 select l.* from public.listings l where l.id in(select public.marketplace_search_ids(p_query));
$function$;

-- The planner assumes 1,000 rows from a set-returning function; most searches
-- match far fewer, and the guess decides how the ids are joined back.
alter function public.marketplace_search_ids(text) rows 100;
alter function public.search_update_ids(text) rows 100;
alter function public.search_car_ids(text) rows 100;

-- ── Explore search wrappers ──────────────────────────────────────────────

create or replace function public.explore_build_rows(p_query text)
returns setof public.cars language sql stable
as $function$
 select c.id, c.owner_id, c.slug, c.name, c.make, c.model, c.year, c.color, c.about, c.tags,
        c.cover_image_url, c.is_public, c.created_at, c.updated_at, null::text as vin, c.trim,
        c.engine, c.drivetrain, c.body_class, c.vin_decoded_at, c.catalog_make_id, c.catalog_model_id,
        c.identity_source, c.cover_focal_x, c.cover_focal_y
 from public.search_car_ids(p_query) with ordinality ranked(id,rank)
 join public.cars c on c.id=ranked.id where c.is_public order by ranked.rank,c.id;
$function$;

create or replace function public.explore_update_rows(p_query text default ''::text, p_make text default ''::text, p_model text default ''::text, p_make_id integer default 0, p_model_id integer default 0, p_ymin integer default 0, p_ymax integer default 9999)
returns setof public.activity_posts language sql stable
as $function$
 select p.* from public.activity_posts p join public.cars c on c.id=p.car_id
 left join public.search_update_ids(p_query) with ordinality r(id,rank) on r.id=p.id
 where c.is_public and p.published_at is not null and (trim(p_query)='' or r.id is not null)
 and (p_make='' or (p_model_id<>0 and c.catalog_model_id=p_model_id) or (p_model_id=0 and c.catalog_make_id=p_make_id) or (lower(c.make)=lower(p_make) and (p_model='' or lower(c.model)=lower(p_model))))
 and ((p_ymin=0 and p_ymax=9999) or c.year between p_ymin and p_ymax)
 order by r.rank,p.published_at desc,p.id;
$function$;

-- Searching updates starts from the matched ids. explore_update_rows keeps
-- its query argument for older callers; the app now sends searches here.
create or replace function public.explore_update_search_rows(p_query text, p_make text default ''::text, p_model text default ''::text, p_make_id integer default 0, p_model_id integer default 0, p_ymin integer default 0, p_ymax integer default 9999)
returns setof public.activity_posts language sql stable
as $function$
 -- The car is a lookup per matched update, not a third table in the join:
 -- with it in the join the planner, guessing at filters it cannot see the
 -- values of, sometimes starts from every car instead of from the matches.
 select p.* from public.search_update_ids(p_query) with ordinality r(id,rank)
 join public.activity_posts p on p.id=r.id
 where p.published_at is not null
 and (select c.is_public
   and (p_make='' or (p_model_id<>0 and c.catalog_model_id=p_model_id) or (p_model_id=0 and c.catalog_make_id=p_make_id) or (lower(c.make)=lower(p_make) and (p_model='' or lower(c.model)=lower(p_model))))
   and ((p_ymin=0 and p_ymax=9999) or c.year between p_ymin and p_ymax)
   from public.cars c where c.id=p.car_id)
 order by r.rank,p.published_at desc,p.id;
$function$;
revoke all on function public.explore_update_search_rows(text,text,text,integer,integer,integer,integer) from public;
grant execute on function public.explore_update_search_rows(text,text,text,integer,integer,integer,integer) to anon, authenticated, service_role;

-- ── Marketplace browse and search ────────────────────────────────────────

-- The full fitment check runs several lookups per part. Two indexed lookups
-- now go in front of it — a fitment row, or a source car, of that make; every
-- positive answer needs one of them — so most parts are ruled out cheaply.
-- CASE fixes the order (the planner would otherwise run the full check
-- first). They are scalar lookups, not EXISTS: the planner answers EXISTS
-- here by hashing every fitment row once per part, which exhausts memory.
-- The viewer's garage is looked up as (select p_viewer): compared with the
-- bare expression, row security stops the planner using the owner index and
-- it reads every car, once per part.
create or replace function public.marketplace_browse_rows(
  p_query text default ''::text, p_vehicle text default ''::text, p_vyear integer default 0,
  p_ymin integer default 0, p_ymax integer default 9999, p_fit boolean default false,
  p_viewer uuid default auth.uid())
returns setof public.listings
language sql
stable
as $function$
 select l.* from public.listings l where l.status='active'
 and (p_viewer is not distinct from auth.uid() or current_user='service_role')
 and (l.seller_id not in (select public.suspended_profile_ids()) or l.seller_id=p_viewer)
 and (p_vehicle='' or exists(
   select 1 from public.catalog_makes m
   left join public.catalog_models mo on mo.make_id=m.id and mo.id=case when p_vehicle ~ '^[1-9][0-9]{0,9}-[1-9][0-9]{0,9}$' then split_part(p_vehicle,'-',2)::bigint else 0 end
   where m.id=case when p_vehicle ~ '^[1-9][0-9]{0,9}(-[1-9][0-9]{0,9})?$' then split_part(p_vehicle,'-',1)::bigint else 0 end
   and (position('-' in p_vehicle)=0 or mo.id is not null)
   and case when coalesce((select true from public.listing_fitments f where f.listing_id=l.id and lower(f.make)=lower(m.name) limit 1),false)
     or coalesce((select lower(c.make)=lower(m.name) from public.cars c where c.id=l.source_car_id),false)
   then public.marketplace_match_evidence(l.id,m.name,mo.name,p_vyear,p_viewer) in ('seller_stated','source_model','year_needed') else false end))
 and ((p_ymin=0 and p_ymax=9999) or exists(select 1 from public.cars c where c.id=l.source_car_id and (c.is_public or c.owner_id=p_viewer) and (public.profile_is_visible(c.owner_id) or c.owner_id=p_viewer) and c.year between p_ymin and p_ymax))
 and (not p_fit or exists(select 1 from public.cars g where g.owner_id=(select p_viewer) and g.make is not null and g.model is not null
   and case when coalesce((select true from public.listing_fitments f where f.listing_id=l.id and lower(f.make)=lower(g.make) limit 1),false)
     or coalesce((select lower(c.make)=lower(g.make) from public.cars c where c.id=l.source_car_id),false)
   then public.marketplace_match_evidence(l.id,g.make,g.model,coalesce(g.year,0),p_viewer) in ('seller_stated','source_model') else false end))
 and (trim(p_query)='' or l.id in(select public.marketplace_search_ids(p_query)));
$function$;

-- A text search starts from the parts the words matched, then applies the
-- browse function's rules to exactly those parts. The rules are repeated
-- here rather than called: joined through the function, the planner reads
-- every active part first. search_at_volume_guard.sql holds the two
-- to the same answer.
create or replace function public.marketplace_search_browse_rows(
  p_query text, p_vehicle text default ''::text, p_vyear integer default 0,
  p_ymin integer default 0, p_ymax integer default 9999, p_fit boolean default false,
  p_viewer uuid default auth.uid())
returns setof public.listings
language sql
stable
as $function$
 select l.* from public.marketplace_search_ids(p_query) s(id) join public.listings l on l.id=s.id
 where trim(p_query)<>'' and l.status='active'
 and (p_viewer is not distinct from auth.uid() or current_user='service_role')
 and (l.seller_id not in (select public.suspended_profile_ids()) or l.seller_id=p_viewer)
 and (p_vehicle='' or exists(
   select 1 from public.catalog_makes m
   left join public.catalog_models mo on mo.make_id=m.id and mo.id=case when p_vehicle ~ '^[1-9][0-9]{0,9}-[1-9][0-9]{0,9}$' then split_part(p_vehicle,'-',2)::bigint else 0 end
   where m.id=case when p_vehicle ~ '^[1-9][0-9]{0,9}(-[1-9][0-9]{0,9})?$' then split_part(p_vehicle,'-',1)::bigint else 0 end
   and (position('-' in p_vehicle)=0 or mo.id is not null)
   and case when coalesce((select true from public.listing_fitments f where f.listing_id=l.id and lower(f.make)=lower(m.name) limit 1),false)
     or coalesce((select lower(c.make)=lower(m.name) from public.cars c where c.id=l.source_car_id),false)
   then public.marketplace_match_evidence(l.id,m.name,mo.name,p_vyear,p_viewer) in ('seller_stated','source_model','year_needed') else false end))
 and ((p_ymin=0 and p_ymax=9999) or exists(select 1 from public.cars c where c.id=l.source_car_id and (c.is_public or c.owner_id=p_viewer) and (public.profile_is_visible(c.owner_id) or c.owner_id=p_viewer) and c.year between p_ymin and p_ymax))
 and (not p_fit or exists(select 1 from public.cars g where g.owner_id=(select p_viewer) and g.make is not null and g.model is not null
   and case when coalesce((select true from public.listing_fitments f where f.listing_id=l.id and lower(f.make)=lower(g.make) limit 1),false)
     or coalesce((select lower(c.make)=lower(g.make) from public.cars c where c.id=l.source_car_id),false)
   then public.marketplace_match_evidence(l.id,g.make,g.model,coalesce(g.year,0),p_viewer) in ('seller_stated','source_model') else false end));
$function$;
revoke all on function public.marketplace_search_browse_rows(text,text,integer,integer,integer,boolean,uuid) from public;
grant execute on function public.marketplace_search_browse_rows(text,text,integer,integer,integer,boolean,uuid) to anon, authenticated, service_role;

-- ── The Explore wall ─────────────────────────────────────────────────────

-- feed_events is a UNION ALL view. Under row security its three arms are not
-- flattened, so a page of 25 sorted all 150,000 events. This reads the newest
-- few of each kind off an index and merges those. Same rows as the view.
create index if not exists cars_public_feed_idx on public.cars (created_at desc, id desc) where is_public;
create index if not exists activity_posts_feed_idx on public.activity_posts (published_at desc, id desc) where published_at is not null;
create index if not exists listings_active_feed_idx on public.listings (created_at desc, id desc) where status = 'active';

create or replace function public.feed_event_page(
  p_kinds text[], p_limit integer, p_offset integer default 0, p_exclude_owner uuid default null)
returns table(kind text, id uuid, happened_at timestamptz)
language sql
stable
set search_path to 'public', 'pg_temp'
as $function$
  select e.kind, e.id, e.happened_at from (
    (select 'car'::text as kind, c.id, c.created_at as happened_at
       from public.cars c
      where 'car' = any(p_kinds) and c.is_public
        and (p_exclude_owner is null or c.owner_id <> p_exclude_owner)
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
      order by p.published_at desc, p.id desc
      limit greatest(0, least(p_limit, 200)) + greatest(0, p_offset))
    union all
    (select 'part'::text, l.id, l.created_at
       from public.listings l
      where 'part' = any(p_kinds) and l.status = 'active'
        and (p_exclude_owner is null or l.seller_id <> p_exclude_owner)
      order by l.created_at desc, l.id desc
      limit greatest(0, least(p_limit, 200)) + greatest(0, p_offset))
  ) e
  order by e.happened_at desc, e.id desc
  limit greatest(0, least(p_limit, 200)) offset greatest(0, p_offset);
$function$;
revoke all on function public.feed_event_page(text[], integer, integer, uuid) from public;
grant execute on function public.feed_event_page(text[], integer, integer, uuid) to anon, authenticated, service_role;
