-- Part number on listings (Werkbank B4).
--
-- `mod_items.part_number` already existed for build components, but a listing
-- had nowhere to record the manufacturer number a buyer actually
-- cross-references before buying ("CP9660-2S4"). Without it the marketplace
-- can only be searched by prose title.
--
-- Nullable by design: plenty of parts have no meaningful number, and a required
-- field would push sellers into inventing one.
alter table public.listings add column if not exists part_number text;

comment on column public.listings.part_number is
  'Manufacturer part number, seller-entered. Not verified by the platform.';

-- Searching by part number is the point of storing it.
create index if not exists listings_part_number_idx
  on public.listings (part_number)
  where part_number is not null;
