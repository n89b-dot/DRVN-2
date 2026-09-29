-- social-17: a Trending chip opens exactly the builds it counted.
--
-- The chip linked to a free-text search for "BMW M4 Competition", which
-- matched any build mentioning BMW or M4 or Competition — a Corvette and a
-- Genesis came back for a chip that counted two M4s. trending_models
-- (20260919195000) now also returns the catalog ids of each make + model
-- group, so the chip can open Explore with the vehicle filter the Filters
-- sheet sets. Null ids (a car never matched to the catalog) keep the text
-- search as a fallback.
--
-- The return type changes, so the function is dropped and recreated.
-- Previous definition: ~/drvn-db-backups/pre-20260928182100-trending_models.sql

begin;

drop function if exists public.trending_models(int, int);

create function public.trending_models(p_days int default 45, p_limit int default 12)
returns table(make text, model text, builds bigint, updates bigint, catalog_make_id bigint, catalog_model_id bigint)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select
    c.make,
    c.model,
    count(distinct c.id) as builds,
    count(a.id) as updates,
    min(c.catalog_make_id) as catalog_make_id,
    min(c.catalog_model_id) as catalog_model_id
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
