-- OS-W11: the account privacy lifecycle.
--
--   N39  Suspended members couldn't export or delete their data
--        (docs/production-readiness-2026-11-03.md §2.2): request_account_export
--        and request_account_deletion refused anyone with suspended_at set,
--        so a moderation suspension took away a legal right. Now only a
--        deletion that has already begun refuses an export (its packages are
--        being destroyed) or answers a second deletion request with its own
--        state. A suspended member can ask for both.
--   N35  Nothing showed where a deletion stood (B7: "nothing finishes the
--        job", the member told "queued"). my_account_deletion_status() gives
--        the member their own case in plain terms; the admin console lists
--        every unfinished case (service role, src/lib/admin/queries.ts).
--
-- Redefined here, each from its latest definition with only the suspension
-- rule changed: request_account_export (20261025130000),
-- write_account_export (20260905203510) and request_account_deletion
-- (20261107200450, whose fresh sign-in check is kept — see
-- deletion_fresh_sign_in_guard.sql). This migration owns all three.

begin;

-- A deletion has begun when it is cleaning up or done, or the profile still
-- carries the deletion suspension (set in the same transaction that queues
-- the job). An admin re-suspending the account can't reopen exports: the
-- request row still says cleanup.
create or replace function private.account_deletion_started(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
           select 1 from public.account_deletion_requests r
            where r.user_id = p_user and r.outcome in ('cleanup_pending', 'completed')
         )
      or exists (
           select 1 from public.profiles p
            where p.id = p_user and p.suspended_at is not null
              and p.suspended_reason = 'Account deletion requested'
         );
$$;

revoke all on function private.account_deletion_started(uuid) from public, anon, authenticated;

create or replace function public.request_account_export()
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare uid uuid := auth.uid(); request_id uuid;
begin
  if uid is null then raise exception 'Sign in first' using errcode='42501'; end if;
  -- Shared with deletion and export publication so eligibility changes are
  -- serialized in one order for this account.
  perform pg_advisory_xact_lock(hashtextextended(uid::text,0));
  -- N39: a suspension doesn't take away the right to a copy of your data;
  -- only a deletion that has begun does (its packages are being destroyed).
  perform 1 from public.profiles where id=uid for share;
  if not found then raise exception 'Sign in first' using errcode='42501'; end if;
  if private.account_deletion_started(uid) then raise exception 'Account access is suspended' using errcode='42501'; end if;
  select id into request_id from public.account_export_requests
   where user_id=uid and status in ('pending','processing') and expires_at>now()
   order by requested_at desc limit 1;
  if found then return request_id; end if;
  insert into public.account_export_requests(user_id,contract_version)
    values(uid,'2026-10-25.v12') returning id into request_id;
  insert into public.remediation_jobs(kind,dedup_key,payload)
    values('account_export','export:'||request_id,jsonb_build_object('request_id',request_id,'user_id',uid))
    on conflict(dedup_key) do nothing;
  return request_id;
end $function$;

revoke all on function public.request_account_export() from public, anon;
grant execute on function public.request_account_export() to authenticated, service_role;

create or replace function public.write_account_export(p_job uuid, p_lease uuid, p_request uuid, p_part jsonb DEFAULT NULL::jsonb, p_checkpoint jsonb DEFAULT NULL::jsonb, p_manifest jsonb DEFAULT NULL::jsonb, p_error text DEFAULT NULL::text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare job public.remediation_jobs%rowtype; request public.account_export_requests%rowtype;
begin
 select * into job from public.remediation_jobs where id=p_job for update;
 if job.id is null or job.kind<>'account_export' or job.status<>'processing' or job.lease_id is distinct from p_lease or job.locked_until<=now() or job.payload->>'request_id'<>p_request::text then raise exception 'Export lease lost'; end if;
 perform pg_advisory_xact_lock(hashtextextended((job.payload->>'user_id'),0));
 -- N39: a moderation suspension still gets its export; a deletion that has
 -- begun does not.
 perform 1 from public.profiles where id=(job.payload->>'user_id')::uuid for share;
 if not found or private.account_deletion_started((job.payload->>'user_id')::uuid) then raise exception 'Export unavailable'; end if;
 select * into request from public.account_export_requests where id=p_request for update;
 if request.id is null or request.user_id::text<>job.payload->>'user_id' or request.expires_at<=now() or request.status in ('expired','completed')
    or private.account_deletion_started(request.user_id)
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
end $function$;

revoke all on function public.write_account_export(uuid,uuid,uuid,jsonb,jsonb,jsonb,text) from public, anon, authenticated;
grant execute on function public.write_account_export(uuid,uuid,uuid,jsonb,jsonb,jsonb,text) to service_role;

create or replace function public.request_account_deletion() returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare uid uuid:=auth.uid(); job uuid; blockers jsonb; existing_case public.account_deletion_requests%rowtype;
begin
  if uid is null then raise exception 'Sign in first' using errcode='42501'; end if;
  -- N41: fresh proof it's the owner, checked here and not only in the app,
  -- so a stolen or old access token calling this function directly can't
  -- queue the cleanup and suspend the account.
  if not private.signed_in_within(600) then
    raise exception 'Recent sign-in required' using errcode='42501',
      hint='Sign in again (password, Google, or an emailed link) and retry within ten minutes.';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(uid::text,0));
  -- N39: a member suspended by moderation can still ask for deletion. Only a
  -- deletion already underway answers with its own state.
  if private.account_deletion_started(uid) then
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

-- N35: the member's own deletion case, in the words Settings shows.
create or replace function public.my_account_deletion_status()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case when r.user_id is null then null else jsonb_build_object(
           'outcome', r.outcome,
           'next_action', r.next_action,
           'responsible_owner', r.responsible_owner,
           'updated_at', r.updated_at
         ) end
    from (select (select auth.uid()) as uid) me
    left join public.account_deletion_requests r on r.user_id = me.uid;
$$;

revoke all on function public.my_account_deletion_status() from public, anon;
grant execute on function public.my_account_deletion_status() to authenticated;

notify pgrst, 'reload schema';
commit;
