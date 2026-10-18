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
-- The purchase snapshot is read by number through an expression index on
-- order_items (the same compacting as listings.part_number_compact), so the
-- lookup is an index probe per number at any volume.
--
-- product_coverage is restated to also count completed sale lines that have
-- a product.
--
-- Idempotent.

begin;

create index if not exists order_items_snapshot_part_number_idx
  on public.order_items ((nullif(regexp_replace(lower(coalesce(commercial_snapshot -> 'part' ->> 'part_number', '')), '[^a-z0-9]', '', 'g'), '')))
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

  with lines as (
    select oi.id, oi.order_id,
           greatest(coalesce(oi.quantity, 1), 1) as quantity,
           oi.price_cents::bigint * greatest(coalesce(oi.quantity, 1), 1) as goods_cents,
           nullif(regexp_replace(lower(coalesce(oi.commercial_snapshot -> 'part' ->> 'brand', l.brand, '')), '[^[:alnum:]]', '', 'g'), '') as brand_key,
           nullif(regexp_replace(lower(coalesce(oi.commercial_snapshot -> 'part' ->> 'part_number', '')), '[^a-z0-9]', '', 'g'), '') as number_compact,
           coalesce(oi.commercial_snapshot -> 'condition' ->> 'condition', l.condition) as condition,
           coalesce((oi.commercial_snapshot -> 'commercial' ->> 'shipping_cents')::bigint, oi.shipping_cents::bigint) as shipping_cents,
           coalesce(o.completed_at, o.delivered_at, o.created_at) as sold_at
    from public.order_items oi
    join public.orders o on o.id = oi.order_id
    left join public.listings l on l.id = oi.listing_id
    where nullif(regexp_replace(lower(coalesce(oi.commercial_snapshot -> 'part' ->> 'part_number', '')), '[^a-z0-9]', '', 'g'), '') = any(v_numbers)
      and oi.commercial_snapshot -> 'part' ->> 'part_number' is not null
      and o.status = 'completed'
      and coalesce(o.currency, 'USD') = p_currency
      and coalesce(o.completed_at, o.delivered_at, o.created_at) >= now() - make_interval(days => c_window_days)
  ),
  matching as (
    select ln.* from lines ln
    join unnest(v_brands, v_pairs) k(brand_key, number_compact) on k.brand_key = ln.brand_key and k.number_compact = ln.number_compact
  ),
  returned as (
    select distinct ri.order_item_id
    from public.returns r join public.return_items ri on ri.return_id = r.id
    where r.status = 'completed' and r.order_id in (select order_id from matching)
  ),
  orders_goods as (
    -- Every line of the order counts toward its goods, matching or not: a
    -- refund is shared across the whole order.
    select oi.order_id,
           sum(oi.price_cents::bigint * greatest(coalesce(oi.quantity, 1), 1)) as goods_cents
    from public.order_items oi where oi.order_id in (select order_id from matching)
    group by oi.order_id
  ),
  order_refunds as (
    select og.order_id, og.goods_cents,
           least(greatest(coalesce(o.refunded_cents, 0)::bigint - coalesce((
             select sum(greatest(coalesce(r.refund_amount_cents, 0) - coalesce(r.label_deduction_cents, 0), 0))
             from public.returns r where r.order_id = og.order_id and r.status = 'completed'), 0), 0),
             og.goods_cents) as unexplained_cents
    from orders_goods og join public.orders o on o.id = og.order_id
  ),
  sales as (
    select m.condition, m.shipping_cents, m.sold_at,
           round((m.goods_cents - (r.unexplained_cents::numeric * m.goods_cents / nullif(r.goods_cents, 0))) / m.quantity) as unit_net_cents
    from matching m
    join order_refunds r on r.order_id = m.order_id
    where m.id not in (select order_item_id from returned)
  ),
  kept as (
    select * from sales where unit_net_cents > 0
  ),
  by_condition as (
    select condition, count(*) as n,
           percentile_disc(0.5) within group (order by unit_net_cents) as median_cents
    from kept where condition is not null group by condition
  )
  select jsonb_strip_nulls(jsonb_build_object(
    'count', (select count(*) from kept),
    'enough', (select count(*) from kept) >= c_min_sample,
    'median_cents', case when (select count(*) from kept) >= c_min_sample
      then (select percentile_disc(0.5) within group (order by unit_net_cents) from kept) end,
    'p25_cents', case when (select count(*) from kept) >= c_min_sample
      then (select percentile_disc(0.25) within group (order by unit_net_cents) from kept) end,
    'p75_cents', case when (select count(*) from kept) >= c_min_sample
      then (select percentile_disc(0.75) within group (order by unit_net_cents) from kept) end,
    'median_shipping_cents', case when (select count(*) from kept) >= c_min_sample
      then (select percentile_disc(0.5) within group (order by shipping_cents) from kept) end,
    'newest_days', case when (select count(*) from kept) >= c_min_sample
      then (select extract(day from now() - max(sold_at))::int from kept) end,
    'median_age_days', case when (select count(*) from kept) >= c_min_sample
      then (select percentile_disc(0.5) within group (order by extract(day from now() - sold_at)::int) from kept) end,
    'by_condition', (select jsonb_agg(jsonb_build_object('condition', condition, 'count', n, 'median_cents', median_cents) order by n desc, condition)
                     from by_condition where n >= c_min_sample)
  )) into v_sold;

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
  with l as (
    select l.part_number_compact as n,
           nullif(regexp_replace(lower(coalesce(l.brand, '')), '[^[:alnum:]]', '', 'g'), '') as b
    from public.listings l
    where l.part_number_compact is not null and l.status not in ('draft', 'removed')
  ), m as (
    select m.part_number_compact as n, m.brand_key as b from public.mod_items m where m.part_number_compact is not null
  ), s as (
    select nullif(regexp_replace(lower(coalesce(oi.commercial_snapshot -> 'part' ->> 'part_number', '')), '[^a-z0-9]', '', 'g'), '') as n,
           nullif(regexp_replace(lower(coalesce(oi.commercial_snapshot -> 'part' ->> 'brand', sl.brand, '')), '[^[:alnum:]]', '', 'g'), '') as b
    from public.order_items oi
    join public.orders o on o.id = oi.order_id and o.status = 'completed'
    left join public.listings sl on sl.id = oi.listing_id
    where oi.commercial_snapshot -> 'part' ->> 'part_number' is not null
  )
  select jsonb_build_object(
    'listings', (select jsonb_build_object(
        'with_number', count(*),
        'with_brand_and_number', count(*) filter (where b is not null),
        'eligible', count(*) filter (where b is not null and n ~ '[0-9]' and char_length(n) between 3 and 64),
        'with_product', count(*) filter (where exists (
          select 1 from public.product_part_numbers pm where pm.brand_key = l.b and pm.number_compact = l.n)))
      from l),
    'mod_items', (select jsonb_build_object(
        'with_number', count(*),
        'with_brand_and_number', count(*) filter (where b is not null),
        'eligible', count(*) filter (where b is not null and n ~ '[0-9]' and char_length(n) between 3 and 64),
        'with_product', count(*) filter (where exists (
          select 1 from public.product_part_numbers pm where pm.brand_key = m.b and pm.number_compact = m.n)))
      from m),
    'sold_lines', (select jsonb_build_object(
        'with_number', count(*) filter (where n is not null),
        'with_brand_and_number', count(*) filter (where n is not null and b is not null),
        'with_product', count(*) filter (where exists (
          select 1 from public.product_part_numbers pm where pm.brand_key = s.b and pm.number_compact = s.n)))
      from s),
    'products', (select jsonb_build_object(
        'active', count(*) filter (where status = 'active'),
        'merged', count(*) filter (where status = 'merged'))
      from public.products p),
    -- Set-based, never a lookup per product against the lists above (at 2M
    -- parts that is quadratic).
    'products_on_listings_and_builds', (select count(*) from (
        select pm.product_id from public.product_part_numbers pm join l on l.b = pm.brand_key and l.n = pm.number_compact
        intersect
        select pm.product_id from public.product_part_numbers pm join m on m.b = pm.brand_key and m.n = pm.number_compact) x),
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
