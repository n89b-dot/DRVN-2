begin;
alter table public.admin_users add column sessions_valid_after timestamptz;
create or replace function public.admin_role() returns text
language sql stable security definer set search_path=public,pg_temp as $$
 select a.role from public.admin_users a where a.user_id=auth.uid() and
 (a.sessions_valid_after is null or coalesce((nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'iat')::numeric,0)>extract(epoch from a.sessions_valid_after));
$$;
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path=public,pg_temp as $$
 select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'aal','aal1')='aal2' and public.admin_role() is not null;
$$;
create or replace function public.begin_admin_mfa_recovery(p_actor uuid,p_target uuid,p_reason text) returns uuid
language plpgsql security definer set search_path=public,pg_temp as $$
declare op uuid:=gen_random_uuid();
begin
 perform public.assert_admin_actor(p_actor);
 if p_actor=p_target or length(trim(p_reason))<10 then raise exception 'A separate operator and identity-verification reason are required'; end if;
 update public.admin_users set sessions_valid_after=clock_timestamp() where user_id=p_target;
 if not found then raise exception 'Recovery target is not an administrator'; end if;
 insert into public.admin_audit_log(actor_id,action,subject_type,subject_id,reason,metadata)
 values(p_actor,'admin.mfa_recovery','user',p_target,p_reason,jsonb_build_object('operationId',op,'phase','requested'));
 return op;
end $$;
revoke all on function public.begin_admin_mfa_recovery(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.begin_admin_mfa_recovery(uuid,uuid,text) to service_role;
notify pgrst,'reload schema';
commit;
