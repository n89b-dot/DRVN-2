-- Guards for the two Home performance functions (20260928120500 feed_hydration,
-- 20260928121000 recommend_listings): who may call them, that they run with
-- the caller's own rights, and that the rules and the viewer check hold.
begin;
do $$
declare
  viewer uuid := gen_random_uuid();
  seller uuid := gen_random_uuid();
  neighbour uuid := gen_random_uuid();
  viewer_car uuid; seller_car uuid; other_car uuid;
  fits uuid; cosaved uuid; seed uuid; own uuid;
  r record; n int; payload jsonb;
begin
  -- Only the server may rank from everyone's saves; the feed is for anyone.
  if has_function_privilege('anon', 'public.recommend_listings(uuid,integer)', 'execute')
     or has_function_privilege('authenticated', 'public.recommend_listings(uuid,integer)', 'execute') then
    raise exception 'recommend_listings must not be callable by anon or authenticated';
  end if;
  if not has_function_privilege('service_role', 'public.recommend_listings(uuid,integer)', 'execute') then
    raise exception 'recommend_listings must be callable by service_role';
  end if;
  if not has_function_privilege('anon', 'public.feed_hydration(uuid[],uuid[],uuid[],uuid)', 'execute') then
    raise exception 'feed_hydration must be callable by anon';
  end if;
  -- Invoker rights: RLS keeps deciding what each caller sees.
  select count(*) into n from pg_proc
   where proname in ('feed_hydration', 'recommend_listings') and pronamespace = 'public'::regnamespace and prosecdef;
  if n <> 0 then raise exception 'feed_hydration and recommend_listings must be SECURITY INVOKER'; end if;

  insert into auth.users(id, email) values
    (viewer, 'home-rpc-viewer@example.test'),
    (seller, 'home-rpc-seller@example.test'),
    (neighbour, 'home-rpc-neighbour@example.test');
  -- The garage spells the make in lower case; the match must still be made.
  insert into public.cars(owner_id, name, slug, make, model, is_public)
    values (viewer, 'Daily', 'home-rpc-daily', 'volkswagen', 'Golf R', true) returning id into viewer_car;
  insert into public.cars(owner_id, name, slug, make, model, is_public)
    values (seller, 'Donor', 'home-rpc-donor', 'Volkswagen', 'Golf R', true) returning id into seller_car;
  insert into public.cars(owner_id, name, slug, make, model, is_public)
    values (seller, 'Other', 'home-rpc-other', 'Honda', 'Civic', true) returning id into other_car;
  insert into public.listings(seller_id, title, category, price_cents, status, source_car_id)
    values (seller, 'HomeRpc fits', 'engine', 1000, 'active', seller_car) returning id into fits;
  insert into public.listings(seller_id, title, category, price_cents, status, source_car_id)
    values (seller, 'HomeRpc co-saved', 'engine', 1000, 'active', other_car) returning id into cosaved;
  insert into public.listings(seller_id, title, category, price_cents, status, source_car_id)
    values (seller, 'HomeRpc seed', 'engine', 1000, 'active', other_car) returning id into seed;
  insert into public.listings(seller_id, title, category, price_cents, status, source_car_id)
    values (viewer, 'HomeRpc own', 'engine', 1000, 'active', viewer_car) returning id into own;
  -- Co-save: the viewer and a neighbour both saved `seed`; the neighbour
  -- also saved `cosaved`.
  insert into public.saves(user_id, target_type, target_id) values
    (viewer, 'listing', seed), (neighbour, 'listing', seed), (neighbour, 'listing', cosaved);

  select * into r from public.recommend_listings(viewer, 20) where id = fits;
  if r.id is null or r.score < 10 or r.reason <> 'Fits your Volkswagen Golf R' then
    raise exception 'Platform match missing or wrong: %', row_to_json(r);
  end if;
  select * into r from public.recommend_listings(viewer, 20) where id = cosaved;
  if r.id is null or r.reason <> 'Because you saved similar parts' then
    raise exception 'Co-save pick missing or wrong: %', row_to_json(r);
  end if;
  select count(*) into n from public.recommend_listings(viewer, 20) where id = own;
  if n <> 0 then raise exception 'Recommended the viewer''s own listing'; end if;
  -- The co-save rule never offers what the viewer already saved (the
  -- popularity fallback may, as the per-rule reads always did).
  select count(*) into n from public.recommend_listings(viewer, 2) where id = seed;
  if n <> 0 then raise exception 'Co-save offered a listing the viewer already saved'; end if;
  select count(*) into n from public.recommend_listings(viewer, 1);
  if n <> 1 then raise exception 'p_limit not honoured: % rows', n; end if;

  -- Counts come back made, and the viewer's own marks only for the caller.
  perform set_config('request.jwt.claims', json_build_object('sub', viewer, 'role', 'authenticated')::text, true);
  payload := public.feed_hydration('{}', array[seller_car], array[seed], viewer);
  if (payload->'listings'->0->>'watch_count')::int <> 2 then
    raise exception 'watch_count wrong: %', payload->'listings';
  end if;
  if (payload->'cars'->0->>'for_sale_count')::int <> 1 then
    raise exception 'for_sale_count wrong: %', payload->'cars';
  end if;
  if jsonb_array_length(payload->'viewer_saves') <> 1 or jsonb_array_length(payload->'garage') <> 1 then
    raise exception 'Caller''s own marks missing: %', payload;
  end if;
  payload := public.feed_hydration('{}', array[seller_car], array[seed], neighbour);
  if jsonb_array_length(payload->'viewer_saves') <> 0 or jsonb_array_length(payload->'garage') <> 0 then
    raise exception 'feed_hydration returned another member''s marks: %', payload;
  end if;

  raise notice 'home_feed_rpc_guard: all checks passed';
end $$;
rollback;
