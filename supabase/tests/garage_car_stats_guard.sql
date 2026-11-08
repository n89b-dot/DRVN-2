-- RR-09/RR-25: garage_car_stats counts DRVN sales from paid orders at the
-- price the buyer paid, less refunds — never asking prices or "sold
-- elsewhere" marks — and only for the caller's own cars.
begin;

do $$
declare
  seller uuid := gen_random_uuid();
  buyer uuid := gen_random_uuid();
  stranger uuid := gen_random_uuid();
  car uuid := gen_random_uuid();
  other_car uuid := gen_random_uuid();
  offered uuid := gen_random_uuid();
  marked uuid := gen_random_uuid();
  refunded uuid := gen_random_uuid();
  partial_a uuid := gen_random_uuid();
  partial_b uuid := gen_random_uuid();
  cancelled uuid := gen_random_uuid();
  live uuid := gen_random_uuid();
  held uuid := gen_random_uuid();
  v_order uuid;
  stats record;
begin
  insert into auth.users(id, email, raw_user_meta_data) values
    (seller, 'garage-stats-seller@drvn.test', '{}'),
    (buyer, 'garage-stats-buyer@drvn.test', '{}'),
    (stranger, 'garage-stats-stranger@drvn.test', '{}');
  insert into public.cars(id, owner_id, name, slug) values
    (car, seller, 'Stats car', 'stats-car-' || left(car::text, 8)),
    (other_car, stranger, 'Not yours', 'not-yours-' || left(other_car::text, 8));

  insert into public.listings(id, seller_id, source_car_id, title, category, price_cents, status) values
    (offered, seller, car, 'Accepted at $80', 'performance', 10000, 'active'),
    (marked, seller, car, 'Sold elsewhere', 'performance', 50000, 'active'),
    (refunded, seller, car, 'Refunded in full', 'performance', 7000, 'active'),
    (partial_a, seller, car, 'Partly refunded A', 'performance', 6000, 'active'),
    (partial_b, seller, car, 'Partly refunded B', 'performance', 4000, 'active'),
    (cancelled, seller, car, 'Never paid', 'performance', 3000, 'active'),
    (live, seller, car, 'Still live', 'performance', 2000, 'active'),
    (held, seller, car, 'In a checkout', 'performance', 2500, 'active');

  -- $100 asking, bought at an accepted $80.
  insert into public.orders(buyer_id, seller_id, status, subtotal_cents, shipping_cents, platform_fee_cents, total_cents, currency, is_collection)
  values (buyer, seller, 'delivered', 8000, 0, 800, 8000, 'USD', false) returning id into v_order;
  insert into public.order_items(order_id, listing_id, title, price_cents, shipping_cents) values (v_order, offered, 'Accepted at $80', 8000, 0);
  -- Fully refunded: not a sale.
  insert into public.orders(buyer_id, seller_id, status, subtotal_cents, shipping_cents, platform_fee_cents, total_cents, currency, is_collection, refunded_cents)
  values (buyer, seller, 'refunded', 7000, 0, 700, 7000, 'USD', false, 7000) returning id into v_order;
  insert into public.order_items(order_id, listing_id, title, price_cents, shipping_cents) values (v_order, refunded, 'Refunded in full', 7000, 0);
  -- Two items, $30 refunded across the order: shared 60/40 → $42 + $28.
  insert into public.orders(buyer_id, seller_id, status, subtotal_cents, shipping_cents, platform_fee_cents, total_cents, currency, is_collection, refunded_cents)
  values (buyer, seller, 'completed', 10000, 0, 1000, 10000, 'USD', false, 3000) returning id into v_order;
  insert into public.order_items(order_id, listing_id, title, price_cents, shipping_cents) values
    (v_order, partial_a, 'Partly refunded A', 6000, 0),
    (v_order, partial_b, 'Partly refunded B', 4000, 0);
  -- Cancelled before payment: not a sale.
  insert into public.orders(buyer_id, seller_id, status, subtotal_cents, shipping_cents, platform_fee_cents, total_cents, currency, is_collection)
  values (buyer, seller, 'cancelled', 3000, 0, 300, 3000, 'USD', false) returning id into v_order;
  insert into public.order_items(order_id, listing_id, title, price_cents, shipping_cents) values (v_order, cancelled, 'Never paid', 3000, 0);

  update public.listings set status = 'sold' where id in (offered, marked, refunded, partial_a, partial_b);
  update public.listings set status = 'reserved' where id = held;
  insert into public.offers(listing_id, buyer_id, amount_cents, status) values (live, buyer, 1500, 'open');

  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', seller, 'role', 'authenticated')::text, true);

  select * into stats from public.garage_car_stats(array[car, other_car]);
  if (select count(*) from public.garage_car_stats(array[car, other_car])) <> 1 then
    raise exception 'Stats returned a car the caller does not own';
  end if;
  -- $80 + $42 + $28. Not the $100 asking price, not the $500 sold elsewhere,
  -- not the refunded $70, not the unpaid $30.
  if stats.sales_cents <> 15000 or stats.sales_count <> 3 then
    raise exception 'Sales were % cents over % items; expected 15000 over 3', stats.sales_cents, stats.sales_count;
  end if;
  if stats.parts_sold <> 5 or stats.parts_live <> 2 or stats.parts_held <> 1 then
    raise exception 'Parts were live %, held %, sold %; expected 2, 1, 5', stats.parts_live, stats.parts_held, stats.parts_sold;
  end if;
  if stats.open_offers <> 1 then
    raise exception 'Open offers were %; expected 1', stats.open_offers;
  end if;

  -- A stranger sees nothing of the seller's cars.
  perform set_config('request.jwt.claims', jsonb_build_object('sub', stranger, 'role', 'authenticated')::text, true);
  if exists (select 1 from public.garage_car_stats(array[car]) ) then
    raise exception 'A stranger read another member''s garage stats';
  end if;

  perform set_config('role', 'none', true);
  if (select prosecdef from pg_proc where oid = 'public.garage_car_stats(uuid[])'::regprocedure) then
    raise exception 'Garage stats bypass row-level security';
  end if;
  if has_function_privilege('anon', 'public.garage_car_stats(uuid[])', 'execute') then
    raise exception 'Anonymous caller can read garage stats';
  end if;
  raise notice 'all garage car stats checks passed';
end $$;

rollback;
