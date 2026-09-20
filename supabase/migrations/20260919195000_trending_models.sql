-- 20260919195000 — Trending now (PRD 2026-09 E-4).
--
-- Explore's first breaker: which cars people are actually building. Counted
-- from public cars with recent published updates, so "trending" means
-- somebody has been working on one this month — not that it was popular in
-- 2019 and nobody has touched it since.
--
-- Make + model rather than individual cars: a chip that says "Nissan Silvia"
-- is a destination (it leads somewhere with a dozen builds in it), whereas a
-- chip naming one person's car is just a link with extra steps.
--
-- Deterministic ordering, because E-4 says a breaker renders only when it
-- has enough to show — a query that reshuffles would appear and disappear
-- between renders of the same page.
--
-- Idempotent.

begin;

create or replace function public.trending_models(p_days int default 45, p_limit int default 12)
returns table(make text, model text, builds bigint, updates bigint)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select
    c.make,
    c.model,
    count(distinct c.id) as builds,
    count(a.id) as updates
  from public.cars c
  join public.activity_posts a
    on a.car_id = c.id
   and a.published_at is not null
   and a.published_at > now() - make_interval(days => greatest(1, least(p_days, 365)))
  where c.is_public
    and c.make is not null
    and c.model is not null
  group by c.make, c.model
  order by count(a.id) desc, count(distinct c.id) desc, c.make, c.model
  limit greatest(1, least(p_limit, 24));
$$;

revoke all on function public.trending_models(int, int) from public;
grant execute on function public.trending_models(int, int) to anon, authenticated, service_role;

commit;
