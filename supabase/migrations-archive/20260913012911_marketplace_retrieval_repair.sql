-- Focused R01 repair for installations with the legacy catalog/commerce schema.
-- Reuses the marketplace portion of the September 5 migrations, excluding
-- renew_remediation_lease and the unrelated payment/worker rollout.
-- Safe before or after those files. The original policy definitions are now
-- repeatable so a subsequent coordinated worker rollout cannot collide.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
do $$
begin
  if to_regclass('public.listing_part_numbers') is null
     or to_regclass('public.part_number_links') is null
     or to_regclass('public.listing_fitments') is null
     or to_regprocedure('public.search_listing_ids(text)') is null
     or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='profiles' and column_name='suspended_at')
     or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='listings' and column_name='part_number_compact') then
    raise exception 'Marketplace repair prerequisites are missing; reconcile the target schema before applying';
  end if;
end $$;
-- Exposes only public eligibility, without granting anonymous reads of moderation fields.
create or replace function public.profile_is_visible(p_id uuid) returns boolean
language sql stable security definer set search_path=public,pg_temp as $$ select exists(select 1 from public.profiles where id=p_id and suspended_at is null); $$;
revoke all on function public.profile_is_visible(uuid) from public;
grant execute on function public.profile_is_visible(uuid) to anon,authenticated,service_role;

-- Public visibility follows current suspension status, even with stale index hits.
-- Repeatable when the focused marketplace repair was deployed first.
drop policy if exists "suspended car visibility" on public.cars;
create policy "suspended car visibility" on public.cars as restrictive for select to anon,authenticated
 using(owner_id=auth.uid() or public.profile_is_visible(owner_id));
drop policy if exists "suspended listing visibility" on public.listings;
create policy "suspended listing visibility" on public.listings as restrictive for select to anon,authenticated
 using(seller_id=auth.uid() or public.profile_is_visible(seller_id));

-- The canonical result relation can be filtered, counted and paginated by
-- PostgREST before transferring rows. No fixed candidate prefix is materialized.
create or replace function public.identifier_matches_listing(p_id uuid,p_compact text) returns boolean
language sql stable security definer set search_path=public,pg_temp as $$
 with variants as(select p_compact compact union select case when l.from_compact=p_compact then l.to_compact else l.from_compact end from public.part_number_links l where l.from_compact=p_compact or l.to_compact=p_compact)
 select length(p_compact)>=4 and p_compact ~ '[0-9]' and exists(
 select 1 from public.listings l where l.id=p_id and l.status='active' and public.profile_is_visible(l.seller_id) and (
 exists(select 1 from variants v where l.part_number_compact like '%'||v.compact||'%') or exists(select 1 from public.listing_part_numbers n join variants v on n.number_compact=v.compact where n.listing_id=l.id)));
$$;
revoke all on function public.identifier_matches_listing(uuid,text) from public;
grant execute on function public.identifier_matches_listing(uuid,text) to anon,authenticated,service_role;
create or replace function public.marketplace_search_rows(p_query text) returns setof public.listings
language sql stable security invoker set search_path=public,pg_temp as $$
 with cleaned as(select trim(regexp_replace(p_query,'[,()]',' ','g')) term),
 q as(select term,lower(regexp_replace(term,'[^a-zA-Z0-9]','','g')) compact from cleaned),
 classified as(select *,term !~ '\s' and length(compact)>=5 and length(regexp_replace(compact,'[^0-9]','','g'))>=2 identifier from q)
 select l.* from public.listings l,classified q where
 public.identifier_matches_listing(l.id,q.compact)
 or (not q.identifier and l.id in(select public.search_listing_ids(q.term)));

$$;
revoke all on function public.marketplace_search_rows(text) from public;
grant execute on function public.marketplace_search_rows(text) to anon,authenticated,service_role;
create or replace function public.marketplace_filtered_rows(p_query text default '',p_make text default '',p_model text default '',p_make_id int default 0,p_model_id int default 0,p_ymin int default 0,p_ymax int default 9999,p_fit boolean default false)
returns setof public.listings language sql stable security invoker set search_path=public,pg_temp as $$
 select l.* from public.listings l where
 (trim(p_query)='' or l.id in(select id from public.marketplace_search_rows(p_query)))
 and (p_make='' or exists(select 1 from public.cars c where c.id=l.source_car_id and
   ((p_model_id<>0 and c.catalog_model_id=p_model_id) or (p_model_id=0 and c.catalog_make_id=p_make_id) or
   (lower(c.make)=lower(p_make) and (p_model='' or lower(c.model)=lower(p_model)))))
   or exists(select 1 from public.listing_fitments f where f.listing_id=l.id and lower(f.make)=lower(p_make) and (p_model='' or lower(f.model)=lower(p_model))))
 and ((p_ymin=0 and p_ymax=9999) or exists(select 1 from public.cars c where c.id=l.source_car_id and c.year between p_ymin and p_ymax))
 and (not p_fit or exists(select 1 from public.cars g where g.owner_id=auth.uid() and g.make is not null and g.model is not null and (
   exists(select 1 from public.cars c where c.id=l.source_car_id and lower(c.make)=lower(g.make) and lower(c.model)=lower(g.model))
   or exists(select 1 from public.listing_fitments f where f.listing_id=l.id and lower(f.make)=lower(g.make) and lower(f.model)=lower(g.model) and
   (g.year is null or ((f.year_start is null or g.year>=f.year_start) and (f.year_end is null or g.year<=f.year_end)))))));
$$;
revoke all on function public.marketplace_filtered_rows(text,text,text,int,int,int,int,boolean) from public;
grant execute on function public.marketplace_filtered_rows(text,text,text,int,int,int,int,boolean) to anon,authenticated,service_role;
notify pgrst, 'reload schema';
commit;
