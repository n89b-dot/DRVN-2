-- 20260919171500 — a build is searchable by what is ON it.
--
-- `search_car_ids` folds the car's modification lines into the text it
-- matches against. With removal now a state rather than a delete
-- (20260919170000), that blob would keep matching parts the car no longer
-- has: searching "Öhlins" would surface a build whose Öhlins kit came off and
-- was sold months ago, and the card would show no such mod.
--
-- Removed lines are therefore excluded here. They remain visible on the build
-- sheet under "came off this car" — findable by reading the build, which is
-- the honest place for them; they are simply not what the car IS.
--
-- Function body is otherwise byte-identical to 20260905135050's.
-- Idempotent.

begin;

create or replace function public.search_car_ids(p_query text)
returns setof uuid
language sql
stable
set search_path=public,extensions,pg_temp
as $$
  with terms as (
    select distinct t
    from regexp_split_to_table(lower(coalesce(p_query, '')), '\s+') as t
    where length(t) >= 1
  ),
  car_text as (
    select
      c.id,
      c.name,
      concat_ws(' ',
        c.name, c.make, c.model, c.year::text,
        array_to_string(c.tags, ' '),
        c.about,
        (select string_agg(concat_ws(' ', m.brand, m.product, m.part_number), ' ')
         from public.mod_items m
         where m.car_id = c.id and m.status = 'installed')
      ) as blob
    from public.cars c
    where c.is_public
  ),
  scored as (
    select
      ct.id,
      count(*) filter (
        where ct.blob ilike '%' || t.t || '%'
           or word_similarity(t.t, ct.name) >= 0.45
      ) as hits,
      bool_or(ct.name ilike '%' || t.t || '%') as name_hit,
      max(similarity(ct.name, lower(coalesce(p_query, '')))) as sim
    from car_text ct
    cross join terms t
    group by ct.id, ct.name
  )
  select id from scored
  where hits > 0
  order by hits desc, name_hit desc, sim desc, id
$$;

commit;
