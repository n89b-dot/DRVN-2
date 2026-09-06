-- Atomically materialize the shipping projection recorded by a durable cart
-- checkout attempt. The caller supplies only journal identity; destination
-- and quote choices are read from the immutable server-side attempt.
begin;

create or replace function public.freeze_cart_checkout_shipping(
  p_buyer uuid,
  p_idempotency_key text,
  p_order uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  saved public.purchase_attempts%rowtype;
  target public.orders%rowtype;
  shipping jsonb;
  quote_ids jsonb;
  frozen_quotes jsonb := '[]'::jsonb;
  item record;
  quote public.shipping_rate_quotes%rowtype;
  existing_shipment public.shipments%rowtype;
  frozen_shipment_id uuid;
  result_order jsonb;
  drvn_count int;
  quote_count int;
  existing_count int;
  already_frozen boolean;
  settled_order boolean;
begin
  if p_buyer is null or p_idempotency_key is null or p_order is null then
    raise exception 'Cart shipping freeze requires buyer, attempt, and order'
      using errcode = '22023';
  end if;

  -- Lock order is journal -> order -> quotes. Every replay uses this order.
  select * into saved
    from public.purchase_attempts
   where idempotency_key = p_idempotency_key
   for update;

  if not found or saved.buyer_id is distinct from p_buyer then
    raise exception 'Checkout attempt is unavailable to this buyer'
      using errcode = '42501';
  end if;
  if saved.checkout_context is null
     or jsonb_typeof(saved.checkout_context) <> 'object'
     or saved.checkout_context ->> 'version' is distinct from '1'
     or jsonb_typeof(saved.checkout_context -> 'shipping') <> 'object'
     or jsonb_typeof(saved.checkout_context -> 'quoteIds') <> 'object' then
    raise exception 'Checkout attempt has no valid shipping context'
      using errcode = '22023';
  end if;

  select value into result_order
    from jsonb_array_elements(coalesce(saved.result -> 'orders', '[]'::jsonb))
   where value ->> 'order_id' = p_order::text;
  if not found then
    raise exception 'Order does not belong to this checkout attempt'
      using errcode = '42501';
  end if;

  select * into target
    from public.orders
   where id = p_order
   for update;
  if not found or target.buyer_id is distinct from p_buyer then
    raise exception 'Order is unavailable to this buyer'
      using errcode = '42501';
  end if;
  settled_order := target.status in (
    'paid', 'shipped', 'delivered', 'completed', 'refunded', 'disputed', 'payment_failed'
  );
  if target.status not in ('pending', 'requires_action') and not settled_order then
    raise exception 'Order is no longer awaiting checkout'
      using errcode = '55000';
  end if;

  -- The journal result and live order must still describe the same immutable
  -- listing set. This refuses a corrupted or substituted order id before any
  -- address or quote is written.
  if exists (
    (select oi.listing_id::text from public.order_items oi where oi.order_id = p_order
     except
     select jsonb_array_elements_text(coalesce(result_order -> 'listing_ids', '[]'::jsonb)))
    union all
    (select jsonb_array_elements_text(coalesce(result_order -> 'listing_ids', '[]'::jsonb))
     except
     select oi.listing_id::text from public.order_items oi where oi.order_id = p_order)
  ) then
    raise exception 'Order items do not match the checkout journal'
      using errcode = '55000';
  end if;

  shipping := saved.checkout_context -> 'shipping';
  quote_ids := saved.checkout_context -> 'quoteIds';

  if jsonb_typeof(shipping -> 'isCollection') <> 'boolean'
     or nullif(btrim(shipping ->> 'name'), '') is null then
    raise exception 'Checkout shipping context is malformed'
      using errcode = '22023';
  end if;

  if exists (
    select 1 from jsonb_object_keys(quote_ids) key
     where not (coalesce(saved.request_fingerprint -> 'ids', '[]'::jsonb) ? key)
  ) then
    raise exception 'Checkout contains a quote outside its durable basket'
      using errcode = '42501';
  end if;
  select count(*) into quote_count
    from jsonb_object_keys(quote_ids) key
   where exists (
     select 1 from public.order_items oi
      where oi.order_id = p_order and oi.listing_id::text = key
   );
  select count(*) into drvn_count
    from public.order_items oi
   where oi.order_id = p_order
     and oi.commercial_snapshot -> 'commercial' ->> 'shipping_mode' = 'drvn_shipping';

  if (shipping ->> 'isCollection')::boolean then
    if quote_count <> 0 then
      raise exception 'Collection checkout cannot contain shipping quotes'
        using errcode = '22023';
    end if;
    if exists (
      select 1 from public.order_items oi
       where oi.order_id = p_order
         and coalesce(
           (oi.commercial_snapshot -> 'commercial' ->> 'allows_collection')::boolean,
           false
         ) = false
    ) then
      raise exception 'Collection was not offered by every order item'
        using errcode = '42501';
    end if;
    if target.shipping_cents <> 0
       or exists (select 1 from public.order_items oi where oi.order_id=p_order and oi.shipping_cents<>0) then
      raise exception 'Collection checkout retained a shipping charge'
        using errcode = '55000';
    end if;
  else
    if quote_count <> drvn_count then
      raise exception 'Checkout quote set does not match its DRVN Shipping items'
        using errcode = '22023';
    end if;
    if exists (
      select 1 from public.order_items oi
       where oi.order_id = p_order
         and quote_ids ? oi.listing_id::text
         and oi.commercial_snapshot -> 'commercial' ->> 'shipping_mode' <> 'drvn_shipping'
    ) then
      raise exception 'Checkout contains a quote for a non-DRVN order item'
        using errcode = '42501';
    end if;
  end if;

  -- A previous exact application is safe; any different address is evidence
  -- of state substitution and must never be overwritten during recovery.
  already_frozen := target.ship_name is not null;
  if already_frozen and (
    target.ship_name is distinct from shipping ->> 'name'
    or target.ship_line1 is distinct from coalesce(shipping ->> 'line1', '')
    or target.ship_line2 is distinct from nullif(shipping ->> 'line2', '')
    or target.ship_city is distinct from coalesce(shipping ->> 'city', '')
    or target.ship_postcode is distinct from coalesce(shipping ->> 'postcode', '')
    or target.ship_country is distinct from coalesce(shipping ->> 'country', '')
    or target.ship_state is distinct from nullif(shipping ->> 'state', '')
    or target.ship_phone is distinct from nullif(shipping ->> 'phone', '')
    or target.is_collection is distinct from (shipping ->> 'isCollection')::boolean
  ) then
    raise exception 'Order shipping destination differs from the checkout journal'
      using errcode = '42501';
  end if;

  for item in
    select oi.id, oi.listing_id, oi.shipping_cents
      from public.order_items oi
     where oi.order_id = p_order
       and oi.commercial_snapshot -> 'commercial' ->> 'shipping_mode' = 'drvn_shipping'
     order by oi.listing_id
  loop
    if nullif(quote_ids ->> item.listing_id::text, '') is null then
      raise exception 'DRVN Shipping item is missing its quoted rate'
        using errcode = '22023';
    end if;

    select * into quote
      from public.shipping_rate_quotes q
     where q.id = (quote_ids ->> item.listing_id::text)::uuid
     for update;

    if not found
       or quote.listing_id is distinct from item.listing_id
       or quote.buyer_id is distinct from p_buyer
       or quote.destination_hash is distinct from saved.checkout_context ->> 'destinationHash'
       or quote.consumed_order_id is not null and quote.consumed_order_id is distinct from p_order
       or quote.expires_at <= saved.created_at and quote.consumed_order_id is distinct from p_order
       or quote.amount_cents is distinct from item.shipping_cents
       or quote.amount_cents is distinct from
          (saved.request_fingerprint -> 'shipping' ->> item.listing_id::text)::int
       or quote.currency is distinct from target.currency then
      raise exception 'Quoted rate does not match the durable checkout'
        using errcode = '42501';
    end if;

    frozen_quotes := frozen_quotes || jsonb_build_array(jsonb_build_object(
      'listing_id', item.listing_id,
      'provider', quote.provider,
      'provider_shipment_id', quote.provider_shipment_id,
      'rate_ref', quote.rate_ref,
      'carrier', quote.carrier,
      'service', quote.service,
      'service_label', quote.service_label,
      'amount_cents', quote.amount_cents,
      'currency', quote.currency,
      'est_delivery_days', quote.est_delivery_days,
      'parcel', quote.parcel,
      'quoted_at', quote.created_at
    ));

  end loop;

  if target.shipping_quote is not null and target.shipping_quote is distinct from frozen_quotes then
    raise exception 'Frozen shipping service differs from the checkout journal'
      using errcode = '42501';
  end if;

  if settled_order then
    -- A partially settled multi-seller checkout re-enters this boundary for
    -- every order. Settled projections are immutable here: accept only the
    -- exact, already-complete freeze so the remaining pending order can heal.
    if not already_frozen
       or (drvn_count > 0 and target.shipping_quote is distinct from frozen_quotes)
       or (drvn_count = 0 and target.shipping_quote is not null) then
      raise exception 'Settled order has no exact frozen shipping projection'
        using errcode = '55000';
    end if;
  else
    update public.orders
       set ship_name = shipping ->> 'name',
           ship_line1 = coalesce(shipping ->> 'line1', ''),
           ship_line2 = nullif(shipping ->> 'line2', ''),
           ship_city = coalesce(shipping ->> 'city', ''),
           ship_postcode = coalesce(shipping ->> 'postcode', ''),
           ship_country = coalesce(shipping ->> 'country', ''),
           ship_state = nullif(shipping ->> 'state', ''),
           ship_phone = nullif(shipping ->> 'phone', ''),
           is_collection = (shipping ->> 'isCollection')::boolean,
           shipping_quote = case when drvn_count = 0 then null else frozen_quotes end
     where id = p_order;
  end if;

  -- The order projection is now written inside this transaction. Any failure
  -- while materializing a shipment or item link rolls it back with the quote
  -- consumption, so the payment boundary never observes a partial freeze.
  for item in
    select oi.id, oi.listing_id, oi.shipping_cents
      from public.order_items oi
     where oi.order_id = p_order
       and oi.commercial_snapshot -> 'commercial' ->> 'shipping_mode' = 'drvn_shipping'
     order by oi.listing_id
  loop
    select * into quote
      from public.shipping_rate_quotes q
     where q.id = (quote_ids ->> item.listing_id::text)::uuid;

    select count(*) into existing_count
      from public.shipments s
     where s.order_id = p_order
       and s.direction = 'outbound'
       and s.provider = quote.provider
       and s.provider_shipment_id = quote.provider_shipment_id;
    if existing_count > 1 then
      raise exception 'Checkout has duplicate provider shipments'
        using errcode = '55000';
    end if;

    select * into existing_shipment
      from public.shipments s
     where s.order_id = p_order
       and s.direction = 'outbound'
       and s.provider = quote.provider
       and s.provider_shipment_id = quote.provider_shipment_id
     limit 1;

    if found then
      if existing_shipment.fulfillment_type <> 'drvn_shipping'
         or existing_shipment.return_id is not null
         or existing_shipment.carrier is distinct from quote.carrier
         or existing_shipment.service is distinct from quote.service
         or existing_shipment.quoted_cents is distinct from quote.amount_cents
         or exists (
           select 1 from public.shipment_items si
            where si.shipment_id = existing_shipment.id
              and si.order_item_id <> item.id
         ) then
        raise exception 'Existing shipment differs from the checkout quote'
          using errcode = '42501';
      end if;
      frozen_shipment_id := existing_shipment.id;
    elsif settled_order then
      raise exception 'Settled order is missing its frozen shipment'
        using errcode = '55000';
    else
      insert into public.shipments (
        order_id, direction, provider, provider_shipment_id,
        fulfillment_type, carrier, service, status, quoted_cents
      ) values (
        p_order, 'outbound', quote.provider, quote.provider_shipment_id,
        'drvn_shipping', quote.carrier, quote.service, 'pending', quote.amount_cents
      ) returning id into frozen_shipment_id;
    end if;

    if settled_order then
      if quote.consumed_order_id is distinct from p_order
         or not exists (
           select 1 from public.shipment_items si
            where si.shipment_id = frozen_shipment_id
              and si.order_item_id = item.id
         ) then
        raise exception 'Settled order has an incomplete shipping projection'
          using errcode = '55000';
      end if;
    else
      insert into public.shipment_items (shipment_id, order_item_id)
      values (frozen_shipment_id, item.id)
      on conflict on constraint shipment_items_pkey do nothing;

      update public.shipping_rate_quotes
         set consumed_order_id = p_order
       where id = quote.id
         and (consumed_order_id is null or consumed_order_id = p_order);
      if not found then
        raise exception 'Quoted rate was consumed by another order'
          using errcode = '42501';
      end if;
    end if;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'replayed', already_frozen,
    'shipmentCount', drvn_count
  );
end;
$$;

revoke all on function public.freeze_cart_checkout_shipping(uuid,text,uuid)
  from public, anon, authenticated;
grant execute on function public.freeze_cart_checkout_shipping(uuid,text,uuid)
  to service_role;

commit;
