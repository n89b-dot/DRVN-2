-- 0041 — the DRVN-owned vehicle catalog (brief §E/§F).
--
-- Cars have always stored owner-typed strings for make/model/year. The vPIC
-- cache (0025: vehicle_makes / vehicle_models) gave the sell-form datalists a
-- taxonomy, but its primary key IS vPIC's Make_ID — an external vendor's id
-- space — and it only knows what NHTSA knows.
--
-- This migration creates catalog tables DRVN owns:
--
--   catalog_makes / catalog_models — DRVN identity ids, with *references* to
--   the sources that populated them (vpic_make_id; VehiclesDB ids via the
--   import script scripts/import-vehiclesdb.mjs, CC-BY 4.0, attribution in
--   docs). New sources add columns/rows; nothing external is a primary key.
--
--   cars.catalog_make_id / catalog_model_id / identity_source — nullable
--   references written by the new Add Car flow. The display strings
--   (cars.make/model/year) REMAIN and keep rendering everywhere: they are the
--   snapshot, so an upstream catalog rename can never rewrite history.
--
-- vehicle_makes / vehicle_models are untouched — they stay the vPIC fetch
-- cache feeding the fitment datalists.
--
-- Idempotent: IF NOT EXISTS throughout; the vPIC seed upserts on conflict.

begin;

create table if not exists public.catalog_makes (
  id bigint generated always as identity primary key,
  name text not null,
  slug text generated always as (lower(regexp_replace(name, '[^a-zA-Z0-9]+', '-', 'g'))) stored,
  vpic_make_id int,
  vdb_id text,
  -- 1 (most common) … 10, from VehiclesDB's global_popularity_decile; null =
  -- unknown, ranked after known ones.
  popularity_decile int check (popularity_decile between 1 and 10),
  source text not null default 'vpic',
  source_version text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists catalog_makes_name_key on public.catalog_makes (lower(name));
create unique index if not exists catalog_makes_vpic_key on public.catalog_makes (vpic_make_id) where vpic_make_id is not null;
create unique index if not exists catalog_makes_vdb_key on public.catalog_makes (vdb_id) where vdb_id is not null;

create table if not exists public.catalog_models (
  id bigint generated always as identity primary key,
  make_id bigint not null references public.catalog_makes (id) on delete cascade,
  name text not null,
  vdb_id text,
  popularity_decile int check (popularity_decile between 1 and 10),
  source text not null default 'vpic',
  source_version text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- Market alternate names ("Golf" ↔ "Rabbit") — searched by the picker, never
-- displayed as the canonical name.
alter table public.catalog_models add column if not exists aliases text[];

create unique index if not exists catalog_models_make_name_key on public.catalog_models (make_id, lower(name));
create unique index if not exists catalog_models_vdb_key on public.catalog_models (vdb_id) where vdb_id is not null;
create index if not exists catalog_models_make_idx on public.catalog_models (make_id);

-- Public read (the picker is a public-shaped API), writes service-role only —
-- same posture as the vPIC cache tables.
alter table public.catalog_makes enable row level security;
alter table public.catalog_models enable row level security;
drop policy if exists "catalog makes are public" on public.catalog_makes;
create policy "catalog makes are public" on public.catalog_makes for select using (true);
drop policy if exists "catalog models are public" on public.catalog_models;
create policy "catalog models are public" on public.catalog_models for select using (true);

-- ---------- cars: canonical references + snapshot preserved ----------
alter table public.cars
  add column if not exists catalog_make_id bigint references public.catalog_makes (id) on delete set null,
  add column if not exists catalog_model_id bigint references public.catalog_models (id) on delete set null,
  add column if not exists identity_source text
    check (identity_source is null or identity_source in ('picker', 'vin', 'manual'));

comment on column public.cars.identity_source is
  'How the vehicle identity was established: picker (catalog selection), vin (decoded), manual (typed). Null on pre-0041 cars.';

-- ---------- seed from the existing vPIC cache ----------
insert into public.catalog_makes (name, vpic_make_id, source)
select vm.name, vm.id, 'vpic'
from public.vehicle_makes vm
on conflict (lower(name)) do update
  set vpic_make_id = coalesce(public.catalog_makes.vpic_make_id, excluded.vpic_make_id);

insert into public.catalog_models (make_id, name, source)
select cm.id, vmo.name, 'vpic'
from public.vehicle_models vmo
join public.vehicle_makes vm on vm.id = vmo.make_id
join public.catalog_makes cm on cm.vpic_make_id = vm.id
on conflict (make_id, lower(name)) do nothing;

-- ============================================================
-- Self-checks
-- ============================================================
do $$
declare
  v_makes int;
begin
  if to_regclass('public.catalog_makes') is null or to_regclass('public.catalog_models') is null then
    raise exception '0041: catalog tables missing';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'cars' and column_name = 'catalog_make_id'
  ) then
    raise exception '0041: cars.catalog_make_id missing';
  end if;
  select count(*) into v_makes from public.catalog_makes;
  raise notice '0041: catalog holds % makes after vPIC seed', v_makes;
  raise notice 'PASS: 0041 self-checks';
end $$;

commit;
