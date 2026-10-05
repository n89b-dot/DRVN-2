-- Sameness at volume: marketplace_page and marketplace_count against
-- marketplace_browse_rows queried the way the app queried it before
-- (PostgREST filters on the function, ORDER BY, OFFSET, an exact count).
-- DISPOSABLE DATABASES ONLY. Read-only; rolls back.
--
--   psql -f scripts/perf/compare-pages.sql
--
-- For every filter combination below, as a signed-out visitor and as a
-- member with a garage, in each sort order:
--   * pages 1, 2 and 5 by offset must be the same parts in the same order;
--   * walking four pages forward by position, then one back, must give the
--     same parts as the offset pages;
--   * the capped count must equal the exact count, or the cap when the exact
--     count is larger.
-- Order is compared with the new tie-break (id runs the same way as the
-- sort); docs/performance/query-plans.md says what that changes. A typed
-- search is Postgres' capped one (20261011130000): the reference is the
-- newest 1,001 matches the filters allow, then sorted as asked.
\set ON_ERROR_STOP 1
\pset pager off
begin;

create function pg_temp.reference_page(f jsonb, sort text, skip int, lim int) returns uuid[] language plpgsql as $$
declare
  sql text := 'select coalesce(array_agg(id), ''{}'') from (select l.id from public.marketplace_browse_rows('
    || format('p_query => %L, p_vehicle => %L, p_vyear => %s, p_ymin => %s, p_ymax => %s, p_fit => %s',
         coalesce(f->>'q', ''), coalesce(f->>'vehicle', ''), coalesce(f->>'vyear', '0'),
         coalesce(f->>'ymin', '0'), coalesce(f->>'ymax', '9999'), coalesce(f->>'fit', 'false'))
    || ') l where true';
  result uuid[];
begin
  if f ? 'category' then sql := sql || format(' and l.category = %L', f->>'category'); end if;
  if f ? 'subcategory' then sql := sql || format(' and l.subcategory = %L', f->>'subcategory'); end if;
  if f ? 'condition' then sql := sql || format(' and l.condition = %L', f->>'condition'); end if;
  if f ? 'brand' then sql := sql || format(' and l.brand ilike %L', regexp_replace(f->>'brand', '([\\%_])', '\\\1', 'g')); end if;
  if f ? 'location' then sql := sql || format(' and l.location ilike %L', '%' || regexp_replace(f->>'location', '([\\%_])', '\\\1', 'g') || '%'); end if;
  if f ? 'min' then sql := sql || format(' and l.price_cents >= %s', f->>'min'); end if;
  if f ? 'max' then sql := sql || format(' and l.price_cents <= %s', f->>'max'); end if;
  if f ? 'q' then
    sql := regexp_replace(sql, '^select coalesce\(array_agg\(id\), ''\{\}''\) from \(select l.id from ', 'select coalesce(array_agg(id), ''{}'') from (select l.id from (select l.* from ')
           || ' order by l.created_at desc, l.id desc limit 1001) l';
  end if;
  sql := sql || case sort when 'price_asc' then ' order by l.price_cents asc, l.id asc'
                          when 'price_desc' then ' order by l.price_cents desc, l.id desc'
                          else ' order by l.created_at desc, l.id desc' end
             || format(' limit %s offset %s) s', lim, skip);
  execute sql into result;
  return result;
end $$;

create function pg_temp.reference_count(f jsonb) returns bigint language plpgsql as $$
declare
  sql text := 'select count(*) from public.marketplace_browse_rows('
    || format('p_query => %L, p_vehicle => %L, p_vyear => %s, p_ymin => %s, p_ymax => %s, p_fit => %s',
         coalesce(f->>'q', ''), coalesce(f->>'vehicle', ''), coalesce(f->>'vyear', '0'),
         coalesce(f->>'ymin', '0'), coalesce(f->>'ymax', '9999'), coalesce(f->>'fit', 'false'))
    || ') l where true';
  result bigint;
begin
  if f ? 'category' then sql := sql || format(' and l.category = %L', f->>'category'); end if;
  if f ? 'subcategory' then sql := sql || format(' and l.subcategory = %L', f->>'subcategory'); end if;
  if f ? 'condition' then sql := sql || format(' and l.condition = %L', f->>'condition'); end if;
  if f ? 'brand' then sql := sql || format(' and l.brand ilike %L', regexp_replace(f->>'brand', '([\\%_])', '\\\1', 'g')); end if;
  if f ? 'location' then sql := sql || format(' and l.location ilike %L', '%' || regexp_replace(f->>'location', '([\\%_])', '\\\1', 'g') || '%'); end if;
  if f ? 'min' then sql := sql || format(' and l.price_cents >= %s', f->>'min'); end if;
  if f ? 'max' then sql := sql || format(' and l.price_cents <= %s', f->>'max'); end if;
  execute sql into result;
  return result;
end $$;

create function pg_temp.new_page(f jsonb, sort text, skip int, lim int, after_created timestamptz, after_price int, after_id uuid, before boolean)
returns uuid[] language sql as $$
  select coalesce(array_agg(id), '{}') from public.marketplace_page(
    p_query => coalesce(f->>'q', ''), p_category => coalesce(f->>'category', ''), p_subcategory => coalesce(f->>'subcategory', ''),
    p_condition => coalesce(f->>'condition', ''), p_brand => coalesce(f->>'brand', ''), p_location => coalesce(f->>'location', ''),
    p_min_cents => (f->>'min')::int, p_max_cents => (f->>'max')::int,
    p_vehicle => coalesce(f->>'vehicle', ''), p_vyear => coalesce((f->>'vyear')::int, 0),
    p_ymin => coalesce((f->>'ymin')::int, 0), p_ymax => coalesce((f->>'ymax')::int, 9999),
    p_fit => coalesce((f->>'fit')::boolean, false), p_sort => sort,
    p_after_created => after_created, p_after_price => after_price, p_after_id => after_id,
    p_before => before, p_offset => skip, p_limit => lim)
$$;

create function pg_temp.new_count(f jsonb) returns int language sql as $$
  select public.marketplace_count(
    p_query => coalesce(f->>'q', ''), p_category => coalesce(f->>'category', ''), p_subcategory => coalesce(f->>'subcategory', ''),
    p_condition => coalesce(f->>'condition', ''), p_brand => coalesce(f->>'brand', ''), p_location => coalesce(f->>'location', ''),
    p_min_cents => (f->>'min')::int, p_max_cents => (f->>'max')::int,
    p_vehicle => coalesce(f->>'vehicle', ''), p_vyear => coalesce((f->>'vyear')::int, 0),
    p_ymin => coalesce((f->>'ymin')::int, 0), p_ymax => coalesce((f->>'ymax')::int, 9999),
    p_fit => coalesce((f->>'fit')::boolean, false))
$$;

do $$
declare
  member uuid := (select owner_id from public.cars group by owner_id
                  having count(*) between 2 and 3 and bool_or(make = 'Make1' and model = 'Model1') order by owner_id limit 1);
  rare_brand text := (select brand from public.listings where status = 'active' group by brand order by count(*), brand limit 1);
  combos jsonb[] := array[
    '{}', '{"category":"wheels-tires"}', '{"category":"wheels-tires","subcategory":"wheels"}', '{"condition":"used"}',
    '{"brand":"brembo"}', '{"brand":"KW","category":"performance"}', '{"location":"leeds"}', '{"min":10000,"max":50000}',
    '{"ymin":2010,"ymax":2015}', '{"vehicle":"900001"}', '{"vehicle":"900001-900101"}', '{"vehicle":"900001-900101","vyear":2015}',
    '{"vehicle":"900012-901203"}', '{"vehicle":"900012-901203","vyear":2001}', '{"vehicle":"900001-900101","category":"performance","condition":"new"}',
    '{"vehicle":"900003-900302","min":5000}', '{"q":"brembo"}', '{"q":"kit","category":"engine"}', '{"q":"PN-777"}',
    '{"vehicle":"abc"}', '{"vehicle":"999999999"}', '{"fit":true}', '{"fit":true,"category":"engine"}',
    '{"fit":true,"vehicle":"900001-900101"}', '{"fit":true,"min":20000}']::jsonb[];
  f jsonb;
  who text;
  sort text;
  ref uuid[]; got uuid[]; walk uuid[]; step uuid[];
  last_id uuid; last_created timestamptz; last_price int;
  exact bigint; capped int;
  checks int := 0;
  pg int;
begin
  combos := combos || jsonb_build_object('brand', rare_brand);
  foreach who in array array['anon', 'member'] loop
    perform set_config('role', case who when 'anon' then 'anon' else 'authenticated' end, true);
    perform set_config('request.jwt.claims', case who when 'member' then json_build_object('sub', member, 'role', 'authenticated')::text else '' end, true);
    perform set_config('statement_timeout', '0', true);
    foreach f in array combos loop
      if who = 'anon' and f ? 'fit' then continue; end if;
      exact := pg_temp.reference_count(f);
      capped := pg_temp.new_count(f);
      if capped <> least(exact, case when f ? 'q' then 1001 else 10001 end) then
        raise exception '% count for %: capped % but exact %', who, f, capped, exact;
      end if;
      checks := checks + 1;
      foreach sort in array array['newest', 'price_asc', 'price_desc'] loop
        foreach pg in array array[0, 25, 100] loop
          ref := pg_temp.reference_page(f, sort, pg, 25);
          got := pg_temp.new_page(f, sort, pg, 25, null, null, null, false);
          if ref <> got then
            raise exception '% % % offset %: new page differs from browse (% vs % rows)', who, f, sort, pg, cardinality(got), cardinality(ref);
          end if;
          checks := checks + 1;
        end loop;
        -- Four pages forward by position, then one back.
        ref := pg_temp.reference_page(f, sort, 0, 100);
        walk := '{}'; last_id := null; last_created := null; last_price := null;
        for i in 1..4 loop
          step := pg_temp.new_page(f, sort, 0, 25, last_created, last_price, last_id, false);
          exit when cardinality(step) = 0;
          walk := walk || step;
          last_id := step[cardinality(step)];
          select created_at, price_cents into last_created, last_price from public.listings where id = last_id;
        end loop;
        if walk <> ref then
          raise exception '% % %: walking by position gave different parts than offset paging', who, f, sort;
        end if;
        if cardinality(walk) > 50 then
          select created_at, price_cents into last_created, last_price from public.listings where id = walk[51];
          step := pg_temp.new_page(f, sort, 0, 25, last_created, last_price, walk[51], true);
          if array(select x from unnest(step) with ordinality u(x, o) order by o desc) <> walk[26:50] then
            raise exception '% % %: paging back by position gave different parts', who, f, sort;
          end if;
        end if;
        checks := checks + 2;
      end loop;
    end loop;
  end loop;
  raise notice 'pages and counts agree with marketplace_browse_rows: % checks', checks;
end $$;

rollback;
