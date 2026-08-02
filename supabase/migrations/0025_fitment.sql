-- ============================================================================
-- 0025 — Structured fitment: VIN-decoded cars, vehicle taxonomy, seller-stated
--        fitment rows on listings (PRD §7.1, first real step past the
--        make/model hint)
--
--  * cars gains a VIN and the fields NHTSA vPIC decodes from it. The VIN is
--    the verification input; the decoded columns are the fitment key. Cars
--    without a VIN keep working — make/model/year stay manually editable and
--    the matcher only ever reads the decoded/manual fields, never the VIN.
--  * vehicle_makes / vehicle_models cache the vPIC passenger-car taxonomy so
--    the fitment picker and garage forms offer canonical names without a
--    network hop per keystroke. Populated lazily by server code (service
--    role); public read, no user writes.
--  * listing_fitments — the seller's structured claim: "this fits
--    make/model, years X–Y". Replaces nothing (compatibility_notes stays as
--    the freeform fallback); the badge these rows power is always labeled
--    seller-stated. Managed by the seller through the user-scoped client,
--    so RLS mirrors listing_images.
--
-- Idempotent: safe to re-run.
-- ============================================================================

begin;

-- ============================================================
-- cars — VIN + decoded identity
-- ============================================================
alter table public.cars
  add column if not exists vin text,
  add column if not exists trim text,
  add column if not exists engine text,
  add column if not exists drivetrain text,
  add column if not exists body_class text,
  add column if not exists vin_decoded_at timestamptz;

alter table public.cars
  drop constraint if exists cars_vin_bounds;
alter table public.cars
  add constraint cars_vin_bounds check (vin is null or char_length(vin) between 11 and 17);

-- ============================================================
-- vehicle taxonomy cache (vPIC)
-- ============================================================
-- Ids are vPIC's own Make_ID values, so re-syncs are natural upserts.
create table if not exists public.vehicle_makes (
  id int primary key,
  name text not null unique,
  models_fetched_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.vehicle_models (
  id bigint generated always as identity primary key,
  make_id int not null references public.vehicle_makes (id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  unique (make_id, name)
);

create index if not exists vehicle_models_make_idx on public.vehicle_models (make_id);

alter table public.vehicle_makes enable row level security;
alter table public.vehicle_models enable row level security;

-- Public reference data: anyone reads, only the service role writes.
drop policy if exists "anyone reads vehicle makes" on public.vehicle_makes;
create policy "anyone reads vehicle makes" on public.vehicle_makes for select using (true);
drop policy if exists "anyone reads vehicle models" on public.vehicle_models;
create policy "anyone reads vehicle models" on public.vehicle_models for select using (true);

-- ============================================================
-- listing_fitments — seller-stated structured fitment
-- ============================================================
create table if not exists public.listing_fitments (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings (id) on delete cascade,
  make text not null,
  model text not null,
  year_start int,
  year_end int,
  created_at timestamptz not null default now(),
  constraint listing_fitments_make_bounds check (char_length(make) between 1 and 60),
  constraint listing_fitments_model_bounds check (char_length(model) between 1 and 80),
  constraint listing_fitments_year_start_sane check (
    year_start is null or year_start between 1930 and 2035
  ),
  constraint listing_fitments_year_end_sane check (
    year_end is null or year_end between 1930 and 2035
  ),
  constraint listing_fitments_year_order check (
    year_start is null or year_end is null or year_end >= year_start
  )
);

create index if not exists listing_fitments_listing_idx on public.listing_fitments (listing_id);
-- The matcher's side of the join: case-insensitive make+model.
create index if not exists listing_fitments_vehicle_idx
  on public.listing_fitments (lower(make), lower(model));
-- One row per distinct claim; nulls folded so "all years" can't repeat.
create unique index if not exists listing_fitments_claim_uniq
  on public.listing_fitments (
    listing_id, lower(make), lower(model),
    coalesce(year_start, 0), coalesce(year_end, 9999)
  );

alter table public.listing_fitments enable row level security;

-- Mirrors listing_images (0001): visible wherever the listing is, managed by
-- the listing's seller.
drop policy if exists "fitment follows listing" on public.listing_fitments;
create policy "fitment follows listing" on public.listing_fitments for select
  using (
    exists (
      select 1 from public.listings l
      where l.id = listing_id
        and (l.status in ('active', 'sold') or l.seller_id = auth.uid())
    )
  );

drop policy if exists "sellers manage fitment" on public.listing_fitments;
create policy "sellers manage fitment" on public.listing_fitments for all
  using (
    exists (select 1 from public.listings l where l.id = listing_id and l.seller_id = auth.uid())
  )
  with check (
    exists (select 1 from public.listings l where l.id = listing_id and l.seller_id = auth.uid())
  );

commit;
