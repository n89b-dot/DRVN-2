-- B1 — price comparables (plan 2026-10 agent and graph, "B1 — Graph
-- foundation"; A3's opening offer "worked out from the asking price,
-- comparables (once B1 lands) and the style").
--
-- price_comparables(brand, part number) answers "what does this part sell
-- for, and what is it listed at" for one product:
--
--   identity  The brand + number is resolved to its product through the
--             membership (20261020120000), so every number the product holds
--             counts. Before a product exists the pair itself is the key.
--             No brand, no answer: a number alone is not a product.
--   sold      Paid-and-completed sales only (orders.status = 'completed'),
--             in the last 730 days, at the price the buyer paid (the
--             snapshot's commercial.price_cents, which an accepted offer
--             sets), per unit, NET OF REFUNDS:
--               - a line with a completed return is not a sale and is left out;
--               - any other refund on the order, less what completed returns
--                 refunded, up to the order's goods, comes off each remaining
--                 line by its share of the goods;
--               - a line with nothing left after refunds is left out.
--             Brand and number come from the purchase snapshot (part.brand
--             from 20261020110000; older snapshots fall back to the sold
--             listing's brand, which a sold listing can no longer change).
--             Each sale carries its condition, shipping and age.
--   asking    Parts for sale now with the same identity, sellers not
--             suspended, optionally leaving out the caller's own listing.
--
-- At most the 500 newest sales of each number are read (a part sold
-- thousands of times is described by its recent 500, from an index in
-- purchase order), so no part can make the call slow.
--
-- A minimum sample (3) guards every figure: below it the answer is the
-- count alone, never a price, so one sale's negotiated price can't be read
-- off a "median". The same floor applies to each condition's breakdown.
-- Prices are in one currency (default USD); other currencies don't mix in.
--
-- SECURITY DEFINER because sold prices live in orders no member can read;
-- it returns aggregates only — never a line, an order, a buyer or a seller.
-- Callable by signed-in members (the seller pricing a part, the agent acting
-- for them), not by visitors.
--
-- The purchase snapshot is read by number, newest first, through an
-- expression index on order_items (the same compacting as
-- listings.part_number_compact, then captured_at).
--
-- product_coverage is restated to also count completed sale lines that have
-- a product, and to count set-based (left joins), not with a lookup per row.
-- It reads every listing, build line and completed sale, so it runs in the
-- nightly full run only (about 2 minutes at 2M parts, mostly reading the
-- tables); the admin page shows the stored result.
--
-- Idempotent.

begin;

-- Newest purchase first within a part number, so a part sold thousands of
-- times is read 500 sales deep, never all of them. captured_at is the
-- snapshot's own UTC timestamp (one format), so it sorts as text.
drop index if exists public.order_items_snapshot_part_number_idx;
create index if not exists order_items_snapshot_part_recent_idx
  on public.order_items ((nullif(regexp_replace(lower(coalesce(commercial_snapshot -> 'part' ->> 'part_number', '')), '[^a-z0-9]', '', 'g'), '')),
                         (commercial_snapshot ->> 'captured_at') desc)
  where commercial_snapshot -> 'part' ->> 'part_number' is not null;

create or replace function public.price_comparables(
  p_brand text,
  p_part_number text,
  p_currency text default 'USD',
  p_exclude_listing uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  c_min_sample constant int := 3;
  c_window_days constant int := 730;
  c_sample_cap constant int := 500;
  v_brand text := nullif(regexp_replace(lower(coalesce(p_brand, '')), '[^[:alnum:]]', '', 'g'), '');
  v_number text := nullif(regexp_replace(lower(coalesce(p_part_number, '')), '[^a-z0-9]', '', 'g'), '');
  v_product uuid;
  v_brands text[];
  v_pairs text[];
  v_numbers text[];
  v_sold jsonb;
  v_asking jsonb;
begin
  if v_brand is null or v_number is null then
    return jsonb_build_object('enough', false, 'reason', 'brand_and_number_required', 'min_sample', c_min_sample);
  end if;

  select pm.product_id into v_product
  from public.product_part_numbers pm where pm.brand_key = v_brand and pm.number_compact = v_number;

  -- Every (brand, number) the product holds; the pair alone before it has one.
  if v_product is not null then
    select array_agg(pm.brand_key order by pm.brand_key, pm.number_compact),
           array_agg(pm.number_compact order by pm.brand_key, pm.number_compact)
      into v_brands, v_pairs
    from public.product_part_numbers pm where pm.product_id = v_product;
  else
    v_brands := array[v_brand];
    v_pairs := array[v_number];
  end if;
  select array_agg(distinct n) into v_numbers from unnest(v_pairs) n;

  -- Per line, every lookup is an index probe on that line's own order: no
  -- join between the matching lines and an aggregate of them, which the
  -- planner estimates at one row and turns into a nested loop that redoes
  -- the aggregate per line (5,000 sales: 2.7 s; this way: tens of ms).
  with matching as materialized (
    select oi.id, oi.order_id, o.refunded_cents,
           greatest(coalesce(oi.quantity, 1), 1) as quantity,
           oi.price_cents::bigint * greatest(coalesce(oi.quantity, 1), 1) as goods_cents,
           -- The sold listing is read only for a snapshot from before
           -- part.brand (coalesce stops at the first value).
           nullif(regexp_replace(lower(coalesce(oi.commercial_snapshot -> 'part' ->> 'brand',
             (select l.brand from public.listings l where l.id = oi.listing_id), '')), '[^[:alnum:]]', '', 'g'), '') as brand_key,
           v.n as number_compact,
           coalesce(oi.commercial_snapshot -> 'condition' ->> 'condition',
             (select l.condition from public.listings l where l.id = oi.listing_id)) as condition,
           coalesce((oi.commercial_snapshot -> 'commercial' ->> 'shipping_cents')::bigint, oi.shipping_cents::bigint) as shipping_cents,
           coalesce(o.completed_at, o.delivered_at, o.created_at) as sold_at
    from unnest(v_numbers) v(n)
    -- The newest c_sample_cap purchases of each number, from the index in
    -- order; the completed, in-window, same-currency ones among them count.
    cross join lateral (
      select oi.* from public.order_items oi
      where nullif(regexp_replace(lower(coalesce(oi.commercial_snapshot -> 'part' ->> 'part_number', '')), '[^a-z0-9]', '', 'g'), '') = v.n
        and oi.commercial_snapshot -> 'part' ->> 'part_number' is not null
      order by oi.commercial_snapshot ->> 'captured_at' desc
      limit c_sample_cap
    ) oi
    join public.orders o on o.id = oi.order_id
    where o.status = 'completed'
      and coalesce(o.currency, 'USD') = p_currency
      and coalesce(o.completed_at, o.delivered_at, o.created_at) >= now() - make_interval(days => c_window_days)
  ),
  kept as materialized (
    select s.condition, s.shipping_cents, s.sold_at, s.unit_net_cents
    from (
      select m.condition, m.shipping_cents, m.sold_at,
             round((m.goods_cents - (r.unexplained_cents::numeric * m.goods_cents / nullif(g.goods_cents, 0))) / m.quantity) as unit_net_cents
      from matching m
      join unnest(v_brands, v_pairs) k(brand_key, number_compact)
        on k.brand_key = m.brand_key and k.number_compact = m.number_compact
      -- Every line of the order counts toward its goods, matching or not: a
      -- refund is shared across the whole order.
      cross join lateral (
        select sum(oi.price_cents::bigint * greatest(coalesce(oi.quantity, 1), 1)) as goods_cents
        from public.order_items oi where oi.order_id = m.order_id
      ) g
      -- What the order refunded beyond its completed returns, up to its goods.
      cross join lateral (
        select least(greatest(coalesce(m.refunded_cents, 0)::bigint - coalesce((
                 select sum(greatest(coalesce(r.refund_amount_cents, 0) - coalesce(r.label_deduction_cents, 0), 0))
                 from public.returns r where r.order_id = m.order_id and r.status = 'completed'), 0), 0),
               g.goods_cents) as unexplained_cents
      ) r
      -- A line with a completed return is not a sale.
      where not exists (
        select 1 from public.return_items ri join public.returns rt on rt.id = ri.return_id
        where ri.order_item_id = m.id and rt.status = 'completed')
    ) s
    where s.unit_net_cents > 0
  ),
  by_condition as (
    select condition, count(*) as n,
           percentile_disc(0.5) within group (order by unit_net_cents) as median_cents
    from kept where condition is not null group by condition
  ),
  totals as (
    select count(*) as n,
           percentile_disc(0.5) within group (order by unit_net_cents) as median_cents,
           percentile_disc(0.25) within group (order by unit_net_cents) as p25_cents,
           percentile_disc(0.75) within group (order by unit_net_cents) as p75_cents,
           percentile_disc(0.5) within group (order by shipping_cents) as median_shipping_cents,
           -- A sale completed "in the future" (clock skew) is a sale today.
           greatest(0, extract(day from now() - max(sold_at)))::int as newest_days,
           percentile_disc(0.5) within group (order by greatest(0, extract(day from now() - sold_at))::int) as median_age_days
    from kept
  )
  select jsonb_strip_nulls(jsonb_build_object(
    'count', t.n,
    'enough', t.n >= c_min_sample,
    'median_cents', case when t.n >= c_min_sample then t.median_cents end,
    'p25_cents', case when t.n >= c_min_sample then t.p25_cents end,
    'p75_cents', case when t.n >= c_min_sample then t.p75_cents end,
    'median_shipping_cents', case when t.n >= c_min_sample then t.median_shipping_cents end,
    'newest_days', case when t.n >= c_min_sample then t.newest_days end,
    'median_age_days', case when t.n >= c_min_sample then t.median_age_days end,
    'by_condition', (select jsonb_agg(jsonb_build_object('condition', condition, 'count', n, 'median_cents', median_cents) order by n desc, condition)
                     from by_condition where n >= c_min_sample)
  )) into v_sold
  from totals t;

  with asking as (
    select l.price_cents::bigint as price_cents, l.condition, l.shipping_cents::bigint as shipping_cents, l.created_at
    from public.listings l
    join unnest(v_brands, v_pairs) k(brand_key, number_compact)
      on k.number_compact = l.part_number_compact
     and k.brand_key = nullif(regexp_replace(lower(coalesce(l.brand, '')), '[^[:alnum:]]', '', 'g'), '')
    where l.part_number_compact = any(v_numbers)
      and l.status = 'active'
      and coalesce(l.currency, 'USD') = p_currency
      and l.id is distinct from p_exclude_listing
      and l.seller_id not in (select public.suspended_profile_ids())
  ),
  by_condition as (
    select condition, count(*) as n, percentile_disc(0.5) within group (order by price_cents) as median_cents
    from asking where condition is not null group by condition
  )
  select jsonb_strip_nulls(jsonb_build_object(
    'count', (select count(*) from asking),
    'enough', (select count(*) from asking) >= c_min_sample,
    'median_cents', case when (select count(*) from asking) >= c_min_sample
      then (select percentile_disc(0.5) within group (order by price_cents) from asking) end,
    'p25_cents', case when (select count(*) from asking) >= c_min_sample
      then (select percentile_disc(0.25) within group (order by price_cents) from asking) end,
    'p75_cents', case when (select count(*) from asking) >= c_min_sample
      then (select percentile_disc(0.75) within group (order by price_cents) from asking) end,
    'median_shipping_cents', case when (select count(*) from asking) >= c_min_sample
      then (select percentile_disc(0.5) within group (order by shipping_cents) from asking) end,
    'by_condition', (select jsonb_agg(jsonb_build_object('condition', condition, 'count', n, 'median_cents', median_cents) order by n desc, condition)
                     from by_condition where n >= c_min_sample)
  )) into v_asking;

  return jsonb_build_object(
    'identity', jsonb_build_object('brand_key', v_brand, 'number_compact', v_number,
                                   'product', v_product is not null, 'numbers', cardinality(v_numbers)),
    'currency', p_currency,
    'min_sample', c_min_sample,
    'window_days', c_window_days,
    'sample_cap', c_sample_cap,
    'enough', coalesce((v_sold ->> 'enough')::boolean, false) or coalesce((v_asking ->> 'enough')::boolean, false),
    'sold', v_sold,
    'asking', v_asking
  );
end;
$function$;
revoke all on function public.price_comparables(text, text, text, uuid) from public, anon;
grant execute on function public.price_comparables(text, text, text, uuid) to authenticated, service_role;

-- Restated from 20261020120000 with sold lines added: completed sale lines
-- whose snapshot names a part number, a brand (snapshot or sold listing) and
-- a product.
create or replace function public.product_coverage()
returns jsonb
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  -- Set-based throughout: each record list is left-joined to the membership
  -- once (a hash join at 2M parts), never looked up row by row (185 s).
  with l as materialized (
    select l.part_number_compact as n,
           nullif(regexp_replace(lower(coalesce(l.brand, '')), '[^[:alnum:]]', '', 'g'), '') as b
    from public.listings l
    where l.part_number_compact is not null and l.status not in ('draft', 'removed')
  ), m as materialized (
    select m.part_number_compact as n, m.brand_key as b from public.mod_items m where m.part_number_compact is not null
  ), s as materialized (
    select nullif(regexp_replace(lower(coalesce(oi.commercial_snapshot -> 'part' ->> 'part_number', '')), '[^a-z0-9]', '', 'g'), '') as n,
           nullif(regexp_replace(lower(coalesce(oi.commercial_snapshot -> 'part' ->> 'brand', sl.brand, '')), '[^[:alnum:]]', '', 'g'), '') as b
    from public.order_items oi
    join public.orders o on o.id = oi.order_id and o.status = 'completed'
    left join public.listings sl on sl.id = oi.listing_id
    where oi.commercial_snapshot -> 'part' ->> 'part_number' is not null
  ), lp as (
    select l.n, l.b, pm.product_id from l left join public.product_part_numbers pm on pm.brand_key = l.b and pm.number_compact = l.n
  ), mp as (
    select m.n, m.b, pm.product_id from m left join public.product_part_numbers pm on pm.brand_key = m.b and pm.number_compact = m.n
  ), sp as (
    select s.n, s.b, pm.product_id from s left join public.product_part_numbers pm on pm.brand_key = s.b and pm.number_compact = s.n
  )
  select jsonb_build_object(
    'listings', (select jsonb_build_object(
        'with_number', count(*),
        'with_brand_and_number', count(*) filter (where b is not null),
        'eligible', count(*) filter (where b is not null and n ~ '[0-9]' and char_length(n) between 3 and 64),
        'with_product', count(*) filter (where product_id is not null))
      from lp),
    'mod_items', (select jsonb_build_object(
        'with_number', count(*),
        'with_brand_and_number', count(*) filter (where b is not null),
        'eligible', count(*) filter (where b is not null and n ~ '[0-9]' and char_length(n) between 3 and 64),
        'with_product', count(*) filter (where product_id is not null))
      from mp),
    'sold_lines', (select jsonb_build_object(
        'with_number', count(*) filter (where n is not null),
        'with_brand_and_number', count(*) filter (where n is not null and b is not null),
        'with_product', count(*) filter (where product_id is not null))
      from sp),
    'products', (select jsonb_build_object(
        'active', count(*) filter (where status = 'active'),
        'merged', count(*) filter (where status = 'merged'))
      from public.products p),
    'products_on_listings_and_builds', (select count(*) from (
        select product_id from lp where product_id is not null
        intersect
        select product_id from mp where product_id is not null) x),
    'open_reviews', (select coalesce(jsonb_object_agg(kind, n), '{}'::jsonb)
      from (select kind, count(*) as n from public.product_identity_reviews where status = 'open' group by kind) r)
  );
$function$;
revoke all on function public.product_coverage() from public, anon, authenticated;

do $$
begin
  if to_regprocedure('public.price_comparables(text,text,text,uuid)') is null then
    raise exception '20261020140000: price_comparables missing';
  end if;
  raise notice 'PASS: 20261020140000 self-checks';
end $$;

commit;
