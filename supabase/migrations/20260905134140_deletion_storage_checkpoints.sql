begin;
create table public.deletion_storage_tasks(
 job_id uuid not null references public.remediation_jobs(id) on delete cascade,
 bucket text not null check(bucket in ('avatars','car-images','activity-images','listing-images')),
 path text not null, folder boolean not null, page_offset int not null default 0,
 status text not null default 'pending' check(status in ('pending','scanned','deleted','retained')),
 primary key(job_id,bucket,path)
);
alter table public.deletion_storage_tasks enable row level security;
revoke all on public.deletion_storage_tasks from public,anon,authenticated;
grant all on public.deletion_storage_tasks to service_role;
create index deletion_storage_pending on public.deletion_storage_tasks(job_id,folder,status);
create or replace function public.continue_account_deletion(p_job uuid,p_lease uuid) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 update public.remediation_jobs set status='pending',next_attempt_at=now(),locked_until=null,lease_id=null,attempts=0
 where id=p_job and kind='delete_account' and status='processing' and lease_id=p_lease and locked_until>now();
 if not found then raise exception 'Deletion lease lost'; end if;
end $$;
revoke all on function public.continue_account_deletion(uuid,uuid) from public,anon,authenticated;
grant execute on function public.continue_account_deletion(uuid,uuid) to service_role;
create or replace function public.assert_deletion_ready(p_user uuid) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare uid uuid:=p_user;
begin
 if exists(select 1 from public.orders where (buyer_id=uid or seller_id=uid) and status not in ('completed','cancelled','payment_failed','refunded'))
 or exists(select 1 from public.transfer_intents where seller_id=uid and status not in ('transferred','cancelled'))
 or exists(select 1 from public.refund_operations r join public.orders o on o.id=r.order_id where (o.buyer_id=uid or o.seller_id=uid) and r.status<>'completed')
 or exists(select 1 from public.payment_requests p where p.request->>'buyerId'=uid::text and p.provider_reference is null)
 or exists(select 1 from public.payment_recoveries r join public.orders o on o.id=r.order_id where r.status='open' and (o.buyer_id=uid or o.seller_id=uid))
 or exists(select 1 from public.payment_recoveries r join public.payments p on r.recovery_key='capture:'||p.provider_reference join public.orders o on o.id=p.order_id where r.status='open' and (o.buyer_id=uid or o.seller_id=uid))
 or exists(select 1 from public.returns r join public.orders o on o.id=r.order_id where (o.buyer_id=uid or o.seller_id=uid) and r.status not in ('completed','rejected','expired','cancelled')) then
 raise exception 'Finish outstanding orders, returns and payment obligations before requesting deletion'; end if;
end $$;
revoke all on function public.assert_deletion_ready(uuid) from public,anon,authenticated;
grant execute on function public.assert_deletion_ready(uuid) to service_role;
notify pgrst,'reload schema';
commit;
