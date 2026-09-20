begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- Same evidence vocabulary as explainMatch. Public callers cannot impersonate
-- a garage owner; workers pass the saved-search owner explicitly.
create or replace function public.marketplace_match_evidence(p_listing uuid, p_make text, p_model text, p_year int default 0, p_viewer uuid default auth.uid())
returns text language sql stable security invoker set search_path=public,pg_temp as $$
 with eligible as (
   select l.* from public.listings l where l.id=p_listing
     and (p_viewer is not distinct from auth.uid() or current_user='service_role')
     and (public.profile_is_visible(l.seller_id) or l.seller_id=p_viewer)
 ), claims as (
   select f.* from public.listing_fitments f join eligible l on l.id=f.listing_id
   where lower(f.make)=lower(p_make) and (coalesce(p_model,'')='' or lower(f.model)=lower(p_model))
 )
 select case
   when coalesce(p_make,'')='' or not exists(select 1 from eligible) then 'unknown'
   when exists(select 1 from claims f where (p_year<>0 or (f.year_start is null and f.year_end is null))
      and (p_year=0 or ((f.year_start is null or p_year>=f.year_start) and (f.year_end is null or p_year<=f.year_end)))) then 'seller_stated'
   when exists(select 1 from claims) then case when p_year=0 then 'year_needed' else 'outside_years' end
   when exists(select 1 from eligible l join public.cars c on c.id=l.source_car_id
     where (c.is_public or c.owner_id=p_viewer) and (public.profile_is_visible(c.owner_id) or c.owner_id=p_viewer)
     and lower(c.make)=lower(p_make) and (coalesce(p_model,'')='' or lower(c.model)=lower(p_model))) then 'source_model'
   else 'unknown' end;
$$;
revoke all on function public.marketplace_match_evidence(uuid,text,text,int,uuid) from public;
grant execute on function public.marketplace_match_evidence(uuid,text,text,int,uuid) to anon,authenticated,service_role;

create or replace function public.marketplace_browse_rows(p_query text default '',p_vehicle text default '',p_vyear int default 0,p_ymin int default 0,p_ymax int default 9999,p_fit boolean default false,p_viewer uuid default auth.uid())
returns setof public.listings language sql stable security invoker set search_path=public,pg_temp as $$
 with selection as (
   select m.name make, mo.name model from public.catalog_makes m
   left join public.catalog_models mo on mo.make_id=m.id and mo.id=case when p_vehicle ~ '^[1-9][0-9]{0,9}-[1-9][0-9]{0,9}$' then split_part(p_vehicle,'-',2)::bigint else 0 end
   where m.id=case when p_vehicle ~ '^[1-9][0-9]{0,9}(-[1-9][0-9]{0,9})?$' then split_part(p_vehicle,'-',1)::bigint else 0 end
   and (position('-' in p_vehicle)=0 or mo.id is not null)
 )
 select l.* from public.listings l where l.status='active'
 and (p_viewer is not distinct from auth.uid() or current_user='service_role')
 and (public.profile_is_visible(l.seller_id) or l.seller_id=p_viewer)
 and (trim(p_query)='' or l.id in(select id from public.marketplace_search_rows(p_query)))
 and (p_vehicle='' or exists(select 1 from selection s where public.marketplace_match_evidence(l.id,s.make,s.model,p_vyear,p_viewer) in ('seller_stated','source_model','year_needed')))
 and ((p_ymin=0 and p_ymax=9999) or exists(select 1 from public.cars c where c.id=l.source_car_id and (c.is_public or c.owner_id=p_viewer) and (public.profile_is_visible(c.owner_id) or c.owner_id=p_viewer) and c.year between p_ymin and p_ymax))
 and (not p_fit or exists(select 1 from public.cars g where g.owner_id=p_viewer and g.make is not null and g.model is not null
   and public.marketplace_match_evidence(l.id,g.make,g.model,coalesce(g.year,0),p_viewer) in ('seller_stated','source_model')));
$$;
revoke all on function public.marketplace_browse_rows(text,text,int,int,int,boolean,uuid) from public;
grant execute on function public.marketplace_browse_rows(text,text,int,int,int,boolean,uuid) to anon,authenticated,service_role;

create or replace function public.marketplace_category_counts()
returns table(category text,subcategory text,total bigint) language sql stable security invoker set search_path=public,pg_temp as $$
 select l.category,l.subcategory,count(*) from public.marketplace_browse_rows() l group by l.category,l.subcategory;
$$;
revoke all on function public.marketplace_category_counts() from public;
grant execute on function public.marketplace_category_counts() to anon,authenticated,service_role;

-- Add metadata without changing any existing criteria or alert opt-in.
update public.saved_searches set params=params || jsonb_build_object('_version','2') || case when params->>'fit'='1' then jsonb_build_object('_garage','dynamic') else '{}'::jsonb end where not params ? '_version';

-- Serialize saves per account so double-clicks and concurrent tabs cannot
-- create duplicate canonical definitions. Ownership is still enforced by RLS.
create or replace function public.save_marketplace_search(p_name text,p_params jsonb)
returns uuid language plpgsql security invoker set search_path=public,pg_temp as $$
declare found_id uuid;
begin
 if auth.uid() is null then raise exception 'Sign in to save searches'; end if;
 if jsonb_typeof(p_params)<>'object' or p_params->>'_version' is distinct from '2' or octet_length(p_params::text)>5000 then raise exception 'Invalid saved search'; end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,0));
 select id into found_id from public.saved_searches where user_id=auth.uid() and params=p_params order by created_at limit 1;
 if found_id is not null then return found_id; end if;
 insert into public.saved_searches(user_id,name,params,alert) values(auth.uid(),left(p_name,120),p_params,false) returning id into found_id;
 return found_id;
end;
$$;
revoke all on function public.save_marketplace_search(text,jsonb) from public;
grant execute on function public.save_marketplace_search(text,jsonb) to authenticated;
-- Set the requested state instead of deriving a toggle from a separate read.
-- Repeated controls, retries, and stale tabs therefore converge on the state
-- the member clicked without unique-key races or accidental double toggles.
create or replace function public.set_social_relationship(
  p_kind text,
  p_target_type text,
  p_target_id uuid,
  p_active boolean
) returns boolean
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if p_target_id is null or p_active is null then
    raise exception 'Target and desired state are required' using errcode = '22023';
  end if;

  if p_kind = 'save' and p_target_type in ('listing', 'car', 'profile', 'post') then
    if p_active then
      insert into public.saves(user_id, target_type, target_id)
      values(uid, p_target_type, p_target_id)
      on conflict(user_id, target_type, target_id) do nothing;
    else
      delete from public.saves
      where user_id = uid and target_type = p_target_type and target_id = p_target_id;
    end if;
  elsif p_kind = 'like' and p_target_type in ('listing', 'car') then
    if p_active then
      insert into public.likes(user_id, target_type, target_id)
      values(uid, p_target_type, p_target_id)
      on conflict(user_id, target_type, target_id) do nothing;
    else
      delete from public.likes
      where user_id = uid and target_type = p_target_type and target_id = p_target_id;
    end if;
  elsif p_kind = 'follow' and p_target_type in ('car', 'profile') then
    if p_active then
      insert into public.follows(follower_id, target_type, target_id)
      values(uid, p_target_type, p_target_id)
      on conflict(follower_id, target_type, target_id) do nothing;
    else
      delete from public.follows
      where follower_id = uid and target_type = p_target_type and target_id = p_target_id;
    end if;
  else
    raise exception 'Unsupported social relationship' using errcode = '22023';
  end if;

  return p_active;
end;
$$;

revoke all on function public.set_social_relationship(text,text,uuid,boolean) from public, anon;
grant execute on function public.set_social_relationship(text,text,uuid,boolean) to authenticated;


create table if not exists public.worker_runs (
 id uuid primary key, family text not null, started_at timestamptz not null default now(), finished_at timestamptz,
 status text not null default 'running' check(status in ('running','succeeded','failed')), summary jsonb
);
alter table public.worker_runs enable row level security;
revoke all on public.worker_runs from public,anon,authenticated;
grant all on public.worker_runs to service_role;
create index if not exists worker_runs_family_time on public.worker_runs(family,started_at desc);
create or replace function public.record_worker_run(p_id uuid,p_family text,p_status text,p_summary jsonb default null) returns void
language plpgsql security invoker set search_path=public,pg_temp as $$
begin
 if p_status='running' then insert into public.worker_runs(id,family) values(p_id,p_family);
 else update public.worker_runs set finished_at=now(),status=p_status,summary=p_summary where id=p_id and family=p_family and status='running';
 if not found then raise exception 'Unknown worker run'; end if; end if;
end $$;
revoke all on function public.record_worker_run(uuid,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.record_worker_run(uuid,text,text,jsonb) to service_role;


notify pgrst,'reload schema';
commit;
