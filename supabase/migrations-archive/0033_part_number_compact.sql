-- 0033 — part-number search, separator-insensitive.
--
-- Buyers type part numbers with or without separators ("11-42-7-566-327" vs
-- "11427566327"). 0010 made part_number searchable-as-typed; the app also
-- strips separators from the *query*, but the stored value kept its dashes,
-- so the compact form could never match. A stored generated column
-- normalises the listing side once, at write time, and gets its own index.
--
-- Idempotent: guarded with IF NOT EXISTS throughout. Safe to re-run.

begin;

alter table public.listings
  add column if not exists part_number_compact text
    generated always as (
      nullif(regexp_replace(lower(coalesce(part_number, '')), '[^a-z0-9]', '', 'g'), '')
    ) stored;

create index if not exists listings_part_number_compact_idx
  on public.listings (part_number_compact)
  where part_number_compact is not null;

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'listings'
      and column_name = 'part_number_compact'
  ) then
    raise exception '0033: part_number_compact column missing';
  end if;
  raise notice 'PASS: 0033 self-checks';
end $$;

commit;
