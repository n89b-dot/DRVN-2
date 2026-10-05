-- The queries the public pages run, as the visitor's own database role
-- (row security on), with EXPLAIN ANALYZE. Run by scripts/perf/query-plans.sh
-- against the volume seed. Each query is named by a \echo line; the runner
-- prints its execution time beside the budget in docs/performance/query-plans.md.
\set ON_ERROR_STOP 1
\pset pager off
select id as listing_id, seller_id from public.listings where status = 'active' order by created_at desc limit 1 \gset
select slug as car_slug, id as car_id, owner_id from public.cars where is_public order by created_at desc limit 1 \gset
select array_agg(id) as listing_ids from (select id from public.listings where status = 'active' order by created_at desc limit 24) s \gset
select array_agg(distinct seller_id) as seller_ids from (select seller_id from public.listings where status = 'active' order by created_at desc limit 24) s \gset
select array_agg(id) as post_ids from (select id from public.activity_posts order by published_at desc limit 12) s \gset
select array_agg(id) as car_ids from (select id from public.cars where is_public order by created_at desc limit 12) s \gset
select id as viewer from public.profiles order by username limit 1 \gset

set role anon;

\echo == marketplace: newest page
explain (analyze, buffers) select id, title, price_cents from public.marketplace_browse_rows() order by created_at desc, id limit 24;
\echo == marketplace: newest page count
explain (analyze, buffers) select count(*) from public.marketplace_browse_rows();
\echo == marketplace: category, cheapest first
explain (analyze, buffers) select id from public.marketplace_browse_rows() where category = 'wheels-tires' and subcategory = 'wheels' order by price_cents, id limit 24;
\echo == marketplace: page 40 of newest
explain (analyze, buffers) select id from public.marketplace_browse_rows() order by created_at desc, id limit 24 offset 936;
\echo == marketplace: text search
explain (analyze, buffers) select id from public.marketplace_browse_rows(p_query => 'brembo brake kit') order by created_at desc, id limit 24;
\echo == marketplace: part number search
explain (analyze, buffers) select id from public.marketplace_browse_rows(p_query => 'PN-4242') order by created_at desc, id limit 24;
\echo == marketplace: vehicle filter
explain (analyze, buffers) select id from public.marketplace_browse_rows(p_vehicle => '900005-900503') order by created_at desc, id limit 24;
\echo == marketplace: vehicle filter count
explain (analyze, buffers) select count(*) from public.marketplace_browse_rows(p_vehicle => '900005-900503');
\echo == marketplace: brand counts
explain (analyze, buffers) select * from public.marketplace_brand_counts();
\echo == marketplace: category counts
explain (analyze, buffers) select * from public.marketplace_category_counts();
\echo == marketplace: conditions in use
explain (analyze, buffers) select condition from public.marketplace_browse_rows() limit 1000;
\echo == cards: cover photos
explain (analyze, buffers) select listing_id, url, position from public.listing_images where listing_id = any(:'listing_ids') order by position;
\echo == cards: watch counts
explain (analyze, buffers) select * from public.listing_watch_counts(:'listing_ids');
\echo == cards: seller ratings
explain (analyze, buffers) select reviewee_id, rating from public.reviews where reviewee_id = any(:'seller_ids');
\echo == cards: seller active counts
explain (analyze, buffers) select * from public.seller_active_counts(:'seller_ids');
\echo == cards: like counts
explain (analyze, buffers) select target_id from public.likes where target_type = 'listing' and target_id = any(:'listing_ids');
\echo == cards: question counts
explain (analyze, buffers) select listing_id from public.listing_questions where listing_id = any(:'listing_ids');

\echo == explore: mixed wall, page one
explain (analyze, buffers) select kind, id, happened_at from public.feed_events where kind in ('car','update','part') order by happened_at desc, id desc limit 25;
\echo == explore: mixed wall, page ten
explain (analyze, buffers) select kind, id, happened_at from public.feed_events where kind in ('car','update','part') order by happened_at desc, id desc limit 25 offset 225;
\echo == explore: updates only
explain (analyze, buffers) select kind, id, happened_at from public.feed_events where kind in ('update') order by happened_at desc, id desc limit 25;
\echo == explore: card hydration
explain (analyze, buffers) select public.feed_hydration(:'post_ids', :'car_ids', :'listing_ids');
\echo == explore: trending models
explain (analyze, buffers) select * from public.trending_models(45, 10);
\echo == explore: suggested builders
explain (analyze, buffers) select * from public.suggested_builders(null, 8);
\echo == explore: search builds
explain (analyze, buffers) select id from public.explore_build_rows('make7 coilovers') limit 24;
\echo == explore: search updates
explain (analyze, buffers) select id from public.explore_update_rows('dyno day') limit 24;
\echo == explore: updates for a model
explain (analyze, buffers) select id from public.explore_update_rows(p_make => 'Make5', p_model => 'Model3', p_make_id => 900005, p_model_id => 900503) limit 24;

\echo == car page: car by slug
explain (analyze, buffers) select * from public.cars where slug = :'car_slug';
\echo == car page: mods
explain (analyze, buffers) select * from public.mod_items where car_id = :'car_id' order by position;
\echo == car page: updates
explain (analyze, buffers) select id, title from public.activity_posts where car_id = :'car_id' and published_at is not null order by published_at desc limit 50;
\echo == car page: parts off this car
explain (analyze, buffers) select id, title from public.listings where source_car_id = :'car_id' and status in ('active','reserved','sold') order by created_at desc limit 50;
\echo == listing page: listing
explain (analyze, buffers) select * from public.listings where id = :'listing_id';
\echo == listing page: more from seller
explain (analyze, buffers) select id from public.listings where seller_id = :'seller_id' and status = 'active' and id <> :'listing_id' limit 4;
\echo == listing page: seller sold count
explain (analyze, buffers) select count(*) from public.listings where seller_id = :'seller_id' and status = 'sold';
\echo == listing page: tagged updates
explain (analyze, buffers) select p.id from public.activity_posts p join public.activity_post_listings t on t.post_id = p.id where t.listing_id = :'listing_id' and p.published_at is not null order by p.published_at desc limit 6;
\echo == profile: cars
explain (analyze, buffers) select id from public.cars where owner_id = :'owner_id' order by created_at desc;
\echo == profile: follow counts
explain (analyze, buffers) select * from public.profile_follow_counts(:'owner_id');

reset role;
select set_config('request.jwt.claims', json_build_object('sub', :'viewer', 'role', 'authenticated')::text, false) \gset
set role authenticated;
select array_agg(target_id) as followed_cars from public.follows where follower_id = :'viewer' and target_type = 'car' \gset

\echo == member: marketplace newest page
explain (analyze, buffers) select id from public.marketplace_browse_rows() order by created_at desc, id limit 24;
\echo == member: fits my garage
explain (analyze, buffers) select id from public.marketplace_browse_rows(p_fit => true) order by created_at desc, id limit 24;
\echo == member: following feed updates
explain (analyze, buffers) select id from public.activity_posts where published_at is not null and car_id = any(:'followed_cars') order by published_at desc, id desc limit 40;
\echo == member: saved marks
explain (analyze, buffers) select target_id from public.saves where user_id = :'viewer' and target_type = 'listing' and target_id = any(:'listing_ids');
\echo == member: unread notifications
explain (analyze, buffers) select kind from public.notifications where user_id = :'viewer' and read_at is null limit 1000;
