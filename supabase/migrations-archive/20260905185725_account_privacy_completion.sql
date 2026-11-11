begin;

-- R05: durable, owner-visible export requests. Export bytes live only in the
-- private account-exports bucket; the manifest records every immutable part.
alter table public.remediation_jobs drop constraint if exists remediation_jobs_kind_check;
alter table public.remediation_jobs add constraint remediation_jobs_kind_check
  check (kind in ('receipt','search','delete_account','account_export','reservation_expiry','analytics'));

create table public.account_export_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  contract_version text not null check (contract_version = '2026-09-05.v1'),
  cutoff_at timestamptz not null default statement_timestamp(),
  status text not null default 'pending' check (status in ('pending','processing','completed','failed','expired')),
  current_section int not null default 0 check (current_section >= 0),
  current_offset int not null default 0 check (current_offset >= 0),
  current_cursor text,
  manifest jsonb,
  manifest_path text,
  last_error text,
  requested_at timestamptz not null default now(),
  completed_at timestamptz,
  expires_at timestamptz not null default now() + interval '7 days'
);
create index account_export_requests_owner_idx on public.account_export_requests(user_id, requested_at desc);
create index account_export_requests_expiry_idx on public.account_export_requests(expires_at) where status = 'completed';
alter table public.account_export_requests enable row level security;
revoke all on public.account_export_requests from public, anon, authenticated;
grant select on public.account_export_requests to authenticated;
grant all on public.account_export_requests to service_role;
create policy "owners read account export requests" on public.account_export_requests
  for select to authenticated using ((select auth.uid()) = user_id);

create table public.account_export_parts (
  request_id uuid not null references public.account_export_requests(id) on delete cascade,
  section_key text not null,
  page_number int not null check (page_number >= 0),
  object_path text not null unique,
  row_count int not null check (row_count >= 0),
  byte_count int not null check (byte_count >= 0),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  content_type text not null default 'application/json',
  created_at timestamptz not null default now(),
  primary key(request_id, section_key, page_number)
);
alter table public.account_export_parts enable row level security;
revoke all on public.account_export_parts from public, anon, authenticated;
grant all on public.account_export_parts to service_role;

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('account-exports', 'account-exports', false, 20971520, null)
on conflict(id) do update set public=false, file_size_limit=excluded.file_size_limit,
  allowed_mime_types=excluded.allowed_mime_types;

create or replace function public.request_account_export() returns uuid
language plpgsql security definer set search_path=public,pg_temp as $$
declare uid uuid := auth.uid(); request_id uuid;
begin
  if uid is null then raise exception 'Sign in first' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended('export:'||uid::text,0));
  select id into request_id from public.account_export_requests
   where user_id=uid and status in ('pending','processing') and expires_at>now()
   order by requested_at desc limit 1;
  if found then return request_id; end if;
  insert into public.account_export_requests(user_id,contract_version)
    values(uid,'2026-09-05.v1') returning id into request_id;
  insert into public.remediation_jobs(kind,dedup_key,payload)
    values('account_export','export:'||request_id,jsonb_build_object('request_id',request_id,'user_id',uid))
    on conflict(dedup_key) do nothing;
  return request_id;
end $$;
revoke all on function public.request_account_export() from public,anon;
grant execute on function public.request_account_export() to authenticated;

create or replace function public.continue_account_export(p_job uuid,p_lease uuid) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  update public.remediation_jobs set status='pending',next_attempt_at=now(),locked_until=null,lease_id=null,attempts=greatest(attempts-1,0)
   where id=p_job and kind='account_export' and status='processing' and lease_id=p_lease and locked_until>now();
  if not found then raise exception 'Export lease lost'; end if;
end $$;
revoke all on function public.continue_account_export(uuid,uuid) from public,anon,authenticated;
grant execute on function public.continue_account_export(uuid,uuid) to service_role;

-- R06: the request record remains truthful when policy or immutable references
-- prevent hard deletion. review_at is nullable until the policy owner supplies it.
create table public.account_deletion_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid unique references auth.users(id) on delete set null,
  job_id uuid references public.remediation_jobs(id) on delete set null,
  outcome text not null check (outcome in ('temporary_financial_hold','cleanup_pending','operator_attention','completed')),
  blocker_code text,
  affected_data_classes text[] not null default '{}',
  next_action text not null,
  responsible_owner text,
  review_at timestamptz,
  policy_decisions_pending text[] not null default '{}',
  requested_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);
alter table public.account_deletion_requests enable row level security;
revoke all on public.account_deletion_requests from public,anon,authenticated;
grant select on public.account_deletion_requests to authenticated;
grant all on public.account_deletion_requests to service_role;
create policy "owners read deletion requests" on public.account_deletion_requests
  for select to authenticated using ((select auth.uid())=user_id);

insert into public.account_deletion_requests(user_id,job_id,outcome,next_action,responsible_owner)
 select (j.payload->>'user_id')::uuid,j.id,'cleanup_pending','Previously queued cleanup will continue.','privacy worker'
 from public.remediation_jobs j join auth.users u on u.id::text=j.payload->>'user_id'
 where j.kind='delete_account' and j.status<>'completed'
 on conflict(user_id) do nothing;

create or replace function public.account_deletion_blockers(p_user uuid) returns jsonb
language sql stable security definer set search_path=public,pg_temp as $$
  select jsonb_build_object(
    'financial_hold',
      exists(select 1 from public.orders where (buyer_id=p_user or seller_id=p_user) and status not in ('completed','cancelled','payment_failed','refunded'))
      or exists(select 1 from public.transfer_intents where seller_id=p_user and status not in ('transferred','cancelled'))
      or exists(select 1 from public.refund_operations r join public.orders o on o.id=r.order_id where (o.buyer_id=p_user or o.seller_id=p_user) and r.status<>'completed')
      or exists(select 1 from public.payment_requests p where p.request->>'buyerId'=p_user::text and p.provider_reference is null)
      or exists(select 1 from public.payment_recoveries r join public.orders o on o.id=r.order_id where r.status='open' and (o.buyer_id=p_user or o.seller_id=p_user))
      or exists(select 1 from public.returns r join public.orders o on o.id=r.order_id where (o.buyer_id=p_user or o.seller_id=p_user) and r.status not in ('completed','rejected','expired','cancelled')),
    'retained_identity',
      exists(select 1 from public.orders where buyer_id=p_user or seller_id=p_user)
      or exists(select 1 from public.admin_audit_log where actor_id=p_user)
      or exists(select 1 from public.reports where reporter_id=p_user or resolved_by=p_user)
      or exists(select 1 from public.refund_operations where requested_by=p_user::text)
  );
$$;
revoke all on function public.account_deletion_blockers(uuid) from public,anon,authenticated;
grant execute on function public.account_deletion_blockers(uuid) to service_role;

create or replace function public.pause_account_deletion_hold(p_job uuid,p_lease uuid,p_user uuid) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  update public.remediation_jobs set status='pending',next_attempt_at=now()+interval '1 hour',locked_until=null,lease_id=null,attempts=greatest(attempts-1,0),last_error=null
   where id=p_job and kind='delete_account' and status='processing' and lease_id=p_lease and locked_until>now();
  if not found then raise exception 'Deletion lease lost'; end if;
  update public.account_deletion_requests set outcome='temporary_financial_hold',blocker_code='active_financial_obligations',
    affected_data_classes=array['orders','returns','refunds','payouts'],next_action='The privacy worker will recheck after active financial obligations settle.',
    responsible_owner='privacy worker',updated_at=now() where user_id=p_user;
end $$;
revoke all on function public.pause_account_deletion_hold(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.pause_account_deletion_hold(uuid,uuid,uuid) to service_role;

drop function public.request_account_deletion();
create function public.request_account_deletion() returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare uid uuid:=auth.uid(); job uuid; blockers jsonb;
begin
  if uid is null then raise exception 'Sign in first' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended(uid::text,0));
  if exists(select 1 from public.admin_users where user_id=uid) then
    insert into public.account_deletion_requests(user_id,outcome,blocker_code,affected_data_classes,next_action,responsible_owner,policy_decisions_pending)
    values(uid,'operator_attention','admin_membership',array['administrator identity','audit trail'],'An operator must remove administrator access and review the retained audit identity.','operations',array['audit identity retention duration','retained identity anonymization'])
    on conflict(user_id) do update set outcome=excluded.outcome,blocker_code=excluded.blocker_code,affected_data_classes=excluded.affected_data_classes,next_action=excluded.next_action,responsible_owner=excluded.responsible_owner,policy_decisions_pending=excluded.policy_decisions_pending,updated_at=now();
    return jsonb_build_object('outcome','operator_attention','message','Administrator accounts require operator review before deletion.');
  end if;
  blockers:=public.account_deletion_blockers(uid);
  if (blockers->>'financial_hold')::boolean then
    insert into public.account_deletion_requests(user_id,outcome,blocker_code,affected_data_classes,next_action,responsible_owner,policy_decisions_pending)
    values(uid,'temporary_financial_hold','active_financial_obligations',array['orders','returns','refunds','payouts'],'Finish outstanding orders, returns, refunds, and payouts, then request deletion again.','account owner',array['financial record retention duration','eventual identity anonymization'])
    on conflict(user_id) do update set outcome=excluded.outcome,blocker_code=excluded.blocker_code,affected_data_classes=excluded.affected_data_classes,next_action=excluded.next_action,responsible_owner=excluded.responsible_owner,policy_decisions_pending=excluded.policy_decisions_pending,updated_at=now();
    return jsonb_build_object('outcome','temporary_financial_hold','message','Deletion is on hold while financial obligations remain. You can keep using your account to finish them.');
  end if;
  select id into job from public.remediation_jobs where dedup_key='delete:'||uid;
  if job is null then
  update public.profiles set suspended_at=coalesce(suspended_at,now()),suspended_reason='Account deletion requested' where id=uid;
  update public.listings set status='paused' where seller_id=uid and status='active';
    insert into public.remediation_jobs(kind,dedup_key,payload) values('delete_account','delete:'||uid,jsonb_build_object('user_id',uid)) returning id into job;
  end if;
  insert into public.account_deletion_requests(user_id,job_id,outcome,blocker_code,affected_data_classes,next_action,responsible_owner,policy_decisions_pending)
  values(uid,job,'cleanup_pending',null,array['profile','owned content','uploads','provider customer'],'Automated cleanup is in progress.','privacy worker',array['financial record retention duration','audit/log retention','backup expiry','eventual identity anonymization'])
  on conflict(user_id) do update set job_id=excluded.job_id,outcome=excluded.outcome,blocker_code=null,affected_data_classes=excluded.affected_data_classes,next_action=excluded.next_action,responsible_owner=excluded.responsible_owner,policy_decisions_pending=excluded.policy_decisions_pending,updated_at=now();
  return jsonb_build_object('outcome','cleanup_pending','job_id',job,'message','Account cleanup has been queued.');
end $$;
revoke all on function public.request_account_deletion() from public,anon;
grant execute on function public.request_account_deletion() to authenticated;

create or replace function public.write_account_export(
 p_job uuid,p_lease uuid,p_request uuid,p_part jsonb default null,
 p_checkpoint jsonb default null,p_manifest jsonb default null,p_error text default null
) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare job public.remediation_jobs%rowtype; request public.account_export_requests%rowtype;
begin
 select * into job from public.remediation_jobs where id=p_job for update;
 if job.id is null or job.kind<>'account_export' or job.status<>'processing' or job.lease_id is distinct from p_lease or job.locked_until<=now() or job.payload->>'request_id'<>p_request::text then raise exception 'Export lease lost'; end if;
 select * into request from public.account_export_requests where id=p_request for update;
 if request.id is null or request.user_id::text<>job.payload->>'user_id' or request.expires_at<=now() or request.status in ('expired','completed') then raise exception 'Export unavailable'; end if;
 if p_part is not null then
  if p_part->>'object_path' not like request.user_id::text||'/'||request.id::text||'/%' then raise exception 'Invalid export object ownership'; end if;
  insert into public.account_export_parts(request_id,section_key,page_number,object_path,row_count,byte_count,sha256,content_type)
  values(request.id,p_part->>'section_key',(p_part->>'page_number')::int,p_part->>'object_path',(p_part->>'row_count')::int,(p_part->>'byte_count')::int,p_part->>'sha256',p_part->>'content_type')
  on conflict(request_id,section_key,page_number) do update set object_path=excluded.object_path,row_count=excluded.row_count,byte_count=excluded.byte_count,sha256=excluded.sha256,content_type=excluded.content_type;
 end if;
 if p_checkpoint is not null then
  update public.account_export_requests set status='processing',last_error=null,current_section=(p_checkpoint->>'section')::int,current_offset=(p_checkpoint->>'offset')::int,current_cursor=p_checkpoint->>'cursor' where id=request.id;
 end if;
 if p_manifest is not null then
  update public.account_export_requests set status='completed',manifest=p_manifest,
   manifest_path=(select object_path from public.account_export_parts where request_id=request.id and section_key='manifest' and page_number=0),completed_at=now(),last_error=null where id=request.id;
 end if;
 if p_error is not null then update public.account_export_requests set status='failed',last_error=left(p_error,500) where id=request.id; end if;
end $$;
revoke all on function public.write_account_export(uuid,uuid,uuid,jsonb,jsonb,jsonb,text) from public,anon,authenticated;
grant execute on function public.write_account_export(uuid,uuid,uuid,jsonb,jsonb,jsonb,text) to service_role;
notify pgrst,'reload schema';

commit;
