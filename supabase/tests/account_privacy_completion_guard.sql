begin;
do $$
declare uid uuid:=gen_random_uuid(); rid uuid; job public.remediation_jobs%rowtype; failed boolean:=false;
begin
 insert into auth.users(id,email,raw_user_meta_data) values(uid,'privacy-guard@drvn.test','{}');
 perform set_config('request.jwt.claims',json_build_object('sub',uid,'role','authenticated')::text,true);
 rid:=public.request_account_export();
 if public.request_account_export()<>rid then raise exception 'Active export must be reused'; end if;
 select * into job from public.remediation_jobs where dedup_key='export:'||rid;
 update public.remediation_jobs set status='processing',lease_id=gen_random_uuid(),locked_until=now()+interval '5 minutes' where id=job.id returning * into job;
 perform public.write_account_export(job.id,job.lease_id,rid,p_checkpoint=>'{"section":1,"offset":250}');
 if (select current_offset from public.account_export_requests where id=rid)<>250 then raise exception 'Checkpoint missing'; end if;
 begin perform public.write_account_export(job.id,gen_random_uuid(),rid,p_checkpoint=>'{"section":0,"offset":0}'); exception when others then failed:=true; end;
 if not failed then raise exception 'Stale worker wrote a checkpoint'; end if;
 update public.remediation_jobs set locked_until=now()-interval '1 second' where id=job.id;
 failed:=false;
 begin perform public.write_account_export(job.id,job.lease_id,rid,p_manifest=>'{}'); exception when others then failed:=true; end;
 if not failed then raise exception 'Expired worker published export'; end if;
 if has_function_privilege('authenticated','public.write_account_export(uuid,uuid,uuid,jsonb,jsonb,jsonb,text)','execute') then raise exception 'Owner may not forge export worker state'; end if;
 if has_table_privilege('authenticated','public.account_export_parts','select') then raise exception 'Private parts are exposed'; end if;
 if (select public from storage.buckets where id='account-exports') then raise exception 'Export bucket must stay private'; end if;
 if public.account_deletion_blockers(uid)->>'financial_hold'<>'false' then raise exception 'Clean account unexpectedly blocked'; end if;
 raise notice 'PASS: export reuse, checkpoint persistence, stale/expired worker denial, private access, deletion classification';
 raise notice 'all readiness checks passed';
end $$;
rollback;
