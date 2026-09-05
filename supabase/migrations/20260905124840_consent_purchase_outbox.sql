begin;
alter table public.remediation_jobs drop constraint remediation_jobs_kind_check;
alter table public.remediation_jobs add constraint remediation_jobs_kind_check check(kind in ('receipt','search','delete_account','reservation_expiry','analytics'));
create table public.analytics_consents(user_id uuid primary key references public.profiles(id) on delete cascade,allowed boolean not null default false,version uuid not null default gen_random_uuid(),expires_at timestamptz not null default now()+interval '180 days');
alter table public.analytics_consents enable row level security;
revoke all on public.analytics_consents from public,anon,authenticated;
grant select on public.analytics_consents to authenticated;
grant all on public.analytics_consents to service_role;
create policy "own analytics preference" on public.analytics_consents for select to authenticated using(user_id=auth.uid());
alter table public.orders add column analytics_consent_version uuid;
create or replace function public.set_analytics_consent(p_allowed boolean) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if auth.uid() is null or not public.profile_is_visible(auth.uid()) then raise exception 'Active account required' using errcode='42501'; end if;
 insert into public.analytics_consents(user_id,allowed) values(auth.uid(),p_allowed)
 on conflict(user_id) do update set allowed=p_allowed,version=gen_random_uuid(),expires_at=now()+interval '180 days';
end $$;
create or replace function public.bind_checkout_analytics(p_orders uuid[]) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if auth.uid() is null then return; end if;
 update public.orders set analytics_consent_version=c.version from public.analytics_consents c
 where orders.id=any(p_orders) and orders.buyer_id=auth.uid() and orders.status in ('pending','requires_action')
 and c.user_id=auth.uid() and c.allowed and c.expires_at>now();
end $$;
revoke all on function public.set_analytics_consent(boolean),public.bind_checkout_analytics(uuid[]) from public,anon;
grant execute on function public.set_analytics_consent(boolean),public.bind_checkout_analytics(uuid[]) to authenticated;
create or replace function public.queue_purchase_analytics() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if new.status='paid' and old.status in ('pending','requires_action') and exists(select 1 from public.analytics_consents c where c.user_id=new.buyer_id and c.allowed and c.version=new.analytics_consent_version and c.expires_at>now()) then
  insert into public.remediation_jobs(kind,dedup_key,payload) values('analytics','purchase:'||new.id,jsonb_build_object('user_id',new.buyer_id,'consent_version',new.analytics_consent_version)) on conflict(dedup_key) do nothing;
 end if;
 return new;
end $$;
revoke all on function public.queue_purchase_analytics() from public,anon,authenticated;
create trigger purchase_analytics after update of status on public.orders for each row execute function public.queue_purchase_analytics();
notify pgrst,'reload schema';
commit;
