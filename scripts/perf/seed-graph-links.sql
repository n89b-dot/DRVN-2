-- Brand-scoped same_product links at volume (B1): 20,000 part numbers each
-- linked to an "OEM" number of the same brand. Needs part_number_links'
-- brand scope (20261020120000), so it runs after the B1 migrations; see
-- seed-graph.sql. DISPOSABLE DATABASES ONLY.
\set ON_ERROR_STOP 1
insert into public.part_number_links (from_compact, to_compact, kind, source, from_brand_key, to_brand_key)
select 'pn' || k * 97, 'oem' || k * 97, 'same_product', 'perf-seed',
       nullif(regexp_replace(lower(coalesce(l.brand, '')), '[^[:alnum:]]', '', 'g'), ''),
       nullif(regexp_replace(lower(coalesce(l.brand, '')), '[^[:alnum:]]', '', 'g'), '')
from generate_series(1, 20000) k
join public.listings l on l.id = md5('l:' || k * 97)::uuid
where l.brand is not null
on conflict do nothing;
