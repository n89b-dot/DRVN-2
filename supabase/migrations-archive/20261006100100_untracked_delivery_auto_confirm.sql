-- 20261006100100 — untracked shipments can be confirmed delivered without the
-- buyer, if the owner turns it on.
--
-- A shipped order becomes 'delivered' — and its payout clock starts
-- (20261004140000) — only when the buyer confirms receipt, a carrier scan
-- reports delivery (apply-tracking.ts), or a pickup is redeemed. A parcel the
-- seller posted with a tracking number DRVN doesn't follow never gets a scan,
-- so a buyer who never presses "received" leaves the seller unpaid for good.
--
-- This adds the rule, switched OFF (docs/decisions/untracked-auto-confirm.md):
--
--   settlement_settings.auto_confirm_after_days   null = off (the default);
--                                                 7–60 = days after dispatch
--   settlement_settings.auto_confirm_notice_days  how long before that the
--                                                 buyer is warned (default 3)
--
-- When on, an hourly pg_cron job (drvn-delivery-auto-confirm) runs
-- auto_confirm_untracked_deliveries():
--   1. warns the buyer of each eligible order once the order is N − notice
--      days old: "confirm receipt or report a problem". The warning freezes
--      the confirmation date, which is never sooner than the full notice
--      period after the warning — switching the rule on over a backlog of old
--      orders still gives every buyer their notice;
--   2. on that date, if the order is still eligible, marks it delivered,
--      records a 'delivered' event on its outbound shipment that says why,
--      and tells the buyer (and, through notify_on_order_status, the seller).
--
-- Eligible means: still 'shipped', not a collection, a buyer to warn, never
-- disputed (by the buyer or the card issuer), nothing refunded or being
-- refunded, no return ever opened, and no carrier tracking on any outbound
-- parcel — a parcel DRVN tracks waits for its scan, and one the carrier
-- reported as failed or returned is a problem, not a delivery. An order that
-- stops being eligible between warning and date is left alone.
--
-- The transition mirrors mark_order_received's shipped → delivered branch
-- (20261006100000): the same order, shipment and transfer-intent writes, the
-- same refusal when the seller's transfer obligation is missing. Order status
-- guards and the payout-clock trigger fire as they do for a buyer's receipt.
--
-- Each run is recorded as the deliveryAutoConfirm worker family (also while
-- the rule is off, so the job itself is monitored); a failed order fails the
-- run, keeps its reason on its row and is retried next hour.
--
-- Idempotent: one row per order (the warning is sent once), the shipment
-- event dedupes on its reference, unschedule-by-name before scheduling.

begin;

alter table public.settlement_settings
  add column if not exists auto_confirm_after_days integer,
  add column if not exists auto_confirm_notice_days integer not null default 3;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'settlement_settings_auto_confirm_days') then
    alter table public.settlement_settings add constraint settlement_settings_auto_confirm_days
      check (auto_confirm_after_days is null or auto_confirm_after_days between 7 and 60);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'settlement_settings_auto_confirm_notice') then
    alter table public.settlement_settings add constraint settlement_settings_auto_confirm_notice
      check (auto_confirm_notice_days between 1 and 7
             and (auto_confirm_after_days is null or auto_confirm_after_days > auto_confirm_notice_days));
  end if;
end $$;

-- One row per warned order: the warning, the date the buyer was given, and
-- what happened. Server-side bookkeeping only; the order page shows the
-- shipment event and the buyer's notifications.
create table if not exists public.delivery_auto_confirmations (
  order_id uuid primary key references public.orders (id) on delete cascade,
  after_days integer not null,
  reminded_at timestamptz not null default now(),
  confirm_at timestamptz not null,
  confirmed_at timestamptz,
  last_error text
);

create index if not exists delivery_auto_confirmations_due_idx
  on public.delivery_auto_confirmations (confirm_at) where confirmed_at is null;

alter table public.delivery_auto_confirmations enable row level security;
revoke all on public.delivery_auto_confirmations from public, anon, authenticated;

create or replace function public.delivery_auto_confirm_eligible(p_order uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
      from public.orders o
     where o.id = p_order
       and o.status = 'shipped'
       and not o.is_collection
       and o.shipped_at is not null
       and o.delivered_at is null
       and o.buyer_id is not null
       and o.disputed_at is null
       and o.stripe_dispute_id is null
       and o.refunded_cents = 0
       and not exists (select 1 from public.returns r where r.order_id = o.id)
       and not exists (select 1 from public.refund_operations ro where ro.order_id = o.id)
       and not exists (
         select 1 from public.shipments s
          where s.order_id = o.id
            and s.direction = 'outbound'
            and (s.provider_tracker_id is not null
                 or s.status in ('delivered', 'returned_to_sender', 'failed'))
       )
  );
$$;

-- The shipped → delivered transition for one warned order, in the caller's
-- transaction. Returns false when the order is not due or no longer
-- eligible; raises when it can't be completed safely.
create or replace function public.auto_confirm_delivery(p_order uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  pending public.delivery_auto_confirmations;
  o public.orders;
  stub_settlement boolean := false;
  stamped_at timestamptz := now();
begin
  select * into pending from public.delivery_auto_confirmations
   where order_id = p_order and confirmed_at is null
   for update;
  if not found or pending.confirm_at > stamped_at then return false; end if;

  select * into strict o from public.orders where id = p_order for update;
  if not public.delivery_auto_confirm_eligible(o.id) then return false; end if;

  -- The same obligation check as mark_order_received: a real order must
  -- have a transfer intent for the seller; only a stub-settled one may not.
  if not exists (select 1 from public.transfer_intents where order_id = o.id) then
    select exists(
      select 1 from public.payments p where p.order_id = o.id
      and p.provider = 'stub' and p.status = 'succeeded' and p.provider_reference is not null
      and p.amount_cents = o.total_cents and lower(p.currency) = lower(o.currency)
    ) into stub_settlement;
    if not stub_settlement then raise exception 'Seller transfer obligation is missing'; end if;
  end if;

  -- notify_on_order_status reads this to tell the seller why the order is
  -- delivered; it is local to the transaction and cleared straight after.
  perform set_config('drvn.delivery_source', 'auto_confirm', true);
  update public.orders
     set status = 'delivered', delivered_at = stamped_at, completed_at = stamped_at
   where id = o.id;
  perform set_config('drvn.delivery_source', '', true);

  update public.shipments
     set status = 'delivered', delivered_at = coalesce(delivered_at, stamped_at)
   where order_id = o.id and direction = 'outbound'
     and status in ('label_purchased', 'in_transit', 'out_for_delivery');

  insert into public.shipment_events (shipment_id, provider_event_ref, status, description, occurred_at)
  select s.id, 'drvn:auto-confirm', 'delivered',
         'Marked delivered automatically: no problem was reported within '
           || pending.after_days || ' days of dispatch',
         stamped_at
    from public.shipments s
   where s.order_id = o.id and s.direction = 'outbound' and s.status = 'delivered'
  on conflict do nothing;

  if not stub_settlement then
    update public.transfer_intents
       set available_at = coalesce(available_at, public.payout_available_at(o.id, stamped_at)),
           updated_at = now()
     where order_id = o.id and status = 'holding';
  end if;

  update public.delivery_auto_confirmations
     set confirmed_at = stamped_at, last_error = null
   where order_id = o.id;

  perform public.notify(
    o.buyer_id, 'receipt_auto_confirmed', 'marketplace',
    'We marked your order delivered',
    'No problem was reported, so the order is complete and the seller will be paid. If something is wrong, report it from the order.',
    '/orders/' || o.id, null
  );
  return true;
end;
$$;

create or replace function public.auto_confirm_untracked_deliveries(p_limit integer default 200)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  after_days integer;
  notice_days integer;
  run_id uuid := gen_random_uuid();
  started timestamptz := clock_timestamp();
  reminded integer := 0;
  confirmed integer := 0;
  failed integer := 0;
  candidate record;
  due timestamptz;
  days_left integer;
  summary jsonb;
begin
  select s.auto_confirm_after_days, s.auto_confirm_notice_days
    into after_days, notice_days
    from public.settlement_settings s
   where s.id;

  if after_days is not null then
    -- 1. Warn. The row is the "sent once" record: a second run finds it.
    for candidate in
      select o.id, o.buyer_id, o.shipped_at
        from public.orders o
       where o.status = 'shipped'
         and o.shipped_at <= now() - make_interval(days => after_days - notice_days)
         and not exists (select 1 from public.delivery_auto_confirmations a where a.order_id = o.id)
         and public.delivery_auto_confirm_eligible(o.id)
       order by o.shipped_at, o.id
       limit p_limit
    loop
      begin
        due := greatest(candidate.shipped_at + make_interval(days => after_days),
                        now() + make_interval(days => notice_days));
        insert into public.delivery_auto_confirmations (order_id, after_days, confirm_at)
        values (candidate.id, after_days, due)
        on conflict (order_id) do nothing;
        if found then
          days_left := ceil(extract(epoch from due - now()) / 86400)::integer;
          perform public.notify(
            candidate.buyer_id, 'receipt_due', 'marketplace',
            'Has your order arrived?',
            'Confirm receipt or report a problem. If we don''t hear from you, we''ll mark it delivered in '
              || days_left || case when days_left = 1 then ' day' else ' days' end
              || ' and the seller will be paid.',
            '/orders/' || candidate.id, null
          );
          reminded := reminded + 1;
        end if;
      exception when others then
        failed := failed + 1;
        raise warning 'auto-confirm reminder failed for order %: %', candidate.id, sqlerrm;
      end;
    end loop;

    -- 2. Confirm what is due and still eligible. Each order is its own
    --    subtransaction: one failure rolls back only that order.
    for candidate in
      select a.order_id
        from public.delivery_auto_confirmations a
       where a.confirmed_at is null
         and a.confirm_at <= now()
         and public.delivery_auto_confirm_eligible(a.order_id)
       order by a.confirm_at, a.order_id
       limit p_limit
    loop
      begin
        if public.auto_confirm_delivery(candidate.order_id) then
          confirmed := confirmed + 1;
        end if;
      exception when others then
        failed := failed + 1;
        update public.delivery_auto_confirmations
           set last_error = left(sqlerrm, 500)
         where order_id = candidate.order_id;
      end;
    end loop;
  end if;

  summary := jsonb_build_object(
    'enabled', after_days is not null,
    'after_days', after_days,
    'reminded', reminded,
    'confirmed', confirmed,
    'failed', failed
  );
  insert into public.worker_runs (id, family, status, started_at, finished_at, summary)
  values (run_id, 'deliveryAutoConfirm', case when failed > 0 then 'failed' else 'succeeded' end,
          started, clock_timestamp(), summary);
  return summary;
end;
$$;

revoke all on function public.delivery_auto_confirm_eligible(uuid) from public, anon, authenticated;
revoke all on function public.auto_confirm_delivery(uuid) from public, anon, authenticated;
revoke all on function public.auto_confirm_untracked_deliveries(integer) from public, anon, authenticated;
grant execute on function public.delivery_auto_confirm_eligible(uuid) to service_role;
grant execute on function public.auto_confirm_delivery(uuid) to service_role;
grant execute on function public.auto_confirm_untracked_deliveries(integer) to service_role;

-- Latest: 0014_disputes. Changed: the seller's 'delivered' message says why
-- when the order was confirmed automatically rather than by the buyer.
create or replace function public.notify_on_order_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = old.status then
    return new;
  end if;

  if new.status = 'disputed' then
    perform public.notify(
      new.seller_id, 'order_disputed', 'marketplace',
      'A buyer opened a dispute',
      coalesce(new.dispute_reason, 'See the order for details'),
      '/orders/' || new.id, new.disputed_by
    );
  elsif old.status = 'disputed' and new.status <> 'refunded' then
    -- Resolved without a full refund: buyer closed it, or a partial refund
    -- was accepted and the order settled back to pre_dispute_status. The
    -- order/payment rows themselves carry whether money moved, so the
    -- notification just points both parties back at the order.
    perform public.notify(
      new.buyer_id, 'dispute_resolved', 'marketplace',
      'Dispute resolved', 'The order is settled', '/orders/' || new.id, null
    );
    perform public.notify(
      new.seller_id, 'dispute_resolved', 'marketplace',
      'Dispute resolved', 'The order is settled', '/orders/' || new.id, null
    );
  elsif new.status = 'paid' then
    perform public.notify(
      new.seller_id, 'order_sold', 'marketplace',
      'You made a sale',
      'Order ' || left(new.id::text, 8) || ' — dispatch when ready',
      '/orders/' || new.id, new.buyer_id
    );
    perform public.notify(
      new.buyer_id, 'order_paid', 'marketplace',
      'Payment confirmed', 'Your order is with the seller',
      '/orders/' || new.id, new.seller_id
    );
  elsif new.status = 'shipped' then
    perform public.notify(
      new.buyer_id, 'order_shipped', 'marketplace',
      'Your part is on its way',
      coalesce(new.carrier || ' · ' || new.tracking_number, 'Dispatched'),
      '/orders/' || new.id, new.seller_id
    );
  elsif new.status = 'delivered' then
    perform public.notify(
      new.seller_id, 'order_delivered', 'marketplace',
      'Delivery confirmed',
      case when current_setting('drvn.delivery_source', true) = 'auto_confirm'
        then 'No problem was reported in time, so the order was marked delivered'
        else 'The buyer marked the order received' end,
      '/orders/' || new.id, new.buyer_id
    );
  elsif new.status in ('cancelled', 'refunded', 'payment_failed') then
    perform public.notify(
      new.buyer_id, 'order_' || new.status, 'marketplace',
      'Order ' || replace(new.status, '_', ' '),
      coalesce(new.cancel_reason, null), '/orders/' || new.id, null
    );
    perform public.notify(
      new.seller_id, 'order_' || new.status, 'marketplace',
      'Order ' || replace(new.status, '_', ' '),
      coalesce(new.cancel_reason, null), '/orders/' || new.id, null
    );
  end if;

  return new;
end;
$$;

do $$
declare
  j record;
begin
  for j in select jobid from cron.job where jobname = 'drvn-delivery-auto-confirm'
  loop
    perform cron.unschedule(j.jobid);
  end loop;
end $$;

-- Hourly; the rule is counted in days, so an hour's lag is immaterial.
select cron.schedule('drvn-delivery-auto-confirm', '23 * * * *',
  $job$select public.auto_confirm_untracked_deliveries();$job$);

-- Latest: 20261004150000. Changed: the deliveryAutoConfirm family, on a
-- 3-hour budget (it runs hourly).
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
 ('media',interval '26 hours'),('listingImports',interval '26 hours'),
 ('deliveryAutoConfirm',interval '3 hours')),
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

do $$
begin
  if not exists (
    select 1 from cron.job
    where jobname = 'drvn-delivery-auto-confirm'
      and schedule = '23 * * * *'
      and command like '%auto_confirm_untracked_deliveries()%'
  ) then
    raise exception 'SELF-CHECK FAILED: delivery auto-confirm not scheduled';
  end if;
  if not exists (
    select 1 from jsonb_array_elements(public.worker_health_snapshot()->'families') f
    where f->>'family' = 'deliveryAutoConfirm'
  ) then
    raise exception 'SELF-CHECK FAILED: deliveryAutoConfirm missing from worker health';
  end if;
  if has_function_privilege('authenticated', 'public.auto_confirm_untracked_deliveries(integer)', 'execute')
     or has_function_privilege('authenticated', 'public.auto_confirm_delivery(uuid)', 'execute') then
    raise exception 'SELF-CHECK FAILED: auto-confirm is client-callable';
  end if;
end $$;

notify pgrst, 'reload schema';
commit;
