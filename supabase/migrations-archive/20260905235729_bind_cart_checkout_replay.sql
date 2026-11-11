-- Bind the browser checkout request UUID to the durable purchase attempt.
-- The binding is server-only and buyer-scoped; it lets an authenticated retry
-- recover the exact basket after a committed checkout removed the cart cookie.
begin;

alter table public.purchase_attempts
  add column if not exists checkout_request_key text,
  add column if not exists checkout_context jsonb;

create unique index if not exists purchase_attempts_checkout_request_key_idx
  on public.purchase_attempts (checkout_request_key)
  where checkout_request_key is not null;

revoke all on public.purchase_attempts from public, anon, authenticated;
grant all on public.purchase_attempts to service_role;

drop function if exists public.purchase_begin(uuid, uuid[], text, interval, jsonb);
drop function if exists public.purchase_begin(uuid, uuid[], text, interval, jsonb, text);

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

-- Publish an async provider reference to every payment in the basket as one
-- fenced transaction. A conflicting non-null reference is never overwritten.
drop function if exists public.bind_cart_checkout_payment(uuid, uuid[], text, text);
create or replace function public.bind_cart_checkout_payment(
  p_buyer uuid,
  p_idempotency_key text,
  p_orders uuid[],
  p_provider text,
  p_reference text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  requested uuid[];
  saved public.purchase_attempts%rowtype;
  payment_count integer;
begin
  requested := array(select distinct unnest(coalesce(p_orders, array[]::uuid[])) order by 1);
  if p_buyer is null or p_idempotency_key is null or cardinality(requested) = 0
     or nullif(trim(coalesce(p_provider, '')), '') is null
     or nullif(trim(coalesce(p_reference, '')), '') is null then
    raise exception 'Invalid checkout payment binding' using errcode='22023';
  end if;

  select * into saved from public.purchase_attempts
   where idempotency_key = p_idempotency_key
   for update;
  if not found or saved.buyer_id is distinct from p_buyer then
    raise exception 'Checkout payment attempt is unavailable to this buyer' using errcode='42501';
  end if;
  if exists (
    (select unnest(requested)::text
     except
     select value ->> 'order_id' from jsonb_array_elements(coalesce(saved.result -> 'orders', '[]'::jsonb)))
    union all
    (select value ->> 'order_id' from jsonb_array_elements(coalesce(saved.result -> 'orders', '[]'::jsonb))
     except
     select unnest(requested)::text)
  ) then
    raise exception 'Checkout payment orders do not match the durable attempt' using errcode='42501';
  end if;

  perform 1 from public.orders where id = any(requested) order by id for update;
  if (select count(*) from public.orders where id = any(requested) and buyer_id = p_buyer)
     <> cardinality(requested) then
    raise exception 'Checkout payment buyer mismatch' using errcode='42501';
  end if;

  perform 1 from public.payments where order_id = any(requested) order by order_id for update;
  select count(*) into payment_count from public.payments where order_id = any(requested);
  if payment_count <> cardinality(requested) then
    raise exception 'Checkout payment rows are incomplete';
  end if;
  if exists (
    select 1 from public.payments
    where order_id = any(requested)
      and provider_reference is not null
      and (
        provider_reference <> p_reference
        or provider is not null and provider <> p_provider
      )
  ) then
    raise exception 'Checkout payment reference conflict' using errcode='23505';
  end if;

  update public.payments
  set provider = p_provider,
      provider_reference = p_reference
  where order_id = any(requested)
    and (provider_reference is null or provider_reference = p_reference);

  return jsonb_build_object('ok', true, 'mapped', payment_count);
end;
$$;

revoke all on function public.bind_cart_checkout_payment(uuid, text, uuid[], text, text)
  from public, anon, authenticated;
grant execute on function public.bind_cart_checkout_payment(uuid, text, uuid[], text, text)
  to service_role;

commit;
