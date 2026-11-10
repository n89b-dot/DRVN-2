-- The vehicle rule at volume: marketplace_browse_rows (reading
-- listing_vehicle_fit, 20261011100000) against the browse function as it
-- was (running marketplace_match_evidence per part), for several vehicles
-- and years, as a visitor and as a member with a garage. DISPOSABLE
-- DATABASES ONLY. Slow on purpose: the old function is the slow one.
\set ON_ERROR_STOP 1
begin;
set local statement_timeout = 0;
create function pg_temp.reference_browse(
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

-- This script's own helpers are called while acting as other roles. A new
-- function is closed by default (architecture plan 2, item A3), so they are opened here.
grant execute on all routines in schema pg_temp to public;
do $$
declare
  member uuid := (select owner_id from public.cars group by owner_id
                  having count(*) between 2 and 3 and bool_or(make = 'Make1' and model = 'Model1') order by owner_id limit 1);
  v record; a uuid[]; b uuid[]; checks int := 0; parts bigint := 0;
begin
  for v in select * from (values ('900012-901203', 0), ('900012-901203', 2001), ('900003', 0), ('900003', 1999),
                                 ('900020-902002', 2010), ('900001-900101', 2015), ('900037', 0)) x(vehicle, yr) loop
    perform set_config('role', 'anon', true);
    a := array(select id from public.marketplace_browse_rows(p_vehicle => v.vehicle, p_vyear => v.yr) order by id);
    b := array(select id from pg_temp.reference_browse(p_vehicle => v.vehicle, p_vyear => v.yr) order by id);
    perform set_config('role', 'supabase_admin', true);
    if a <> b then raise exception 'vehicle % year %: % parts by the rows, % by the evidence', v.vehicle, v.yr, cardinality(a), cardinality(b); end if;
    checks := checks + 1; parts := parts + cardinality(a);
    raise notice 'vehicle % year %: % parts, identical', v.vehicle, v.yr, cardinality(a);
  end loop;
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', member, 'role', 'authenticated')::text, true);
  a := array(select id from public.marketplace_browse_rows(p_fit => true) order by id);
  b := array(select id from pg_temp.reference_browse(p_fit => true) order by id);
  perform set_config('role', 'supabase_admin', true);
  if a <> b then raise exception 'fits my garage: % parts by the rows, % by the evidence', cardinality(a), cardinality(b); end if;
  raise notice 'fits my garage (member %): % parts, identical', member, cardinality(a);
  raise notice 'vehicle rule agrees at volume: % comparisons, % parts', checks + 1, parts + cardinality(a);
end $$;
rollback;
