begin;
create or replace function public.worker_health_snapshot() returns jsonb
language sql security definer set search_path=public,pg_temp as $$
 select jsonb_build_object('families',(select coalesce(jsonb_agg(x),'[]') from (
 select f.family,max(r.finished_at) filter(where r.status='succeeded') last_success,
 coalesce(max(r.finished_at) filter(where r.status='succeeded')<now()-f.budget,true) stale
 from (values ('expiries',interval '30 minutes'),('captures',interval '30 minutes'),('transfers',interval '30 minutes'),('transferReconciliation',interval '30 minutes'),('refunds',interval '30 minutes'),('returns',interval '30 minutes'),('disputes',interval '30 minutes'),('alerts',interval '30 minutes'),('receipts',interval '30 minutes'),('analytics',interval '30 minutes'),('search',interval '30 minutes'),('deletions',interval '30 minutes'),('savedSearches',interval '90 minutes'),('media',interval '26 hours')) f(family,budget)
 left join public.worker_runs r on r.family=f.family group by f.family,f.budget) x),
 'queues',(select coalesce(jsonb_agg(q),'[]') from (
 select kind,status,count(*) count,min(created_at) oldest from public.remediation_jobs where status<>'completed' group by kind,status
 union all select 'alerts',status,count(*),min(created_at) from public.admin_alert_outbox where status='failed' group by status
 union all select 'transfers',status,count(*),min(created_at) from public.transfer_intents where status='failed' group by status
 union all select 'refunds',status,count(*),min(created_at) from public.refund_operations where status='failed' group by status
 union all select 'capture_recovery',status,count(*),min(created_at) from public.payment_recoveries where status='open' and kind='capture_unresolved' group by status
 ) q));
$$;
-- Rebuild work is persisted and resumed, rather than one process holding the catalog.
create table public.search_rebuilds(id uuid primary key default gen_random_uuid(),entity text not null check(entity in ('listing','car','profile','update')),cursor uuid,status text not null default 'pending' check(status in ('pending','completed')),created_at timestamptz not null default now());
alter table public.search_rebuilds enable row level security;
revoke all on public.search_rebuilds from public,anon,authenticated;
grant all on public.search_rebuilds to service_role;
create or replace function public.advance_search_rebuild(p_run uuid) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.search_rebuilds; target text; ids uuid[]; item uuid;
begin
 select * into r from public.search_rebuilds where id=p_run for update;
 if not found then raise exception 'Unknown rebuild'; end if;
 if r.status='completed' then return jsonb_build_object('completed',true,'queued',0); end if;
 target:=case r.entity when 'listing' then 'listings' when 'car' then 'cars' when 'profile' then 'profiles' when 'update' then 'activity_posts' end;
 execute format('select array_agg(id order by id) from (select id from public.%I where ($1 is null or id>$1) order by id limit 500) page',target) into ids using r.cursor;
 foreach item in array coalesce(ids,'{}'::uuid[]) loop
   insert into public.remediation_jobs(kind,dedup_key,payload) values('search','rebuild:'||r.id||':'||item,jsonb_build_object('entity',r.entity,'id',item)) on conflict(dedup_key) do nothing;
 end loop;
 update public.search_rebuilds set cursor=coalesce(ids[cardinality(ids)],cursor),status=case when coalesce(cardinality(ids),0)<500 then 'completed' else 'pending' end where id=p_run;
 return jsonb_build_object('completed',coalesce(cardinality(ids),0)<500,'queued',coalesce(cardinality(ids),0));
end $$;
revoke all on function public.advance_search_rebuild(uuid) from public,anon,authenticated;
grant execute on function public.advance_search_rebuild(uuid) to service_role;
notify pgrst,'reload schema';
commit;
