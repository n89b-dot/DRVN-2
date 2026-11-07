-- N73 (production-readiness 2026-11-03): a part saved as a draft and
-- published later never reached a saved-search alert, and sat deep in
-- Newest, because both read created_at — when the draft was saved, not when
-- the part went on sale.
--
-- listings.published_at is when a part FIRST went on sale:
--   * set by the database, never by the writer: a part inserted for sale is
--     published as it is created (never later than now()); a draft is
--     published when it first becomes active; a value a writer sends is
--     ignored, so no one can date a part into the top of Newest;
--   * kept through pause, reserve and relist — "first", so pausing and
--     re-activating a part does not push it back to the top;
--   * null for a part that has never been on sale.
-- Existing parts that have left draft are backfilled from created_at, the
-- only evidence there is.
--
-- Newest and the saved-search window read it everywhere the order is made:
--   * marketplace_query_sql (marketplace_page / marketplace_count), restated
--     from 20261011130000 with only {t}.created_at -> {t}.published_at;
--   * marketplace_search_capped_ids (typed search, newest 1,001), restated
--     from 20261011130000 with only created_at -> published_at;
--   * listing_vehicle_fit's copy of the date (a vehicle or garage filter
--     reads in its index order): the column is renamed, and
--     refresh_listing_vehicle_fit / listing_vehicle_fit_from_listing and the
--     trigger, restated from 20261011100000, copy published_at;
--   * search_listing_documents (20261011130000) adds published_at_us for
--     the search engine's Newest (reindex once: scripts/reindex-search.mjs);
--   * the app's sort, page positions and the saved-search worker
--     (src/lib/marketplace/query.ts, api/jobs/saved-searches).
-- created_at keeps meaning "row created" (the seller's own lists, the feed).

begin;

-- 1. The column, backfilled without touching updated_at (the editor's
--    version token, RR-05): only the touch trigger is held off, inside this
--    transaction, which holds the table's lock throughout.
alter table public.listings add column if not exists published_at timestamptz;

alter table public.listings disable trigger listings_touch_updated_at;
update public.listings
   set published_at = least(created_at, now())
 where published_at is null and status <> 'draft';
alter table public.listings enable trigger listings_touch_updated_at;

-- 2. The database stamps it.
create or replace function public.stamp_listing_published_at()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
begin
  if tg_op = 'INSERT' then
    new.published_at := case when new.status = 'draft' then null else least(new.created_at, now()) end;
  elsif old.published_at is not null then
    new.published_at := old.published_at;
  elsif new.status = 'active' then
    new.published_at := now();
  else
    new.published_at := null;
  end if;
  return new;
end;
$function$;
revoke all on function public.stamp_listing_published_at() from public, anon, authenticated;

drop trigger if exists listings_published_at on public.listings;
create trigger listings_published_at
  before insert or update of status, published_at on public.listings
  for each row execute function public.stamp_listing_published_at();

-- 3. Newest first among parts for sale, overall and within a brand. The
--    brand index on created_at served only Newest and is replaced.
create index if not exists listings_active_published_idx
  on public.listings (published_at desc, id desc) where status = 'active';
create index if not exists listings_active_brand_published_idx
  on public.listings (brand_key, published_at desc, id desc) include (seller_id, status) where status = 'active';
drop index if exists public.listings_active_brand_idx;

-- 4. listing_vehicle_fit copies the date it is ordered by. Renaming the
--    column carries listing_vehicle_fit_newest_idx with it.
alter table public.listing_vehicle_fit rename column created_at to published_at;
-- The rows were copied from created_at, and the backfill above fires no
-- trigger: re-copy each from its part, so a part dated ahead (clamped to now
-- above) reads in the same order here as its page position says.
update public.listing_vehicle_fit v
   set published_at = l.published_at
  from public.listings l
 where l.id = v.listing_id and v.published_at is distinct from l.published_at;

create or replace function public.refresh_listing_vehicle_fit(p_listings uuid[], p_lock boolean default true)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  if p_lock then
    perform 1 from public.listings l where l.id = any(p_listings) order by l.id for update;
  end if;
  delete from public.listing_vehicle_fit where listing_id = any(p_listings);
  insert into public.listing_vehicle_fit
    (listing_id, make_key, model_key, via, years, all_years, stated_also, car_public, car_owner_id,
     seller_id, published_at, price_cents)
  with parts as (
    select l.id, l.seller_id, l.source_car_id, l.published_at, l.price_cents
    from public.listings l
    where l.id = any(p_listings) and l.status = 'active'
  ),
  stated as (
    select p.id, lower(f.make) as make_key, k.model_key,
           range_agg(int4range(f.year_start, f.year_end, '[]')) as years,
           bool_or(f.year_start is null and f.year_end is null) as all_years
    from parts p
    join public.listing_fitments f on f.listing_id = p.id
    cross join lateral (values (lower(f.model)), ('')) k(model_key)
    group by p.id, lower(f.make), k.model_key
  ),
  from_car as (
    select distinct p.id, lower(c.make) as make_key, k.model_key, c.is_public, c.owner_id
    from parts p
    join public.cars c on c.id = p.source_car_id
    cross join lateral (values (coalesce(lower(c.model), '')), ('')) k(model_key)
    where c.make is not null
  )
  select s.id, s.make_key, s.model_key, 'stated', s.years, s.all_years, false, true, null,
         p.seller_id, p.published_at, p.price_cents
  from stated s join parts p on p.id = s.id
  union all
  select c.id, c.make_key, c.model_key, 'car', null, false,
         s.id is not null,
         c.is_public, c.owner_id, p.seller_id, p.published_at, p.price_cents
  from from_car c
  join parts p on p.id = c.id
  -- A join, not a lookup per row: refreshing every part at once (the
  -- backfill) must stay linear.
  left join stated s on s.id = c.id and s.make_key = c.make_key and s.model_key = c.model_key;
end;
$function$;
revoke all on function public.refresh_listing_vehicle_fit(uuid[], boolean) from public, anon, authenticated;

create or replace function public.listing_vehicle_fit_from_listing()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  -- A new price, date or seller on a part still for sale off the same car:
  -- the rows stay, only those columns change (cheaper than recomputing).
  if tg_op = 'UPDATE' and old.status = new.status and old.source_car_id is not distinct from new.source_car_id then
    update public.listing_vehicle_fit
       set price_cents = new.price_cents, published_at = new.published_at, seller_id = new.seller_id
     where listing_id = new.id;
    return null;
  end if;
  perform public.refresh_listing_vehicle_fit(array[new.id]);
  return null;
end;
$function$;
revoke all on function public.listing_vehicle_fit_from_listing() from public, anon, authenticated;

drop trigger if exists listing_vehicle_fit_listing_update on public.listings;
create trigger listing_vehicle_fit_listing_update
  after update of status, seller_id, source_car_id, published_at, price_cents on public.listings
  for each row
  when ((old.status = 'active' or new.status = 'active')
        and (old.status is distinct from new.status or old.seller_id is distinct from new.seller_id
             or old.source_car_id is distinct from new.source_car_id
             or old.published_at is distinct from new.published_at or old.price_cents is distinct from new.price_cents))
  execute function public.listing_vehicle_fit_from_listing();

-- 5. Typed search: the newest 1,001 matches by publication.
create or replace function public.marketplace_search_capped_ids(
  p_query text, p_category text default '', p_subcategory text default '', p_condition text default '',
  p_brand text default '', p_location text default '', p_min_cents integer default null, p_max_cents integer default null,
  p_cap integer default 1001)
returns setof uuid
language plpgsql
stable
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $function$
declare
  cap integer := least(greatest(coalesce(p_cap, 1001), 1), 5001);
  term text := trim(regexp_replace(coalesce(p_query, ''), '[,()]', ' ', 'g'));
  compact text := lower(regexp_replace(term, '[^a-zA-Z0-9]', '', 'g'));
  identifier boolean;
  terms text[];
  numbered uuid[];
  filters text;
  matches text;
  window_size integer := 30000;
  found uuid[];
  scanned integer;
begin
  if term = '' then return; end if;
  -- marketplace_search_ids' rules: a single token of five or more letters
  -- and digits, two of them digits, is a part number and nothing else.
  identifier := term !~ '\s' and length(compact) >= 5 and length(regexp_replace(compact, '[^0-9]', '', 'g')) >= 2;
  terms := array(select distinct t from regexp_split_to_table(lower(term), '\s+') t where length(t) >= 1);
  -- A word not on search_words is searched alongside its closest word.
  terms := terms || array(select c.correction from public.search_word_corrections(term) c where c.correction <> all(terms));
  -- The part numbers (and their interchange numbers) the query could be.
  if length(compact) >= 4 and compact ~ '[0-9]' then
    numbered := array(
      with variants as (
        select compact as v
        union
        select case when k.from_compact = compact then k.to_compact else k.from_compact end
        from public.part_number_links k where k.from_compact = compact or k.to_compact = compact)
      select l.id from variants v join public.listings l on l.part_number_compact like '%' || v.v || '%'
      union
      select n.listing_id from variants v join public.listing_part_numbers n on n.number_compact = v.v);
  else
    numbered := '{}';
  end if;

  -- The visitor's read rule and the shopper's filters, values quoted in.
  filters := ' and l.status = ''active'' and l.seller_id not in (select public.suspended_profile_ids())';
  if coalesce(p_category, '') <> '' then filters := filters || format(' and l.category = %L', p_category); end if;
  if coalesce(p_subcategory, '') <> '' then filters := filters || format(' and l.subcategory = %L', p_subcategory); end if;
  if coalesce(p_condition, '') <> '' then filters := filters || format(' and l.condition = %L', p_condition); end if;
  -- The whole brand, whatever its case (see marketplace_query_sql).
  if coalesce(p_brand, '') <> '' then
    filters := filters || format(' and l.brand_key = %L', lower(p_brand));
  end if;
  if coalesce(p_location, '') <> '' then
    filters := filters || format(' and l.location ilike %L', '%' || regexp_replace(p_location, '([\\%_])', '\\\1', 'g') || '%');
  end if;
  if p_min_cents is not null then filters := filters || format(' and l.price_cents >= %s', p_min_cents); end if;
  if p_max_cents is not null then filters := filters || format(' and l.price_cents <= %s', p_max_cents); end if;

  -- What the words match: any word (or its correction, above), in the
  -- part's search document (search_listing_ids' first rule), or one of the
  -- numbers. A part number is matched by its numbers alone. Unlike
  -- search_listing_ids, a word is not also matched "close to" a word of the
  -- title: that test read thousands of near-miss titles from disk for one
  -- ordinary word (it timed out at 2M parts).
  matches := case when cardinality(numbered) > 0 then format('l.id = any(%L::uuid[])', numbered) else 'false' end;
  if not identifier then
    matches := matches || ' or ' || (
      select string_agg(format('public.listing_search_doc(l.title, l.description, l.compatibility_notes, l.category, l.brand) ilike %L', '%' || t || '%'), ' or ')
      from unnest(terms) t);
  end if;

  -- Newest (first published) first through the parts the filters allow,
  -- stopping at the cap:
  -- a common word fills it within a few thousand parts.
  execute format(
    'select array_agg(id) from (select l.id from (select l.* from public.listings l where true%s'
    ' order by l.published_at desc, l.id desc limit %s) l where %s limit %s) hits',
    filters, window_size, matches, cap)
    into found;
  found := coalesce(found, '{}');
  if cardinality(found) >= cap then
    return query select unnest(found);
    return;
  end if;
  -- Fewer than the cap in the window: if the window held every part the
  -- filters allow, that is the whole answer.
  execute format('select count(*) from (select 1 from public.listings l where true%s limit %s) w', filters, window_size)
    into scanned;
  if scanned < window_size then
    return query select unnest(found);
    return;
  end if;
  -- Sparse among the newest: every match through the word index, then
  -- newest first among those. The fence (offset 0) keeps the planner from
  -- walking every part newest-first instead — it guesses a word is common,
  -- and at 2M parts that read 150,000 parts from disk for one word.
  return query execute format(
    'select m.id from (select l.id, l.published_at from public.listings l where (%s)%s offset 0) m'
    ' order by m.published_at desc, m.id desc limit %s',
    matches, filters, cap);
end;
$function$;
alter function public.marketplace_search_capped_ids(text,text,text,text,text,text,integer,integer,integer) rows 1001;

-- 6. Pages and counts.
create or replace function public.marketplace_query_sql(
  p_mode text,
  p_query text, p_category text, p_subcategory text, p_condition text, p_brand text, p_location text,
  p_min_cents integer, p_max_cents integer,
  p_vehicle text, p_vyear integer, p_ymin integer, p_ymax integer, p_fit boolean,
  p_sort text, p_after_created timestamptz, p_after_price integer, p_after_id uuid, p_before boolean,
  p_offset integer, p_limit integer, p_cap integer, p_ids uuid[] default null)
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
  -- The ids a typed search matched, as a subquery (Postgres' capped search).
  searched text;
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
  -- compares, so brand_key = lower(the brand) is the same test — one the
  -- planner can estimate and, under row security, answer from
  -- listings_active_brand_published_idx (ILIKE and lower() can't use an index there).
  if coalesce(p_brand, '') <> '' then
    filters := filters || format(' and l.brand_key = %L', lower(p_brand));
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
  -- A page the search engine found: those ids, still passing every rule.
  -- Otherwise a typed search is Postgres' own, capped at the newest 1,001
  -- matches among what the filters allow (marketplace_search_capped_ids).
  if p_ids is not null then
    filters := filters || format(' and l.id = any(%L::uuid[])', p_ids);
  elsif coalesce(trim(p_query), '') <> '' then
    searched := format('(select x.id from public.marketplace_search_capped_ids(%L, %L, %L, %L, %L, %L, %s, %s) x(id))',
      p_query, coalesce(p_category, ''), coalesce(p_subcategory, ''), coalesce(p_condition, ''), coalesce(p_brand, ''),
      coalesce(p_location, ''), coalesce(p_min_cents::text, 'null'), coalesce(p_max_cents::text, 'null'));
    -- A plain search reads from the matched ids (below); a search with a
    -- vehicle or a garage tests each candidate against them.
    if coalesce(p_vehicle, '') <> '' or p_fit then
      filters := filters || ' and l.id in ' || searched;
    end if;
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
  -- drives the read. Paging backwards reads the other way. Newest is by
  -- when a part first went on sale (published_at, 20261107153200), so
  -- p_after_created is the position part's published_at.
  if sort = 'newest' then
    ascending := coalesce(p_before, false);
    order_by := case when ascending then '{t}.published_at asc, {t}.{id} asc' else '{t}.published_at desc, {t}.{id} desc' end;
    if p_after_created is not null and p_after_id is not null then
      keyset := format(' and ({t}.published_at, {t}.{id}) %s (%L::timestamptz, %L::uuid)',
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

  if p_ids is not null then
    -- The engine's page: at most a page of ids, so the rules are tests on
    -- those rows, and the engine's order stands.
    body := 'from public.listings l where true' || filters;
    if make_name is not null then
      body := body || format(' and exists (select 1 from public.listing_vehicle_fit v where v.listing_id = l.id'
        ' and v.make_key = %L and v.model_key = %L and ', lower(make_name), coalesce(lower(model_name), ''))
        || replace(fit_rule, '{years}', case when coalesce(p_vyear, 0) = 0 then 'true' else format('v.years @> %s', p_vyear) end) || ')';
    end if;
    if p_fit then
      body := body || ' and exists (select 1 from public.listing_vehicle_fit v where v.listing_id = l.id and (('
        || array_to_string(arms, ') or (') || ')))';
    end if;
    if p_mode = 'count' then
      return format('select count(*)::integer from (select 1 %s limit %s) counted', body, cap);
    end if;
    return format('select l.* %s order by array_position(%L::uuid[], l.id) limit %s', body, p_ids, lim);
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

  -- A plain browse or a filter: the listings indexes. A search: its matched
  -- ids (at most 1,001), each read by key — walking parts in order looking
  -- for them read deep into the catalogue for a word that matches few.
  if p_mode = 'count' then
    return format('select count(*)::integer from (select 1 from %s where true%s limit %s) counted',
      coalesce(searched || ' s join public.listings l on l.id = s.id', 'public.listings l'), filters, cap);
  end if;
  return format('select l.* from %s where true%s%s order by %s limit %s offset %s',
    coalesce(searched || ' s join public.listings l on l.id = s.id', 'public.listings l'),
    filters, replace(replace(keyset, '{t}', 'l'), '{id}', 'id'), replace(replace(order_by, '{t}', 'l'), '{id}', 'id'), lim, skip);
end;
$function$;

-- 7. The engine's documents carry the publication time.
create or replace function public.search_listing_documents(p_ids uuid[])
returns table(id uuid, doc jsonb)
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  select l.id, jsonb_build_object(
    'id', l.id::text,
    'sort_id', l.id::text,
    'title', l.title,
    'description', coalesce(l.description, ''),
    'compatibility_notes', coalesce(l.compatibility_notes, ''),
    'part_numbers', array_remove(array[l.part_number, l.part_number_compact], null)
                    || coalesce((select array_agg(n.number order by n.number) from public.listing_part_numbers n where n.listing_id = l.id), '{}'),
    'category', l.category,
    'subcategory', coalesce(l.subcategory, ''),
    'brand', coalesce(l.brand, ''),
    'brand_key', lower(coalesce(l.brand, '')),
    'condition', coalesce(l.condition, ''),
    'status', l.status,
    'price_cents', l.price_cents,
    'created_at_unix', extract(epoch from l.created_at)::bigint,
    'created_at_us', (extract(epoch from l.created_at) * 1000000)::bigint,
    'published_at_us', (extract(epoch from l.published_at) * 1000000)::bigint,
    'seller_id', l.seller_id::text,
    'source_car', case when c.is_public then concat_ws(' ', c.year, c.make, c.model) else '' end,
    'source_car_public', coalesce(c.is_public, false),
    'source_car_year', case when c.is_public then c.year end,
    'fitment', coalesce((select array_agg(concat_ws(' ', f.make, f.model, f.year_start, f.year_end) order by f.id) from public.listing_fitments f where f.listing_id = l.id), '{}'),
    'fit_keys', array(select distinct v.make_key || '|' || v.model_key from public.listing_vehicle_fit v
                       where v.listing_id = l.id and (v.via = 'stated' or (v.car_public and not v.stated_also)) order by 1),
    'fit_any_year', array(select distinct v.make_key || '|' || v.model_key from public.listing_vehicle_fit v
                           where v.listing_id = l.id and v.via = 'car' and v.car_public and not v.stated_also order by 1),
    'fit_year_keys', array(select distinct v.make_key || '|' || v.model_key || '|' || y
                            from public.listing_vehicle_fit v cross join generate_series(1950, 2030) y
                            where v.listing_id = l.id and v.via = 'stated' and v.years @> y order by 1))
  from public.listings l
  left join public.cars c on c.id = l.source_car_id
  where l.id = any(p_ids) and l.status = 'active'
    and l.seller_id not in (select public.suspended_profile_ids());
$function$;
revoke all on function public.search_listing_documents(uuid[]) from public, anon, authenticated;
grant execute on function public.search_listing_documents(uuid[]) to service_role;

commit;
