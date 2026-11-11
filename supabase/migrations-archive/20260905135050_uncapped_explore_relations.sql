begin;
-- Keep word-wise relevance while filtering and paginating the complete relation.
create or replace function public.explore_build_rows(p_query text) returns setof public.cars
language sql stable security invoker set search_path=public,extensions,pg_temp as $$
 select c.* from public.search_car_ids(p_query) with ordinality ranked(id,rank)
 join public.cars c on c.id=ranked.id where c.is_public order by ranked.rank,c.id;
$$;
create or replace function public.explore_update_rows(p_query text default '',p_make text default '',p_model text default '',p_make_id int default 0,p_model_id int default 0,p_ymin int default 0,p_ymax int default 9999)
returns setof public.activity_posts language sql stable security invoker set search_path=public,extensions,pg_temp as $$
 with ranked as (select id,rank from public.search_update_ids(p_query) with ordinality r(id,rank))
 select p.* from public.activity_posts p join public.cars c on c.id=p.car_id left join ranked r on r.id=p.id
 where c.is_public and p.published_at is not null and (trim(p_query)='' or r.id is not null)
 and (p_make='' or (p_model_id<>0 and c.catalog_model_id=p_model_id) or (p_model_id=0 and c.catalog_make_id=p_make_id) or (lower(c.make)=lower(p_make) and (p_model='' or lower(c.model)=lower(p_model))))
 and ((p_ymin=0 and p_ymax=9999) or c.year between p_ymin and p_ymax)
 order by r.rank,p.published_at desc,p.id;
$$;
revoke all on function public.explore_build_rows(text),public.explore_update_rows(text,text,text,int,int,int,int) from public;
grant execute on function public.explore_build_rows(text),public.explore_update_rows(text,text,text,int,int,int,int) to anon,authenticated,service_role;
-- Deterministic ties are essential when several result pages have equal relevance.
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
         from public.mod_items m where m.car_id = c.id)
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

create or replace function public.search_update_ids(p_query text)
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
  post_text as (
    select
      p.id,
      p.title,
      p.published_at,
      concat_ws(' ',
        p.title, p.intro, p.search_text,
        c.name, c.make, c.model, c.year::text
      ) as blob
    from public.activity_posts p
    join public.cars c on c.id = p.car_id
    where p.published_at is not null
      and c.is_public
  ),
  scored as (
    select
      pt.id,
      pt.published_at,
      count(*) filter (
        where pt.blob ilike '%' || t.t || '%'
           or word_similarity(t.t, pt.title) >= 0.45
      ) as hits,
      bool_or(pt.title ilike '%' || t.t || '%') as title_hit,
      max(similarity(pt.title, lower(coalesce(p_query, '')))) as sim
    from post_text pt
    cross join terms t
    group by pt.id, pt.title, pt.published_at
  )
  select id from scored
  where hits > 0
  order by hits desc, title_hit desc, sim desc, published_at desc, id
$$;

notify pgrst,'reload schema';
commit;
