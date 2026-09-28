-- Home's "picked for you" rail in one round trip.
--
-- `recommendListings` (src/lib/recommendations.ts) ran its three rules as up
-- to eight dependent reads — garage, matching cars, their listings, my saves,
-- co-savers, their saves, the popularity fallback, then the listing rows —
-- about 0.8 s of trips before the rail could stream. Same rules, same
-- scores, one statement:
--
--  1. Platform match (+10): active listings off a car with the same
--     make + model as one in the member's garage. "Fits your <make model>".
--     Matching is case-insensitive on both parts.
--  2. Co-save (+3 per neighbour save): listings saved by people who saved
--     the member's 50 most recent saved listings, excluding ones already
--     saved. "Because you saved similar parts".
--  3. Popularity (+1 per save), only when rules 1–2 found fewer than
--     p_limit: "Popular with the DRVN community".
--
-- Ranked by total score, then the rule that found it, then newest; never
-- the member's own listings, only active ones.
--
-- It reads other members' saves in aggregate, which RLS keeps private, so it
-- is callable only by the service role (the server's admin client). It is
-- SECURITY INVOKER: under the service role that reads everything, and any
-- other caller is refused by the grants below, not trusted with a p_user.
--
-- Idempotent: create or replace.

begin;

create or replace function public.recommend_listings(p_user uuid, p_limit integer default 8)
returns table (
  id uuid,
  title text,
  price_cents integer,
  shipping_cents integer,
  condition text,
  location text,
  part_number text,
  seller_id uuid,
  source_car_id uuid,
  status text,
  score integer,
  reason text
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with
  garage as (
    select distinct lower(c.make) as mk, lower(c.model) as md
    from public.cars c
    where c.owner_id = p_user
      and coalesce(c.make, '') <> '' and coalesce(c.model, '') <> ''
  ),
  matched_cars as (
    select c.id,
           nullif(concat_ws(' ', nullif(trim(c.make), ''), nullif(trim(c.model), '')), '') as label
    from public.cars c
    join garage g on lower(c.make) = g.mk and lower(c.model) = g.md
  ),
  rule1 as (
    select l.id as listing_id, 10 as pts, 'Fits your ' || m.label as reason, 1 as rule
    from public.listings l
    join matched_cars m on m.id = l.source_car_id
    where l.status = 'active' and l.seller_id <> p_user
    order by l.created_at desc
    limit 50
  ),
  my_saved as (
    select s.target_id, s.created_at
    from public.saves s
    where s.user_id = p_user and s.target_type = 'listing'
  ),
  my_recent_saved as (
    select target_id from my_saved order by created_at desc limit 50
  ),
  neighbours as (
    select distinct n.user_id
    from (
      select s.user_id
      from public.saves s
      where s.target_type = 'listing'
        and s.target_id in (select target_id from my_recent_saved)
        and s.user_id <> p_user
      limit 50
    ) n
  ),
  rule2 as (
    select s.target_id as listing_id, 3 as pts, 'Because you saved similar parts' as reason, 2 as rule
    from (
      select s.target_id
      from public.saves s
      where s.target_type = 'listing'
        and s.user_id in (select user_id from neighbours)
        and s.target_id not in (select target_id from my_saved)
      limit 50
    ) s
  ),
  first_rules as (
    select * from rule1
    union all
    select * from rule2
  ),
  rule3 as (
    select s.target_id as listing_id, 1 as pts, 'Popular with the DRVN community' as reason, 3 as rule
    from (
      select s.target_id from public.saves s where s.target_type = 'listing' limit 50
    ) s
    where (select count(distinct listing_id) from first_rules) < coalesce(p_limit, 8)
  ),
  scored as (
    select p.listing_id,
           sum(p.pts)::integer as score,
           (array_agg(p.reason order by p.rule) filter (where p.reason is not null))[1] as reason,
           min(p.rule) as first_rule
    from (select * from first_rules union all select * from rule3) p
    group by p.listing_id
  )
  select l.id, l.title, l.price_cents, l.shipping_cents, l.condition, l.location, l.part_number,
         l.seller_id, l.source_car_id, l.status, s.score, s.reason
  from scored s
  join public.listings l on l.id = s.listing_id
  where l.status = 'active' and l.seller_id <> p_user
  order by s.score desc, s.first_rule, l.created_at desc
  limit greatest(coalesce(p_limit, 8), 0);
$$;

-- Supabase grants new public functions to anon and authenticated by default
-- privileges, so both are revoked by name, not only PUBLIC.
revoke all on function public.recommend_listings(uuid, integer) from public, anon, authenticated;
grant execute on function public.recommend_listings(uuid, integer) to service_role;

commit;
