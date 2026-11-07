begin;
-- Callers carry a fresh amr sign-in: request_account_deletion() needs one (20261107200450).
do $$
declare owner_id uuid:=gen_random_uuid(); stranger_id uuid:=gen_random_uuid(); export_id uuid;
 job public.remediation_jobs%rowtype; deletion jsonb; rejected boolean:=false;
begin
 insert into auth.users(id,email,raw_user_meta_data) values
   (owner_id,'privacy-race-owner@drvn.test','{}'),
   (stranger_id,'privacy-race-stranger@drvn.test','{}');
 perform set_config('role','authenticated',true);
 perform set_config('request.jwt.claims',json_build_object('sub',owner_id,'role','authenticated','amr',json_build_array(json_build_object('method','password','timestamp',extract(epoch from now())::bigint)))::text,true);
 export_id:=public.request_account_export();
 perform set_config('role','none',true);
 select * into job from public.remediation_jobs where dedup_key='export:'||export_id;
 update public.remediation_jobs set status='processing',lease_id=gen_random_uuid(),locked_until=now()+interval '5 minutes' where id=job.id returning * into job;
 update public.account_export_requests set status='completed',manifest='{}',completed_at=now() where id=export_id;
 perform set_config('role','authenticated',true);
 perform set_config('request.jwt.claims',json_build_object('sub',owner_id,'role','authenticated','amr',json_build_array(json_build_object('method','password','timestamp',extract(epoch from now())::bigint)))::text,true);
 deletion:=public.request_account_deletion();
 if deletion->>'outcome'<>'cleanup_pending' then raise exception 'Clean deletion did not enter cleanup'; end if;
 if (public.request_account_deletion())->>'job_id'<>deletion->>'job_id' then raise exception 'Repeated deletion changed the active cleanup job'; end if;
 perform set_config('role','none',true);
 if (select status from public.account_export_requests where id=export_id)<>'expired' then raise exception 'Deletion left a completed export downloadable'; end if;
 begin perform public.write_account_export(job.id,job.lease_id,export_id,p_checkpoint=>'{}'); exception when others then rejected:=true; end;
 if not rejected then raise exception 'Deletion race accepted a stale export checkpoint'; end if;
 rejected:=false;
 perform set_config('role','authenticated',true);
 perform set_config('request.jwt.claims',json_build_object('sub',owner_id,'role','authenticated','amr',json_build_array(json_build_object('method','password','timestamp',extract(epoch from now())::bigint)))::text,true);
 begin perform public.request_account_export(); exception when insufficient_privilege then rejected:=true; end;
 if not rejected then raise exception 'Suspended account started another export'; end if;
 perform set_config('request.jwt.claims',json_build_object('sub',stranger_id,'role','authenticated')::text,true);
 if exists(select 1 from public.account_export_requests where id=export_id) then raise exception 'Unrelated member read another export request'; end if;
 perform set_config('role','none',true);
 raise notice 'PASS: deletion expires active exports, stale checkpoints fail, suspended re-request fails, cross-account read fails';
 raise notice 'all privacy export race checks passed';
end $$;
rollback;
