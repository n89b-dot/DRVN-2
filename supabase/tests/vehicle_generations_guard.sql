-- Car generations (20261020100000). Transactional; disposable database only.
--
-- A car resolves to a generation only when exactly one generation of its
-- model covers its year; changeover years resolve to nothing. An owner's
-- choice is kept while it still fits the car and is never something a
-- client can claim by writing generation_source. Adding or removing a
-- generation re-resolves the model's cars. None of it touches the
-- vehicle-fit rows or queues search work, and the catalog stays read-only
-- to clients.
begin;

do $$
declare
  v_owner uuid := gen_random_uuid();
  v_other uuid := gen_random_uuid();
  v_make bigint;
  v_model bigint;
  v_single bigint;
  g7 bigint; g8 bigint; g_only bigint; g_new bigint;
  c_2016 uuid := gen_random_uuid();
  c_2020 uuid := gen_random_uuid();
  c_noyear uuid := gen_random_uuid();
  c_single uuid := gen_random_uuid();
  l_part uuid := gen_random_uuid();
  v_fit_before text;
  v_fit_after text;
  v_jobs_before bigint;
  v_jobs_after bigint;
  v_gen bigint;
  v_src text;
  denied boolean;
begin
  insert into auth.users(id, email) values (v_owner, 'gen-owner@example.test'), (v_other, 'gen-other@example.test');
  insert into public.catalog_makes(name) values ('Genguard Motors') returning id into v_make;
  insert into public.catalog_models(make_id, name) values (v_make, 'Hatch') returning id into v_model;
  insert into public.catalog_models(make_id, name) values (v_make, 'Coupe') returning id into v_single;
  insert into public.vehicle_generations(model_id, name, platform_code, year_start, year_end)
    values (v_model, 'Mk7', '5G', 2012, 2020) returning id into g7;
  insert into public.vehicle_generations(model_id, name, platform_code, year_start, year_end)
    values (v_model, 'Mk8', 'CD', 2020, null) returning id into g8;
  insert into public.vehicle_generations(model_id, name, year_start, year_end)
    values (v_single, 'Only', 2001, 2009) returning id into g_only;

  -- 1. The resolver: one covering generation, or nothing.
  if public.resolve_vehicle_generation(v_model, 2016) is distinct from g7 then raise exception 'FAIL 1a: 2016 is a Mk7'; end if;
  if public.resolve_vehicle_generation(v_model, 2023) is distinct from g8 then raise exception 'FAIL 1b: an open-ended generation covers today'; end if;
  if public.resolve_vehicle_generation(v_model, 2020) is not null then raise exception 'FAIL 1c: a changeover year resolved'; end if;
  if public.resolve_vehicle_generation(v_model, 1990) is not null then raise exception 'FAIL 1d: a year before every generation resolved'; end if;
  if public.resolve_vehicle_generation(v_model, null) is not null then raise exception 'FAIL 1e: no year resolved a model with two generations'; end if;
  if public.resolve_vehicle_generation(v_single, null) is distinct from g_only then raise exception 'FAIL 1f: no year should resolve a one-generation model'; end if;

  -- 2. Cars resolve as they are written, by their owner, through RLS.
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  insert into public.cars(id, owner_id, name, slug, is_public, make, model, year, catalog_make_id, catalog_model_id)
  values (c_2016, v_owner, 'Mk7', 'gen-guard-2016', true, 'Genguard Motors', 'Hatch', 2016, v_make, v_model),
         (c_2020, v_owner, 'Changeover', 'gen-guard-2020', true, 'Genguard Motors', 'Hatch', 2020, v_make, v_model),
         (c_noyear, v_owner, 'No year', 'gen-guard-noyear', true, 'Genguard Motors', 'Hatch', null, v_make, v_model),
         (c_single, v_owner, 'Coupe', 'gen-guard-single', true, 'Genguard Motors', 'Coupe', 2005, v_make, v_single);
  select generation_id, generation_source into v_gen, v_src from public.cars where id = c_2016;
  if v_gen is distinct from g7 or v_src is distinct from 'resolved' then raise exception 'FAIL 2a: a 2016 car is not a resolved Mk7 (%/%)', v_gen, v_src; end if;
  select generation_id, generation_source into v_gen, v_src from public.cars where id = c_2020;
  if v_gen is not null or v_src is not null then raise exception 'FAIL 2b: a changeover car resolved'; end if;

  -- 3. The owner chooses for the changeover car; the choice is theirs.
  update public.cars set generation_id = g8 where id = c_2020;
  select generation_id, generation_source into v_gen, v_src from public.cars where id = c_2020;
  if v_gen is distinct from g8 or v_src is distinct from 'owner' then raise exception 'FAIL 3a: the owner''s choice was not kept'; end if;
  -- An unrelated edit keeps it.
  update public.cars set name = 'Changeover, renamed' where id = c_2020;
  update public.cars set year = 2020 where id = c_2020;
  if (select generation_source from public.cars where id = c_2020) is distinct from 'owner' then raise exception 'FAIL 3b: an edit dropped the owner''s choice'; end if;
  -- A choice that doesn't fit the car's year is not kept: it resolves.
  update public.cars set generation_id = g8 where id = c_2016;
  select generation_id, generation_source into v_gen, v_src from public.cars where id = c_2016;
  if v_gen is distinct from g7 or v_src is distinct from 'resolved' then raise exception 'FAIL 3c: a generation that doesn''t cover the year was accepted'; end if;
  -- Another model's generation is not kept either.
  update public.cars set generation_id = g_only where id = c_2016;
  if (select generation_id from public.cars where id = c_2016) is distinct from g7 then raise exception 'FAIL 3d: another model''s generation was accepted'; end if;
  -- Claiming the source by hand changes nothing.
  update public.cars set generation_source = 'owner' where id = c_2016;
  if (select generation_source from public.cars where id = c_2016) is distinct from 'resolved' then raise exception 'FAIL 3e: a client claimed an owner choice'; end if;
  -- Moving the car out of the chosen generation's years drops the choice.
  update public.cars set year = 2015 where id = c_2020;
  select generation_id, generation_source into v_gen, v_src from public.cars where id = c_2020;
  if v_gen is distinct from g7 or v_src is distinct from 'resolved' then raise exception 'FAIL 3f: a choice that no longer fits survived a year change'; end if;
  update public.cars set year = 2020, generation_id = g8 where id = c_2020;
  select generation_id, generation_source into v_gen, v_src from public.cars where id = c_2020;
  if v_gen is distinct from g8 or v_src is distinct from 'owner' then raise exception 'FAIL 3g: choosing while changing the year was refused'; end if;

  -- 4. Clients read generations and never write them.
  denied := false;
  begin
    insert into public.vehicle_generations(model_id, name, year_start) values (v_model, 'Mk9', 2030);
  exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'FAIL 4a: a member wrote a generation'; end if;
  perform set_config('role', 'anon', true);
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  if (select count(*) from public.vehicle_generations where model_id = v_model) <> 2 then raise exception 'FAIL 4b: a guest cannot read generations'; end if;
  if (select generation_id from public.cars where id = c_2016) is distinct from g7 then raise exception 'FAIL 4c: a guest cannot read a public car''s generation'; end if;
  denied := false;
  begin
    update public.vehicle_generations set name = 'x' where id = g7;
  exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'FAIL 4d: a guest wrote a generation'; end if;
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);

  -- 5. New and removed generations re-resolve the model's cars, keep owners'
  -- choices that still fit, and touch neither vehicle fit nor search.
  insert into public.listings(id, seller_id, source_car_id, title, category, condition, price_cents, status)
  values (l_part, v_owner, c_2016, 'Genguard intake', 'performance', 'used', 10000, 'active');
  select string_agg(format('%s|%s|%s|%s', make_key, model_key, via, years), ',' order by make_key, model_key, via)
    into v_fit_before from public.listing_vehicle_fit where listing_id = l_part;
  if v_fit_before is null then raise exception 'FAIL 5a: the fixture part has no vehicle-fit rows'; end if;
  select count(*) into v_jobs_before from public.remediation_jobs;

  -- A facelift split: 2016 is now covered twice, so the resolved car goes
  -- back to asking; the owner-chosen 2020 car keeps its Mk8.
  insert into public.vehicle_generations(model_id, name, year_start, year_end)
    values (v_model, 'Mk7.5', 2016, 2020) returning id into g_new;
  if (select generation_id from public.cars where id = c_2016) is not null then raise exception 'FAIL 5b: an overlapping new generation left a resolved car resolved'; end if;
  if (select generation_id from public.cars where id = c_2020) is distinct from g8 then raise exception 'FAIL 5c: a new generation overrode an owner''s choice'; end if;
  delete from public.vehicle_generations where id = g_new;
  if (select generation_id from public.cars where id = c_2016) is distinct from g7 then raise exception 'FAIL 5d: removing the overlap did not re-resolve'; end if;
  -- Removing a generation re-resolves the cars that had it.
  delete from public.vehicle_generations where id = g7;
  if (select generation_id from public.cars where id = c_2016) is not null then raise exception 'FAIL 5e: a car kept a removed generation'; end if;
  if (select generation_source from public.cars where id = c_2020) is distinct from 'owner' then raise exception 'FAIL 5f: removing another generation dropped an owner''s choice'; end if;
  update public.vehicle_generations set year_start = 2010 where id = g8;
  if (select generation_id from public.cars where id = c_2016) is distinct from g8 then raise exception 'FAIL 5g: widening a generation did not re-resolve'; end if;
  -- Removing the generation an owner chose: the foreign key clears it and
  -- the car resolves again (here to nothing, since nothing else covers 2020).
  delete from public.vehicle_generations where id = g8;
  select generation_id, generation_source into v_gen, v_src from public.cars where id = c_2020;
  if v_gen is not null or v_src is not null then raise exception 'FAIL 5g2: removing a chosen generation left (%/%)', v_gen, v_src; end if;

  select string_agg(format('%s|%s|%s|%s', make_key, model_key, via, years), ',' order by make_key, model_key, via)
    into v_fit_after from public.listing_vehicle_fit where listing_id = l_part;
  if v_fit_after is distinct from v_fit_before then raise exception 'FAIL 5h: generations changed vehicle fit (% -> %)', v_fit_before, v_fit_after; end if;
  select count(*) into v_jobs_after from public.remediation_jobs;
  if v_jobs_after <> v_jobs_before then raise exception 'FAIL 5i: generation changes queued % search jobs', v_jobs_after - v_jobs_before; end if;

  -- 6. The car's columns are readable as before, plus these two; the
  -- resolver is callable by anyone, the trigger functions by no one.
  if not has_column_privilege('anon', 'public.cars', 'generation_id', 'select') then raise exception 'FAIL 6a: generation_id is not readable'; end if;
  if has_function_privilege('authenticated', 'public.vehicle_generations_rescan()', 'execute')
     or has_function_privilege('authenticated', 'public.car_generation_before_write()', 'execute') then
    raise exception 'FAIL 6b: a generation trigger function is callable by members';
  end if;

  raise notice 'all vehicle generation checks passed';
end $$;

rollback;
