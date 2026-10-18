-- Price comparables and product fitment evidence (20261020130000,
-- 20261020140000). Transactional; disposable database only.
--
-- Sold comparables are completed sales of the same product only — same
-- brand, any number the product holds — at the price paid, per unit, net of
-- refunds, within two years, in one currency. Returned lines, refunded-to-
-- nothing lines, unfinished orders and other brands' parts with the same
-- number stay out. Below three sales there is a count and no price. Asking
-- comparables are parts for sale now, without suspended sellers. Members can
-- ask; visitors can't. Fitment claims keep their source and constraints and
-- can't name another model's generation.
begin;

do $$
declare
  v_seller uuid := gen_random_uuid();
  v_buyer uuid := gen_random_uuid();
  v_banned uuid := gen_random_uuid();
  v_order uuid;
  v_item uuid;
  v_listing uuid;
  v_return uuid;
  v_refund uuid;
  v_ask_mine uuid;
  v_c jsonb;
  v_make bigint;
  v_model bigint;
  v_other_model bigint;
  v_gen bigint;
  v_product uuid;
  denied boolean;
  i int;
begin
  update public.beta_access_config set enforced = false where singleton = true;
  insert into auth.users(id, email, raw_user_meta_data) values
    (v_seller, 'comps-seller@drvn.test', '{}'), (v_buyer, 'comps-buyer@drvn.test', '{}'), (v_banned, 'comps-banned@drvn.test', '{}');

  -- One completed single-line sale of a Garrett part, returning the line.
  create function pg_temp.sale(p_seller uuid, p_buyer uuid, p_brand text, p_number text, p_price int, p_condition text,
                               p_status text default 'completed', p_refunded int default 0, p_currency text default 'USD',
                               p_completed_at timestamptz default now() - interval '10 days')
  returns uuid language plpgsql as $f$
  declare o uuid; l uuid; it uuid;
  begin
    insert into public.orders(buyer_id, seller_id, status, subtotal_cents, shipping_cents, platform_fee_cents, total_cents,
                              currency, refunded_cents, completed_at)
    values (p_buyer, p_seller, p_status, p_price, 2000, p_price / 10, p_price + 2000, p_currency, p_refunded,
            case when p_status = 'completed' then p_completed_at end) returning id into o;
    insert into public.listings(seller_id, title, category, condition, price_cents, status, brand, part_number, currency)
    values (p_seller, p_brand || ' turbo', 'performance', p_condition, p_price, 'sold', p_brand, p_number, p_currency) returning id into l;
    insert into public.order_items(order_id, listing_id, title, price_cents, shipping_cents)
    values (o, l, p_brand || ' turbo', p_price, 2000) returning id into it;
    return it;
  end $f$;

  -- 1. Kept: five sales, one net of a partial refund, one sharing its
  -- order's refund with another part.
  perform pg_temp.sale(v_seller, v_buyer, 'Garrett', 'GTX-3582R', 100000, 'used');
  perform pg_temp.sale(v_seller, v_buyer, 'GARRETT', 'GTX3582R', 120000, 'used');
  perform pg_temp.sale(v_seller, v_buyer, 'Garrett', 'gtx 3582 r', 110000, 'used');
  perform pg_temp.sale(v_seller, v_buyer, 'Garrett', 'GTX3582R', 150000, 'like_new', 'completed', 20000); -- nets 130000
  insert into public.orders(buyer_id, seller_id, status, subtotal_cents, shipping_cents, platform_fee_cents, total_cents, currency, refunded_cents, completed_at)
  values (v_buyer, v_seller, 'completed', 200000, 0, 20000, 200000, 'USD', 50000, now() - interval '3 days') returning id into v_order;
  insert into public.listings(seller_id, title, category, condition, price_cents, status, brand, part_number)
  values (v_seller, 'Garrett turbo', 'performance', 'used', 100000, 'sold', 'Garrett', 'GTX3582R') returning id into v_listing;
  insert into public.order_items(order_id, listing_id, title, price_cents, shipping_cents) values (v_order, v_listing, 'Garrett turbo', 100000, 0);
  insert into public.listings(seller_id, title, category, condition, price_cents, status, brand, part_number)
  values (v_seller, 'Wastegate', 'performance', 'used', 100000, 'sold', 'Tial', 'MVR44') returning id into v_listing;
  insert into public.order_items(order_id, listing_id, title, price_cents, shipping_cents) values (v_order, v_listing, 'Wastegate', 100000, 0); -- Garrett nets 75000

  -- 2. Left out: returned, not completed, another brand, too old, refunded
  -- to nothing. (Orders are USD-only today: orders_currency_usd.)
  v_item := pg_temp.sale(v_seller, v_buyer, 'Garrett', 'GTX3582R', 1000, 'used', 'completed', 1000);
  select order_id into v_order from public.order_items where id = v_item;
  v_refund := gen_random_uuid();
  insert into public.refund_operations(id, order_id, amount_cents, currency, remaining_before_cents, reason, requested_by, idempotency_key, status)
  values (v_refund, v_order, 1000, 'USD', 3000, 'return', 'return:guard', 'comps-' || v_refund, 'completed');
  insert into public.returns(order_id, requested_by, return_type, responsibility, status, refund_amount_cents, refund_operation_id)
  values (v_order, v_buyer, 'protection', 'seller', 'completed', 1000, v_refund) returning id into v_return;
  insert into public.return_items(return_id, order_item_id, quantity) values (v_return, v_item, 1);
  perform pg_temp.sale(v_seller, v_buyer, 'Garrett', 'GTX3582R', 2000, 'used', 'delivered');
  perform pg_temp.sale(v_seller, v_buyer, 'Precision', 'GTX3582R', 3000, 'used');
  perform pg_temp.sale(v_seller, v_buyer, 'Garrett', 'GTX3582R', 5000, 'used', 'completed', 0, 'USD', now() - interval '3 years');
  perform pg_temp.sale(v_seller, v_buyer, 'Garrett', 'GTX3582R', 6000, 'used', 'completed', 6000);

  -- 3. Asking: three for sale, one by a suspended seller, one of another brand.
  insert into public.listings(seller_id, title, category, condition, price_cents, status, brand, part_number)
  values (v_seller, 'Garrett for sale', 'performance', 'used', 90000, 'active', 'Garrett', 'GTX3582R'),
         (v_seller, 'Garrett for sale', 'performance', 'used', 95000, 'active', 'Garrett', 'GTX3582R'),
         (v_banned, 'Garrett, banned seller', 'performance', 'used', 1000, 'active', 'Garrett', 'GTX3582R'),
         (v_seller, 'Precision for sale', 'performance', 'used', 2000, 'active', 'Precision', 'GTX3582R');
  insert into public.listings(seller_id, title, category, condition, price_cents, status, brand, part_number)
  values (v_seller, 'Garrett for sale', 'performance', 'used', 99000, 'active', 'Garrett', 'GTX3582R') returning id into v_ask_mine;
  update public.profiles set suspended_at = now(), suspended_reason = 'guard' where id = v_banned;

  v_c := public.price_comparables('Garrett', 'GTX3582R');
  if (v_c -> 'sold' ->> 'count')::int <> 5 then raise exception 'FAIL 1a: expected 5 sold comparables, got %', v_c -> 'sold'; end if;
  if (v_c -> 'sold' ->> 'median_cents')::int <> 110000 or (v_c -> 'sold' ->> 'p25_cents')::int <> 100000
     or (v_c -> 'sold' ->> 'p75_cents')::int <> 120000 then
    raise exception 'FAIL 1b: sold figures wrong (net of refunds?): %', v_c -> 'sold';
  end if;
  if (v_c -> 'sold' ->> 'median_shipping_cents')::int <> 2000 or (v_c -> 'sold' ->> 'newest_days')::int > 10 then
    raise exception 'FAIL 1c: shipping or age missing: %', v_c -> 'sold';
  end if;
  -- used: 75000, 100000, 110000, 120000; like_new has one sale and is not shown.
  if v_c -> 'sold' -> 'by_condition' is distinct from '[{"count": 4, "condition": "used", "median_cents": 100000}]'::jsonb then
    raise exception 'FAIL 1d: condition breakdown wrong: %', v_c -> 'sold' -> 'by_condition';
  end if;
  if (v_c -> 'asking' ->> 'count')::int <> 3 or (v_c -> 'asking' ->> 'median_cents')::int <> 95000 then
    raise exception 'FAIL 1e: asking comparables wrong: %', v_c -> 'asking';
  end if;
  v_c := public.price_comparables('Garrett', 'GTX3582R', 'USD', v_ask_mine);
  if (v_c -> 'asking' ->> 'count')::int <> 2 or v_c -> 'asking' ? 'median_cents' then
    raise exception 'FAIL 1f: excluding the caller''s listing should leave 2, without a price: %', v_c -> 'asking';
  end if;

  -- 4. Below the minimum sample: a count, no price.
  perform pg_temp.sale(v_seller, v_buyer, 'Garrett', 'G25-660', 70000, 'used');
  perform pg_temp.sale(v_seller, v_buyer, 'Garrett', 'G25-660', 72000, 'used');
  v_c := public.price_comparables('garrett', 'g25660');
  if (v_c -> 'sold' ->> 'count')::int <> 2 or (v_c -> 'sold' ->> 'enough')::boolean
     or v_c -> 'sold' ? 'median_cents' or v_c -> 'sold' ? 'p25_cents' or v_c -> 'sold' ? 'newest_days' then
    raise exception 'FAIL 2: two sales revealed a price: %', v_c -> 'sold';
  end if;
  if (public.price_comparables(null, 'GTX3582R') ->> 'reason') <> 'brand_and_number_required' then
    raise exception 'FAIL 3: a number without a brand got comparables';
  end if;

  -- 5. Through the product: a number the product holds counts.
  perform pg_temp.sale(v_seller, v_buyer, 'Garrett', '856801-5', 115000, 'used');
  insert into public.part_number_links(from_compact, to_compact, kind, source, from_brand_key, to_brand_key)
  values ('gtx3582r', '8568015', 'same_product', 'guard', 'garrett', 'garrett');
  perform public.grow_products();
  v_c := public.price_comparables('Garrett', '856801-5');
  if (v_c -> 'sold' ->> 'count')::int <> 6 or not (v_c -> 'identity' ->> 'product')::boolean or (v_c -> 'identity' ->> 'numbers')::int <> 2 then
    raise exception 'FAIL 4: comparables did not follow the product: %', v_c;
  end if;
  -- Interchange is not the same product.
  perform pg_temp.sale(v_seller, v_buyer, 'Garrett', 'GT3582R', 90000, 'used');
  insert into public.part_number_links(from_compact, to_compact, kind, source, from_brand_key, to_brand_key)
  values ('gtx3582r', 'gt3582r', 'interchange', 'guard', 'garrett', 'garrett');
  perform public.grow_products();
  if (public.price_comparables('Garrett', 'GTX3582R') -> 'sold' ->> 'count')::int <> 6 then
    raise exception 'FAIL 5: an interchangeable part counted as a comparable';
  end if;
  -- Coverage counts completed sale lines.
  if (public.product_coverage() -> 'sold_lines' ->> 'with_product')::int < 6 then
    raise exception 'FAIL 6: sold lines not in coverage: %', public.product_coverage() -> 'sold_lines';
  end if;

  -- 6. Members may ask; visitors may not; nothing identifies anyone.
  if has_function_privilege('anon', 'public.price_comparables(text,text,text,uuid)', 'execute') then
    raise exception 'FAIL 7a: visitors can ask for sold prices';
  end if;
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_buyer, 'role', 'authenticated')::text, true);
  v_c := public.price_comparables('Garrett', 'GTX3582R');
  if (v_c -> 'sold' ->> 'count')::int <> 6 then raise exception 'FAIL 7b: a member could not read comparables'; end if;
  if v_c::text ~ '[0-9a-f]{8}-[0-9a-f]{4}-' then raise exception 'FAIL 7c: comparables carry an id: %', v_c; end if;
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);

  -- 7. Fitment claims: source, constraints, one model's generation only.
  insert into public.catalog_makes(name) values ('Compsguard') returning id into v_make;
  insert into public.catalog_models(make_id, name) values (v_make, 'Hatch') returning id into v_model;
  insert into public.catalog_models(make_id, name) values (v_make, 'Saloon') returning id into v_other_model;
  insert into public.vehicle_generations(model_id, name, year_start) values (v_model, 'Mk1', 2010) returning id into v_gen;
  select product_id into v_product from public.product_part_numbers where brand_key = 'garrett' and number_compact = 'gtx3582r';
  insert into public.product_fitments(product_id, catalog_model_id, generation_id, relationship, source, source_ref, stated_on,
                                      engine_codes, gearbox_codes)
  values (v_product, v_model, v_gen, 'fits', 'manufacturer', 'garrett catalogue 2026 p.12', '2026-03-01', array['EA888 gen3'], array['DQ381']);
  begin
    insert into public.product_fitments(product_id, catalog_model_id, generation_id, relationship, source)
    values (v_product, v_other_model, v_gen, 'fits', 'admin');
    raise exception 'FAIL 8a: a claim named another model''s generation';
  exception when foreign_key_violation then null;
  end;
  begin
    insert into public.product_fitments(product_id, catalog_model_id, relationship, source)
    values (v_product, v_model, 'fits_with_modification', 'community');
    raise exception 'FAIL 8b: a modification claim without saying what';
  exception when check_violation then null;
  end;
  begin
    insert into public.product_fitments(product_id, catalog_model_id, relationship, source, engine_codes)
    values (v_product, v_model, 'fits', 'community', '{}');
    raise exception 'FAIL 8c: an empty constraint was accepted';
  exception when check_violation then null;
  end;
  insert into public.product_fitments(product_id, catalog_model_id, relationship, source, verification)
  values (v_product, v_model, 'does_not_fit', 'community', 'retracted');
  perform set_config('role', 'anon', true);
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  if (select count(*) from public.product_fitments where product_id = v_product) <> 1 then
    raise exception 'FAIL 8d: visitors should read the one live claim, not the retracted one';
  end if;
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_buyer, 'role', 'authenticated')::text, true);
  denied := false;
  begin
    insert into public.product_fitments(product_id, catalog_model_id, relationship, source) values (v_product, v_model, 'fits', 'community');
  exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'FAIL 8e: a member wrote a fitment claim'; end if;
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);

  raise notice 'all price comparables checks passed';
end $$;

rollback;
