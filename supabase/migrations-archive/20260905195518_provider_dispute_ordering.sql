begin;
alter table public.orders add column stripe_dispute_id text;
create table public.stripe_dispute_journal (
 dispute_id text primary key,
 payment_reference text not null,
 amount_cents integer not null check(amount_cents>0),
 currency text not null,
 state text not null check(state in ('open','won','warning_closed','loss_pending','lost','recovery')),
 last_event_id text not null,
 last_event_created bigint not null,
 order_ids uuid[] not null default '{}',
 lease_id uuid,
 lease_expires_at timestamptz,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
alter table public.stripe_dispute_journal enable row level security;
revoke all on public.stripe_dispute_journal from public,anon,authenticated;
grant all on public.stripe_dispute_journal to service_role;

create or replace function public.hold_stripe_dispute(p_dispute text,p_detail text) returns text
language plpgsql security definer set search_path=public,pg_temp as $$
declare entry public.stripe_dispute_journal%rowtype; recovery uuid;
begin
 select * into strict entry from public.stripe_dispute_journal where dispute_id=p_dispute for update;
 update public.stripe_dispute_journal set state='recovery',lease_id=null,lease_expires_at=null,updated_at=now() where dispute_id=p_dispute;
 -- Freeze the basket while attribution is reviewed; never infer that a
 -- partial chargeback refunded every order on its PaymentIntent.
 update public.orders set pre_dispute_status=status,status='disputed',disputed_at=now(),
  dispute_resolved_at=null,dispute_outcome=null,dispute_category='other',
  dispute_reason='Card dispute requires reconciliation — '||p_dispute,stripe_dispute_id=p_dispute
 where id=any(entry.order_ids) and status in ('paid','shipped','delivered','completed');
 insert into public.payment_recoveries(order_id,kind,recovery_key,amount_cents,detail)
 values(case when cardinality(entry.order_ids)=1 then entry.order_ids[1] else null end,
 'partial_refund_unattributed','stripe:dispute:'||p_dispute,entry.amount_cents,left(p_detail,2000))
 on conflict(recovery_key) do update set last_seen_at=now()
 returning id into recovery;
 insert into public.admin_alert_outbox(kind,title,detail,order_id,amount_cents,payload,dedup_key)
 values('recovery_case_opened','Card dispute requires reconciliation',left(p_detail,2000),
 case when cardinality(entry.order_ids)=1 then entry.order_ids[1] else null end,entry.amount_cents,
 jsonb_build_object('recovery_id',recovery,'dispute_id',p_dispute),'stripe-dispute:'||p_dispute)
 on conflict(dedup_key) do nothing;
 return 'recovery_recorded';
end $$;

create or replace function public.apply_stripe_dispute_event(
 p_dispute text,p_intent text,p_amount integer,p_currency text,p_status text,
 p_closed boolean,p_event text,p_created bigint,p_lease uuid
) returns text language plpgsql security definer set search_path=public,pg_temp as $$
declare entry public.stripe_dispute_journal%rowtype; ids uuid[]; total bigint;
 valid boolean; order_row public.orders%rowtype; prior_exists boolean;
begin
 if p_closed is null then raise exception 'Missing dispute event phase'; end if;
 if p_closed and (p_status in ('won','warning_closed','lost')) is distinct from true then return 'retry'; end if;
 if p_dispute is null or p_intent is null or p_event is null or p_lease is null or p_created is null or p_amount<=0 or p_currency!~'^[a-z]{3}$' then raise exception 'Invalid dispute event'; end if;
 perform pg_advisory_xact_lock(hashtextextended('stripe-dispute:'||p_intent,0));
 select * into entry from public.stripe_dispute_journal where dispute_id=p_dispute for update;
 prior_exists:=found;
 if prior_exists then
  if entry.payment_reference<>p_intent or entry.amount_cents<>p_amount or entry.currency<>p_currency then return public.hold_stripe_dispute(p_dispute,'Provider dispute identity, amount or currency changed. Reconcile against the original journal.'); end if;
  if entry.state='recovery' then return 'recovery_recorded'; end if;
  if not p_closed and entry.state<>'open' then return 'committed'; end if;
  if p_closed and entry.state in ('won','warning_closed','lost') then
   if entry.state=p_status then return 'committed'; end if;
   return public.hold_stripe_dispute(p_dispute,'Conflicting terminal provider dispute outcomes require review.');
  end if;
  if entry.state='loss_pending' and p_closed and p_status<>'lost' then return public.hold_stripe_dispute(p_dispute,'Conflicting terminal outcome during chargeback booking.'); end if;
  if entry.state='loss_pending' and entry.lease_expires_at>now() then return 'retry'; end if;
  if not p_closed and p_created<=entry.last_event_created then return 'committed'; end if;
 end if;
 select array_agg(distinct p.order_id order by p.order_id),sum(p.amount_cents),
 bool_and(lower(p.currency)=p_currency and p.status in ('succeeded','partially_refunded','refunded'))
 into ids,total,valid from public.payments p where p.provider='stripe' and p.provider_reference=p_intent;
 if ids is null then return 'retry'; end if;
 if not prior_exists then
  insert into public.stripe_dispute_journal(dispute_id,payment_reference,amount_cents,currency,state,last_event_id,last_event_created,order_ids)
  values(p_dispute,p_intent,p_amount,p_currency,'open',p_event,p_created,ids)
  returning * into entry;
 end if;
 if cardinality(ids)>50 then return public.hold_stripe_dispute(p_dispute,'Dispute basket exceeds the bounded automatic-processing limit.'); end if;
 if ids is distinct from entry.order_ids or total<>p_amount or valid is distinct from true then
  return public.hold_stripe_dispute(p_dispute,'The dispute does not exactly match the frozen payment basket and currency. Allocate the provider amount before booking any refund.');
 end if;
 perform id from public.orders where id=any(ids) order by id for update;
 if (select sum(total_cents) from public.orders where id=any(ids))<>p_amount or exists(select 1 from public.orders o where o.id=any(ids) and lower(o.currency)<>p_currency) then
  return public.hold_stripe_dispute(p_dispute,'Order and provider dispute currencies differ.');
 end if;
 if p_closed and p_status not in ('won','warning_closed','lost') then return 'retry'; end if;
 -- Won/closed-before-created is journaled without inventing a prior hold.
 if p_closed and p_status in ('won','warning_closed') then
  if exists(select 1 from public.orders o where o.id=any(ids) and o.status='disputed' and o.stripe_dispute_id=p_dispute and o.dispute_reason not like '% — '||p_dispute) then
   return public.hold_stripe_dispute(p_dispute,'A newer in-app dispute owns an order; provider closure cannot resolve it.');
  end if;
  update public.orders set status=coalesce(pre_dispute_status,'paid'),dispute_resolved_at=now()
   where id=any(ids) and status='disputed' and stripe_dispute_id=p_dispute
   and dispute_reason like '% — '||p_dispute;
  update public.stripe_dispute_journal set state=p_status,last_event_id=p_event,last_event_created=p_created,updated_at=now() where dispute_id=p_dispute;
  return 'committed';
 end if;
 if exists(select 1 from public.orders o where o.id=any(ids) and (
  (o.status='disputed' and o.stripe_dispute_id is distinct from p_dispute)
  or (o.status not in ('paid','shipped','delivered','completed','disputed') and entry.state<>'loss_pending')
  or (p_status='lost' and p_closed and o.refunded_cents>0 and entry.state<>'loss_pending')
 )) then return public.hold_stripe_dispute(p_dispute,'Existing order/dispute/refund state prevents safe automatic chargeback allocation.'); end if;
 for order_row in select * from public.orders where id=any(ids) loop
  if order_row.status<>'disputed' and entry.state<>'loss_pending' then
   update public.orders set status='disputed',pre_dispute_status=order_row.status,
    disputed_at=now(),dispute_resolved_at=null,dispute_outcome=null,dispute_category='other',
    dispute_reason='Card dispute via Stripe — '||p_dispute,stripe_dispute_id=p_dispute
   where id=order_row.id;
  end if;
 end loop;
 update public.stripe_dispute_journal set state=case when p_closed then 'loss_pending' else 'open' end,
 last_event_id=p_event,last_event_created=p_created,
 lease_id=case when p_closed then p_lease else null end,
 lease_expires_at=case when p_closed then now()+interval '5 minutes' else null end,updated_at=now()
 where dispute_id=p_dispute;
 return case when p_closed then 'apply_loss' else 'committed' end;
end $$;

create or replace function public.complete_stripe_dispute_loss(p_dispute text,p_event text,p_lease uuid) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare entry public.stripe_dispute_journal%rowtype;
begin
 select * into strict entry from public.stripe_dispute_journal where dispute_id=p_dispute for update;
 if entry.state<>'loss_pending' or entry.last_event_id<>p_event or entry.lease_id is distinct from p_lease or entry.lease_expires_at<=now() then raise exception 'Dispute lease lost'; end if;
 if exists(select 1 from public.orders where id=any(entry.order_ids) and refunded_cents<>total_cents) then raise exception 'Dispute refund ledger incomplete'; end if;
 update public.stripe_dispute_journal set state='lost',lease_id=null,lease_expires_at=null,updated_at=now() where dispute_id=p_dispute;
end $$;
revoke all on function public.hold_stripe_dispute(text,text),public.apply_stripe_dispute_event(text,text,integer,text,text,boolean,text,bigint,uuid),public.complete_stripe_dispute_loss(text,text,uuid) from public,anon,authenticated;
grant execute on function public.hold_stripe_dispute(text,text),public.apply_stripe_dispute_event(text,text,integer,text,text,boolean,text,bigint,uuid),public.complete_stripe_dispute_loss(text,text,uuid) to service_role;
create or replace function public.worker_health_snapshot() returns jsonb
language sql security definer set search_path=public,pg_temp as $$
 with families(family,budget) as (values
 ('expiries',interval '30 minutes'),('captures',interval '30 minutes'),
 ('transfers',interval '30 minutes'),('transferReconciliation',interval '30 minutes'),
 ('refunds',interval '30 minutes'),('returns',interval '30 minutes'),
 ('disputes',interval '30 minutes'),('alerts',interval '30 minutes'),
 ('receipts',interval '30 minutes'),('analytics',interval '30 minutes'),
 ('search',interval '30 minutes'),('deletions',interval '30 minutes'),
 ('savedSearches',interval '90 minutes'),('media',interval '26 hours')),
 runs as (
 select f.family,f.budget,
 max(r.finished_at) filter(where r.status='succeeded') last_success,
 max(r.finished_at) filter(where r.status='failed') last_failure,
 min(r.started_at) filter(where r.status='running') running_since
 from families f left join public.worker_runs r on r.family=f.family group by f.family,f.budget),
 runnable as (
 select kind,status,next_attempt_at due_at from public.remediation_jobs where status='failed' or (status='pending' and next_attempt_at<=now())
 union all select kind,'processing',locked_until from public.remediation_jobs where status='processing' and locked_until<=now()
 union all select 'alerts',status,next_attempt_at from public.admin_alert_outbox where status='failed' or (status='pending' and next_attempt_at<=now())
 union all select 'transfers',status,greatest(coalesce(available_at,created_at),coalesce(next_attempt_at,created_at)) from public.transfer_intents
 where status in ('holding','ready','blocked_unpayable','failed') and greatest(coalesce(available_at,created_at),coalesce(next_attempt_at,created_at))<=now()
 union all select 'transfers','processing',lease_expires_at from public.transfer_intents where status='processing' and lease_expires_at<=now()
 union all select 'refunds',status,coalesce(next_attempt_at,created_at) from public.refund_operations
 where status in ('requested','provider_pending','provider_succeeded','effects_pending','reversal_pending','failed','recovery_required')
 and coalesce(next_attempt_at,created_at)<=now()
 and coalesce(provider_status,'unknown') not in ('pending','requires_action')
 union all select 'provider_disputes','recovery_required',lease_expires_at from public.stripe_dispute_journal where state='loss_pending' and lease_expires_at<=now()
 union all select 'financial_recovery','open',created_at from public.payment_recoveries where status='open'
 ), queues as (
 select kind,status,count(*) count,min(due_at) oldest,
 (status in ('failed','recovery_required') or kind='financial_recovery' or min(due_at)<now()-interval '30 minutes') overdue
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
