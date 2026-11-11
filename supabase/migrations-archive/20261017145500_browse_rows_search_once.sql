-- marketplace_browse_rows searches once per call, however it is called.
--
-- WHICH PARTS IT RETURNS DOES NOT CHANGE. With no words it returns what it
-- did; with words it returns what marketplace_search_browse_rows returns,
-- which was already the same rows (search_at_volume_guard.sql,
-- vehicle_fit_guard.sql).
--
-- What changes is how a search is answered. The last clause was
--   (trim(p_query)='' or l.id in (select marketplace_search_ids(p_query)))
-- Called with a literal word, Postgres runs the search once and hashes the
-- ids. Called through PostgREST, the word arrives as a column of a joined
-- row (json_to_record(...) as _(p_query text), lateral
-- marketplace_browse_rows(p_query := _.p_query)), the clause becomes a
-- correlated subplan, and the search runs again for every part for sale
-- the filters let through. Since 20261011130000 a search costs about 15 ms,
-- so a word matching 1,100 parts hit the visitor's 3-second limit, and on
-- 60,000 seeded parts one rare word took over two minutes.
--
-- Now the two cases are two branches of one UNION ALL:
--   * no words: the browse query as before, without the search clause;
--   * words: marketplace_search_browse_rows, which starts from the ids the
--     words found (computed once) and applies the same rules.
-- Each branch's test of p_query refers only to the arguments, so through
-- PostgREST it is a one-time filter: the branch that doesn't apply never
-- runs, and the search is never run for a browse.
--
-- THE COST: the function is still SQL and still inlined (no SET clause, no
-- definer rights: vehicle_fit_guard.sql checks), and the caller's filters
-- still reach each branch's indexes. But a UNION ALL branch carrying its own
-- WHERE is planned as a subquery, so an ORDER BY … LIMIT on this function
-- sorts every matching part instead of stopping after the first page read
-- off an index. Nothing in the app reads pages that way any more: pages and
-- counts go through marketplace_page / marketplace_count
-- (20261011110000), searches through marketplace_search_browse_rows, and
-- what still calls this function (the conditions-in-use sample, the
-- saved-search worker's created_at window, the offset fallback for a
-- database without marketplace_page) reads no sorted page of the whole
-- catalogue. Measurements: docs/performance/query-plans.md.
--
-- Guard: supabase/tests/browse_rows_search_once_guard.sql runs the function
-- the way PostgREST does and fails if the search runs more than once.

create or replace function public.marketplace_browse_rows(
  p_query text default ''::text, p_vehicle text default ''::text, p_vyear integer default 0,
  p_ymin integer default 0, p_ymax integer default 9999, p_fit boolean default false,
  p_viewer uuid default auth.uid())
returns setof public.listings
language sql
stable
as $function$
 select l.* from public.listings l where trim(p_query)='' and l.status='active'
 and (p_viewer is not distinct from auth.uid() or current_user='service_role')
 and (l.seller_id not in (select public.suspended_profile_ids()) or l.seller_id=p_viewer)
 and (p_vehicle='' or exists(
   select 1 from public.catalog_makes m
   left join public.catalog_models mo on mo.make_id=m.id and mo.id=case when p_vehicle ~ '^[1-9][0-9]{0,9}-[1-9][0-9]{0,9}$' then split_part(p_vehicle,'-',2)::bigint else 0 end
   join public.listing_vehicle_fit v on v.listing_id=l.id and v.make_key=lower(m.name) and v.model_key=coalesce(lower(mo.name),'')
   where m.id=case when p_vehicle ~ '^[1-9][0-9]{0,9}(-[1-9][0-9]{0,9})?$' then split_part(p_vehicle,'-',1)::bigint else 0 end
   and (position('-' in p_vehicle)=0 or mo.id is not null)
   and case when v.via='stated' then p_vyear=0 or v.years @> p_vyear
     else not v.stated_also and (v.car_public or v.car_owner_id=p_viewer)
       and (v.car_owner_id=v.seller_id or v.car_owner_id=p_viewer or v.car_owner_id not in (select public.suspended_profile_ids())) end))
 and ((p_ymin=0 and p_ymax=9999) or exists(select 1 from public.cars c where c.id=l.source_car_id and (c.is_public or c.owner_id=p_viewer) and (public.profile_is_visible(c.owner_id) or c.owner_id=p_viewer) and c.year between p_ymin and p_ymax))
 and (not p_fit or exists(select 1 from public.cars g
   join public.listing_vehicle_fit v on v.listing_id=l.id and v.make_key=lower(g.make) and v.model_key=lower(g.model)
   where g.owner_id=(select p_viewer) and g.make is not null and g.model is not null
   and case when v.via='stated' then case when coalesce(g.year,0)=0 then v.all_years else v.years @> g.year end
     else not v.stated_also and (v.car_public or v.car_owner_id=p_viewer)
       and (v.car_owner_id=v.seller_id or v.car_owner_id=p_viewer or v.car_owner_id not in (select public.suspended_profile_ids())) end))
 union all
 select s.* from public.marketplace_search_browse_rows(p_query, p_vehicle, p_vyear, p_ymin, p_ymax, p_fit, p_viewer) s;
$function$;
