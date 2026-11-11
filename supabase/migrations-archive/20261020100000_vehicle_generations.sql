-- B1 — car generations (plan 2026-10 agent and graph, "B1 — Graph
-- foundation"; Corrections and better ways §2).
--
-- The catalog knows makes and models, not generations. A part that fits a
-- Mk7 Golf R rarely fits a Mk8, and enthusiasts name cars by generation
-- (E46, R34, ND), so the graph needs one level below the model: no trims,
-- no engines, no variant catalog — those wait until a real fitment rule
-- needs them (product_fitments carries engine/gearbox/brake constraints as
-- plain codes instead).
--
--   vehicle_generations — one row per generation of a catalog model, with
--     its platform code and the years it covers. Public read like the rest
--     of the catalog; written only by this seed, admin tooling or imports.
--   cars.generation_id + generation_source — which generation the car is.
--     Resolved deterministically from catalog_model_id + year: exactly one
--     generation covering the year, or nothing. Changeover years (a Mk7 and
--     a Mk8 were both sold in 2020) cover two generations on purpose and
--     resolve to nothing; that is the moment to ask the owner, and an owner's
--     choice (generation_source = 'owner') is kept as long as it still fits
--     the car's model and year.
--
-- Year ranges are the union of production years and the main markets'
-- model years, so a US model-year car never resolves to the generation its
-- European twin had already moved to. Overlaps are the honest answer, not a
-- data error. The seed is curated by hand (no open data source carries
-- generations — VehiclesDB, the catalog's source, stops at the model) and
-- covers the enthusiast platforms DRVN's members drive; a model the catalog
-- doesn't hold is skipped, and re-running this migration after a catalog
-- import fills it in (every statement here is idempotent).
--
-- Nothing reads generations yet except the resolver; listing_vehicle_fit and
-- every marketplace read are untouched (the B1 gate: their output must not
-- change).

begin;

create table if not exists public.vehicle_generations (
  id bigint generated always as identity primary key,
  model_id bigint not null references public.catalog_models (id) on delete cascade,
  -- What enthusiasts call it: 'Mk8', 'E46', 'R34', 'ND'.
  name text not null check (char_length(name) between 1 and 40),
  -- The maker's chassis or platform code where it differs or adds to the
  -- name: Golf Mk8 is 'CD', a 911 '992'.
  platform_code text check (platform_code is null or char_length(platform_code) between 1 and 40),
  year_start int not null check (year_start between 1885 and 2100),
  year_end int check (year_end is null or year_end between year_start and 2100),
  source text not null default 'drvn_curated' check (source in ('drvn_curated', 'admin', 'import')),
  source_ref text check (source_ref is null or char_length(source_ref) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists vehicle_generations_model_name_key
  on public.vehicle_generations (model_id, lower(name));
-- (id, model_id) is the target of product_fitments' composite key, so a
-- fitment can never name a generation of another model.
create unique index if not exists vehicle_generations_id_model_key
  on public.vehicle_generations (id, model_id);
create index if not exists vehicle_generations_model_years_idx
  on public.vehicle_generations (model_id, year_start);

alter table public.vehicle_generations enable row level security;
revoke all on table public.vehicle_generations from public, anon, authenticated;
grant select on table public.vehicle_generations to anon, authenticated;
grant all on table public.vehicle_generations to service_role;
drop policy if exists "vehicle generations are public" on public.vehicle_generations;
create policy "vehicle generations are public" on public.vehicle_generations
  for select to anon, authenticated using (true);

comment on table public.vehicle_generations is
  'Generations of a catalog model (Mk8, E46, R34) with platform code and years covered. Public catalog data; written by seed/admin/import only.';

-- ---------- cars: which generation ----------
alter table public.cars
  add column if not exists generation_id bigint references public.vehicle_generations (id) on delete set null,
  add column if not exists generation_source text;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'cars_generation_source_check') then
    alter table public.cars add constraint cars_generation_source_check
      check (generation_source in ('resolved', 'owner') and generation_id is not null
             or generation_source is null and generation_id is null);
  end if;
end $$;
create index if not exists cars_generation_idx on public.cars (generation_id) where generation_id is not null;
-- cars is readable column by column (20261004160000 keeps vin private):
-- the generation says no more than make, model and year already do.
-- car_vin_privacy_guard.sql holds the readable set.
grant select (generation_id, generation_source) on public.cars to anon, authenticated;

-- explore_build_rows returns whole car rows with vin blanked, so a new cars
-- column must be named here or Explore's build search fails ("return type
-- mismatch"). Restated from 20261011120000 with the two columns appended.
create or replace function public.explore_build_rows(p_query text)
returns setof public.cars
language sql
stable
as $function$
 select c.id, c.owner_id, c.slug, c.name, c.make, c.model, c.year, c.color, c.about, c.tags,
        c.cover_image_url, c.is_public, c.created_at, c.updated_at, null::text as vin, c.trim,
        c.engine, c.drivetrain, c.body_class, c.vin_decoded_at, c.catalog_make_id, c.catalog_model_id,
        c.identity_source, c.cover_focal_x, c.cover_focal_y, c.make_key, c.model_key,
        c.generation_id, c.generation_source
 from public.search_car_ids(p_query) with ordinality ranked(id,rank)
 join public.cars c on c.id=ranked.id where c.is_public order by ranked.rank,c.id;
$function$;

comment on column public.cars.generation_id is
  'The car''s generation. Resolved from catalog_model_id + year when exactly one generation covers the year; otherwise null until the owner chooses.';
comment on column public.cars.generation_source is
  'resolved (the one generation covering model + year) or owner (the owner chose it). Null when generation_id is null.';

-- The one generation of this model that covers this year, or null when none
-- or several do. A car with no year resolves only if its model has exactly
-- one generation.
create or replace function public.resolve_vehicle_generation(p_model_id bigint, p_year int)
returns bigint
language sql
stable
security invoker
set search_path to 'public', 'pg_temp'
as $function$
  select case when count(*) = 1 then min(g.id) end
  from public.vehicle_generations g
  where g.model_id = p_model_id
    and (p_year is null or p_year between g.year_start and coalesce(g.year_end, 2100));
$function$;
grant execute on function public.resolve_vehicle_generation(bigint, int) to anon, authenticated, service_role;

-- Before a car is written: keep an owner's choice that still fits, take a
-- new one that fits, otherwise resolve. Owners update their own cars
-- directly (RLS), so generation_source is never trusted from the client: a
-- choice is an owner's only when this trigger says so.
create or replace function public.car_generation_before_write()
returns trigger
language plpgsql
security invoker
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_fits boolean;
begin
  v_fits := new.generation_id is not null and new.catalog_model_id is not null and exists (
    select 1 from public.vehicle_generations g
    where g.id = new.generation_id and g.model_id = new.catalog_model_id
      and (new.year is null or new.year between g.year_start and coalesce(g.year_end, 2100)));
  if v_fits and (tg_op = 'INSERT'
                 or new.generation_id is distinct from old.generation_id
                 or old.generation_source = 'owner') then
    new.generation_source := 'owner';
    return new;
  end if;
  new.generation_id := public.resolve_vehicle_generation(new.catalog_model_id, new.year);
  new.generation_source := case when new.generation_id is not null then 'resolved' end;
  return new;
end;
$function$;
revoke all on function public.car_generation_before_write() from public, anon, authenticated;

drop trigger if exists car_generation_before_write on public.cars;
create trigger car_generation_before_write
  before insert or update of catalog_model_id, year, generation_id, generation_source on public.cars
  for each row execute function public.car_generation_before_write();

-- A generation added, moved or removed re-resolves that model's cars that
-- weren't chosen by their owner (the trigger above keeps owners' choices
-- that still fit and drops ones that no longer do). Only cars whose answer
-- changes are written; none of cars' search or vehicle-fit triggers watch
-- these columns.
create or replace function public.vehicle_generations_rescan()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_models bigint[];
begin
  if tg_op = 'INSERT' then
    select array_agg(distinct model_id) into v_models from changed_new;
  elsif tg_op = 'DELETE' then
    select array_agg(distinct model_id) into v_models from changed_old;
  else
    select array_agg(distinct model_id) into v_models
    from (select model_id from changed_old union select model_id from changed_new) m;
  end if;
  update public.cars c
     set generation_id = c.generation_id
   where c.catalog_model_id = any(v_models)
     and (c.generation_source is distinct from 'owner'
          and c.generation_id is distinct from public.resolve_vehicle_generation(c.catalog_model_id, c.year)
          or c.generation_source = 'owner');
  return null;
end;
$function$;
revoke all on function public.vehicle_generations_rescan() from public, anon, authenticated;

drop trigger if exists vehicle_generations_rescan_insert on public.vehicle_generations;
create trigger vehicle_generations_rescan_insert
  after insert on public.vehicle_generations referencing new table as changed_new
  for each statement execute function public.vehicle_generations_rescan();
drop trigger if exists vehicle_generations_rescan_update on public.vehicle_generations;
create trigger vehicle_generations_rescan_update
  after update on public.vehicle_generations referencing old table as changed_old new table as changed_new
  for each statement execute function public.vehicle_generations_rescan();
drop trigger if exists vehicle_generations_rescan_delete on public.vehicle_generations;
create trigger vehicle_generations_rescan_delete
  after delete on public.vehicle_generations referencing old table as changed_old
  for each statement execute function public.vehicle_generations_rescan();

-- ---------- curated seed ----------
-- (make, model, name, platform code, first year, last year or null = current)
insert into public.vehicle_generations (model_id, name, platform_code, year_start, year_end, source)
select cm.id, s.name, s.platform_code, s.year_start, s.year_end, 'drvn_curated'
from (values
  ('Volkswagen', 'Golf', 'Mk1', '17', 1974, 1984),
  ('Volkswagen', 'Golf', 'Mk2', '1G', 1983, 1992),
  ('Volkswagen', 'Golf', 'Mk3', '1H', 1991, 1999),
  ('Volkswagen', 'Golf', 'Mk4', '1J', 1997, 2006),
  ('Volkswagen', 'Golf', 'Mk5', '1K', 2003, 2009),
  ('Volkswagen', 'Golf', 'Mk6', '5K', 2008, 2014),
  ('Volkswagen', 'Golf', 'Mk7', '5G', 2012, 2021),
  ('Volkswagen', 'Golf', 'Mk8', 'CD', 2019, null),
  ('Volkswagen', 'Golf GTI', 'Mk1', '17', 1976, 1984),
  ('Volkswagen', 'Golf GTI', 'Mk2', '1G', 1984, 1992),
  ('Volkswagen', 'Golf GTI', 'Mk3', '1H', 1992, 1999),
  ('Volkswagen', 'Golf GTI', 'Mk4', '1J', 1998, 2006),
  ('Volkswagen', 'Golf GTI', 'Mk5', '1K', 2004, 2009),
  ('Volkswagen', 'Golf GTI', 'Mk6', '5K', 2009, 2014),
  ('Volkswagen', 'Golf GTI', 'Mk7', '5G', 2013, 2021),
  ('Volkswagen', 'Golf GTI', 'Mk8', 'CD', 2020, null),
  ('Volkswagen', 'GTI', 'Mk1', '17', 1976, 1984),
  ('Volkswagen', 'GTI', 'Mk2', '1G', 1984, 1992),
  ('Volkswagen', 'GTI', 'Mk3', '1H', 1992, 1999),
  ('Volkswagen', 'GTI', 'Mk4', '1J', 1998, 2006),
  ('Volkswagen', 'GTI', 'Mk5', '1K', 2004, 2009),
  ('Volkswagen', 'GTI', 'Mk6', '5K', 2009, 2014),
  ('Volkswagen', 'GTI', 'Mk7', '5G', 2013, 2021),
  ('Volkswagen', 'GTI', 'Mk8', 'CD', 2020, null),
  ('Volkswagen', 'Golf R', 'Mk6', '5K', 2010, 2013),
  ('Volkswagen', 'Golf R', 'Mk7', '5G', 2013, 2020),
  ('Volkswagen', 'Golf R', 'Mk8', 'CD', 2020, null),
  ('Volkswagen', 'Scirocco', 'Mk1', '53', 1974, 1981),
  ('Volkswagen', 'Scirocco', 'Mk2', '53B', 1981, 1992),
  ('Volkswagen', 'Scirocco', 'Mk3', '13', 2008, 2017),
  ('BMW', 'M3', 'E30', 'E30', 1986, 1991),
  ('BMW', 'M3', 'E36', 'E36', 1992, 1999),
  ('BMW', 'M3', 'E46', 'E46', 2000, 2006),
  ('BMW', 'M3', 'E9x', 'E90/E92/E93', 2007, 2013),
  ('BMW', 'M3', 'F80', 'F80', 2014, 2018),
  ('BMW', 'M3', 'G80', 'G80', 2020, null),
  ('BMW', 'M4', 'F82', 'F82/F83', 2014, 2020),
  ('BMW', 'M4', 'G82', 'G82/G83', 2020, null),
  ('BMW', 'M2', 'F87', 'F87', 2015, 2021),
  ('BMW', 'M2', 'G87', 'G87', 2022, null),
  ('BMW', 'M5', 'E28', 'E28', 1984, 1988),
  ('BMW', 'M5', 'E34', 'E34', 1988, 1995),
  ('BMW', 'M5', 'E39', 'E39', 1998, 2003),
  ('BMW', 'M5', 'E60', 'E60/E61', 2004, 2010),
  ('BMW', 'M5', 'F10', 'F10', 2011, 2016),
  ('BMW', 'M5', 'F90', 'F90', 2017, 2024),
  ('BMW', 'M5', 'G90', 'G90/G99', 2024, null),
  ('BMW', '3 Series', 'E21', 'E21', 1975, 1983),
  ('BMW', '3 Series', 'E30', 'E30', 1982, 1994),
  ('BMW', '3 Series', 'E36', 'E36', 1990, 2000),
  ('BMW', '3 Series', 'E46', 'E46', 1997, 2006),
  ('BMW', '3 Series', 'E9x', 'E90/E91/E92/E93', 2004, 2013),
  ('BMW', '3 Series', 'F30', 'F30/F31/F34', 2011, 2019),
  ('BMW', '3 Series', 'G20', 'G20/G21', 2018, null),
  ('BMW', '1 Series', 'E8x', 'E81/E82/E87/E88', 2004, 2013),
  ('BMW', '1 Series', 'F20', 'F20/F21', 2011, 2019),
  ('BMW', '1 Series', 'F40', 'F40', 2019, null),
  ('Audi', 'RS4', 'B5', 'B5', 2000, 2001),
  ('Audi', 'RS4', 'B7', 'B7', 2005, 2008),
  ('Audi', 'RS4', 'B8', 'B8', 2012, 2015),
  ('Audi', 'RS4', 'B9', 'B9', 2017, null),
  ('Audi', 'S4', 'B5', 'B5', 1997, 2002),
  ('Audi', 'S4', 'B6', 'B6', 2003, 2005),
  ('Audi', 'S4', 'B7', 'B7', 2005, 2008),
  ('Audi', 'S4', 'B8', 'B8', 2008, 2016),
  ('Audi', 'S4', 'B9', 'B9', 2016, null),
  ('Audi', 'S3', '8L', '8L', 1999, 2003),
  ('Audi', 'S3', '8P', '8P', 2006, 2013),
  ('Audi', 'S3', '8V', '8V', 2013, 2020),
  ('Audi', 'S3', '8Y', '8Y', 2020, null),
  ('Audi', 'RS3', '8P', '8P', 2011, 2012),
  ('Audi', 'RS3', '8V', '8V', 2015, 2020),
  ('Audi', 'RS3', '8Y', '8Y', 2021, null),
  ('Audi', 'TT', 'Mk1', '8N', 1998, 2006),
  ('Audi', 'TT', 'Mk2', '8J', 2006, 2014),
  ('Audi', 'TT', 'Mk3', '8S', 2014, 2023),
  ('Audi', 'TTS', 'Mk2', '8J', 2008, 2014),
  ('Audi', 'TTS', 'Mk3', '8S', 2015, 2023),
  ('Chevrolet', 'Corvette', 'C1', 'C1', 1953, 1962),
  ('Chevrolet', 'Corvette', 'C2', 'C2', 1963, 1967),
  ('Chevrolet', 'Corvette', 'C3', 'C3', 1968, 1982),
  ('Chevrolet', 'Corvette', 'C4', 'C4', 1984, 1996),
  ('Chevrolet', 'Corvette', 'C5', 'C5', 1997, 2004),
  ('Chevrolet', 'Corvette', 'C6', 'C6', 2005, 2013),
  ('Chevrolet', 'Corvette', 'C7', 'C7', 2014, 2019),
  ('Chevrolet', 'Corvette', 'C8', 'C8', 2020, null),
  ('Chevrolet', 'Camaro', '1st gen', 'F-body', 1967, 1969),
  ('Chevrolet', 'Camaro', '2nd gen', 'F-body', 1970, 1981),
  ('Chevrolet', 'Camaro', '3rd gen', 'F-body', 1982, 1992),
  ('Chevrolet', 'Camaro', '4th gen', 'F-body', 1993, 2002),
  ('Chevrolet', 'Camaro', '5th gen', 'Zeta', 2010, 2015),
  ('Chevrolet', 'Camaro', '6th gen', 'Alpha', 2016, 2024),
  ('Ford', 'Mustang', 'Fox body', 'Fox', 1979, 1993),
  ('Ford', 'Mustang', 'SN95', 'SN95', 1994, 2004),
  ('Ford', 'Mustang', 'S197', 'S197', 2005, 2014),
  ('Ford', 'Mustang', 'S550', 'S550', 2015, 2023),
  ('Ford', 'Mustang', 'S650', 'S650', 2024, null),
  ('Ford', 'Focus', 'Mk1', 'C170', 1998, 2007),
  ('Ford', 'Focus', 'Mk2', 'C307', 2004, 2011),
  ('Ford', 'Focus', 'Mk3', 'C346', 2010, 2018),
  ('Ford', 'Focus', 'Mk4', 'C519', 2018, 2025),
  ('Ford', 'Fiesta', 'Mk6', 'B256', 2002, 2008),
  ('Ford', 'Fiesta', 'Mk7', 'B299', 2008, 2019),
  ('Ford', 'Fiesta', 'Mk8', 'B479', 2017, 2023),
  ('Dodge', 'Challenger', 'LC', 'LC', 2008, 2023),
  ('Dodge', 'Charger', 'LX', 'LX', 2006, 2010),
  ('Dodge', 'Charger', 'LD', 'LD', 2011, 2023),
  ('Dodge', 'Charger', 'LB', 'LB', 2024, null),
  ('Honda', 'Civic', 'EG', 'EG/EH', 1991, 1995),
  ('Honda', 'Civic', 'EK', 'EK/EJ', 1995, 2000),
  ('Honda', 'Civic', '7th gen', 'EP/EM/ES', 2000, 2005),
  ('Honda', 'Civic', '8th gen', 'FD/FN/FK', 2005, 2011),
  ('Honda', 'Civic', '9th gen', 'FB/FG/FK', 2011, 2016),
  ('Honda', 'Civic', '10th gen', 'FC/FK', 2015, 2021),
  ('Honda', 'Civic', '11th gen', 'FE/FL', 2021, null),
  ('Honda', 'Civic Type R', 'EK9', 'EK9', 1997, 2000),
  ('Honda', 'Civic Type R', 'EP3', 'EP3', 2001, 2005),
  ('Honda', 'Civic Type R', 'FD2', 'FD2/FN2', 2007, 2011),
  ('Honda', 'Civic Type R', 'FK2', 'FK2', 2015, 2017),
  ('Honda', 'Civic Type R', 'FK8', 'FK8', 2017, 2021),
  ('Honda', 'Civic Type R', 'FL5', 'FL5', 2022, null),
  ('Honda', 'S2000', 'AP1', 'AP1', 1999, 2003),
  ('Honda', 'S2000', 'AP2', 'AP2', 2004, 2009),
  ('Honda', 'Integra', 'DA', 'DA/DB', 1989, 1993),
  ('Honda', 'Integra', 'DC2', 'DC2/DB8', 1993, 2001),
  ('Honda', 'Integra', 'DC5', 'DC5', 2001, 2006),
  ('Acura', 'Integra', 'DA', 'DA/DB', 1990, 1993),
  ('Acura', 'Integra', 'DC2', 'DC2/DB8', 1994, 2001),
  ('Acura', 'Integra', 'DE', 'DE4/DE5', 2022, null),
  ('Mazda', 'MX-5', 'NA', 'NA', 1989, 1998),
  ('Mazda', 'MX-5', 'NB', 'NB', 1998, 2005),
  ('Mazda', 'MX-5', 'NC', 'NC', 2005, 2015),
  ('Mazda', 'MX-5', 'ND', 'ND', 2015, null),
  ('Mazda', 'RX-7', 'FB', 'SA22C/FB', 1978, 1985),
  ('Mazda', 'RX-7', 'FC', 'FC3S', 1985, 1992),
  ('Mazda', 'RX-7', 'FD', 'FD3S', 1992, 2002),
  ('Mazda', 'RX-8', 'SE3P', 'SE3P', 2003, 2012),
  ('Mercedes-Benz', 'C-Class', 'W202', 'W202', 1993, 2000),
  ('Mercedes-Benz', 'C-Class', 'W203', 'W203', 2000, 2007),
  ('Mercedes-Benz', 'C-Class', 'W204', 'W204', 2007, 2014),
  ('Mercedes-Benz', 'C-Class', 'W205', 'W205', 2014, 2021),
  ('Mercedes-Benz', 'C-Class', 'W206', 'W206', 2021, null),
  ('MINI', 'Cooper', 'R50/R53', 'R50/R52/R53', 2001, 2006),
  ('MINI', 'Cooper', 'R56', 'R55/R56/R57', 2006, 2014),
  ('MINI', 'Cooper', 'F56', 'F55/F56/F57', 2013, 2024),
  ('MINI', 'Cooper', 'F66', 'F65/F66/J01', 2024, null),
  ('Mitsubishi', 'Lancer Evolution', 'Evo I–III', 'CD9A/CE9A', 1992, 1995),
  ('Mitsubishi', 'Lancer Evolution', 'Evo IV–VI', 'CN9A/CP9A', 1996, 2001),
  ('Mitsubishi', 'Lancer Evolution', 'Evo VII–IX', 'CT9A', 2001, 2007),
  ('Mitsubishi', 'Lancer Evolution', 'Evo X', 'CZ4A', 2007, 2016),
  ('Nissan', '240SX', 'S13', 'S13', 1989, 1994),
  ('Nissan', '240SX', 'S14', 'S14', 1995, 1998),
  ('Nissan', 'Silvia', 'S12', 'S12', 1983, 1988),
  ('Nissan', 'Silvia', 'S13', 'S13', 1988, 1994),
  ('Nissan', 'Silvia', 'S14', 'S14', 1993, 1999),
  ('Nissan', 'Silvia', 'S15', 'S15', 1999, 2002),
  ('Nissan', 'Skyline', 'R31', 'R31', 1985, 1990),
  ('Nissan', 'Skyline', 'R32', 'R32', 1989, 1994),
  ('Nissan', 'Skyline', 'R33', 'R33', 1993, 1998),
  ('Nissan', 'Skyline', 'R34', 'R34', 1998, 2002),
  ('Nissan', 'Skyline', 'V35', 'V35', 2001, 2007),
  ('Nissan', 'Skyline', 'V36', 'V36', 2006, 2014),
  ('Nissan', 'Skyline', 'V37', 'V37', 2014, null),
  ('Nissan', 'GT-R', 'R35', 'R35', 2007, null),
  ('Porsche', '911', 'G-series', '911/930', 1973, 1989),
  ('Porsche', '911', '964', '964', 1989, 1994),
  ('Porsche', '911', '993', '993', 1993, 1998),
  ('Porsche', '911', '996', '996', 1997, 2005),
  ('Porsche', '911', '997', '997', 2004, 2012),
  ('Porsche', '911', '991', '991', 2011, 2019),
  ('Porsche', '911', '992', '992', 2019, null),
  ('Porsche', 'Boxster', '986', '986', 1996, 2004),
  ('Porsche', 'Boxster', '987', '987', 2004, 2012),
  ('Porsche', 'Boxster', '981', '981', 2012, 2016),
  ('Porsche', 'Boxster', '718', '982', 2016, null),
  ('Porsche', 'Cayman', '987', '987', 2005, 2012),
  ('Porsche', 'Cayman', '981', '981', 2013, 2016),
  ('Porsche', 'Cayman', '718', '982', 2016, null),
  ('Renault', 'Clio', 'Clio I', 'X57', 1990, 1998),
  ('Renault', 'Clio', 'Clio II', 'X65', 1998, 2005),
  ('Renault', 'Clio', 'Clio III', 'X85', 2005, 2014),
  ('Renault', 'Clio', 'Clio IV', 'X98', 2012, 2019),
  ('Renault', 'Clio', 'Clio V', 'BF', 2019, null),
  ('Subaru', 'Impreza', 'GC', 'GC/GF', 1992, 2001),
  ('Subaru', 'Impreza', 'GD', 'GD/GG', 2000, 2007),
  ('Subaru', 'Impreza', 'GE/GR', 'GE/GH/GR/GV', 2007, 2014),
  ('Subaru', 'Impreza', 'GJ', 'GJ/GP', 2011, 2016),
  ('Subaru', 'Impreza', 'GK', 'GK/GT', 2016, 2023),
  ('Subaru', 'Impreza', 'GU', 'GU', 2023, null),
  ('Toyota', 'Supra', 'A70', 'A70', 1986, 1993),
  ('Toyota', 'Supra', 'A80', 'A80', 1993, 2002),
  ('Toyota', 'Supra', 'A90', 'A90/J29', 2019, null),
  ('Toyota', '86', 'ZN6', 'ZN6', 2012, 2021),
  ('Toyota', 'GR86', 'ZN8', 'ZN8', 2021, null)
) as s(make, model, name, platform_code, year_start, year_end)
join public.catalog_makes mk on lower(mk.name) = lower(s.make)
join public.catalog_models cm on cm.make_id = mk.id and lower(cm.name) = lower(s.model)
on conflict (model_id, lower(name)) do nothing;

-- ---------- backfill ----------
-- Touching generation_id runs the trigger, which resolves. Only cars whose
-- answer changes are written.
update public.cars c
   set generation_id = c.generation_id
 where c.catalog_model_id is not null
   and c.generation_id is distinct from public.resolve_vehicle_generation(c.catalog_model_id, c.year)
   and c.generation_source is distinct from 'owner';

-- ============================================================
-- Self-checks
-- ============================================================
do $$
declare
  v_generations int;
  v_cars int;
  v_resolved int;
begin
  if to_regclass('public.vehicle_generations') is null then
    raise exception '20261020100000: vehicle_generations missing';
  end if;
  select count(*) into v_generations from public.vehicle_generations;
  select count(*) filter (where catalog_model_id is not null), count(*) filter (where generation_id is not null)
    into v_cars, v_resolved from public.cars;
  raise notice '20261020100000: % generations; % of % catalogued cars resolved', v_generations, v_resolved, v_cars;
  raise notice 'PASS: 20261020100000 self-checks';
end $$;

commit;
