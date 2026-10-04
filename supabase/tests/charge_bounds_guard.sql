-- Every charge is one Stripe can make, a provider-refused request frees its
-- parts, and money is in one currency (20261004130000).
begin;
do $$
declare
  buyer uuid := gen_random_uuid();
  seller uuid := gen_random_uuid();
  draft uuid; legacy uuid; big_a uuid; big_b uuid; small uuid; cheap uuid; normal uuid;
  offer_id uuid; oid uuid; r jsonb; rejected boolean := false;
begin
  insert into auth.users(id, email) values
    (buyer, 'bounds-buyer@example.test'), (seller, 'bounds-seller@example.test');

  -- 1. Listing prices: a draft may hold any price; publishing needs a chargeable one.
  insert into public.listings(seller_id, title, category, price_cents, status, currency)
  values (seller, 'Bounds draft', 'engine', 0, 'draft', 'USD') returning id into draft;
  begin
    update public.listings set status = 'active' where id = draft;
  exception when numeric_value_out_of_range then rejected := true;
  end;
  if not rejected then raise exception 'A $0 draft was published'; end if;
  rejected := false;
  begin
    insert into public.listings(seller_id, title, category, price_cents, status, currency)
    values (seller, 'Bounds 49c', 'engine', 49, 'active', 'USD');
  exception when numeric_value_out_of_range then rejected := true;
  end;
  if not rejected then raise exception 'A 49c listing went live'; end if;
  rejected := false;
  begin
    insert into public.listings(seller_id, title, category, price_cents, status, currency)
    values (seller, 'Bounds max+1', 'engine', 100000000, 'active', 'USD');
  exception when numeric_value_out_of_range then rejected := true;
  end;
  if not rejected then raise exception 'A listing above Stripe''s maximum went live'; end if;
  rejected := false;
  insert into public.listings(seller_id, title, category, price_cents, status, currency)
  values (seller, 'Bounds 50c', 'engine', 50, 'active', 'USD') returning id into small;
  begin
    update public.listings set price_cents = 10 where id = small;
  exception when numeric_value_out_of_range then rejected := true;
  end;
  if not rejected or (select price_cents from public.listings where id = small) <> 50 then
    raise exception 'A live price was lowered below the minimum';
  end if;
  rejected := false;

  -- A legacy $0 row (written before the bound) can still be paused; it can't be bought.
  perform set_config('session_replication_role', 'replica', true);
  insert into public.listings(seller_id, title, category, price_cents, status, currency)
  values (seller, 'Bounds legacy', 'engine', 0, 'active', 'USD') returning id into legacy;
  perform set_config('session_replication_role', 'origin', true);
  update public.listings set title = 'Bounds legacy renamed' where id = legacy;
  begin
    perform public.purchase_begin(buyer, array[legacy], 'bounds:legacy');
  exception when numeric_value_out_of_range then rejected := true;
  end;
  if not rejected then raise exception 'A $0 basket was reserved'; end if;
  rejected := false;
  if (select status from public.listings where id = legacy) <> 'active'
     or exists (select 1 from public.purchase_attempts where idempotency_key = 'bounds:legacy')
     or exists (select 1 from public.orders where buyer_id = buyer) then
    raise exception 'A refused basket left a reservation, attempt or order behind';
  end if;
  update public.listings set status = 'paused' where id = legacy;

  -- 2. Baskets: the bound is on the sum, checked before anything is reserved.
  insert into public.listings(seller_id, title, category, price_cents, status, currency)
  values (seller, 'Bounds big A', 'engine', 60000000, 'active', 'USD') returning id into big_a;
  insert into public.listings(seller_id, title, category, price_cents, status, currency)
  values (seller, 'Bounds big B', 'engine', 60000000, 'active', 'USD') returning id into big_b;
  begin
    perform public.purchase_begin(buyer, array[big_a, big_b], 'bounds:big');
  exception when numeric_value_out_of_range then rejected := true;
  end;
  if not rejected then raise exception 'A basket above Stripe''s maximum was reserved'; end if;
  rejected := false;
  if exists (select 1 from public.listings where id in (big_a, big_b) and status <> 'active')
     or exists (select 1 from public.orders where buyer_id = buyer) then
    raise exception 'An over-maximum basket left a reservation or order behind';
  end if;
  r := public.purchase_begin(buyer, array[small], 'bounds:small');
  if jsonb_array_length(r->'orders') <> 1 or (r->'orders'->0->>'total_cents')::int <> 50 then
    raise exception 'A basket at exactly the minimum was refused: %', r;
  end if;

  -- 3. Accepted offers: price + shipping must be chargeable before the part is held.
  insert into public.listings(seller_id, title, category, price_cents, status, currency)
  values (seller, 'Bounds offer', 'engine', 1000, 'active', 'USD') returning id into cheap;
  insert into public.offers(listing_id, buyer_id, amount_cents, status)
  values (cheap, buyer, 30, 'open') returning id into offer_id;
  begin
    perform public.offer_accept_begin(offer_id, seller);
  exception when numeric_value_out_of_range then rejected := true;
  end;
  if not rejected then raise exception 'A 30c accepted offer reserved the part'; end if;
  rejected := false;
  if (select status from public.listings where id = cheap) <> 'active'
     or (select status from public.offers where id = offer_id) <> 'open' then
    raise exception 'A refused accept changed the listing or the offer';
  end if;

  -- 4. Currency is USD, for new listings, edits and orders.
  begin
    insert into public.listings(seller_id, title, category, price_cents, status, currency)
    values (seller, 'Bounds pounds', 'engine', 1000, 'draft', 'GBP');
  exception when check_violation then rejected := true;
  end;
  if not rejected then raise exception 'A GBP listing was saved'; end if;
  rejected := false;
  begin
    update public.listings set currency = 'EUR' where id = cheap;
  exception when check_violation then rejected := true;
  end;
  if not rejected then raise exception 'A listing''s currency was changed'; end if;
  rejected := false;
  begin
    insert into public.orders(buyer_id, seller_id, status, subtotal_cents, total_cents, currency)
    values (buyer, seller, 'pending', 1000, 1000, 'GBP');
  exception when check_violation then rejected := true;
  end;
  if not rejected then raise exception 'A GBP order was saved'; end if;
  rejected := false;
  if not exists (select 1 from pg_constraint where conname = 'listings_currency_usd' and convalidated)
     or not exists (select 1 from pg_constraint where conname = 'orders_currency_usd' and convalidated) then
    raise exception 'Currency constraints were not validated on a clean database';
  end if;

  raise notice 'charge_bounds_guard: all bounds and currency checks passed';
end $$;

do $$
declare
  buyer uuid := gen_random_uuid();
  seller uuid := gen_random_uuid();
  listing uuid; held uuid; oid uuid; held_order uuid; r jsonb; saved jsonb;
  job uuid; lease uuid := gen_random_uuid(); rejected boolean := false;
begin
  insert into auth.users(id, email) values
    (buyer, 'reject-buyer@example.test'), (seller, 'reject-seller@example.test');

  -- 5. A request Stripe refused is released at once, and never sent again.
  insert into public.listings(seller_id, title, category, price_cents, status, currency)
  values (seller, 'Rejected request', 'engine', 1000, 'active', 'USD') returning id into listing;
  r := public.purchase_begin(buyer, array[listing], 'reject:fixture');
  oid := (r->'orders'->0->>'order_id')::uuid;
  perform public.prepare_payment_request('reject:request', jsonb_build_object('orderIds', jsonb_build_array(oid)));
  r := public.record_payment_request_rejection('reject:request', 'amount_too_small');
  if (r->>'released')::int <> 1 then raise exception 'Rejection did not release the order: %', r; end if;
  if (select status from public.orders where id = oid) <> 'payment_failed'
     or (select status from public.listings where id = listing) <> 'active' then
    raise exception 'A rejected request kept the part reserved';
  end if;
  saved := public.prepare_payment_request('reject:request', jsonb_build_object('orderIds', jsonb_build_array(oid)));
  if not (saved->>'rejected')::boolean then raise exception 'A retry did not see the rejection'; end if;
  if exists (select 1 from jsonb_array_elements(public.claim_unmapped_payment_requests()) c
             where c->>'operation_key' = 'reject:request') then
    raise exception 'The reconciler searched the provider for a rejected request';
  end if;

  -- 6. Never released when a PaymentIntent may exist.
  insert into public.listings(seller_id, title, category, price_cents, status, currency)
  values (seller, 'Referenced request', 'engine', 1000, 'active', 'USD') returning id into held;
  r := public.purchase_begin(buyer, array[held], 'reject:held');
  held_order := (r->'orders'->0->>'order_id')::uuid;
  perform public.prepare_payment_request('reject:held', jsonb_build_object('orderIds', jsonb_build_array(held_order)));
  perform public.record_payment_reference('reject:held', 'pi_reject_guard');
  begin
    perform public.record_payment_request_rejection('reject:held', 'amount_too_small');
  exception when object_not_in_prerequisite_state then rejected := true;
  end;
  if not rejected then raise exception 'A referenced request was marked rejected'; end if;
  rejected := false;
  if (select status from public.orders where id = held_order) <> 'pending'
     or (select status from public.listings where id = held) <> 'reserved' then
    raise exception 'A possible PaymentIntent''s reservation was released';
  end if;

  -- 7. Expiry treats a rejected request as no provider creation.
  update public.listings set status = 'active', reserved_until = null where id = held;
  r := public.purchase_begin(buyer, array[held], 'reject:expiry');
  oid := (r->'orders'->0->>'order_id')::uuid;
  perform public.prepare_payment_request('reject:expiry', jsonb_build_object('orderIds', jsonb_build_array(oid)));
  update public.payment_requests set provider_rejected_at = now() where operation_key = 'reject:expiry';
  update public.listings set reserved_until = now() - interval '1 minute' where id = held;
  perform public.release_expired_reservations();
  select id into job from public.remediation_jobs where dedup_key = 'expiry:' || oid;
  update public.remediation_jobs set status = 'processing', lease_id = lease, locked_until = now() + interval '2 minutes' where id = job;
  perform public.finish_reservation_expiry(job, lease, null);
  if (select status from public.listings where id = held) <> 'active' then
    raise exception 'Expiry kept a rejected request''s part reserved';
  end if;

  if has_function_privilege('authenticated', 'public.record_payment_request_rejection(text,text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.record_payment_request_rejection(text,text)', 'EXECUTE') then
    raise exception 'Clients can mark payment requests rejected';
  end if;

  raise notice 'charge_bounds_guard: all rejection checks passed';
end $$;
rollback;
