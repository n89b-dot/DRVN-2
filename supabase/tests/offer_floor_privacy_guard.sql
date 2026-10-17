-- A seller's offer minimum is readable by that seller only, and lives only in
-- listing_private_terms (A0: expand 20261017120000, switch 20261017130000).
-- listings.offer_floor_cents stays null whatever writes it; the minimum still
-- saves, edits, clears, bounds the price and refuses low offers. The contract
-- step drops the old column and tightens this guard.
begin;

do $$
declare
  seller uuid := gen_random_uuid();
  stranger uuid := gen_random_uuid();
  buyer uuid := gen_random_uuid();
  listing uuid := gen_random_uuid();
  bare uuid := gen_random_uuid();
  created uuid;
  v integer;
  v_version timestamptz;
  denied boolean := false;
  fields jsonb;
  saved jsonb;
begin
  update public.beta_access_config set enforced = false where singleton = true;
  insert into auth.users(id, email) values
    (seller, 'floor-seller@drvn.test'), (stranger, 'floor-stranger@drvn.test'), (buyer, 'floor-buyer@drvn.test');
  insert into public.listings(id, seller_id, title, category, price_cents, shipping_cents, status, offer_floor_cents)
  values
    (listing, seller, 'Floor guard exhaust', 'performance', 50000, 0, 'active', 30000),
    (bare, seller, 'Floor guard no minimum', 'performance', 8000, 0, 'active', null);

  -- 1. A write to the old column lands in the private table; the column stays empty.
  if (select offer_floor_cents from public.listing_private_terms where listing_id = listing) is distinct from 30000 then
    raise exception 'FAIL 1: the minimum was not stored privately on insert';
  end if;
  if (select offer_floor_cents from public.listings where id = listing) is not null then
    raise exception 'FAIL 2: listings.offer_floor_cents still holds the minimum';
  end if;
  if not exists (select 1 from public.listing_private_terms where listing_id = bare and offer_floor_cents is null and seller_id = seller) then
    raise exception 'FAIL 3: a listing without a minimum has no private row';
  end if;

  -- 2. Neither client role holds any privilege on the table or its triggers.
  if has_table_privilege('anon', 'public.listing_private_terms', 'select')
     or has_table_privilege('authenticated', 'public.listing_private_terms', 'select')
     or has_table_privilege('authenticated', 'public.listing_private_terms', 'insert')
     or has_table_privilege('authenticated', 'public.listing_private_terms', 'update')
     or has_table_privilege('authenticated', 'public.listing_private_terms', 'delete') then
    raise exception 'FAIL 4: a client role holds a privilege on listing_private_terms';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.listing_private_terms'::regclass) then
    raise exception 'FAIL 5: row-level security is off on listing_private_terms';
  end if;
  if has_function_privilege('anon', 'public.my_listing_offer_floor(uuid)', 'execute') then
    raise exception 'FAIL 6: guests can call my_listing_offer_floor';
  end if;
  if has_function_privilege('authenticated', 'public.absorb_listing_offer_floor()', 'execute')
     or has_function_privilege('authenticated', 'public.guard_offer_private_floor()', 'execute')
     or has_function_privilege('authenticated', 'public.guard_listing_price_above_floor()', 'execute')
     or has_function_privilege('authenticated', 'public.guard_private_floor_within_price()', 'execute') then
    raise exception 'FAIL 7: members can call a private-floor trigger function';
  end if;
  if to_regproc('public.mirror_listing_private_terms') is not null then
    raise exception 'FAIL 8: the expand step''s mirror trigger function is still installed';
  end if;

  -- 3. A guest can't read it directly, and listings shows nothing.
  perform set_config('role', 'anon', true);
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  begin
    select t.offer_floor_cents into v from public.listing_private_terms t where t.listing_id = listing;
  exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'FAIL 9: a guest read the private minimum'; end if;
  denied := false;
  if exists (select 1 from public.listings where id = listing and offer_floor_cents is not null) then
    raise exception 'FAIL 10: a guest read a minimum from listings';
  end if;

  -- 4. Another member: not directly, not through the owner function, and
  --    can't hijack the private row by inserting a listing with its id.
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', stranger, 'role', 'authenticated')::text, true);
  begin
    select t.offer_floor_cents into v from public.listing_private_terms t where t.listing_id = listing;
  exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'FAIL 11: another member read the private minimum'; end if;
  denied := false;
  if public.my_listing_offer_floor(listing) is not null then
    raise exception 'FAIL 12: my_listing_offer_floor answered a stranger';
  end if;
  insert into public.listings(id, seller_id, title, category, price_cents, shipping_cents, status, offer_floor_cents)
  values (listing, stranger, 'Hijack', 'performance', 50000, 0, 'draft', 100)
  on conflict (id) do nothing;
  perform set_config('role', 'none', true);
  if (select offer_floor_cents || ':' || seller_id::text from public.listing_private_terms where listing_id = listing)
     is distinct from ('30000:' || seller::text) then
    raise exception 'FAIL 13: a conflicting insert rewrote another seller''s private terms';
  end if;

  -- 5. A buyer's low offer is refused without the number; one at the minimum goes through.
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', buyer, 'role', 'authenticated')::text, true);
  begin
    perform public.create_offer_with_message(gen_random_uuid(), listing, 29999, null);
  exception when check_violation then
    denied := sqlerrm not like '%300%' and sqlerrm not like '%299%';
  end;
  if not denied then raise exception 'FAIL 14: a below-minimum offer was not refused, or the refusal named the number'; end if;
  denied := false;
  created := gen_random_uuid();
  perform public.create_offer_with_message(created, listing, 30000, null);
  if not exists (select 1 from public.offers where id = created) then
    raise exception 'FAIL 15: an offer at the minimum was refused';
  end if;

  -- 6. The seller reads, edits and clears their own; other updates leave it alone.
  perform set_config('request.jwt.claims', jsonb_build_object('sub', seller, 'role', 'authenticated')::text, true);
  if public.my_listing_offer_floor(listing) is distinct from 30000 then
    raise exception 'FAIL 16: the seller cannot read their own minimum';
  end if;
  update public.listings set offer_floor_cents = 32000 where id = listing;
  if public.my_listing_offer_floor(listing) is distinct from 32000 then
    raise exception 'FAIL 17: an edit to the minimum was not stored';
  end if;
  update public.listings set title = 'Floor guard exhaust, renamed', price_cents = 49000 where id = listing;
  if public.my_listing_offer_floor(listing) is distinct from 32000 then
    raise exception 'FAIL 18: an unrelated edit changed the minimum';
  end if;
  -- Price and minimum raised together: checked against the new price.
  update public.listings set price_cents = 70000, offer_floor_cents = 60000 where id = listing;
  if public.my_listing_offer_floor(listing) is distinct from 60000 then
    raise exception 'FAIL 19: raising price and minimum together was refused or lost';
  end if;
  -- The bound from both sides.
  begin
    update public.listings set offer_floor_cents = 70001 where id = listing;
  exception when check_violation then denied := true; end;
  if not denied then raise exception 'FAIL 20: a minimum above the price was accepted'; end if;
  denied := false;
  begin
    update public.listings set price_cents = 59999 where id = listing;
  exception when check_violation then denied := true; end;
  if not denied then raise exception 'FAIL 21: the price was cut below the minimum'; end if;
  denied := false;
  update public.listings set offer_floor_cents = null where id = listing;
  if public.my_listing_offer_floor(listing) is not null then
    raise exception 'FAIL 22: clearing the minimum was not stored';
  end if;
  begin
    insert into public.listing_private_terms(listing_id, seller_id, offer_floor_cents) values (bare, seller, 100);
  exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'FAIL 23: a seller wrote the private table directly'; end if;
  denied := false;

  -- 7. The edit function: sets, keeps and clears through the old JSON key.
  select updated_at into v_version from public.listings where id = bare;
  fields := jsonb_build_object(
    'source_car_id', null, 'title', 'Floor guard no minimum', 'description', null,
    'category', 'performance', 'subcategory', null, 'condition', null, 'grade', null,
    'condition_checklist', null, 'price_cents', 8000, 'shipping_cents', 0,
    'shipping_mode', 'flat', 'weight_oz', null, 'length_in', null, 'width_in', null,
    'height_in', null, 'offer_floor_cents', 6000, 'allows_collection', false,
    'location', null, 'compatibility_notes', null, 'part_number', null,
    'brand', null, 'part_miles', null, 'part_miles_unit', null);
  saved := public.update_listing_atomic(bare, v_version, fields, null, '[]'::jsonb, '[]'::jsonb);
  if public.my_listing_offer_floor(bare) is distinct from 6000
     or (select offer_floor_cents from public.listings where id = bare) is not null then
    raise exception 'FAIL 24: update_listing_atomic did not store the minimum privately';
  end if;

  -- 8. Deleting the listing deletes its private terms.
  perform set_config('role', 'none', true);
  delete from public.offers where listing_id = bare;
  delete from public.listings where id = bare;
  if exists (select 1 from public.listing_private_terms where listing_id = bare) then
    raise exception 'FAIL 25: private terms outlived their listing';
  end if;

  -- 9. The old column is empty everywhere and can't be filled; every listing has a private row.
  if exists (select 1 from public.listings where offer_floor_cents is not null) then
    raise exception 'FAIL 26: a listing still holds a public minimum';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'listings_offer_floor_private' and conrelid = 'public.listings'::regclass) then
    raise exception 'FAIL 27: nothing stops listings.offer_floor_cents being filled';
  end if;
  if exists (
    select 1 from public.listings l left join public.listing_private_terms t on t.listing_id = l.id
    where t.listing_id is null or t.seller_id is distinct from l.seller_id
  ) then
    raise exception 'FAIL 28: listing_private_terms is out of step with listings';
  end if;

  raise notice 'all offer floor privacy checks passed';
end $$;

rollback;
