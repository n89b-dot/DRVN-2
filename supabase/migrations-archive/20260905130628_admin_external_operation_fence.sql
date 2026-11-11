begin;
create or replace function public.begin_admin_external_operation(p_actor uuid,p_action text,p_subject_type text,p_subject text,p_order uuid,p_reason text,p_metadata jsonb default '{}') returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare op text;
begin
 perform public.assert_admin_actor(p_actor);
 if length(trim(p_reason))=0 then raise exception 'Reason required'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_action||':'||p_subject,0));
 select a.metadata->>'operationId' into op from public.admin_audit_log a
 where a.action=p_action and a.subject_id=p_subject::uuid and a.metadata->>'phase'='requested'
 and not exists(select 1 from public.admin_audit_log done where done.metadata->>'operationId'=a.metadata->>'operationId' and done.metadata->>'phase' in ('completed','reconciled'))
 order by a.created_at limit 1;
 if found then return jsonb_build_object('operationId',op,'reused',true); end if;
 op:=gen_random_uuid()::text;
 insert into public.admin_audit_log(actor_id,action,subject_type,subject_id,order_id,reason,metadata)
 values(p_actor,p_action,p_subject_type,p_subject::uuid,p_order,p_reason,p_metadata||jsonb_build_object('operationId',op,'phase','requested'));
 return jsonb_build_object('operationId',op,'reused',false);
end $$;
revoke all on function public.begin_admin_external_operation(uuid,text,text,text,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.begin_admin_external_operation(uuid,text,text,text,uuid,text,jsonb) to service_role;
notify pgrst,'reload schema';
commit;
