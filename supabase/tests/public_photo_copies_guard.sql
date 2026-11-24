-- 20261124220000_public_photo_copies.sql. Disposable database only; everything
-- is rolled back.
--
--   1. What counts as shown publicly: a public car's and a live listing's
--      photos, a published post's; never a private car's, a draft's, a post
--      on a private car, a photo in someone else's folder, or one a
--      copyright notice took down.
--   2. A copy is handed out only once it is confirmed, and its address is
--      the public bucket's, at the same path.
--   3. Hiding the car withdraws the copy in one statement: it stops being
--      handed out and the image gate refuses it. Shown again, it is allowed
--      again. A copy whose photo stopped being shown while it was being made
--      is never handed out.
--   4. A takedown refuses the copy as well as the original.
--   5. An object in a public bucket with no record is found for removal.
--   6. None of it is open to a visitor or a member.
--   7. A photo a row names whose bytes are not in storage is recorded, not
--      claimed again for a day, and forgotten once it is no longer shown.
begin;

do $$
declare
  owner uuid := gen_random_uuid();
  other uuid := gen_random_uuid();
  origin constant text := 'http://127.0.0.1:54321';
  base text;
  pub_car uuid := gen_random_uuid();
  priv_car uuid := gen_random_uuid();
  live_listing uuid;
  draft_listing uuid;
  paused_listing uuid;
  post_pub uuid;
  post_hidden uuid;
  v_notice uuid;
  n int;
  r text;
  claimed text[];
  shown text[];
begin
  insert into auth.users(id, email) values (owner, 'copies-guard-owner@example.test'), (other, 'copies-guard-other@example.test');
  insert into public.job_config(key, value) values ('media_storage_origin', origin)
    on conflict (key) do update set value = excluded.value;
  base := origin || '/storage/v1/object/public/';
  delete from public.public_photo_copies;
  delete from public.revoked_photo_copies;

  insert into public.cars(id, owner_id, slug, name, is_public, cover_image_url)
  values (pub_car, owner, 'copies-guard-public', 'Public build', true, base || 'car-images/' || owner || '/cover-public.webp'),
         (priv_car, owner, 'copies-guard-private', 'Private build', false, base || 'car-images/' || owner || '/cover-private.webp');
  insert into public.car_images(car_id, url, position) values
    (pub_car, base || 'car-images/' || owner || '/gallery-public.webp', 0),
    (priv_car, base || 'car-images/' || owner || '/gallery-private.webp', 0);

  insert into public.listings(seller_id, title, category, price_cents, shipping_cents, status, currency)
  values (owner, 'Copies guard live part', 'engine', 1000, 0, 'active', 'USD') returning id into live_listing;
  insert into public.listings(seller_id, title, category, price_cents, shipping_cents, status, currency)
  values (owner, 'Copies guard draft part', 'engine', 1000, 0, 'draft', 'USD') returning id into draft_listing;
  insert into public.listings(seller_id, title, category, price_cents, shipping_cents, status, currency)
  values (owner, 'Copies guard paused part', 'engine', 1000, 0, 'paused', 'USD') returning id into paused_listing;
  insert into public.listing_images(listing_id, url, position) values
    (live_listing, base || 'listing-images/' || owner || '/part-live.webp', 0),
    (draft_listing, base || 'listing-images/' || owner || '/part-draft.webp', 0),
    (paused_listing, base || 'listing-images/' || owner || '/part-paused.webp', 0);

  insert into public.activity_posts(author_id, car_id, title, body, published_at)
  values (owner, pub_car, 'Shown', '[]'::jsonb, now()) returning id into post_pub;
  insert into public.activity_posts(author_id, car_id, title, body, published_at)
  values (owner, priv_car, 'On a private car', '[]'::jsonb, now()) returning id into post_hidden;
  insert into public.activity_images(post_id, url, position) values
    (post_pub, base || 'activity-images/' || owner || '/post-shown.webp', 0),
    (post_hidden, base || 'activity-images/' || owner || '/post-hidden.webp', 0);

  -- 1. What is shown publicly.
  select array_agg(x.bucket || '/' || x.path order by x.bucket, x.path) into shown from private.public_photo_refs(owner) x;
  if shown is distinct from array[
       'activity-images/' || owner || '/post-shown.webp',
       'car-images/' || owner || '/cover-public.webp',
       'car-images/' || owner || '/gallery-public.webp',
       'listing-images/' || owner || '/part-live.webp',
       'listing-images/' || owner || '/part-paused.webp'] then
    raise exception 'FAIL 1a: shown publicly is not what it should be: %', shown;
  end if;
  if exists (select 1 from private.public_photo_refs(other)) then
    raise exception 'FAIL 1b: another member is credited with these photos';
  end if;
  if (select count(*) from private.public_photo_refs(null) x where x.owner_id = owner) <> 5 then
    raise exception 'FAIL 1c: asked for everyone, this member''s photos are not the same five';
  end if;
  raise notice 'PASS 1: shown publicly is a public car, a live or paused listing and a published post, in the owner''s own folder';

  -- 2. Claimed, then confirmed, then handed out.
  select array_agg(c.bucket || '/' || c.path order by c.bucket, c.path) into claimed from public.public_photo_copies_claim(owner, 50) c;
  if claimed is distinct from shown then raise exception 'FAIL 2a: the copies claimed are not the photos shown: %', claimed; end if;
  if exists (select 1 from public.public_photo_copies_claim(owner, 50)) then
    raise exception 'FAIL 2b: a second claim handed the same copies out again';
  end if;
  if exists (select 1 from public.photo_signatures_read(1, jsonb_build_array(jsonb_build_object('bucket', 'car-images', 'path', owner || '/cover-public.webp')))) then
    raise exception 'FAIL 2c: a copy still being made was handed out';
  end if;
  r := public.public_photo_copy_confirm('car-images', owner || '/cover-public.webp');
  if r <> 'live' then raise exception 'FAIL 2d: confirming a copy of a shown photo answered %', r; end if;
  if (select s.signed_url from public.photo_signatures_read(1, jsonb_build_array(
        jsonb_build_object('bucket', 'car-images', 'path', owner || '/cover-public.webp'),
        jsonb_build_object('bucket', 'car-images', 'path', owner || '/cover-private.webp'))) s)
       is distinct from origin || '/storage/v1/object/public/public-car-images/' || owner || '/cover-public.webp' then
    raise exception 'FAIL 2e: a live copy is not answered with its public address, or a private photo was';
  end if;
  raise notice 'PASS 2: a copy is handed out once confirmed, at the public bucket''s address';

  -- 3. Hiding the car withdraws its copies together with their revocation.
  perform public.public_photo_copy_confirm('car-images', owner || '/gallery-public.webp');
  update public.cars set is_public = false where id = pub_car;
  n := public.public_photo_copies_retire(owner);
  -- The cover, the gallery photo and the post on the car that is now private.
  if n <> 3 then raise exception 'FAIL 3a: hiding the car retired % copies, expected 3', n; end if;
  if exists (select 1 from public.public_photo_copies c where c.bucket in ('car-images', 'activity-images') and c.state <> 'removing') then
    raise exception 'FAIL 3b: a hidden car''s copy is not marked for removal';
  end if;
  if exists (select 1 from public.photo_signatures_read(1, jsonb_build_array(jsonb_build_object('bucket', 'car-images', 'path', owner || '/cover-public.webp')))) then
    raise exception 'FAIL 3c: a withdrawn copy is still handed out';
  end if;
  if public.media_gate_status('public-car-images/' || owner || '/cover-public.webp') <> 'revoked' then
    raise exception 'FAIL 3d: the image gate does not refuse a withdrawn copy';
  end if;
  if public.media_gate_status('public-listing-images/' || owner || '/part-live.webp') <> 'ok'
     or public.media_gate_status('car-images/' || owner || '/cover-public.webp') <> 'ok' then
    raise exception 'FAIL 3e: the image gate refuses a copy that was not withdrawn, or the original';
  end if;
  if (select count(*) from public.public_photo_copies c where c.bucket = 'listing-images' and c.state = 'copying') <> 2 then
    raise exception 'FAIL 3f: hiding a car touched a listing''s copies';
  end if;
  -- A copy withdrawn while it was being made is never confirmed.
  r := public.public_photo_copy_confirm('activity-images', owner || '/post-shown.webp');
  if r <> 'gone' then raise exception 'FAIL 3g: a copy withdrawn mid-way was confirmed (%)', r; end if;
  -- Removed, then shown again: claimed afresh, and no longer refused.
  if not public.public_photo_copy_removed('car-images', owner || '/cover-public.webp') then
    raise exception 'FAIL 3h: a removed copy''s record stayed';
  end if;
  update public.cars set is_public = true where id = pub_car;
  if not exists (select 1 from public.public_photo_copies_claim(owner, 50) c where c.path = owner || '/cover-public.webp') then
    raise exception 'FAIL 3i: a photo shown again was not claimed again';
  end if;
  r := public.public_photo_copy_confirm('car-images', owner || '/cover-public.webp');
  if r <> 'live' or public.media_gate_status('public-car-images/' || owner || '/cover-public.webp') <> 'ok' then
    raise exception 'FAIL 3j: a copy made again answered %, and the gate says %', r,
      public.media_gate_status('public-car-images/' || owner || '/cover-public.webp');
  end if;
  -- Archived while its copy was being made: confirmed as not shown.
  update public.listings set status = 'archived' where id = paused_listing;
  r := public.public_photo_copy_confirm('listing-images', owner || '/part-paused.webp');
  if r <> 'removing' or public.media_gate_status('public-listing-images/' || owner || '/part-paused.webp') <> 'revoked' then
    raise exception 'FAIL 3k: a copy whose listing was archived mid-way answered %, or is not refused', r;
  end if;
  raise notice 'PASS 3: hiding withdraws and revokes together; shown again it is allowed again';

  -- 4. A takedown refuses the copy as well as the original, and it is never claimed again.
  insert into public.copyright_notices (claimant_name, claimant_email, claimant_address, work_description, content_urls,
    good_faith, accurate_and_authorised, signature, status, resolved_at)
  values ('Pat Photographer', 'pat-copies@example.test', '1 High Street, Leeds', 'My photograph', array['https://drvn.app/x'],
    true, true, 'Pat Photographer', 'actioned', now())
  returning id into v_notice;
  insert into public.copyright_blocked_media (object_key, notice_id) values ('listing-images/' || owner || '/part-live.webp', v_notice);
  if public.media_gate_status('public-listing-images/' || owner || '/part-live.webp') <> 'copyright'
     or public.media_gate_status('listing-images/' || owner || '/part-live.webp') <> 'copyright' then
    raise exception 'FAIL 4a: a takedown does not refuse the copy and the original';
  end if;
  perform public.public_photo_copies_retire(owner);
  if (select c.state from public.public_photo_copies c where c.path = owner || '/part-live.webp') <> 'removing' then
    raise exception 'FAIL 4b: a taken-down photo''s copy was not withdrawn';
  end if;
  if exists (select 1 from private.public_photo_refs(owner) x where x.path = owner || '/part-live.webp') then
    raise exception 'FAIL 4c: a taken-down photo still counts as shown';
  end if;
  raise notice 'PASS 4: a takedown refuses and withdraws the copy too';

  -- 5. An object in a public bucket with no record.
  insert into storage.objects (bucket_id, name, created_at) values
    ('public-car-images', owner || '/orphan.webp', now() - interval '1 hour'),
    ('public-car-images', owner || '/just-written.webp', now()),
    ('public-car-images', owner || '/cover-public.webp', now() - interval '1 hour');
  select array_agg(o.bucket || '/' || o.path) into claimed from public.public_photo_copy_orphans(100) o where o.path like owner || '/%';
  if claimed is distinct from array['car-images/' || owner || '/orphan.webp'] then
    raise exception 'FAIL 5: orphans found are not exactly the old unrecorded one: %', claimed;
  end if;
  raise notice 'PASS 5: an unrecorded object in a public bucket is found; a recorded or brand new one is not';

  -- 7. A photo a row names whose bytes are not in storage.
  perform public.public_photo_copy_removed('car-images', owner || '/gallery-public.webp');
  if not exists (select 1 from public.public_photo_copies_claim(owner, 50) c where c.path = owner || '/gallery-public.webp') then
    raise exception 'FAIL 7a: the gallery photo was not claimed afresh';
  end if;
  perform public.public_photo_copy_unavailable('car-images', owner || '/gallery-public.webp');
  if (select c.state from public.public_photo_copies c where c.path = owner || '/gallery-public.webp') <> 'unavailable' then
    raise exception 'FAIL 7b: a photo with no bytes was not recorded as unavailable';
  end if;
  if exists (select 1 from public.public_photo_copies_claim(owner, 50) c where c.path = owner || '/gallery-public.webp') then
    raise exception 'FAIL 7c: a photo with no bytes was claimed again straight away';
  end if;
  if exists (select 1 from public.photo_signatures_read(1, jsonb_build_array(jsonb_build_object('bucket', 'car-images', 'path', owner || '/gallery-public.webp')))) then
    raise exception 'FAIL 7d: a copy that does not exist was handed out';
  end if;
  -- A live copy is not touched by being told its photo is unavailable.
  perform public.public_photo_copy_unavailable('car-images', owner || '/cover-public.webp');
  if (select c.state from public.public_photo_copies c where c.path = owner || '/cover-public.webp') <> 'live' then
    raise exception 'FAIL 7e: a live copy was marked unavailable';
  end if;
  -- Asked about again after a day.
  update public.public_photo_copies set updated_at = now() - interval '2 days' where path = owner || '/gallery-public.webp';
  if not exists (select 1 from public.public_photo_copies_claim(owner, 50) c where c.path = owner || '/gallery-public.webp') then
    raise exception 'FAIL 7f: an unavailable photo was not asked about again after a day';
  end if;
  if (select c.state from public.public_photo_copies c where c.path = owner || '/gallery-public.webp') <> 'copying' then
    raise exception 'FAIL 7f: an unavailable photo asked about again is not being copied';
  end if;
  -- No longer shown: there is no copy to withdraw, so the record just goes.
  perform public.public_photo_copy_unavailable('car-images', owner || '/gallery-public.webp');
  update public.cars set is_public = false where id = pub_car;
  n := public.public_photo_copies_retire(owner);
  if n <> 1 then raise exception 'FAIL 7g: hiding the car retired % copies, expected only the live cover', n; end if;
  if exists (select 1 from public.public_photo_copies c where c.path = owner || '/gallery-public.webp') then
    raise exception 'FAIL 7h: an unavailable photo''s record outlived its being shown';
  end if;
  raise notice 'PASS 7: a photo with no bytes is recorded, not claimed again for a day, and forgotten when no longer shown';

  -- 6. Not for a visitor or a member.
  if has_function_privilege('anon', 'public.public_photo_copy_unavailable(text,text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.public_photo_copy_unavailable(text,text)', 'EXECUTE') then
    raise exception 'FAIL 6a: a visitor or a member can mark a copy unavailable';
  end if;
  if has_function_privilege('anon', 'public.public_photo_copies_claim(uuid,integer)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.public_photo_copies_retire(uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.media_gate_status(text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.public_photo_copy_confirm(text,text)', 'EXECUTE')
     or has_table_privilege('anon', 'public.public_photo_copies', 'SELECT')
     or has_table_privilege('authenticated', 'public.revoked_photo_copies', 'SELECT') then
    raise exception 'FAIL 6: a visitor or a member can reach the copies'' functions or tables';
  end if;
  if not (select b.public from storage.buckets b where b.id = 'public-listing-images')
     or (select b.public from storage.buckets b where b.id = 'listing-images') then
    raise exception 'FAIL 6b: the public bucket is not public, or the member''s bucket is';
  end if;
  raise notice 'PASS 6: server only; the member''s buckets are still private';

  raise notice 'all public photo copy checks passed';
end $$;

rollback;
