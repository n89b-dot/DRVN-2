-- Additive remediation. Apply before the corresponding application build.
begin;
-- A basket intentionally shares one provider intent across its seller orders.
-- Uniqueness belongs to the persisted request and each order's payment row.
drop index if exists public.payments_provider_reference_idx;
create index payments_provider_reference_idx on public.payments(provider,provider_reference) where provider_reference is not null;
create unique index if not exists payments_one_per_order on public.payments(order_id);
alter table public.purchase_attempts add column if not exists request_fingerprint jsonb;
alter table public.refund_operations add column if not exists purpose text not null default 'refund' check (purpose in ('refund','late_capture'));
create table if not exists public.payment_requests (
  operation_key text primary key, request jsonb not null, correlation_id uuid not null default gen_random_uuid(),
  provider_reference text unique, created_at timestamptz not null default now()
);
alter table public.payment_requests enable row level security;
revoke all on public.payment_requests from public, anon, authenticated;
grant all on public.payment_requests to service_role;

create table if not exists public.remediation_jobs (
 id uuid primary key default gen_random_uuid(), kind text not null check(kind in ('receipt','search','delete_account')),
 dedup_key text unique not null, payload jsonb not null, status text not null default 'pending' check(status in ('pending','processing','completed','failed')),
 attempts int not null default 0, next_attempt_at timestamptz not null default now(), locked_until timestamptz,
 lease_id uuid, last_error text, created_at timestamptz not null default now(), completed_at timestamptz
);
alter table public.remediation_jobs enable row level security;
revoke all on public.remediation_jobs from public, anon, authenticated;
grant all on public.remediation_jobs to service_role;
create index if not exists remediation_jobs_due on public.remediation_jobs(next_attempt_at) where status in ('pending','processing');

create or replace function public.prepare_payment_request(p_key text, p_request jsonb) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.payment_requests;
begin
 insert into public.payment_requests(operation_key,request) values(p_key,p_request) on conflict do nothing;
 select * into r from public.payment_requests where operation_key=p_key for update;
 if r.request <> p_request then raise exception 'Payment parameters changed'; end if;
 return jsonb_build_object('request',r.request,'correlation_id',r.correlation_id,'reference',r.provider_reference,'created_at',r.created_at);
end $$;
create or replace function public.record_payment_reference(p_key text,p_reference text) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare saved_request jsonb;
begin
 update public.payment_requests set provider_reference=p_reference where operation_key=p_key and (provider_reference is null or provider_reference=p_reference) returning request into saved_request;
 if not found then raise exception 'Payment reference conflict'; end if;
 -- Persist the order mapping before returning a client secret or processing
 -- result. A crash in the caller cannot strand an already-created intent.
 if exists(select 1 from public.payments where order_id::text in (select jsonb_array_elements_text(saved_request->'orderIds')) and provider_reference is not null and provider_reference<>p_reference) then raise exception 'Order payment reference conflict'; end if;
 update public.payments set provider='stripe',provider_reference=p_reference
 where order_id::text in (select jsonb_array_elements_text(saved_request->'orderIds'));
end $$;

create or replace function public.claim_remediation_jobs(p_kind text,p_limit int default 20) returns jsonb
language sql security definer set search_path=public,pg_temp as $$
 with exhausted as (update public.remediation_jobs set status='failed',last_error='Worker lease expired at retry limit',locked_until=null where kind=p_kind and status='processing' and locked_until<now() and attempts>=10 returning id),
 due as (select id from public.remediation_jobs where kind=p_kind and attempts<10 and next_attempt_at<=now()
 and (status='pending' or (status='processing' and locked_until<now())) order by next_attempt_at,id for update skip locked limit least(greatest(p_limit,1),50)),
 claimed as (update public.remediation_jobs j set status='processing',attempts=attempts+1,lease_id=gen_random_uuid(),locked_until=now()+interval '2 minutes'
 from due where j.id=due.id returning j.*) select coalesce(jsonb_agg(claimed),'[]'::jsonb) from claimed;
$$;
create or replace function public.finish_remediation_job(p_id uuid,p_lease uuid,p_error text default null) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 update public.remediation_jobs set status=case when p_error is null then 'completed' when attempts>=10 then 'failed' else 'pending' end,
 last_error=left(p_error,500), next_attempt_at=now()+interval '1 minute'*least(60,power(2,attempts)::int), locked_until=null,
 completed_at=case when p_error is null then now() else null end where id=p_id and lease_id=p_lease and status='processing';
 if not found then raise exception 'Job lease lost'; end if;
end $$;
create or replace function public.purchase_begin(
  p_buyer_id uuid,
  p_listing_ids uuid[],
  p_idempotency_key text default null,
  p_reservation_window interval default interval '15 minutes',
  p_shipping_overrides jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_previous jsonb;
  v_owner uuid;
  v_fingerprint jsonb;
  v_orders jsonb := '[]'::jsonb;
  v_skipped jsonb := '[]'::jsonb;
  v_group record;
  v_order_id uuid;
  v_fee int;
  v_requested uuid[];
  v_claimed uuid[];
begin
  perform pg_advisory_xact_lock(hashtextextended(p_buyer_id::text, 0));
  if exists(select 1 from public.profiles where id=p_buyer_id and suspended_at is not null) then raise exception 'Account unavailable'; end if;
  v_fingerprint := jsonb_build_object('ids', (select jsonb_agg(x order by x) from (select distinct unnest(p_listing_ids) x) t), 'shipping', coalesce(p_shipping_overrides, '{}'::jsonb));
  if p_idempotency_key is not null then
    perform pg_advisory_xact_lock(hashtextextended(p_idempotency_key, 1));
    select buyer_id, request_fingerprint into v_owner, v_previous from public.purchase_attempts where idempotency_key=p_idempotency_key;
    if found and (v_owner is distinct from p_buyer_id or v_previous is distinct from v_fingerprint) then
      raise exception 'Checkout attempt does not match this buyer or basket' using errcode='42501';
    end if;
    select result into v_previous
    from public.purchase_attempts
    where idempotency_key = p_idempotency_key;

    if v_previous is not null then
      return v_previous;
    end if;
  end if;

  if (select count(*) from public.orders where buyer_id=p_buyer_id and status in ('pending','requires_action')) >= 5 then
    raise exception 'Too many unresolved checkouts';
  end if;
  if (select count(distinct currency) from public.listings where id=any(p_listing_ids)) > 1 then raise exception 'A checkout must use one currency'; end if;
  if cardinality(p_listing_ids)>50 then raise exception 'Checkout supports at most 50 items'; end if;
  if (select count(distinct seller_id) from public.listings where id=any(p_listing_ids))>13 then raise exception 'Split this basket into checkouts with at most 13 sellers'; end if;
  v_requested := coalesce(p_listing_ids, array[]::uuid[]);
  if array_length(v_requested, 1) is null then
    return jsonb_build_object('orders', v_orders, 'skipped', v_skipped);
  end if;

  -- Claim. Anything not returned here was unavailable, someone else's win, or
  -- the buyer's own listing.
  --
  -- `on commit drop` only fires at commit, so a second call inside the same
  -- transaction would otherwise find the table still there. Temp tables are
  -- per-session, so this cannot interfere with a concurrent buyer.
  drop table if exists _claimed;
  create temp table _claimed on commit drop as
  with claimed as (
    update public.listings l
    set status = 'reserved',
        reserved_until = now() + p_reservation_window
    where l.id = any (v_requested)
      and l.status = 'active'
      and l.seller_id <> p_buyer_id
    returning
      l.id, l.seller_id, l.title, l.price_cents, l.shipping_cents, l.currency
  )
  select
    c.id, c.seller_id, c.title, c.price_cents, c.currency,
    -- Rated checkout (0053): the server-validated quote amount replaces the
    -- flat charge where an override is present. Never negative.
    greatest(
      coalesce((p_shipping_overrides ->> c.id::text)::int, c.shipping_cents),
      0
    ) as shipping_cents
  from claimed c;

  select coalesce(array_agg(id), array[]::uuid[]) into v_claimed from _claimed;

  select coalesce(
    jsonb_agg(jsonb_build_object('listing_id', missing.id, 'reason', 'unavailable')),
    '[]'::jsonb
  )
  into v_skipped
  from (select unnest(v_requested) as id except select unnest(v_claimed)) as missing;

  -- One order per seller per currency.
  for v_group in
    select
      c.seller_id,
      c.currency,
      sum(c.price_cents)::int as subtotal,
      sum(c.shipping_cents)::int as shipping
    from _claimed c
    group by c.seller_id, c.currency
  loop
    -- Fee basis is everything the buyer pays before tax: goods + shipping
    -- (0050). Pricing value into "shipping" no longer reduces DRVN's fee.
    v_fee := round((v_group.subtotal + v_group.shipping) * 1000.0 / 10000.0);

    insert into public.orders (
      buyer_id, seller_id, status,
      subtotal_cents, shipping_cents, platform_fee_cents, total_cents, currency
    )
    values (
      p_buyer_id, v_group.seller_id, 'pending',
      v_group.subtotal, v_group.shipping, v_fee,
      v_group.subtotal + v_group.shipping, v_group.currency
    )
    returning id into v_order_id;

    insert into public.order_items (order_id, listing_id, title, price_cents, shipping_cents)
    select v_order_id, c.id, c.title, c.price_cents, c.shipping_cents
    from _claimed c
    where c.seller_id = v_group.seller_id and c.currency = v_group.currency;

    insert into public.payments (order_id, amount_cents, currency, idempotency_key, status)
    values (
      v_order_id,
      v_group.subtotal + v_group.shipping,
      v_group.currency,
      case
        when p_idempotency_key is null then null
        else p_idempotency_key || ':' || v_order_id::text
      end,
      'pending'
    );

    v_orders := v_orders || jsonb_build_object(
      'order_id', v_order_id,
      'seller_id', v_group.seller_id,
      'currency', v_group.currency,
      'subtotal_cents', v_group.subtotal,
      'shipping_cents', v_group.shipping,
      'platform_fee_cents', v_fee,
      'total_cents', v_group.subtotal + v_group.shipping,
      'listing_ids', (
        select jsonb_agg(c.id)
        from _claimed c
        where c.seller_id = v_group.seller_id and c.currency = v_group.currency
      )
    );
  end loop;

  v_previous := jsonb_build_object('orders', v_orders, 'skipped', v_skipped);

  if p_idempotency_key is not null then
    insert into public.purchase_attempts (idempotency_key, buyer_id, result, request_fingerprint)
    values (p_idempotency_key, p_buyer_id, v_previous, v_fingerprint)
    on conflict (idempotency_key) do nothing;
  end if;

  return v_previous;
end;
$$;

revoke all on function public.purchase_begin(uuid, uuid[], text, interval, jsonb)
  from public, anon, authenticated;

create or replace function public.settle_refund_operation(p_operation_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_op        public.refund_operations;
  v_order     record;
  v_payment   record;
  v_before    int;
  v_after     int;
  v_fully     boolean;
  v_transfer  int;   -- seller share of the order (total − fee)
  v_rev_due   int;
  v_fee_after int;
  v_next      text;
begin
  select * into v_op from public.refund_operations
    where id = p_operation_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'Operation not found.');
  end if;
  if v_op.status not in ('provider_succeeded', 'effects_pending') then
    return jsonb_build_object('ok', true, 'already', true, 'status', v_op.status,
      'reversal_due_cents', coalesce(v_op.reversal_due_cents, 0),
      'fee_refunded_delta', 0);
  end if;

  select id, status, total_cents, platform_fee_cents, refunded_cents,
         platform_fee_refunded_cents, transfer_reference, pre_dispute_status,
         currency
    into v_order
    from public.orders where id = v_op.order_id
    for update;

  v_before := v_order.refunded_cents;
  v_after  := least(v_before + v_op.amount_cents, v_order.total_cents);
  v_fully  := v_after >= v_order.total_cents;

  -- Seller reversal owed, cumulative-deterministic (matches
  -- reversalShareCents in lib/payments/refunds.ts).
  v_transfer := v_order.total_cents - v_order.platform_fee_cents;
  if v_order.transfer_reference is not null and v_transfer > 0 and v_order.total_cents > 0 then
    v_rev_due := least(v_transfer, round((v_after::numeric * v_transfer) / v_order.total_cents))
               - least(v_transfer, round((v_before::numeric * v_transfer) / v_order.total_cents));
  else
    v_rev_due := 0;
  end if;

  v_fee_after := least(v_order.platform_fee_cents,
    round((v_after::numeric * v_order.platform_fee_cents) / greatest(v_order.total_cents, 1)));

  update public.orders o
  set refunded_cents = v_after,
      platform_fee_refunded_cents = v_fee_after,
      refunded_at = now(),
      status = case when v_op.purpose = 'late_capture' then o.status when v_fully then 'refunded'
                    when v_op.resolve_dispute and o.status = 'disputed'
                      then coalesce(v_order.pre_dispute_status, 'delivered')
                    else o.status end,
      cancelled_at = case when v_fully then now() else o.cancelled_at end,
      cancel_reason = case when v_fully then left(v_op.reason, 500) else o.cancel_reason end,
      dispute_resolved_at = case when v_op.resolve_dispute and o.status = 'disputed'
                                 then now() else o.dispute_resolved_at end,
      refund_offer_cents = case when v_op.resolve_dispute and o.status = 'disputed'
                                then null else o.refund_offer_cents end,
      refund_offered_at = case when v_op.resolve_dispute and o.status = 'disputed'
                               then null else o.refund_offered_at end,
      dispute_outcome = case when v_op.resolve_dispute and o.status = 'disputed'
                             then v_op.dispute_outcome else o.dispute_outcome end
  where o.id = v_op.order_id;

  select id, amount_cents, refunded_cents into v_payment
    from public.payments where order_id = v_op.order_id
    limit 1;
  if found then
    update public.payments
    set refunded_cents = coalesce(v_payment.refunded_cents, 0) + v_op.amount_cents,
        status = case when coalesce(v_payment.refunded_cents, 0) + v_op.amount_cents
                           >= v_payment.amount_cents
                      then 'refunded' else 'partially_refunded' end
    where id = v_payment.id;
  end if;

  if v_fully then
    update public.transfer_intents
    set status = 'cancelled', last_error = 'order fully refunded', updated_at = now()
    where order_id = v_op.order_id
      and status in ('holding', 'ready', 'blocked_unpayable', 'failed', 'processing');
  end if;

  v_next := case when v_rev_due > 0 then 'reversal_pending' else 'completed' end;

  update public.refund_operations
  set status = v_next,
      reversal_due_cents = v_rev_due,
      effects_completed_at = now(),
      reversal_completed_at = case when v_rev_due > 0 then null else now() end,
      updated_at = now()
  where id = p_operation_id;

  return jsonb_build_object('ok', true, 'already', false, 'status', v_next,
    'reversal_due_cents', v_rev_due,
    'transfer_reference', v_order.transfer_reference,
    'fully_refunded', v_fully,
    'refunded_after_cents', v_after,
    'fee_refunded_delta', v_fee_after - v_order.platform_fee_refunded_cents);
end;
$$;


-- All local effects of a verified captured basket commit together.
create or replace function public.settle_payment_capture(p_reference text,p_order_ids uuid[],p_amount int,p_currency text,p_source text,p_buyer uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare o public.orders; v_sum bigint; v_count int; v_result jsonb; v_op jsonb; v_late boolean:=false; v_ids uuid[];
begin
 select array_agg(distinct x order by x) into v_ids from unnest(p_order_ids) x;
 if coalesce(cardinality(v_ids),0)=0 then raise exception 'No orders for captured payment'; end if;
 perform 1 from public.orders where id=any(v_ids) order by id for update;
 select sum(total_cents),count(*) into v_sum,v_count from public.orders where id=any(v_ids) and lower(currency)=lower(p_currency) and buyer_id=p_buyer;
 if v_count<>cardinality(v_ids) or v_sum<>p_amount then raise exception 'Captured payment does not match orders'; end if;
 for o in select * from public.orders where id=any(v_ids) order by id loop
   if exists(select 1 from public.payments where order_id=o.id and provider_reference is not null and provider_reference<>p_reference) then raise exception 'Payment reference mismatch'; end if;
   if not exists(select 1 from public.payments where order_id=o.id) then raise exception 'Missing payment ledger'; end if;
   if o.status in ('pending','requires_action') then
     v_result:=public.purchase_finalize(o.id,true,'stripe',p_reference,null);
     if not coalesce((v_result->>'applied')::boolean,false) then raise exception 'Settlement refused'; end if;
     select * into o from public.orders where id=o.id;
   end if;
   if o.status in ('cancelled','payment_failed') then
     v_late:=true;
     update public.payments set provider='stripe',provider_reference=p_reference,status=case when coalesce(refunded_cents,0)>=amount_cents then 'refunded' else 'succeeded' end where order_id=o.id;
     if not exists(select 1 from public.refund_operations where order_id=o.id and purpose='late_capture') then
       v_op:=public.begin_refund_operation(o.id,null,'Payment captured after order cancellation','system:late_capture','system',false,null,p_reference,null,false);
       if not coalesce((v_op->>'ok')::boolean,false) then raise exception 'Cannot reserve compensation: %',v_op; end if;
       update public.refund_operations set purpose='late_capture' where id=(v_op->>'operation_id')::uuid;
     end if;
   elsif o.status in ('paid','shipped','delivered','completed','disputed') then
    if o.refunded_cents<o.total_cents and o.transfer_reference is null then
     insert into public.transfer_intents(order_id,seller_id,amount_cents,currency,status,source_transaction)
       values(o.id,o.seller_id,o.total_cents-o.platform_fee_cents-o.refunded_cents+o.platform_fee_refunded_cents,o.currency,'holding',p_source) on conflict(order_id) do nothing;
     if not exists(select 1 from public.transfer_intents where order_id=o.id and seller_id=o.seller_id and currency=o.currency) then raise exception 'Payout obligation conflict'; end if;
    end if;
   elsif o.status <> 'refunded' then
     raise exception 'Unhandled captured order state: %',o.status;
   end if;
 end loop;
 insert into public.remediation_jobs(kind,dedup_key,payload) values('receipt','receipt:'||p_reference,jsonb_build_object('buyer_id',p_buyer,'order_ids',v_ids,'compensation',v_late)) on conflict(dedup_key) do nothing;
 return jsonb_build_object('outcome',case when v_late then 'compensation_queued' else 'settled' end);
end $$;

-- A captured transaction must never be represented as a mere log on failure.
revoke all on function public.prepare_payment_request(text,jsonb), public.record_payment_reference(text,text), public.claim_remediation_jobs(text,int), public.finish_remediation_job(uuid,uuid,text), public.settle_payment_capture(text,uuid[],int,text,text,uuid) from public,anon,authenticated;
grant execute on function public.prepare_payment_request(text,jsonb), public.record_payment_reference(text,text), public.claim_remediation_jobs(text,int), public.finish_remediation_job(uuid,uuid,text), public.settle_payment_capture(text,uuid[],int,text,text,uuid) to service_role;
grant execute on function public.purchase_begin(uuid,uuid[],text,interval,jsonb), public.settle_refund_operation(uuid) to service_role;
create or replace function public.enqueue_order_receipt(p_buyer uuid,p_destination text) returns void
language sql security definer set search_path=public,pg_temp as $$
 insert into public.remediation_jobs(kind,dedup_key,payload) values('receipt','access:'||p_buyer::text||':'||p_destination,jsonb_build_object('buyer_id',p_buyer,'destination',p_destination)) on conflict(dedup_key) do nothing;
$$;
revoke all on function public.enqueue_order_receipt(uuid,text) from public,anon,authenticated;
grant execute on function public.enqueue_order_receipt(uuid,text) to service_role;
-- Originals never enter public storage through a browser credential.
create policy "public photos require server normalization insert" on storage.objects as restrictive for insert to authenticated
 with check (bucket_id not in ('avatars','car-images','activity-images','listing-images'));
create policy "public photos require server normalization update" on storage.objects as restrictive for update to authenticated
 using (bucket_id not in ('avatars','car-images','activity-images','listing-images'));
-- Transactional search invalidation: a crash after a content commit cannot lose sync.
create or replace function public.queue_search_change() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare r jsonb; entity text; target uuid;
begin
 r:=case when tg_op='DELETE' then to_jsonb(old) else to_jsonb(new) end;
 entity:=tg_argv[0]; target:=(r->>tg_argv[1])::uuid;
 insert into public.remediation_jobs(kind,dedup_key,payload) values('search','search:'||entity||':'||target||':'||txid_current(),jsonb_build_object('entity',entity,'id',target)) on conflict(dedup_key) do nothing;
 if entity='car' then
   insert into public.remediation_jobs(kind,dedup_key,payload)
   select 'search','search:update:'||id||':'||txid_current(),jsonb_build_object('entity','update','id',id) from public.activity_posts where car_id=target on conflict(dedup_key) do nothing;
 elsif entity='profile' then
   insert into public.remediation_jobs(kind,dedup_key,payload)
   select 'search','search:listing:'||id||':'||txid_current(),jsonb_build_object('entity','listing','id',id) from public.listings where seller_id=target on conflict(dedup_key) do nothing;
 end if;
 return coalesce(new,old);
end $$;
create trigger search_listing after insert or update or delete on public.listings for each row execute function public.queue_search_change('listing','id');
create trigger search_listing_fitment after insert or update or delete on public.listing_fitments for each row execute function public.queue_search_change('listing','listing_id');
create trigger search_listing_numbers after insert or update or delete on public.listing_part_numbers for each row execute function public.queue_search_change('listing','listing_id');
create trigger search_car after insert or update or delete on public.cars for each row execute function public.queue_search_change('car','id');
create trigger search_mod after insert or update or delete on public.mod_items for each row execute function public.queue_search_change('car','car_id');
create trigger search_post after insert or update or delete on public.activity_posts for each row execute function public.queue_search_change('update','id');
create trigger search_profile after insert or update or delete on public.profiles for each row execute function public.queue_search_change('profile','id');
revoke all on function public.queue_search_change() from public,anon,authenticated;

create or replace function public.capture_reconciliation_candidates() returns jsonb
language sql security definer set search_path=public,pg_temp as $$
 select coalesce(jsonb_agg(provider_reference),'[]'::jsonb) from (
 select distinct p.provider_reference from public.payments p join public.orders o on o.id=p.order_id
 where p.provider='stripe' and p.provider_reference is not null and (
 o.status in ('pending','requires_action') or
 (o.status in ('paid','shipped','delivered','completed','disputed') and o.refunded_cents<o.total_cents and o.transfer_reference is null and not exists(select 1 from public.transfer_intents t where t.order_id=o.id)) or
 (o.status in ('cancelled','payment_failed') and p.status='succeeded' and not exists(select 1 from public.refund_operations r where r.order_id=o.id and r.purpose='late_capture')))
 order by p.provider_reference limit 50) candidates;
$$;
revoke all on function public.capture_reconciliation_candidates() from public,anon,authenticated;
grant execute on function public.capture_reconciliation_candidates() to service_role;

create table public.worker_runs (
 id uuid primary key, family text not null, started_at timestamptz not null default now(), finished_at timestamptz,
 status text not null default 'running' check(status in ('running','succeeded','failed')), summary jsonb
);
alter table public.worker_runs enable row level security;
revoke all on public.worker_runs from public,anon,authenticated;
grant all on public.worker_runs to service_role;
create index worker_runs_family_time on public.worker_runs(family,started_at desc);
create or replace function public.record_worker_run(p_id uuid,p_family text,p_status text,p_summary jsonb default null) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if p_status='running' then insert into public.worker_runs(id,family) values(p_id,p_family);
 else update public.worker_runs set finished_at=now(),status=p_status,summary=p_summary where id=p_id and family=p_family and status='running';
 if not found then raise exception 'Unknown worker run'; end if; end if;
end $$;
revoke all on function public.record_worker_run(uuid,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.record_worker_run(uuid,text,text,jsonb) to service_role;

-- RLS admin visibility also requires a second-factor session; UI checks alone
-- cannot protect direct authenticated Data API requests.
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path=public,pg_temp as $$
 select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'aal','aal1')='aal2'
 and exists(select 1 from public.admin_users where user_id=auth.uid());
$$;

create or replace function public.execute_admin_command(p_action text,p_subject uuid,p_reason text,p_data jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare actor uuid:=auth.uid(); subject_type text; result jsonb:='{}'; l public.listings; ord public.orders; c public.ops_cases; ids uuid[]; n int;
begin
 if not public.is_admin() or public.admin_role()<>'admin' or not exists(
 select 1 from jsonb_array_elements(coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb->'amr','[]'::jsonb)) m
 where m->>'method' in ('totp','mfa/totp') and (m->>'timestamp')::numeric between extract(epoch from now())-900 and extract(epoch from now())+60
 ) then raise exception 'Admin step-up required' using errcode='42501'; end if;
 if length(trim(p_reason))<1 or length(p_reason)>4000 then raise exception 'A reason of 1–4000 characters is required'; end if;
 case p_action
 when 'listing.remove' then
  subject_type:='listing'; select * into strict l from public.listings where id=p_subject for update;
  if l.status in ('reserved','sold','removed') then raise exception 'Listing is not available for removal'; end if;
  update public.listings set status='removed',removed_at=now(),removed_reason=p_reason where id=p_subject;
  insert into public.notifications(user_id,kind,section,title,body,href) values(l.seller_id,'listing_removed','marketplace','A listing was removed',l.title||' — '||p_reason,'/selling');
  result:=jsonb_build_object('previousStatus',l.status);
 when 'listing.restore' then
  subject_type:='listing'; update public.listings set status='paused',removed_at=null,removed_reason=null where id=p_subject and status='removed';
  if not found then raise exception 'Listing is not removed'; end if;
 when 'user.suspend' then
  subject_type:='user';
  if actor=p_subject or exists(select 1 from public.admin_users where user_id=p_subject) then raise exception 'Admin membership is managed separately'; end if;
  update public.profiles set suspended_at=now(),suspended_reason=p_reason where id=p_subject and suspended_at is null;
  if not found then raise exception 'User is already suspended or missing'; end if;
  with paused as(update public.listings set status='paused' where seller_id=p_subject and status='active' returning id) select array_agg(id) into ids from paused;
  result:=jsonb_build_object('pausedListingIds',coalesce(ids,'{}'::uuid[]));
 when 'user.unsuspend' then
  subject_type:='user'; update public.profiles set suspended_at=null,suspended_reason=null where id=p_subject and suspended_at is not null;
  if not found then raise exception 'User is not suspended'; end if;
  select array(select jsonb_array_elements_text(a.metadata->'result'->'pausedListingIds')::uuid) into ids from public.admin_audit_log a where action='user.suspend' and subject_id=p_subject and metadata->'result' is not null order by created_at desc limit 1;
  with restored as(update public.listings set status='active' where id=any(coalesce(ids,'{}'::uuid[])) and seller_id=p_subject and status='paused' returning id) select array_agg(id) into ids from restored;
  result:=jsonb_build_object('reactivatedListingIds',coalesce(ids,'{}'::uuid[]));
 when 'report.actioned','report.dismissed' then
  subject_type:='report'; update public.reports set status=split_part(p_action,'.',2),resolved_by=actor,resolved_at=now(),resolution_note=p_reason where id=p_subject and status='open';
  if not found then raise exception 'Report is already resolved or missing'; end if;
 when 'recovery.recovered','recovery.written_off' then
  subject_type:='payment'; update public.payment_recoveries set status=split_part(p_action,'.',2),resolved_by=actor,resolved_at=now(),resolution_note=p_reason where id=p_subject and status='open';
  if not found then raise exception 'Recovery is already closed or missing'; end if;
 when 'note.internal' then
  subject_type:=p_data->>'subjectType';
  if subject_type not in ('user','listing','order','report','payment','dispute') then raise exception 'Invalid note subject'; end if;
 when 'dispute.resolve_for_seller' then
  subject_type:='dispute'; select * into strict ord from public.orders where id=p_subject for update;
  if ord.status<>'disputed' then raise exception 'Order is not disputed'; end if;
  update public.orders set status=coalesce(pre_dispute_status,'delivered'),dispute_resolved_at=now(),dispute_outcome='admin_resolved',refund_offer_cents=null,refund_offered_at=null where id=p_subject;
  insert into public.notifications(user_id,kind,section,title,body,href)
  select uid,'admin_action','marketplace','DRVN support resolved this dispute','The dispute was closed in the seller''s favour after review.','/orders/'||p_subject from unnest(array[ord.buyer_id,ord.seller_id]) uid where uid is not null;
  result:=jsonb_build_object('restored',ord.pre_dispute_status);
 when 'order.message_parties' then
  subject_type:='order'; select * into strict ord from public.orders where id=p_subject for update;
  insert into public.notifications(user_id,kind,section,title,body,href)
  select uid,'admin_action','marketplace','A message from DRVN support',p_reason,'/orders/'||p_subject from unnest(array[ord.buyer_id,ord.seller_id]) uid where uid is not null;
  get diagnostics n=row_count; result:=jsonb_build_object('recipients',n);
 when 'case.claim','case.release','case.update' then
  select * into strict c from public.ops_cases where order_id=p_subject or report_id=p_subject for update;
  subject_type:=case when c.kind='dispute' then 'order' else 'report' end;
  if c.status='resolved' then raise exception 'Case is closed'; end if;
  if p_action='case.claim' then
   if c.assigned_to is not null and c.assigned_to<>actor then raise exception 'Case is already assigned'; end if;
   update public.ops_cases set assigned_to=actor,status='claimed',updated_at=now() where id=c.id;
   result:=jsonb_build_object('released',false);
  elsif p_action='case.release' then
   if c.assigned_to is distinct from actor then raise exception 'Only the assignee may release a case'; end if;
   update public.ops_cases set assigned_to=null,status='open',updated_at=now() where id=c.id;
   result:=jsonb_build_object('released',true);
  else
   if p_data->>'priority' not in ('normal','high') or jsonb_typeof(p_data->'labels')<>'array' or jsonb_array_length(p_data->'labels')>6 then raise exception 'Invalid case update'; end if;
   if exists(select 1 from jsonb_array_elements_text(p_data->'labels') label where length(label)>30) then raise exception 'Case label too long'; end if;
   update public.ops_cases set priority=p_data->>'priority',labels=array(select jsonb_array_elements_text(p_data->'labels')),updated_at=now() where id=c.id;
   result:=jsonb_build_object('priority',p_data->>'priority','labels',p_data->'labels');
  end if;

 else raise exception 'Unsupported admin command';
 end case;
 insert into public.admin_audit_log(actor_id,action,subject_type,subject_id,order_id,reason,metadata)
 values(actor,p_action,subject_type,p_subject,(p_data->>'orderId')::uuid,p_reason,jsonb_build_object('phase','completed','result',result));
 return result;
end $$;
revoke all on function public.execute_admin_command(text,uuid,text,jsonb) from public,anon;
grant execute on function public.execute_admin_command(text,uuid,text,jsonb) to authenticated;

create or replace function public.request_account_deletion() returns uuid
language plpgsql security definer set search_path=public,pg_temp as $$
declare uid uuid:=auth.uid(); job uuid;
begin
 if uid is null then raise exception 'Sign in first' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtextextended(uid::text,0));
 select id into job from public.remediation_jobs where dedup_key='delete:'||uid;
 if found then return job; end if;
 perform 1 from public.profiles where id=uid for update;
 if exists(select 1 from public.admin_users where user_id=uid) then raise exception 'Remove admin membership before deleting this account'; end if;
 if exists(select 1 from public.orders where (buyer_id=uid or seller_id=uid) and status not in ('completed','cancelled','payment_failed','refunded'))
 or exists(select 1 from public.transfer_intents where seller_id=uid and status not in ('transferred','cancelled'))
 or exists(select 1 from public.refund_operations r join public.orders o on o.id=r.order_id where (o.buyer_id=uid or o.seller_id=uid) and r.status not in ('completed','failed'))
 or exists(select 1 from public.returns r join public.orders o on o.id=r.order_id where (o.buyer_id=uid or o.seller_id=uid) and r.status not in ('completed','rejected','expired','cancelled')) then
 raise exception 'Finish outstanding orders, returns and payment obligations before requesting deletion'; end if;
 update public.profiles set suspended_at=coalesce(suspended_at,now()),suspended_reason='Account deletion requested' where id=uid;
 update public.listings set status='paused' where seller_id=uid and status='active';
 insert into public.remediation_jobs(kind,dedup_key,payload) values('delete_account','delete:'||uid,jsonb_build_object('user_id',uid)) on conflict(dedup_key) do nothing;
 select id into job from public.remediation_jobs where dedup_key='delete:'||uid;
 return job;
end $$;
revoke all on function public.request_account_deletion() from public,anon;
grant execute on function public.request_account_deletion() to authenticated;

create or replace function public.block_deleted_account_writes() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if auth.uid() is not null and exists(select 1 from public.remediation_jobs where dedup_key='delete:'||auth.uid()) then
 raise exception 'Account deletion is pending' using errcode='42501'; end if;
 return null;
end $$;
-- Statement guards also cover direct REST with an unexpired access token.
do $$ declare t record; begin
 for t in select tablename from pg_tables where schemaname='public' and tablename not in ('remediation_jobs','worker_runs','admin_audit_log') loop
  execute format('create trigger deletion_write_guard before insert or update or delete on public.%I for each statement execute function public.block_deleted_account_writes()',t.tablename);
 end loop;
end $$;
revoke all on function public.block_deleted_account_writes() from public,anon,authenticated;

create or replace function public.invoke_remediation_worker(p_family text) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare base text; secret text;
begin
 if p_family not in ('search','account-deletions','media-gc','saved-searches') then raise exception 'Unknown worker family'; end if;
 select value into base from public.job_config where key='transfer_worker_url';
 select value into secret from public.job_config where key='transfer_worker_secret';
 if base is null or secret is null then return; end if;
 if base !~ '/api/jobs/transfers$' then raise exception 'Invalid transfer worker URL'; end if;
 perform net.http_post(url:=regexp_replace(base,'/transfers$','/'||p_family),headers:=jsonb_build_object('Authorization','Bearer '||secret,'Content-Type','application/json'),body:='{}'::jsonb,timeout_milliseconds:=60000);
end $$;
revoke all on function public.invoke_remediation_worker(text) from public,anon,authenticated;
grant execute on function public.invoke_remediation_worker(text) to service_role;
select cron.schedule('drvn-search-worker','*/2 * * * *',$job$select public.invoke_remediation_worker('search');$job$);
select cron.schedule('drvn-deletion-worker','*/5 * * * *',$job$select public.invoke_remediation_worker('account-deletions');$job$);
select cron.schedule('drvn-media-gc','17 3 * * *',$job$select public.invoke_remediation_worker('media-gc');$job$);
select cron.schedule('drvn-saved-search-worker','*/30 * * * *',$job$select public.invoke_remediation_worker('saved-searches');$job$);
create or replace function public.worker_health_snapshot() returns jsonb
language sql security definer set search_path=public,pg_temp as $$
 select jsonb_build_object('families', (select coalesce(jsonb_agg(x),'[]') from (
 select f.family,max(r.finished_at) filter(where r.status='succeeded') last_success,
 coalesce(max(r.finished_at) filter(where r.status='succeeded')<now()-interval '30 minutes',true) stale
 from unnest(array['captures','transfers','transferReconciliation','refunds','returns','disputes','alerts','receipts']) f(family)
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

notify pgrst,'reload schema';
commit;
