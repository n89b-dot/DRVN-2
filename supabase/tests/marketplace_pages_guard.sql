-- Marketplace pages read by position, counts capped (migration
-- 20261011110000). Transactional; disposable local database only.
--
-- marketplace_page writes its query with the shopper's values in it, so this
-- holds three things: it returns exactly the parts marketplace_browse_rows
-- does, page by page, whether paged by skipping or by position, forwards or
-- back; marketplace_count is the exact count up to its cap; and no value a
-- shopper can type changes the query's shape (quotes, wildcards, backslashes).
-- scripts/perf/compare-pages.sql runs the same comparison at volume.
begin;

create function pg_temp.ref_page(f jsonb, sort text, skip int, lim int) returns uuid[] language plpgsql as $$
declare
  sql text := 'select coalesce(array_agg(id), ''{}'') from (select l.id from public.marketplace_browse_rows('
    || format('p_query => %L, p_vehicle => %L, p_vyear => %s, p_fit => %s',
         coalesce(f->>'q', ''), coalesce(f->>'vehicle', ''), coalesce(f->>'vyear', '0'), coalesce(f->>'fit', 'false'))
    || ') l where true';
  result uuid[];
begin
  if f ? 'category' then sql := sql || format(' and l.category = %L', f->>'category'); end if;
  if f ? 'condition' then sql := sql || format(' and l.condition = %L', f->>'condition'); end if;
  if f ? 'brand' then sql := sql || format(' and l.brand ilike %L', regexp_replace(f->>'brand', '([\\%_])', '\\\1', 'g')); end if;
  if f ? 'location' then sql := sql || format(' and l.location ilike %L', '%' || regexp_replace(f->>'location', '([\\%_])', '\\\1', 'g') || '%'); end if;
  if f ? 'min' then sql := sql || format(' and l.price_cents >= %s', f->>'min'); end if;
  sql := sql || case sort when 'price_asc' then ' order by l.price_cents asc, l.id asc'
                          when 'price_desc' then ' order by l.price_cents desc, l.id desc'
                          else ' order by l.published_at desc, l.id desc' end
             || format(' limit %s offset %s) s', lim, skip);
  execute sql into result;
  return result;
end $$;

create function pg_temp.new_page(f jsonb, sort text, skip int, lim int, pos uuid, before boolean) returns uuid[] language sql as $$
  select coalesce(array_agg(id), '{}') from public.marketplace_page(
    p_query => coalesce(f->>'q', ''), p_category => coalesce(f->>'category', ''), p_condition => coalesce(f->>'condition', ''),
    p_brand => coalesce(f->>'brand', ''), p_location => coalesce(f->>'location', ''), p_min_cents => (f->>'min')::int,
    p_vehicle => coalesce(f->>'vehicle', ''), p_vyear => coalesce((f->>'vyear')::int, 0), p_fit => coalesce((f->>'fit')::boolean, false),
    p_sort => sort,
    p_after_created => (select published_at from public.listings where id = pos),
    p_after_price => (select price_cents from public.listings where id = pos),
    p_after_id => pos, p_before => before, p_offset => skip, p_limit => lim)
$$;

create function pg_temp.new_count(f jsonb, cap int) returns int language sql as $$
  select public.marketplace_count(
    p_query => coalesce(f->>'q', ''), p_category => coalesce(f->>'category', ''), p_condition => coalesce(f->>'condition', ''),
    p_brand => coalesce(f->>'brand', ''), p_location => coalesce(f->>'location', ''), p_min_cents => (f->>'min')::int,
    p_vehicle => coalesce(f->>'vehicle', ''), p_vyear => coalesce((f->>'vyear')::int, 0), p_fit => coalesce((f->>'fit')::boolean, false),
    p_cap => cap)
$$;

do $$
declare
  v_seller uuid := gen_random_uuid();
  v_suspended uuid := gen_random_uuid();
  v_viewer uuid := gen_random_uuid();
  v_car uuid := gen_random_uuid();
  v_make bigint; v_model bigint;
  combos jsonb[];
  f jsonb; who text; sort text;
  ref uuid[]; got uuid[]; walk uuid[]; step uuid[];
  checks int := 0;
  stamp timestamptz := now() - interval '1 day';
begin
  update public.beta_access_config set enforced = false where singleton;
  insert into auth.users(id, email) values
    (v_seller, 'pages-seller@drvn.test'), (v_suspended, 'pages-suspended@drvn.test'), (v_viewer, 'pages-viewer@drvn.test');
  insert into public.profiles(id, username) values
    (v_seller, 'pages_seller'), (v_suspended, 'pages_suspended'), (v_viewer, 'pages_viewer')
    on conflict (id) do update set username = excluded.username;
  insert into public.catalog_makes(name) values ('Zzpmake') returning id into v_make;
  insert into public.catalog_models(make_id, name) values (v_make, 'Zzpmodel') returning id into v_model;
  insert into public.cars(id, owner_id, slug, name, make, model, year, is_public) values
    (v_car, v_seller, 'pages-car', 'Pages car', 'Zzpmake', 'Zzpmodel', 2010, true);
  insert into public.cars(owner_id, slug, name, make, model, year, is_public) values
    (v_viewer, 'pages-garage', 'Pages garage', 'Zzpmake', 'Zzpmodel', 2010, true);

  -- Twenty-two parts: shared dates and shared prices (the tie-break must
  -- hold), awkward brands and places, a draft and a suspended seller's part.
  insert into public.listings(seller_id, source_car_id, title, category, condition, price_cents, currency, status, brand, location, created_at)
  select v_seller, case when n % 2 = 0 then v_car end, 'Zzpage part ' || n,
         (array['performance','engine'])[1 + n % 2], (array['new','used'])[1 + n % 2],
         1000 * (1 + n % 4), 'USD', 'active',
         (array['Zzp%brand', 'Zzp_brand', 'O''Zzp', 'Zzp\brand'])[1 + n % 4],
         (array['Leeds, UK', 'St. Zzp''s', '100% Zzp'])[1 + n % 3],
         stamp - (n / 3) * interval '1 hour'
  from generate_series(1, 22) n;
  -- Sold and reserved parts are readable by anyone, so only the page's own
  -- "for sale" rule keeps them out of the marketplace.
  insert into public.listings(seller_id, title, category, price_cents, currency, status, brand) values
    (v_seller, 'Zzpage draft', 'engine', 1000, 'USD', 'draft', 'Zzp%brand'),
    (v_seller, 'Zzpage sold', 'engine', 1000, 'USD', 'sold', 'Zzp%brand'),
    (v_seller, 'Zzpage reserved', 'performance', 3000, 'USD', 'reserved', 'Zzp_brand'),
    (v_suspended, 'Zzpage suspended', 'engine', 1000, 'USD', 'active', 'Zzp%brand');
  update public.profiles set suspended_at = now(), suspended_reason = 'guard' where id = v_suspended;

  combos := array['{"q":"zzpage"}', '{"q":"zzpage","category":"engine"}', '{"q":"zzpage","brand":"zzp%brand"}',
    '{"q":"zzpage","brand":"Zzp_brand"}', '{"q":"zzpage","brand":"O''Zzp"}', '{"q":"zzpage","brand":"zzp\\brand"}',
    '{"q":"zzpage","location":"st. zzp''s"}', '{"q":"zzpage","location":"100%"}', '{"q":"zzpage","min":3000}',
    '{"q":"zzpage","condition":"used"}', '{"vehicle":"__V__"}', '{"vehicle":"__V__","vyear":2010}', '{"fit":true}',
    '{"fit":true,"q":"zzpage","category":"performance"}']::jsonb[];

  foreach who in array array['anon', 'member'] loop
    perform set_config('role', case who when 'anon' then 'anon' else 'authenticated' end, true);
    perform set_config('request.jwt.claims', case who when 'member' then json_build_object('sub', v_viewer, 'role', 'authenticated')::text else '' end, true);
    foreach f in array combos loop
      f := replace(f::text, '__V__', v_make || '-' || v_model)::jsonb;
      if who = 'anon' and f ? 'fit' then continue; end if;
      -- 1. Counts: exact under the cap, the cap above it.
      ref := pg_temp.ref_page(f, 'newest', 0, 1000);
      if pg_temp.new_count(f, 10001) <> cardinality(ref) or pg_temp.new_count(f, 5) <> least(cardinality(ref), 5) then
        raise exception '% %: count % (cap 5: %) but % parts match', who, f, pg_temp.new_count(f, 10001), pg_temp.new_count(f, 5), cardinality(ref);
      end if;
      if f ? 'vehicle' or (f ? 'q' and not f ? 'brand' and not f ? 'location' and not f ? 'condition' and not f ? 'min') then
        if cardinality(ref) < 2 then raise exception '% %: the guard data should match more than one part', who, f; end if;
      end if;
      checks := checks + 1;
      foreach sort in array array['newest', 'price_asc', 'price_desc'] loop
        -- 2. Pages by skipping.
        for skip in 0..2 loop
          ref := pg_temp.ref_page(f, sort, skip * 4, 4);
          got := pg_temp.new_page(f, sort, skip * 4, 4, null, false);
          if ref <> got then raise exception '% % % page %: % but browse gives %', who, f, sort, skip + 1, got, ref; end if;
          checks := checks + 1;
        end loop;
        -- 3. Pages by position, forwards to the end, then back one.
        ref := pg_temp.ref_page(f, sort, 0, 1000);
        walk := '{}';
        step := pg_temp.new_page(f, sort, 0, 4, null, false);
        while cardinality(step) > 0 loop
          walk := walk || step;
          step := pg_temp.new_page(f, sort, 0, 4, walk[cardinality(walk)], false);
        end loop;
        if walk <> ref then raise exception '% % %: by position % but browse gives %', who, f, sort, walk, ref; end if;
        if cardinality(walk) > 8 then
          step := pg_temp.new_page(f, sort, 0, 4, walk[9], true);
          if array(select x from unnest(step) with ordinality u(x, o) order by o desc) <> walk[5:8] then
            raise exception '% % %: paging back by position gave %', who, f, sort, step;
          end if;
        end if;
        checks := checks + 2;
      end loop;
    end loop;
  end loop;
  perform set_config('role', 'anon', true);
  perform set_config('request.jwt.claims', '', true);

  -- 4. What a shopper types cannot change the query.
  if exists (select 1 from public.marketplace_page(p_brand => $q$x' or 1=1 --$q$))
     or exists (select 1 from public.marketplace_page(p_location => $q$x') or (1=1$q$))
     or exists (select 1 from public.marketplace_page(p_query => $q$zzpage' or 'a'='a$q$, p_category => $q$engine' or true or 'x$q$))
     or public.marketplace_count(p_brand => $q$'; select 1; --$q$) <> 0 then
    raise exception 'A quote in a filter changed the marketplace query';
  end if;
  if exists (select 1 from public.marketplace_page(p_brand => '%')) then
    raise exception 'A wildcard brand matched every brand';
  end if;

  -- 5. No draft, no suspended seller's part; nothing past 10,000 skipped.
  if exists (select 1 from public.marketplace_page(p_query => 'zzpage', p_limit => 100) where title in ('Zzpage draft', 'Zzpage suspended')) then
    raise exception 'marketplace_page showed a draft or a suspended seller''s part';
  end if;
  if exists (select 1 from public.marketplace_page(p_offset => 10001)) then
    raise exception 'A skip past 10,000 parts should return no page';
  end if;
  -- Row security does not apply to the service role, so the page's own
  -- rules are all that stand here.
  perform set_config('role', 'service_role', true);
  -- (A brand, not a search: the search functions apply the same rules
  -- themselves and would hide a missing one here.)
  if exists (select 1 from public.marketplace_page(p_brand => 'Zzp%brand', p_limit => 100) where title in ('Zzpage draft', 'Zzpage suspended', 'Zzpage sold', 'Zzpage reserved'))
     or public.marketplace_count(p_brand => 'Zzp%brand') <> 5 then
    raise exception 'Without row security, marketplace_page shows parts that are not for sale or whose seller is suspended';
  end if;
  perform set_config('role', 'supabase_admin', true);

  -- 6. Invoker: row security applies as the caller.
  if exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace
             and proname in ('marketplace_page', 'marketplace_count', 'marketplace_query_sql') and prosecdef) then
    raise exception 'marketplace_page and marketplace_count must be SECURITY INVOKER';
  end if;

  raise notice 'all marketplace pages checks passed (% comparisons)', checks;
end $$;

rollback;
