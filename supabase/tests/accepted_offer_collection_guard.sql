-- An accepted offer the buyer collects charges no shipping, is priced as a
-- collected cart line, and pickup is only taken where it's offered
-- (20261005110000).
begin;
do $$
declare
  buyer uuid := gen_random_uuid();
  seller uuid := gen_random_uuid();
  collectable uuid; ship_only uuid; pickup_only uuid; tiny uuid; started uuid; delivered uuid;
  offer_id uuid; oid uuid; r jsonb; rejected boolean;
  collect_snapshot jsonb := jsonb_build_object(
    'name','Buyer One','line1','','line2',null,'city','','postcode','','country','',
    'state',null,'phone',null,'isCollection',true
  );
  deliver_snapshot jsonb := jsonb_build_object(
    'name','Buyer One','line1','10 Main Street','line2',null,'city','Detroit',
    'postcode','48201','country','US','state','MI','phone',null,'isCollection',false
  );
begin
  insert into auth.users(id, email) values
    (buyer, 'collect-buyer@example.test'), (seller, 'collect-seller@example.test');

  -- 1. Collecting takes the delivery charge off the order, its line, the
  --    line's snapshot and the pending payment; the fee is on goods alone.
  insert into public.listings(seller_id, title, category, price_cents, shipping_cents, allows_collection, status, currency)
  values (seller, 'Collectable', 'engine', 5000, 500, true, 'active', 'USD') returning id into collectable;
  insert into public.offers(listing_id, buyer_id, amount_cents, status)
  values (collectable, buyer, 4500, 'open') returning id into offer_id;
  oid := public.offer_accept_begin(offer_id, seller);
  if (select shipping_cents from public.orders where id = oid) <> 500
     or (select total_cents from public.orders where id = oid) <> 5000 then
    raise exception 'Fixture: the accepted offer was not priced with shipping';
  end if;
  r := public.freeze_accepted_offer_checkout(oid, buyer, collect_snapshot);
  if (r->>'ok')::boolean is not true or (r->>'total_cents')::int <> 4500 then
    raise exception 'Collected accepted offer did not report its new total: %', r;
  end if;
  if (select row(shipping_cents, total_cents, platform_fee_cents, is_collection)::text
        from public.orders where id = oid) <> row(0, 4500, 450, true)::text then
    raise exception 'Collected accepted offer still charges shipping or the old fee: %',
      (select row(shipping_cents, total_cents, platform_fee_cents) from public.orders where id = oid);
  end if;
  if exists (select 1 from public.order_items where order_id = oid
             and (shipping_cents <> 0 or (commercial_snapshot->'commercial'->>'shipping_cents')::int <> 0
                  or price_cents <> 4500)) then
    raise exception 'Collected accepted offer line kept its delivery charge';
  end if;
  if (select amount_cents from public.payments where order_id = oid) <> 4500 then
    raise exception 'Collected accepted offer payment still asks for shipping';
  end if;
  -- A lost response replays the same total, and nothing changes again.
  r := public.freeze_accepted_offer_checkout(oid, buyer, collect_snapshot);
  if (r->>'replayed')::boolean is not true or (r->>'total_cents')::int <> 4500 then
    raise exception 'Collected accepted offer replay lost its total: %', r;
  end if;
  -- The line is immutable again: no other change gets through.
  rejected := false;
  begin update public.order_items set price_cents = 1 where order_id = oid;
  exception when insufficient_privilege then rejected := true; end;
  if not rejected then raise exception 'A collected line accepted a price change'; end if;

  -- 2. Pickup is refused where the listing didn't offer it, with a reason and
  --    nothing changed.
  insert into public.listings(seller_id, title, category, price_cents, shipping_cents, allows_collection, status, currency)
  values (seller, 'Ships only', 'engine', 5000, 500, false, 'active', 'USD') returning id into ship_only;
  insert into public.offers(listing_id, buyer_id, amount_cents, status)
  values (ship_only, buyer, 4500, 'open') returning id into offer_id;
  oid := public.offer_accept_begin(offer_id, seller);
  r := public.freeze_accepted_offer_checkout(oid, buyer, collect_snapshot);
  if (r->>'ok')::boolean is not false or coalesce(r->>'reason', '') not like 'Local pickup isn''t offered%' then
    raise exception 'Pickup was taken on a listing that does not offer it: %', r;
  end if;
  if (select row(is_collection, shipping_cents, total_cents, accepted_checkout_shipping is null)::text
        from public.orders where id = oid) <> row(false, 500, 5000, true)::text then
    raise exception 'A refused pickup changed the order';
  end if;
  -- Delivery is unchanged: the flat shipping stays on.
  r := public.freeze_accepted_offer_checkout(oid, buyer, deliver_snapshot);
  if (r->>'ok')::boolean is not true or (r->>'total_cents')::int <> 5000
     or (select shipping_cents from public.orders where id = oid) <> 500 then
    raise exception 'A delivered accepted offer lost its shipping: %', r;
  end if;
  -- A delivery order's line can't be zeroed through the collection exception.
  rejected := false;
  begin
    update public.order_items
    set shipping_cents = 0,
        commercial_snapshot = jsonb_set(commercial_snapshot, '{commercial,shipping_cents}', '0'::jsonb)
    where order_id = oid;
  exception when insufficient_privilege then rejected := true; end;
  if not rejected then raise exception 'A delivered order line was zeroed directly'; end if;

  -- 3. A pickup-only part can't be delivered.
  insert into public.listings(seller_id, title, category, price_cents, shipping_cents, shipping_mode, allows_collection, status, currency)
  values (seller, 'Pickup only', 'engine', 5000, 0, 'pickup_only', true, 'active', 'USD') returning id into pickup_only;
  insert into public.offers(listing_id, buyer_id, amount_cents, status)
  values (pickup_only, buyer, 4500, 'open') returning id into offer_id;
  oid := public.offer_accept_begin(offer_id, seller);
  r := public.freeze_accepted_offer_checkout(oid, buyer, deliver_snapshot);
  if (r->>'ok')::boolean is not false
     or (select accepted_checkout_shipping from public.orders where id = oid) is not null then
    raise exception 'A pickup-only part was sent for delivery: %', r;
  end if;
  r := public.freeze_accepted_offer_checkout(oid, buyer, collect_snapshot);
  if (r->>'ok')::boolean is not true or (r->>'total_cents')::int <> 4500 then
    raise exception 'A pickup-only part could not be collected: %', r;
  end if;

  -- 4. The charge bound still holds once shipping comes off.
  insert into public.listings(seller_id, title, category, price_cents, shipping_cents, allows_collection, status, currency)
  values (seller, 'Tiny', 'engine', 1000, 500, true, 'active', 'USD') returning id into tiny;
  insert into public.offers(listing_id, buyer_id, amount_cents, status)
  values (tiny, buyer, 40, 'open') returning id into offer_id;
  oid := public.offer_accept_begin(offer_id, seller);
  rejected := false;
  begin perform public.freeze_accepted_offer_checkout(oid, buyer, collect_snapshot);
  exception when numeric_value_out_of_range then rejected := true; end;
  if not rejected
     or (select row(shipping_cents, total_cents, is_collection)::text from public.orders where id = oid)
        <> row(500, 540, false)::text then
    raise exception 'A 40c collected offer was priced below Stripe''s minimum';
  end if;

  -- 5. Once a payment has been asked for, the amount is never changed.
  insert into public.listings(seller_id, title, category, price_cents, shipping_cents, allows_collection, status, currency)
  values (seller, 'Started', 'engine', 5000, 500, true, 'active', 'USD') returning id into started;
  insert into public.offers(listing_id, buyer_id, amount_cents, status)
  values (started, buyer, 4500, 'open') returning id into offer_id;
  oid := public.offer_accept_begin(offer_id, seller);
  insert into public.payment_requests(operation_key, request)
  values ('checkout:collect-guard', jsonb_build_object('orderIds', jsonb_build_array(oid::text), 'totalCents', 5000));
  rejected := false;
  begin perform public.freeze_accepted_offer_checkout(oid, buyer, collect_snapshot);
  exception when object_not_in_prerequisite_state then rejected := true; end;
  if not rejected or (select total_cents from public.orders where id = oid) <> 5000 then
    raise exception 'An accepted offer was re-priced after its payment started';
  end if;

  -- 6. The exception is for pending reservations only: a paid collected
  --    order's line stays immutable.
  insert into public.listings(seller_id, title, category, price_cents, shipping_cents, allows_collection, status, currency)
  values (seller, 'Paid', 'engine', 5000, 500, true, 'active', 'USD') returning id into delivered;
  insert into public.offers(listing_id, buyer_id, amount_cents, status)
  values (delivered, buyer, 4500, 'open') returning id into offer_id;
  oid := public.offer_accept_begin(offer_id, seller);
  update public.orders set status = 'paid' where id = oid;
  rejected := false;
  begin
    update public.order_items
    set shipping_cents = 0,
        commercial_snapshot = jsonb_set(commercial_snapshot, '{commercial,shipping_cents}', '0'::jsonb)
    where order_id = oid;
  exception when insufficient_privilege then rejected := true; end;
  if not rejected then raise exception 'A paid order line was zeroed'; end if;
end $$;

do $$
begin
  if has_function_privilege('authenticated', 'public.freeze_accepted_offer_checkout(uuid,uuid,jsonb)', 'execute') then
    raise exception 'Client role can freeze accepted-offer checkout state';
  end if;
  raise notice 'all accepted-offer collection checks passed';
end $$;
rollback;
