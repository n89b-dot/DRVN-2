begin;
-- Embedded and immutable references are checked in SQL so JSON escaping cannot
-- make a referenced image look unreferenced to the garbage collector.
create or replace function public.has_embedded_media_reference(p_url text) returns boolean
language sql stable security definer set search_path=public,pg_temp as $$
 select exists(select 1 from public.car_hotspots where image_url=p_url)
 or exists(select 1 from public.dispute_evidence where url=p_url)
 or exists(select 1 from public.order_items where position(trim(both '"' from to_jsonb(p_url)::text) in commercial_snapshot::text)>0)
 or exists(select 1 from public.activity_posts where position(trim(both '"' from to_jsonb(p_url)::text) in body::text)>0);
$$;
revoke all on function public.has_embedded_media_reference(text) from public,anon,authenticated;
grant execute on function public.has_embedded_media_reference(text) to service_role;
notify pgrst,'reload schema';
commit;
