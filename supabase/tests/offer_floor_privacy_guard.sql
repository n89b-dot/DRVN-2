-- A seller's offer minimum is readable by that seller only (A0 expand step,
-- 20261017120000). The private copy stays equal to listings.offer_floor_cents
-- on every write until the contract step drops the old column; the switch and
-- contract steps tighten this guard to cover listings and every RPC.
begin;

do $$
declare
  seller uuid := gen_random_uuid();
  stranger uuid := gen_random_uuid();
  listing uuid := gen_random_uuid();
  bare uuid := gen_random_uuid();
  v integer;
  denied boolean := false;
begin
  update public.beta_access_config set enforced = false where singleton = true;
  insert into auth.users(id, email) values
    (seller, 'floor-seller@drvn.test'), (stranger, 'floor-stranger@drvn.test');
  insert into public.listings(id, seller_id, title, category, price_cents, shipping_cents, status, offer_floor_cents)
  values
    (listing, seller, 'Floor guard exhaust', 'performance', 50000, 0, 'active', 30000),
    (bare, seller, 'Floor guard no minimum', 'performance', 8000, 0, 'active', null);

  -- 1. Every listing has a private row, equal to the old column.
  if (select offer_floor_cents from public.listing_private_terms where listing_id = listing) is distinct from 30000 then
    raise exception 'FAIL 1: the minimum was not copied on insert';
  end if;
  if not exists (select 1 from public.listing_private_terms where listing_id = bare and offer_floor_cents is null and seller_id = seller) then
    raise exception 'FAIL 2: a listing without a minimum has no private row';
  end if;

  -- 2. Neither client role holds any privilege on the table.
  if has_table_privilege('anon', 'public.listing_private_terms', 'select')
     or has_table_privilege('authenticated', 'public.listing_private_terms', 'select')
     or has_table_privilege('authenticated', 'public.listing_private_terms', 'insert')
     or has_table_privilege('authenticated', 'public.listing_private_terms', 'update')
     or has_table_privilege('authenticated', 'public.listing_private_terms', 'delete') then
    raise exception 'FAIL 3: a client role holds a privilege on listing_private_terms';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.listing_private_terms'::regclass) then
    raise exception 'FAIL 4: row-level security is off on listing_private_terms';
  end if;
  if has_function_privilege('anon', 'public.my_listing_offer_floor(uuid)', 'execute') then
    raise exception 'FAIL 5: guests can call my_listing_offer_floor';
  end if;
  if has_function_privilege('authenticated', 'public.mirror_listing_private_terms()', 'execute') then
    raise exception 'FAIL 6: members can call the mirror trigger function';
  end if;

  -- 3. A guest can't read it directly.
  perform set_config('role', 'anon', true);
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  begin
    select t.offer_floor_cents into v from public.listing_private_terms t where t.listing_id = listing;
  exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'FAIL 7: a guest read the private minimum'; end if;
  denied := false;

  -- 4. Another member: not directly, not through the owner function.
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', stranger, 'role', 'authenticated')::text, true);
  begin
    select t.offer_floor_cents into v from public.listing_private_terms t where t.listing_id = listing;
  exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'FAIL 8: another member read the private minimum'; end if;
  denied := false;
  if public.my_listing_offer_floor(listing) is not null then
    raise exception 'FAIL 9: my_listing_offer_floor answered a stranger';
  end if;

  -- 5. The seller reads their own, and their edits flow through.
  perform set_config('request.jwt.claims', jsonb_build_object('sub', seller, 'role', 'authenticated')::text, true);
  if public.my_listing_offer_floor(listing) is distinct from 30000 then
    raise exception 'FAIL 10: the seller cannot read their own minimum';
  end if;
  update public.listings set offer_floor_cents = 32000 where id = listing;
  if public.my_listing_offer_floor(listing) is distinct from 32000 then
    raise exception 'FAIL 11: an edit to the minimum was not mirrored';
  end if;
  update public.listings set offer_floor_cents = null where id = listing;
  if public.my_listing_offer_floor(listing) is not null then
    raise exception 'FAIL 12: clearing the minimum was not mirrored';
  end if;
  update public.listings set offer_floor_cents = 31000 where id = listing;
  begin
    insert into public.listing_private_terms(listing_id, seller_id, offer_floor_cents) values (bare, seller, 100);
  exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'FAIL 13: a seller wrote the private table directly'; end if;
  denied := false;

  -- 6. Deleting the listing deletes its private terms.
  perform set_config('role', 'none', true);
  delete from public.listings where id = bare;
  if exists (select 1 from public.listing_private_terms where listing_id = bare) then
    raise exception 'FAIL 14: private terms outlived their listing';
  end if;

  -- 7. Nothing is out of step across the whole table (backfill included).
  if exists (
    select 1 from public.listings l
    left join public.listing_private_terms t on t.listing_id = l.id
    where t.listing_id is null
       or t.offer_floor_cents is distinct from l.offer_floor_cents
       or t.seller_id is distinct from l.seller_id
  ) then
    raise exception 'FAIL 15: listing_private_terms is out of step with listings';
  end if;

  raise notice 'all offer floor privacy checks passed';
end $$;

rollback;
