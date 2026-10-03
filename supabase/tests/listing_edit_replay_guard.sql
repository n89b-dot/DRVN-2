-- R2-01: a listing edit is identified by its request. A commit whose answer
-- was lost replays to the same outcome; a different edit under the same id is
-- refused; an independent stale edit is still a conflict.
begin;

create function public.listing_replay_test_fail() returns trigger language plpgsql as $$
begin
  if current_setting('drvn.test_listing_replay_failure', true) = 'on' then
    raise exception 'Injected listing edit failure';
  end if;
  return new;
end $$;
create trigger listing_replay_test_fail
  before insert on public.listing_part_numbers
  for each row execute function public.listing_replay_test_fail();

do $$
declare
  seller uuid := gen_random_uuid();
  stranger uuid := gen_random_uuid();
  listing uuid := gen_random_uuid();
  opened_at timestamptz := now() - interval '1 hour';
  req uuid := gen_random_uuid();
  other_req uuid := gen_random_uuid();
  failed_req uuid := gen_random_uuid();
  hash_a text := repeat('a', 64);
  hash_b text := repeat('b', 64);
  saved jsonb;
  replayed jsonb;
  status jsonb;
  v_version timestamptz;
  fields jsonb := jsonb_build_object(
    'source_car_id', null, 'title', 'Edited intake', 'description', null,
    'category', 'performance', 'subcategory', null, 'condition', 'used', 'grade', null,
    'condition_checklist', null, 'price_cents', 9900, 'shipping_cents', 0,
    'shipping_mode', 'flat', 'weight_oz', null, 'length_in', null, 'width_in', null,
    'height_in', null, 'offer_floor_cents', null, 'allows_collection', false,
    'location', null, 'compatibility_notes', null, 'part_number', null,
    'brand', null, 'part_miles', null, 'part_miles_unit', null
  );
  rejected boolean := false;
begin
  update public.beta_access_config set enforced = false where singleton = true;
  insert into auth.users(id, email, raw_user_meta_data) values
    (seller, 'listing-replay-seller@drvn.test', '{}'),
    (stranger, 'listing-replay-stranger@drvn.test', '{}');
  insert into public.listings(id, seller_id, title, category, price_cents, shipping_cents, status, updated_at)
  values (listing, seller, 'Original intake', 'performance', 12000, 0, 'active', opened_at);
  insert into public.listing_images(listing_id, url, position) values (listing, 'https://example.test/a.webp', 0);

  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', seller, 'role', 'authenticated')::text, true);

  -- 1. An edit that fails partway leaves no recorded outcome, and its
  --    request can be retried once the cause is gone.
  perform set_config('drvn.test_listing_replay_failure', 'on', true);
  begin
    perform public.save_listing_edit(failed_req, hash_a, listing, opened_at, fields, null, '[]'::jsonb, '["X"]'::jsonb);
  exception when others then
    rejected := sqlerrm like 'Injected listing edit failure%';
  end;
  perform set_config('drvn.test_listing_replay_failure', 'off', true);
  if not rejected then raise exception 'Injected failure did not abort the edit'; end if;
  rejected := false;
  if (public.listing_edit_status(failed_req, listing)->>'committed')::boolean then
    raise exception 'A rolled-back edit was recorded as committed';
  end if;

  -- 2. The edit commits and records its outcome.
  saved := public.save_listing_edit(req, hash_a, listing, opened_at, fields, null, '[]'::jsonb, '[]'::jsonb);
  v_version := (saved->>'updated_at')::timestamptz;
  if v_version is null or (saved->>'replayed')::boolean then
    raise exception 'First delivery did not edit: %', saved;
  end if;
  status := public.listing_edit_status(req, listing);
  if not (status->>'committed')::boolean or (status->'result'->>'updated_at')::timestamptz <> v_version then
    raise exception 'Committed edit is not visible to the status check: %', status;
  end if;

  -- 3. The answer was lost; the exact retry (still carrying the old version)
  --    recovers the outcome instead of hitting the stale-version check, and
  --    writes nothing again.
  replayed := public.save_listing_edit(req, hash_a, listing, opened_at, fields, null, '[]'::jsonb, '[]'::jsonb);
  if not (replayed->>'replayed')::boolean or (replayed->>'updated_at')::timestamptz <> v_version then
    raise exception 'Exact retry did not replay the committed outcome: %', replayed;
  end if;
  if (select updated_at from public.listings where id = listing) <> v_version then
    raise exception 'Replay wrote the listing again';
  end if;

  -- 4. The same request id with a different payload is refused.
  begin
    perform public.save_listing_edit(req, hash_b, listing, opened_at, fields || '{"price_cents": 1}'::jsonb, null, '[]'::jsonb, '[]'::jsonb);
  exception when invalid_parameter_value then
    rejected := true;
  end;
  if not rejected or (select price_cents from public.listings where id = listing) <> 9900 then
    raise exception 'A changed payload reused a committed request id';
  end if;
  rejected := false;

  -- 5. An independent edit from the old version is still a conflict.
  begin
    perform public.save_listing_edit(other_req, hash_b, listing, opened_at, fields || '{"price_cents": 1}'::jsonb, null, '[]'::jsonb, '[]'::jsonb);
  exception when serialization_failure then
    rejected := true;
  end;
  if not rejected or (select price_cents from public.listings where id = listing) <> 9900 then
    raise exception 'A stale independent edit overwrote a newer save';
  end if;
  rejected := false;

  -- 6. A checkout reserves the part after the edit committed: the lost
  --    answer still replays, but a new edit is refused.
  perform set_config('role', 'postgres', true);
  update public.listings set status = 'reserved', updated_at = v_version where id = listing;
  perform set_config('role', 'authenticated', true);
  replayed := public.save_listing_edit(req, hash_a, listing, opened_at, fields, null, '[]'::jsonb, '[]'::jsonb);
  if not (replayed->>'replayed')::boolean then
    raise exception 'Replay after reservation did not recover the outcome';
  end if;
  begin
    perform public.save_listing_edit(gen_random_uuid(), hash_b, listing, v_version, fields, null, '[]'::jsonb, '[]'::jsonb);
  exception when object_not_in_prerequisite_state then
    rejected := true;
  end;
  if not rejected then raise exception 'A reserved listing accepted a new edit'; end if;
  rejected := false;

  -- 7. A request can't be recorded for a version the listing isn't at.
  begin
    perform public.record_listing_edit(gen_random_uuid(), hash_a, listing, opened_at,
      jsonb_build_object('updated_at', opened_at));
  exception when invalid_parameter_value then
    rejected := true;
  end;
  if not rejected then raise exception 'An outcome was recorded outside its edit'; end if;
  rejected := false;

  -- 8. Another account sees none of it and can't replay into the listing.
  perform set_config('request.jwt.claims', jsonb_build_object('sub', stranger, 'role', 'authenticated')::text, true);
  if (public.listing_edit_status(req, listing)->>'committed')::boolean then
    raise exception 'A stranger can read another seller''s edit outcome';
  end if;
  begin
    perform public.save_listing_edit(req, hash_a, listing, opened_at, fields, null, '[]'::jsonb, '[]'::jsonb);
  exception when no_data_found or object_not_in_prerequisite_state then
    rejected := true;
  end;
  if not rejected then raise exception 'A stranger replayed into another seller''s listing'; end if;
  rejected := false;

  -- 9. A suspended seller's replay is rechecked, not waved through.
  perform set_config('role', 'postgres', true);
  update public.profiles set suspended_at = now(), suspended_reason = 'guard' where id = seller;
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', seller, 'role', 'authenticated')::text, true);
  begin
    perform public.save_listing_edit(req, hash_a, listing, opened_at, fields, null, '[]'::jsonb, '[]'::jsonb);
  exception when insufficient_privilege then
    rejected := true;
  end;
  if not rejected then raise exception 'A suspended seller replayed an edit'; end if;

  perform set_config('role', 'none', true);
  if (select prosecdef from pg_proc where oid = 'public.save_listing_edit(uuid,text,uuid,timestamptz,jsonb,jsonb,jsonb,jsonb)'::regprocedure) then
    raise exception 'Listing edit bypasses row-level security';
  end if;
  if has_function_privilege('anon', 'public.save_listing_edit(uuid,text,uuid,timestamptz,jsonb,jsonb,jsonb,jsonb)', 'execute')
     or has_function_privilege('anon', 'public.listing_edit_status(uuid,uuid)', 'execute')
     or has_table_privilege('authenticated', 'private.listing_edit_requests', 'select') then
    raise exception 'The edit ledger is reachable outside its functions';
  end if;
  raise notice 'all listing edit replay checks passed';
end $$;

rollback;
