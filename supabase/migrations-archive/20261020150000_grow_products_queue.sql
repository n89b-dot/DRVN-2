-- B1 — an hourly products run reads what changed, not the catalog
-- (follows 20261020120000; measured at 2M parts, docs/performance/query-plans.md).
--
-- At 2M parts an hourly grow_products() run that saw 1,000 changed listings
-- took 59 s:
--   - finding them (listings.updated_at, no index) read the whole listings
--     table: 28 s. An index on updated_at would cost every view count its
--     HOT update, so instead the writes that matter say so: a trigger queues
--     a listing when it is created with a part number or its brand, part
--     number or status changes, a build line likewise, and a listing again
--     when it gains an "also known as" number. A run reads the queue and
--     clears what it read.
--   - the across-brands check was written "everything, or only these
--     numbers" (v_since is null or ...), which hid the numbers from the
--     planner: it merge-joined every product, 20 s. The run's numbers are now
--     always a list (every number in a full run) and every statement joins it.
--
-- And the across-brands review counts only identifiers something still
-- points at (a live listing or build line, a link or an admin's decision):
-- correcting a listing's brand left the old brand + number behind, and a
-- run then filed it as two brands sharing a number (1,007 false reviews
-- for 1,000 brand edits at 2M). Such reviews close themselves.
--
-- grow_products keeps its signature; a full run still reads everything. The queue is internal like the rest of the graph.
--
-- Idempotent.

begin;

create table if not exists public.product_grow_queue (
  id bigint generated always as identity primary key,
  listing_id uuid,
  mod_item_id uuid,
  queued_at timestamptz not null default now(),
  check ((listing_id is null) <> (mod_item_id is null))
);
alter table public.product_grow_queue enable row level security;
revoke all on table public.product_grow_queue from public, anon, authenticated;
grant all on table public.product_grow_queue to service_role;
comment on table public.product_grow_queue is
  'Listings and build lines whose brand, part number or status changed since the last grow_products run. Written by triggers, cleared by the run. Internal.';

create or replace function public.queue_product_growth_listing()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  insert into public.product_grow_queue (listing_id) values (new.id);
  return null;
end;
$function$;
revoke all on function public.queue_product_growth_listing() from public, anon, authenticated;

create or replace function public.queue_product_growth_mod()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  insert into public.product_grow_queue (mod_item_id) values (new.id);
  return null;
end;
$function$;
revoke all on function public.queue_product_growth_mod() from public, anon, authenticated;

create or replace function public.queue_product_growth_alias()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  insert into public.product_grow_queue (listing_id) values (new.listing_id);
  return null;
end;
$function$;
revoke all on function public.queue_product_growth_alias() from public, anon, authenticated;

drop trigger if exists product_growth_listing_insert on public.listings;
create trigger product_growth_listing_insert
  after insert on public.listings
  for each row when (new.part_number is not null)
  execute function public.queue_product_growth_listing();
drop trigger if exists product_growth_listing_update on public.listings;
create trigger product_growth_listing_update
  after update of brand, part_number, status on public.listings
  for each row when (old.brand is distinct from new.brand or old.part_number is distinct from new.part_number
                     or old.status is distinct from new.status)
  execute function public.queue_product_growth_listing();
drop trigger if exists product_growth_mod_insert on public.mod_items;
create trigger product_growth_mod_insert
  after insert on public.mod_items
  for each row when (new.part_number is not null)
  execute function public.queue_product_growth_mod();
drop trigger if exists product_growth_mod_update on public.mod_items;
create trigger product_growth_mod_update
  after update of brand, part_number on public.mod_items
  for each row when (old.brand is distinct from new.brand or old.part_number is distinct from new.part_number)
  execute function public.queue_product_growth_mod();
drop trigger if exists product_growth_alias_insert on public.listing_part_numbers;
create trigger product_growth_alias_insert
  after insert on public.listing_part_numbers
  for each row execute function public.queue_product_growth_alias();

-- Links added since the last run are found by date.
create index if not exists part_number_links_created_idx on public.part_number_links (created_at);

-- Restated from 20261020120000: the queue instead of updated_at, and the
-- run's numbers joined, never "everything, or only these".
create or replace function public.grow_products(p_full boolean default false)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_started timestamptz := clock_timestamp();
  v_since timestamptz;
  v_created int := 0;
  v_linked int := 0;
  v_merged int := 0;
  v_opened int := 0;
  v_obsolete int := 0;
  v_n int;
  r record;
  v_a uuid;
  v_b uuid;
  v_result jsonb;
  v_queue bigint;
begin
  -- One run at a time; a run that finds another in progress does nothing.
  if not pg_try_advisory_xact_lock(hashtext('public.grow_products')) then
    return jsonb_build_object('skipped', 'another run in progress');
  end if;
  if not p_full then
    -- A minute of overlap: a write committed just as the last run started.
    select max((result ->> 'started_at')::timestamptz) - interval '1 minute' into v_since
    from public.product_grow_runs where result ? 'started_at';
  end if;
  -- (v_since null = everything: the first run, or a full one.)
  -- What changed since the last run, as the write triggers queued it. Rows
  -- queued while this run works stay for the next one.
  select coalesce(max(q.id), 0) into v_queue from public.product_grow_queue q;

  -- The brand + number members wrote, from listings and build lines.
  create temp table if not exists grow_seen (
    brand_key text, number_compact text, brand text, number text, name text, category text,
    src text, listing_id uuid, mod_item_id uuid, created_at timestamptz
  ) on commit drop;
  truncate grow_seen;
  -- Two statements, not one with "everything, or the queued ids": that
  -- condition hides the ids from the planner, which then reads every listing.
  if v_since is null then
    insert into grow_seen
    select s.* from (
      select nullif(regexp_replace(lower(coalesce(l.brand, '')), '[^[:alnum:]]', '', 'g'), ''),
             l.part_number_compact, btrim(l.brand), btrim(l.part_number), l.title, l.category,
             'listing', l.id, null::uuid, l.created_at
      from public.listings l
      where l.part_number_compact is not null and l.status not in ('draft', 'removed')
      union all
      select m.brand_key, m.part_number_compact,
             -- Display only: the paste parser leaves leading punctuation ("-Bosch").
             regexp_replace(btrim(m.brand), '^[^[:alnum:]]+', ''), btrim(m.part_number), m.product, m.category,
             'mod', null::uuid, m.id, m.created_at
      from public.mod_items m
      where m.part_number_compact is not null
    ) s(brand_key, number_compact, brand, number, name, category, src, listing_id, mod_item_id, created_at)
    where s.number_compact ~ '[0-9]' and char_length(s.number_compact) between 3 and 64;
  else
    insert into grow_seen
    select s.* from (
      select nullif(regexp_replace(lower(coalesce(l.brand, '')), '[^[:alnum:]]', '', 'g'), ''),
             l.part_number_compact, btrim(l.brand), btrim(l.part_number), l.title, l.category,
             'listing', l.id, null::uuid, l.created_at
      from (select distinct q.listing_id from public.product_grow_queue q
            where q.id <= v_queue and q.listing_id is not null) q
      join public.listings l on l.id = q.listing_id
      where l.part_number_compact is not null and l.status not in ('draft', 'removed')
      union all
      select m.brand_key, m.part_number_compact,
             regexp_replace(btrim(m.brand), '^[^[:alnum:]]+', ''), btrim(m.part_number), m.product, m.category,
             'mod', null::uuid, m.id, m.created_at
      from (select distinct q.mod_item_id from public.product_grow_queue q
            where q.id <= v_queue and q.mod_item_id is not null) q
      join public.mod_items m on m.id = q.mod_item_id
      where m.part_number_compact is not null
    ) s(brand_key, number_compact, brand, number, name, category, src, listing_id, mod_item_id, created_at)
    where s.number_compact ~ '[0-9]' and char_length(s.number_compact) between 3 and 64;
  end if;
  -- In a full run grow_seen holds every live record, so "does anything
  -- still point at this identifier" is answered here first.
  create index if not exists grow_seen_key on grow_seen (brand_key, number_compact);
  analyze grow_seen;

  -- 1. A product for every brand + number no product holds yet. A listing
  -- names it before a build line does; the earliest record names it.
  with fresh as materialized (
    select distinct on (s.brand_key, s.number_compact)
           gen_random_uuid() as id, s.brand_key, s.number_compact,
           left(coalesce(nullif(s.brand, ''), s.brand_key), 80) as brand, left(s.number, 80) as number,
           left(s.name, 200) as name, left(s.category, 80) as category, s.src
    from grow_seen s
    where s.brand_key is not null and char_length(s.brand_key) <= 64
      and not exists (select 1 from public.product_part_numbers pm
                      where pm.brand_key = s.brand_key and pm.number_compact = s.number_compact)
    order by s.brand_key, s.number_compact, (s.src = 'listing') desc, s.created_at, coalesce(s.listing_id, s.mod_item_id)
  ), made as (
    insert into public.products (id, brand_key, brand, name, category, created_from)
    select f.id, f.brand_key, f.brand, f.name, f.category, f.src from fresh f
    returning id
  )
  insert into public.product_part_numbers (brand_key, number_compact, product_id, number, basis)
  select f.brand_key, f.number_compact, f.id, f.number, 'brand_and_number'
  from fresh f join made on made.id = f.id;
  get diagnostics v_created = row_count;

  -- The numbers this run is about: what was written, and what links name —
  -- every link in a full run, links added or verified since in an hourly
  -- one. Every statement below joins this list: an "everything, or only
  -- these" condition (v_since is null or ...) hides the list from the
  -- planner, which then reads all products (20 s at 2M parts).
  create temp table if not exists grow_numbers (number_compact text primary key) on commit drop;
  truncate grow_numbers;
  insert into grow_numbers select distinct number_compact from grow_seen on conflict do nothing;
  if v_since is null then
    insert into grow_numbers
    select n from public.part_number_links l, lateral (values (l.from_compact), (l.to_compact)) v(n)
    on conflict do nothing;
  else
    insert into grow_numbers
    select n from public.part_number_links l, lateral (values (l.from_compact), (l.to_compact)) v(n)
    where l.created_at >= v_since
    union
    select n from public.part_number_links l, lateral (values (l.from_compact), (l.to_compact)) v(n)
    where l.verified_at >= v_since
    on conflict do nothing;
  end if;
  analyze grow_numbers;

  -- 2. Brand-scoped same_product links join their two pairs' products.
  for r in
    select l.id, l.from_brand_key, l.from_compact, l.to_brand_key, l.to_compact
    from public.part_number_links l
    where l.kind = 'same_product' and l.from_brand_key is not null
      and exists (select 1 from grow_numbers g where g.number_compact in (l.from_compact, l.to_compact))
    order by l.created_at, l.id
  loop
    select pm.product_id into v_a from public.product_part_numbers pm
     where pm.brand_key = r.from_brand_key and pm.number_compact = r.from_compact;
    select pm.product_id into v_b from public.product_part_numbers pm
     where pm.brand_key = r.to_brand_key and pm.number_compact = r.to_compact;
    if v_a is null and v_b is null then
      continue; -- nobody has written either number: no product to grow
    elsif v_a is null or v_b is null then
      if char_length(case when v_a is null then r.from_compact else r.to_compact end) between 3 and 64 then
        insert into public.product_part_numbers (brand_key, number_compact, product_id, basis, link_id)
        values (case when v_a is null then r.from_brand_key else r.to_brand_key end,
                case when v_a is null then r.from_compact else r.to_compact end,
                coalesce(v_a, v_b), 'same_product_link', r.id)
        on conflict (brand_key, number_compact) do nothing;
        get diagnostics v_n = row_count;
        v_linked := v_linked + v_n;
      end if;
    elsif v_a <> v_b then
      perform public.merge_products(array[v_a, v_b], 'same_product_link', null);
      v_merged := v_merged + 1;
    end if;
  end loop;

  -- 3. File what's ambiguous.
  -- One number, several brands' products.
  insert into public.product_identity_reviews (kind, dedup_key, number_compact, brand_keys, product_ids, detail)
  select 'number_across_brands',
         left('nab:' || x.number_compact || ':' || array_to_string(x.brand_keys, ','), 400),
         x.number_compact, x.brand_keys, x.product_ids,
         jsonb_build_object('brands', x.brands)
  from (
    select pm.number_compact,
           array_agg(pm.brand_key order by pm.brand_key) as brand_keys,
           array_agg(pm.product_id order by pm.brand_key) as product_ids,
           array_agg(p.brand order by pm.brand_key) as brands
    from (
      -- Numbers held by more than one identifier: nearly every number has
      -- one, so this narrows 2M numbers to the few worth checking.
      select pm.number_compact
      from grow_numbers g join public.product_part_numbers pm on pm.number_compact = g.number_compact
      group by pm.number_compact having count(*) > 1
    ) g
    join public.product_part_numbers pm on pm.number_compact = g.number_compact
    join public.products p on p.id = pm.product_id and p.status = 'active'
    -- Only identifiers something still points at. A seller who corrects a
    -- brand leaves the old brand + number with no record; that is not two
    -- brands sharing a number.
    where (pm.basis <> 'brand_and_number'
           or exists (select 1 from grow_seen s where s.brand_key = pm.brand_key and s.number_compact = pm.number_compact)
           or v_since is not null and exists (select 1 from public.listings l
                      where l.part_number_compact = pm.number_compact and l.status not in ('draft', 'removed')
                        and nullif(regexp_replace(lower(coalesce(l.brand, '')), '[^[:alnum:]]', '', 'g'), '') = pm.brand_key)
           or v_since is not null and exists (select 1 from public.mod_items m
                      where m.part_number_compact = pm.number_compact and m.brand_key = pm.brand_key))
    group by pm.number_compact
    having count(distinct pm.product_id) > 1
  ) x
  on conflict (dedup_key) do nothing;
  get diagnostics v_n = row_count;
  v_opened := v_opened + v_n;

  -- A number we know, written without a brand.
  insert into public.product_identity_reviews (kind, dedup_key, number_compact, brand_keys, product_ids,
                                               listing_id, mod_item_id, detail)
  select 'brandless_number',
         'brandless:' || s.src || ':' || coalesce(s.listing_id, s.mod_item_id),
         s.number_compact, k.brand_keys, k.product_ids, s.listing_id, s.mod_item_id,
         jsonb_build_object('number', s.number, 'name', left(s.name, 200))
  from grow_seen s
  cross join lateral (
    select array_agg(pm.brand_key order by pm.brand_key) as brand_keys,
           array_agg(pm.product_id order by pm.brand_key) as product_ids
    from public.product_part_numbers pm where pm.number_compact = s.number_compact
  ) k
  where s.brand_key is null and k.product_ids is not null
  on conflict (dedup_key) do nothing;
  get diagnostics v_n = row_count;
  v_opened := v_opened + v_n;

  -- "Same product", without saying whose, between numbers two products hold.
  insert into public.product_identity_reviews (kind, dedup_key, number_compact, brand_keys, product_ids, link_id, detail)
  select 'unscoped_same_product', 'link:' || l.id, l.from_compact, k.brand_keys, k.product_ids, l.id,
         jsonb_build_object('from', l.from_compact, 'to', l.to_compact, 'source', l.source, 'source_ref', l.source_ref)
  from public.part_number_links l
  cross join lateral (
    select array_agg(distinct pm.brand_key) as brand_keys, array_agg(distinct pm.product_id) as product_ids
    from public.product_part_numbers pm where pm.number_compact in (l.from_compact, l.to_compact)
  ) k
  where l.kind = 'same_product' and l.from_brand_key is null
    and exists (select 1 from grow_numbers g where g.number_compact in (l.from_compact, l.to_compact))
    and exists (select 1 from public.product_part_numbers pm where pm.number_compact = l.from_compact)
    and exists (select 1 from public.product_part_numbers pm where pm.number_compact = l.to_compact)
    and cardinality(k.product_ids) > 1
  on conflict (dedup_key) do nothing;
  get diagnostics v_n = row_count;
  v_opened := v_opened + v_n;

  -- A listing's "also known as" number held by another product of its brand.
  insert into public.product_identity_reviews (kind, dedup_key, number_compact, brand_keys, product_ids, listing_id, detail)
  select 'listing_alternate', 'alt:' || s.listing_id || ':' || pn.number_compact, s.number_compact,
         array[s.brand_key], array[a.product_id, b.product_id], s.listing_id,
         jsonb_build_object('number', s.number, 'also_known_as', pn.number)
  from grow_seen s
  join public.listing_part_numbers pn on pn.listing_id = s.listing_id and pn.number_compact <> s.number_compact
  join public.product_part_numbers a on a.brand_key = s.brand_key and a.number_compact = s.number_compact
  join public.product_part_numbers b on b.brand_key = s.brand_key and b.number_compact = pn.number_compact
  where s.src = 'listing' and s.brand_key is not null and a.product_id <> b.product_id
  on conflict (dedup_key) do nothing;
  get diagnostics v_n = row_count;
  v_opened := v_opened + v_n;

  -- 4. Close what is no longer ambiguous: the products are now one, or the
  -- record has a brand, no longer carries the number, or is gone from sale
  -- for good. Read from the record itself, so an incremental run is right.
  update public.product_identity_reviews rv
     set status = 'obsolete', resolved_at = now(),
         resolution_note = 'No longer ambiguous: ' || case rv.kind
           when 'brandless_number' then 'the record now has a brand, or no longer has this number.'
           else 'these numbers now belong to one product.' end
   where rv.status = 'open'
     and case rv.kind
       when 'brandless_number' then not exists (
         select 1 from public.listings l
         where l.id = rv.listing_id and l.part_number_compact = rv.number_compact
           and nullif(regexp_replace(lower(coalesce(l.brand, '')), '[^[:alnum:]]', '', 'g'), '') is null
           and l.status not in ('draft', 'removed')
         union all
         select 1 from public.mod_items m
         where m.id = rv.mod_item_id and m.part_number_compact = rv.number_compact and m.brand_key is null)
       when 'number_across_brands' then (
         select count(distinct coalesce(p.merged_into, p.id))
         from public.product_part_numbers pm join public.products p on p.id = pm.product_id
         where pm.number_compact = rv.number_compact and (pm.basis <> 'brand_and_number'
             or exists (select 1 from public.listings l
                        where l.part_number_compact = pm.number_compact and l.status not in ('draft', 'removed')
                          and nullif(regexp_replace(lower(coalesce(l.brand, '')), '[^[:alnum:]]', '', 'g'), '') = pm.brand_key)
             or exists (select 1 from public.mod_items m
                        where m.part_number_compact = pm.number_compact and m.brand_key = pm.brand_key))) <= 1
       else (
         select count(distinct coalesce(p.merged_into, p.id)) from public.products p where p.id = any(rv.product_ids)) <= 1
     end;
  get diagnostics v_obsolete = row_count;

  -- What this run read leaves the queue.
  delete from public.product_grow_queue q where q.id <= v_queue;

  v_result := jsonb_build_object(
    'started_at', v_started, 'full', v_since is null, 'seen', (select count(*) from grow_seen),
    'numbers', (select count(*) from grow_numbers),
    'products_created', v_created, 'numbers_linked', v_linked, 'merges', v_merged,
    'reviews_opened', v_opened, 'reviews_obsolete', v_obsolete,
    'ms', round(extract(epoch from clock_timestamp() - v_started) * 1000));
  -- Coverage reads everything; measured on full runs only (and on demand
  -- through product_coverage()).
  if v_since is null then
    v_result := v_result || jsonb_build_object('coverage', public.product_coverage());
  end if;
  insert into public.product_grow_runs (result) values (v_result);
  delete from public.product_grow_runs
   where id < (select min(id) from (select id from public.product_grow_runs order by id desc limit 500) k);
  return v_result;
end;
$function$;
revoke all on function public.grow_products(boolean) from public, anon, authenticated;


do $$
begin
  if to_regclass('public.product_grow_queue') is null then
    raise exception '20261020150000: product_grow_queue missing';
  end if;
  raise notice 'PASS: 20261020150000 self-checks';
end $$;

commit;
