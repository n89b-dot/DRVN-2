begin;
do $$
declare uid uuid:=gen_random_uuid(); request uuid; again uuid;
begin
 insert into auth.users(id,email) values(uid,'deletion-guard@example.test');
 perform set_config('role','authenticated',true);
 perform set_config('request.jwt.claims',json_build_object('sub',uid,'role','authenticated')::text,true);
 request:=public.request_account_deletion();
 if request is null then raise exception 'Missing deletion request'; end if;
 begin
  update public.profiles set display_name='stale session write' where id=uid;
  raise exception 'Stale session mutation succeeded';
 exception when insufficient_privilege then null; end;
 perform set_config('role','none',true);
 perform set_config('request.jwt.claims','',true);
 if not exists(select 1 from public.remediation_jobs where id=request and kind='delete_account' and status='pending') then raise exception 'Deletion was not durable'; end if;
 raise notice 'all deletion checks passed';
end $$;
rollback;
