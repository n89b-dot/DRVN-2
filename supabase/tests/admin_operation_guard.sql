begin;
do $$
declare actor uuid:=gen_random_uuid(); first_op jsonb; repeated jsonb;
begin
 insert into auth.users(id,email) values(actor,'operation-guard@example.test');
 insert into public.admin_users(user_id,note) values(actor,'isolated guard');
 first_op:=public.begin_admin_external_operation(actor,'guard.external','user',actor::text,null,'Test interrupted audit','{}');
 repeated:=public.begin_admin_external_operation(actor,'guard.external','user',actor::text,null,'Retry interrupted audit','{}');
 if first_op->>'operationId'<>repeated->>'operationId' or not (repeated->>'reused')::boolean then raise exception 'External operation was not fenced'; end if;
 insert into public.admin_audit_log(actor_id,action,subject_type,subject_id,reason,metadata) values(actor,'guard.external','user',actor,'Provider inspected',jsonb_build_object('operationId',first_op->>'operationId','phase','reconciled'));
 repeated:=public.begin_admin_external_operation(actor,'guard.external','user',actor::text,null,'New action after reconciliation','{}');
 if first_op->>'operationId'=repeated->>'operationId' then raise exception 'Reconciled operation blocked new action'; end if;
 raise notice 'admin_operation_guard: all checks passed';
end $$;
rollback;
