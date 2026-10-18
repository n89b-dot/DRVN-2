-- A seller's offer minimum is readable by that seller only, and lives only in
-- listing_private_terms (A0: expand 20261017120000, switch 20261017130000,
-- contract 20261019120000). listings has no minimum column; the seller sets
-- it through set_listing_offer_floor (directly, or through the sell and edit
-- functions); it bounds the price from both sides and refuses low offers
-- without naming the number. The old paths (the column, the absorb trigger,
-- the set_config skip, the offer-insert trigger) are gone.
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
  r jsonb;
begin
  update public.beta_access_config set enforced = false where singleton = true;
  insert into auth.users(id, email) values
    (seller, 'floor-seller@drvn.test'), (stranger, 'floor-stranger@drvn.test'), (buyer, 'floor-buyer@drvn.test');
  insert into public.listings(id, seller_id, title, category, price_cents, shipping_cents, status)
  values
    (listing, seller, 'Floor guard exhaust', 'performance', 50000, 0, 'active'),
    (bare, seller, 'Floor guard no minimum', 'performance', 8000, 0, 'active');

  -- 1. The seller sets the minimum through the setter; listings has nowhere to hold it.
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', seller, 'role', 'authenticated')::text, true);
  perform public.set_listing_offer_floor(listing, 30000);
  perform set_config('role', 'none', true);
  if (select offer_floor_cents || ':' || seller_id::text from public.listing_private_terms where listing_id = listing)
     is distinct from ('30000:' || seller::text) then
    raise exception 'FAIL 1: the setter did not store the minimum privately';
  end if;
  if exists (select 1 from pg_attribute where attrelid = 'public.listings'::regclass and attname = 'offer_floor_cents' and not attisdropped) then
    raise exception 'FAIL 2: listings.offer_floor_cents still exists';
  end if;
  if exists (select 1 from public.listing_private_terms where listing_id = bare) then
    raise exception 'FAIL 3: a listing nobody set a minimum on got a private row';
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
  if has_function_privilege('anon', 'public.my_listing_offer_floor(uuid)', 'execute')
     or has_function_privilege('anon', 'public.set_listing_offer_floor(uuid,integer)', 'execute') then
    raise exception 'FAIL 6: guests can read or set a minimum';
  end if;
  if has_function_privilege('authenticated', 'public.guard_listing_price_above_floor()', 'execute')
     or has_function_privilege('authenticated', 'public.guard_private_floor_within_price()', 'execute') then
    raise exception 'FAIL 7: members can call a private-floor trigger function';
  end if;
  if to_regproc('public.mirror_listing_private_terms') is not null
     or to_regproc('public.absorb_listing_offer_floor') is not null
     or to_regproc('public.guard_offer_private_floor') is not null
     or exists (select 1 from pg_trigger where tgname in ('listings_zz1_absorb_offer_floor', 'offers_guard_private_floor', 'listings_mirror_private_terms')) then
    raise exception 'FAIL 8: a retired minimum trigger or its function is still installed';
  end if;

  -- 3. A guest can't read it directly.
  perform set_config('role', 'anon', true);
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  begin
    select t.offer_floor_cents into v from public.listing_private_terms t where t.listing_id = listing;
  exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'FAIL 9: a guest read the private minimum'; end if;
  denied := false;
  begin
    perform public.set_listing_offer_floor(listing, 100);
  exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'FAIL 10: a guest called the setter'; end if;
  denied := false;

  -- 4. Another member: not directly, not through the owner function, and
  --    can't set it through the setter.
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
  begin
    perform public.set_listing_offer_floor(listing, 100);
  exception when no_data_found then denied := true; end;
  perform set_config('role', 'none', true);
  if not denied or (select offer_floor_cents from public.listing_private_terms where listing_id = listing) is distinct from 30000 then
    raise exception 'FAIL 13: another member set a seller''s minimum';
  end if;
  denied := false;

  -- 5. A buyer's low offer is declined without the number; one at the minimum goes
  --    through; a direct insert is refused outright.
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', buyer, 'role', 'authenticated')::text, true);
  r := public.offer_open(gen_random_uuid(), listing, 29999, null);
  if r->>'outcome' is distinct from 'below_minimum' or (r - 'offer_id')::text like '%300%' then
    raise exception 'FAIL 14: a below-minimum offer was not declined, or the answer named the number (%)', r;
  end if;
  begin
    insert into public.offers(listing_id, buyer_id, amount_cents, status) values (listing, buyer, 29000, 'open');
  exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'FAIL 15: a member inserted an offer directly'; end if;
  denied := false;
  created := gen_random_uuid();
  r := public.offer_open(created, listing, 30000, null);
  if r->>'outcome' is distinct from 'sent' or not exists (select 1 from public.offers where id = created and status = 'open') then
    raise exception 'FAIL 16: an offer at the minimum was refused (%)', r;
  end if;

  -- 6. The seller reads, edits and clears their own; other updates leave it alone.
  perform set_config('request.jwt.claims', jsonb_build_object('sub', seller, 'role', 'authenticated')::text, true);
  if public.my_listing_offer_floor(listing) is distinct from 30000 then
    raise exception 'FAIL 17: the seller cannot read their own minimum';
  end if;
  perform public.set_listing_offer_floor(listing, 32000);
  update public.listings set title = 'Floor guard exhaust, renamed', price_cents = 49000 where id = listing;
  if public.my_listing_offer_floor(listing) is distinct from 32000 then
    raise exception 'FAIL 18: an edit to the minimum was lost, or an unrelated edit changed it';
  end if;
  -- The bound from both sides, and from the service role's side.
  begin
    perform public.set_listing_offer_floor(listing, 49001);
  exception when check_violation then denied := true; end;
  if not denied then raise exception 'FAIL 19: a minimum above the price was accepted'; end if;
  denied := false;
  begin
    perform public.set_listing_offer_floor(listing, 0);
  exception when check_violation then denied := true; end;
  if not denied then raise exception 'FAIL 20: a zero minimum was accepted'; end if;
  denied := false;
  begin
    update public.listings set price_cents = 31999 where id = listing;
  exception when check_violation then denied := true; end;
  if not denied then raise exception 'FAIL 21: the price was cut below the minimum'; end if;
  denied := false;
  perform set_config('role', 'none', true);
  begin
    update public.listing_private_terms set offer_floor_cents = 49001 where listing_id = listing;
  exception when check_violation then denied := true; end;
  if not denied then raise exception 'FAIL 22: a direct write above the price was accepted'; end if;
  denied := false;
  perform set_config('role', 'authenticated', true);
  perform public.set_listing_offer_floor(listing, null);
  if public.my_listing_offer_floor(listing) is not null then
    raise exception 'FAIL 23: clearing the minimum was not stored';
  end if;
  begin
    insert into public.listing_private_terms(listing_id, seller_id, offer_floor_cents) values (bare, seller, 100);
  exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'FAIL 24: a seller wrote the private table directly'; end if;
  denied := false;

  -- 7. The edit function, through the same JSON key: sets; raises price and minimum
  --    together; lowers both together; refuses a minimum above the new price; clears.
  fields := jsonb_build_object(
    'source_car_id', null, 'title', 'Floor guard no minimum', 'description', null,
    'category', 'performance', 'subcategory', null, 'condition', null, 'grade', null,
    'condition_checklist', null, 'price_cents', 8000, 'shipping_cents', 0,
    'shipping_mode', 'flat', 'weight_oz', null, 'length_in', null, 'width_in', null,
    'height_in', null, 'offer_floor_cents', 6000, 'allows_collection', false,
    'location', null, 'compatibility_notes', null, 'part_number', null,
    'brand', null, 'part_miles', null, 'part_miles_unit', null);
  select updated_at into v_version from public.listings where id = bare;
  saved := public.update_listing_atomic(bare, v_version, fields, null, '[]'::jsonb, '[]'::jsonb);
  if public.my_listing_offer_floor(bare) is distinct from 6000 then
    raise exception 'FAIL 25: update_listing_atomic did not store the minimum privately';
  end if;
  fields := fields || jsonb_build_object('price_cents', 20000, 'offer_floor_cents', 15000);
  saved := public.update_listing_atomic(bare, (saved->>'updated_at')::timestamptz, fields, null, '[]'::jsonb, '[]'::jsonb);
  if public.my_listing_offer_floor(bare) is distinct from 15000 then
    raise exception 'FAIL 26: raising price and minimum together was refused or lost';
  end if;
  fields := fields || jsonb_build_object('price_cents', 7000, 'offer_floor_cents', 5000);
  saved := public.update_listing_atomic(bare, (saved->>'updated_at')::timestamptz, fields, null, '[]'::jsonb, '[]'::jsonb);
  if public.my_listing_offer_floor(bare) is distinct from 5000
     or (select price_cents from public.listings where id = bare) <> 7000 then
    raise exception 'FAIL 27: lowering price and minimum together was refused or lost';
  end if;
  begin
    perform public.update_listing_atomic(bare, (saved->>'updated_at')::timestamptz,
      fields || jsonb_build_object('price_cents', 6000, 'offer_floor_cents', 6500), null, '[]'::jsonb, '[]'::jsonb);
  exception when check_violation then denied := true; end;
  if not denied or public.my_listing_offer_floor(bare) is distinct from 5000 then
    raise exception 'FAIL 28: an edit put the minimum above the new price';
  end if;
  denied := false;
  saved := public.update_listing_atomic(bare, (saved->>'updated_at')::timestamptz,
    fields || jsonb_build_object('offer_floor_cents', null), null, '[]'::jsonb, '[]'::jsonb);
  if public.my_listing_offer_floor(bare) is not null then
    raise exception 'FAIL 29: update_listing_atomic did not clear the minimum';
  end if;

  -- 8. The sell function stores it privately; a retry leaves it to the replay check.
  saved := public.save_listing_creation(gen_random_uuid(), repeat('f', 64),
    fields || jsonb_build_object('title', 'Floor guard new part', 'price_cents', 9000,
      'offer_floor_cents', 7000, 'status', 'draft'),
    '[]'::jsonb, '[]'::jsonb, '[]'::jsonb);
  created := (saved->>'listing_id')::uuid;
  if public.my_listing_offer_floor(created) is distinct from 7000 then
    raise exception 'FAIL 30: save_listing_creation did not store the minimum privately';
  end if;
  begin
    perform public.save_listing_creation(gen_random_uuid(), repeat('e', 64),
      fields || jsonb_build_object('title', 'Floor guard too high', 'price_cents', 9000, 'offer_floor_cents', 9001, 'status', 'draft'),
      '[]'::jsonb, '[]'::jsonb, '[]'::jsonb);
  exception when check_violation then denied := true; end;
  if not denied then raise exception 'FAIL 31: a new listing saved a minimum above its price'; end if;
  denied := false;

  -- 9. A sold, reserved or removed listing's minimum can't change.
  perform set_config('role', 'none', true);
  update public.listings set status = 'removed' where id = created;
  perform set_config('role', 'authenticated', true);
  begin
    perform public.set_listing_offer_floor(created, 6000);
  exception when object_not_in_prerequisite_state then denied := true; end;
  if not denied then raise exception 'FAIL 32: a removed listing''s minimum changed'; end if;
  denied := false;

  -- 10. Deleting the listing deletes its private terms.
  perform set_config('role', 'none', true);
  delete from public.offers where listing_id = bare;
  delete from public.listings where id = bare;
  if exists (select 1 from public.listing_private_terms where listing_id = bare) then
    raise exception 'FAIL 33: private terms outlived their listing';
  end if;

  -- 11. The private table follows its listing: no deferred key, no skip setting, same seller.
  if (select condeferrable from pg_constraint where conname = 'listing_private_terms_listing_id_fkey') then
    raise exception 'FAIL 34: the private table''s foreign key is still deferred';
  end if;
  if exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and prosrc like '%floor_checked_listing%') then
    raise exception 'FAIL 35: a function still reads or sets the drvn.floor_checked_listing skip';
  end if;
  if exists (
    select 1 from public.listing_private_terms t join public.listings l on l.id = t.listing_id
    where t.seller_id is distinct from l.seller_id
  ) then
    raise exception 'FAIL 36: listing_private_terms is out of step with listings';
  end if;

  -- 12. Showing the minimum is the seller's choice, off by default (O-3, 20261018100000).
  perform set_config('role', 'anon', true);
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  if public.listing_public_offer_floor(listing) is not null then
    raise exception 'FAIL 37: a minimum shows on the listing without the seller choosing to';
  end if;
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', seller, 'role', 'authenticated')::text, true);
  update public.listings set show_offer_floor = true where id = listing;
  perform public.set_listing_offer_floor(listing, 33000);
  perform set_config('role', 'anon', true);
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  if public.listing_public_offer_floor(listing) is distinct from 33000 then
    raise exception 'FAIL 38: a minimum the seller chose to show isn''t shown, or is stale';
  end if;
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', seller, 'role', 'authenticated')::text, true);
  update public.listings set show_offer_floor = false where id = listing;
  perform set_config('role', 'anon', true);
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  if public.listing_public_offer_floor(listing) is not null then
    raise exception 'FAIL 39: a hidden minimum still shows';
  end if;
  perform set_config('role', 'none', true);

  raise notice 'all offer floor privacy checks passed';
end $$;

rollback;
