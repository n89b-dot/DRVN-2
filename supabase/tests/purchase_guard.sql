-- ============================================================================
-- Purchase guard verification (remediation plan R2.1 "Done when")
--
-- Proves the property that matters: a listing can be sold exactly once, even
-- when two buyers try at the same moment. Node tests cannot cover this — the
-- guarantee lives in the conditional UPDATE inside `purchase_begin`.
--
-- Run in the Supabase SQL Editor against a NON-PRODUCTION project. Everything
-- happens inside a transaction that is rolled back at the end, so no rows
-- survive. Raises an exception on failure; prints NOTICEs on success.
--
-- For true concurrency, run section 4 from two SQL sessions at once (see the
-- note there). Sections 1–3 verify the sequential guarantees.
-- ============================================================================

begin;

do $$
declare
  v_seller uuid := gen_random_uuid();
  v_buyer_a uuid := gen_random_uuid();
  v_buyer_b uuid := gen_random_uuid();
  v_listing uuid;
  v_result_a jsonb;
  v_result_b jsonb;
  v_replay jsonb;
  v_orders int;
  v_status text;
begin
  -- ---------- fixtures ----------
  -- profiles.id references auth.users, so create the auth rows first.
  insert into auth.users (id, email) values
    (v_seller, 'guard-seller@example.test'),
    (v_buyer_a, 'guard-buyer-a@example.test'),
    (v_buyer_b, 'guard-buyer-b@example.test');

  -- handle_new_user() creates the profiles; give them names.
  update public.profiles set display_name = 'Guard Seller', username = 'guard_seller'
    where id = v_seller;
  update public.profiles set display_name = 'Buyer A', username = 'guard_buyer_a'
    where id = v_buyer_a;
  update public.profiles set display_name = 'Buyer B', username = 'guard_buyer_b'
    where id = v_buyer_b;

  insert into public.listings
    (seller_id, title, category, price_cents, shipping_cents, status, currency)
  values
    (v_seller, 'Guard test coilovers', 'suspension', 50000, 1500, 'active', 'USD')
  returning id into v_listing;

  -- ---------- 1. two buyers, one part ----------
  v_result_a := public.purchase_begin(v_buyer_a, array[v_listing], 'test-key-a');
  v_result_b := public.purchase_begin(v_buyer_b, array[v_listing], 'test-key-b');

  if jsonb_array_length(v_result_a -> 'orders') <> 1 then
    raise exception 'FAIL: first buyer should have claimed the listing, got %', v_result_a;
  end if;

  if jsonb_array_length(v_result_b -> 'orders') <> 0 then
    raise exception 'FAIL: DOUBLE SELL — second buyer also claimed the listing: %', v_result_b;
  end if;

  if jsonb_array_length(v_result_b -> 'skipped') <> 1 then
    raise exception 'FAIL: second buyer should have been told the item was unavailable, got %',
      v_result_b;
  end if;

  raise notice 'PASS 1/5: only one buyer claimed the listing; the other was told why';

  -- ---------- 2. the listing is reserved, not sold, before payment ----------
  select status into v_status from public.listings where id = v_listing;
  if v_status <> 'reserved' then
    raise exception 'FAIL: listing should be reserved while payment is in flight, got %', v_status;
  end if;
  raise notice 'PASS 2/5: listing held as reserved during payment';

  -- ---------- 3. idempotent replay ----------
  -- A double-submitted checkout must return the original result, not a second order.
  v_replay := public.purchase_begin(v_buyer_a, array[v_listing], 'test-key-a');
  if v_replay <> v_result_a then
    raise exception 'FAIL: replay with the same idempotency key changed the result: % vs %',
      v_replay, v_result_a;
  end if;

  select count(*) into v_orders from public.orders where buyer_id = v_buyer_a;
  if v_orders <> 1 then
    raise exception 'FAIL: replay created % orders, expected 1', v_orders;
  end if;
  raise notice 'PASS 3/5: replaying an idempotency key returns the first result';

  -- ---------- 4. failure releases the part ----------
  perform public.purchase_finalize(
    (v_result_a -> 'orders' -> 0 ->> 'order_id')::uuid,
    false, 'stub', null, 'card declined'
  );

  select status into v_status from public.listings where id = v_listing;
  if v_status <> 'active' then
    raise exception 'FAIL: a failed payment must return the listing to sale, got %', v_status;
  end if;
  raise notice 'PASS 4/5: failed payment released the reservation';

  -- ---------- 5. success marks it sold and closes rival offers ----------
  insert into public.offers (listing_id, buyer_id, amount_cents, status)
  values (v_listing, v_buyer_b, 40000, 'open');

  v_result_b := public.purchase_begin(v_buyer_b, array[v_listing], 'test-key-b2');
  perform public.purchase_finalize(
    (v_result_b -> 'orders' -> 0 ->> 'order_id')::uuid,
    true, 'stub', 'stub_ref_1', null
  );

  select status into v_status from public.listings where id = v_listing;
  if v_status <> 'sold' then
    raise exception 'FAIL: a successful payment must mark the listing sold, got %', v_status;
  end if;

  select status into v_status from public.offers
    where listing_id = v_listing and buyer_id = v_buyer_b;
  if v_status <> 'expired' then
    raise exception 'FAIL: open offers on a sold listing should expire, got %', v_status;
  end if;
  raise notice 'PASS 5/5: sale recorded and rival offers expired';

  raise notice '--- all purchase-guard checks passed ---';
end $$;

-- Nothing is kept.
rollback;

-- ============================================================================
-- True-concurrency check (optional, two sessions)
--
-- Session 1 and session 2, run simultaneously against the same listing id:
--
--   begin;
--   select public.purchase_begin('<buyer-uuid>', array['<listing-uuid>']::uuid[], null);
--   -- pause here, then in the other session run the same statement
--   commit;
--
-- Expected: whichever session's UPDATE lands first returns an order; the other
-- blocks until the first commits and then returns zero orders with the listing
-- reported as unavailable. Before this migration both sessions returned an
-- order, and one physical part was sold twice.
-- ============================================================================
