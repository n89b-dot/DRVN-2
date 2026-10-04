-- 20261004160000 — a car's VIN is its owner's, not the public's.
--
-- cars was readable column-for-column by anyone who could see the row, so a
-- public build's VIN (never shown on a page) could be read straight from the
-- API by a signed-out caller — enough to clone a vehicle's identity onto
-- another car. Row-level security can't hide one column, so this uses column
-- privileges, the same way profiles hides its Stripe and email columns:
--   * SELECT on cars is granted column by column, every column but vin;
--   * my_car_vin(car) returns the VIN to the car's owner and nobody else;
--   * edit_car_gallery read the whole row (select *) and now names columns;
--   * explore_build_rows returned whole rows (select c.*) and now returns
--     them with vin null.
-- A column added to cars later is not readable by clients until it is
-- granted here deliberately; car_vin_privacy_guard.sql checks the set.
-- INSERT/UPDATE privileges are unchanged: owners still write their VIN.
-- Idempotent.

begin;

revoke select on public.cars from anon, authenticated;
grant select (id, owner_id, slug, name, make, model, year, color, about, tags, cover_image_url, is_public, created_at, updated_at, trim, engine, drivetrain, body_class, vin_decoded_at, catalog_make_id, catalog_model_id, identity_source, cover_focal_x, cover_focal_y) on public.cars to anon, authenticated;

create or replace function public.my_car_vin(p_car uuid)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select c.vin from public.cars c where c.id = p_car and c.owner_id = auth.uid();
$$;

revoke all on function public.my_car_vin(uuid) from public, anon;
grant execute on function public.my_car_vin(uuid) to authenticated;

CREATE OR REPLACE FUNCTION public.edit_car_gallery(p_car uuid, p_operation text, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
  -- Named columns: the caller may not read every column of cars (vin, 20261004160000).
  select c.id, c.owner_id, c.cover_image_url into car.id, car.owner_id, car.cover_image_url
  from public.cars c where c.id=p_car and c.owner_id=actor for update;
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
end $function$;

-- Explore's free-text build search returns whole cars rows to its caller
-- (setof public.cars, select c.*), which now needs a column the caller can't
-- read. Same rows, same order, vin always null: callers select id and
-- created_at, and a VIN was never meant to leave this way.
create or replace function public.explore_build_rows(p_query text) returns setof public.cars
language sql stable security invoker set search_path=public,extensions,pg_temp as $$
 select c.id, c.owner_id, c.slug, c.name, c.make, c.model, c.year, c.color, c.about, c.tags,
        c.cover_image_url, c.is_public, c.created_at, c.updated_at, null::text as vin, c.trim,
        c.engine, c.drivetrain, c.body_class, c.vin_decoded_at, c.catalog_make_id, c.catalog_model_id,
        c.identity_source, c.cover_focal_x, c.cover_focal_y
 from public.search_car_ids(p_query) with ordinality ranked(id,rank)
 join public.cars c on c.id=ranked.id where c.is_public order by ranked.rank,c.id;
$$;

notify pgrst, 'reload schema';

commit;
