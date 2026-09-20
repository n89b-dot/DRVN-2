-- 20260919191000 — "N for sale" on every marketplace card (PRD 2026-09 M-5).
--
-- The card names the seller and says how much else they have for sale, which
-- is the cheapest trust signal in the product: a seller with eleven parts
-- listed reads differently from one with a single wheel. Done naively that is
-- one count query per card on every page of results.
--
-- One RPC, one round trip, for the sellers actually on the page. Rides the
-- (seller_id, status, created_at desc) index added in 20260919180000.
--
-- Idempotent.

begin;

create or replace function public.seller_active_counts(p_sellers uuid[])
returns table(seller_id uuid, total bigint)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select l.seller_id, count(*)::bigint
    from public.listings l
   where l.seller_id = any(p_sellers)
     and l.status = 'active'
   group by l.seller_id;
$$;

revoke all on function public.seller_active_counts(uuid[]) from public;
grant execute on function public.seller_active_counts(uuid[]) to anon, authenticated, service_role;

commit;
