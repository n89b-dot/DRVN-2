-- A car's VIN is readable by its owner only; every other cars column a client
-- could read before still reads.
begin;

do $$
declare
  owner_id uuid := gen_random_uuid();
  stranger uuid := gen_random_uuid();
  car uuid := gen_random_uuid();
  v text;
  denied boolean := false;
  expected text[] := array['about','body_class','catalog_make_id','catalog_model_id','color','cover_focal_x',
    'cover_focal_y','cover_image_url','created_at','drivetrain','engine','id','identity_source','is_public',
    'make','model','name','owner_id','slug','tags','trim','updated_at','vin_decoded_at','year'];
  readable text[];
begin
  insert into auth.users(id, email) values (owner_id, 'vin-owner@example.test'), (stranger, 'vin-stranger@example.test');
  insert into public.cars(id, owner_id, name, slug, is_public, vin)
  values (car, owner_id, 'Public build', 'vin-guard-' || left(car::text, 8), true, '1HGCM82633A004352');

  -- The client-readable columns are exactly the reviewed set.
  select array_agg(column_name::text order by column_name) into readable
  from information_schema.columns
  where table_schema = 'public' and table_name = 'cars'
    and has_column_privilege('anon', 'public.cars', column_name, 'select');
  if readable is distinct from expected then
    raise exception 'FAIL 1: anon-readable cars columns changed: %', readable;
  end if;
  if has_column_privilege('authenticated', 'public.cars', 'vin', 'select') then
    raise exception 'FAIL 2: signed-in members can read every VIN';
  end if;

  -- A guest reads the public build, but not its VIN.
  perform set_config('role', 'anon', true);
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  if not exists (select 1 from public.cars where id = car and name = 'Public build') then
    raise exception 'FAIL 3: a guest can no longer read a public build';
  end if;
  begin
    select c.vin into v from public.cars c where c.id = car;
  exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'FAIL 4: a guest read a VIN'; end if;
  denied := false;

  -- Another member: no VIN, directly or through the owner function.
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', stranger, 'role', 'authenticated')::text, true);
  if public.my_car_vin(car) is not null then raise exception 'FAIL 5: a stranger read the VIN'; end if;

  -- The owner gets it, and can still edit the gallery (named-column read).
  perform set_config('request.jwt.claims', jsonb_build_object('sub', owner_id, 'role', 'authenticated')::text, true);
  if public.my_car_vin(car) is distinct from '1HGCM82633A004352' then
    raise exception 'FAIL 6: the owner cannot read their VIN';
  end if;
  begin
    perform public.edit_car_gallery(car, 'reorder', jsonb_build_object('ids', '[]'::jsonb));
  exception
    when insufficient_privilege then raise exception 'FAIL 7: edit_car_gallery lost access to cars: %', sqlerrm;
    when others then null; -- an empty reorder may be refused for its own reasons
  end;
  update public.cars set vin = '2HGCM82633A004353' where id = car;
  if public.my_car_vin(car) is distinct from '2HGCM82633A004353' then
    raise exception 'FAIL 8: the owner can no longer update their VIN';
  end if;

  perform set_config('role', 'none', true);
  if has_function_privilege('anon', 'public.my_car_vin(uuid)', 'execute') then
    raise exception 'FAIL 9: guests can call my_car_vin';
  end if;
  raise notice 'all car vin privacy checks passed';
end $$;

rollback;
