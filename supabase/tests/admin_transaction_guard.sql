begin;
create function pg_temp.reject_test_audit() returns trigger language plpgsql as $$
begin if new.reason='injected audit outage' then raise exception 'Injected audit failure'; end if; return new; end $$;
create trigger injected_audit_failure before insert on public.admin_audit_log for each row execute function pg_temp.reject_test_audit();
do $$
declare actor uuid:=gen_random_uuid(); subject uuid:=gen_random_uuid();
begin
 insert into auth.users(id,email) values(actor,'admin-transaction-actor@example.test'),(subject,'admin-transaction-subject@example.test');
 -- A confirmed authenticator (20261107200500): without one no admin privilege.
 insert into auth.mfa_factors(id, user_id, friendly_name, factor_type, status, created_at, updated_at) values (gen_random_uuid(), actor, 'guard', 'totp', 'verified', now(), now());
 insert into public.admin_users(user_id, mfa_factor_id) select actor, id from auth.mfa_factors where user_id = actor;
 perform set_config('role','authenticated',true);
 perform set_config('request.jwt.claims',json_build_object('sub',actor,'role','authenticated','aal','aal2','amr',json_build_array(json_build_object('method','totp','timestamp',extract(epoch from now())::bigint)))::text,true);
 begin
  perform public.execute_admin_command('user.suspend',subject,'injected audit outage');
  raise exception 'Audit outage incorrectly succeeded';
 exception when raise_exception then if sqlerrm <> 'Injected audit failure' then raise; end if; end;
 perform set_config('role','none',true);
 if exists(select 1 from public.profiles where id=subject and suspended_at is not null) then raise exception 'Mutation survived failed audit'; end if;
 perform set_config('role','authenticated',true);
 perform public.execute_admin_command('user.suspend',subject,'verified test suspension');
 perform set_config('role','none',true);
 if not exists(select 1 from public.admin_audit_log where subject_id=subject and action='user.suspend') then raise exception 'Missing atomic audit'; end if;
 perform set_config('role','authenticated',true);
 perform set_config('request.jwt.claims',json_build_object('sub',actor,'role','authenticated','aal','aal1')::text,true);
 begin
  perform public.execute_admin_command('user.unsuspend',subject,'low assurance attack');
  raise exception 'Low assurance command succeeded';
 exception when insufficient_privilege then null; end;
 perform set_config('role','none',true);
 raise notice 'all admin transaction checks passed';
end $$;
rollback;
