-- Search, browse and the Explore wall at volume (migration 20261008100000).
-- Transactional; disposable local database only.
--
-- That migration rewrote how search finds rows, not which rows it finds. The
-- word-search functions now run with the definer's rights (so they can use
-- text indexes row security would otherwise hide), which makes the read rule
-- inside them the only thing between a signed-out visitor and a draft part,
-- a private build or a suspended member. This holds them to it, and holds
-- each new entry point to the answer of the function it stands in for.
begin;

do $$
declare
  v_seller uuid := gen_random_uuid();
  v_suspended uuid := gen_random_uuid();
  v_car uuid := gen_random_uuid();
  v_private_car uuid := gen_random_uuid();
  v_suspended_car uuid := gen_random_uuid();
  v_listing uuid := gen_random_uuid();
  v_draft uuid := gen_random_uuid();
  v_suspended_listing uuid := gen_random_uuid();
  v_post uuid := gen_random_uuid();
  v_private_post uuid := gen_random_uuid();
  v_suspended_post uuid := gen_random_uuid();
  v_ids uuid[];
  v_other uuid[];
  v_fn text;
  v_count int;
begin
  update public.beta_access_config set enforced = false where singleton;

  insert into auth.users(id, email) values
    (v_seller, 'scale-seller@drvn.test'), (v_suspended, 'scale-suspended@drvn.test');
  insert into public.profiles(id, username) values
    (v_seller, 'scale_seller'), (v_suspended, 'scale_suspended')
    on conflict (id) do update set username = excluded.username;

  insert into public.cars(id, owner_id, slug, name, make, model, year, is_public) values
    (v_car, v_seller, 'scale-guard-public', 'Zzqxcar public', 'Zzqxmake', 'Zzqxmodel', 2001, true),
    (v_private_car, v_seller, 'scale-guard-private', 'Zzqxcar private', 'Zzqxmake', 'Zzqxmodel', 2001, false),
    (v_suspended_car, v_suspended, 'scale-guard-suspended', 'Zzqxcar suspended', 'Zzqxmake', 'Zzqxmodel', 2001, true);
  insert into public.mod_items(car_id, group_label, brand, product, raw_text, position, status) values
    (v_car, 'Performance', 'Zzqxbrand', 'manifold', 'Zzqxbrand manifold', 0, 'installed'),
    (v_private_car, 'Performance', 'Zzqxbrand', 'manifold', 'Zzqxbrand manifold', 0, 'installed');

  insert into public.listings(id, seller_id, source_car_id, title, category, subcategory, price_cents, currency, status, part_number) values
    (v_listing, v_seller, v_car, 'Zzqxpart manifold', 'performance', 'turbo', 20000, 'USD', 'active', 'ZQ-77119'),
    (v_draft, v_seller, v_car, 'Zzqxpart draft', 'performance', 'turbo', 20000, 'USD', 'draft', null),
    (v_suspended_listing, v_suspended, v_suspended_car, 'Zzqxpart suspended', 'performance', 'turbo', 20000, 'USD', 'active', null);
  insert into public.listing_fitments(listing_id, make, model) values (v_listing, 'Zzqxmake', 'Zzqxmodel');

  insert into public.activity_posts(id, car_id, author_id, title, body, published_at) values
    (v_post, v_car, v_seller, 'Zzqxpost public', '{"type":"doc","content":[]}'::jsonb, now()),
    (v_private_post, v_private_car, v_seller, 'Zzqxpost private', '{"type":"doc","content":[]}'::jsonb, now()),
    (v_suspended_post, v_suspended_car, v_suspended, 'Zzqxpost suspended', '{"type":"doc","content":[]}'::jsonb, now());

  update public.profiles set suspended_at = now(), suspended_reason = 'guard' where id = v_suspended;

  -- ── As a signed-out visitor ─────────────────────────────────────────────
  perform set_config('role', 'anon', true);
  perform set_config('request.jwt.claims', '', true);

  -- 1. The definer search functions apply the visitor's read rule themselves.
  select coalesce(array_agg(id), '{}') into v_ids from public.search_listing_ids('zzqxpart') id;
  if v_ids <> array[v_listing] then
    raise exception 'search_listing_ids must return only the active part of a visible seller, got %', v_ids;
  end if;
  select coalesce(array_agg(id), '{}') into v_ids from public.search_car_ids('zzqxcar') id;
  if v_ids <> array[v_car] then
    raise exception 'search_car_ids must return only the public build of a visible owner, got %', v_ids;
  end if;
  -- A private build's mods must not surface it.
  select coalesce(array_agg(id), '{}') into v_ids from public.search_car_ids('zzqxbrand') id;
  if v_ids <> array[v_car] then
    raise exception 'A mod on a private build surfaced it in search: %', v_ids;
  end if;
  select coalesce(array_agg(id), '{}') into v_ids from public.search_update_ids('zzqxpost') id;
  if v_ids <> array[v_post] then
    raise exception 'search_update_ids must return only the update on a visible public build, got %', v_ids;
  end if;
  -- Updates are found by their car's make, too — and only the visible one.
  select coalesce(array_agg(id), '{}') into v_ids from public.search_update_ids('zzqxmake') id;
  if v_ids <> array[v_post] then
    raise exception 'Update search by car make returned %', v_ids;
  end if;
  select coalesce(array_agg(id), '{}') into v_ids from public.marketplace_search_ids('ZQ-77119') id;
  if v_ids <> array[v_listing] then
    raise exception 'Part-number search returned %', v_ids;
  end if;

  -- 2. Each search entry point answers exactly as the function it replaces.
  select coalesce(array_agg(id order by id), '{}') into v_ids from public.marketplace_search_browse_rows('zzqxpart');
  select coalesce(array_agg(id order by id), '{}') into v_other from public.marketplace_browse_rows(p_query => 'zzqxpart');
  if v_ids <> v_other or v_ids <> array[v_listing] then
    raise exception 'Marketplace search entry point disagrees with browse: % vs %', v_ids, v_other;
  end if;
  select coalesce(array_agg(id order by id), '{}') into v_ids from public.marketplace_search_browse_rows('zq77119');
  select coalesce(array_agg(id order by id), '{}') into v_other from public.marketplace_browse_rows(p_query => 'zq77119');
  if v_ids <> v_other or v_ids <> array[v_listing] then
    raise exception 'Part-number search entry point disagrees with browse: % vs %', v_ids, v_other;
  end if;
  select coalesce(array_agg(id order by id), '{}') into v_ids from public.explore_update_search_rows('zzqxpost');
  select coalesce(array_agg(id order by id), '{}') into v_other from public.explore_update_rows('zzqxpost');
  if v_ids <> v_other or v_ids <> array[v_post] then
    raise exception 'Update search entry point disagrees with explore_update_rows: % vs %', v_ids, v_other;
  end if;
  select coalesce(array_agg(id), '{}') into v_ids from public.explore_build_rows('zzqxcar');
  if v_ids <> array[v_car] then
    raise exception 'explore_build_rows returned %', v_ids;
  end if;
  -- An empty search through the entry point is nothing, not everything.
  select count(*) into v_count from public.marketplace_search_browse_rows('   ');
  if v_count <> 0 then raise exception 'A blank search returned % parts', v_count; end if;

  -- 3. The paged wall is the view, read another way.
  select coalesce(array_agg(id), '{}') into v_ids from public.feed_event_page(array['car','update','part'], 50, 0);
  select coalesce(array_agg(id), '{}') into v_other from (
    select id from public.feed_events where kind in ('car','update','part')
    order by happened_at desc, id desc limit 50) v;
  if v_ids <> v_other then
    raise exception 'feed_event_page and feed_events disagree';
  end if;
  if not (v_car = any(v_ids) and v_listing = any(v_ids) and v_post = any(v_ids)) then
    raise exception 'The wall is missing the visible car, part or update';
  end if;
  if v_private_post = any(v_ids) or v_suspended_listing = any(v_ids) or v_suspended_car = any(v_ids) or v_draft = any(v_ids) then
    raise exception 'The wall shows a private, suspended or draft row';
  end if;
  select coalesce(array_agg(id), '{}') into v_ids from public.feed_event_page(array['car','update','part'], 50, 0, v_seller);
  if v_car = any(v_ids) or v_listing = any(v_ids) or v_post = any(v_ids) then
    raise exception 'feed_event_page did not leave the excluded owner out';
  end if;

  -- 4. Vehicle filter still finds the part by its stated fitment.
  perform set_config('role', 'supabase_admin', true);
  insert into public.catalog_makes(name) values ('Zzqxmake');
  perform set_config('role', 'anon', true);
  select count(*) into v_count from public.marketplace_browse_rows(
    p_vehicle => (select id::text from public.catalog_makes where name = 'Zzqxmake'));
  if v_count <> 1 then raise exception 'Vehicle filter found % parts for the make, expected 1', v_count; end if;

  perform set_config('role', 'supabase_admin', true);

  -- 5. Shape. The id functions are definer with a pinned search_path; the
  --    row-returning wrappers carry NO settings, because a SET clause stops
  --    the planner reading a page off an index (the reason for the migration).
  foreach v_fn in array array['search_car_ids(text)', 'search_update_ids(text)', 'search_listing_ids(text)', 'marketplace_search_ids(text)'] loop
    if not exists (select 1 from pg_proc p where p.oid = ('public.' || v_fn)::regprocedure and p.prosecdef
                     and exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%')) then
      raise exception '% must be SECURITY DEFINER with a pinned search_path', v_fn;
    end if;
  end loop;
  foreach v_fn in array array[
    'marketplace_browse_rows(text,text,integer,integer,integer,boolean,uuid)',
    'marketplace_search_browse_rows(text,text,integer,integer,integer,boolean,uuid)',
    'explore_build_rows(text)',
    'explore_update_rows(text,text,text,integer,integer,integer,integer)',
    'explore_update_search_rows(text,text,text,integer,integer,integer,integer)'] loop
    if exists (select 1 from pg_proc p where p.oid = ('public.' || v_fn)::regprocedure and (p.prosecdef or p.proconfig is not null)) then
      raise exception '% must stay SECURITY INVOKER with no SET clause, or it stops being inlined', v_fn;
    end if;
  end loop;

  raise notice 'all search scale checks passed';
end $$;

rollback;
