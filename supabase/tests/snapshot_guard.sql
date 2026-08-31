-- ============================================================================
-- Commercial snapshot guard verification (transaction-completion brief §6-§7,
-- migrations 0049 + 0050)
--
-- Proves the properties that matter and that Node tests cannot cover, because
-- they live in triggers and SQL functions:
--
--   1. Buying a listing freezes a complete commercial snapshot + gallery.
--   2. Editing/deleting the listing afterwards changes NOTHING on the order.
--   3. The frozen columns and snapshot images refuse UPDATEs (42501).
--   4. The platform fee is charged on goods + shipping (0050), so the same
--      buyer total always produces the same fee regardless of the
--      price/shipping split.
--
-- Run in the Supabase SQL Editor against a NON-PRODUCTION project. Everything
-- happens inside a transaction that is rolled back at the end, so no rows
-- survive. Raises an exception on failure; prints NOTICEs on success.
-- ============================================================================

begin;

do $$
declare
  v_seller uuid := gen_random_uuid();
  v_buyer uuid := gen_random_uuid();
  v_car uuid;
  v_listing uuid;
  v_listing_b uuid;
  v_result jsonb;
  v_order_id uuid;
  v_item record;
  v_snap jsonb;
  v_images int;
  v_fee_a int;
  v_fee_b int;
  v_before jsonb;
begin
  -- ---------- fixtures ----------
  insert into auth.users (id, email) values
    (v_seller, 'snap-seller@example.test'),
    (v_buyer, 'snap-buyer@example.test');

  update public.profiles set display_name = 'Snap Seller', username = 'snap_seller'
    where id = v_seller;
  update public.profiles set display_name = 'Snap Buyer', username = 'snap_buyer'
    where id = v_buyer;

  insert into public.cars (owner_id, slug, name, make, model, year)
  values (v_seller, 'snap-guard-car', 'Snapshot guard S4', 'Audi', 'S4', 2000)
  returning id into v_car;

  insert into public.listings
    (seller_id, source_car_id, title, description, category, subcategory,
     condition, grade, compatibility_notes, part_number,
     price_cents, shipping_cents, allows_collection, status, currency)
  values
    (v_seller, v_car, 'Guard turbo', 'Original description', 'engine', 'turbo',
     'used', 'b', 'K03 only', '078145701S',
     30000, 2300, true, 'active', 'USD')
  returning id into v_listing;

  insert into public.listing_fitments (listing_id, make, model, year_start, year_end)
  values (v_listing, 'Audi', 'S4', 1998, 2002);

  insert into public.listing_part_numbers (listing_id, number)
  values (v_listing, '078145701SX');

  insert into public.listing_images (listing_id, url, alt, position)
  values
    (v_listing, 'https://example.test/storage/v1/object/public/listing-images/a/1.jpg', 'front', 0),
    (v_listing, 'https://example.test/storage/v1/object/public/listing-images/a/2.jpg', 'side', 1);

  -- ---------- 1. purchase freezes the snapshot ----------
  v_result := public.purchase_begin(v_buyer, array[v_listing], 'snap-guard-key');
  v_order_id := (v_result->'orders'->0->>'order_id')::uuid;
  if v_order_id is null then
    raise exception 'FAIL: purchase_begin returned no order: %', v_result;
  end if;

  select * into v_item from public.order_items where order_id = v_order_id;
  v_snap := v_item.commercial_snapshot;

  if v_snap is null then
    raise exception 'FAIL: commercial_snapshot missing';
  end if;
  if (v_snap->>'version')::int <> 1 then
    raise exception 'FAIL: snapshot version %', v_snap->>'version';
  end if;
  if v_snap->'listing'->>'title' <> 'Guard turbo'
     or v_snap->'listing'->>'description' <> 'Original description'
     or v_snap->'listing'->>'category' <> 'engine' then
    raise exception 'FAIL: listing identity not frozen: %', v_snap->'listing';
  end if;
  if v_snap->'part'->>'part_number' <> '078145701S'
     or v_snap->'part'->'alt_part_numbers'->>0 <> '078145701SX' then
    raise exception 'FAIL: part identity not frozen: %', v_snap->'part';
  end if;
  if v_snap->'condition'->>'grade' <> 'b' then
    raise exception 'FAIL: condition not frozen: %', v_snap->'condition';
  end if;
  if jsonb_array_length(v_snap->'fitment') <> 1
     or v_snap->'fitment'->0->>'make' <> 'Audi' then
    raise exception 'FAIL: fitment not frozen: %', v_snap->'fitment';
  end if;
  if v_snap->'source_car'->>'name' <> 'Snapshot guard S4' then
    raise exception 'FAIL: source car not frozen: %', v_snap->'source_car';
  end if;
  if (v_snap->'commercial'->>'price_cents')::int <> 30000
     or (v_snap->'commercial'->>'shipping_cents')::int <> 2300
     or (v_snap->'commercial'->>'allows_collection')::boolean is not true then
    raise exception 'FAIL: commercial terms not frozen: %', v_snap->'commercial';
  end if;
  if v_snap->'seller'->>'username' <> 'snap_seller' then
    raise exception 'FAIL: seller identity not frozen: %', v_snap->'seller';
  end if;

  select count(*) into v_images
    from public.order_item_snapshot_images where order_item_id = v_item.id;
  if v_images <> 2 then
    raise exception 'FAIL: expected 2 frozen images, found %', v_images;
  end if;
  raise notice 'PASS: purchase freezes a complete snapshot + gallery';

  -- ---------- 2. later edits change nothing on the order ----------
  v_before := v_snap;
  update public.listings
     set title = 'EDITED after sale', description = 'rewritten',
         compatibility_notes = 'now claims universal fit', part_number = 'FAKE'
   where id = v_listing;
  delete from public.listing_fitments where listing_id = v_listing;
  delete from public.listing_images where listing_id = v_listing;
  update public.profiles set display_name = 'Renamed Seller' where id = v_seller;

  select commercial_snapshot into v_snap
    from public.order_items where id = v_item.id;
  if v_snap <> v_before then
    raise exception 'FAIL: snapshot changed after listing edit';
  end if;
  select count(*) into v_images
    from public.order_item_snapshot_images where order_item_id = v_item.id;
  if v_images <> 2 then
    raise exception 'FAIL: frozen gallery shrank after listing gallery delete';
  end if;
  raise notice 'PASS: listing/profile edits do not touch the frozen record';

  -- ---------- 3. immutability guards ----------
  begin
    update public.order_items
       set commercial_snapshot = '{"forged": true}'::jsonb
     where id = v_item.id;
    raise exception 'FAIL: commercial_snapshot accepted an UPDATE';
  exception
    when insufficient_privilege then
      raise notice 'PASS: commercial_snapshot refuses UPDATE (42501)';
  end;

  begin
    update public.order_items set price_cents = 1 where id = v_item.id;
    raise exception 'FAIL: order_items.price_cents accepted an UPDATE';
  exception
    when insufficient_privilege then
      raise notice 'PASS: frozen money columns refuse UPDATE (42501)';
  end;

  begin
    update public.order_item_snapshot_images
       set url = 'https://example.test/forged.jpg'
     where order_item_id = v_item.id;
    raise exception 'FAIL: snapshot image accepted an UPDATE';
  exception
    when insufficient_privilege then
      raise notice 'PASS: snapshot images refuse UPDATE (42501)';
  end;

  -- ON DELETE SET NULL from a listing delete must still work (guard leaves
  -- listing_id unfrozen). Listings refuse deletion while reserved/sold, so
  -- exercise the same write the FK performs.
  update public.order_items set listing_id = null where id = v_item.id;
  raise notice 'PASS: listing_id remains writable for the FK cascade';

  -- ---------- 4. fee basis is goods + shipping (0050) ----------
  -- Same $323 buyer total, opposite split — the fee must be identical.
  insert into public.listings
    (seller_id, title, category, condition, price_cents, shipping_cents, status, currency)
  values
    (v_seller, 'Split test A', 'engine', 'used', 30000, 2300, 'active', 'USD')
  returning id into v_listing_b;
  v_result := public.purchase_begin(v_buyer, array[v_listing_b], 'snap-fee-a');
  v_fee_a := (v_result->'orders'->0->>'platform_fee_cents')::int;

  insert into public.listings
    (seller_id, title, category, condition, price_cents, shipping_cents, status, currency)
  values
    (v_seller, 'Split test B', 'engine', 'used', 10000, 22300, 'active', 'USD')
  returning id into v_listing_b;
  v_result := public.purchase_begin(v_buyer, array[v_listing_b], 'snap-fee-b');
  v_fee_b := (v_result->'orders'->0->>'platform_fee_cents')::int;

  if v_fee_a <> 3230 or v_fee_b <> 3230 then
    raise exception 'FAIL: fee basis is not goods+shipping (a=%, b=%)', v_fee_a, v_fee_b;
  end if;
  raise notice 'PASS: fee is 3230 on a 32300 total regardless of the split';

  raise notice 'PASS: snapshot_guard — all checks green (rolling back)';
end $$;

rollback;
