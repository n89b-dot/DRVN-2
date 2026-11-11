begin;

alter table public.account_export_requests
  add column if not exists last_purge_attempt_at timestamptz,
  add column if not exists purged_at timestamptz;
create index if not exists account_export_requests_purge_due_idx
  on public.account_export_requests(last_purge_attempt_at,expires_at)
  where status='expired';

alter table public.account_export_requests drop constraint account_export_requests_contract_version_check;
alter table public.account_export_requests add constraint account_export_requests_contract_version_check
  check (contract_version in ('2026-09-05.v1','2026-09-05.v2'));
update public.account_export_requests set status='expired',expires_at=least(expires_at,now()),last_error='Superseded by export contract 2026-09-05.v2'
 where contract_version='2026-09-05.v1' and status in ('pending','processing','failed');

-- A deletion-suspended identity cannot start another export through a stale
-- access token. Keep the original request deduplication contract.
create or replace function public.request_account_export() returns uuid
language plpgsql security definer set search_path=public,pg_temp as $$
declare uid uuid := auth.uid(); request_id uuid;
begin
  if uid is null then raise exception 'Sign in first' using errcode='42501'; end if;
  -- Shared with deletion and export publication so eligibility changes are
  -- serialized in one order for this account.
  perform pg_advisory_xact_lock(hashtextextended(uid::text,0));
  perform 1 from public.profiles where id=uid and suspended_at is null for share;
  if not found then raise exception 'Account access is suspended' using errcode='42501'; end if;
  select id into request_id from public.account_export_requests
   where user_id=uid and status in ('pending','processing') and expires_at>now()
   order by requested_at desc limit 1;
  if found then return request_id; end if;
  insert into public.account_export_requests(user_id,contract_version)
    values(uid,'2026-09-05.v2') returning id into request_id;
  insert into public.remediation_jobs(kind,dedup_key,payload)
    values('account_export','export:'||request_id,jsonb_build_object('request_id',request_id,'user_id',uid))
    on conflict(dedup_key) do nothing;
  return request_id;
end $$;
revoke all on function public.request_account_export() from public,anon;
grant execute on function public.request_account_export() to authenticated;

-- Expire active packages atomically when cleanup begins. Completed packages
-- are removed by the deletion worker before Auth deletion.
create or replace function public.request_account_deletion() returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare uid uuid:=auth.uid(); job uuid; blockers jsonb; existing_case public.account_deletion_requests%rowtype;
begin
  if uid is null then raise exception 'Sign in first' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended(uid::text,0));
  if exists(select 1 from public.profiles where id=uid and suspended_at is not null) then
    select * into existing_case from public.account_deletion_requests where user_id=uid;
    if existing_case.outcome='cleanup_pending' then
      return jsonb_build_object('outcome','cleanup_pending','job_id',existing_case.job_id,'message','Account cleanup is already in progress.');
    elsif existing_case.outcome='operator_attention' then
      return jsonb_build_object('outcome','operator_attention','message',existing_case.next_action);
    end if;
    raise exception 'Account access is suspended' using errcode='42501';
  end if;
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
  -- Expire every package before suspending access. A download that begins
  -- after this transaction commits cannot observe a completed package.
  update public.account_export_requests set status='expired',expires_at=least(expires_at,now()),last_error='Expired because account deletion began'
    where user_id=uid and status<>'expired';
  update public.profiles set suspended_at=coalesce(suspended_at,now()),suspended_reason='Account deletion requested' where id=uid;
  update public.listings set status='paused' where seller_id=uid and status='active';
  if job is null then
    insert into public.remediation_jobs(kind,dedup_key,payload) values('delete_account','delete:'||uid,jsonb_build_object('user_id',uid)) returning id into job;
  end if;
  insert into public.account_deletion_requests(user_id,job_id,outcome,blocker_code,affected_data_classes,next_action,responsible_owner,policy_decisions_pending)
  values(uid,job,'cleanup_pending',null,array['profile','owned content','uploads','provider customer'],'Automated cleanup is in progress.','privacy worker',array['financial record retention duration','audit/log retention','backup expiry','eventual identity anonymization'])
  on conflict(user_id) do update set job_id=excluded.job_id,outcome=excluded.outcome,blocker_code=null,affected_data_classes=excluded.affected_data_classes,next_action=excluded.next_action,responsible_owner=excluded.responsible_owner,policy_decisions_pending=excluded.policy_decisions_pending,updated_at=now();
  return jsonb_build_object('outcome','cleanup_pending','job_id',job,'message','Account cleanup has been queued.');
end $$;
revoke all on function public.request_account_deletion() from public,anon;
grant execute on function public.request_account_deletion() to authenticated;

-- The database checkpoint is the authority after a storage upload. A stale
-- worker lease, an expired request, or deletion suspension rejects the write.
create or replace function public.write_account_export(
 p_job uuid,p_lease uuid,p_request uuid,p_part jsonb default null,
 p_checkpoint jsonb default null,p_manifest jsonb default null,p_error text default null
) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare job public.remediation_jobs%rowtype; request public.account_export_requests%rowtype;
begin
 select * into job from public.remediation_jobs where id=p_job for update;
 if job.id is null or job.kind<>'account_export' or job.status<>'processing' or job.lease_id is distinct from p_lease or job.locked_until<=now() or job.payload->>'request_id'<>p_request::text then raise exception 'Export lease lost'; end if;
 perform pg_advisory_xact_lock(hashtextextended((job.payload->>'user_id'),0));
 perform 1 from public.profiles where id=(job.payload->>'user_id')::uuid and suspended_at is null for share;
 if not found then raise exception 'Export unavailable'; end if;
 select * into request from public.account_export_requests where id=p_request for update;
 if request.id is null or request.user_id::text<>job.payload->>'user_id' or request.expires_at<=now() or request.status in ('expired','completed')
    or exists(select 1 from public.profiles where id=request.user_id and suspended_at is not null)
 then raise exception 'Export unavailable'; end if;
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
