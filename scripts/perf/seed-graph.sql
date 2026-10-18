-- The car-and-parts graph at volume (B1): sales, build lines with part
-- numbers, alternates and links, on top of seed-volume.sql. DISPOSABLE
-- DATABASES ONLY.
--
--   psql -f scripts/perf/seed-volume.sql -v parts=2000000
--   psql -f scripts/perf/seed-graph.sql
--
-- Runs against the schema before B1 (it only writes tables that already
-- exist), so the B1 migrations can then be timed backfilling it.
--
--   orders       one per sold part (30% of parts): 80% completed, 10%
--                delivered, 5% shipped, 5% refunded in full; 3% of the
--                completed ones refunded a fifth. Ids are the ones
--                seed-volume.sql's reviews already point at.
--   snapshots    the part's own brand and number, except: one sale in four
--                is a Brembo "HOT-k" (4,000 numbers, ~40 sales each) and one
--                in 97 the single Brembo "MEGA-1" — the comparables a
--                popular part gets, and the worst case.
--   for sale     one active part in 50 becomes a Brembo HOT-k too.
--   build lines  half the sold parts that came off a car leave a "removed"
--                line with the part's brand and number on it; 20,000 cars
--                have an installed HOT-k.
--   alternates   one active part in 60 says it's also known as the next
--                part's number.
--   links        20,000 brand-scoped same_product (to an "OEM" number),
--                20,000 interchange, 2,000 same_product without brands.
-- Triggers are skipped (replica role): the snapshot trigger would rebuild
-- every snapshot from the listing.
\set ON_ERROR_STOP 1
\timing on
begin;
set local session_replication_role = replica;
set local maintenance_work_mem = '512MB';

create temp table seed_sold as
select l.id, l.seller_id, l.source_car_id, l.title, l.price_cents, l.brand, l.part_number, l.condition,
       coalesce(l.sold_at, l.created_at + interval '9 days') as sold_at,
       substring(l.title from '#([0-9]+)$')::bigint as n
from public.listings l where l.status = 'sold';
delete from seed_sold where n is null;
alter table seed_sold add primary key (n);
analyze seed_sold;
select count(*) as members from public.profiles \gset

insert into public.orders (id, buyer_id, seller_id, status, subtotal_cents, shipping_cents, platform_fee_cents, total_cents,
                           currency, refunded_cents, created_at, completed_at, delivered_at)
select md5('o:' || s.n)::uuid, md5('p:' || (1 + (s.n * 7919) % :members))::uuid, s.seller_id,
       case when s.n % 20 < 16 then 'completed' when s.n % 20 < 18 then 'delivered' when s.n % 20 = 18 then 'shipped' else 'refunded' end,
       s.price_cents, 1500, s.price_cents / 10, s.price_cents + 1500, 'USD',
       case when s.n % 20 = 19 then s.price_cents + 1500 when s.n % 20 < 16 and s.n % 33 = 0 then s.price_cents / 5 else 0 end,
       s.sold_at - interval '2 days',
       case when s.n % 20 < 16 then s.sold_at + interval '7 days' end,
       case when s.n % 20 < 18 then s.sold_at + interval '5 days' end
from seed_sold s;

insert into public.order_items (id, order_id, listing_id, title, price_cents, shipping_cents, quantity, commercial_snapshot, snapshot_version)
select md5('oi:' || s.n)::uuid, md5('o:' || s.n)::uuid, s.id, s.title, s.price_cents, 1500, 1,
       jsonb_build_object(
         'version', 1, 'captured_at', s.sold_at,
         'listing', jsonb_build_object('id', s.id, 'title', s.title),
         'part', jsonb_build_object(
           'part_number', case when s.n % 97 = 0 then 'MEGA-1' when s.n % 4 = 1 then 'HOT-' || (s.n % 4000) else s.part_number end,
           'brand', case when s.n % 97 = 0 or s.n % 4 = 1 then 'Brembo' else s.brand end),
         'condition', jsonb_build_object('condition', s.condition),
         'commercial', jsonb_build_object('price_cents', s.price_cents, 'currency', 'USD', 'shipping_cents', 1500)),
       1
from seed_sold s;

update public.listings l
   set part_number = 'HOT-' || (x.n % 4000), brand = 'Brembo'
  from (select id, substring(title from '#([0-9]+)$')::bigint as n from public.listings where status = 'active') x
 where l.id = x.id and x.n % 50 = 3;

insert into public.mod_items (car_id, group_label, category, brand, product, part_number, position, status, removed_at)
select s.source_car_id, 'Other', 'performance', s.brand, left(s.title, 200), s.part_number, 99, 'removed', s.sold_at
from seed_sold s where s.source_car_id is not null and s.n % 2 = 0;
insert into public.mod_items (car_id, group_label, category, brand, product, part_number, position, status)
select md5('c:' || (1 + (k * 104729) % (select count(*) from public.cars)))::uuid, 'Brakes', 'brakes', 'Brembo',
       'Brembo kit', 'HOT-' || (k % 4000), 98, 'installed'
from generate_series(1, 20000) k;

insert into public.listing_part_numbers (listing_id, number)
select l.id, 'PN-' || (x.n + 1)
from public.listings l
join (select id, substring(title from '#([0-9]+)$')::bigint as n from public.listings where status = 'active') x on x.id = l.id
where x.n % 60 = 7
on conflict do nothing;

insert into public.part_number_links (from_compact, to_compact, kind, source, from_brand_key, to_brand_key)
select 'pn' || k * 97, 'oem' || k * 97, 'same_product', 'perf-seed',
       nullif(regexp_replace(lower(coalesce(l.brand, '')), '[^[:alnum:]]', '', 'g'), ''),
       nullif(regexp_replace(lower(coalesce(l.brand, '')), '[^[:alnum:]]', '', 'g'), '')
from generate_series(1, 20000) k
join public.listings l on l.id = md5('l:' || k * 97)::uuid
where l.brand is not null
on conflict do nothing;
insert into public.part_number_links (from_compact, to_compact, kind, source)
select 'pn' || k * 89, 'pn' || (k * 89 + 1), 'interchange', 'perf-seed' from generate_series(1, 20000) k
on conflict do nothing;
insert into public.part_number_links (from_compact, to_compact, kind, source)
select 'pn' || k * 83, 'pn' || (k * 83 + 2), 'same_product', 'perf-seed' from generate_series(1, 2000) k
on conflict do nothing;
commit;

vacuum analyze public.orders, public.order_items, public.mod_items, public.listings, public.listing_part_numbers, public.part_number_links;
select 'orders' t, count(*) from public.orders union all
select 'completed', count(*) from public.orders where status = 'completed' union all
select 'order items', count(*) from public.order_items union all
select 'build lines with a number', count(*) from public.mod_items where part_number is not null union all
select 'alternates', count(*) from public.listing_part_numbers union all
select 'links', count(*) from public.part_number_links;
