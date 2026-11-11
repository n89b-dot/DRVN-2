-- 0057: Explore search — builds, updates and accounts.
--
-- Extends the marketplace's search doctrine (0008/0048: PostgreSQL is
-- canonical truth, a provider only produces a ranked candidate id set) to the
-- Explore object families. Three new RPCs mirror search_listing_ids' word-wise
-- pg_trgm shape, one per family, because "a person", "a build" and "a post"
-- should never share one relevance score — ranking stays within a family and
-- the UI groups the families.
--
--   search_car_ids      public builds: name, vehicle identity, tags, about,
--                       and the structured installed-mod text (brand, product,
--                       part number) — so "Bilstein B16 Golf R" can find a
--                       build through a mod even though Explore exposes no
--                       Modification filter.
--   search_update_ids   published posts on public builds: title, intro, the
--                       extracted user-visible body text, and the owning
--                       car's vehicle identity.
--   search_profile_ids  a deliberately narrow identity projection — username,
--                       display name, headline. NEVER location, bio, garage
--                       contents or relationships: accounts are discoverable
--                       by identity, not queryable as a people directory.
--
-- Body text comes from activity_post_search_text(), a deliberate extractor
-- over the ActivityBlock[] document (src/lib/activity-blocks.ts) — text
-- blocks, mod labels/details and performance notes only. Internal structure
-- (urls, ids, enum values) is never indexed. It is IMMUTABLE so the
-- search_text column can be STORED GENERATED; changing the extractor means
-- dropping and re-adding the column (documented in docs/site/search.md).
--
-- Visibility is enforced INSIDE each function (is_public / published_at /
-- suspended_at) because the app calls these through the service-role client,
-- exactly like search_listing_ids.
--
-- Empty/whitespace queries return NOTHING (unlike search_listing_ids):
-- Explore's no-query state is the browse feed, not "everything ranked".
--
-- Idempotent: create or replace / if not exists throughout.

begin;

-- The user-visible text of one activity document (jsonb ActivityBlock[]).
create or replace function public.activity_post_search_text(body jsonb)
returns text
language sql
immutable
as $$
  select coalesce(string_agg(part, ' '), '')
  from (
    select case b.value->>'type'
      when 'text' then b.value->>'text'
      when 'mod' then concat_ws(' ', b.value->>'label', b.value->>'detail')
      when 'performance' then b.value->>'note'
      else null
    end as part
    from jsonb_array_elements(
      case when jsonb_typeof(body) = 'array' then body else '[]'::jsonb end
    ) as b
  ) parts
  where part is not null and part <> ''
$$;

alter table public.activity_posts
  add column if not exists search_text text
  generated always as (public.activity_post_search_text(body)) stored;

create or replace function public.search_car_ids(p_query text)
returns setof uuid
language sql
stable
as $$
  with terms as (
    select distinct t
    from regexp_split_to_table(lower(coalesce(p_query, '')), '\s+') as t
    where length(t) >= 1
  ),
  car_text as (
    select
      c.id,
      c.name,
      concat_ws(' ',
        c.name, c.make, c.model, c.year::text,
        array_to_string(c.tags, ' '),
        c.about,
        (select string_agg(concat_ws(' ', m.brand, m.product, m.part_number), ' ')
         from public.mod_items m where m.car_id = c.id)
      ) as blob
    from public.cars c
    where c.is_public
  ),
  scored as (
    select
      ct.id,
      count(*) filter (
        where ct.blob ilike '%' || t.t || '%'
           or word_similarity(t.t, ct.name) >= 0.45
      ) as hits,
      bool_or(ct.name ilike '%' || t.t || '%') as name_hit,
      max(similarity(ct.name, lower(coalesce(p_query, '')))) as sim
    from car_text ct
    cross join terms t
    group by ct.id, ct.name
  )
  select id from scored
  where hits > 0
  order by hits desc, name_hit desc, sim desc
$$;

create or replace function public.search_update_ids(p_query text)
returns setof uuid
language sql
stable
as $$
  with terms as (
    select distinct t
    from regexp_split_to_table(lower(coalesce(p_query, '')), '\s+') as t
    where length(t) >= 1
  ),
  post_text as (
    select
      p.id,
      p.title,
      p.published_at,
      concat_ws(' ',
        p.title, p.intro, p.search_text,
        c.name, c.make, c.model, c.year::text
      ) as blob
    from public.activity_posts p
    join public.cars c on c.id = p.car_id
    where p.published_at is not null
      and c.is_public
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
  order by hits desc, title_hit desc, sim desc, published_at desc
$$;

-- Accounts: identity fields only. "@kaito" and "kaito" both find @kaito —
-- the @ is stripped before tokenizing. Suspended accounts never surface.
create or replace function public.search_profile_ids(p_query text)
returns setof uuid
language sql
stable
as $$
  with terms as (
    select distinct t
    from regexp_split_to_table(
      lower(regexp_replace(coalesce(p_query, ''), '@', ' ', 'g')), '\s+'
    ) as t
    where length(t) >= 1
  ),
  profile_text as (
    select
      p.id,
      coalesce(p.display_name, p.username, '') as name,
      p.username,
      concat_ws(' ', p.username, p.display_name, p.headline) as blob
    from public.profiles p
    where p.suspended_at is null
      and (p.username is not null or p.display_name is not null)
  ),
  scored as (
    select
      pt.id,
      bool_or(lower(coalesce(pt.username, '')) = t.t) as exact_username,
      count(*) filter (
        where pt.blob ilike '%' || t.t || '%'
           or word_similarity(t.t, pt.name) >= 0.45
      ) as hits,
      bool_or(pt.name ilike '%' || t.t || '%') as name_hit,
      max(similarity(pt.name, lower(coalesce(p_query, '')))) as sim
    from profile_text pt
    cross join terms t
    group by pt.id
  )
  select id from scored
  where hits > 0
  order by exact_username desc, hits desc, name_hit desc, sim desc
$$;

-- Trigram indexes for the direct-ilike fallback lanes and similarity
-- ordering. The blob-scoring inside the RPCs is a scan by design (same as
-- search_listing_ids) — these serve the provider fallback clauses and any
-- future % operator use.
create index if not exists cars_name_trgm_idx
  on public.cars using gin (name gin_trgm_ops);
create index if not exists activity_posts_title_trgm_idx
  on public.activity_posts using gin (title gin_trgm_ops);
create index if not exists activity_posts_search_text_trgm_idx
  on public.activity_posts using gin (search_text gin_trgm_ops);
create index if not exists profiles_username_trgm_idx
  on public.profiles using gin (username gin_trgm_ops);
create index if not exists profiles_display_name_trgm_idx
  on public.profiles using gin (display_name gin_trgm_ops);

do $$
begin
  if not exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('search_car_ids', 'search_update_ids', 'search_profile_ids')
      and p.provolatile = 's'
    having count(*) = 3
  ) then
    raise exception 'explore search RPCs missing or not stable';
  end if;
end $$;

commit;
