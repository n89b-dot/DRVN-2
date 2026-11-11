begin;
create or replace function public.marketplace_filtered_rows(p_query text default '',p_make text default '',p_model text default '',p_make_id int default 0,p_model_id int default 0,p_ymin int default 0,p_ymax int default 9999,p_fit boolean default false)
returns setof public.listings language sql stable security invoker set search_path=public,pg_temp as $$
 select l.* from public.listings l where
 (trim(p_query)='' or l.id in(select id from public.marketplace_search_rows(p_query)))
 and (p_make='' or exists(select 1 from public.cars c where c.id=l.source_car_id and
   ((p_model_id<>0 and c.catalog_model_id=p_model_id) or (p_model_id=0 and c.catalog_make_id=p_make_id) or
   (lower(c.make)=lower(p_make) and (p_model='' or lower(c.model)=lower(p_model)))))
   or exists(select 1 from public.listing_fitments f where f.listing_id=l.id and lower(f.make)=lower(p_make) and (p_model='' or lower(f.model)=lower(p_model))))
 and ((p_ymin=0 and p_ymax=9999) or exists(select 1 from public.cars c where c.id=l.source_car_id and c.year between p_ymin and p_ymax))
 and (not p_fit or exists(select 1 from public.cars g where g.owner_id=auth.uid() and g.make is not null and g.model is not null and (
   exists(select 1 from public.cars c where c.id=l.source_car_id and lower(c.make)=lower(g.make) and lower(c.model)=lower(g.model))
   or exists(select 1 from public.listing_fitments f where f.listing_id=l.id and lower(f.make)=lower(g.make) and lower(f.model)=lower(g.model) and
   (g.year is null or ((f.year_start is null or g.year>=f.year_start) and (f.year_end is null or g.year<=f.year_end)))))));
$$;
revoke all on function public.marketplace_filtered_rows(text,text,text,int,int,int,int,boolean) from public;
grant execute on function public.marketplace_filtered_rows(text,text,text,int,int,int,int,boolean) to anon,authenticated,service_role;
notify pgrst,'reload schema';
commit;
