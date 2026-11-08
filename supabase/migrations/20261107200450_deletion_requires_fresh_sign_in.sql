-- 20261107200450 — account deletion needs a fresh sign-in, at the database
-- (OS-W12 follow-up to #86, readiness N41; GPT post-merge review P1).
--
-- #86 made the app ask for the password, or a Google sign-in within ten
-- minutes, before it calls request_account_deletion(). The function itself
-- still accepted any authenticated caller, so an old or stolen access token
-- could call the RPC directly and queue the cleanup, suspend the account and
-- pause its listings. The check now lives in the function.
--
-- How "fresh" is read: Supabase Auth writes an `amr` claim into each access
-- token, one entry per way the person authenticated in that session, with a
-- Unix timestamp. PostgREST verifies the token before it reaches
-- request.jwt.claims (read here as is_admin's step-up check reads it,
-- 20260905011618),
-- and refreshing a session carries the original timestamps forward, so the
-- newest timestamp is when the person last actually proved it was them.
-- Ten minutes matches REAUTH_WINDOW_SECONDS in src/lib/reauthentication.ts.
-- The app's password path signs in again before calling (a fresh `password`
-- entry); its Google path is a new OAuth sign-in (a fresh `oauth` entry).
-- A token with no timestamped amr (the RFC 8176 string form, or none) is
-- never fresh. A minute of clock skew into the future is tolerated.
--
-- The rest of request_account_deletion() is restated unchanged from its
-- latest definition (20260905203510_privacy_export_race_guards.sql). A later
-- migration that redefines it must keep this check:
-- supabase/tests/deletion_fresh_sign_in_guard.sql fails otherwise.

begin;

create or replace function private.signed_in_within(p_seconds integer)
returns boolean
language sql
stable
set search_path = ''
as $$
  with claims as (
    select nullif(current_setting('request.jwt.claims', true), '')::jsonb as value
  )
  select coalesce((
    select max((entry ->> 'timestamp')::numeric)
    from claims, jsonb_array_elements(
      case when jsonb_typeof(claims.value -> 'amr') = 'array' then claims.value -> 'amr' else '[]'::jsonb end
    ) as entry
    where jsonb_typeof(entry) = 'object'
      and jsonb_typeof(entry -> 'timestamp') = 'number'
  ) between extract(epoch from now()) - p_seconds and extract(epoch from now()) + 60, false)
$$;

comment on function private.signed_in_within(integer) is
  'True when the caller''s verified access token shows an authentication (any amr method) within p_seconds. N41.';

revoke all on function private.signed_in_within(integer) from public, anon, authenticated;

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

notify pgrst, 'reload schema';
commit;
