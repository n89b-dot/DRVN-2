-- B1 — products with brand-aware identity (plan 2026-10 agent and graph,
-- "B1 — Graph foundation"; Corrections and better ways §1; second review:
-- "part-number links aren't product identity").
--
-- A product is one maker's one part. Its identity is explicit membership:
-- product_part_numbers says which (brand, part number) pairs ARE this
-- product. Three things put a pair in a product, and nothing else does:
--
--   brand_and_number   the pair itself. Two listings or build lines with the
--                      same brand and the same number are the same product
--                      by definition.
--   same_product_link  a part_number_links row of kind same_product whose
--                      two sides each name their brand. It merges the two
--                      pairs' products.
--   verified           an admin decided, from the review list below.
--
-- Every other link — alternate, supersedes, superseded_by, interchange,
-- aftermarket_equivalent — names a DIFFERENT product and stays an edge in
-- part_number_links. An interchangeable part is not the same part; neither is
-- the aftermarket copy of it.
--
-- part_number_links gains what an edge needs to be trusted: brand scope on
-- each side (from_brand_key / to_brand_key, both or neither), confidence,
-- provenance (source_ref, created_by) and verification. A same_product link
-- without brand scope says two numbers are one part without saying whose:
-- it merges nothing and goes to the review list.
--
-- Products grow out of what members already wrote. grow_products(), run in
-- full as the backfill below, then hourly over what changed and nightly in
-- full (pg_cron), finds every brand + number
-- on a listing or build line that no product holds yet and makes one,
-- applies brand-scoped same_product links, and sends anything ambiguous to
-- product_identity_reviews instead of deciding:
--
--   number_across_brands   one number held by products of several brands —
--                          different parts that share a number, or one brand
--                          spelled two ways ("vw" / "volkswagen")
--   brandless_number       a listing or build line with a number we know but
--                          no brand
--   unscoped_same_product  a same_product link with no brand scope that would
--                          join two products
--   listing_alternate      a listing's own "also known as" number held by a
--                          different product of the same brand
--
-- Admins resolve them (resolve_product_identity_review): merge, keep
-- separate, or dismiss, audited. Reviews whose ambiguity has gone (the
-- products merged, the record gained a brand) close themselves as obsolete.
-- Each run is logged (product_grow_runs); full runs record the coverage they
-- reached, which is how coverage is measured.
--
-- Only a number with a digit, 3–64 characters once compacted, starts a
-- product: "intercooler" or "kit" typed in the number box is not a part
-- number. Draft and removed listings don't start products.
--
-- Records point at products through the membership, never a stored id: a
-- listing's product is the one holding (its brand key, its part number), so
-- a seller who edits either moves the listing with no trigger on the
-- listing write path, and a merge moves every record at once.
--
-- Internal, like part_number_links: no client reads or writes any of these
-- tables. A product named from a private car's build line must not be
-- readable as a catalog. Reads for members come later as capabilities.
--
-- Idempotent.

begin;

-- ============================================================
-- 1. part_number_links: brand scope, confidence, provenance
-- ============================================================
alter table public.part_number_links
  add column if not exists from_brand_key text,
  add column if not exists to_brand_key text,
  add column if not exists confidence real,
  add column if not exists source_ref text,
  add column if not exists created_by uuid references public.profiles (id) on delete set null,
  add column if not exists verified_at timestamptz,
  add column if not exists verified_by uuid references public.profiles (id) on delete set null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'part_number_links_brand_scope_check') then
    alter table public.part_number_links add constraint part_number_links_brand_scope_check
      check ((from_brand_key is null) = (to_brand_key is null)
             and (from_brand_key is null or char_length(from_brand_key) between 1 and 64)
             and (to_brand_key is null or char_length(to_brand_key) between 1 and 64));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'part_number_links_confidence_check') then
    alter table public.part_number_links add constraint part_number_links_confidence_check
      check (confidence is null or confidence between 0 and 1);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'part_number_links_provenance_check') then
    alter table public.part_number_links add constraint part_number_links_provenance_check
      check ((source_ref is null or char_length(source_ref) <= 500)
             and (verified_by is null or verified_at is not null));
  end if;
end $$;

comment on column public.part_number_links.from_brand_key is
  'Brand (compacted, as mod_items.brand_key) the from number belongs to. Set with to_brand_key or not at all. A same_product link merges products only when both are set.';
comment on column public.part_number_links.confidence is
  'How sure the source is, 0–1. Null = not stated. Informational: confidence never merges products.';
comment on column public.part_number_links.source_ref is
  'Provenance: the import file and row, URL or listing the link came from.';

-- The same two numbers can be linked once per brand scope.
drop index if exists public.part_number_links_key;
create unique index if not exists part_number_links_scoped_key
  on public.part_number_links (from_compact, to_compact, kind, coalesce(from_brand_key, ''), coalesce(to_brand_key, ''));

-- ============================================================
-- 2. products and their membership
-- ============================================================
create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  brand_key text not null check (char_length(brand_key) between 1 and 64),
  brand text not null check (char_length(brand) between 1 and 80),
  name text check (name is null or char_length(name) <= 200),
  category text check (category is null or char_length(category) <= 80),
  status text not null default 'active' check (status in ('active', 'merged')),
  merged_into uuid references public.products (id) on delete restrict,
  created_from text not null check (created_from in ('listing', 'mod', 'admin')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status = 'merged') = (merged_into is not null)),
  check (merged_into is distinct from id)
);
create index if not exists products_merged_into_idx on public.products (merged_into) where merged_into is not null;

comment on table public.products is
  'One maker''s one part. Identity is product_part_numbers. Internal: no client access.';

create table if not exists public.product_part_numbers (
  brand_key text not null check (char_length(brand_key) between 1 and 64),
  number_compact text not null check (char_length(number_compact) between 3 and 64),
  product_id uuid not null references public.products (id) on delete cascade,
  number text check (number is null or char_length(number) <= 80),
  basis text not null check (basis in ('brand_and_number', 'same_product_link', 'verified')),
  link_id uuid references public.part_number_links (id) on delete set null,
  verified_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  -- An identifier belongs to one product.
  primary key (brand_key, number_compact)
);
create index if not exists product_part_numbers_product_idx on public.product_part_numbers (product_id);
-- "Which products hold this number, whatever the brand": the brandless and
-- across-brands reviews, and search.
create index if not exists product_part_numbers_number_idx on public.product_part_numbers (number_compact);

comment on table public.product_part_numbers is
  'Membership: the (brand, part number) pairs that are a product. basis says why. Internal: no client access.';

create table if not exists public.product_identity_reviews (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('number_across_brands', 'brandless_number', 'unscoped_same_product', 'listing_alternate')),
  -- What makes this review this review, so a rerun never files it twice.
  dedup_key text not null unique check (char_length(dedup_key) <= 400),
  number_compact text,
  brand_keys text[] not null default '{}',
  product_ids uuid[] not null default '{}',
  listing_id uuid references public.listings (id) on delete cascade,
  mod_item_id uuid references public.mod_items (id) on delete cascade,
  link_id uuid references public.part_number_links (id) on delete cascade,
  detail jsonb not null default '{}'::jsonb,
  status text not null default 'open' check (status in ('open', 'merged', 'kept_separate', 'dismissed', 'obsolete')),
  resolved_by uuid references public.profiles (id) on delete set null,
  resolved_at timestamptz,
  resolution_note text check (resolution_note is null or char_length(resolution_note) <= 4000),
  created_at timestamptz not null default now(),
  check ((status = 'open') = (resolved_at is null))
);
create index if not exists product_identity_reviews_open_idx
  on public.product_identity_reviews (kind, created_at) where status = 'open';
create index if not exists product_identity_reviews_listing_idx
  on public.product_identity_reviews (listing_id) where listing_id is not null;
create index if not exists product_identity_reviews_mod_idx
  on public.product_identity_reviews (mod_item_id) where mod_item_id is not null;
create index if not exists product_identity_reviews_link_idx
  on public.product_identity_reviews (link_id) where link_id is not null;

comment on table public.product_identity_reviews is
  'Ambiguous product identity for an admin to decide. Filed by grow_products(), resolved by resolve_product_identity_review(). Internal.';

-- Every run of grow_products, with what it did and the coverage it reached.
create table if not exists public.product_grow_runs (
  id bigint generated always as identity primary key,
  ran_at timestamptz not null default now(),
  result jsonb not null
);

alter table public.products enable row level security;
alter table public.product_part_numbers enable row level security;
alter table public.product_identity_reviews enable row level security;
alter table public.product_grow_runs enable row level security;
revoke all on table public.products, public.product_part_numbers, public.product_identity_reviews,
  public.product_grow_runs from public, anon, authenticated;
grant all on table public.products, public.product_part_numbers, public.product_identity_reviews,
  public.product_grow_runs to service_role;

-- ============================================================
-- 3. Merging: one product survives, the other's numbers move to it
-- ============================================================
-- The older product survives (its id is the one already referred to longest).
-- Moved numbers keep their basis unless the caller is an admin's decision.
create or replace function public.merge_products(p_products uuid[], p_basis text default null, p_actor uuid default null)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_keep uuid;
  v_gone uuid[];
begin
  -- Follow anything already merged to where it went, then lock in id order.
  select array_agg(distinct coalesce(p.merged_into, p.id)) into p_products
  from public.products p where p.id = any(p_products);
  perform 1 from public.products p where p.id = any(p_products) order by p.id for update;
  select p.id into v_keep from public.products p
  where p.id = any(p_products) and p.status = 'active' order by p.created_at, p.id limit 1;
  if v_keep is null then
    return null;
  end if;
  select array_agg(p.id) into v_gone from public.products p
  where p.id = any(p_products) and p.status = 'active' and p.id <> v_keep;
  if v_gone is null then
    return v_keep;
  end if;
  update public.product_part_numbers m
     set product_id = v_keep,
         basis = coalesce(p_basis, m.basis),
         verified_by = case when p_basis = 'verified' then p_actor else m.verified_by end
   where m.product_id = any(v_gone);
  update public.products set merged_into = v_keep, updated_at = now() where merged_into = any(v_gone);
  update public.products set status = 'merged', merged_into = v_keep, updated_at = now() where id = any(v_gone);
  update public.products set updated_at = now() where id = v_keep;
  return v_keep;
end;
$function$;
revoke all on function public.merge_products(uuid[], text, uuid) from public, anon, authenticated;

-- ============================================================
-- 4. Coverage: how much of what members wrote has a product
-- ============================================================
create or replace function public.product_coverage()
returns jsonb
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  with l as (
    select l.part_number_compact as n,
           nullif(regexp_replace(lower(coalesce(l.brand, '')), '[^[:alnum:]]', '', 'g'), '') as b
    from public.listings l
    where l.part_number_compact is not null and l.status not in ('draft', 'removed')
  ), m as (
    select m.part_number_compact as n, m.brand_key as b from public.mod_items m where m.part_number_compact is not null
  )
  select jsonb_build_object(
    'listings', (select jsonb_build_object(
        'with_number', count(*),
        'with_brand_and_number', count(*) filter (where b is not null),
        'eligible', count(*) filter (where b is not null and n ~ '[0-9]' and char_length(n) between 3 and 64),
        'with_product', count(*) filter (where exists (
          select 1 from public.product_part_numbers pm where pm.brand_key = l.b and pm.number_compact = l.n)))
      from l),
    'mod_items', (select jsonb_build_object(
        'with_number', count(*),
        'with_brand_and_number', count(*) filter (where b is not null),
        'eligible', count(*) filter (where b is not null and n ~ '[0-9]' and char_length(n) between 3 and 64),
        'with_product', count(*) filter (where exists (
          select 1 from public.product_part_numbers pm where pm.brand_key = m.b and pm.number_compact = m.n)))
      from m),
    'products', (select jsonb_build_object(
        'active', count(*) filter (where status = 'active'),
        'merged', count(*) filter (where status = 'merged'))
      from public.products p),
    -- Set-based, never a lookup per product against the lists above (at 2M
    -- parts that is quadratic).
    'products_on_listings_and_builds', (select count(*) from (
        select pm.product_id from public.product_part_numbers pm join l on l.b = pm.brand_key and l.n = pm.number_compact
        intersect
        select pm.product_id from public.product_part_numbers pm join m on m.b = pm.brand_key and m.n = pm.number_compact) x),
    'open_reviews', (select coalesce(jsonb_object_agg(kind, n), '{}'::jsonb)
      from (select kind, count(*) as n from public.product_identity_reviews where status = 'open' group by kind) r)
  );
$function$;
revoke all on function public.product_coverage() from public, anon, authenticated;

-- ============================================================
-- 5. Growing products
-- ============================================================
-- Incremental by default: only listings and build lines written since the
-- last run started (updated_at is kept by their touch triggers), alternates
-- and links added since, and links touching what changed. p_full rescans
-- everything — the backfill, and a nightly safety net. Neither listings nor
-- mod_items gets an updated_at index for this: a seq scan an hour is cheaper
-- than breaking HOT updates on every view count.
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

  -- The brand + number members wrote, from listings and build lines.
  create temp table if not exists grow_seen (
    brand_key text, number_compact text, brand text, number text, name text, category text,
    src text, listing_id uuid, mod_item_id uuid, created_at timestamptz
  ) on commit drop;
  truncate grow_seen;
  insert into grow_seen
  select s.* from (
    select nullif(regexp_replace(lower(coalesce(l.brand, '')), '[^[:alnum:]]', '', 'g'), ''),
           l.part_number_compact, btrim(l.brand), btrim(l.part_number), l.title, l.category,
           'listing', l.id, null::uuid, l.created_at
    from public.listings l
    where l.part_number_compact is not null and l.status not in ('draft', 'removed')
      and (v_since is null or l.updated_at >= v_since or l.created_at >= v_since
           or exists (select 1 from public.listing_part_numbers pn where pn.listing_id = l.id and pn.created_at >= v_since))
    union all
    select m.brand_key, m.part_number_compact,
           -- Display only: the paste parser leaves leading punctuation ("-Bosch").
           regexp_replace(btrim(m.brand), '^[^[:alnum:]]+', ''), btrim(m.part_number), m.product, m.category,
           'mod', null::uuid, m.id, m.created_at
    from public.mod_items m
    where m.part_number_compact is not null
      and (v_since is null or m.updated_at >= v_since or m.created_at >= v_since)
  ) s(brand_key, number_compact, brand, number, name, category, src, listing_id, mod_item_id, created_at)
  where s.number_compact ~ '[0-9]' and char_length(s.number_compact) between 3 and 64;
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

  -- The numbers this run is about: what was written, and what links added
  -- since name. Everything below looks only at these (or at everything, in
  -- a full run).
  create temp table if not exists grow_numbers (number_compact text primary key) on commit drop;
  truncate grow_numbers;
  if v_since is not null then
    insert into grow_numbers select distinct number_compact from grow_seen on conflict do nothing;
    insert into grow_numbers
    select n from public.part_number_links l, lateral (values (l.from_compact), (l.to_compact)) v(n)
    where l.created_at >= v_since or l.verified_at >= v_since
    on conflict do nothing;
    analyze grow_numbers;
  end if;

  -- 2. Brand-scoped same_product links join their two pairs' products.
  for r in
    select l.id, l.from_brand_key, l.from_compact, l.to_brand_key, l.to_compact
    from public.part_number_links l
    where l.kind = 'same_product' and l.from_brand_key is not null
      and (v_since is null
           or exists (select 1 from grow_numbers g where g.number_compact in (l.from_compact, l.to_compact)))
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
    from public.product_part_numbers pm
    join public.products p on p.id = pm.product_id and p.status = 'active'
    where v_since is null or pm.number_compact in (select number_compact from grow_numbers)
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
    and (v_since is null
         or exists (select 1 from grow_numbers g where g.number_compact in (l.from_compact, l.to_compact)))
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
       else (
         select count(distinct coalesce(p.merged_into, p.id)) from public.products p where p.id = any(rv.product_ids)) <= 1
     end;
  get diagnostics v_obsolete = row_count;

  v_result := jsonb_build_object(
    'started_at', v_started, 'full', v_since is null, 'seen', (select count(*) from grow_seen),
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

-- ============================================================
-- 6. Admins decide
-- ============================================================
-- Same gate as execute_admin_command: a full admin with a TOTP step-up in
-- the last 15 minutes. Writes its own audit row in the same transaction.
create or replace function public.resolve_product_identity_review(p_review uuid, p_decision text, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_actor uuid := (select auth.uid());
  v_review public.product_identity_reviews;
  v_keep uuid;
  v_status text;
begin
  if not public.is_admin() or public.admin_role() <> 'admin' or not exists (
    select 1 from jsonb_array_elements(coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb -> 'amr', '[]'::jsonb)) m
    where m ->> 'method' in ('totp', 'mfa/totp')
      and (m ->> 'timestamp')::numeric between extract(epoch from now()) - 900 and extract(epoch from now()) + 60
  ) then
    raise exception 'Admin step-up required' using errcode = '42501';
  end if;
  if p_reason is null or length(trim(p_reason)) < 1 or length(p_reason) > 4000 then
    raise exception 'A reason of 1–4000 characters is required';
  end if;

  select * into v_review from public.product_identity_reviews where id = p_review for update;
  if not found then
    raise exception 'Review not found';
  end if;
  if v_review.status <> 'open' then
    raise exception 'This review is already closed (%)', v_review.status;
  end if;

  if p_decision = 'merge' then
    if v_review.kind = 'brandless_number' then
      raise exception 'A record without a brand can''t be merged: dismiss it, or ask the member to add the brand';
    end if;
    v_keep := public.merge_products(v_review.product_ids, 'verified', v_actor);
    if v_review.link_id is not null then
      update public.part_number_links set verified_at = now(), verified_by = v_actor where id = v_review.link_id;
    end if;
    v_status := 'merged';
  elsif p_decision = 'keep_separate' then
    if v_review.kind = 'brandless_number' then
      raise exception 'Dismiss a record without a brand instead';
    end if;
    v_status := 'kept_separate';
  elsif p_decision = 'dismiss' then
    v_status := 'dismissed';
  else
    raise exception 'Decision must be merge, keep_separate or dismiss';
  end if;

  update public.product_identity_reviews
     set status = v_status, resolved_by = v_actor, resolved_at = now(), resolution_note = p_reason
   where id = p_review;
  insert into public.admin_audit_log (actor_id, action, subject_type, subject_id, reason, metadata)
  values (v_actor, 'product.' || p_decision, 'product_review', p_review, p_reason,
          jsonb_build_object('phase', 'completed', 'kind', v_review.kind, 'productIds', v_review.product_ids,
                             'keptProductId', v_keep, 'numberCompact', v_review.number_compact));
  return jsonb_build_object('status', v_status, 'keptProductId', v_keep);
end;
$function$;
revoke all on function public.resolve_product_identity_review(uuid, text, text) from public, anon;
grant execute on function public.resolve_product_identity_review(uuid, text, text) to authenticated;

-- The audit trail names the review it decided. Built from the constraint as
-- it stands, so a value another migration added is kept.
do $$
declare
  v_values text[];
begin
  select array_agg(distinct v order by v) into v_values
  from (
    select (regexp_matches(pg_get_constraintdef(c.oid), '''([a-z_]+)''', 'g'))[1] as v
    from pg_constraint c
    where c.conrelid = 'public.admin_audit_log'::regclass and c.conname = 'admin_audit_log_subject_type_check'
    union select 'product_review'
  ) x;
  alter table public.admin_audit_log drop constraint if exists admin_audit_log_subject_type_check;
  execute format('alter table public.admin_audit_log add constraint admin_audit_log_subject_type_check check (subject_type = any (%L::text[]))', v_values);
end $$;

-- ============================================================
-- 7. Backfill (a full run), then hourly, and in full nightly
-- ============================================================
do $$
begin
  perform public.grow_products(true);
end $$;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname in ('drvn-grow-products', 'drvn-grow-products-full');
    perform cron.schedule('drvn-grow-products', '17 * * * *', 'select public.grow_products()');
    perform cron.schedule('drvn-grow-products-full', '47 4 * * *', 'select public.grow_products(true)');
  end if;
end $$;

-- ============================================================
-- Self-checks
-- ============================================================
do $$
declare
  v jsonb;
begin
  select result into v from public.product_grow_runs order by id desc limit 1;
  if v is null then
    raise exception '20261020120000: the backfill did not run';
  end if;
  raise notice '20261020120000: backfill %', v;
  raise notice 'PASS: 20261020120000 self-checks';
end $$;

commit;
