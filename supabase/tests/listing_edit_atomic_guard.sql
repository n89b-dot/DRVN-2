-- RR-05: update_listing_atomic commits a listing edit whole or not at all,
-- refuses a stale version, and keeps every ownership/status rule.
begin;

create function public.listing_edit_test_fail() returns trigger language plpgsql as $$
begin
  if current_setting('drvn.test_listing_edit_failure', true) = 'on' then
    raise exception 'Injected listing edit failure';
  end if;
  return new;
end $$;
create trigger listing_edit_test_fail
  before insert on public.listing_part_numbers
  for each row execute function public.listing_edit_test_fail();

do $$
declare
  seller uuid := gen_random_uuid();
  stranger uuid := gen_random_uuid();
  listing uuid := gen_random_uuid();
  held uuid := gen_random_uuid();
  -- The seller's own listing-photo folder: a member's write may only name
  -- their own uploads (20261107203000).
  img text := 'https://proj.supabase.co/storage/v1/object/public/listing-images/' || seller || '/';
  opened_at timestamptz := now() - interval '1 hour';
  saved jsonb;
  v_version timestamptz;
  fields jsonb := jsonb_build_object(
    'source_car_id', null, 'title', 'Edited intake', 'description', 'New copy',
    'category', 'performance', 'subcategory', null, 'condition', 'used', 'grade', null,
    'condition_checklist', null, 'price_cents', 9900, 'shipping_cents', 1500,
    'shipping_mode', 'flat', 'weight_oz', null, 'length_in', null, 'width_in', null,
    'height_in', null, 'offer_floor_cents', null, 'allows_collection', false,
    'location', null, 'compatibility_notes', null, 'part_number', 'NEW-1',
    'brand', 'Brand', 'part_miles', null, 'part_miles_unit', null
  );
  new_images jsonb := jsonb_build_array(
    jsonb_build_object('url', img || 'keep.webp', 'alt', 'Kept, now first'),
    jsonb_build_object('url', img || 'new.webp', 'alt', null)
  );
  fitments jsonb := jsonb_build_array(
    jsonb_build_object('make', 'Audi', 'model', 'S4', 'year_start', 2018, 'year_end', 2020)
  );
  rejected boolean := false;
begin
  update public.beta_access_config set enforced = false where singleton = true;
  -- Member photo writes need the storage origin recorded (20261107203000).
  insert into public.job_config(key, value) values ('media_storage_origin', 'https://proj.supabase.co')
    on conflict (key) do update set value = excluded.value;
  insert into auth.users(id, email, raw_user_meta_data) values
    (seller, 'listing-edit-seller@drvn.test', '{}'),
    (stranger, 'listing-edit-stranger@drvn.test', '{}');
  insert into public.listings(id, seller_id, title, category, price_cents, shipping_cents, status, updated_at)
  values
    (listing, seller, 'Original intake', 'performance', 12000, 0, 'active', opened_at),
    (held, seller, 'Held part', 'performance', 5000, 0, 'active', opened_at);
  insert into public.listing_images(listing_id, url, alt, position) values
    (listing, img || 'old.webp', 'Old cover', 0),
    (listing, img || 'keep.webp', 'Kept', 1);
  insert into public.listing_fitments(listing_id, make, model) values (listing, 'BMW', 'M3');
  insert into public.listing_part_numbers(listing_id, number) values (listing, 'OLD-ALT');
  -- `held` is reserved by a checkout (trusted writer path).
  update public.listings set status = 'reserved', updated_at = opened_at where id = held;

  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', seller, 'role', 'authenticated')::text, true);

  -- 1. A failure partway through leaves the listing and every child row as they were.
  perform set_config('drvn.test_listing_edit_failure', 'on', true);
  begin
    perform public.update_listing_atomic(listing, opened_at, fields, new_images, fitments, '["ALT-9"]'::jsonb);
  exception when others then
    rejected := sqlerrm like 'Injected listing edit failure%';
  end;
  perform set_config('drvn.test_listing_edit_failure', 'off', true);
  if not rejected then raise exception 'Injected failure did not abort the edit'; end if;
  rejected := false;
  if (select price_cents from public.listings where id = listing) <> 12000
     or (select title from public.listings where id = listing) <> 'Original intake'
     or (select string_agg(url, ',' order by position) from public.listing_images where listing_id = listing)
        <> img || 'old.webp,' || img || 'keep.webp'
     or (select count(*) from public.listing_fitments where listing_id = listing and make = 'BMW') <> 1
     or (select string_agg(number, ',') from public.listing_part_numbers where listing_id = listing) <> 'OLD-ALT' then
    raise exception 'A failed edit left the listing half-saved';
  end if;

  -- 2. A whole edit lands in one step and reports the photo it dropped.
  saved := public.update_listing_atomic(listing, opened_at, fields, new_images, fitments, '["ALT-9"]'::jsonb);
  v_version := (saved->>'updated_at')::timestamptz;
  if v_version is null or v_version = opened_at then
    raise exception 'Edit did not advance the listing version';
  end if;
  if (select price_cents from public.listings where id = listing) <> 9900
     or (select brand from public.listings where id = listing) <> 'Brand'
     or (select string_agg(url || ':' || position, ',' order by position) from public.listing_images where listing_id = listing)
        <> img || 'keep.webp:0,' || img || 'new.webp:1'
     or (select count(*) from public.listing_fitments where listing_id = listing and make = 'Audi') <> 1
     or (select count(*) from public.listing_fitments where listing_id = listing) <> 1
     or (select string_agg(number, ',') from public.listing_part_numbers where listing_id = listing) <> 'ALT-9' then
    raise exception 'Edit did not save every part of the listing';
  end if;
  if saved->'removed_image_urls' <> jsonb_build_array(img || 'old.webp') then
    raise exception 'Edit did not report the dropped photo: %', saved->'removed_image_urls';
  end if;

  -- 3. A second tab still holding the old version gets a conflict, not an overwrite.
  begin
    perform public.update_listing_atomic(listing, opened_at, fields || '{"price_cents": 1}'::jsonb, null, '[]'::jsonb, '[]'::jsonb);
  exception when serialization_failure then
    rejected := true;
  end;
  if not rejected or (select price_cents from public.listings where id = listing) <> 9900 then
    raise exception 'A stale edit overwrote a newer save';
  end if;
  rejected := false;

  -- 4. A null gallery leaves the photos alone; an empty one can't strip a live listing.
  saved := public.update_listing_atomic(listing, v_version, fields || '{"title": "Retitled"}'::jsonb, null, fitments, '[]'::jsonb);
  v_version := (saved->>'updated_at')::timestamptz;
  if (select count(*) from public.listing_images where listing_id = listing) <> 2 then
    raise exception 'An edit without a gallery changed the photos';
  end if;
  begin
    perform public.update_listing_atomic(listing, v_version, fields, '[]'::jsonb, fitments, '[]'::jsonb);
  exception when check_violation then
    rejected := true;
  end;
  if not rejected or (select count(*) from public.listing_images where listing_id = listing) <> 2 then
    raise exception 'A live listing was saved without photos';
  end if;
  rejected := false;

  -- 5. A reserved listing refuses edits.
  begin
    perform public.update_listing_atomic(held, opened_at, fields, null, '[]'::jsonb, '[]'::jsonb);
  exception when object_not_in_prerequisite_state then
    rejected := true;
  end;
  if not rejected or (select price_cents from public.listings where id = held) <> 5000 then
    raise exception 'A reserved listing was edited';
  end if;
  rejected := false;

  -- 6. Someone else can't edit it, even knowing its id and version.
  perform set_config('request.jwt.claims', jsonb_build_object('sub', stranger, 'role', 'authenticated')::text, true);
  begin
    perform public.update_listing_atomic(listing, v_version, fields || '{"price_cents": 1}'::jsonb, null, '[]'::jsonb, '[]'::jsonb);
  exception when no_data_found then
    rejected := true;
  end;
  if not rejected or (select price_cents from public.listings where id = listing) <> 9900 then
    raise exception 'A stranger edited the listing';
  end if;
  rejected := false;

  -- 7. A suspended seller can't edit their own listing.
  perform set_config('role', 'postgres', true);
  update public.profiles set suspended_at = now(), suspended_reason = 'guard' where id = seller;
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', seller, 'role', 'authenticated')::text, true);
  begin
    perform public.update_listing_atomic(listing, v_version, fields, null, '[]'::jsonb, '[]'::jsonb);
  exception when insufficient_privilege then
    rejected := true;
  end;
  if not rejected then raise exception 'A suspended seller edited a listing'; end if;

  perform set_config('role', 'none', true);
  if (select prosecdef from pg_proc where oid = 'public.update_listing_atomic(uuid,timestamptz,jsonb,jsonb,jsonb,jsonb)'::regprocedure) then
    raise exception 'Atomic listing edit bypasses row-level security';
  end if;
  if has_function_privilege('anon', 'public.update_listing_atomic(uuid,timestamptz,jsonb,jsonb,jsonb,jsonb)', 'execute') then
    raise exception 'Anonymous caller can edit a listing';
  end if;
  raise notice 'all listing edit atomicity checks passed';
end $$;

rollback;
