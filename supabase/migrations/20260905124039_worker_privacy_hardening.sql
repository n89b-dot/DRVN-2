begin;
create or replace function public.renew_remediation_lease(p_id uuid,p_lease uuid) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 update public.remediation_jobs set locked_until=now()+interval '2 minutes' where id=p_id and lease_id=p_lease and status='processing' and locked_until>now();
 if not found then raise exception 'Job lease lost'; end if;
end $$;
revoke all on function public.renew_remediation_lease(uuid,uuid) from public,anon,authenticated;
grant execute on function public.renew_remediation_lease(uuid,uuid) to service_role;

-- Exposes only public eligibility, without granting anonymous reads of moderation fields.
create or replace function public.profile_is_visible(p_id uuid) returns boolean
language sql stable security definer set search_path=public,pg_temp as $$ select exists(select 1 from public.profiles where id=p_id and suspended_at is null); $$;
revoke all on function public.profile_is_visible(uuid) from public;
grant execute on function public.profile_is_visible(uuid) to anon,authenticated,service_role;

-- Public visibility follows current suspension status, even with stale index hits.
create policy "suspended car visibility" on public.cars as restrictive for select to anon,authenticated
 using(owner_id=auth.uid() or public.profile_is_visible(owner_id));
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
notify pgrst,'reload schema';
commit;
