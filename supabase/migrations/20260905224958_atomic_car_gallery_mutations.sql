begin;

-- Ownership and the complete gallery change share a transaction. Keep invoker
-- permissions so existing row-access policies apply. Upload attachment is
-- service-only because its trusted origin is verified by the server action.
create function public.edit_car_gallery(p_car uuid,p_operation text,p_payload jsonb)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare
  car public.cars;
  photo public.car_images;
  ids uuid[];
  v_url text;
  deleted_url text;
  changed integer;
  actor uuid;
begin
  actor:=case when current_user='service_role' then (p_payload->>'actor')::uuid else auth.uid() end;
  if p_operation='add' and current_user<>'service_role' then raise exception 'Uploads must be attached through the verified server action' using errcode='42501'; end if;
  if actor is null or p_car is null or p_payload is null or jsonb_typeof(p_payload)<>'object' then
    raise exception 'Invalid gallery change';
  end if;
  if current_user='service_role' then
    if not exists(select 1 from public.profiles where id=actor and suspended_at is null) then raise exception 'Account unavailable' using errcode='42501'; end if;
  end if;
  select * into car from public.cars where id=p_car and owner_id=actor for update;
  if not found then raise exception 'Car not found or unavailable' using errcode='42501'; end if;

  if p_operation='add' then
    v_url:=p_payload->>'url';
    if v_url is null or v_url !~ ('^https?://[^/]+/storage/v1/object/public/car-images/'||actor::text||'/') then
      raise exception 'Image must belong to your uploads';
    end if;
    select * into photo from public.car_images where car_id=p_car and car_images.url=v_url order by position,id limit 1;
    if not found then
      if (select count(*) from public.car_images where car_id=p_car)>=48 then raise exception 'A gallery can hold up to 48 photos'; end if;
      insert into public.car_images(car_id,url,position)
      select p_car,v_url,coalesce(max(position)+1,0) from public.car_images where car_id=p_car returning * into photo;
    end if;
    if car.cover_image_url is null then
      update public.cars set cover_image_url=photo.url where id=p_car;
      if not found then raise exception 'Gallery update was not permitted'; end if;
    end if;
  elsif p_operation='reorder' then
    if jsonb_typeof(p_payload->'ids') is distinct from 'array' then raise exception 'Image order is required'; end if;
    select coalesce(array_agg(value::uuid),'{}'::uuid[]) into ids from jsonb_array_elements_text(p_payload->'ids');
    if cardinality(ids)>48 or cardinality(ids)<>(select count(distinct value) from unnest(ids) value)
      or cardinality(ids)<>(select count(*) from public.car_images where car_id=p_car)
      or exists(select 1 from unnest(ids) item where not exists(select 1 from public.car_images where id=item and car_id=p_car)) then
      raise exception 'Gallery changed. Refresh before reordering';
    end if;
    update public.car_images i set position=ordered.ordinality-1
    from unnest(ids) with ordinality ordered(id,ordinality) where i.id=ordered.id and i.car_id=p_car;
    get diagnostics changed=row_count;
    if changed<>cardinality(ids) then raise exception 'Gallery update was not permitted'; end if;
  elsif p_operation='delete' then
    select * into photo from public.car_images where id=(p_payload->>'id')::uuid and car_id=p_car for update;
    if found then
      deleted_url:=photo.url;
      delete from public.car_images where id=photo.id and car_id=p_car;
      if not found then raise exception 'Photo deletion was not permitted'; end if;
      if car.cover_image_url=photo.url then
        update public.cars set cover_image_url=(select i.url from public.car_images i where car_id=p_car order by position,id limit 1) where id=p_car;
        if not found then raise exception 'Cover update was not permitted'; end if;
      end if;
    end if;
  elsif p_operation='cover' then
    select * into photo from public.car_images where car_id=p_car and car_images.url=p_payload->>'url' order by position,id limit 1;
    if not found then raise exception 'Choose a photo from this gallery'; end if;
    update public.cars set cover_image_url=photo.url where id=p_car;
    if not found then raise exception 'Cover update was not permitted'; end if;
  else raise exception 'Unsupported gallery change';
  end if;
  return jsonb_build_object('ok',true,'image',case when p_operation='add' then to_jsonb(photo) else null end,'deleted_url',deleted_url);
end $$;
revoke all on function public.edit_car_gallery(uuid,text,jsonb) from public,anon;
grant execute on function public.edit_car_gallery(uuid,text,jsonb) to authenticated,service_role;
notify pgrst,'reload schema';
commit;
