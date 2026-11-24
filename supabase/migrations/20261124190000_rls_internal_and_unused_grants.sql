-- ============================================================================
-- 20261124190000 — the suspended-members list leaves the public API; unused
-- table privileges are removed
--
--   * public.suspended_profile_ids() answered anyone who asked the API for it
--     (POST /rest/v1/rpc/suspended_profile_ids) with the id of every
--     suspended member. The read policies need it, and a signed-out visitor
--     runs those policies, so the grant cannot simply be removed, and a
--     visitor cannot read profiles.suspended_at to do the check inline. The
--     function moves, unchanged and with its grants, to a new schema,
--     rls_internal, which the API does not serve (supabase/config.toml lists
--     the schemas it does). Policies follow the function by its identity.
--     The twelve functions that call it by name are restated with the new
--     name and no other change.
--   * anon and authenticated held TRUNCATE, TRIGGER, REFERENCES and MAINTAIN
--     on every table in public, from the platform's default grants. Row
--     level security does not apply to TRUNCATE or MAINTAIN. Nothing uses
--     them and the API has no way to ask for them; they are revoked, and no
--     longer granted to a table a later migration creates.
--   * Five policies on storage.objects called auth.uid() or auth.role() once
--     per row. Each call is wrapped in a sub-select, as the other policies
--     already are, so it is worked out once per statement. What each policy
--     allows is unchanged.
--   * public.rate_limits gets an index on window_start, which the nightly
--     prune filters on.
--   * public.release_expired_reservations expires at most 200 offers a run,
--     skipping any that are locked.
--
-- No row is changed. Not in this file, on purpose: the scheduled jobs are
-- left as they are (pg_cron already runs one instance of a job at a time,
-- and the health check and the agent schedule guard require the jobs it
-- lists), and the worker secret moves to Vault during hosting setup.
-- ============================================================================

create schema if not exists rls_internal;
comment on schema rls_internal is 'Helpers the row level security policies call. Not served by the API (supabase/config.toml), so a function here can be run by a policy on a visitor''s behalf without being callable by that visitor.';
revoke all on schema rls_internal from public;
grant usage on schema rls_internal to anon, authenticated, service_role;

alter function public.suspended_profile_ids() set schema rls_internal;
comment on function rls_internal.suspended_profile_ids() is 'The ids of suspended members: the set the read policies test against, once per query. Lives outside the API''s schemas (20261124190000).';

CREATE OR REPLACE FUNCTION public.listing_public_offer_floor(p_listing uuid)
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select t.offer_floor_cents
  from public.listings l
  join public.listing_private_terms t on t.listing_id = l.id
  where l.id = p_listing
    and l.show_offer_floor
    and l.status in ('active', 'reserved', 'sold')
    and (l.seller_id = (select auth.uid()) or not (l.seller_id in (select rls_internal.suspended_profile_ids())));
$function$;

CREATE OR REPLACE FUNCTION public.marketplace_browse_rows(p_query text DEFAULT ''::text, p_vehicle text DEFAULT ''::text, p_vyear integer DEFAULT 0, p_ymin integer DEFAULT 0, p_ymax integer DEFAULT 9999, p_fit boolean DEFAULT false, p_viewer uuid DEFAULT auth.uid())
 RETURNS SETOF public.listings
 LANGUAGE sql
 STABLE
AS $function$
 select l.* from public.listings l where trim(p_query)='' and l.status='active'
 and (p_viewer is not distinct from auth.uid() or current_user='service_role')
 and (l.seller_id not in (select rls_internal.suspended_profile_ids()) or l.seller_id=p_viewer)
 and (p_vehicle='' or exists(
   select 1 from public.catalog_makes m
   left join public.catalog_models mo on mo.make_id=m.id and mo.id=case when p_vehicle ~ '^[1-9][0-9]{0,9}-[1-9][0-9]{0,9}$' then split_part(p_vehicle,'-',2)::bigint else 0 end
   join public.listing_vehicle_fit v on v.listing_id=l.id and v.make_key=lower(m.name) and v.model_key=coalesce(lower(mo.name),'')
   where m.id=case when p_vehicle ~ '^[1-9][0-9]{0,9}(-[1-9][0-9]{0,9})?$' then split_part(p_vehicle,'-',1)::bigint else 0 end
   and (position('-' in p_vehicle)=0 or mo.id is not null)
   and case when v.via='stated' then p_vyear=0 or v.years @> p_vyear
     else not v.stated_also and (v.car_public or v.car_owner_id=p_viewer)
       and (v.car_owner_id=v.seller_id or v.car_owner_id=p_viewer or v.car_owner_id not in (select rls_internal.suspended_profile_ids())) end))
 and ((p_ymin=0 and p_ymax=9999) or exists(select 1 from public.cars c where c.id=l.source_car_id and (c.is_public or c.owner_id=p_viewer) and (public.profile_is_visible(c.owner_id) or c.owner_id=p_viewer) and c.year between p_ymin and p_ymax))
 and (not p_fit or exists(select 1 from public.cars g
   join public.listing_vehicle_fit v on v.listing_id=l.id and v.make_key=lower(g.make) and v.model_key=lower(g.model)
   where g.owner_id=(select p_viewer) and g.make is not null and g.model is not null
   and case when v.via='stated' then case when coalesce(g.year,0)=0 then v.all_years else v.years @> g.year end
     else not v.stated_also and (v.car_public or v.car_owner_id=p_viewer)
       and (v.car_owner_id=v.seller_id or v.car_owner_id=p_viewer or v.car_owner_id not in (select rls_internal.suspended_profile_ids())) end))
 union all
 select s.* from public.marketplace_search_browse_rows(p_query, p_vehicle, p_vyear, p_ymin, p_ymax, p_fit, p_viewer) s;
$function$;

CREATE OR REPLACE FUNCTION public.marketplace_query_sql(p_mode text, p_query text, p_category text, p_subcategory text, p_condition text, p_brand text, p_location text, p_min_cents integer, p_max_cents integer, p_vehicle text, p_vyear integer, p_ymin integer, p_ymax integer, p_fit boolean, p_sort text, p_after_created timestamp with time zone, p_after_price integer, p_after_id uuid, p_before boolean, p_offset integer, p_limit integer, p_cap integer, p_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS text
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
  filters := ' and l.status = ''active'' and (l.seller_id not in (select rls_internal.suspended_profile_ids())'
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
      ' and (c.owner_id not in (select rls_internal.suspended_profile_ids())%s) and c.year between %s and %s)',
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
  fit_seller := ' and (v.seller_id not in (select rls_internal.suspended_profile_ids())' || replace(own, '{col}', 'v.seller_id') || ')';
  fit_rule := 'case when v.via = ''stated'' then {years} else not v.stated_also and (v.car_public'
    || replace(own, '{col}', 'v.car_owner_id') || ') and (v.car_owner_id = v.seller_id'
    || replace(own, '{col}', 'v.car_owner_id') || ' or v.car_owner_id not in (select rls_internal.suspended_profile_ids())) end';

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

CREATE OR REPLACE FUNCTION public.marketplace_search_browse_rows(p_query text, p_vehicle text DEFAULT ''::text, p_vyear integer DEFAULT 0, p_ymin integer DEFAULT 0, p_ymax integer DEFAULT 9999, p_fit boolean DEFAULT false, p_viewer uuid DEFAULT auth.uid())
 RETURNS SETOF public.listings
 LANGUAGE sql
 STABLE
AS $function$
 select l.* from public.marketplace_search_ids(p_query) s(id) join public.listings l on l.id=s.id
 where trim(p_query)<>'' and l.status='active'
 and (p_viewer is not distinct from auth.uid() or current_user='service_role')
 and (l.seller_id not in (select rls_internal.suspended_profile_ids()) or l.seller_id=p_viewer)
 and (p_vehicle='' or exists(
   select 1 from public.catalog_makes m
   left join public.catalog_models mo on mo.make_id=m.id and mo.id=case when p_vehicle ~ '^[1-9][0-9]{0,9}-[1-9][0-9]{0,9}$' then split_part(p_vehicle,'-',2)::bigint else 0 end
   join public.listing_vehicle_fit v on v.listing_id=l.id and v.make_key=lower(m.name) and v.model_key=coalesce(lower(mo.name),'')
   where m.id=case when p_vehicle ~ '^[1-9][0-9]{0,9}(-[1-9][0-9]{0,9})?$' then split_part(p_vehicle,'-',1)::bigint else 0 end
   and (position('-' in p_vehicle)=0 or mo.id is not null)
   and case when v.via='stated' then p_vyear=0 or v.years @> p_vyear
     else not v.stated_also and (v.car_public or v.car_owner_id=p_viewer)
       and (v.car_owner_id=v.seller_id or v.car_owner_id=p_viewer or v.car_owner_id not in (select rls_internal.suspended_profile_ids())) end))
 and ((p_ymin=0 and p_ymax=9999) or exists(select 1 from public.cars c where c.id=l.source_car_id and (c.is_public or c.owner_id=p_viewer) and (public.profile_is_visible(c.owner_id) or c.owner_id=p_viewer) and c.year between p_ymin and p_ymax))
 and (not p_fit or exists(select 1 from public.cars g
   join public.listing_vehicle_fit v on v.listing_id=l.id and v.make_key=lower(g.make) and v.model_key=lower(g.model)
   where g.owner_id=(select p_viewer) and g.make is not null and g.model is not null
   and case when v.via='stated' then case when coalesce(g.year,0)=0 then v.all_years else v.years @> g.year end
     else not v.stated_also and (v.car_public or v.car_owner_id=p_viewer)
       and (v.car_owner_id=v.seller_id or v.car_owner_id=p_viewer or v.car_owner_id not in (select rls_internal.suspended_profile_ids())) end));
$function$;

CREATE OR REPLACE FUNCTION public.marketplace_search_capped_ids(p_query text, p_category text DEFAULT ''::text, p_subcategory text DEFAULT ''::text, p_condition text DEFAULT ''::text, p_brand text DEFAULT ''::text, p_location text DEFAULT ''::text, p_min_cents integer DEFAULT NULL::integer, p_max_cents integer DEFAULT NULL::integer, p_cap integer DEFAULT 1001)
 RETURNS SETOF uuid
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER ROWS 1001
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
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
  filters := ' and l.status = ''active'' and l.seller_id not in (select rls_internal.suspended_profile_ids())';
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

CREATE OR REPLACE FUNCTION public.price_comparables(p_brand text, p_part_number text, p_currency text DEFAULT 'USD'::text, p_exclude_listing uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  c_min_sample constant int := 3;
  c_window_days constant int := 730;
  c_sample_cap constant int := 500;
  v_brand text := nullif(regexp_replace(lower(coalesce(p_brand, '')), '[^[:alnum:]]', '', 'g'), '');
  v_number text := nullif(regexp_replace(lower(coalesce(p_part_number, '')), '[^a-z0-9]', '', 'g'), '');
  v_product uuid;
  v_brands text[];
  v_pairs text[];
  v_numbers text[];
  v_sold jsonb;
  v_asking jsonb;
begin
  if v_brand is null or v_number is null then
    return jsonb_build_object('enough', false, 'reason', 'brand_and_number_required', 'min_sample', c_min_sample);
  end if;

  select pm.product_id into v_product
  from public.product_part_numbers pm where pm.brand_key = v_brand and pm.number_compact = v_number;

  -- Every (brand, number) the product holds; the pair alone before it has one.
  if v_product is not null then
    select array_agg(pm.brand_key order by pm.brand_key, pm.number_compact),
           array_agg(pm.number_compact order by pm.brand_key, pm.number_compact)
      into v_brands, v_pairs
    from public.product_part_numbers pm where pm.product_id = v_product;
  else
    v_brands := array[v_brand];
    v_pairs := array[v_number];
  end if;
  select array_agg(distinct n) into v_numbers from unnest(v_pairs) n;

  -- Per line, every lookup is an index probe on that line's own order: no
  -- join between the matching lines and an aggregate of them, which the
  -- planner estimates at one row and turns into a nested loop that redoes
  -- the aggregate per line (5,000 sales: 2.7 s; this way: tens of ms).
  with matching as materialized (
    select oi.id, oi.order_id, o.refunded_cents,
           greatest(coalesce(oi.quantity, 1), 1) as quantity,
           oi.price_cents::bigint * greatest(coalesce(oi.quantity, 1), 1) as goods_cents,
           -- The sold listing is read only for a snapshot from before
           -- part.brand (coalesce stops at the first value).
           nullif(regexp_replace(lower(coalesce(oi.commercial_snapshot -> 'part' ->> 'brand',
             (select l.brand from public.listings l where l.id = oi.listing_id), '')), '[^[:alnum:]]', '', 'g'), '') as brand_key,
           v.n as number_compact,
           coalesce(oi.commercial_snapshot -> 'condition' ->> 'condition',
             (select l.condition from public.listings l where l.id = oi.listing_id)) as condition,
           coalesce((oi.commercial_snapshot -> 'commercial' ->> 'shipping_cents')::bigint, oi.shipping_cents::bigint) as shipping_cents,
           coalesce(o.completed_at, o.delivered_at, o.created_at) as sold_at
    from unnest(v_numbers) v(n)
    -- The newest c_sample_cap purchases of each number, from the index in
    -- order; the completed, in-window, same-currency ones among them count.
    cross join lateral (
      select oi.* from public.order_items oi
      where nullif(regexp_replace(lower(coalesce(oi.commercial_snapshot -> 'part' ->> 'part_number', '')), '[^a-z0-9]', '', 'g'), '') = v.n
        and oi.commercial_snapshot -> 'part' ->> 'part_number' is not null
      order by oi.commercial_snapshot ->> 'captured_at' desc
      limit c_sample_cap
    ) oi
    join public.orders o on o.id = oi.order_id
    where o.status = 'completed'
      and coalesce(o.currency, 'USD') = p_currency
      and coalesce(o.completed_at, o.delivered_at, o.created_at) >= now() - make_interval(days => c_window_days)
  ),
  kept as materialized (
    select s.condition, s.shipping_cents, s.sold_at, s.unit_net_cents
    from (
      select m.condition, m.shipping_cents, m.sold_at,
             round((m.goods_cents - (r.unexplained_cents::numeric * m.goods_cents / nullif(g.goods_cents, 0))) / m.quantity) as unit_net_cents
      from matching m
      join unnest(v_brands, v_pairs) k(brand_key, number_compact)
        on k.brand_key = m.brand_key and k.number_compact = m.number_compact
      -- Every line of the order counts toward its goods, matching or not: a
      -- refund is shared across the whole order.
      cross join lateral (
        select sum(oi.price_cents::bigint * greatest(coalesce(oi.quantity, 1), 1)) as goods_cents
        from public.order_items oi where oi.order_id = m.order_id
      ) g
      -- What the order refunded beyond its completed returns, up to its goods.
      cross join lateral (
        select least(greatest(coalesce(m.refunded_cents, 0)::bigint - coalesce((
                 select sum(greatest(coalesce(r.refund_amount_cents, 0) - coalesce(r.label_deduction_cents, 0), 0))
                 from public.returns r where r.order_id = m.order_id and r.status = 'completed'), 0), 0),
               g.goods_cents) as unexplained_cents
      ) r
      -- A line with a completed return is not a sale.
      where not exists (
        select 1 from public.return_items ri join public.returns rt on rt.id = ri.return_id
        where ri.order_item_id = m.id and rt.status = 'completed')
    ) s
    where s.unit_net_cents > 0
  ),
  by_condition as (
    select condition, count(*) as n,
           percentile_disc(0.5) within group (order by unit_net_cents) as median_cents
    from kept where condition is not null group by condition
  ),
  totals as (
    select count(*) as n,
           percentile_disc(0.5) within group (order by unit_net_cents) as median_cents,
           percentile_disc(0.25) within group (order by unit_net_cents) as p25_cents,
           percentile_disc(0.75) within group (order by unit_net_cents) as p75_cents,
           percentile_disc(0.5) within group (order by shipping_cents) as median_shipping_cents,
           -- A sale completed "in the future" (clock skew) is a sale today.
           greatest(0, extract(day from now() - max(sold_at)))::int as newest_days,
           percentile_disc(0.5) within group (order by greatest(0, extract(day from now() - sold_at))::int) as median_age_days
    from kept
  )
  select jsonb_strip_nulls(jsonb_build_object(
    'count', t.n,
    'enough', t.n >= c_min_sample,
    'median_cents', case when t.n >= c_min_sample then t.median_cents end,
    'p25_cents', case when t.n >= c_min_sample then t.p25_cents end,
    'p75_cents', case when t.n >= c_min_sample then t.p75_cents end,
    'median_shipping_cents', case when t.n >= c_min_sample then t.median_shipping_cents end,
    'newest_days', case when t.n >= c_min_sample then t.newest_days end,
    'median_age_days', case when t.n >= c_min_sample then t.median_age_days end,
    'by_condition', (select jsonb_agg(jsonb_build_object('condition', condition, 'count', n, 'median_cents', median_cents) order by n desc, condition)
                     from by_condition where n >= c_min_sample)
  )) into v_sold
  from totals t;

  with asking as (
    select l.price_cents::bigint as price_cents, l.condition, l.shipping_cents::bigint as shipping_cents, l.created_at
    from public.listings l
    join unnest(v_brands, v_pairs) k(brand_key, number_compact)
      on k.number_compact = l.part_number_compact
     and k.brand_key = nullif(regexp_replace(lower(coalesce(l.brand, '')), '[^[:alnum:]]', '', 'g'), '')
    where l.part_number_compact = any(v_numbers)
      and l.status = 'active'
      and coalesce(l.currency, 'USD') = p_currency
      and l.id is distinct from p_exclude_listing
      and l.seller_id not in (select rls_internal.suspended_profile_ids())
  ),
  by_condition as (
    select condition, count(*) as n, percentile_disc(0.5) within group (order by price_cents) as median_cents
    from asking where condition is not null group by condition
  )
  select jsonb_strip_nulls(jsonb_build_object(
    'count', (select count(*) from asking),
    'enough', (select count(*) from asking) >= c_min_sample,
    'median_cents', case when (select count(*) from asking) >= c_min_sample
      then (select percentile_disc(0.5) within group (order by price_cents) from asking) end,
    'p25_cents', case when (select count(*) from asking) >= c_min_sample
      then (select percentile_disc(0.25) within group (order by price_cents) from asking) end,
    'p75_cents', case when (select count(*) from asking) >= c_min_sample
      then (select percentile_disc(0.75) within group (order by price_cents) from asking) end,
    'median_shipping_cents', case when (select count(*) from asking) >= c_min_sample
      then (select percentile_disc(0.5) within group (order by shipping_cents) from asking) end,
    'by_condition', (select jsonb_agg(jsonb_build_object('condition', condition, 'count', n, 'median_cents', median_cents) order by n desc, condition)
                     from by_condition where n >= c_min_sample)
  )) into v_asking;

  return jsonb_build_object(
    'identity', jsonb_build_object('brand_key', v_brand, 'number_compact', v_number,
                                   'product', v_product is not null, 'numbers', cardinality(v_numbers)),
    'currency', p_currency,
    'min_sample', c_min_sample,
    'window_days', c_window_days,
    'sample_cap', c_sample_cap,
    'enough', coalesce((v_sold ->> 'enough')::boolean, false) or coalesce((v_asking ->> 'enough')::boolean, false),
    'sold', v_sold,
    'asking', v_asking
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.refresh_marketplace_facet_counts()
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  with fresh as (
    select case when grouping(l.category) = 0 then 'category' when grouping(l.brand) = 0 then 'brand' else 'condition' end as facet,
           coalesce(l.category, l.brand, l.condition) as key,
           coalesce(l.subcategory, '') as subkey,
           count(*) as total
    from public.listings l
    where l.status = 'active' and l.seller_id not in (select rls_internal.suspended_profile_ids())
    group by grouping sets ((l.category, l.subcategory), (l.brand), (l.condition))
    having (grouping(l.category) = 0) or (grouping(l.brand) = 0 and l.brand is not null)
        or (grouping(l.condition) = 0 and l.condition is not null)
  ),
  gone as (
    delete from public.marketplace_facet_counts t
    where not exists (select 1 from fresh f where f.facet = t.facet and f.key = t.key and f.subkey = t.subkey)
  )
  insert into public.marketplace_facet_counts (facet, key, subkey, total)
  select facet, key, subkey, total from fresh
  on conflict (facet, key, subkey) do update set total = excluded.total
  where public.marketplace_facet_counts.total is distinct from excluded.total;
$function$;

CREATE OR REPLACE FUNCTION public.refresh_search_words()
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
  with fresh as (
    select w.word, count(*)::integer as uses
    from public.listings l
    cross join lateral regexp_split_to_table(lower(coalesce(l.title, '') || ' ' || coalesce(l.brand, '')), '[^[:alpha:]]+') w(word)
    where l.status = 'active' and l.seller_id not in (select rls_internal.suspended_profile_ids())
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

CREATE OR REPLACE FUNCTION public.search_listing_documents(p_ids uuid[])
 RETURNS TABLE(id uuid, doc jsonb)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
    and l.seller_id not in (select rls_internal.suspended_profile_ids());
$function$;

CREATE OR REPLACE FUNCTION public.sitemap_post_page(p_start integer, p_count integer)
 RETURNS TABLE(id uuid, car_slug text, updated_at timestamp with time zone)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select p.id, c.slug, p.updated_at
  from public.activity_posts p
  left join public.cars c on c.id = p.car_id
  where p.published_at is not null
    and (p.car_id is null or (c.is_public and c.slug is not null))
    and p.author_id not in (select rls_internal.suspended_profile_ids())
  order by p.id
  offset greatest(coalesce(p_start, 0), 0)
  limit least(greatest(coalesce(p_count, 0), 0), 1000);
$function$;

CREATE OR REPLACE FUNCTION public.suggested_builders(p_viewer uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 6)
 RETURNS TABLE(id uuid, username text, display_name text, avatar_url text, headline text, car_count bigint, update_count bigint)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if not exists (select 1 from public.explore_builder_rankings) then
    -- Not refreshed yet: the old live answer.
    return query
      select p.id, p.username, p.display_name, p.avatar_url, p.headline,
             count(distinct c.id), count(distinct a.id)
      from public.profiles p
      join public.cars c on c.owner_id = p.id and c.is_public and c.cover_image_url is not null
      left join public.activity_posts a on a.car_id = c.id and a.published_at is not null
      where p.username is not null
        and public.profile_is_visible(p.id)
        and (p_viewer is null or p.id <> p_viewer)
        and not exists (select 1 from public.follows f
                         where p_viewer is not null and f.follower_id = p_viewer
                           and f.target_type = 'profile' and f.target_id = p.id)
      group by p.id, p.username, p.display_name, p.avatar_url, p.headline
      order by count(distinct c.id) desc, count(distinct a.id) desc, p.id
      limit greatest(1, least(p_limit, 24));
    return;
  end if;
  -- Names, pictures and suspension are read now; only the counts are stored.
  return query
    select p.id, p.username, p.display_name, p.avatar_url, p.headline, r.car_count, r.update_count
    from public.explore_builder_rankings r
    join public.profiles p on p.id = r.profile_id
    where p.username is not null
      and p.id not in (select rls_internal.suspended_profile_ids())
      and (p_viewer is null or p.id <> p_viewer)
      and not exists (select 1 from public.follows f
                       where p_viewer is not null and f.follower_id = p_viewer
                         and f.target_type = 'profile' and f.target_id = p.id)
    order by r.rank
    limit greatest(1, least(p_limit, 24));
end;
$function$;

CREATE OR REPLACE FUNCTION public.trending_models_live(p_days integer, p_limit integer)
 RETURNS TABLE(make text, model text, builds bigint, updates bigint, catalog_make_id bigint, catalog_model_id bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  -- count(*) is count(a.id) (every joined update has an id) and can be
  -- answered from activity_posts_published_car_idx without reading updates.
  select c.make, c.model, count(distinct c.id), count(*), min(c.catalog_make_id), min(c.catalog_model_id)
  from public.cars c
  join public.activity_posts a
    on a.car_id = c.id
   and a.published_at is not null
   and a.published_at > now() - make_interval(days => greatest(1, least(p_days, 365)))
  where c.is_public
    and c.owner_id not in (select rls_internal.suspended_profile_ids())
    and c.make is not null
    and c.model is not null
  group by c.make, c.model
  order by count(*) desc, count(distinct c.id) desc, c.make, c.model
  limit greatest(1, least(p_limit, 24));
$function$;


CREATE OR REPLACE FUNCTION public.release_expired_reservations()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare queued int;
begin
 insert into public.remediation_jobs(kind,dedup_key,payload)
 select 'reservation_expiry','expiry:'||o.id,jsonb_build_object('order_id',o.id)
 from public.orders o
 where o.status in ('pending','requires_action')
 and exists(select 1 from public.order_items oi join public.listings l on l.id=oi.listing_id
   where oi.order_id=o.id and l.status='reserved' and l.reserved_until<now())
 and not exists(select 1 from public.remediation_jobs j where j.dedup_key='expiry:'||o.id)
 order by o.created_at,o.id limit 500
 on conflict(dedup_key) do nothing;
 get diagnostics queued=row_count;
 -- 20261124190000: at most 200 offers a run, oldest first, skipping any a
 -- member is acting on right now (its row is locked). The rest go on the next
 -- run, five minutes later, so one run never waits on a member or holds a
 -- long list of rows.
 update public.offers set status='expired',responded_at=now()
 where id in (
   select o.id from public.offers o
   where o.status in ('open','countered') and o.expires_at<now()
   order by o.expires_at, o.id
   limit 200
   for update skip locked);
 return jsonb_build_object('queued',queued,'listings_released',0,'orders_cancelled',0);
end $function$;

revoke truncate, trigger, references, maintain on all tables in schema public from anon, authenticated;
alter default privileges in schema public revoke truncate, trigger, references, maintain on tables from anon, authenticated;

alter policy "read dispute evidence" on storage.objects
  using (bucket_id = 'dispute-evidence'::text AND ((storage.foldername(name))[1] = ((select auth.uid()))::text OR (select public.is_admin()) OR (EXISTS ( SELECT 1
   FROM public.dispute_evidence de
     JOIN public.orders o ON o.id = de.order_id
  WHERE de.storage_path = objects.name AND ((select auth.uid()) = o.buyer_id OR (select auth.uid()) = o.seller_id)))));

alter policy "read message photos" on storage.objects
  using (bucket_id = 'message-photos'::text AND ((storage.foldername(name))[1] = ((select auth.uid()))::text OR (storage.foldername(name))[2] = ((select auth.uid()))::text OR (select public.is_admin())));

alter policy "upload own message photos" on storage.objects
  with check (bucket_id = 'message-photos'::text AND (storage.foldername(name))[1] = ((select auth.uid()))::text);

alter policy "users update own media" on storage.objects
  using ((bucket_id = ANY (ARRAY['avatars'::text, 'car-images'::text, 'activity-images'::text, 'listing-images'::text])) AND (storage.foldername(name))[1] = ((select auth.uid()))::text);

alter policy "users upload to own folder" on storage.objects
  with check ((bucket_id = ANY (ARRAY['avatars'::text, 'car-images'::text, 'activity-images'::text, 'listing-images'::text])) AND (select auth.role()) = 'authenticated'::text AND (storage.foldername(name))[1] = ((select auth.uid()))::text);

create index if not exists rate_limits_window_start_idx on public.rate_limits (window_start);
