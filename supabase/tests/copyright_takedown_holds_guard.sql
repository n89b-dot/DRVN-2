-- 20261110120000 (report five #109, OS id N946): a takedown stays taken down.
--   H  a listing a checkout held at takedown (kept 'reserved') can't go back
--      to 'active' when that checkout fails: it is removed instead; it can
--      still be sold; a listing no notice holds goes back to active as before
--   B  a blocked object can't be attached again, by any writer (this guard
--      writes as the database owner, not as a member)
--   R  a reference written after the takedown's purge but before its
--      blocklist row is purged by that row, a post body's included
--   M  a mention in a post's text can't pin a taken-down object for ever
--   L  a listing the takedown removed can't be restored or re-published:
--      refused, with the reason
-- Every failed check is collected and reported together at the end.
begin;

do $$
declare
  seller uuid := gen_random_uuid();
  held uuid := gen_random_uuid();
  sold_later uuid := gen_random_uuid();
  free uuid := gen_random_uuid();
  car uuid;
  post uuid := gen_random_uuid();
  gone uuid := gen_random_uuid();
  msg text;
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
    (free, seller, 'N946 free part', 'performance', 10000, 'reserved'),
    (gone, seller, 'N946 removed part', 'performance', 10000, 'removed');
  update public.listings set removed_at = now(), removed_reason = 'Copyright notice: guard' where id = gone;
  insert into public.copyright_notices (claimant_name, claimant_email, claimant_address, work_description, content_urls,
    good_faith, accurate_and_authorised, signature, status, resolved_at, takedown)
  values ('Pat Photographer', 'pat-n946@example.test', '1 High Street, Leeds', 'My photograph of a turbo', array['https://drvn.app/x'],
    true, true, 'Pat Photographer', 'actioned', now(),
    jsonb_build_object('removedListings', jsonb_build_array(gone), 'keptListingStatus', jsonb_build_array(held, sold_later)))
  returning id into v_notice;
  if not private.copyright_listing_held(gone) or not private.copyright_listing_held(held) then
    raise exception 'Fixture: the notice does not hold its listings (N946)';
  end if;

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

  -- ---------- L ----------
  begin
    update public.listings set status = 'paused', removed_at = null, removed_reason = null where id = gone;
    fails := fails || 'FAIL L1: a listing a takedown removed was restored (N946)'::text;
  exception when insufficient_privilege then
    get stacked diagnostics msg = message_text;
    if msg not like '%copyright notice%' then fails := fails || format('FAIL L2: the refusal did not say why (%s) (N946)', msg); end if;
  end;
  -- Only the takedown's own refusal passes (42501, naming the copyright
  -- notice). Any other error is a failure, not a pass (work review #157:
  -- `when others then null` passed on anything, a typo included).
  begin
    update public.listings set status = 'active' where id = gone;
    fails := fails || 'FAIL L3: a listing a takedown removed was put back on sale (N946)'::text;
  exception
    when insufficient_privilege then
      get stacked diagnostics msg = message_text;
      if msg not like '%copyright notice%' then fails := fails || format('FAIL L3b: the refusal did not say why (%s) (N946)', msg); end if;
    when others then
      get stacked diagnostics msg = message_text;
      fails := fails || format('FAIL L3c: putting it back on sale failed for another reason (%s: %s) (N946)', sqlstate, msg);
  end;

  -- ---------- R: a reference that raced the takedown is purged by the blocklist row ----------
  insert into public.cars (owner_id, slug, name, is_public) values (seller, 'n946-' || left(seller::text, 8), 'N946 car', true)
    returning id into car;
  insert into public.car_images (car_id, position, url) values (car, 0, photo), (car, 1, other_photo);
  update public.cars set cover_image_url = photo where id = car;
  insert into public.activity_posts (id, car_id, author_id, title, body, published_at) values
    (post, car, seller, 'N946 update', jsonb_build_array(
       jsonb_build_object('type', 'text', 'text', 'Fitted it'),
       jsonb_build_object('type', 'images', 'urls', jsonb_build_array(photo, other_photo)),
       jsonb_build_object('type', 'before_after', 'beforeUrl', photo, 'afterUrl', other_photo),
       jsonb_build_object('type', 'images', 'urls', jsonb_build_array(photo))), now());
  insert into public.copyright_blocked_media (object_key, notice_id) values (k, v_notice);
  if (select body from public.activity_posts where id = post) is distinct from jsonb_build_array(
       jsonb_build_object('type', 'text', 'text', 'Fitted it'),
       jsonb_build_object('type', 'images', 'urls', jsonb_build_array(other_photo))) then
    fails := fails || format('FAIL R3: a post body kept the blocked photo, or lost what it didn''t name (%s) (N946)', (select body from public.activity_posts where id = post));
  end if;
  if exists (select 1 from public.car_images where url = photo)
     or (select cover_image_url from public.cars where id = car) is not null then
    fails := fails || 'FAIL R1: a reference written before the blocklist row survived it (N946)'::text;
  end if;
  if not exists (select 1 from public.car_images where url = other_photo) then
    fails := fails || 'FAIL R2: the blocklist row purged a photo it doesn''t name (N946)'::text;
  end if;

  -- ---------- M: a mention can't pin a taken-down object ----------
  insert into public.activity_posts (car_id, author_id, title, body, published_at) values
    (car, seller, 'N946 mention', jsonb_build_array(jsonb_build_object('type', 'text', 'text', 'see ' || photo || ' and ' || other_photo)), now());
  if public.media_object_referenced('car-images', seller || '/taken-down.webp') then
    fails := fails || 'FAIL M1: a mention in a post''s text kept a taken-down photo from being deleted (N946)'::text;
  end if;
  if not public.media_object_referenced('car-images', seller || '/fine.webp') then
    fails := fails || 'FAIL M2: an ordinary photo stopped counting as referenced (N946)'::text;
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
  exception when insufficient_privilege then
    null;
  end;
  begin
    update public.profiles set avatar_url = photo where id = seller;
    fails := fails || 'FAIL B4: a taken-down photo became an avatar again (N946)'::text;
  exception when insufficient_privilege then null;
  end;
  begin
    update public.activity_posts set body = body || jsonb_build_array(jsonb_build_object('type', 'images', 'urls', jsonb_build_array(photo))) where id = post;
    fails := fails || 'FAIL B5: a taken-down photo was written into a post body again (N946)'::text;
  exception when insufficient_privilege then null;
  end;

  if cardinality(fails) > 0 then
    raise exception '%', array_to_string(fails, E'\n');
  end if;
  raise notice 'all copyright takedown hold checks passed';
end $$;

rollback;
