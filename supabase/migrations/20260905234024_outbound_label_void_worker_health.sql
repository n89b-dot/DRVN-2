begin;

alter function public.record_outbound_label_void_observation(uuid,uuid,text,text,text)
  rename to record_outbound_label_void_observation_unfenced;
revoke all on function public.record_outbound_label_void_observation_unfenced(uuid,uuid,text,text,text)
  from public,anon,authenticated,service_role;

-- Bind a provider read to the claim attempt and to the instant before the
-- read began. The row locks use the same order -> shipment -> request order
-- as the underlying atomic settlement, so a late read can neither bless a
-- newer dispatch nor masquerade as a post-expiry absence observation.
create function public.record_outbound_label_void_observation(
  p_shipment uuid,p_worker uuid,p_source text,p_state text,p_attempt integer,
  p_observed_at timestamptz,p_detail text default null
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
  request_order uuid;
  saved public.outbound_label_void_requests;
  result jsonb;
begin
  if p_attempt is null or p_observed_at is null or p_observed_at>now()+interval '1 minute' then
    raise exception 'Invalid outbound label void observation epoch';
  end if;
  select order_id into strict request_order from public.outbound_label_void_requests
  where shipment_id=p_shipment;
  perform 1 from public.orders where id=request_order for update;
  if not found then raise exception 'Outbound label void order is missing'; end if;
  perform 1 from public.shipments where id=p_shipment for update;
  if not found then raise exception 'Outbound label void shipment is missing'; end if;
  select * into strict saved from public.outbound_label_void_requests
  where shipment_id=p_shipment for update;
  if saved.attempts<>p_attempt then
    raise exception 'Outbound label void observation belongs to a stale attempt' using errcode='42501';
  end if;
  result:=public.record_outbound_label_void_observation_unfenced(
    p_shipment,p_worker,p_source,p_state,p_detail
  );
  update public.outbound_label_void_requests set provider_observed_at=p_observed_at
  where shipment_id=p_shipment;
  return result;
end $$;
revoke all on function public.record_outbound_label_void_observation(uuid,uuid,text,text,integer,timestamptz,text)
  from public,anon,authenticated;
grant execute on function public.record_outbound_label_void_observation(uuid,uuid,text,text,integer,timestamptz,text)
  to service_role;

create or replace function public.worker_health_snapshot() returns jsonb
language sql security definer set search_path=public,pg_temp as $$
 with families(family,budget) as (values
 ('expiries',interval '30 minutes'),('captures',interval '30 minutes'),
 ('transfers',interval '30 minutes'),('transferReconciliation',interval '30 minutes'),
 ('refunds',interval '30 minutes'),('labelVoids',interval '30 minutes'),
 ('returns',interval '30 minutes'),('disputes',interval '30 minutes'),
 ('alerts',interval '30 minutes'),('receipts',interval '30 minutes'),
 ('analytics',interval '30 minutes'),('search',interval '30 minutes'),
 ('deletions',interval '30 minutes'),('savedSearches',interval '90 minutes'),
 ('media',interval '26 hours')),
 runs as (
 select f.family,f.budget,
 max(r.finished_at) filter(where r.status='succeeded') last_success,
 max(r.finished_at) filter(where r.status='failed') last_failure,
 min(r.started_at) filter(where r.status='running') running_since
 from families f left join public.worker_runs r on r.family=f.family group by f.family,f.budget),
 runnable as (
 select kind,status,next_attempt_at due_at from public.remediation_jobs
 where status='failed' or (status='pending' and next_attempt_at<=now())
 union all select kind,'processing',locked_until from public.remediation_jobs
 where status='processing' and locked_until<=now()
 union all select 'alerts',status,next_attempt_at from public.admin_alert_outbox
 where status='failed' or (status='pending' and next_attempt_at<=now())
 union all select 'transfers',status,greatest(coalesce(available_at,created_at),coalesce(next_attempt_at,created_at))
 from public.transfer_intents where status in ('holding','ready','blocked_unpayable','failed')
 and greatest(coalesce(available_at,created_at),coalesce(next_attempt_at,created_at))<=now()
 union all select 'transfers','processing',lease_expires_at from public.transfer_intents
 where status='processing' and lease_expires_at<=now()
 union all select 'refunds',status,coalesce(next_attempt_at,created_at) from public.refund_operations
 where status in ('requested','provider_pending','provider_succeeded','effects_pending','reversal_pending','failed','recovery_required')
 and coalesce(next_attempt_at,created_at)<=now()
 and coalesce(provider_status,'unknown') not in ('pending','requires_action')
 union all select 'labelVoids',status,
   case when provider_state='submitted' then updated_at+interval '6 hours'
        when status='requested' then updated_at+interval '1 minute'
        else updated_at+interval '15 minutes' end
 from public.outbound_label_void_requests
 where status in ('requested','provider_pending') and
   case when provider_state='submitted' then updated_at+interval '6 hours'
        when status='requested' then updated_at+interval '1 minute'
        else updated_at+interval '15 minutes' end <=now()
 union all select 'financial_recovery','open',created_at from public.payment_recoveries where status='open'
 ), queues as (
 select kind,status,count(*) count,min(due_at) oldest,
 (status in ('failed','recovery_required') or kind='financial_recovery'
   or min(due_at)<now()-interval '30 minutes') overdue
 from runnable group by kind,status)
 select jsonb_build_object('families',(select jsonb_agg(jsonb_build_object(
 'family',family,'last_success',last_success,'last_failure',last_failure,
 'running_since',running_since,'budget_seconds',extract(epoch from budget),
 'stale',coalesce(last_success<now()-budget,true)
   or coalesce(last_failure>last_success,false)
   or coalesce(running_since<now()-interval '6 minutes',false))) from runs),
 'queues',(select coalesce(jsonb_agg(queues),'[]'::jsonb) from queues));
$$;
revoke all on function public.worker_health_snapshot() from public,anon,authenticated;
grant execute on function public.worker_health_snapshot() to service_role;
notify pgrst,'reload schema';
commit;
