-- Text search at millions of parts: the search engine answers, Postgres
-- re-checks the page, and Postgres' own search is capped for when the
-- engine is away.
--
-- 1. Postgres' search, capped. marketplace_search_ids finds every part a
--    word matches and the page then sorts them: for a word in one title in
--    four that is 500,000 parts at 2M, and it timed out. Searching is now
--    "the newest 1,001 parts the words match, among the parts the shopper's
--    filters allow" (marketplace_search_capped_ids). Read newest-first, a
--    common word fills 1,001 within a few thousand parts; a rare one is
--    answered from the word index, where it matches few. The first 1,000
--    results are exactly what the uncapped search showed newest-first; a
--    search matching more says "1,000+" and stops there. Sorting such a
--    search by price sorts those 1,000.
--
--    The capped search matches words as typed (anywhere in the part's
--    search document), without the old "close to a title word" typo test,
--    which was the slow part. Typos are forgiven another way: search_words
--    lists every word of four letters or more in the titles and brands of
--    parts for sale (refreshed hourly by pg_cron), and a query word that
--    isn't on it is searched alongside the closest word that is
--    ("brmbo" also searches "brembo"). The word as typed is still searched,
--    so a word too new for the list loses nothing. search_word_corrections
--    returns those pairs so the page can say "Including results for …".
--    THE EXPOSURE: words that appear in titles and brands of parts for sale,
--    which anyone can already read.
--
--    marketplace_search_capped_ids is SECURITY DEFINER for the same reason
--    as search_listing_ids (20261010100100): under row security a text
--    match cannot use the word index. It applies the signed-out read rule
--    itself (for sale, seller not suspended) and returns ids only; the page
--    re-reads them under the caller's row security. THE EXPOSURE: ids of
--    parts for sale matching a search and filters a visitor can already
--    apply — what marketplace_search_ids already returns, fewer of them.
--
-- 2. The engine's page, re-checked. marketplace_page and marketplace_count
--    take p_ids: the page of ids the engine found, in its order. Postgres
--    returns those that still pass every rule, as the caller may see them.
--
-- 3. The search queue follows what the documents hold, no more. Every
--    update to a part queued it for re-indexing — each counted page view
--    (the view counter) included — and any profile edit queued every part,
--    car and update its owner has. Updates now queue only when a field a
--    document holds changes; a profile's parts, cars and updates only when
--    the profile's suspension changes. A car's parts are queued when the
--    car's make, model, year or visibility changes (they carry it; before,
--    nothing re-indexed them).
--
-- Guard: supabase/tests/search_engine_guard.sql.

do $$ begin perform show_trgm('drvn'); end $$; -- see 20261010100100

-- ── 1. Capped Postgres search ────────────────────────────────────────────

-- The words a query may be corrected to: four to thirty letters, from the
-- titles and brands of parts for sale (no digits: part numbers have their
-- own lookup). 27,000 words at 2M parts; a refresh reads every part for sale
-- once (about 16 s at 2M on a laptop), so it runs hourly.
create table if not exists public.search_words (
  word text primary key,
  uses integer not null
);
alter table public.search_words enable row level security; -- no policies: read through search_word_corrections only
revoke all on public.search_words from anon, authenticated;
create index if not exists search_words_trgm_idx on public.search_words using gist (word gist_trgm_ops);

create or replace function public.refresh_search_words()
returns void
language sql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $function$
  with fresh as (
    select w.word, count(*)::integer as uses
    from public.listings l
    cross join lateral regexp_split_to_table(lower(coalesce(l.title, '') || ' ' || coalesce(l.brand, '')), '[^[:alpha:]]+') w(word)
    where l.status = 'active' and l.seller_id not in (select public.suspended_profile_ids())
      and length(w.word) between 4 and 30
    group by w.word
  ),
  gone as (
    delete from public.search_words t where t.word not in (select f.word from fresh f)
  )
  insert into public.search_words (word, uses)
  select word, uses from fresh
  on conflict (word) do update set uses = excluded.uses
  where public.search_words.uses is distinct from excluded.uses;
$function$;
revoke all on function public.refresh_search_words() from public, anon, authenticated;

-- Each word of the query (four letters or more, no digits) that isn't on the
-- list, with the closest word that is, when they share enough letter
-- triples (similarity 0.35: "bilstien" -> "bilstein" is 0.38, "brmbo" ->
-- "brembo" 0.44). A nearest-word lookup on the trigram index: ~5 ms.
create or replace function public.search_word_corrections(p_query text)
returns table(word text, correction text)
language sql
stable
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $function$
  select q.word, c.word
  from (select distinct t as word
        from regexp_split_to_table(lower(left(coalesce(p_query, ''), 200)), '\s+') t
        where t ~ '^[[:alpha:]]{4,30}$'
        limit 8) q
  cross join lateral (
    select s.word from public.search_words s
    order by s.word <-> q.word, s.uses desc
    limit 1) c
  where not exists (select 1 from public.search_words s where s.word = q.word)
    and similarity(c.word, q.word) >= 0.35;
$function$;
revoke all on function public.search_word_corrections(text) from public;
grant execute on function public.search_word_corrections(text) to anon, authenticated, service_role;


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

  -- Newest first through the parts the filters allow, stopping at the cap:
  -- a common word fills it within a few thousand parts.
  execute format(
    'select array_agg(id) from (select l.id from (select l.* from public.listings l where true%s'
    ' order by l.created_at desc, l.id desc limit %s) l where %s limit %s) hits',
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
    'select m.id from (select l.id, l.created_at from public.listings l where (%s)%s offset 0) m'
    ' order by m.created_at desc, m.id desc limit %s',
    matches, filters, cap);
end;
$function$;
revoke all on function public.marketplace_search_capped_ids(text,text,text,text,text,text,integer,integer,integer) from public;
grant execute on function public.marketplace_search_capped_ids(text,text,text,text,text,text,integer,integer,integer) to anon, authenticated, service_role;
alter function public.marketplace_search_capped_ids(text,text,text,text,text,text,integer,integer,integer) rows 1001;


-- ── 2. The engine's page, re-checked; capped search in pages and counts ─
-- Restated from 20261011110000 with p_ids added and typed searches sent to
-- the capped search; nothing else changes.

drop function if exists public.marketplace_query_sql(text,text,text,text,text,text,text,integer,integer,text,integer,integer,integer,boolean,text,timestamptz,integer,uuid,boolean,integer,integer,integer);
drop function if exists public.marketplace_page(text,text,text,text,text,text,integer,integer,text,integer,integer,integer,boolean,text,timestamptz,integer,uuid,boolean,integer,integer);
drop function if exists public.marketplace_count(text,text,text,text,text,text,integer,integer,text,integer,integer,integer,boolean,integer);

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
  -- listings_active_brand_idx (ILIKE and lower() can't use an index there).
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

create or replace function public.marketplace_page(
  p_query text default '', p_category text default '', p_subcategory text default '',
  p_condition text default '', p_brand text default '', p_location text default '',
  p_min_cents integer default null, p_max_cents integer default null,
  p_vehicle text default '', p_vyear integer default 0, p_ymin integer default 0, p_ymax integer default 9999,
  p_fit boolean default false, p_sort text default 'newest',
  p_after_created timestamptz default null, p_after_price integer default null, p_after_id uuid default null,
  p_before boolean default false, p_offset integer default 0, p_limit integer default 25, p_ids uuid[] default null)
returns setof public.listings
language plpgsql
stable
set search_path to 'public', 'pg_temp'
as $function$
declare
  sql text := public.marketplace_query_sql('page', p_query, p_category, p_subcategory, p_condition, p_brand, p_location,
    p_min_cents, p_max_cents, p_vehicle, p_vyear, p_ymin, p_ymax, p_fit,
    p_sort, p_after_created, p_after_price, p_after_id, p_before, p_offset, p_limit, null, p_ids);
begin
  if sql is not null then
    return query execute sql;
  end if;
end;
$function$;

create or replace function public.marketplace_count(
  p_query text default '', p_category text default '', p_subcategory text default '',
  p_condition text default '', p_brand text default '', p_location text default '',
  p_min_cents integer default null, p_max_cents integer default null,
  p_vehicle text default '', p_vyear integer default 0, p_ymin integer default 0, p_ymax integer default 9999,
  p_fit boolean default false, p_cap integer default 10001, p_ids uuid[] default null)
returns integer
language plpgsql
stable
set search_path to 'public', 'pg_temp'
as $function$
declare
  sql text := public.marketplace_query_sql('count', p_query, p_category, p_subcategory, p_condition, p_brand, p_location,
    p_min_cents, p_max_cents, p_vehicle, p_vyear, p_ymin, p_ymax, p_fit,
    'newest', null, null, null, false, 0, 1, p_cap, p_ids);
  total integer;
begin
  if sql is null then return 0; end if;
  execute sql into total;
  return total;
end;
$function$;

revoke all on function public.marketplace_query_sql(text,text,text,text,text,text,text,integer,integer,text,integer,integer,integer,boolean,text,timestamptz,integer,uuid,boolean,integer,integer,integer,uuid[]) from public;
revoke all on function public.marketplace_page(text,text,text,text,text,text,integer,integer,text,integer,integer,integer,boolean,text,timestamptz,integer,uuid,boolean,integer,integer,uuid[]) from public;
revoke all on function public.marketplace_count(text,text,text,text,text,text,integer,integer,text,integer,integer,integer,boolean,integer,uuid[]) from public;
grant execute on function public.marketplace_query_sql(text,text,text,text,text,text,text,integer,integer,text,integer,integer,integer,boolean,text,timestamptz,integer,uuid,boolean,integer,integer,integer,uuid[]) to anon, authenticated, service_role;
grant execute on function public.marketplace_page(text,text,text,text,text,text,integer,integer,text,integer,integer,integer,boolean,text,timestamptz,integer,uuid,boolean,integer,integer,uuid[]) to anon, authenticated, service_role;
grant execute on function public.marketplace_count(text,text,text,text,text,text,integer,integer,text,integer,integer,integer,boolean,integer,uuid[]) to anon, authenticated, service_role;

-- ── 3. The search queue follows what the documents hold ──────────────────
-- Inserts and deletes queue as before. An update queues only when a field
-- the document is built from changes (src/lib/marketplace/search/indexing.ts,
-- src/lib/explore/search/indexing.ts).

drop trigger if exists search_listing on public.listings;
drop trigger if exists search_listing_update on public.listings;
create trigger search_listing after insert or delete on public.listings
  for each row execute function public.queue_search_change('listing', 'id');
create trigger search_listing_update after update on public.listings
  for each row
  when (old.title is distinct from new.title or old.description is distinct from new.description
        or old.compatibility_notes is distinct from new.compatibility_notes or old.part_number is distinct from new.part_number
        or old.category is distinct from new.category or old.subcategory is distinct from new.subcategory
        or old.brand is distinct from new.brand or old.condition is distinct from new.condition
        or old.status is distinct from new.status or old.price_cents is distinct from new.price_cents
        or old.created_at is distinct from new.created_at or old.source_car_id is distinct from new.source_car_id
        or old.seller_id is distinct from new.seller_id)
  execute function public.queue_search_change('listing', 'id');

drop trigger if exists search_car on public.cars;
drop trigger if exists search_car_update on public.cars;
create trigger search_car after insert or delete on public.cars
  for each row execute function public.queue_search_change('car', 'id');
create trigger search_car_update after update on public.cars
  for each row
  when (old.name is distinct from new.name or old.make is distinct from new.make or old.model is distinct from new.model
        or old.year is distinct from new.year or old.tags is distinct from new.tags or old.about is distinct from new.about
        or old.is_public is distinct from new.is_public or old.owner_id is distinct from new.owner_id
        or old.created_at is distinct from new.created_at)
  execute function public.queue_search_change('car', 'id');

-- A part's document carries its source car (make, model, year) and, for the
-- engine's filters, whether that car is public.
create or replace function public.queue_search_car_parts()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  insert into public.remediation_jobs(kind, dedup_key, payload)
  select 'search', 'search:listing:' || l.id || ':' || txid_current(), jsonb_build_object('entity', 'listing', 'id', l.id)
  from public.listings l where l.source_car_id = new.id
  on conflict (dedup_key) do nothing;
  return null;
end;
$function$;
revoke all on function public.queue_search_car_parts() from public, anon, authenticated;
drop trigger if exists search_car_parts on public.cars;
create trigger search_car_parts after update on public.cars
  for each row
  when (old.make is distinct from new.make or old.model is distinct from new.model
        or old.year is distinct from new.year or old.is_public is distinct from new.is_public)
  execute function public.queue_search_car_parts();

drop trigger if exists search_post on public.activity_posts;
drop trigger if exists search_post_update on public.activity_posts;
create trigger search_post after insert or delete on public.activity_posts
  for each row execute function public.queue_search_change('update', 'id');
create trigger search_post_update after update on public.activity_posts
  for each row
  when (old.title is distinct from new.title or old.intro is distinct from new.intro or old.body is distinct from new.body
        or old.published_at is distinct from new.published_at or old.car_id is distinct from new.car_id)
  execute function public.queue_search_change('update', 'id');

drop trigger if exists search_mod on public.mod_items;
drop trigger if exists search_mod_update on public.mod_items;
create trigger search_mod after insert or delete on public.mod_items
  for each row execute function public.queue_search_change('car', 'car_id');
create trigger search_mod_update after update on public.mod_items
  for each row
  when (old.brand is distinct from new.brand or old.product is distinct from new.product
        or old.part_number is distinct from new.part_number or old.status is distinct from new.status
        or old.car_id is distinct from new.car_id)
  execute function public.queue_search_change('car', 'car_id');

-- A profile's own document holds its names and suspension; its parts', cars'
-- and updates' documents depend on it only through the suspension.
create or replace function public.queue_search_profile_change()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  target uuid := coalesce(new.id, old.id);
begin
  insert into public.remediation_jobs(kind, dedup_key, payload)
  values ('search', 'search:profile:' || target || ':' || txid_current(), jsonb_build_object('entity', 'profile', 'id', target))
  on conflict (dedup_key) do nothing;
  if tg_op = 'UPDATE' and (old.suspended_at is null) <> (new.suspended_at is null) then
    insert into public.remediation_jobs(kind, dedup_key, payload)
    select 'search', 'search:listing:' || id || ':' || txid_current(), jsonb_build_object('entity', 'listing', 'id', id)
    from public.listings where seller_id = target
    on conflict (dedup_key) do nothing;
    insert into public.remediation_jobs(kind, dedup_key, payload)
    select 'search', 'search:car:' || id || ':' || txid_current(), jsonb_build_object('entity', 'car', 'id', id)
    from public.cars where owner_id = target
    on conflict (dedup_key) do nothing;
    insert into public.remediation_jobs(kind, dedup_key, payload)
    select 'search', 'search:update:' || p.id || ':' || txid_current(), jsonb_build_object('entity', 'update', 'id', p.id)
    from public.activity_posts p join public.cars c on c.id = p.car_id
    where c.owner_id = target or p.author_id = target
    on conflict (dedup_key) do nothing;
  end if;
  return null;
end;
$function$;
revoke all on function public.queue_search_profile_change() from public, anon, authenticated;
drop trigger if exists search_profile on public.profiles;
drop trigger if exists search_profile_update on public.profiles;
create trigger search_profile after insert or delete on public.profiles
  for each row execute function public.queue_search_profile_change();
create trigger search_profile_update after update on public.profiles
  for each row
  when (old.username is distinct from new.username or old.display_name is distinct from new.display_name
        or old.headline is distinct from new.headline or old.suspended_at is distinct from new.suspended_at
        or old.created_at is distinct from new.created_at)
  execute function public.queue_search_profile_change();

-- ── 4. Indexing in batches ───────────────────────────────────────────────
-- The worker claimed ten jobs a run (every two minutes) and built and sent
-- each document on its own: about 7,000 documents a day, less than a
-- 2M-part catalogue changes, and a full rebuild would take months. It now
-- claims up to p_limit documents at once — and with each, every other
-- queued job for the same document, which the one delivery satisfies —
-- builds a batch of part documents in one call, and imports them in one
-- request.

create or replace function public.claim_search_job_batch(p_limit integer)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare result jsonb;
begin
 -- Serialize claim selection only, never hold a transaction during HTTP work.
 perform pg_advisory_xact_lock(hashtextextended('search-job-claim', 0));
 update public.remediation_jobs set status = 'failed', last_error = 'Search lease retry limit reached', locked_until = null
  where kind = 'search' and status = 'processing' and locked_until < now() and attempts >= 10;
 with candidates as (
   select distinct on (j.payload->>'entity', j.payload->>'id') j.payload->>'entity' as entity, j.payload->>'id' as target, j.next_attempt_at, j.id
   from public.remediation_jobs j
   where j.kind = 'search' and j.attempts < 10 and j.next_attempt_at <= now()
     and (j.status = 'pending' or (j.status = 'processing' and j.locked_until < now()))
     and not exists (select 1 from public.remediation_jobs active
                      where active.kind = 'search' and active.status = 'processing' and active.locked_until > now()
                        and active.payload->>'entity' = j.payload->>'entity' and active.payload->>'id' = j.payload->>'id')
   order by j.payload->>'entity', j.payload->>'id', j.created_at, j.id
 ),
 due as (select entity, target from candidates order by next_attempt_at, id limit least(greatest(coalesce(p_limit, 10), 1), 1000)),
 claimed as (
   update public.remediation_jobs j
      set status = 'processing', attempts = attempts + 1, lease_id = gen_random_uuid(), locked_until = now() + interval '2 minutes'
     from due
    where j.kind = 'search' and j.payload->>'entity' = due.entity and j.payload->>'id' = due.target
      and j.attempts < 10 and j.next_attempt_at <= now()
      and (j.status = 'pending' or (j.status = 'processing' and j.locked_until < now()))
   returning j.*)
 select coalesce(jsonb_agg(claimed), '[]') into result from claimed;
 return result;
end
$function$;
revoke all on function public.claim_search_job_batch(integer) from public, anon, authenticated;
grant execute on function public.claim_search_job_batch(integer) to service_role;

-- A batch of part documents, built in one call. A part that should not be
-- searchable (not for sale, seller suspended, gone) is simply absent: the
-- worker deletes those ids from the engine. The fields the engine filters
-- on are the page's own rules, so the engine's count and the page agree:
--   fit_keys       "make|model" (and "make|" for any model) the part fits by
--                  the vehicle rule (20261011100000): stated, or off a
--                  public car of that make and model with nothing stated
--   fit_year_keys  "make|model|year" for every stated year, 1950-2030 (a
--                  year filter outside those years is left to Postgres)
--   fit_any_year   the source-car matches, which hold for any year
-- (Year ranges as nested objects took ~1 s a query in Typesense 30; exact
-- keys are an inverted-index lookup.)
-- A source car's name is in the document only when the car is public: a
-- private car's make and model are not searchable.
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

-- ── 5. The word list, filled now and hourly ──────────────────────────────

select public.refresh_search_words();
do $$
declare
  j record;
begin
  for j in select jobid from cron.job where jobname = 'drvn-search-words' loop
    perform cron.unschedule(j.jobid);
  end loop;
end $$;
select cron.schedule('drvn-search-words', '23 * * * *', $job$select public.refresh_search_words();$job$);
