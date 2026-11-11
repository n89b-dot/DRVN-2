-- B1 — product fitment evidence, from day one (plan 2026-10 agent and graph,
-- "B1 — Graph foundation"; Corrections §3; second review: "fitment evidence
-- stays conservative").
--
-- listing_fitments stays what it is: one seller's claim about one listing,
-- projected by listing_vehicle_fit. This table is for claims about a PRODUCT
-- — what the manufacturer says, what an admin checked, what DRVN inferred,
-- what the community reported — and it records how much each claim is worth
-- rather than flattening them into "fits":
--
--   source        manufacturer | admin | community | drvn_inference
--   relationship  fits | fits_with_modification | does_not_fit
--   stated_on     when the source said it (not when we stored it)
--   verification  unverified | verified | disputed | retracted
--   constraints   engine_codes, gearbox_codes, brake_packages: the
--                 configurations the claim holds for. Null = no constraint
--                 stated; an empty array is refused, it would mean "none".
--
-- A claim names a catalog model and, optionally, one of its generations and
-- a year range inside it. The (generation, model) pair is a composite
-- foreign key, so a claim can never name a generation of another model.
-- There is no variant catalog: engine, gearbox and brakes are plain codes
-- the source used ("EA888 gen3", "DQ381", "PCCB"), enough to say "fits only
-- the 6-speed manual" without a trim table.
--
-- "Installed on 17 Mk8s" is not a claim and does not live here: it is a
-- count over build lines (B2), recorded by members, not verified.
--
-- B1 creates the table; B2 fills it. Public read of every claim not
-- retracted (fitment evidence is product data, not member data); written
-- only by the service role (imports, admin tooling).
--
-- Idempotent.

begin;

create table if not exists public.product_fitments (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete cascade,
  catalog_model_id bigint not null references public.catalog_models (id) on delete cascade,
  generation_id bigint,
  year_start int check (year_start is null or year_start between 1885 and 2100),
  year_end int check (year_end is null or year_end between 1885 and 2100),
  relationship text not null check (relationship in ('fits', 'fits_with_modification', 'does_not_fit')),
  source text not null check (source in ('manufacturer', 'admin', 'community', 'drvn_inference')),
  source_ref text check (source_ref is null or char_length(source_ref) <= 500),
  stated_on date not null default current_date,
  verification text not null default 'unverified'
    check (verification in ('unverified', 'verified', 'disputed', 'retracted')),
  verified_by uuid references public.profiles (id) on delete set null,
  verified_at timestamptz,
  engine_codes text[] check (engine_codes is null or cardinality(engine_codes) between 1 and 20),
  gearbox_codes text[] check (gearbox_codes is null or cardinality(gearbox_codes) between 1 and 20),
  brake_packages text[] check (brake_packages is null or cardinality(brake_packages) between 1 and 20),
  notes text check (notes is null or char_length(notes) <= 1000),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (year_start is null or year_end is null or year_end >= year_start),
  -- A modification claim says what the modification is.
  check (relationship <> 'fits_with_modification' or notes is not null),
  -- Verified means someone verified it, and when.
  check (verification <> 'verified' or verified_at is not null),
  foreign key (generation_id, catalog_model_id)
    references public.vehicle_generations (id, model_id) on delete cascade
);

create index if not exists product_fitments_product_idx on public.product_fitments (product_id);
-- "What fits this car": by model, then generation.
create index if not exists product_fitments_vehicle_idx
  on public.product_fitments (catalog_model_id, generation_id) where verification <> 'retracted';
-- The same source can't say the same thing twice about the same configuration.
create unique index if not exists product_fitments_claim_key
  on public.product_fitments (product_id, catalog_model_id, coalesce(generation_id, 0), coalesce(year_start, 0),
                              coalesce(year_end, 0), relationship, source,
                              coalesce(engine_codes, '{}'), coalesce(gearbox_codes, '{}'), coalesce(brake_packages, '{}'));

comment on table public.product_fitments is
  'Claims about which vehicles a product fits, with source, relationship, date, verification and configuration constraints. Not seller claims (listing_fitments) and not install counts (build lines).';

alter table public.product_fitments enable row level security;
revoke all on table public.product_fitments from public, anon, authenticated;
grant select on table public.product_fitments to anon, authenticated;
grant all on table public.product_fitments to service_role;
drop policy if exists "product fitment claims are public" on public.product_fitments;
create policy "product fitment claims are public" on public.product_fitments
  for select to anon, authenticated using (verification <> 'retracted');

do $$
begin
  if to_regclass('public.product_fitments') is null then
    raise exception '20261020130000: product_fitments missing';
  end if;
  raise notice 'PASS: 20261020130000 self-checks';
end $$;

commit;
