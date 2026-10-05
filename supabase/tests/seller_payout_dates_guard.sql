-- The seller's ledger reads the payout date the database set
-- (20261006100300): a seller sees their own orders' dates and nobody else's,
-- and the date is the stamped one even after the setting has changed.
begin;

do $$
declare
  seller uuid := gen_random_uuid();
  other uuid := gen_random_uuid();
  buyer uuid := gen_random_uuid();
  mine uuid;
  undelivered uuid;
  theirs uuid;
  stamp timestamptz := now() - interval '1 day';
  seen integer;
begin
  -- 1. Signed-in callers only; the table itself stays closed to them.
  if has_function_privilege('anon', 'public.seller_payout_dates(uuid[])', 'execute')
     or not has_function_privilege('authenticated', 'public.seller_payout_dates(uuid[])', 'execute') then
    raise exception 'FAIL 1: seller_payout_dates privileges are wrong';
  end if;
  raise notice 'PASS 1: callable signed in, not signed out';

  insert into auth.users(id, email) values
    (seller, 'dates-seller@example.test'), (other, 'dates-other@example.test'), (buyer, 'dates-buyer@example.test');
  insert into public.orders(buyer_id, seller_id, status, shipped_at, subtotal_cents, platform_fee_cents, total_cents, currency)
  values (buyer, seller, 'shipped', stamp, 5000, 500, 5000, 'USD') returning id into mine;
  insert into public.orders(buyer_id, seller_id, status, shipped_at, subtotal_cents, platform_fee_cents, total_cents, currency)
  values (buyer, seller, 'shipped', stamp, 5000, 500, 5000, 'USD') returning id into undelivered;
  insert into public.orders(buyer_id, seller_id, status, shipped_at, subtotal_cents, platform_fee_cents, total_cents, currency)
  values (buyer, other, 'shipped', stamp, 5000, 500, 5000, 'USD') returning id into theirs;
  insert into public.transfer_intents(order_id, seller_id, amount_cents, currency, status, available_at)
  values (mine, seller, 4500, 'USD', 'holding', null),
         (undelivered, seller, 4500, 'USD', 'holding', null),
         (theirs, other, 4500, 'USD', 'holding', null);

  -- Delivered under a fixed 7-day hold; the setting then moves to the claim
  -- window. The stamped dates must not follow it.
  update public.settlement_settings set payout_hold_days = 7, payout_hold_mode = 'fixed' where id;
  update public.orders set status = 'delivered', delivered_at = stamp where id in (mine, theirs);
  update public.settlement_settings set payout_hold_mode = 'claim_window' where id;

  -- 2. The seller reads the stamped date, not one worked out from today's rule.
  perform set_config('request.jwt.claims', json_build_object('sub', seller, 'role', 'authenticated')::text, true);
  if (select d.available_at from public.seller_payout_dates(array[mine, undelivered, theirs]) d where d.order_id = mine)
     is distinct from stamp + interval '7 days' then
    raise exception 'FAIL 2: the seller did not read the date set at delivery';
  end if;
  raise notice 'PASS 2: the date set at delivery, unmoved by a later setting';

  -- 3. Only their own orders, and only ones that have a date.
  select count(*) into seen from public.seller_payout_dates(array[mine, undelivered, theirs]);
  if seen <> 1 then
    raise exception 'FAIL 3: expected one dated order of the seller''s own, saw %', seen;
  end if;
  raise notice 'PASS 3: another seller''s order and an undated order are absent';

  -- 4. Another member asking about the same orders sees only theirs; a
  --    buyer sees none.
  perform set_config('request.jwt.claims', json_build_object('sub', other, 'role', 'authenticated')::text, true);
  if (select array_agg(d.order_id) from public.seller_payout_dates(array[mine, undelivered, theirs]) d)
     is distinct from array[theirs] then
    raise exception 'FAIL 4: a seller read another seller''s payout date';
  end if;
  perform set_config('request.jwt.claims', json_build_object('sub', buyer, 'role', 'authenticated')::text, true);
  if exists (select 1 from public.seller_payout_dates(array[mine, undelivered, theirs])) then
    raise exception 'FAIL 4: a buyer read a payout date';
  end if;
  perform set_config('request.jwt.claims', '', true);
  if exists (select 1 from public.seller_payout_dates(array[mine, undelivered, theirs])) then
    raise exception 'FAIL 4: a caller with no identity read a payout date';
  end if;
  raise notice 'PASS 4: scoped to the calling seller';

  raise notice 'all seller payout date checks passed';
end $$;

rollback;
