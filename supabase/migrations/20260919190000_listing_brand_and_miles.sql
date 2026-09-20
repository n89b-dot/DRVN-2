-- 20260919190000 — brand and part miles on a listing (PRD 2026-09 M-6, M-7).
--
-- A used-parts marketplace where you cannot filter by brand is a marketplace
-- you shop by scrolling. Brand is the single most common way people describe
-- the part they want ("Öhlins coilovers", "Brembo calipers"), and until now
-- it existed only inside the free-text title.
--
-- Three columns:
--   * brand — prefilled from the mod or the importer, matched from the title
--     otherwise, backfilled below, and editable like anything else;
--   * part_miles + part_miles_unit — optional, used parts only (M-7). How
--     far a part has been driven is the question buyers ask that a condition
--     grade can't answer.
--
-- `save_listing_creation` enumerates its columns in THREE places — the insert
-- list, the values parser and the replay-drift comparison. All three are
-- updated here; miss one and the field is silently dropped on publish while
-- everything appears to work.
--
-- The backfill is deliberately conservative: it matches the same curated
-- brand list the build sheet's parser uses, anchored at the start of the
-- title, longest name first so "Volk Racing" beats "Volk". A title that
-- doesn't start with a known brand is left null rather than guessed at — a
-- wrong brand is worse than no brand, because it silently excludes the
-- listing from the filter its seller would have wanted.
--
-- Idempotent. Safe to re-run.

begin;

alter table public.listings
  add column if not exists brand text,
  add column if not exists part_miles integer,
  add column if not exists part_miles_unit text;

comment on column public.listings.brand is
  'Who made the part. Prefilled from the mod or the importer, matched from the title otherwise, always editable.';
comment on column public.listings.part_miles is
  'How far this part has been driven (M-7). Optional, used parts only.';
comment on column public.listings.part_miles_unit is
  'mi | km for part_miles. Required when part_miles is set.';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'listings_part_miles_check') then
    alter table public.listings
      add constraint listings_part_miles_check
      check (
        part_miles is null
        or (part_miles >= 0 and part_miles <= 2000000 and part_miles_unit in ('mi', 'km'))
      );
  end if;
end;
$$;

-- Brand filtering and the brand facet both read this.
create index if not exists listings_brand_status_idx
  on public.listings (brand, status)
  where brand is not null;

-- ============================================================
-- Backfill from the curated brand list
-- ============================================================
create temporary table known_brands(name text) on commit drop;
insert into known_brands(name) values
    ('Air Lift Performance'),
    ('Perrin Performance'),
    ('Grams Performance'),
    ('Injector Dynamics'),
    ('Verus Engineering'),
    ('Godspeed Project'),
    ('Hawk Performance'),
    ('Rays Engineering'),
    ('APR Performance'),
    ('ARK Performance'),
    ('IAG Performance'),
    ('Precision Turbo'),
    ('SPC Performance'),
    ('Progress Group'),
    ('aero-exterior'),
    ('Milltek Sport'),
    ('Skunk2 Racing'),
    ('Deatschwerks'),
    ('Liberty Walk'),
    ('Megan Racing'),
    ('Password JDM'),
    ('Process West'),
    ('Rocket Bunny'),
    ('Spoon Sports'),
    ('Bridgestone'),
    ('Cobb Tuning'),
    ('Continental'),
    ('Volk Racing'),
    ('Work Wheels'),
    ('AWE Tuning'),
    ('BorgWarner'),
    ('Buddy Club'),
    ('drivetrain'),
    ('GrimmSpeed'),
    ('suspension'),
    ('Toyo Tires'),
    ('Turbosmart'),
    ('Weds Sport'),
    ('BC Racing'),
    ('Fifteen52'),
    ('Magnaflow'),
    ('Mishimoto'),
    ('Unitronic'),
    ('Whiteline'),
    ('Bilstein'),
    ('ecu-tune'),
    ('Eventuri'),
    ('Godspeed'),
    ('interior'),
    ('Link ECU'),
    ('Michelin'),
    ('Ralliart'),
    ('Rotiform'),
    ('StopTech'),
    ('Yokohama'),
    ('exhaust'),
    ('Garrett'),
    ('Haltech'),
    ('Invidia'),
    ('K-Tuned'),
    ('Pirelli'),
    ('Wilwood'),
    ('Brembo'),
    ('EcuTek'),
    ('Eibach'),
    ('Falken'),
    ('Greddy'),
    ('GReddy'),
    ('Ohlins'),
    ('Pandem'),
    ('Perrin'),
    ('Recaro'),
    ('Rywire'),
    ('Seibon'),
    ('Sparco'),
    ('Stance'),
    ('Voltex'),
    ('Vossen'),
    ('Walbro'),
    ('wheels'),
    ('Öhlins'),
    ('Advan'),
    ('Blitz'),
    ('Borla'),
    ('Bride'),
    ('Cusco'),
    ('Enkei'),
    ('Konig'),
    ('MoTeC'),
    ('Mugen'),
    ('Nismo'),
    ('Nitto'),
    ('Varis'),
    ('Momo'),
    ('Tein'),
    ('034'),
    ('AEM'),
    ('APR'),
    ('BBS'),
    ('CSF'),
    ('CTS'),
    ('EBC'),
    ('H&R'),
    ('HKS'),
    ('OMP'),
    ('PWR'),
    ('SSR'),
    ('STI'),
    ('TRD'),
    ('KW');

update public.listings l
   set brand = k.name
  from (
    select b.name
      from known_brands b
     order by length(b.name) desc
  ) k
 where l.brand is null
   and l.title ilike k.name || '%'
   and not exists (
     select 1 from known_brands other
      where length(other.name) > length(k.name)
        and l.title ilike other.name || '%'
   );

-- ============================================================
-- Brand joins the listing search text
-- ============================================================
-- Body otherwise identical to 0048's.
create or replace function public.search_listing_ids(p_query text)
returns setof uuid
language sql
stable
as $$
  with terms as (
    select distinct t
    from regexp_split_to_table(lower(coalesce(p_query, '')), '\s+') as t
    where length(t) >= 1
  ),
  scored as (
    select
      l.id,
      count(*) filter (
        where l.title ilike '%' || t.t || '%'
           or l.description ilike '%' || t.t || '%'
           or l.compatibility_notes ilike '%' || t.t || '%'
           or l.category ilike '%' || t.t || '%'
           or l.brand ilike '%' || t.t || '%'
           or word_similarity(t.t, l.title) >= 0.45
      ) as hits,
      bool_or(l.title ilike '%' || t.t || '%') as title_hit,
      max(similarity(l.title, lower(coalesce(p_query, '')))) as sim
    from public.listings l
    cross join terms t
    group by l.id
  )
  select id from (
    select id, hits, title_hit, sim, 0 as ord
    from scored
    where hits > 0
    union all
    -- No usable words (empty / whitespace query): behave like 0008 and
    -- return the unfiltered set.
    select l.id, 0, false, 0::real, 1 as ord
    from public.listings l
    where not exists (select 1 from terms)
  ) ranked
  order by ord, hits desc, title_hit desc, sim desc
$$;

-- ============================================================
-- Brand facet counts
-- ============================================================
create or replace function public.marketplace_brand_counts()
returns table(brand text, total bigint)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select l.brand, count(*)::bigint
    from public.listings l
   where l.status = 'active' and l.brand is not null
   group by l.brand
   order by count(*) desc, l.brand;
$$;

revoke all on function public.marketplace_brand_counts() from public;
grant execute on function public.marketplace_brand_counts() to anon, authenticated, service_role;

commit;
