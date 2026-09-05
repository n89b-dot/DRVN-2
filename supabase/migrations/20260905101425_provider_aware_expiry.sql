begin;

alter table public.remediation_jobs drop constraint remediation_jobs_kind_check;
alter table public.remediation_jobs add constraint remediation_jobs_kind_check
 check(kind in ('receipt','search','delete_account','reservation_expiry'));
create index payment_requests_order_ids on public.payment_requests using gin ((request->'orderIds'));

-- Cron only records obligations. It never guesses the outcome of an external charge.
create or replace function public.release_expired_reservations() returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare queued int;
begin
 insert into public.remediation_jobs(kind,dedup_key,payload)
 select 'reservation_expiry','expiry:'||o.id,jsonb_build_object('order_id',o.id)
 from public.orders o
 where o.status in ('pending','requires_action')
 and exists(select 1 from public.order_items oi join public.listings l on l.id=oi.listing_id
   where oi.order_id=o.id and l.status='reserved' and l.reserved_until<now())
 and not exists(select 1 from public.remediation_jobs j where j.dedup_key='expiry:'||o.id)
 order by o.created_at,o.id limit 500
 on conflict(dedup_key) do nothing;
 get diagnostics queued=row_count;
 update public.offers set status='expired',responded_at=now()
 where status in ('open','countered') and expires_at<now();
 return jsonb_build_object('queued',queued,'listings_released',0,'orders_cancelled',0);
end $$;

-- Serialize provider creation with expiry. An already-persisted operation can
-- still be retrieved for reconciliation after its fulfillment state changes.
create or replace function public.prepare_payment_request(p_key text,p_request jsonb) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.payment_requests;
begin
 perform 1 from public.orders where id::text in (select jsonb_array_elements_text(p_request->'orderIds')) order by id for update;
 if not exists(select 1 from public.payment_requests where operation_key=p_key) and exists(
   select 1 from public.orders o where o.id::text in (select jsonb_array_elements_text(p_request->'orderIds'))
   and (o.status not in ('pending','requires_action') or exists(select 1 from public.remediation_jobs where dedup_key='expiry:'||o.id))
 ) then raise exception 'Checkout is closing; payment creation refused'; end if;
 insert into public.payment_requests(operation_key,request) values(p_key,p_request) on conflict do nothing;
 select * into r from public.payment_requests where operation_key=p_key for update;
 if r.request<>p_request then raise exception 'Payment parameters changed'; end if;
 return jsonb_build_object('request',r.request,'correlation_id',r.correlation_id,'reference',r.provider_reference,'created_at',r.created_at);
end $$;

-- Only the worker which still owns the lease may release an order. A null
-- reference means no provider request was ever persisted, not an unknown one.
create or replace function public.finish_reservation_expiry(p_job uuid,p_lease uuid,p_reference text default null) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare j public.remediation_jobs; o public.orders; ref text; result jsonb;
begin
 select * into j from public.remediation_jobs where id=p_job for update;
 if not found or j.kind<>'reservation_expiry' or j.status<>'processing' or j.lease_id is distinct from p_lease or j.locked_until<=now() then raise exception 'Expiry lease lost'; end if;
 select * into o from public.orders where id=(j.payload->>'order_id')::uuid for update;
 if not found or o.status not in ('pending','requires_action') then return jsonb_build_object('outcome','already_resolved'); end if;
 select provider_reference into ref from public.payments where order_id=o.id;
 if p_reference is null then
   if ref is not null or exists(select 1 from public.payment_requests where (request->'orderIds') ? o.id::text) then
     raise exception 'Payment outcome unresolved; retain reservation';
   end if;
 elsif ref is distinct from p_reference then raise exception 'Expiry payment reference mismatch';
 end if;
 if not exists(select 1 from public.order_items oi join public.listings l on l.id=oi.listing_id where oi.order_id=o.id and l.status='reserved' and l.reserved_until<now()) then
   raise exception 'Reservation is not expired';
 end if;
 result:=public.purchase_finalize(o.id,false,'stripe',p_reference,'checkout expired after payment cancellation or verified absence');
 if not coalesce((result->>'applied')::boolean,false) then raise exception 'Expiry transition refused'; end if;
 return jsonb_build_object('outcome','expired');
end $$;
revoke all on function public.finish_reservation_expiry(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.finish_reservation_expiry(uuid,uuid,text) to service_role;
create or replace function public.worker_health_snapshot() returns jsonb
language sql security definer set search_path=public,pg_temp as $$
 select jsonb_build_object('families', (select coalesce(jsonb_agg(x),'[]') from (
 select f.family,max(r.finished_at) filter(where r.status='succeeded') last_success,
 coalesce(max(r.finished_at) filter(where r.status='succeeded')<now()-interval '30 minutes',true) stale
 from unnest(array['expiries','captures','transfers','transferReconciliation','refunds','returns','disputes','alerts','receipts']) f(family)
 left join public.worker_runs r on r.family=f.family group by f.family) x),
 'queues',(select coalesce(jsonb_agg(q),'[]') from (
 select kind,status,count(*) count,min(created_at) oldest from public.remediation_jobs where status<>'completed' group by kind,status
 union all select 'alerts',status,count(*),min(created_at) from public.admin_alert_outbox where status='failed' group by status
 union all select 'transfers',status,count(*),min(created_at) from public.transfer_intents where status='failed' group by status
 union all select 'refunds',status,count(*),min(created_at) from public.refund_operations where status='failed' group by status
 ) q));
$$;
revoke all on function public.worker_health_snapshot() from public,anon,authenticated;
grant execute on function public.worker_health_snapshot() to service_role;

grant execute on function public.release_expired_reservations() to service_role;
notify pgrst,'reload schema';
commit;
