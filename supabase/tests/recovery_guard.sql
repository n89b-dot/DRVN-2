begin;
do $$
declare a uuid; b uuid; batch jsonb; seen text[]:='{}'; i int; job uuid; lease uuid:=gen_random_uuid();
begin
 a:=public.record_capture_recovery('capture:pi_guard_unmapped','Missing mapping',1500);
 b:=public.record_capture_recovery('capture:pi_guard_unmapped','Duplicate event',1500);
 if a<>b or (select count(*) from public.payment_recoveries where recovery_key='capture:pi_guard_unmapped')<>1 then raise exception 'Recovery not deduplicated'; end if;
 if has_function_privilege('authenticated','public.record_capture_recovery(text,text,int)','EXECUTE') then raise exception 'Public recovery write'; end if;
 insert into public.capture_checks(reference,next_attempt_at) select 'pi_fair_guard_'||g.value,now()-interval '1 day' from generate_series(1,120) g(value);
 for i in 1..3 loop
  batch:=public.capture_reconciliation_candidates();
  seen:=seen||array(select jsonb_array_elements_text(batch));
 end loop;
 if (select count(distinct x) from unnest(seen) x where x like 'pi_fair_guard_%')<>120 then raise exception 'Reconciliation starved later references'; end if;
 insert into public.remediation_jobs(kind,dedup_key,payload,status,lease_id,locked_until) values('search','lease:recovery-guard','{}','processing',lease,now()+interval '1 minute') returning id into job;
 perform public.renew_remediation_lease(job,lease);
 update public.remediation_jobs set locked_until=now()-interval '1 second' where id=job;
 begin
  perform public.renew_remediation_lease(job,lease);
  raise exception 'Expired worker revived lease';
 exception when raise_exception then if sqlerrm<>'Job lease lost' then raise; end if; end;
 raise notice 'recovery_guard: all checks passed';
end $$;
rollback;
