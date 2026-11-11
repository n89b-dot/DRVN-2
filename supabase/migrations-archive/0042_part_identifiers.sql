-- 0042 — part identifiers: alternates per listing + an internal interchange
-- graph (brief §H).
--
-- One physical part answers to many numbers: OEM, manufacturer, superseded,
-- aftermarket equivalent, enthusiast shorthand. Today a listing has exactly
-- one part_number (plus its separator-free compact form, 0033), so a buyer
-- searching the number they know misses a listing entered under another.
--
-- Two tables, both discovery-only — nothing commercial keys on them:
--
--   listing_part_numbers — extra identifiers a seller supplies for one
--   listing ("also known as"). RLS mirrors listing_fitments: visible where
--   the listing is, managed by the seller.
--
--   part_number_links — the global relationship graph (supersedes,
--   interchange, equivalent…), keyed on compact forms. INTERNAL: written by
--   imports/admin tooling (service-role only), read by the search identifier
--   lane to expand a queried number into its known relatives. Source/kind
--   live here for data integrity; no user ever manages or sees this graph.
--
-- Idempotent: IF NOT EXISTS throughout. Safe to re-run.

begin;

create table if not exists public.listing_part_numbers (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings (id) on delete cascade,
  number text not null check (char_length(number) between 2 and 64),
  number_compact text generated always as (
    lower(regexp_replace(number, '[^a-zA-Z0-9]', '', 'g'))
  ) stored,
  created_at timestamptz not null default now()
);
create unique index if not exists listing_part_numbers_key
  on public.listing_part_numbers (listing_id, number_compact);
create index if not exists listing_part_numbers_compact_idx
  on public.listing_part_numbers (number_compact);

alter table public.listing_part_numbers enable row level security;
drop policy if exists "listing part numbers follow listing" on public.listing_part_numbers;
create policy "listing part numbers follow listing" on public.listing_part_numbers
  for select using (
    exists (
      select 1 from public.listings l
      where l.id = listing_id
        and (l.status in ('active', 'sold') or l.seller_id = auth.uid())
    )
  );
drop policy if exists "sellers manage listing part numbers" on public.listing_part_numbers;
create policy "sellers manage listing part numbers" on public.listing_part_numbers
  for all using (
    exists (select 1 from public.listings l where l.id = listing_id and l.seller_id = auth.uid())
  ) with check (
    exists (select 1 from public.listings l where l.id = listing_id and l.seller_id = auth.uid())
  );

create table if not exists public.part_number_links (
  id uuid primary key default gen_random_uuid(),
  from_compact text not null check (char_length(from_compact) between 2 and 64),
  to_compact text not null check (char_length(to_compact) between 2 and 64),
  kind text not null check (kind in (
    'alternate', 'supersedes', 'superseded_by', 'aftermarket_equivalent', 'interchange', 'same_product'
  )),
  -- Internal provenance only — never surfaced to users.
  source text not null default 'manual',
  created_at timestamptz not null default now(),
  check (from_compact <> to_compact)
);
create unique index if not exists part_number_links_key
  on public.part_number_links (from_compact, to_compact, kind);
create index if not exists part_number_links_from_idx on public.part_number_links (from_compact);
create index if not exists part_number_links_to_idx on public.part_number_links (to_compact);

-- Internal graph: no client access at all.
alter table public.part_number_links enable row level security;
revoke all on public.part_number_links from anon, authenticated;

-- ============================================================
-- Self-checks
-- ============================================================
do $$
begin
  if to_regclass('public.listing_part_numbers') is null
     or to_regclass('public.part_number_links') is null then
    raise exception '0042: part identifier tables missing';
  end if;
  raise notice 'PASS: 0042 self-checks';
end $$;

commit;
