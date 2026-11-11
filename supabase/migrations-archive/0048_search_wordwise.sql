-- 0048: word-wise marketplace search.
--
-- The 0008 search_listing_ids matched the whole query as one contiguous
-- substring: "porsche seats" could never find "Porsche 992 GT3 full bucket
-- seats", "rays rims" found nothing because no listing says "rims", and the
-- trigram machinery only ordered results it never got to retrieve — so a
-- typo ("garret") returned zero rows despite the gin_trgm indexes.
--
-- This rewrite keeps the signature (setof uuid, caller does its own
-- filtering/paging) and re-specifies matching:
--   * The query is split into words; each word matches independently against
--     title, description, the seller's compatibility notes, or the category
--     slug — so "rays rims" finds the Rays set via "rays" even though no
--     field says "rims".
--   * A word with no substring hit can still match by word-similarity
--     against the title (pg_trgm word_similarity ≥ 0.45), which is what
--     forgives "garret" for "Garrett".
--   * Ranking: listings matching MORE of the words first, then listings
--     whose title took a direct hit, then whole-query title similarity —
--     a 2-of-2 match beats a 1-of-2 match, and partial matches surface
--     instead of being silently dropped.
--   * Empty/whitespace queries keep the 0008 behavior of returning
--     everything (callers treat the query as "no filter").
--
-- Idempotent: create or replace; safe to apply repeatedly.

begin;

create or replace function public.search_listing_ids(p_query text)
returns setof uuid
language sql
stable
as $$
  with terms as (
    select distinct t
    from regexp_split_to_table(lower(coalesce(p_query, '')), '\s+') as t
    where length(t) >= 1
  ),
  scored as (
    select
      l.id,
      count(*) filter (
        where l.title ilike '%' || t.t || '%'
           or l.description ilike '%' || t.t || '%'
           or l.compatibility_notes ilike '%' || t.t || '%'
           or l.category ilike '%' || t.t || '%'
           or word_similarity(t.t, l.title) >= 0.45
      ) as hits,
      bool_or(l.title ilike '%' || t.t || '%') as title_hit,
      max(similarity(l.title, lower(coalesce(p_query, '')))) as sim
    from public.listings l
    cross join terms t
    group by l.id
  )
  select id from (
    select id, hits, title_hit, sim, 0 as ord
    from scored
    where hits > 0
    union all
    -- No usable words (empty / whitespace query): behave like 0008 and
    -- return the unfiltered set.
    select l.id, 0, false, 0::real, 1 as ord
    from public.listings l
    where not exists (select 1 from terms)
  ) ranked
  order by ord, hits desc, title_hit desc, sim desc
$$;

do $$
begin
  -- Self-check: the function exists and stays STABLE (planner-safe for the
  -- read path).
  if not exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'search_listing_ids'
      and p.provolatile = 's'
  ) then
    raise exception 'search_listing_ids missing or not stable';
  end if;
end $$;

commit;
