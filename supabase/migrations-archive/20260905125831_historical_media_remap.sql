begin;
create or replace function public.remap_public_media(p_old text,p_new text) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare changed int:=0; n int;
begin
 if p_old=p_new or length(p_old)>2000 or length(p_new)>2000 or position('/storage/v1/object/public/' in p_old)=0 or split_part(p_old,'/storage/v1/object/public/',1)<>split_part(p_new,'/storage/v1/object/public/',1) then raise exception 'Invalid media remap'; end if;
 -- Immutable financial evidence and embedded content require explicit review.
 if exists(select 1 from public.order_item_snapshot_images where url=p_old)
 or exists(select 1 from public.dispute_evidence where url=p_old)
 or exists(select 1 from public.order_items where position(p_old in commercial_snapshot::text)>0)
 or exists(select 1 from public.activity_posts where position(p_old in body::text)>0) then return jsonb_build_object('outcome','retained_for_review'); end if;
 update public.car_images set url=p_new where url=p_old; get diagnostics n=row_count; changed:=changed+n;
 update public.listing_images set url=p_new where url=p_old; get diagnostics n=row_count; changed:=changed+n;
 update public.activity_images set url=p_new where url=p_old; get diagnostics n=row_count; changed:=changed+n;
 update public.profiles set avatar_url=p_new where avatar_url=p_old; get diagnostics n=row_count; changed:=changed+n;
 update public.cars set cover_image_url=p_new where cover_image_url=p_old; get diagnostics n=row_count; changed:=changed+n;
 update public.car_hotspots set image_url=p_new where image_url=p_old; get diagnostics n=row_count; changed:=changed+n;
 update public.staged_uploads set consumed_at=coalesce(consumed_at,now()) where url=p_old;
 return jsonb_build_object('outcome','remapped','references',changed);
end $$;
revoke all on function public.remap_public_media(text,text) from public,anon,authenticated;
grant execute on function public.remap_public_media(text,text) to service_role;
notify pgrst,'reload schema';
commit;
