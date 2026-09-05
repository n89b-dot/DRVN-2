begin;
do $$
declare snapshot jsonb;
begin
 insert into public.worker_runs(id,family,status,started_at,finished_at)
 values(gen_random_uuid(),'deletions','succeeded',now()-interval '2 minutes',now()-interval '1 minute');
 snapshot:=public.worker_health_snapshot();
 if (select (f->>'stale')::boolean from jsonb_array_elements(snapshot->'families') f where f->>'family'='deletions') then raise exception 'Fresh successful family must be healthy'; end if;
 insert into public.worker_runs(id,family,status,started_at,finished_at)
 values(gen_random_uuid(),'deletions','failed',now(),now());
 snapshot:=public.worker_health_snapshot();
 if not (select (f->>'stale')::boolean from jsonb_array_elements(snapshot->'families') f where f->>'family'='deletions') then raise exception 'New failure must override recent success'; end if;
 insert into public.remediation_jobs(kind,dedup_key,payload,next_attempt_at)
 values('account_export','health-export-guard','{}',now()-interval '31 minutes');
 snapshot:=public.worker_health_snapshot();
 if not exists(select 1 from jsonb_array_elements(snapshot->'queues') q where q->>'kind'='account_export' and (q->>'overdue')::boolean) then raise exception 'Overdue pending exports must be visible'; end if;
 if jsonb_array_length(snapshot->'families')<>14 then raise exception 'Required worker inventory changed'; end if;
 raise notice 'PASS: fresh success, later failure, overdue exports and complete family inventory';
 raise notice 'all readiness checks passed';
end $$;
rollback;
