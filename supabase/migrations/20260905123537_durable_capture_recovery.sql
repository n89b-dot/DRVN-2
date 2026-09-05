begin;
alter table public.payment_recoveries drop constraint payment_recoveries_kind_check;
alter table public.payment_recoveries add constraint payment_recoveries_kind_check check(kind in ('reversal_failed','refund_failed','partial_refund_unattributed','transfer_after_refund','negative_balance','capture_unresolved'));
alter table public.payment_recoveries add column recovery_key text unique;
alter table public.payment_recoveries add column last_seen_at timestamptz not null default now();
create or replace function public.record_capture_recovery(p_key text,p_detail text,p_amount int default null) returns uuid
language plpgsql security definer set search_path=public,pg_temp as $$
declare result uuid;
begin
 if length(p_key)>250 or length(p_key)<3 then raise exception 'Invalid recovery identity'; end if;
 insert into public.payment_recoveries(kind,recovery_key,detail,amount_cents)
 values('capture_unresolved',p_key,left(p_detail,1000),p_amount)
 on conflict(recovery_key) do update set last_seen_at=now()
 returning id into result;
 return result;
end $$;
revoke all on function public.record_capture_recovery(text,text,int) from public,anon,authenticated;
grant execute on function public.record_capture_recovery(text,text,int) to service_role;

create table public.capture_checks(reference text primary key,next_attempt_at timestamptz not null default now());
alter table public.capture_checks enable row level security;
revoke all on public.capture_checks from public,anon,authenticated;
grant all on public.capture_checks to service_role;
create index capture_checks_due on public.capture_checks(next_attempt_at,reference);
alter table public.payment_requests add column next_reconcile_at timestamptz not null default now();
create index payment_requests_unmapped_due on public.payment_requests(next_reconcile_at) where provider_reference is null;
create or replace function public.claim_unmapped_payment_requests() returns jsonb
language sql security definer set search_path=public,pg_temp as $$
 with due as (select operation_key from public.payment_requests where provider_reference is null and created_at<now()-interval '2 minutes' and next_reconcile_at<=now() order by next_reconcile_at,operation_key for update skip locked limit 10),
 claimed as(update public.payment_requests p set next_reconcile_at=now()+interval '15 minutes' from due where p.operation_key=due.operation_key returning p.*)
 select coalesce(jsonb_agg(claimed),'[]') from claimed;
$$;
revoke all on function public.claim_unmapped_payment_requests() from public,anon,authenticated;
grant execute on function public.claim_unmapped_payment_requests() to service_role;
create or replace function public.capture_reconciliation_candidates() returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare result jsonb;
begin
 insert into public.capture_checks(reference)
 select distinct p.provider_reference from public.payments p join public.orders o on o.id=p.order_id
 where p.provider='stripe' and p.provider_reference is not null and (
 o.status in ('pending','requires_action') or
 (o.status in ('paid','shipped','delivered','completed','disputed') and o.refunded_cents<o.total_cents and o.transfer_reference is null and not exists(select 1 from public.transfer_intents t where t.order_id=o.id)) or
 (o.status in ('cancelled','payment_failed') and p.status='succeeded' and not exists(select 1 from public.refund_operations r where r.order_id=o.id and r.purpose='late_capture')))
 on conflict(reference) do nothing;
 with due as(select reference from public.capture_checks where next_attempt_at<=now() order by next_attempt_at,reference for update skip locked limit 50),
 claimed as(update public.capture_checks c set next_attempt_at=now()+interval '15 minutes' from due where c.reference=due.reference returning c.reference)
 select coalesce(jsonb_agg(reference),'[]') into result from claimed;
 return result;
end $$;
-- Completed mappings stop periodic work, while unresolved cases retain history.
create or replace function public.finish_capture_check(p_reference text) returns void
language sql security definer set search_path=public,pg_temp as $$ delete from public.capture_checks where reference=p_reference; $$;
revoke all on function public.finish_capture_check(text) from public,anon,authenticated;
grant execute on function public.finish_capture_check(text) to service_role;
notify pgrst,'reload schema';
commit;
