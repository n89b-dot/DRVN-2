-- 20261004130000 — every charge is one Stripe can make; a refused one frees
-- the part; one currency.
--
-- 1. Charge bounds. Stripe refuses a USD charge under $0.50 or over
--    $999,999.99. Nothing stopped a $0 listing, a 30¢ offer or a basket summing
--    past the maximum from being reserved, and when the PaymentIntent create
--    then failed the orders stayed pending: expiry won't release an order
--    whose payment request was persisted (the outcome is "unresolved"), so
--    the part was stuck until someone freed it by hand. Now:
--      - purchase_begin refuses a basket whose total is out of bounds, before
--        anything is reserved (the raise rolls the claim back);
--      - offer_accept_begin refuses an accepted price + shipping out of
--        bounds, before reserving;
--      - a listing can't be published, or have its live price changed, to a
--        price outside the bounds. Drafts may hold any price — that's where a
--        price gets worked out — and rows already live are left alone until
--        someone edits their price, so a legacy $0 part can still be paused,
--        released from a reservation or removed.
--    All three raise SQLSTATE 22003 (numeric_value_out_of_range) so the app
--    can say what's wrong instead of "something failed".
--
-- 2. A provider refusal is proof no charge exists. When Stripe rejects the
--    create request itself (a 400 validation error), no PaymentIntent was
--    made. record_payment_request_rejection marks the persisted request as
--    rejected and, in the same transaction, fails its pending orders and puts
--    their parts back on sale. It refuses if any reference has ever been
--    recorded for the request or its orders — a possible PaymentIntent is
--    never released here. prepare_payment_request reports the mark so a retry
--    never calls Stripe again for the same orders, finish_reservation_expiry
--    treats a rejected request as "no provider creation", and the unmapped
--    request reconciler skips it.
--
-- 3. One currency. listings.currency had only a default, and the owner can
--    update their row, so a seller could set a currency the app always shows
--    as dollars while checkout charged it as the order's currency. listings
--    and orders now only hold 'USD'. The constraints are added NOT VALID and
--    validated when every existing row already complies; if one doesn't, the
--    migration says so and the constraint still governs every new write.
--
-- Idempotent: create or replace, if-not-exists, drop-then-add.

begin;

-- ---------------------------------------------------------------------------
-- 1. Charge bounds
-- ---------------------------------------------------------------------------

-- The one definition of "a charge Stripe will make", in cents.
create or replace function public.charge_cents_in_bounds(p_cents bigint)
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  select p_cents between 50 and 99999999;
$$;

-- Listing prices: only publishing, or changing a live price, is checked.
create or replace function public.guard_listing_price_bounds()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.status not in ('active', 'paused') or public.charge_cents_in_bounds(new.price_cents) then
    return new;
  end if;
  if tg_op = 'INSERT'
     or new.price_cents is distinct from old.price_cents
     or old.status = 'draft'
     or (new.status = 'active' and old.status not in ('active', 'reserved')) then
    raise exception 'A listed part needs a price between $0.50 and $999,999.99'
      using errcode = '22003';
  end if;
  return new;
end;
$$;

drop trigger if exists listings_price_bounds on public.listings;
create trigger listings_price_bounds
  before insert or update of price_cents, status on public.listings
  for each row execute function public.guard_listing_price_bounds();

-- purchase_begin: unchanged from 20260905235729 except the basket bound,
-- checked after the claim (the claim decides what's in the basket) and before
-- any order is written. The raise rolls the claim back with everything else.
create or replace function public.purchase_begin(
  p_buyer_id uuid,
  p_listing_ids uuid[],
  p_idempotency_key text default null,
  p_reservation_window interval default interval '15 minutes',
  p_shipping_overrides jsonb default null,
  p_checkout_request_key text default null,
  p_checkout_context jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_previous jsonb;
  v_owner uuid;
  v_bound_owner uuid;
  v_bound_idempotency_key text;
  v_bound_context jsonb;
  v_fingerprint jsonb;
  v_orders jsonb := '[]'::jsonb;
  v_skipped jsonb := '[]'::jsonb;
  v_group record;
  v_order_id uuid;
  v_fee int;
  v_requested uuid[];
  v_claimed uuid[];
  v_basket_total bigint;
begin
  if p_checkout_request_key is not null and (
    p_idempotency_key is null
    or p_checkout_context is null
    or jsonb_typeof(p_checkout_context) <> 'object'
  ) then
    raise exception 'Checkout request binding requires an idempotency key and context' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_buyer_id::text, 0));
  if exists(select 1 from public.profiles where id=p_buyer_id and suspended_at is not null) then raise exception 'Account unavailable'; end if;
  if p_checkout_request_key is not null then
    perform pg_advisory_xact_lock(hashtextextended(p_checkout_request_key, 2));
    select buyer_id, idempotency_key, checkout_context
      into v_bound_owner, v_bound_idempotency_key, v_bound_context
    from public.purchase_attempts
    where checkout_request_key = p_checkout_request_key;
    if found and (
      v_bound_owner is distinct from p_buyer_id
      or v_bound_idempotency_key is distinct from p_idempotency_key
      or v_bound_context is distinct from p_checkout_context
    ) then
      raise exception 'Checkout request is already bound to a different purchase' using errcode='42501';
    end if;
  end if;
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
    greatest(
      coalesce((p_shipping_overrides ->> c.id::text)::int, c.shipping_cents),
      0
    ) as shipping_cents
  from claimed c;

  select coalesce(array_agg(id), array[]::uuid[]) into v_claimed from _claimed;

  -- One payment covers the whole basket, so the bound is on the basket. Summed
  -- as bigint: a basket of large prices must be refused, not overflow below.
  select coalesce(sum(price_cents::bigint + shipping_cents::bigint), 0)
    into v_basket_total from _claimed;
  if cardinality(v_claimed) > 0 and not public.charge_cents_in_bounds(v_basket_total) then
    raise exception 'A checkout total must be between $0.50 and $999,999.99'
      using errcode = '22003';
  end if;

  select coalesce(
    jsonb_agg(jsonb_build_object('listing_id', missing.id, 'reason', 'unavailable')),
    '[]'::jsonb
  )
  into v_skipped
  from (select unnest(v_requested) as id except select unnest(v_claimed)) as missing;

  for v_group in
    select
      c.seller_id,
      c.currency,
      sum(c.price_cents)::int as subtotal,
      sum(c.shipping_cents)::int as shipping
    from _claimed c
    group by c.seller_id, c.currency
  loop
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
    insert into public.purchase_attempts (
      idempotency_key, buyer_id, result, request_fingerprint,
      checkout_request_key, checkout_context
    )
    values (
      p_idempotency_key, p_buyer_id, v_previous, v_fingerprint,
      p_checkout_request_key, p_checkout_context
    )
    on conflict (idempotency_key) do nothing;
  end if;

  return v_previous;
end;
$$;

revoke all on function public.purchase_begin(uuid, uuid[], text, interval, jsonb, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.purchase_begin(uuid, uuid[], text, interval, jsonb, text, jsonb)
  to service_role;

-- offer_accept_begin: unchanged from 0050 except the bound, checked before the
-- listing is reserved. Shipping is read first so the check sees what the
-- order would charge.
create or replace function public.offer_accept_begin(
  p_offer_id uuid,
  p_seller_id uuid,
  p_reservation_window interval default interval '24 hours'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_offer record;
  v_listing record;
  v_price int;
  v_fee int;
  v_order_id uuid;
  v_shipping int;
begin
  select o.id, o.listing_id, o.buyer_id, o.amount_cents, o.counter_amount_cents,
         o.status, o.expires_at
  into v_offer
  from public.offers o
  where o.id = p_offer_id
  for update;

  if not found or v_offer.status not in ('open', 'countered') then
    return null;
  end if;

  if v_offer.expires_at is not null and v_offer.expires_at < now() then
    update public.offers
    set status = 'expired', responded_at = now()
    where id = p_offer_id;
    return null;
  end if;

  v_price := coalesce(v_offer.counter_amount_cents, v_offer.amount_cents);

  select l.shipping_cents into v_shipping
  from public.listings l
  where l.id = v_offer.listing_id and l.seller_id = p_seller_id and l.status = 'active';
  if found and not public.charge_cents_in_bounds(v_price::bigint + v_shipping::bigint) then
    raise exception 'An accepted offer must come to between $0.50 and $999,999.99 with shipping'
      using errcode = '22003';
  end if;

  update public.listings l
  set status = 'reserved', reserved_until = now() + p_reservation_window
  where l.id = v_offer.listing_id
    and l.seller_id = p_seller_id
    and l.status = 'active'
  returning l.id, l.title, l.shipping_cents, l.currency
  into v_listing;

  if not found then
    return null;
  end if;

  -- Fee basis is everything the buyer pays before tax: goods + shipping
  -- (0050). An accepted offer cannot dodge the fee through shipping either.
  v_fee := round((v_price + v_listing.shipping_cents) * 1000.0 / 10000.0);

  insert into public.orders (
    buyer_id, seller_id, status,
    subtotal_cents, shipping_cents, platform_fee_cents, total_cents, currency,
    origin_offer_id
  )
  values (
    v_offer.buyer_id, p_seller_id, 'pending',
    v_price, v_listing.shipping_cents, v_fee,
    v_price + v_listing.shipping_cents, v_listing.currency,
    p_offer_id
  )
  returning id into v_order_id;

  insert into public.order_items (order_id, listing_id, title, price_cents, shipping_cents)
  values (v_order_id, v_listing.id, v_listing.title, v_price, v_listing.shipping_cents);

  insert into public.payments (order_id, amount_cents, currency, status, idempotency_key)
  values (
    v_order_id,
    v_price + v_listing.shipping_cents,
    v_listing.currency,
    'pending',
    'offer:' || p_offer_id::text || ':' || v_order_id::text
  );

  update public.offers
  set status = 'accepted', responded_at = now()
  where id = p_offer_id;

  return v_order_id;
end;
$$;

revoke all on function public.offer_accept_begin(uuid, uuid, interval)
  from public, anon, authenticated;
grant execute on function public.offer_accept_begin(uuid, uuid, interval)
  to service_role;

-- ---------------------------------------------------------------------------
-- 2. Provider-rejected payment requests
-- ---------------------------------------------------------------------------

alter table public.payment_requests
  add column if not exists provider_rejected_at timestamptz,
  add column if not exists provider_rejection text;

-- A rejected request has no reference by construction; keep it that way.
alter table public.payment_requests
  drop constraint if exists payment_requests_rejected_has_no_reference;
alter table public.payment_requests
  add constraint payment_requests_rejected_has_no_reference
  check (provider_rejected_at is null or provider_reference is null);

create or replace function public.record_payment_request_rejection(p_key text, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r public.payment_requests;
  v_order uuid;
  v_result jsonb;
  v_released int := 0;
  v_reason text := left(coalesce(nullif(trim(p_reason), ''), 'Payment provider refused the request'), 500);
begin
  -- Same lock order as prepare_payment_request: orders, then the request.
  perform 1 from public.orders
  where id::text in (
    select jsonb_array_elements_text(request->'orderIds')
    from public.payment_requests where operation_key = p_key
  )
  order by id for update;
  select * into r from public.payment_requests where operation_key = p_key for update;
  if not found then
    raise exception 'Payment request not found' using errcode = 'P0002';
  end if;
  -- Any recorded reference means a PaymentIntent may exist. Never release.
  if r.provider_reference is not null or exists(
    select 1 from public.payments
    where order_id::text in (select jsonb_array_elements_text(r.request->'orderIds'))
      and provider_reference is not null
  ) then
    raise exception 'Payment request has a provider reference; reconcile it instead'
      using errcode = '55000';
  end if;

  update public.payment_requests
  set provider_rejected_at = coalesce(provider_rejected_at, now()),
      provider_rejection = coalesce(provider_rejection, v_reason)
  where operation_key = p_key;

  for v_order in
    select o.id from public.orders o
    where o.id::text in (select jsonb_array_elements_text(r.request->'orderIds'))
      and o.status in ('pending', 'requires_action')
    order by o.id
  loop
    v_result := public.purchase_finalize(v_order, false, 'stripe', null, v_reason);
    if coalesce((v_result->>'applied')::boolean, false) then
      v_released := v_released + 1;
    end if;
  end loop;

  return jsonb_build_object('rejected', true, 'released', v_released);
end;
$$;

revoke all on function public.record_payment_request_rejection(text, text) from public, anon, authenticated;
grant execute on function public.record_payment_request_rejection(text, text) to service_role;

-- prepare_payment_request: unchanged from 20260905101425, plus `rejected` in
-- the answer so the caller never sends a refused request to Stripe again.
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
 return jsonb_build_object('request',r.request,'correlation_id',r.correlation_id,'reference',r.provider_reference,'created_at',r.created_at,'rejected',r.provider_rejected_at is not null);
end $$;

-- finish_reservation_expiry: unchanged from 20260905101425 except that a
-- request the provider rejected counts as no provider creation.
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
   if ref is not null or exists(
     select 1 from public.payment_requests
     where (request->'orderIds') ? o.id::text
       and (provider_reference is not null or provider_rejected_at is null)
   ) then
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

-- claim_unmapped_payment_requests: unchanged from 20260905123537 except that
-- a rejected request is settled — there is nothing at Stripe to look for.
create or replace function public.claim_unmapped_payment_requests() returns jsonb
language sql security definer set search_path=public,pg_temp as $$
 with due as (select operation_key from public.payment_requests where provider_reference is null and provider_rejected_at is null and created_at<now()-interval '2 minutes' and next_reconcile_at<=now() order by next_reconcile_at,operation_key for update skip locked limit 10),
 claimed as(update public.payment_requests p set next_reconcile_at=now()+interval '15 minutes' from due where p.operation_key=due.operation_key returning p.*)
 select coalesce(jsonb_agg(claimed),'[]') from claimed;
$$;
revoke all on function public.claim_unmapped_payment_requests() from public,anon,authenticated;
grant execute on function public.claim_unmapped_payment_requests() to service_role;

-- ---------------------------------------------------------------------------
-- 3. One currency
-- ---------------------------------------------------------------------------

-- Rows written as lowercase 'usd' (the dev seed scripts did) are the same
-- currency; normalise them first so the constraint can validate and a later
-- edit to one of them isn't refused. A currency-only update passes every
-- listing and order trigger, sold and refunded rows included.
update public.listings set currency = 'USD' where currency <> 'USD' and upper(currency) = 'USD';
update public.orders set currency = 'USD' where currency <> 'USD' and upper(currency) = 'USD';

alter table public.listings drop constraint if exists listings_currency_usd;
alter table public.listings add constraint listings_currency_usd check (currency = 'USD') not valid;
alter table public.orders drop constraint if exists orders_currency_usd;
alter table public.orders add constraint orders_currency_usd check (currency = 'USD') not valid;

do $$
begin
  if not exists (select 1 from public.listings where currency is distinct from 'USD') then
    alter table public.listings validate constraint listings_currency_usd;
  else
    raise notice 'listings_currency_usd left NOT VALID: % existing listings are not USD',
      (select count(*) from public.listings where currency is distinct from 'USD');
  end if;
  if not exists (select 1 from public.orders where currency is distinct from 'USD') then
    alter table public.orders validate constraint orders_currency_usd;
  else
    raise notice 'orders_currency_usd left NOT VALID: % existing orders are not USD',
      (select count(*) from public.orders where currency is distinct from 'USD');
  end if;
end $$;

notify pgrst, 'reload schema';

commit;
