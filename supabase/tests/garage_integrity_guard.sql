-- OS-W23: garage integrity, and direct member-token access to the garage
-- tables (OS-R-untested), held in the database.
--   N65   a stale build sheet is refused; a lost-response retry converges
--   N66   the showcase is replaced in one transaction, validated first
--   N248  the gallery (48) and showcase (8) caps hold for direct inserts
-- Migration 20261107220100.
begin;

do $$
declare
  owner_id uuid := gen_random_uuid();
  stranger uuid := gen_random_uuid();
  car uuid := gen_random_uuid();
  other_car uuid := gen_random_uuid();
  line_a uuid := gen_random_uuid();
  line_b uuid := gen_random_uuid();
  photo text;
  r1 text;
  r2 text;
  r3 text;
  result jsonb;
  refused boolean;
  n int;
begin
  insert into public.job_config(key, value) values ('media_storage_origin', 'https://media.drvn.test')
    on conflict (key) do update set value = excluded.value;
  insert into auth.users(id, email, raw_user_meta_data) values
    (owner_id, 'w23-owner@drvn.test', '{}'),
    (stranger, 'w23-stranger@drvn.test', '{}');
  insert into public.cars(id, owner_id, slug, name, is_public) values
    (car, owner_id, 'w23-car', 'W23 build', true),
    (other_car, stranger, 'w23-other', 'W23 other build', true);
  photo := 'https://media.drvn.test/storage/v1/object/public/car-images/' || owner_id || '/one.jpg';

  -- Nobody signed out can reach the garage writes.
  if has_function_privilege('anon', 'public.save_mod_items(uuid,jsonb,text)', 'execute')
     or has_function_privilege('anon', 'public.replace_car_showcase(uuid,text,jsonb)', 'execute') then
    raise exception 'FAIL 0: visitors can call the garage write functions';
  end if;
  if exists (select 1 from pg_proc where oid = 'public.save_mod_items(uuid,jsonb,text)'::regprocedure and prosecdef)
     or exists (select 1 from pg_proc where oid = 'public.replace_car_showcase(uuid,text,jsonb)'::regprocedure and prosecdef) then
    raise exception 'FAIL 0b: a garage write function bypasses the caller''s row security';
  end if;
  if to_regprocedure('public.save_mod_items(uuid,jsonb)') is not null then
    raise exception 'FAIL 0c: the unversioned save_mod_items is still callable';
  end if;

  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', owner_id, 'role', 'authenticated')::text, true);

  -- ---------- N65 ----------
  r1 := public.mod_sheet_revision(car);
  result := public.save_mod_items(car, jsonb_build_array(
    jsonb_build_object('id', line_a, 'group_label', 'Engine', 'brand', 'HKS', 'product', 'Intake', 'raw_text', 'HKS Intake'),
    jsonb_build_object('id', line_b, 'group_label', 'Wheels', 'brand', 'Volk', 'product', 'TE37', 'raw_text', 'Volk TE37')
  ), r1);
  r2 := result->>'revision';
  if result->>'outcome' <> 'saved' or r2 is null or r2 = r1 or r2 <> public.mod_sheet_revision(car) then
    raise exception 'FAIL 1: a current save did not hand back the new revision (%)', result;
  end if;

  -- An older tab (still at r1) that never saw line B tries to save only A.
  refused := false;
  begin
    perform public.save_mod_items(car, jsonb_build_array(
      jsonb_build_object('id', line_a, 'group_label', 'Engine', 'brand', 'HKS', 'product', 'Intake v2', 'raw_text', 'HKS Intake v2')
    ), r1);
  exception when serialization_failure then refused := true;
  end;
  if not refused then raise exception 'FAIL 2: a stale build sheet was saved'; end if;
  if not exists (select 1 from public.mod_items where id = line_b)
     or (select product from public.mod_items where id = line_a) <> 'Intake' then
    raise exception 'FAIL 3: a refused stale save still changed the sheet';
  end if;

  -- The response to the first save was lost; the retry (same lines, old
  -- revision) converges without writing.
  result := public.save_mod_items(car, jsonb_build_array(
    jsonb_build_object('id', line_a, 'group_label', 'Engine', 'brand', 'HKS', 'product', 'Intake', 'raw_text', 'HKS Intake'),
    jsonb_build_object('id', line_b, 'group_label', 'Wheels', 'brand', 'Volk', 'product', 'TE37', 'raw_text', 'Volk TE37')
  ), r1);
  if result->>'outcome' <> 'saved' or result->>'revision' <> r2 or public.mod_sheet_revision(car) <> r2 then
    raise exception 'FAIL 4: an exact retry of a committed save did not converge (%)', result;
  end if;

  -- Any other write to a line (the agent, a listing release) moves it on.
  update public.mod_items set group_label = 'Intake' where id = line_a;
  r3 := public.mod_sheet_revision(car);
  if r3 = r2 then raise exception 'FAIL 5: a direct line edit left the revision unchanged'; end if;
  refused := false;
  begin
    perform public.save_mod_items(car, '[]'::jsonb, r2);
  exception when serialization_failure then refused := true;
  end;
  if not refused then raise exception 'FAIL 6: a save over a line edited elsewhere was accepted'; end if;

  refused := false;
  begin
    perform public.save_mod_items(car, '[]'::jsonb, null);
  exception when invalid_parameter_value then refused := true;
  end;
  if not refused then raise exception 'FAIL 7: a save with no revision was accepted'; end if;

  -- Direct access: another member's car, through the function and the table.
  refused := false;
  begin
    perform public.save_mod_items(other_car, '[]'::jsonb, public.mod_sheet_revision(other_car));
  exception when insufficient_privilege then refused := true;
  end;
  if not refused then raise exception 'FAIL 8: a member saved someone else''s build sheet'; end if;
  refused := false;
  begin
    insert into public.mod_items(car_id, group_label, raw_text, position) values (other_car, 'Other', 'x', 0);
  exception when insufficient_privilege then refused := true;
  end;
  if not refused then raise exception 'FAIL 9: a member inserted a line on someone else''s build'; end if;

  -- ---------- N66 ----------
  perform set_config('role', 'none', true);
  insert into public.car_images(car_id, url, position) values (car, photo, 0);
  perform set_config('role', 'authenticated', true);
  perform public.replace_car_showcase(car, photo, jsonb_build_array(
    jsonb_build_object('x', 0.2, 'y', 0.3, 'mod_item_id', line_a, 'label', 'Intake'),
    jsonb_build_object('x', 0.7, 'y', 0.6, 'label', 'Wheels')
  ));
  if (select count(*) from public.car_hotspots where car_id = car) <> 2 then
    raise exception 'FAIL 10: the showcase was not saved';
  end if;

  -- A bad pin anywhere refuses the whole save and keeps the old showcase.
  refused := false;
  begin
    perform public.replace_car_showcase(car, photo, jsonb_build_array(
      jsonb_build_object('x', 0.5, 'y', 0.5, 'label', 'fine'),
      jsonb_build_object('x', 0.5, 'y', 0.5, 'mod_item_id', gen_random_uuid(), 'label', 'not on this build')
    ));
  exception when invalid_parameter_value then refused := true;
  end;
  if not refused or (select count(*) from public.car_hotspots where car_id = car) <> 2 then
    raise exception 'FAIL 11: a failed showcase save lost the old showcase';
  end if;
  refused := false;
  begin
    perform public.replace_car_showcase(car, 'https://elsewhere.test/x.jpg',
      jsonb_build_array(jsonb_build_object('x', 0.5, 'y', 0.5, 'label', 'x')));
  exception when invalid_parameter_value then refused := true;
  end;
  if not refused then raise exception 'FAIL 12: a showcase on a photo outside the gallery was accepted'; end if;
  refused := false;
  begin
    perform public.replace_car_showcase(car, photo,
      (select jsonb_agg(jsonb_build_object('x', 0.1, 'y', 0.1, 'label', 'p' || g)) from generate_series(1, 9) g));
  exception when invalid_parameter_value then refused := true;
  end;
  if not refused then raise exception 'FAIL 13: a nine-pin showcase was accepted'; end if;
  refused := false;
  begin
    perform public.replace_car_showcase(other_car, photo, '[]'::jsonb);
  exception when insufficient_privilege then refused := true;
  end;
  if not refused then raise exception 'FAIL 14: a member cleared someone else''s showcase'; end if;

  perform public.replace_car_showcase(car, photo, '[]'::jsonb);
  if exists (select 1 from public.car_hotspots where car_id = car) then
    raise exception 'FAIL 15: an empty save did not clear the showcase';
  end if;

  -- ---------- N248: caps hold for direct writes ----------
  perform set_config('role', 'none', true);
  insert into public.car_images(car_id, url, position)
    select car, 'https://media.drvn.test/storage/v1/object/public/car-images/' || owner_id || '/p' || g || '.jpg', g
      from generate_series(1, 47) g;
  insert into public.car_hotspots(car_id, image_url, x, y, label)
    select car, photo, 0.1, 0.1, 'pin ' || g from generate_series(1, 8) g;
  perform set_config('role', 'authenticated', true);
  refused := false;
  begin
    insert into public.car_images(car_id, url, position)
      values (car, 'https://media.drvn.test/storage/v1/object/public/car-images/' || owner_id || '/p49.jpg', 49);
  exception when check_violation then refused := true;
  end;
  if not refused then raise exception 'FAIL 16: a 49th photo went straight into the gallery'; end if;
  refused := false;
  begin
    insert into public.car_hotspots(car_id, image_url, x, y, label) values (car, photo, 0.5, 0.5, 'ninth');
  exception when check_violation or raise_exception then refused := true;
  end;
  if not refused then raise exception 'FAIL 17: a ninth pin went straight into the showcase'; end if;

  -- Direct access: a stranger can't add to someone else's gallery or showcase.
  perform set_config('request.jwt.claims', json_build_object('sub', stranger, 'role', 'authenticated')::text, true);
  refused := false;
  begin
    insert into public.car_images(car_id, url, position)
      values (other_car, 'https://media.drvn.test/storage/v1/object/public/car-images/' || owner_id || '/stolen.jpg', 0);
  exception when insufficient_privilege then refused := true;
  end;
  if not refused then raise exception 'FAIL 18: a member attached another member''s upload to their gallery'; end if;
  delete from public.car_images where car_id = car;
  delete from public.car_hotspots where car_id = car;
  update public.mod_items set product = 'vandalised' where car_id = car;
  perform set_config('role', 'none', true);
  select count(*) into n from public.car_images where car_id = car;
  if n <> 48 or (select count(*) from public.car_hotspots where car_id = car) <> 8
     or exists (select 1 from public.mod_items where car_id = car and product = 'vandalised') then
    raise exception 'FAIL 19: a stranger changed someone else''s gallery, showcase or sheet';
  end if;

  raise notice 'all garage integrity checks passed';
end $$;

rollback;
