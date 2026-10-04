-- R2-03: garage sales subtract refunds in whole cents that add up exactly,
-- and a returned part's refund comes off that part's car.
begin;

do $$
declare
  seller uuid := gen_random_uuid();
  buyer uuid := gen_random_uuid();
  half_car uuid := gen_random_uuid();
  tiny_car uuid := gen_random_uuid();
  car_a uuid := gen_random_uuid();
  car_b uuid := gen_random_uuid();
  qty_car uuid := gen_random_uuid();
  ship_car uuid := gen_random_uuid();
  mixed_car uuid := gen_random_uuid();
  v_order uuid;
  v_item uuid;
  v_listing uuid;
  v_return uuid;
  v_refund uuid;
  i integer;
  j integer;
  items integer;
  price integer;
  goods bigint;
  refunded bigint;
  expected_cents bigint := 0;
  stats record;
begin
  update public.beta_access_config set enforced = false where singleton = true;
  insert into auth.users(id, email, raw_user_meta_data) values
    (seller, 'refund-alloc-seller@drvn.test', '{}'), (buyer, 'refund-alloc-buyer@drvn.test', '{}');
  insert into public.cars(id, owner_id, name, slug)
  select c, seller, 'Car ' || n, 'refund-alloc-' || n || '-' || left(c::text, 8)
  from unnest(array[half_car, tiny_car, car_a, car_b, qty_car, ship_car, mixed_car]) with ordinality as t(c, n);

  -- 1. Two $1 items and a 1¢ refund: $1.99, not $1.98.
  insert into public.orders(buyer_id, seller_id, status, subtotal_cents, shipping_cents, platform_fee_cents, total_cents, currency, refunded_cents)
  values (buyer, seller, 'completed', 200, 0, 20, 200, 'USD', 1) returning id into v_order;
  for i in 1..2 loop
    insert into public.listings(seller_id, source_car_id, title, category, price_cents, status)
    values (seller, half_car, 'Half ' || i, 'performance', 100, 'sold') returning id into v_listing;
    insert into public.order_items(order_id, listing_id, title, price_cents, shipping_cents) values (v_order, v_listing, 'Half ' || i, 100, 0);
  end loop;

  -- 2. Five 1¢ items and a 2¢ refund: the refund doesn't vanish.
  insert into public.orders(buyer_id, seller_id, status, subtotal_cents, shipping_cents, platform_fee_cents, total_cents, currency, refunded_cents)
  values (buyer, seller, 'completed', 5, 0, 0, 5, 'USD', 2) returning id into v_order;
  for i in 1..5 loop
    insert into public.listings(seller_id, source_car_id, title, category, price_cents, status)
    values (seller, tiny_car, 'Tiny ' || i, 'performance', 1, 'sold') returning id into v_listing;
    insert into public.order_items(order_id, listing_id, title, price_cents, shipping_cents) values (v_order, v_listing, 'Tiny ' || i, 1, 0);
  end loop;

  -- 3. A $70 part from car A and a $30 part from car B, $10 shipping. Only
  --    A comes back: its refund is $70 plus a $5 shipping share.
  insert into public.orders(buyer_id, seller_id, status, subtotal_cents, shipping_cents, platform_fee_cents, total_cents, currency, refunded_cents)
  values (buyer, seller, 'completed', 10000, 1000, 1000, 11000, 'USD', 7500) returning id into v_order;
  insert into public.listings(seller_id, source_car_id, title, category, price_cents, status)
  values (seller, car_a, 'From A', 'performance', 7000, 'sold') returning id into v_listing;
  insert into public.order_items(order_id, listing_id, title, price_cents, shipping_cents)
  values (v_order, v_listing, 'From A', 7000, 0) returning id into v_item;
  insert into public.listings(seller_id, source_car_id, title, category, price_cents, status)
  values (seller, car_b, 'From B', 'performance', 3000, 'sold') returning id into v_listing;
  insert into public.order_items(order_id, listing_id, title, price_cents, shipping_cents) values (v_order, v_listing, 'From B', 3000, 0);
  v_refund := gen_random_uuid();
  insert into public.refund_operations(id, order_id, amount_cents, currency, remaining_before_cents, reason, requested_by, idempotency_key, status)
  values (v_refund, v_order, 7500, 'USD', 11000, 'return', 'return:guard', 'alloc-' || v_refund, 'completed');
  insert into public.returns(order_id, requested_by, return_type, responsibility, status, refund_amount_cents, refund_operation_id)
  values (v_order, buyer, 'protection', 'seller', 'completed', 7500, v_refund) returning id into v_return;
  insert into public.return_items(return_id, order_item_id, quantity) values (v_return, v_item, 1);

  -- 4. Three units at $10; one comes back ($10), then a 1¢ goodwill refund.
  insert into public.orders(buyer_id, seller_id, status, subtotal_cents, shipping_cents, platform_fee_cents, total_cents, currency, refunded_cents)
  values (buyer, seller, 'delivered', 3000, 0, 300, 3000, 'USD', 1001) returning id into v_order;
  insert into public.listings(seller_id, source_car_id, title, category, price_cents, status)
  values (seller, qty_car, 'Three of them', 'performance', 1000, 'sold') returning id into v_listing;
  insert into public.order_items(order_id, listing_id, title, price_cents, shipping_cents, quantity)
  values (v_order, v_listing, 'Three of them', 1000, 0, 3) returning id into v_item;
  v_refund := gen_random_uuid();
  insert into public.refund_operations(id, order_id, amount_cents, currency, remaining_before_cents, reason, requested_by, idempotency_key, status)
  values (v_refund, v_order, 1000, 'USD', 3000, 'return', 'return:guard', 'alloc-' || v_refund, 'completed');
  insert into public.returns(order_id, requested_by, return_type, responsibility, status, refund_amount_cents, refund_operation_id)
  values (v_order, buyer, 'protection', 'seller', 'completed', 1000, v_refund) returning id into v_return;
  insert into public.return_items(return_id, order_item_id, quantity) values (v_return, v_item, 1);

  -- 5. Goods and shipping refunded in full on an order still marked
  --    delivered: the goods refund stops at the goods.
  insert into public.orders(buyer_id, seller_id, status, subtotal_cents, shipping_cents, platform_fee_cents, total_cents, currency, refunded_cents)
  values (buyer, seller, 'delivered', 5000, 1000, 500, 6000, 'USD', 6000) returning id into v_order;
  insert into public.listings(seller_id, source_car_id, title, category, price_cents, status)
  values (seller, ship_car, 'Shipped', 'performance', 5000, 'sold') returning id into v_listing;
  insert into public.order_items(order_id, listing_id, title, price_cents, shipping_cents) values (v_order, v_listing, 'Shipped', 5000, 0);

  -- 6. Conservation over many odd baskets: whatever the shares, they sum to
  --    the refund to the cent (no return explains these refunds).
  perform setseed(0.42);
  for i in 1..40 loop
    items := 1 + floor(random() * 6)::integer;
    goods := 0;
    insert into public.orders(buyer_id, seller_id, status, subtotal_cents, shipping_cents, platform_fee_cents, total_cents, currency)
    values (buyer, seller, 'completed', 0, 0, 0, 0, 'USD') returning id into v_order;
    for j in 1..items loop
      price := 1 + floor(random() * 997)::integer;
      goods := goods + price;
      insert into public.listings(seller_id, source_car_id, title, category, price_cents, status)
      values (seller, mixed_car, 'Mixed', 'performance', price, 'sold') returning id into v_listing;
      insert into public.order_items(order_id, listing_id, title, price_cents, shipping_cents) values (v_order, v_listing, 'Mixed', price, 0);
    end loop;
    refunded := floor(random() * (goods + 1))::bigint;
    update public.orders set subtotal_cents = goods, total_cents = goods, refunded_cents = refunded where id = v_order;
    expected_cents := expected_cents + goods - refunded;
  end loop;

  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', seller, 'role', 'authenticated')::text, true);

  select * into stats from public.garage_car_stats(array[half_car]);
  if stats.sales_cents <> 199 or stats.sales_count <> 2 then
    raise exception 'Two $1 items less 1¢: % over %, expected 199 over 2', stats.sales_cents, stats.sales_count;
  end if;
  select * into stats from public.garage_car_stats(array[tiny_car]);
  if stats.sales_cents <> 3 or stats.sales_count <> 3 then
    raise exception 'Five 1¢ items less 2¢: % over %, expected 3 over 3', stats.sales_cents, stats.sales_count;
  end if;
  select * into stats from public.garage_car_stats(array[car_a]);
  if stats.sales_cents <> 0 or stats.sales_count <> 0 then
    raise exception 'Returned part''s car kept % over %', stats.sales_cents, stats.sales_count;
  end if;
  select * into stats from public.garage_car_stats(array[car_b]);
  if stats.sales_cents <> 3000 or stats.sales_count <> 1 then
    raise exception 'Kept part''s car shows % over %, expected 3000 over 1', stats.sales_cents, stats.sales_count;
  end if;
  select * into stats from public.garage_car_stats(array[qty_car]);
  if stats.sales_cents <> 1999 or stats.sales_count <> 1 then
    raise exception 'Three units less one return and 1¢: %, expected 1999', stats.sales_cents;
  end if;
  select * into stats from public.garage_car_stats(array[ship_car]);
  if stats.sales_cents <> 0 or stats.sales_count <> 0 then
    raise exception 'A full refund with shipping left % in goods', stats.sales_cents;
  end if;
  select * into stats from public.garage_car_stats(array[mixed_car]);
  if stats.sales_cents <> expected_cents then
    raise exception 'Refund shares did not conserve cents: % vs expected %', stats.sales_cents, expected_cents;
  end if;

  raise notice 'all garage refund allocation checks passed';
end $$;

rollback;
