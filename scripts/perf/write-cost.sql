-- What a write to a part costs, triggers and indexes included, against the
-- volume seed. DISPOSABLE DATABASES ONLY. Rolls back.
--   psql -f scripts/perf/write-cost.sql
-- Run it before and after a migration to see what the migration adds:
-- create (a part with two stated fitments and three photos), a price change,
-- a title edit, taking it off sale and back, and a counted view.
\set ON_ERROR_STOP 1
\pset pager off
begin;
set local statement_timeout = 0;
create temp table write_cost(op text, ms numeric) on commit drop;

do $$
declare
  n int := 300;
  sellers uuid[] := array(select c.owner_id from public.cars c join public.profiles p on p.id = c.owner_id
                          where p.suspended_at is null order by c.id limit 300);
  cars uuid[] := array(select c.id from public.cars c join public.profiles p on p.id = c.owner_id
                       where p.suspended_at is null order by c.id limit 300);
  ids uuid[] := '{}';
  part uuid;
  t timestamptz;
begin
  perform set_config('session_replication_role', 'origin', true);
  for i in 1..n loop
    part := gen_random_uuid();
    ids := ids || part;
    t := clock_timestamp();
    insert into public.listings(id, seller_id, source_car_id, title, description, category, subcategory, condition, price_cents,
                                currency, status, brand, part_number, shipping_cents, shipping_mode)
    values (part, sellers[i], cars[i], 'Write cost part ' || i, 'A part for the write-cost check.', 'engine', 'internals', 'used',
            10000 + i, 'USD', 'active', 'Brembo', 'WC-' || i, 1500, 'flat');
    insert into public.listing_fitments(listing_id, make, model, year_start, year_end)
    values (part, 'Make1', 'Model1', 2010, 2015), (part, 'Make2', 'Model3', null, null);
    insert into public.listing_images(listing_id, url, position)
    select part, 'https://example.test/w/' || i || '-' || p, p from generate_series(0, 2) p;
    insert into write_cost values ('create (part, 2 fitments, 3 photos)', extract(epoch from clock_timestamp() - t) * 1000);
  end loop;
  foreach part in array ids loop
    t := clock_timestamp();
    update public.listings set price_cents = price_cents + 100 where listings.id = part;
    insert into write_cost values ('price change', extract(epoch from clock_timestamp() - t) * 1000);
    t := clock_timestamp();
    update public.listings set title = title || ' (edited)', description = description || ' More.' where listings.id = part;
    insert into write_cost values ('title and description edit', extract(epoch from clock_timestamp() - t) * 1000);
    t := clock_timestamp();
    update public.listings set status = 'paused' where listings.id = part;
    update public.listings set status = 'active' where listings.id = part;
    insert into write_cost values ('off sale and back (two updates)', extract(epoch from clock_timestamp() - t) * 1000);
    t := clock_timestamp();
    update public.listings set view_count = coalesce(view_count, 0) + 1 where listings.id = part;
    insert into write_cost values ('counted view', extract(epoch from clock_timestamp() - t) * 1000);
  end loop;
end $$;

select op, count(*) as n, round(avg(ms), 2) as avg_ms,
       round((percentile_cont(0.5) within group (order by ms))::numeric, 2) as median_ms
from write_cost group by op order by min(ms);
select count(*) as search_jobs_queued from public.remediation_jobs where kind = 'search' and created_at > now() - interval '1 hour';
rollback;
