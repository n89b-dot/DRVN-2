-- Marketplace pages read by position, counted up to a cap; the Explore wall
-- paged the same way.
--
-- Three changes, each because the old design costs more as the catalogue
-- grows (docs/performance/query-plans.md):
--
-- 1. A page is read from where the last one ended ("keyset" paging), not by
--    skipping the parts before it. Skipping N parts reads N parts, so page
--    1,000 cost 1,000 pages' worth of reading. marketplace_page takes the
--    last part shown (its date or price, and its id) and reads the next
--    page straight off an index. Old ?page=N links still work: a page with
--    no position skips as before, up to 10,000 parts deep (page 417); past
--    that it is empty and the app offers page one.
--
-- 2. Counting is capped. "Every part that matches" costs a read of every
--    part that matches. marketplace_count stops at 10,001, so a big result
--    reads at most that many; the page shows "10,000+ parts". The page
--    itself learns "is there another page?" by asking for one part more.
--
-- 3. The page is planned with the shopper's actual choices. PostgREST hands
--    a function's arguments to the planner as a joined row, so a plain SQL
--    function plans the same way for the most common car and a rare one.
--    marketplace_page is PL/pgSQL and writes its query with the values in
--    it (as literals, quoted by format()), so each request gets the plan
--    that suits it: a vehicle filter reads listing_vehicle_fit in order,
--    "fits my garage" reads one ordered slice per garage car and merges
--    them, a plain browse reads the listings index.
--
-- Order. To read a page off an index, the tie-break must run the same way
-- as the sort: newest is now (date desc, id desc) and dearest is (price
-- desc, id desc); cheapest stays (price asc, id asc). Only parts with the
-- exact same date or the exact same price can swap places, and only
-- against each other.
--
-- Both functions are SECURITY INVOKER: row security applies as the caller,
-- and they add only the browse function's own rules on top
-- (marketplace_pages_guard.sql holds them to marketplace_browse_rows).

-- Room on each page of parts for an update in place. A counted view changes
-- only the view counter, which no index holds, so with free space on its
-- page Postgres rewrites the row there (a "HOT" update) and touches none of
-- the table's ~20 indexes; on a full page every index gets a new entry, on
-- every counted view. Applies to pages written from now on.
alter table public.listings set (fillfactor = 90);

-- Cheapest and dearest first among parts for sale, read in order.
create index if not exists listings_active_price_idx
  on public.listings (price_cents, id) where status = 'active';
-- A brand, newest or by price first.
create index if not exists listings_active_brand_idx
  on public.listings (lower(brand), created_at desc, id desc) where status = 'active';
create index if not exists listings_active_brand_price_idx
  on public.listings (lower(brand), price_cents, id) where status = 'active';

-- ── The query, written once for both functions ──────────────────────────
-- Returns the FROM/WHERE of a marketplace query over the parts a caller may
-- browse, with every value quoted in. p_mode: 'page' or 'count'.
create or replace function public.marketplace_query_sql(
  p_mode text,
  p_query text, p_category text, p_subcategory text, p_condition text, p_brand text, p_location text,
  p_min_cents integer, p_max_cents integer,
  p_vehicle text, p_vyear integer, p_ymin integer, p_ymax integer, p_fit boolean,
  p_sort text, p_after_created timestamptz, p_after_price integer, p_after_id uuid, p_before boolean,
  p_offset integer, p_limit integer, p_cap integer)
returns text
language plpgsql
stable
set search_path to 'public', 'pg_temp'
as $function$
declare
  viewer uuid := auth.uid();
  sort text := case when p_sort in ('price_asc', 'price_desc') then p_sort else 'newest' end;
  lim integer := least(greatest(coalesce(p_limit, 25), 1), 101);
  skip integer := greatest(coalesce(p_offset, 0), 0);
  cap integer := least(greatest(coalesce(p_cap, 10001), 1), 100001);
  -- " or <column> = <viewer>", for the rules that let a member see their own.
  own text := case when viewer is null then '' else format(' or {col} = %L', viewer) end;
  make_name text;
  model_name text;
  filters text;
  fit_rule text;
  keyset text := '';
  order_by text;
  ascending boolean;
  garage record;
  arms text[] := '{}';
  slices text[] := '{}';
  arm text;
  body text;
  base_filters text;
  -- The same seller rule, on listing_vehicle_fit's own copy of the seller.
  fit_seller text;
begin
  -- Skipping is for old ?page=N links; past 10,000 parts it would be a slow
  -- read of everything before, so there is no page there (the app offers
  -- page one). Positions have no such limit.
  if coalesce(p_offset, 0) > 10000 then return null; end if;

  -- The browse function's rules: for sale, seller not suspended (or the
  -- viewer), plus whatever the shopper chose. Every value is quoted in.
  filters := ' and l.status = ''active'' and (l.seller_id not in (select public.suspended_profile_ids())'
    || replace(own, '{col}', 'l.seller_id') || ')';
  base_filters := filters;
  if coalesce(p_category, '') <> '' then filters := filters || format(' and l.category = %L', p_category); end if;
  if coalesce(p_subcategory, '') <> '' then filters := filters || format(' and l.subcategory = %L', p_subcategory); end if;
  if coalesce(p_condition, '') <> '' then filters := filters || format(' and l.condition = %L', p_condition); end if;
  -- The whole brand, whatever its case. The app's rule was ILIKE with the
  -- wildcards escaped; on a UTF-8 database ILIKE lower-cases both sides and
  -- compares, so this is the same test — one the planner can estimate (an
  -- ILIKE it guesses as rare, and at 2M parts it sorted every part for sale
  -- to find "Brembo", 22% of them) and listings_active_brand_idx answers.
  if coalesce(p_brand, '') <> '' then
    filters := filters || format(' and lower(l.brand) = lower(%L)', p_brand);
  end if;
  if coalesce(p_location, '') <> '' then
    filters := filters || format(' and l.location ilike %L', '%' || regexp_replace(p_location, '([\\%_])', '\\\1', 'g') || '%');
  end if;
  if p_min_cents is not null then filters := filters || format(' and l.price_cents >= %s', p_min_cents); end if;
  if p_max_cents is not null then filters := filters || format(' and l.price_cents <= %s', p_max_cents); end if;
  if not (coalesce(p_ymin, 0) = 0 and coalesce(p_ymax, 9999) = 9999) then
    filters := filters || format(
      ' and exists (select 1 from public.cars c where c.id = l.source_car_id and (c.is_public%s)'
      ' and (c.owner_id not in (select public.suspended_profile_ids())%s) and c.year between %s and %s)',
      replace(own, '{col}', 'c.owner_id'), replace(own, '{col}', 'c.owner_id'), coalesce(p_ymin, 0), coalesce(p_ymax, 9999));
  end if;
  if coalesce(trim(p_query), '') <> '' then
    filters := filters || format(' and l.id in (select public.marketplace_search_ids(%L))', p_query);
  end if;

  -- How a stated or source-car row decides a match (20261011100000).
  -- {years} is the stated rows' year test.
  fit_seller := ' and (v.seller_id not in (select public.suspended_profile_ids())' || replace(own, '{col}', 'v.seller_id') || ')';
  fit_rule := 'case when v.via = ''stated'' then {years} else not v.stated_also and (v.car_public'
    || replace(own, '{col}', 'v.car_owner_id') || ') and (v.car_owner_id = v.seller_id'
    || replace(own, '{col}', 'v.car_owner_id') || ' or v.car_owner_id not in (select public.suspended_profile_ids())) end';

  if coalesce(p_vehicle, '') <> '' then
    select m.name, mo.name into make_name, model_name
    from public.catalog_makes m
    left join public.catalog_models mo on mo.make_id = m.id
      and mo.id = case when p_vehicle ~ '^[1-9][0-9]{0,9}-[1-9][0-9]{0,9}$' then split_part(p_vehicle, '-', 2)::bigint else 0 end
    where m.id = case when p_vehicle ~ '^[1-9][0-9]{0,9}(-[1-9][0-9]{0,9})?$' then split_part(p_vehicle, '-', 1)::bigint else 0 end
      and (position('-' in p_vehicle) = 0 or mo.id is not null);
    if make_name is null then return null; end if; -- names no vehicle: nothing matches
  end if;

  -- "Fits my garage": one test per distinct garage car.
  if p_fit then
    for garage in
      select distinct lower(g.make) as make_key, lower(g.model) as model_key, coalesce(g.year, 0) as yr
      from public.cars g
      where g.owner_id = viewer and g.make is not null and g.model is not null
      order by 1, 2, 3
    loop
      arms := arms || (format('v.make_key = %L and v.model_key = %L and ', garage.make_key, garage.model_key)
        || replace(fit_rule, '{years}', case when garage.yr = 0 then 'v.all_years' else format('v.years @> %s', garage.yr) end));
    end loop;
    if cardinality(arms) = 0 then return null; end if; -- no garage: nothing fits
  end if;

  -- Order and keyset position, written over {t}.{id}: whichever table
  -- drives the read. Paging backwards reads the other way.
  if sort = 'newest' then
    ascending := coalesce(p_before, false);
    order_by := case when ascending then '{t}.created_at asc, {t}.{id} asc' else '{t}.created_at desc, {t}.{id} desc' end;
    if p_after_created is not null and p_after_id is not null then
      keyset := format(' and ({t}.created_at, {t}.{id}) %s (%L::timestamptz, %L::uuid)',
        case when ascending then '>' else '<' end, p_after_created, p_after_id);
    end if;
  else
    ascending := (sort = 'price_asc') <> coalesce(p_before, false);
    order_by := case when ascending then '{t}.price_cents asc, {t}.{id} asc' else '{t}.price_cents desc, {t}.{id} desc' end;
    if p_after_price is not null and p_after_id is not null then
      keyset := format(' and ({t}.price_cents, {t}.{id}) %s (%s, %L::uuid)',
        case when ascending then '>' else '<' end, p_after_price, p_after_id);
    end if;
  end if;

  if make_name is not null then
    -- Driven by the chosen vehicle's rows, in index order.
    body := format('from public.listing_vehicle_fit v join public.listings l on l.id = v.listing_id'
      ' where v.make_key = %L and v.model_key = %L and ', lower(make_name), coalesce(lower(model_name), ''))
      || replace(fit_rule, '{years}', case when coalesce(p_vyear, 0) = 0 then 'true' else format('v.years @> %s', p_vyear) end)
      || filters;
    if p_fit then
      body := body || ' and exists (select 1 from public.listing_vehicle_fit v where v.listing_id = l.id and (('
        || array_to_string(arms, ') or (') || ')))';
    end if;
    if p_mode = 'count' then
      -- Each row checks its own part by key, so the count stops at the cap;
      -- as a join the planner read every row for the vehicle, then every
      -- part for sale (3-21 s at 2M for the commonest car).
      -- With nothing but the vehicle chosen, the rows answer alone: a row
      -- exists only for a part for sale, and carries its seller.
      return format('select count(*)::integer from (select 1 from public.listing_vehicle_fit v'
        ' where v.make_key = %L and v.model_key = %L and %s%s limit %s) counted',
        lower(make_name), coalesce(lower(model_name), ''),
        replace(fit_rule, '{years}', case when coalesce(p_vyear, 0) = 0 then 'true' else format('v.years @> %s', p_vyear) end),
        case when filters = base_filters and not p_fit then fit_seller
             else ' and coalesce((select true from public.listings l where l.id = v.listing_id' || filters
                  || case when p_fit then ' and exists (select 1 from public.listing_vehicle_fit v where v.listing_id = l.id and (('
                                          || array_to_string(arms, ') or (') || ')))' else '' end
                  || '), false)' end,
        cap);
    end if;
    return format('select l.* %s%s order by %s limit %s offset %s', body,
      replace(replace(keyset, '{t}', 'v'), '{id}', 'listing_id'),
      replace(replace(order_by, '{t}', 'v'), '{id}', 'listing_id'), lim, skip);
  end if;

  if p_fit then
    -- One ordered slice per garage car, each as long as the page; the page
    -- is the best of them. A part fitting two cars is one part.
    foreach arm in array arms loop
      slices := slices || case when p_mode = 'count' then
        -- Counting: each row checks its own part by key (see the vehicle count).
        format('(select v.listing_id from public.listing_vehicle_fit v where %s%s limit %s)',
          arm, case when filters = base_filters then fit_seller
                    else ' and coalesce((select true from public.listings l where l.id = v.listing_id' || filters || '), false)' end, cap)
      else
        format('(select v.listing_id from public.listing_vehicle_fit v join public.listings l on l.id = v.listing_id where %s%s%s order by %s limit %s)',
          arm, filters, replace(replace(keyset, '{t}', 'v'), '{id}', 'listing_id'),
          replace(replace(order_by, '{t}', 'v'), '{id}', 'listing_id'), lim + skip)
      end;
    end loop;
    if p_mode = 'count' then
      return format('select count(*)::integer from (select distinct listing_id from (%s) s limit %s) counted',
        array_to_string(slices, ' union all '), cap);
    end if;
    return format('select l.* from public.listings l where l.id in (select listing_id from (%s) s)%s order by %s limit %s offset %s',
      array_to_string(slices, ' union all '), filters, replace(replace(order_by, '{t}', 'l'), '{id}', 'id'), lim, skip);
  end if;

  -- A plain browse, a filter or a search: the listings indexes.
  if p_mode = 'count' then
    return format('select count(*)::integer from (select 1 from public.listings l where true%s limit %s) counted', filters, cap);
  end if;
  return format('select l.* from public.listings l where true%s%s order by %s limit %s offset %s',
    filters, replace(replace(keyset, '{t}', 'l'), '{id}', 'id'), replace(replace(order_by, '{t}', 'l'), '{id}', 'id'), lim, skip);
end;
$function$;

-- One page of the marketplace, in the order asked for. Pass the last part
-- shown (p_after_created or p_after_price, and p_after_id) for the next page;
-- add p_before for the page before it (returned in reverse; the caller
-- flips it). Ask for one more than the page to learn whether there is a next.
create or replace function public.marketplace_page(
  p_query text default '', p_category text default '', p_subcategory text default '',
  p_condition text default '', p_brand text default '', p_location text default '',
  p_min_cents integer default null, p_max_cents integer default null,
  p_vehicle text default '', p_vyear integer default 0, p_ymin integer default 0, p_ymax integer default 9999,
  p_fit boolean default false, p_sort text default 'newest',
  p_after_created timestamptz default null, p_after_price integer default null, p_after_id uuid default null,
  p_before boolean default false, p_offset integer default 0, p_limit integer default 25)
returns setof public.listings
language plpgsql
stable
set search_path to 'public', 'pg_temp'
as $function$
declare
  sql text := public.marketplace_query_sql('page', p_query, p_category, p_subcategory, p_condition, p_brand, p_location,
    p_min_cents, p_max_cents, p_vehicle, p_vyear, p_ymin, p_ymax, p_fit,
    p_sort, p_after_created, p_after_price, p_after_id, p_before, p_offset, p_limit, null);
begin
  if sql is not null then
    return query execute sql;
  end if;
end;
$function$;

-- How many parts match, counted up to p_cap (10,001 unless asked otherwise):
-- a result of p_cap means "at least p_cap - 1 and more".
create or replace function public.marketplace_count(
  p_query text default '', p_category text default '', p_subcategory text default '',
  p_condition text default '', p_brand text default '', p_location text default '',
  p_min_cents integer default null, p_max_cents integer default null,
  p_vehicle text default '', p_vyear integer default 0, p_ymin integer default 0, p_ymax integer default 9999,
  p_fit boolean default false, p_cap integer default 10001)
returns integer
language plpgsql
stable
set search_path to 'public', 'pg_temp'
as $function$
declare
  sql text := public.marketplace_query_sql('count', p_query, p_category, p_subcategory, p_condition, p_brand, p_location,
    p_min_cents, p_max_cents, p_vehicle, p_vyear, p_ymin, p_ymax, p_fit,
    'newest', null, null, null, false, 0, 1, p_cap);
  total integer;
begin
  if sql is null then return 0; end if;
  execute sql into total;
  return total;
end;
$function$;

revoke all on function public.marketplace_query_sql(text,text,text,text,text,text,text,integer,integer,text,integer,integer,integer,boolean,text,timestamptz,integer,uuid,boolean,integer,integer,integer) from public;
revoke all on function public.marketplace_page(text,text,text,text,text,text,integer,integer,text,integer,integer,integer,boolean,text,timestamptz,integer,uuid,boolean,integer,integer) from public;
revoke all on function public.marketplace_count(text,text,text,text,text,text,integer,integer,text,integer,integer,integer,boolean,integer) from public;
grant execute on function public.marketplace_query_sql(text,text,text,text,text,text,text,integer,integer,text,integer,integer,integer,boolean,text,timestamptz,integer,uuid,boolean,integer,integer,integer) to anon, authenticated, service_role;
grant execute on function public.marketplace_page(text,text,text,text,text,text,integer,integer,text,integer,integer,integer,boolean,text,timestamptz,integer,uuid,boolean,integer,integer) to anon, authenticated, service_role;
grant execute on function public.marketplace_count(text,text,text,text,text,text,integer,integer,text,integer,integer,integer,boolean,integer) to anon, authenticated, service_role;
