begin;
create or replace function public.request_account_deletion() returns uuid
language plpgsql security definer set search_path=public,pg_temp as $$
declare uid uuid:=auth.uid(); job uuid;
begin
 if uid is null then raise exception 'Sign in first' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtextextended(uid::text,0));
 select id into job from public.remediation_jobs where dedup_key='delete:'||uid;
 if found then return job; end if;
 perform 1 from public.profiles where id=uid for update;
 if exists(select 1 from public.admin_users where user_id=uid) then raise exception 'Remove admin membership before deleting this account'; end if;
 if exists(select 1 from public.orders where (buyer_id=uid or seller_id=uid) and status not in ('completed','cancelled','payment_failed','refunded'))
 or exists(select 1 from public.transfer_intents where seller_id=uid and status not in ('transferred','cancelled'))
 or exists(select 1 from public.refund_operations r join public.orders o on o.id=r.order_id where (o.buyer_id=uid or o.seller_id=uid) and r.status<>'completed')
 or exists(select 1 from public.payment_requests p where p.request->>'buyerId'=uid::text and p.provider_reference is null)
 or exists(select 1 from public.payment_recoveries r join public.orders o on o.id=r.order_id where r.status='open' and (o.buyer_id=uid or o.seller_id=uid))
 or exists(select 1 from public.payment_recoveries r join public.payments p on r.recovery_key='capture:'||p.provider_reference join public.orders o on o.id=p.order_id where r.status='open' and (o.buyer_id=uid or o.seller_id=uid))
 or exists(select 1 from public.returns r join public.orders o on o.id=r.order_id where (o.buyer_id=uid or o.seller_id=uid) and r.status not in ('completed','rejected','expired','cancelled')) then
 raise exception 'Finish outstanding orders, returns and payment obligations before requesting deletion'; end if;
 update public.profiles set suspended_at=coalesce(suspended_at,now()),suspended_reason='Account deletion requested' where id=uid;
 update public.listings set status='paused' where seller_id=uid and status='active';
 insert into public.remediation_jobs(kind,dedup_key,payload) values('delete_account','delete:'||uid,jsonb_build_object('user_id',uid)) on conflict(dedup_key) do nothing;
 select id into job from public.remediation_jobs where dedup_key='delete:'||uid;
 return job;
end $$;
revoke all on function public.request_account_deletion() from public,anon;
grant execute on function public.request_account_deletion() to authenticated;

create or replace function public.block_deleted_account_writes() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if auth.uid() is not null and exists(select 1 from public.remediation_jobs where dedup_key='delete:'||auth.uid()) then
 raise exception 'Account deletion is pending' using errcode='42501'; end if;
 return null;
end $$;
notify pgrst,'reload schema';
commit;
