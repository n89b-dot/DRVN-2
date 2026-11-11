-- 20261108130000 — N89 / OS-W17 follow-up: guest hold admissions belong to
-- one checkout request and bind atomically with its reservation.
--
-- Codex review of 20261107220800 (#126):
--   P1  Two tabs with different request keys reused the same device/listing
--       admission. Tab A reserved the part and waited on payment; tab B
--       reserved nothing and released their shared, still-unbound row; A's
--       later guest_hold_bind skipped the released row, so the device could
--       take two more holds despite A's pending order.
--   P2  The app bound admissions only after delivery and payment work, and a
--       failure in between could release admissions whose orders were
--       already pending.
--
-- Now:
--   * guest_holds.request_key names the checkout request (the guest
--     checkout's idempotency key) that took the admission. guest_hold_admit
--     takes it, and reuses only that request's own live admissions; another
--     request from the same device gets its own rows (counted against the
--     same device and network caps; another device's live hold on a part
--     still refuses it).
--   * purchase_begin binds this request's admissions to the orders it
--     reserved, and releases the ones for parts it didn't, in its own
--     transaction (private.guest_holds_settle). guest_hold_bind is dropped.
--   * guest_hold_release(p_request) gives back only that request's unbound
--     admissions, for a checkout whose purchase_begin never committed. The
--     id-based release, which could reach another request's row, is dropped.
--
-- Latest definitions replaced: purchase_begin (20261107210000; unchanged
-- except the two guest_holds_settle calls), guest_hold_admit,
-- guest_hold_bind, guest_hold_release (20261107220800). Caps unchanged:
-- 2 live per device and per network, 1 per listing across devices. No money
-- rule changes: nothing here touches payment, refunds, fees or payouts.
--
-- Lock order: guest_hold_admit takes the device, network and listing
-- advisory locks as before. purchase_begin keeps buyer advisory lock →
-- attempt → listings → orders, then updates only this request's
-- guest_holds rows last.

begin;

alter table public.guest_holds
  add column if not exists request_key text
    check (request_key is null or char_length(request_key) between 16 and 200);
create index if not exists guest_holds_request_idx
  on public.guest_holds (request_key) where released_at is null;
comment on column public.guest_holds.request_key is
  'The checkout request (guest idempotency key) that took this admission. Only that request reuses, binds or releases it (20261108130000).';

drop function if exists public.guest_hold_admit(text, text, uuid[], uuid);
drop function if exists public.guest_hold_bind(uuid[], uuid);
drop function if exists public.guest_hold_release(uuid[]);

create or replace function public.guest_hold_admit(
  p_device text,
  p_network text,
  p_listing_ids uuid[],
  p_buyer uuid,
  p_request text
)
returns uuid[]
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ids uuid[] := '{}';
  v_listing uuid;
  v_existing uuid;
  v_new integer;
  v_device integer;
  v_network integer;
begin
  if p_device is null or p_network is null or p_listing_ids is null or cardinality(p_listing_ids) = 0 then
    raise exception 'A guest hold needs a device, a network and listings' using errcode = '22023';
  end if;
  if p_request is null or char_length(p_request) not between 16 and 200 then
    raise exception 'A guest hold needs its checkout request' using errcode = '22023';
  end if;
  -- One order of locks for everyone: device, network, then listings sorted.
  perform pg_advisory_xact_lock(hashtextextended('guest-device:' || p_device, 0));
  perform pg_advisory_xact_lock(hashtextextended('guest-network:' || p_network, 0));
  for v_listing in select distinct x from unnest(p_listing_ids) x order by x loop
    perform pg_advisory_xact_lock(hashtextextended('guest-listing:' || v_listing::text, 0));
  end loop;

  -- A replay of the same request reuses its own admissions, and only those.
  select count(*) into v_new
    from (select distinct x from unnest(p_listing_ids) x) l
   where not exists (
     select 1 from public.guest_holds h
      where h.listing_id = l.x and h.request_key = p_request and private.guest_hold_live(h)
   );

  -- 1 live guest hold per listing: another guest's live hold refuses it.
  if exists (
    select 1 from public.guest_holds h
     where h.listing_id = any (p_listing_ids) and h.device_key <> p_device and private.guest_hold_live(h)
  ) then
    raise exception 'Another guest is checking out this part right now.' using errcode = 'GH409';
  end if;

  select count(*) into v_device from public.guest_holds h where h.device_key = p_device and private.guest_hold_live(h);
  select count(*) into v_network from public.guest_holds h where h.network_key = p_network and private.guest_hold_live(h);
  if v_device + v_new > 2 or v_network + v_new > 2 then
    raise exception 'Guest checkout holds up to 2 parts at a time. Sign in to buy more, or finish paying first.'
      using errcode = 'GH429';
  end if;

  for v_listing in select distinct x from unnest(p_listing_ids) x order by x loop
    select h.id into v_existing from public.guest_holds h
     where h.listing_id = v_listing and h.request_key = p_request and private.guest_hold_live(h)
     limit 1;
    if v_existing is null then
      insert into public.guest_holds (device_key, network_key, listing_id, buyer_id, request_key)
      values (p_device, p_network, v_listing, p_buyer, p_request)
      returning id into v_existing;
    end if;
    v_ids := v_ids || v_existing;
    v_existing := null;
  end loop;
  return v_ids;
end;
$$;

-- Called by purchase_begin only, inside its transaction: bind this
-- request's open admissions to the orders that reserved their parts, then
-- give back the ones whose part wasn't reserved.
create or replace function private.guest_holds_settle(p_request text, p_result jsonb)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_request is null then
    return;
  end if;
  update public.guest_holds h
     set order_id = (
       select (o ->> 'order_id')::uuid
         from jsonb_array_elements(coalesce(p_result -> 'orders', '[]'::jsonb)) o
        where coalesce(o -> 'listing_ids', '[]'::jsonb) ? h.listing_id::text
        limit 1)
   where h.request_key = p_request
     and h.released_at is null
     and h.order_id is null;
  update public.guest_holds h
     set released_at = now()
   where h.request_key = p_request
     and h.released_at is null
     and h.order_id is null;
end;
$$;

-- A checkout whose purchase_begin never committed gives back its own
-- admissions. Bound ones (their order exists) are never released here.
create or replace function public.guest_hold_release(p_request text)
returns integer
language sql
security definer
set search_path = public, pg_temp
as $$
  with released as (
    update public.guest_holds set released_at = now()
     where request_key = p_request and order_id is null and released_at is null
    returning 1
  )
  select count(*)::integer from released;
$$;

revoke all on function public.guest_hold_admit(text, text, uuid[], uuid, text) from public, anon, authenticated;
revoke all on function private.guest_holds_settle(text, jsonb) from public, anon, authenticated;
revoke all on function public.guest_hold_release(text) from public, anon, authenticated;
grant execute on function public.guest_hold_admit(text, text, uuid[], uuid, text) to service_role;
grant execute on function public.guest_hold_release(text) to service_role;

-- purchase_begin (20261107210000): unchanged except the two
-- guest_holds_settle calls (the replay return and the end).
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
      -- 20261108130000: a replay settles this request's own admissions too.
      perform private.guest_holds_settle(p_idempotency_key, v_previous);
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
      and private.seller_can_take_payment(l.seller_id)
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

  -- 20261108130000 (N89): a guest's hold admissions are bound to the orders
  -- that hold their parts in this same transaction, before any delivery or
  -- payment work, and the admissions for parts not reserved are given back.
  -- Only this request's admissions: another checkout's are never touched.
  perform private.guest_holds_settle(p_idempotency_key, v_previous);

  return v_previous;
end;
$$;

revoke all on function public.purchase_begin(uuid, uuid[], text, interval, jsonb, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.purchase_begin(uuid, uuid[], text, interval, jsonb, text, jsonb)
  to service_role;

notify pgrst, 'reload schema';
commit;
