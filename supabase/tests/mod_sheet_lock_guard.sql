-- OS-W23 follow-up (GPT review of #105), migration 20261108110200.
--   1  unlinking a listing is one revision-checked call; an editor can't adopt
--      a revision that includes a line it never loaded
--   2  every write to mod_items takes the sheet's lock and moves the revision
--   3  a lost save is recognised only when every saved field matches
--   4  a member can't move a photo or pin into another (full) car
begin;

do $$
declare
  owner_id uuid := gen_random_uuid();
  stranger uuid := gen_random_uuid();
  car uuid := gen_random_uuid();
  spare_car uuid := gen_random_uuid();
  listing uuid := gen_random_uuid();
  line_a uuid := gen_random_uuid();
  line_b uuid := gen_random_uuid();
  line_c uuid := gen_random_uuid();
  priced uuid := gen_random_uuid();
  photo text;
  spare_photo uuid;
  spare_pin uuid;
  sheet jsonb;
  r1 text;
  r2 text;
  r3 text;
  result jsonb;
  refused boolean;
  src text;
begin
  insert into public.job_config(key, value) values ('media_storage_origin', 'https://media.drvn.test')
    on conflict (key) do update set value = excluded.value;
  insert into auth.users(id, email, raw_user_meta_data) values
    (owner_id, 'w23f-owner@drvn.test', '{}'),
    (stranger, 'w23f-stranger@drvn.test', '{}');
  insert into public.cars(id, owner_id, slug, name, is_public) values
    (car, owner_id, 'w23f-car', 'W23 follow-up build', true),
    (spare_car, owner_id, 'w23f-spare', 'W23 follow-up second car', true);
  insert into public.listings(id, seller_id, title, category, price_cents, status) values
    (listing, owner_id, 'W23 released intake', 'performance', 10000, 'active');
  -- A part that came off carries the date it came off
  -- (mod_items_removed_at_agrees_check).
  insert into public.mod_items(id, car_id, group_label, brand, product, raw_text, position, status, removed_at, linked_listing_id) values
    (line_a, car, 'Engine', 'HKS', 'Intake', 'HKS Intake', 0, 'removed', now(), listing),
    (line_b, car, 'Wheels', 'Volk', 'TE37', 'Volk TE37', 1, 'installed', null, null);
  photo := 'https://media.drvn.test/storage/v1/object/public/car-images/' || owner_id || '/one.jpg';

  -- ---------- 2: the lock is on every write path ----------
  if to_regprocedure('private.mod_sheet_lock()') is null
     or to_regprocedure('public.unlink_mod_listing(uuid,uuid,text)') is null then
    raise exception 'FAIL 0: the sheet lock trigger or the unlink function is missing';
  end if;
  if not exists (
    select 1 from pg_trigger t
     where t.tgrelid = 'public.mod_items'::regclass
       and t.tgname = 'aa_mod_sheet_lock'
       and not t.tgisinternal
       and t.tgenabled <> 'D'
       and t.tgfoid = 'private.mod_sheet_lock()'::regprocedure
       -- row (1) + before (2) + insert (4) + delete (8) + update (16)
       and t.tgtype & 31 = 31
  ) then
    raise exception 'FAIL 1: mod_items writes do not all take the sheet lock';
  end if;
  if (select min(t.tgname) from pg_trigger t
       where t.tgrelid = 'public.mod_items'::regclass and not t.tgisinternal and t.tgtype & 3 = 3)
     is distinct from 'aa_mod_sheet_lock' then
    raise exception 'FAIL 2: another row trigger on mod_items runs before the sheet lock';
  end if;
  select prosrc into src from pg_proc where oid = 'private.mod_sheet_lock()'::regprocedure;
  if position('from public.cars c' in src) = 0 or position('for no key update' in src) = 0
     or not (select prosecdef from pg_proc where oid = 'private.mod_sheet_lock()'::regprocedure) then
    raise exception 'FAIL 3: the sheet lock is not the car row, taken whatever the writer''s grants';
  end if;
  if has_function_privilege('anon', 'public.unlink_mod_listing(uuid,uuid,text)', 'execute') then
    raise exception 'FAIL 4: visitors can unlink build lines';
  end if;

  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', owner_id, 'role', 'authenticated')::text, true);

  -- A direct write moves the revision on even when it writes a value back
  -- unchanged, so nothing a second screen does can hide from the check.
  r1 := public.mod_sheet_revision(car);
  update public.mod_items set product = product where id = line_b;
  if public.mod_sheet_revision(car) = r1 then
    raise exception 'FAIL 5: a direct write to a line left the sheet revision unchanged';
  end if;

  -- ---------- 1: unlink is one locked, revision-checked call ----------
  -- The editor loads the sheet at r1 (A linked, B).
  r1 := public.mod_sheet_revision(car);
  -- Another tab adds line C.
  result := public.save_mod_items(car, jsonb_build_array(
    jsonb_build_object('id', line_a, 'group_label', 'Engine', 'brand', 'HKS', 'product', 'Intake', 'raw_text', 'HKS Intake', 'status', 'removed'),
    jsonb_build_object('id', line_b, 'group_label', 'Wheels', 'brand', 'Volk', 'product', 'TE37', 'raw_text', 'Volk TE37'),
    jsonb_build_object('id', line_c, 'group_label', 'Brakes', 'brand', 'Brembo', 'product', 'GT kit', 'raw_text', 'Brembo GT kit')
  ), r1);
  r2 := result->>'revision';
  -- The first editor, still at r1, unlinks A: refused, nothing changes, and
  -- it is handed no revision that would include C unseen.
  refused := false;
  begin
    perform public.unlink_mod_listing(car, line_a, r1);
  exception when serialization_failure then refused := true;
  end;
  if not refused then
    raise exception 'FAIL 6: an unlink over a sheet changed elsewhere was accepted';
  end if;
  if (select linked_listing_id from public.mod_items where id = line_a) is distinct from listing
     or public.mod_sheet_revision(car) <> r2 then
    raise exception 'FAIL 7: a refused unlink still changed the sheet';
  end if;
  -- And so its next save can't delete C.
  refused := false;
  begin
    perform public.save_mod_items(car, jsonb_build_array(
      jsonb_build_object('id', line_a, 'group_label', 'Engine', 'brand', 'HKS', 'product', 'Intake', 'raw_text', 'HKS Intake', 'status', 'removed'),
      jsonb_build_object('id', line_b, 'group_label', 'Wheels', 'brand', 'Volk', 'product', 'TE37', 'raw_text', 'Volk TE37')
    ), r1);
  exception when serialization_failure then refused := true;
  end;
  if not refused or not exists (select 1 from public.mod_items where id = line_c) then
    raise exception 'FAIL 8: an editor that never loaded a line deleted it';
  end if;

  -- An editor that is current unlinks and moves on past its own write only.
  result := public.unlink_mod_listing(car, line_a, r2);
  r3 := result->>'revision';
  if (select linked_listing_id from public.mod_items where id = line_a) is not null
     or r3 is null or r3 = r2 or r3 <> public.mod_sheet_revision(car)
     or (result->>'listing_id')::uuid is distinct from listing then
    raise exception 'FAIL 9: a current unlink did not unlink and hand back its revision (%)', result;
  end if;
  refused := false;
  begin
    perform public.unlink_mod_listing(car, line_a, null);
  exception when invalid_parameter_value then refused := true;
  end;
  if not refused then raise exception 'FAIL 10: an unlink with no revision was accepted'; end if;
  refused := false;
  begin
    perform public.unlink_mod_listing(car, gen_random_uuid(), r3);
  exception when no_data_found then refused := true;
  end;
  if not refused then raise exception 'FAIL 11: an unlink of a line not on the build was accepted'; end if;

  -- ---------- 3: every saved field decides whether a lost save landed ----------
  sheet := jsonb_build_array(
    jsonb_build_object('id', line_a, 'group_label', 'Engine', 'brand', 'HKS', 'product', 'Intake', 'raw_text', 'HKS Intake', 'status', 'removed'),
    jsonb_build_object('id', line_b, 'group_label', 'Wheels', 'brand', 'Volk', 'product', 'TE37', 'raw_text', 'Volk TE37'),
    jsonb_build_object('id', line_c, 'group_label', 'Brakes', 'brand', 'Brembo', 'product', 'GT kit', 'raw_text', 'Brembo GT kit'),
    jsonb_build_object('id', priced, 'group_label', 'Engine', 'brand', 'Garrett', 'product', 'G25', 'raw_text', 'Garrett G25',
      'confidence', 0.75, 'product_url', 'https://garrettmotion.test/g25', 'source_domain', 'garrettmotion.test',
      'ref_price_cents', 150000, 'ref_price_currency', 'GBP')
  );
  -- The save commits; its response is lost (the editor keeps r3).
  result := public.save_mod_items(car, sheet, r3);
  r2 := result->>'revision';
  if not public.mod_sheet_matches(car, sheet) then
    raise exception 'FAIL 12: a sheet exactly as saved was not recognised';
  end if;

  -- Another tab changes only the currency.
  update public.mod_items set ref_price_currency = 'EUR' where id = priced;
  if public.mod_sheet_matches(car, sheet) or public.mod_sheet_revision_if_matches(car, sheet) is not null then
    raise exception 'FAIL 13: a currency-only change passed for the lost save';
  end if;
  refused := false;
  begin
    perform public.save_mod_items(car, sheet, r3);
  exception when serialization_failure then refused := true;
  end;
  if not refused or (select ref_price_currency from public.mod_items where id = priced) <> 'EUR' then
    raise exception 'FAIL 14: a retry of the lost save overwrote another tab''s currency';
  end if;
  update public.mod_items set ref_price_currency = 'GBP' where id = priced;

  update public.mod_items set confidence = 0.5 where id = priced;
  if public.mod_sheet_matches(car, sheet) then
    raise exception 'FAIL 15: a confidence-only change passed for the lost save';
  end if;
  update public.mod_items set confidence = 0.75 where id = priced;

  update public.mod_items set source_domain = 'elsewhere.test' where id = priced;
  if public.mod_sheet_matches(car, sheet) then
    raise exception 'FAIL 16: a source-only change passed for the lost save';
  end if;
  update public.mod_items set source_domain = 'garrettmotion.test' where id = priced;
  if not public.mod_sheet_matches(car, sheet) then
    raise exception 'FAIL 17: the sheet restored to the saved values was not recognised';
  end if;

  -- ---------- 4: photos and pins stay on their car ----------
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
  insert into public.car_images(car_id, url, position)
    select car, 'https://media.drvn.test/storage/v1/object/public/car-images/' || owner_id || '/p' || g || '.jpg', g
      from generate_series(0, 47) g;
  insert into public.car_hotspots(car_id, image_url, x, y, label)
    select car, photo, 0.1, 0.1, 'pin ' || g from generate_series(1, 8) g;
  insert into public.car_images(car_id, url, position)
    values (spare_car, 'https://media.drvn.test/storage/v1/object/public/car-images/' || owner_id || '/spare.jpg', 0)
    returning id into spare_photo;
  insert into public.car_hotspots(car_id, image_url, x, y, label)
    values (spare_car, 'https://media.drvn.test/storage/v1/object/public/car-images/' || owner_id || '/spare.jpg', 0.5, 0.5, 'spare')
    returning id into spare_pin;

  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', owner_id, 'role', 'authenticated')::text, true);
  refused := false;
  begin
    update public.car_images set car_id = car where id = spare_photo;
  exception when insufficient_privilege or check_violation then refused := true;
  end;
  if not refused then raise exception 'FAIL 18: a 49th photo was moved into a full gallery'; end if;
  refused := false;
  begin
    update public.car_hotspots set car_id = car where id = spare_pin;
  exception when insufficient_privilege or check_violation or raise_exception then refused := true;
  end;
  if not refused then raise exception 'FAIL 19: a ninth pin was moved into a full showcase'; end if;
  -- Editing a photo in place is unaffected.
  update public.car_images set alt = 'Spare, side on' where id = spare_photo;

  perform set_config('role', 'none', true);
  if (select count(*) from public.car_images where car_id = car) <> 48
     or (select count(*) from public.car_hotspots where car_id = car) <> 8
     or (select car_id from public.car_images where id = spare_photo) <> spare_car
     or (select alt from public.car_images where id = spare_photo) is distinct from 'Spare, side on' then
    raise exception 'FAIL 20: the gallery or showcase caps were exceeded by a move';
  end if;

  -- A stranger can't unlink someone else's line.
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', stranger, 'role', 'authenticated')::text, true);
  refused := false;
  begin
    perform public.unlink_mod_listing(car, line_a, public.mod_sheet_revision(car));
  exception when insufficient_privilege then refused := true;
  end;
  if not refused then raise exception 'FAIL 21: a member unlinked a line on someone else''s build'; end if;
  perform set_config('role', 'none', true);

  raise notice 'all mod sheet lock checks passed';
end $$;

rollback;
