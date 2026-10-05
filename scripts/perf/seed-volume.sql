-- Realistic-volume seed for query-plan checks. DISPOSABLE DATABASES ONLY —
-- scripts/perf/query-plans.sh refuses anything but the throwaway port.
--
-- Roughly 100x the invited beta: 5,000 members, 12,000 cars, 60,000 parts,
-- 120,000 updates. Deterministic (setseed) so two runs plan the same way.
-- Triggers and foreign keys are skipped (replica role): this fills tables
-- for the planner, it does not exercise the write rules.
\set ON_ERROR_STOP 1
begin;
set local session_replication_role = replica;
select setseed(0.42);

insert into public.catalog_makes (id, name, popularity_decile) overriding system value
select 900000 + m, 'Make' || m, 1 + m % 10 from generate_series(1, 40) m
on conflict do nothing;
insert into public.catalog_models (id, make_id, name, popularity_decile) overriding system value
select 900000 + m * 100 + o, 900000 + m, 'Model' || o, 1 + o % 10
from generate_series(1, 40) m, generate_series(1, 10) o
on conflict do nothing;

create temp table seed_profiles as
select gen_random_uuid() id, n from generate_series(1, 5000) n;
insert into public.profiles (id, username, display_name, avatar_url, location, profile_type, created_at)
select id, 'perf_user_' || n, 'Perf User ' || n, 'https://example.test/a/' || n || '.jpg',
       (array['Austin, TX','Leeds, UK','Portland, OR','Miami, FL','Denver, CO','Berlin, DE'])[1 + n % 6],
       case when n % 40 = 0 then 'shop' else 'user' end,
       now() - (random() * 400 || ' days')::interval
from seed_profiles;
create index on seed_profiles (n);

create temp table seed_cars as
select gen_random_uuid() id, n, (select id from seed_profiles where seed_profiles.n = 1 + (c.n * 7919) % 5000) owner_id,
       1 + (n * 31) % 40 make_n, 1 + (n * 17) % 10 model_n, 1985 + (n * 13) % 40 yr,
       n % 10 <> 0 is_public, now() - (random() * 400 || ' days')::interval created_at
from generate_series(1, 12000) c(n);
insert into public.cars (id, owner_id, slug, name, make, model, year, about, cover_image_url, is_public, created_at,
                         catalog_make_id, catalog_model_id, identity_source)
select id, owner_id, 'perf-car-' || n, yr || ' Make' || make_n || ' Model' || model_n, 'Make' || make_n, 'Model' || model_n, yr,
       'Street build with coilovers, an exhaust and a tune. Track days twice a year.',
       'https://example.test/c/' || n || '.jpg', is_public, created_at,
       900000 + make_n, 900000 + make_n * 100 + model_n, 'picker'
from seed_cars;
create index on seed_cars (n);
create index on seed_cars (id);
insert into public.car_images (car_id, url, position)
select id, 'https://example.test/c/' || n || '-' || p || '.jpg', p from seed_cars, generate_series(0, 3) p;

create temp table seed_listings as
select gen_random_uuid() id, n,
       (select c.id from seed_cars c where c.n = 1 + (l.n::bigint * 104729) % 12000) car_id,
       (array['performance','engine','exterior-body','interior-lighting','brakes-suspension','wheels-tires'])[1 + n % 6] category,
       case when n % 10 < 6 then 'active' when n % 10 < 9 then 'sold' when n % 20 = 18 then 'paused' else 'draft' end status,
       now() - (random() * 300 || ' days')::interval created_at
from generate_series(1, 60000) l(n);
insert into public.listings (id, seller_id, source_car_id, title, description, category, subcategory, condition, price_cents,
                             location, status, created_at, shipping_cents, allows_collection, shipping_mode, brand, part_number, view_count, sold_at)
select l.id, c.owner_id, l.car_id,
       (array['Brembo','KW','Akrapovic','BBS','Recaro','Bilstein','Garrett','HKS'])[1 + l.n % 8] || ' ' ||
       (array['big brake kit','coilovers','titanium exhaust','forged wheels','bucket seat','dampers','turbo kit','intake'])[1 + (l.n / 8) % 8] ||
       ' for Make' || c.make_n || ' Model' || c.model_n || ' #' || l.n,
       'Came off my ' || c.yr || ' Make' || c.make_n || '. Good condition, about 12k miles of use. Selling because the build changed direction.',
       l.category,
       case l.category when 'performance' then (array['exhaust','intake','turbo'])[1 + l.n % 3]
                       when 'wheels-tires' then (array['wheels','tires'])[1 + l.n % 2]
                       when 'brakes-suspension' then (array['big-brake-kits','coilovers'])[1 + l.n % 2] end,
       (array['new','like_new','used','used','for_parts'])[1 + l.n % 5],
       2000 + (l.n * 37) % 400000,
       (array['Austin, TX','Leeds, UK','Portland, OR','Miami, FL','Denver, CO','Berlin, DE'])[1 + l.n % 6],
       l.status, l.created_at, 1500, l.n % 3 = 0, 'flat',
       (array['Brembo','KW','Akrapovic','BBS','Recaro','Bilstein','Garrett','HKS'])[1 + l.n % 8],
       'PN-' || l.n, (l.n * 7) % 900, case when l.status = 'sold' then l.created_at + interval '9 days' end
from seed_listings l join seed_cars c on c.id = l.car_id;
insert into public.listing_images (listing_id, url, position)
select id, 'https://example.test/l/' || n || '-' || p || '.jpg', p from seed_listings, generate_series(0, 2) p;
insert into public.listing_fitments (listing_id, make, model, year_start, year_end)
select l.id, 'Make' || c.make_n, 'Model' || c.model_n, c.yr - 3, c.yr + 3
from seed_listings l join seed_cars c on c.id = l.car_id where l.n % 2 = 0;
insert into public.listing_questions (listing_id, author_id, body)
select l.id, (select id from seed_profiles p where p.n = 1 + (l.n * 13) % 5000), 'Does this fit the facelift?'
from seed_listings l where l.n % 3 = 0;

insert into public.mod_items (car_id, group_label, category, brand, product, raw_text, position, status)
select c.id, (array['Performance','Suspension','Brakes','Wheels & Tires','Exterior','Interior'])[1 + p % 6], 'performance',
       (array['Brembo','KW','Akrapovic','BBS'])[1 + p % 4], 'Part ' || p, 'Brand part ' || p, p, 'installed'
from seed_cars c, generate_series(0, 11) p;

create temp table seed_posts as
select gen_random_uuid() id, n, (select c.id from seed_cars c where c.n = 1 + (p.n::bigint * 15485863) % 12000) car_id,
       now() - (random() * 365 || ' days')::interval posted_at
from generate_series(1, 120000) p(n);
insert into public.activity_posts (id, car_id, author_id, title, intro, body, published_at, created_at)
select p.id, p.car_id, c.owner_id,
       (array['Fitted the coilovers','Dyno day','New wheels on','Exhaust install','Track day at the ring','Brake upgrade done'])[1 + p.n % 6] || ' #' || p.n,
       'Spent the weekend in the garage. Here is how it went.', '{"type":"doc","content":[]}'::jsonb,
       p.posted_at, p.posted_at
from seed_posts p join seed_cars c on c.id = p.car_id;
insert into public.activity_images (post_id, url, position)
select id, 'https://example.test/p/' || n || '-' || i || '.jpg', i from seed_posts, generate_series(0, 1) i;

insert into public.likes (user_id, target_type, target_id)
select distinct (select id from seed_profiles p where p.n = 1 + (g * 7 + l.n) % 5000), 'listing', l.id
from seed_listings l, generate_series(1, 3) g where l.n % 2 = 0;
insert into public.likes (user_id, target_type, target_id)
select distinct (select id from seed_profiles p where p.n = 1 + (g * 11 + c.n) % 5000), 'car', c.id
from seed_cars c, generate_series(1, 10) g;
insert into public.saves (user_id, target_type, target_id)
select distinct (select id from seed_profiles p where p.n = 1 + (g * 13 + l.n) % 5000), 'listing', l.id
from seed_listings l, generate_series(1, 2) g where l.n % 2 = 1;
insert into public.follows (follower_id, target_type, target_id)
select distinct (select id from seed_profiles p where p.n = 1 + (g * 17 + c.n) % 5000), 'car', c.id
from seed_cars c, generate_series(1, 5) g;
insert into public.follows (follower_id, target_type, target_id)
select distinct f.id, 'profile', t.id
from seed_profiles f join seed_profiles t on t.n = 1 + (f.n * 3 + 1) % 5000 or t.n = 1 + (f.n * 5 + 2) % 5000 or t.n = 1 + (f.n * 7 + 3) % 5000
where f.id <> t.id;
insert into public.reviews (order_id, reviewer_id, reviewee_id, rating, body)
select gen_random_uuid(), (select id from seed_profiles p where p.n = 1 + (r * 19) % 5000),
       (select id from seed_profiles p where p.n = 1 + (r * 23) % 5000), 3 + r % 3, 'As described.'
from generate_series(1, 20000) r;

commit;
analyze;
select 'profiles' t, count(*) from public.profiles union all select 'cars', count(*) from public.cars
union all select 'listings', count(*) from public.listings union all select 'posts', count(*) from public.activity_posts
union all select 'likes', count(*) from public.likes;
