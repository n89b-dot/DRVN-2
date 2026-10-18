-- marketplace_browse_rows searches once per call through PostgREST
-- (migration 20261017145500). Transactional; disposable local database only.
--
-- psql passes a function's arguments as literals; PostgREST passes them as
-- the columns of a joined row (json_to_record(...) as _(p_query text),
-- lateral fn(p_query := _.p_query)). A clause such as
-- "p_query = '' or id in (select marketplace_search_ids(p_query))" is then a
-- correlated subplan, and the search runs once for every part the filters
-- let through: 15 ms a run, a timeout at 1,100 parts. This runs the
-- function the way PostgREST does — the statement PostgREST 12 builds for
-- POST /rpc/marketplace_browse_rows, with and without an exact count — as a
-- signed-out visitor, and counts how often marketplace_search_ids actually
-- ran (Postgres' own per-function call count for this transaction; a plan's
-- loop count also counts rescans of a result already computed): once for a
-- query, never for a browse.
begin;

do $$
declare
  v_seller uuid := gen_random_uuid();
  v_match uuid[] := array[gen_random_uuid(), gen_random_uuid(), gen_random_uuid()];
  v_other uuid[] := array[gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid()];
  v_shape text;
  v_sql text;
  v_calls bigint;
  v_ids uuid[];
  v_query text;
  v_checked int := 0;
begin
  update public.beta_access_config set enforced = false where singleton;
  insert into auth.users(id, email) values (v_seller, 'browse-once-seller@drvn.test');
  insert into public.profiles(id, username) values (v_seller, 'browse_once_seller')
    on conflict (id) do update set username = excluded.username;
  insert into public.listings(id, seller_id, title, category, subcategory, price_cents, currency, status)
  select id, v_seller, 'Zzbrowseonce rotor ' || n, 'performance', 'turbo', 1000 + n, 'USD', 'active'
  from unnest(v_match) with ordinality as m(id, n);
  -- Parts the words don't match: each is a row the old clause re-ran the
  -- search for, to the end. (A run cut short at the first matching id is
  -- not counted, so these four are what the count sees.)
  insert into public.listings(id, seller_id, title, category, subcategory, price_cents, currency, status)
  select id, v_seller, 'Plain caliper ' || n, 'performance', 'turbo', 2000 + n, 'USD', 'active'
  from unnest(v_other) with ordinality as m(id, n);

  -- Count calls of SQL functions too (marketplace_search_ids is SQL with
  -- definer rights, so it is never inlined and every run is a call).
  perform set_config('track_functions', 'all', true);
  perform set_config('role', 'anon', true);
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);

  foreach v_shape in array array['counted', 'page'] loop
    foreach v_query in array array['zzbrowseonce', ''] loop
      v_sql := format(
        'WITH pgrst_source AS (SELECT "pgrst_call".* FROM (SELECT %L::json AS json_data) pgrst_payload, '
        'LATERAL (SELECT "p_query", "p_vehicle", "p_vyear", "p_ymin", "p_ymax", "p_fit" FROM json_to_record(pgrst_payload.json_data) '
        'AS _("p_query" text, "p_vehicle" text, "p_vyear" integer, "p_ymin" integer, "p_ymax" integer, "p_fit" boolean) LIMIT 1) pgrst_body, '
        'LATERAL "public"."marketplace_browse_rows"("p_query" := pgrst_body."p_query", "p_vehicle" := pgrst_body."p_vehicle", '
        '"p_vyear" := pgrst_body."p_vyear", "p_ymin" := pgrst_body."p_ymin", "p_ymax" := pgrst_body."p_ymax", "p_fit" := pgrst_body."p_fit") pgrst_call '
        'WHERE "pgrst_call"."seller_id" = %L)',
        json_build_object('p_query', v_query, 'p_vehicle', '', 'p_vyear', 0, 'p_ymin', 0, 'p_ymax', 9999, 'p_fit', false), v_seller)
        || case v_shape
             when 'counted' then ', pgrst_source_count AS (SELECT 1 FROM "pgrst_source" AS "listings") '
               'SELECT (SELECT pg_catalog.count(*) FROM pgrst_source_count) AS total_result_set, pg_catalog.count(_postgrest_t) AS page_total, '
               'coalesce(json_agg(_postgrest_t), ''[]'') AS body FROM (SELECT "listings"."id" FROM "pgrst_source" AS "listings" '
               'ORDER BY "listings"."price_cents" LIMIT 20 OFFSET 0) _postgrest_t'
             else ' SELECT null::bigint AS total_result_set, pg_catalog.count(_postgrest_t) AS page_total, '
               'coalesce(json_agg(_postgrest_t), ''[]'') AS body FROM (SELECT "listings"."id" FROM "pgrst_source" AS "listings" '
               'ORDER BY "listings"."created_at" DESC, "listings"."id" LIMIT 24 OFFSET 0) _postgrest_t'
           end;

      -- The answer, and how many times the search ran to produce it.
      v_calls := coalesce(pg_stat_get_xact_function_calls('public.marketplace_search_ids(text)'::regprocedure), 0);
      execute 'select coalesce(array_agg(x.id order by x.id), ''{}'') from (' || v_sql || ') r, json_to_recordset(r.body) as x(id uuid)'
        into v_ids;
      v_calls := coalesce(pg_stat_get_xact_function_calls('public.marketplace_search_ids(text)'::regprocedure), 0) - v_calls;
      if v_query <> '' and v_calls <> 1 then
        raise exception 'marketplace_browse_rows ran the search % times for one % query through PostgREST (once per part?), not once', v_calls, v_shape;
      end if;
      if v_query = '' and v_calls > 0 then
        raise exception 'marketplace_browse_rows ran the search % times for a browse with no words (% shape)', v_calls, v_shape;
      end if;
      if v_query <> '' and v_ids <> (select array_agg(id order by id) from unnest(v_match) id) then
        raise exception 'A % query through PostgREST returned %, not the three matching parts', v_shape, v_ids;
      end if;
      if v_query = '' and v_ids <> (select array_agg(id order by id) from unnest(v_match || v_other) id) then
        raise exception 'A % browse through PostgREST returned %, not all seven parts', v_shape, v_ids;
      end if;
      v_checked := v_checked + 1;
    end loop;
  end loop;

  -- Literal calls answer the same as the search entry point.
  select coalesce(array_agg(id order by id), '{}') into v_ids from public.marketplace_browse_rows(p_query => 'zzbrowseonce');
  if v_ids <> (select coalesce(array_agg(id order by id), '{}') from public.marketplace_search_browse_rows('zzbrowseonce')) then
    raise exception 'marketplace_browse_rows and marketplace_search_browse_rows disagree on a literal query: %', v_ids;
  end if;

  raise notice 'all browse rows search once checks passed (% PostgREST-shaped calls)', v_checked;
end $$;

rollback;
