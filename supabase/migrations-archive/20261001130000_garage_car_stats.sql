-- 20261001130000 — the garage's numbers, counted by the database (RR-09, RR-25).
--
-- The garage sheet said "$X earned off them" by adding up the asking price of
-- every listing whose status was 'sold'. Since 20260929100000 a seller can
-- mark a part sold that sold somewhere else, so that figure counted parts
-- that never earned anything on DRVN, at their asking price; an accepted
-- offer counted at the price nobody paid; a refund changed nothing. It also
-- fetched every photo, mod, post, listing, follow and like row for the
-- owner's cars to count them in the browser's server render.
--
-- garage_car_stats(p_cars) returns one row per car the caller owns:
--   * counts — installed mods, published updates, followers, likes;
--   * parts — live (active), held (reserved by a checkout), sold (any sold
--     listing, including "sold elsewhere"), open offers on unsold parts;
--   * the latest published update, for the sheet's preview;
--   * sales_count / sales_cents — DRVN sales only: order items of the
--     caller's paid orders (paid, shipped, delivered, completed — the set
--     profile_sales_count counts), at the price the buyer paid, less each
--     order's refunds shared across its items by price, never below zero.
--     Before DRVN fees and shipping. A fully refunded or cancelled order is
--     not a sale. The car is the one frozen into the purchase snapshot,
--     falling back to the listing's current source car for old snapshots.
--
-- SECURITY INVOKER: the caller's own RLS decides what is counted, exactly as
-- it did for the separate reads, and only cars the caller owns are returned.
-- Idempotent.

begin;

create or replace function public.garage_car_stats(p_cars uuid[])
returns table(
  car_id uuid,
  mods integer,
  updates integer,
  latest_update jsonb,
  parts_live integer,
  parts_held integer,
  parts_sold integer,
  open_offers integer,
  followers integer,
  likes integer,
  sales_count integer,
  sales_cents bigint
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $function$
  with mine as (
    select c.id from public.cars c
    where c.id = any(p_cars) and c.owner_id = auth.uid()
  ),
  mod_counts as (
    select m.car_id, count(*)::integer as n
    from public.mod_items m join mine on mine.id = m.car_id
    where m.status = 'installed'
    group by m.car_id
  ),
  post_counts as (
    select p.car_id, count(*)::integer as n
    from public.activity_posts p join mine on mine.id = p.car_id
    where p.published_at is not null
    group by p.car_id
  ),
  latest as (
    select distinct on (p.car_id)
      p.car_id,
      jsonb_build_object(
        'id', p.id,
        'title', p.title,
        'intro', p.intro,
        'body', p.body,
        'published_at', p.published_at,
        'cover_url', (
          select ai.url from public.activity_images ai
          where ai.post_id = p.id order by ai.position limit 1
        )
      ) as post
    from public.activity_posts p join mine on mine.id = p.car_id
    where p.published_at is not null
    order by p.car_id, p.published_at desc, p.id desc
  ),
  parts as (
    select
      l.source_car_id as car_id,
      count(*) filter (where l.status = 'active')::integer as live,
      count(*) filter (where l.status = 'reserved')::integer as held,
      count(*) filter (where l.status = 'sold')::integer as sold,
      coalesce(sum((
        select count(*) from public.offers o
        where o.listing_id = l.id and o.status = 'open'
      )) filter (where l.status <> 'sold'), 0)::integer as offers
    from public.listings l join mine on mine.id = l.source_car_id
    where l.status in ('active', 'reserved', 'sold')
    group by l.source_car_id
  ),
  follow_counts as (
    select f.target_id as car_id, count(*)::integer as n
    from public.follows f join mine on mine.id = f.target_id
    where f.target_type = 'car'
    group by f.target_id
  ),
  like_counts as (
    select k.target_id as car_id, count(*)::integer as n
    from public.likes k join mine on mine.id = k.target_id
    where k.target_type = 'car'
    group by k.target_id
  ),
  sold_items as (
    select
      coalesce(
        case when (oi.commercial_snapshot -> 'source_car' ->> 'id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
             then (oi.commercial_snapshot -> 'source_car' ->> 'id')::uuid end,
        l.source_car_id
      ) as car_id,
      (oi.price_cents::bigint * coalesce(oi.quantity, 1)) as item_cents,
      sum(oi.price_cents::bigint * coalesce(oi.quantity, 1)) over (partition by oi.order_id) as order_items_cents,
      coalesce(o.refunded_cents, 0)::bigint as refunded_cents
    from public.orders o
    join public.order_items oi on oi.order_id = o.id
    left join public.listings l on l.id = oi.listing_id
    where o.seller_id = auth.uid()
      and o.status in ('paid', 'shipped', 'delivered', 'completed')
  ),
  sales as (
    select s.car_id,
           count(*)::integer as n,
           sum(greatest(
             0,
             s.item_cents - case when s.order_items_cents > 0
                                 then round(s.refunded_cents::numeric * s.item_cents / s.order_items_cents)::bigint
                                 else 0 end
           ))::bigint as cents
    from sold_items s join mine on mine.id = s.car_id
    group by s.car_id
  )
  select
    mine.id,
    coalesce(mod_counts.n, 0),
    coalesce(post_counts.n, 0),
    latest.post,
    coalesce(parts.live, 0),
    coalesce(parts.held, 0),
    coalesce(parts.sold, 0),
    coalesce(parts.offers, 0),
    coalesce(follow_counts.n, 0),
    coalesce(like_counts.n, 0),
    coalesce(sales.n, 0),
    coalesce(sales.cents, 0)
  from mine
  left join mod_counts on mod_counts.car_id = mine.id
  left join post_counts on post_counts.car_id = mine.id
  left join latest on latest.car_id = mine.id
  left join parts on parts.car_id = mine.id
  left join follow_counts on follow_counts.car_id = mine.id
  left join like_counts on like_counts.car_id = mine.id
  left join sales on sales.car_id = mine.id;
$function$;

revoke all on function public.garage_car_stats(uuid[]) from public, anon;
grant execute on function public.garage_car_stats(uuid[]) to authenticated;

commit;
