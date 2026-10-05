-- Volume seed for query-plan checks. DISPOSABLE DATABASES ONLY —
-- scripts/perf/fresh-db.sh refuses anything but the throwaway port.
--
--   psql -v parts=2000000 -f scripts/perf/seed-volume.sql
--
-- Everything scales from :parts (default 60,000, about 100x the invited beta):
--   members  parts x 0.075   150,000 at 2M; 1% suspended
--   cars     parts / 5       400,000 at 2M; 90% public
--   updates  parts x 2       4,000,000 at 2M; 95% published
--   parts    60% for sale, 30% sold, 5% paused, 5% draft; 85% off a car
--
-- Skewed the way a real catalogue is, because the skew is what breaks plans:
--   makes    the top make holds ~29% of cars, the top ten ~63% (of 40)
--   models   the top model holds ~32% of its make (of 10)
--   brands   the top brand holds ~22% of parts, the top eight ~38% (of 400)
--   sellers  a few members own many cars and so sell many parts
--   words    each title and description carries words drawn from a Zipf
--            curve over ~27,000 made-up words: most words are rare, a few
--            are in one title in fifteen. "for", the top brands, the product
--            words and the stock description phrases are everywhere.
--
-- Deterministic: every id and every choice is a hash of the row number, so
-- two runs at the same scale produce the same database and plan the same way.
-- Triggers and foreign keys are skipped (replica role) and the bulk tables'
-- plain indexes are dropped during the load and rebuilt after it: this fills
-- tables for the planner, it does not exercise the write rules.
\set ON_ERROR_STOP 1
\if :{?parts}
\else
  \set parts 60000
\endif
\timing on
-- One transaction: a failure part-way leaves the database as it was,
-- indexes included.
begin;
set local session_replication_role = replica;
set local maintenance_work_mem = '512MB';

select :parts::bigint as parts,
       greatest(200, round(:parts * 0.075))::bigint as members,
       greatest(100, :parts / 5)::bigint as cars,
       (:parts * 2)::bigint as posts \gset
\echo seeding :parts parts, :members members, :cars cars, :posts updates

-- A uniform number in [0, 1) from a row number and a salt.
create function pg_temp.u(salt int, n bigint) returns float8 language sql immutable parallel safe
as $$ select (hashint8(n * 1000003 + salt) & 2147483647)::float8 / 2147483648 $$;
-- A Zipf-distributed word rank in [1, 27000): rank k has probability ~1/k.
create function pg_temp.zipf(salt int, n bigint) returns int language sql immutable parallel safe
as $$ select least(26999, floor(exp(pg_temp.u(salt, n) * ln(27000)))::int) $$;
-- A made-up word per rank: three syllables, so words share trigrams the way
-- real ones do. A single expression, so the planner inlines it: called as a
-- function instead, Postgres 17 keeps each call's memory until the statement
-- ends, and at 2M parts that ran the database out of memory.
create function pg_temp.syl(i int) returns text language sql immutable parallel safe
as $$ select (string_to_array('ka,ri,to,ven,mo,sa,lu,dra,pe,xo,ni,bel,ta,ru,qui,zo,mar,fe,li,gor,na,vi,sel,du,rak,po,ten,shi,wo,ly', ','))[1 + i % 30] $$;
create function pg_temp.word(k int) returns text language sql immutable parallel safe
as $$ select pg_temp.syl(k) || pg_temp.syl(k / 30) || pg_temp.syl(k / 900) || case when k >= 27000 then pg_temp.syl(k / 27000) else '' end $$;
create function pg_temp.id(kind text, n bigint) returns uuid language sql immutable parallel safe
as $$ select md5(kind || ':' || n::text)::uuid $$;
-- Every helper above is a single immutable expression the planner inlines.
-- Two things stop that, and a helper that isn't inlined is a function call
-- per row whose memory Postgres 17 keeps until the statement ends (at 2M
-- parts, gigabytes): a body that is only "stable" (text || bigint is; hence
-- n::text above), and an expensive argument used more than once in the body
-- (word uses its rank four times; hence the ranks are computed into the
-- staging tables below and passed as plain columns).

-- ── Drop the bulk tables' plain indexes; rebuilt at the end ──────────────
create temp table seed_indexes as
select i.indexrelid::regclass::text as name, pg_get_indexdef(i.indexrelid) as def
from pg_index i
where i.indrelid::regclass::text in ('profiles','cars','car_images','listings','listing_images','listing_fitments',
        'listing_questions','mod_items','activity_posts','activity_images','likes','saves','follows','reviews')
  and not i.indisunique and not i.indisprimary
  and not exists (select 1 from pg_constraint c where c.conindid = i.indexrelid);
select 'drop index ' || name from seed_indexes \gexec

-- ── Catalogue ────────────────────────────────────────────────────────────
insert into public.catalog_makes (id, name, popularity_decile) overriding system value
select 900000 + m, 'Make' || m, 1 + m % 10 from generate_series(1, 40) m
on conflict do nothing;
insert into public.catalog_models (id, make_id, name, popularity_decile) overriding system value
select 900000 + m * 100 + o, 900000 + m, 'Model' || o, 1 + o % 10
from generate_series(1, 40) m, generate_series(1, 10) o
on conflict do nothing;

-- ── Members ──────────────────────────────────────────────────────────────
insert into public.profiles (id, username, display_name, avatar_url, location, profile_type, created_at, suspended_at, suspended_reason)
select pg_temp.id('p', n), 'perf_user_' || n, 'Perf User ' || n, 'https://example.test/a/' || n || '.jpg',
       (array['Austin, TX','Leeds, UK','Portland, OR','Miami, FL','Denver, CO','Berlin, DE'])[1 + n % 6],
       case when n % 40 = 0 then 'shop' else 'user' end,
       now() - pg_temp.u(1, n) * 700 * interval '1 day',
       case when n % 100 = 7 then now() - interval '3 days' end,
       case when n % 100 = 7 then 'perf seed' end
from generate_series(1, :members) n;

-- ── Cars ─────────────────────────────────────────────────────────────────
create temp table seed_cars as
select n,
       1 + floor(:members * pg_temp.u(2, n) ^ 1.5)::bigint as owner_n,
       1 + floor(40 * pg_temp.u(3, n) ^ 3)::int as make_n,
       1 + floor(10 * pg_temp.u(4, n) ^ 2)::int as model_n,
       2024 - floor(40 * pg_temp.u(5, n) ^ 2)::int as yr,
       pg_temp.u(6, n) >= 0.1 as is_public,
       pg_temp.zipf(7, n) as w_name, pg_temp.zipf(8, n) as w_about
from generate_series(1, :cars) n;
alter table seed_cars add primary key (n);
analyze seed_cars;

insert into public.cars (id, owner_id, slug, name, make, model, year, about, cover_image_url, is_public, created_at,
                         catalog_make_id, catalog_model_id, identity_source)
select pg_temp.id('c', n), pg_temp.id('p', owner_n), 'perf-car-' || n,
       yr || ' Make' || make_n || ' Model' || model_n || ' ' || pg_temp.word(w_name),
       'Make' || make_n, 'Model' || model_n, yr,
       'Street build with coilovers, an exhaust and a tune. ' || pg_temp.word(w_about) || ' track days twice a year.',
       'https://example.test/c/' || n || '.jpg', is_public, now() - pg_temp.u(9, n) * 600 * interval '1 day',
       900000 + make_n, 900000 + make_n * 100 + model_n, 'picker'
from seed_cars;
insert into public.car_images (car_id, url, position)
select pg_temp.id('c', n), 'https://example.test/c/' || n || '-' || p || '.jpg', p from seed_cars, generate_series(0, 3) p;
insert into public.mod_items (car_id, group_label, category, brand, product, raw_text, position, status)
select pg_temp.id('c', c.n), (array['Performance','Suspension','Brakes','Wheels & Tires','Exterior','Interior'])[1 + p % 6], 'performance',
       (array['Brembo','KW','Akrapovic','BBS'])[1 + p % 4], pg_temp.word(z.k),
       'Brand part ' || p, p, 'installed'
from seed_cars c, generate_series(0, 11) p,
     lateral (select pg_temp.zipf(10, c.n * 16 + p) as k offset 0) z;

-- ── Parts ────────────────────────────────────────────────────────────────
create temp table seed_listings as
select n,
       case when pg_temp.u(11, n) < 0.85 then 1 + floor(:cars * pg_temp.u(12, n))::bigint end as car_n,
       1 + floor(:members * pg_temp.u(13, n) ^ 1.5)::bigint as loose_seller_n,
       (array['performance','engine','exterior-body','interior-lighting','brakes-suspension','wheels-tires'])[1 + floor(6 * pg_temp.u(14, n) ^ 1.5)::int] as category,
       case when pg_temp.u(15, n) < 0.6 then 'active' when pg_temp.u(15, n) < 0.9 then 'sold'
            when pg_temp.u(15, n) < 0.95 then 'paused' else 'draft' end as status,
       1 + floor(400 * pg_temp.u(16, n) ^ 4)::int as brand_k,
       now() - pg_temp.u(17, n) * 365 * interval '1 day' as created_at,
       pg_temp.zipf(19, n) as w_title, pg_temp.zipf(20, n) as w_d1, pg_temp.zipf(21, n) as w_d2
from generate_series(1, :parts) n;
alter table seed_listings add primary key (n);
analyze seed_listings;

insert into public.listings (id, seller_id, source_car_id, title, description, category, subcategory, condition, price_cents,
                             location, status, created_at, shipping_cents, allows_collection, shipping_mode, brand, part_number, view_count, sold_at)
select pg_temp.id('l', l.n), pg_temp.id('p', coalesce(c.owner_n, l.loose_seller_n)), pg_temp.id('c', c.n),
       left(b.brand || ' ' ||
       (array['big brake kit','coilovers','titanium exhaust','forged wheels','bucket seat','dampers','turbo kit','intake'])[1 + floor(8 * pg_temp.u(18, l.n))::int] ||
       ' ' || pg_temp.word(l.w_title) ||
       coalesce(' for Make' || c.make_n || ' Model' || c.model_n, '') || ' #' || l.n, 140),
       'Came off my ' || coalesce(c.yr || ' Make' || c.make_n, 'old project') || '. ' || pg_temp.word(l.w_d1) || ' and ' ||
       pg_temp.word(l.w_d2) || '. Good condition, about 12k miles of use. Selling because the build changed direction.',
       l.category,
       case when pg_temp.u(22, l.n) < 0.1 then null else
         (case l.category
           when 'performance' then array['exhaust','intake','turbo','intercoolers','tuning','fueling']
           when 'engine' then array['internals','drivetrain','transmission','engine-mounts','maintenance']
           when 'exterior-body' then array['aero','bumpers','hoods','spoilers','mirrors-trim']
           when 'interior-lighting' then array['seats','steering','gauges','headlights','interior-trim']
           when 'brakes-suspension' then array['big-brake-kits','pads-rotors','coilovers','sway-bars','air-ride']
           else array['wheels','tires','spacers-hardware','tpms'] end)[1 + floor(4 * pg_temp.u(23, l.n) ^ 2)::int] end,
       (array['new','like_new','used','used','for_parts'])[1 + l.n % 5],
       1000 + floor(exp(pg_temp.u(24, l.n) * 13))::int,
       (array['Austin, TX','Leeds, UK','Portland, OR','Miami, FL','Denver, CO','Berlin, DE'])[1 + l.n % 6],
       l.status, l.created_at, 1500, l.n % 3 = 0, 'flat', b.brand,
       'PN-' || l.n, (l.n * 7) % 900, case when l.status = 'sold' then l.created_at + interval '9 days' end
from seed_listings l
left join seed_cars c on c.n = l.car_n
cross join lateral (select case l.brand_k when 1 then 'Brembo' when 2 then 'KW' when 3 then 'Akrapovic' when 4 then 'BBS'
                                          when 5 then 'Recaro' when 6 then 'Bilstein' when 7 then 'Garrett' when 8 then 'HKS'
                                          else initcap(pg_temp.word(27000 + l.brand_k * 7)) end as brand) b;
-- source_car_id came out as id('c', null) = null for parts off no car.
insert into public.listing_images (listing_id, url, position)
select pg_temp.id('l', n), 'https://example.test/l/' || n || '-' || p || '.jpg', p from seed_listings, generate_series(0, 2) p;
-- Half the parts state their own car's make and model; one in seven states
-- another vehicle as well, a few of those for every year.
insert into public.listing_fitments (listing_id, make, model, year_start, year_end)
select pg_temp.id('l', l.n), 'Make' || c.make_n, 'Model' || c.model_n, c.yr - 3, c.yr + 3
from seed_listings l join seed_cars c on c.n = l.car_n where pg_temp.u(25, l.n) < 0.5;
insert into public.listing_fitments (listing_id, make, model, year_start, year_end)
select pg_temp.id('l', n), 'Make' || mk, 'Model' || md,
       case when pg_temp.u(29, n) < 0.3 then null else yr - 4 end, case when pg_temp.u(29, n) < 0.3 then null else yr + 4 end
from (select n, 1 + floor(40 * pg_temp.u(26, n) ^ 3)::int mk, 1 + floor(10 * pg_temp.u(27, n) ^ 2)::int md,
             2024 - floor(40 * pg_temp.u(28, n) ^ 2)::int yr
      from seed_listings where pg_temp.u(30, n) < 0.15) x;
insert into public.listing_questions (listing_id, author_id, body)
select pg_temp.id('l', n), pg_temp.id('p', 1 + floor(:members * pg_temp.u(31, n))::bigint), 'Does this fit the facelift?'
from seed_listings where n % 3 = 0;

-- ── Updates ──────────────────────────────────────────────────────────────
create temp table seed_posts as
select n, 1 + floor(:cars * pg_temp.u(32, n) ^ 1.2)::bigint as car_n,
       now() - pg_temp.u(33, n) * 365 * interval '1 day' as posted_at,
       pg_temp.u(34, n) < 0.95 as published,
       pg_temp.zipf(35, n) as w_title, pg_temp.zipf(36, n) as w_intro
from generate_series(1, :posts) n;
alter table seed_posts add primary key (n);
analyze seed_posts;
-- An unpublished update is an archived draft: one live draft per car is the rule.
insert into public.activity_posts (id, car_id, author_id, title, intro, body, published_at, created_at, draft_archived_at)
select pg_temp.id('u', p.n), pg_temp.id('c', p.car_n), pg_temp.id('p', c.owner_n),
       (array['Fitted the coilovers','Dyno day','New wheels on','Exhaust install','Track day at the ring','Brake upgrade done'])[1 + p.n % 6] ||
       ' ' || pg_temp.word(p.w_title) || ' #' || p.n,
       'Spent the weekend in the garage. ' || pg_temp.word(p.w_intro) || '. Here is how it went.', '{"type":"doc","content":[]}'::jsonb,
       case when p.published then p.posted_at end, p.posted_at, case when not p.published then p.posted_at end
from seed_posts p join seed_cars c on c.n = p.car_n;
insert into public.activity_images (post_id, url, position)
select pg_temp.id('u', n), 'https://example.test/u/' || n || '-' || i || '.jpg', i from seed_posts, generate_series(0, 1) i;

-- ── Social graph and reviews ─────────────────────────────────────────────
insert into public.likes (user_id, target_type, target_id)
select pg_temp.id('p', 1 + floor(:members * pg_temp.u(40 + g, l.n))::bigint), 'listing', pg_temp.id('l', l.n)
from seed_listings l, generate_series(1, 3) g where l.n % 2 = 0
on conflict do nothing;
insert into public.likes (user_id, target_type, target_id)
select pg_temp.id('p', 1 + floor(:members * pg_temp.u(50 + g, c.n))::bigint), 'car', pg_temp.id('c', c.n)
from seed_cars c, generate_series(1, 5) g
on conflict do nothing;
insert into public.saves (user_id, target_type, target_id)
select pg_temp.id('p', 1 + floor(:members * pg_temp.u(60 + g, l.n))::bigint), 'listing', pg_temp.id('l', l.n)
from seed_listings l, generate_series(1, 2) g where l.n % 2 = 1
on conflict do nothing;
insert into public.follows (follower_id, target_type, target_id)
select pg_temp.id('p', 1 + floor(:members * pg_temp.u(70 + g, c.n))::bigint), 'car', pg_temp.id('c', c.n)
from seed_cars c, generate_series(1, 3) g
on conflict do nothing;
insert into public.follows (follower_id, target_type, target_id)
select pg_temp.id('p', n), 'profile', pg_temp.id('p', 1 + floor(:members * pg_temp.u(80 + g, n) ^ 2)::bigint)
from generate_series(1, :members) n, generate_series(1, 3) g
where 1 + floor(:members * pg_temp.u(80 + g, n) ^ 2)::bigint <> n
on conflict do nothing;
-- Reviews follow sales, so the biggest sellers carry the most.
insert into public.reviews (order_id, reviewer_id, reviewee_id, rating, body)
select pg_temp.id('o', l.n), pg_temp.id('p', 1 + floor(:members * pg_temp.u(90, l.n))::bigint),
       pg_temp.id('p', coalesce(c.owner_n, l.loose_seller_n)), 3 + l.n % 3, 'As described.'
from seed_listings l left join seed_cars c on c.n = l.car_n where l.status = 'sold';

-- ── Rebuild the indexes dropped above ────────────────────────────────────
select def from seed_indexes \gexec
commit;

-- Tables the triggers keep, which the replica-role load skipped.
select to_regprocedure('public.refresh_listing_vehicle_fit(uuid[],boolean)') is not null as has_fit \gset
\if :has_fit
  select public.refresh_listing_vehicle_fit(array(select id from public.listings where status = 'active'), false);
\endif
-- And the totals and rankings the pg_cron jobs keep (20261011120000).
select to_regprocedure('public.refresh_explore_rankings()') is not null as has_rankings \gset
\if :has_rankings
  select public.refresh_marketplace_facet_counts();
  select public.refresh_explore_rankings();
\endif

vacuum analyze;
select 'members' t, count(*) from public.profiles union all
select 'suspended', count(*) from public.profiles where suspended_at is not null union all
select 'cars', count(*) from public.cars union all
select 'parts', count(*) from public.listings union all
select 'for sale', count(*) from public.listings where status = 'active' union all
select 'fitments', count(*) from public.listing_fitments union all
select 'updates', count(*) from public.activity_posts union all
select 'likes', count(*) from public.likes;
select pg_size_pretty(pg_database_size(current_database())) as database_size;
