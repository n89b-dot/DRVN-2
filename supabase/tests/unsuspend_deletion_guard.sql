-- 20261005102000: an admin unsuspend must not reactivate an account whose
-- owner asked for it to be deleted while that deletion is unfinished.
begin;
do $$
declare actor uuid:=gen_random_uuid(); doomed uuid:=gen_random_uuid(); ordinary uuid:=gen_random_uuid(); st text;
begin
 insert into auth.users(id,email) values(actor,'unsuspend-guard-actor@example.test'),(doomed,'unsuspend-guard-doomed@example.test'),(ordinary,'unsuspend-guard-ordinary@example.test');
 -- A confirmed authenticator (20261107200500): without one no admin privilege.
 insert into auth.mfa_factors(id, user_id, friendly_name, factor_type, status, created_at, updated_at) values (gen_random_uuid(), actor, 'guard', 'totp', 'verified', now(), now());
 insert into public.admin_users(user_id, mfa_factor_id) select actor, id from auth.mfa_factors where user_id = actor;
 -- Its session was raised to AAL2 with that factor (20261107200550); the claims carry it.
 insert into auth.sessions(id, user_id, factor_id, aal, created_at, updated_at) select f.user_id, f.user_id, f.id, 'aal2', now(), now() from auth.mfa_factors f where f.user_id = actor;
 perform set_config('role','authenticated',true);
 perform set_config('request.jwt.claims',json_build_object('sub',actor,'role','authenticated','aal','aal2','session_id',actor,'amr',json_build_array(json_build_object('method','totp','timestamp',extract(epoch from now())::bigint)))::text,true);
 perform public.execute_admin_command('user.suspend',doomed,'guard: suspend before deletion');
 perform public.execute_admin_command('user.suspend',ordinary,'guard: ordinary suspension');
 perform set_config('role','none',true);

 -- The worker's job as request_account_deletion queues it.
 insert into public.remediation_jobs(kind,dedup_key,payload) values('delete_account','delete:'||doomed,jsonb_build_object('user_id',doomed));
 foreach st in array array['pending','processing','failed'] loop
  update public.remediation_jobs set status=st where dedup_key='delete:'||doomed;
  perform set_config('role','authenticated',true);
  begin
   perform public.execute_admin_command('user.unsuspend',doomed,'guard: attempt during '||st);
   raise exception 'Unsuspend reactivated an account with a % deletion job',st;
  exception when raise_exception then
   if sqlerrm <> 'Account deletion is in progress; this account cannot be reactivated' then raise; end if;
  end;
  perform set_config('role','none',true);
  if not exists(select 1 from public.profiles where id=doomed and suspended_at is not null) then raise exception 'Account left suspended state during % deletion',st; end if;
  if exists(select 1 from public.admin_audit_log where subject_id=doomed and action='user.unsuspend') then raise exception 'Refused unsuspend was audited as completed'; end if;
 end loop;

 -- 20261007100100: a finished deletion that kept the profile (a member with
 -- orders: scrubbed, job completed, request left for an operator) is not
 -- reactivated either.
 update public.remediation_jobs set status='completed' where dedup_key='delete:'||doomed;
 insert into public.account_deletion_requests(user_id,outcome,next_action,responsible_owner)
 values(doomed,'operator_attention','guard','guard');
 perform set_config('role','authenticated',true);
 begin
  perform public.execute_admin_command('user.unsuspend',doomed,'guard: attempt after a retained-identity deletion');
  raise exception 'Unsuspend reactivated an account whose deletion finished with the profile retained';
 exception when raise_exception then
  if sqlerrm <> 'This member asked for their account to be deleted; it cannot be reactivated' then raise; end if;
 end;
 perform set_config('role','none',true);
 if not exists(select 1 from public.profiles where id=doomed and suspended_at is not null) then raise exception 'A deleted, retained account left suspended state'; end if;

 -- Without a deletion in flight, unsuspend still works.
 perform set_config('role','authenticated',true);
 perform public.execute_admin_command('user.unsuspend',ordinary,'guard: ordinary unsuspend');
 perform set_config('role','none',true);
 if exists(select 1 from public.profiles where id=ordinary and suspended_at is not null) then raise exception 'Ordinary unsuspend no longer works'; end if;
 if not exists(select 1 from public.admin_audit_log where subject_id=ordinary and action='user.unsuspend') then raise exception 'Ordinary unsuspend lost its audit'; end if;

 -- Still callable only as before.
 if has_function_privilege('anon','public.execute_admin_command(text,uuid,text,jsonb)','execute') then raise exception 'anon can call execute_admin_command'; end if;
 if not has_function_privilege('authenticated','public.execute_admin_command(text,uuid,text,jsonb)','execute') then raise exception 'authenticated lost execute_admin_command'; end if;
 raise notice 'all unsuspend deletion checks passed';
end $$;
rollback;
