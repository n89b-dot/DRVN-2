begin;
create index remediation_search_identity on public.remediation_jobs((payload->>'entity'),(payload->>'id'),status,locked_until) where kind='search';
create or replace function public.enqueue_search_document(p_entity text,p_id uuid) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if p_entity not in ('listing','car','profile','update') then raise exception 'Unknown search family'; end if;
 insert into public.remediation_jobs(kind,dedup_key,payload) values('search','search:explicit:'||p_entity||':'||p_id||':'||txid_current(),jsonb_build_object('entity',p_entity,'id',p_id)) on conflict(dedup_key) do nothing;
end $$;
revoke all on function public.enqueue_search_document(text,uuid) from public,anon,authenticated;
grant execute on function public.enqueue_search_document(text,uuid) to service_role;
create or replace function public.claim_search_jobs() returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare result jsonb;
begin
 -- Serialize claim selection only, never hold a transaction during HTTP work.
 perform pg_advisory_xact_lock(hashtextextended('search-job-claim',0));
 update public.remediation_jobs set status='failed',last_error='Search lease retry limit reached',locked_until=null where kind='search' and status='processing' and locked_until<now() and attempts>=10;
 with candidates as (
 select distinct on (j.payload->>'entity',j.payload->>'id') j.id,j.next_attempt_at
 from public.remediation_jobs j where j.kind='search' and j.attempts<10 and j.next_attempt_at<=now()
 and (j.status='pending' or (j.status='processing' and j.locked_until<now()))
 and not exists(select 1 from public.remediation_jobs active where active.kind='search' and active.status='processing' and active.locked_until>now() and active.payload->>'entity'=j.payload->>'entity' and active.payload->>'id'=j.payload->>'id')
 order by j.payload->>'entity',j.payload->>'id',j.created_at,j.id
 ), due as(select id from candidates order by next_attempt_at,id limit 10),
 claimed as(update public.remediation_jobs j set status='processing',attempts=attempts+1,lease_id=gen_random_uuid(),locked_until=now()+interval '2 minutes' from due where j.id=due.id returning j.*)
 select coalesce(jsonb_agg(claimed),'[]') into result from claimed;
 return result;
end $$;
revoke all on function public.claim_search_jobs() from public,anon,authenticated;
grant execute on function public.claim_search_jobs() to service_role;
create or replace function public.queue_search_change() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare r jsonb; entity text; target uuid;
begin
 r:=case when tg_op='DELETE' then to_jsonb(old) else to_jsonb(new) end;
 entity:=tg_argv[0]; target:=(r->>tg_argv[1])::uuid;
 insert into public.remediation_jobs(kind,dedup_key,payload) values('search','search:'||entity||':'||target||':'||txid_current(),jsonb_build_object('entity',entity,'id',target)) on conflict(dedup_key) do nothing;
 if entity='car' then
   insert into public.remediation_jobs(kind,dedup_key,payload)
   select 'search','search:update:'||id||':'||txid_current(),jsonb_build_object('entity','update','id',id) from public.activity_posts where car_id=target on conflict(dedup_key) do nothing;
 elsif entity='profile' then
   insert into public.remediation_jobs(kind,dedup_key,payload)
   select 'search','search:listing:'||id||':'||txid_current(),jsonb_build_object('entity','listing','id',id) from public.listings where seller_id=target on conflict(dedup_key) do nothing;
   insert into public.remediation_jobs(kind,dedup_key,payload)
   select 'search','search:car:'||id||':'||txid_current(),jsonb_build_object('entity','car','id',id) from public.cars where owner_id=target on conflict(dedup_key) do nothing;
   insert into public.remediation_jobs(kind,dedup_key,payload)
   select 'search','search:update:'||p.id||':'||txid_current(),jsonb_build_object('entity','update','id',p.id) from public.activity_posts p join public.cars c on c.id=p.car_id where c.owner_id=target or p.author_id=target on conflict(dedup_key) do nothing;
 end if;
 return coalesce(new,old);
end $$;
notify pgrst,'reload schema';
commit;
