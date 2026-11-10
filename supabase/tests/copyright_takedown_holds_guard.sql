-- 20261110120000 (report five #109, OS id N946): a takedown stays taken down.
--   H  a listing a checkout held at takedown (kept 'reserved') can't go back
--      to 'active' when that checkout fails: it is removed instead; it can
--      still be sold; a listing no notice holds goes back to active as before
--   B  a blocked object can't be attached again by a member write
--   R  a reference written after the takedown's purge but before its
--      blocklist row is purged by that row
-- Every failed check is collected and reported together at the end.
begin;

do $$
declare
  seller uuid := gen_random_uuid();
  held uuid := gen_random_uuid();
  sold_later uuid := gen_random_uuid();
  free uuid := gen_random_uuid();
  car uuid;
  v_notice uuid;
  origin text;
  photo text;
  other_photo text;
  k text;
  fails text[] := '{}';
begin
  insert into auth.users (id, email, raw_user_meta_data) values (seller, 'n946-seller@drvn.test', '{}');
  insert into public.job_config (key, value) values ('media_storage_origin', 'https://n946.supabase.co')
    on conflict (key) do update set value = excluded.value;
  insert into public.job_config (key, value) values ('payments_mode', 'stub')
    on conflict (key) do update set value = excluded.value;
  origin := 'https://n946.supabase.co/storage/v1/object/public/';
  photo := origin || 'car-images/' || seller || '/taken-down.webp';
  other_photo := origin || 'car-images/' || seller || '/fine.webp';
  k := private.media_object_key(photo);

  -- ---------- H ----------
  insert into public.listings (id, seller_id, title, category, price_cents, status) values
    (held, seller, 'N946 held part', 'performance', 10000, 'reserved'),
    (sold_later, seller, 'N946 sold part', 'performance', 10000, 'reserved'),
    (free, seller, 'N946 free part', 'performance', 10000, 'reserved');
  insert into public.copyright_notices (claimant_name, claimant_email, claimant_address, work_description, content_urls,
    good_faith, accurate_and_authorised, signature, status, resolved_at, takedown)
  values ('Pat Photographer', 'pat-n946@example.test', '1 High Street, Leeds', 'My photograph of a turbo', array['https://drvn.app/x'],
    true, true, 'Pat Photographer', 'actioned', now(),
    jsonb_build_object('removedListings', '[]'::jsonb, 'keptListingStatus', jsonb_build_array(held, sold_later)))
  returning id into v_notice;

  update public.listings set status = 'active' where id = held;
  if (select status from public.listings where id = held) <> 'removed'
     or (select removed_at from public.listings where id = held) is null then
    fails := fails || format('FAIL H1: a taken-down reserved listing went back on sale (%s) (N946)', (select status from public.listings where id = held));
  end if;
  update public.listings set status = 'sold' where id = sold_later;
  if (select status from public.listings where id = sold_later) <> 'sold' then
    fails := fails || 'FAIL H2: a taken-down reserved listing could not complete its sale (N946)'::text;
  end if;
  update public.listings set status = 'active' where id = free;
  if (select status from public.listings where id = free) <> 'active' then
    fails := fails || 'FAIL H3: a listing no notice holds could not go back on sale (N946)'::text;
  end if;

  -- ---------- R: a reference that raced the takedown is purged by the blocklist row ----------
  insert into public.cars (owner_id, slug, name, is_public) values (seller, 'n946-' || left(seller::text, 8), 'N946 car', true)
    returning id into car;
  insert into public.car_images (car_id, position, url) values (car, 0, photo), (car, 1, other_photo);
  update public.cars set cover_image_url = photo where id = car;
  insert into public.copyright_blocked_media (object_key, notice_id) values (k, v_notice);
  if exists (select 1 from public.car_images where url = photo)
     or (select cover_image_url from public.cars where id = car) is not null then
    fails := fails || 'FAIL R1: a reference written before the blocklist row survived it (N946)'::text;
  end if;
  if not exists (select 1 from public.car_images where url = other_photo) then
    fails := fails || 'FAIL R2: the blocklist row purged a photo it doesn''t name (N946)'::text;
  end if;

  -- ---------- B: a blocked object can't be attached again ----------
  if private.member_media_ref_ok(photo, seller) then
    fails := fails || 'FAIL B1: the write guard accepts a taken-down photo (N946)'::text;
  end if;
  if not private.member_media_ref_ok(other_photo, seller) then
    fails := fails || 'FAIL B2: the write guard refuses an ordinary photo (N946)'::text;
  end if;
  begin
    insert into public.car_images (car_id, position, url) values (car, 2, photo);
    fails := fails || 'FAIL B3: a taken-down photo was attached to a gallery again (N946)'::text;
  exception when others then
    null;
  end;

  if cardinality(fails) > 0 then
    raise exception '%', array_to_string(fails, E'\n');
  end if;
  raise notice 'all copyright takedown hold checks passed';
end $$;

rollback;
