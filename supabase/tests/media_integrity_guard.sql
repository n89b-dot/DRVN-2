-- 20261107203000 (OS-W15): media integrity and lifecycle, attacked with
-- member credentials the way a client holding its own JWT can.
--   N12  removal claims its object under a lock with an exclusive token
--        (a second remover gets nothing, only the holder completes or
--        releases) and reference writes refuse a claimed one; staged-upload
--        registration is server-only and owner-bound; members
--        can't delete or overwrite evidence or media in Storage; dispute
--        evidence counts as "in use" by its storage path.
--   N99  the reference check compares one canonical (bucket, path), so an
--        encoded or variant URL can't make an in-use photo look unused.
--   N100 evidence uploads only into an open dispute the uploader is party to.
--   N55  a member's photo columns only take their own canonical uploads, on
--        the recorded storage origin, and none while it's unrecorded.
--   N51  deleting a car, post or listing queues its photos for cleanup,
--        including a pin's photo no longer in the gallery, as the row's real
--        owner: never another member's upload named in its text.
-- Transactional; disposable local or CI database only.
begin;
-- Hosted Supabase grants these; the CI image's storage stand-in doesn't.
-- Granted inside this rolled-back transaction so RLS is what's under test.
grant select, insert, update, delete on storage.objects to authenticated, service_role;

do $$
declare
  buyer uuid := gen_random_uuid();
  seller uuid := gen_random_uuid();
  stranger uuid := gen_random_uuid();
  dispute uuid;
  calm uuid;
  car uuid := gen_random_uuid();
  post uuid := gen_random_uuid();
  listing uuid;
  base text := 'https://proj.supabase.co/storage/v1/object/public/';
  photo text;
  evidence text;
  staged uuid;
  blocked boolean;
  n int;
  i int;
  claim jsonb;
  token_a uuid;
  token_b uuid;
begin
  insert into auth.users(id, email) values
    (buyer, 'media-guard-buyer@drvn.test'),
    (seller, 'media-guard-seller@drvn.test'),
    (stranger, 'media-guard-stranger@drvn.test');
  insert into public.orders(buyer_id, seller_id, status, subtotal_cents, platform_fee_cents, total_cents, currency)
    values (buyer, seller, 'paid', 5000, 500, 5000, 'USD') returning id into dispute;
  update public.orders set status = 'disputed' where id = dispute;
  insert into public.orders(buyer_id, seller_id, status, subtotal_cents, platform_fee_cents, total_cents, currency)
    values (buyer, seller, 'paid', 5000, 500, 5000, 'USD') returning id into calm;
  insert into public.cars(id, owner_id, slug, name, is_public) values (car, seller, 'media-guard-car', 'Media guard', true);
  photo := base || 'car-images/' || seller || '/' || car || '/photo.webp';
  insert into public.car_images(car_id, url, position) values (car, photo, 0);
  evidence := buyer || '/' || dispute || '/' || gen_random_uuid() || '.jpg';

  -- ------------------------------------------------------------------
  -- 1. N100: evidence uploads only into an open dispute, own folder, own order
  -- ------------------------------------------------------------------
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', buyer, 'role', 'authenticated')::text, true);
  insert into storage.objects(bucket_id, name, owner) values ('dispute-evidence', evidence, buyer);

  foreach photo in array array[
    buyer || '/' || gen_random_uuid() || '.jpg',                       -- no dispute named at all
    buyer || '/' || calm || '/' || gen_random_uuid() || '.jpg',         -- an order that isn't disputed
    buyer || '/' || gen_random_uuid() || '/' || gen_random_uuid() || '.jpg', -- an order that doesn't exist
    seller || '/' || dispute || '/' || gen_random_uuid() || '.jpg',     -- someone else's folder
    buyer || '/' || dispute || '/../x.jpg'                              -- not a plain file name
  ] loop
    blocked := false;
    begin
      insert into storage.objects(bucket_id, name, owner) values ('dispute-evidence', photo, buyer);
    exception when insufficient_privilege then
      blocked := sqlerrm like '%row-level security%';
    end;
    if not blocked then raise exception 'FAIL 1: evidence uploaded outside an open dispute: %', photo; end if;
  end loop;

  perform set_config('request.jwt.claims', json_build_object('sub', stranger, 'role', 'authenticated')::text, true);
  blocked := false;
  begin
    insert into storage.objects(bucket_id, name, owner)
      values ('dispute-evidence', stranger || '/' || dispute || '/' || gen_random_uuid() || '.jpg', stranger);
  exception when insufficient_privilege then
    blocked := sqlerrm like '%row-level security%';
  end;
  if not blocked then raise exception 'FAIL 1: a stranger uploaded evidence into someone else''s dispute'; end if;

  -- The 8-photo cap holds at upload too.
  perform set_config('role', 'none', true);
  for i in 1..8 loop
    insert into public.dispute_evidence(order_id, uploader_id, url, storage_path)
      values (dispute, buyer, buyer || '/' || dispute || '/cap' || i || '.jpg', buyer || '/' || dispute || '/cap' || i || '.jpg');
  end loop;
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', buyer, 'role', 'authenticated')::text, true);
  blocked := false;
  begin
    insert into storage.objects(bucket_id, name, owner)
      values ('dispute-evidence', buyer || '/' || dispute || '/' || gen_random_uuid() || '.jpg', buyer);
  exception when insufficient_privilege then
    blocked := sqlerrm like '%row-level security%';
  end;
  if not blocked then raise exception 'FAIL 1: evidence uploads ignore the 8-photo cap'; end if;
  perform set_config('role', 'none', true);
  delete from public.dispute_evidence where order_id = dispute;
  raise notice 'PASS 1: evidence uploads only into an open dispute the uploader is party to (N100)';

  -- ------------------------------------------------------------------
  -- 2. N12: members can't delete or overwrite evidence or media in Storage
  -- ------------------------------------------------------------------
  insert into storage.objects(bucket_id, name, owner)
    values ('listing-images', seller || '/sold-part.webp', seller), ('car-images', seller || '/' || car || '/photo.webp', seller);
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', buyer, 'role', 'authenticated')::text, true);
  delete from storage.objects where bucket_id = 'dispute-evidence' and name = evidence;
  update storage.objects set name = buyer || '/' || dispute || '/swapped.jpg' where bucket_id = 'dispute-evidence' and name = evidence;
  perform set_config('request.jwt.claims', json_build_object('sub', seller, 'role', 'authenticated')::text, true);
  delete from storage.objects where bucket_id in ('listing-images', 'car-images') and name like seller || '/%';
  perform set_config('role', 'none', true);
  if not exists (select 1 from storage.objects where bucket_id = 'dispute-evidence' and name = evidence) then
    raise exception 'FAIL 2: the uploader deleted or moved their dispute evidence from Storage';
  end if;
  if (select count(*) from storage.objects where bucket_id in ('listing-images', 'car-images') and name like seller || '/%') <> 2 then
    raise exception 'FAIL 2: a seller deleted their own photos straight from Storage';
  end if;
  raise notice 'PASS 2: member credentials cannot delete or overwrite evidence or media objects (N12)';

  -- ------------------------------------------------------------------
  -- 3. N12: staged-upload registration is the server's, and owner-bound
  -- ------------------------------------------------------------------
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', seller, 'role', 'authenticated')::text, true);
  blocked := false;
  begin
    -- B5: the other party registers the buyer's evidence as their own stale upload.
    insert into public.staged_uploads(owner_id, bucket, path, url)
      values (seller, 'dispute-evidence', evidence, base || 'dispute-evidence/' || evidence);
  exception when insufficient_privilege then
    blocked := true;
  end;
  if not blocked then raise exception 'FAIL 3: a member wrote a staged-upload row directly'; end if;

  perform set_config('role', 'service_role', true);
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  blocked := false;
  begin
    insert into public.staged_uploads(owner_id, bucket, path, url)
      values (seller, 'dispute-evidence', evidence, base || 'dispute-evidence/' || evidence);
  exception when insufficient_privilege then
    blocked := true;
  end;
  if not blocked then raise exception 'FAIL 3: a staged row was registered for an object outside its owner''s folder'; end if;
  blocked := false;
  begin
    insert into public.staged_uploads(owner_id, bucket, path, url)
      values (seller, 'car-images', seller || '/a.webp', base || 'car-images/' || buyer || '/a.webp');
  exception when insufficient_privilege then
    blocked := true;
  end;
  if not blocked then raise exception 'FAIL 3: a staged row''s URL named a different object from its path'; end if;
  insert into public.staged_uploads(owner_id, bucket, path, url)
    values (seller, 'car-images', seller || '/staged.webp', base || 'car-images/' || seller || '/staged.webp')
    returning id into staged;
  blocked := false;
  begin
    update public.staged_uploads set path = buyer || '/staged.webp', url = base || 'car-images/' || buyer || '/staged.webp' where id = staged;
  exception when insufficient_privilege then
    blocked := true;
  end;
  if not blocked then raise exception 'FAIL 3: a staged row was re-pointed at another object'; end if;

  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', seller, 'role', 'authenticated')::text, true);
  blocked := false;
  begin
    update public.staged_uploads set url = photo where id = staged;
  exception when insufficient_privilege then
    blocked := true;
  end;
  if not blocked then raise exception 'FAIL 3: a member rewrote a staged row''s URL'; end if;
  blocked := false;
  begin
    delete from public.staged_uploads where id = staged;
  exception when insufficient_privilege then
    blocked := true;
  end;
  if not blocked then raise exception 'FAIL 3: a member deleted a staged row directly'; end if;
  -- Positive control: finalising your own row is the one member write.
  update public.staged_uploads set consumed_at = now() where id = staged;
  perform set_config('role', 'none', true);
  if not exists (select 1 from public.staged_uploads where id = staged and consumed_at is not null) then
    raise exception 'FAIL 3: a member can no longer finalise (or deleted) their own staged row';
  end if;
  if has_function_privilege('authenticated', 'public.media_object_referenced(text,text)', 'execute')
     or has_function_privilege('anon', 'public.media_object_referenced(text,text)', 'execute') then
    raise exception 'FAIL 3: the reference check is callable by a client role';
  end if;
  raise notice 'PASS 3: staged uploads are server-registered, owner-bound and immutable (N12)';

  -- ------------------------------------------------------------------
  -- 4. N12/N99: one canonical identity; evidence and variants count as in use
  -- ------------------------------------------------------------------
  perform set_config('request.jwt.claims', '', true);
  insert into public.dispute_evidence(order_id, uploader_id, url, storage_path) values (dispute, buyer, evidence, evidence);
  if not public.media_object_referenced('dispute-evidence', evidence) then
    raise exception 'FAIL 4: attached dispute evidence reads as unreferenced';
  end if;
  if public.media_object_referenced('dispute-evidence', buyer || '/' || dispute || '/never-attached.jpg') then
    raise exception 'FAIL 4: unattached evidence reads as referenced';
  end if;
  photo := base || 'car-images/' || seller || '/' || car || '/photo.webp';
  foreach evidence in array array[
    photo,
    replace(photo, 'photo.webp', '%70hoto.webp'),
    replace(photo, 'photo.webp', 'photo%2Ewebp'),
    photo || '?download=1',
    photo || '#x',
    replace(photo, '/object/public/', '/object/sign/') || '?token=abc',
    replace(photo, '/object/public/', '/object/authenticated/'),
    replace(photo, '/storage/v1/object/public/', '/storage/v1/render/image/public/') || '?width=200',
    replace(photo, 'https://proj.supabase.co', 'https://PROJ.supabase.co')
  ] loop
    if private.media_object_key(evidence) is distinct from 'car-images/' || seller || '/' || car || '/photo.webp' then
      raise exception 'FAIL 4: % does not canonicalise to its object (got %)', evidence, private.media_object_key(evidence);
    end if;
  end loop;
  if not public.media_object_referenced('car-images', seller || '/' || car || '/photo.webp') then
    raise exception 'FAIL 4: an in-use gallery photo reads as unreferenced';
  end if;
  -- A gallery row stored with an encoded spelling still protects the object.
  update public.car_images set url = replace(photo, 'photo.webp', '%70hoto.webp') where car_id = car;
  if not public.media_object_referenced('car-images', seller || '/' || car || '/photo.webp') then
    raise exception 'FAIL 4: an encoded reference spelling hid an in-use photo';
  end if;
  update public.car_images set url = photo where car_id = car;
  foreach evidence in array array[
    replace(photo, '/photo.webp', '/%2E%2E/photo.webp'),
    replace(photo, '/photo.webp', '//photo.webp'),
    replace(photo, 'photo.webp', 'ph%zzoto.webp'),
    replace(photo, 'photo.webp', 'ph%C3oto.webp'),
    'https://proj.supabase.co/storage/v1/object/list/car-images'
  ] loop
    if private.media_object_key(evidence) is not null then
      raise exception 'FAIL 4: % names an object it should not (got %)', evidence, private.media_object_key(evidence);
    end if;
  end loop;
  if not public.media_object_referenced('car-images', seller || '/../' || seller || '/x.webp') then
    raise exception 'FAIL 4: an unnameable path read as safe to delete';
  end if;
  -- A legacy post body that alone references a photo, spelled with an
  -- escape, still keeps it (no activity_images row, no plain substring).
  insert into public.activity_posts(id, car_id, author_id, title, body, published_at)
    values (gen_random_uuid(), car, seller, 'Legacy body', jsonb_build_array(jsonb_build_object('type', 'images', 'urls',
      jsonb_build_array(base || 'car-images/' || seller || '/' || car || '/%62ody-only.webp'))), now());
  if not public.media_object_referenced('car-images', seller || '/' || car || '/body-only.webp') then
    raise exception 'FAIL 4: an escaped, body-only reference hid an in-use photo';
  end if;
  raise notice 'PASS 4: references and deletion targets share one (bucket, path) identity (N12, N99)';

  -- ------------------------------------------------------------------
  -- 5. N55: a member's photo columns only take their own canonical uploads
  -- ------------------------------------------------------------------
  -- Fail closed: with no storage origin recorded, not even the member's own
  -- canonical upload is accepted (a reference on another host saved before
  -- the origin was known would never be revalidated).
  delete from public.job_config where key = 'media_storage_origin';
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', seller, 'role', 'authenticated')::text, true);
  foreach evidence in array array[photo, 'https://attacker.example/storage/v1/object/public/avatars/' || seller || '/pixel.jpg'] loop
    blocked := false;
    begin
      update public.profiles set avatar_url = evidence where id = seller;
    exception when insufficient_privilege then
      blocked := sqlerrm like 'Photos must be your own uploads%';
    end;
    if not blocked then raise exception 'FAIL 5: % was accepted before the storage origin was recorded', evidence; end if;
  end loop;
  perform set_config('role', 'none', true);
  insert into public.job_config(key, value) values ('media_storage_origin', 'https://proj.supabase.co')
    on conflict (key) do update set value = excluded.value;
  perform set_config('role', 'authenticated', true);
  foreach evidence in array array[
    base || 'car-images/' || buyer || '/theirs.webp',                              -- another member's photo
    'https://evil.example/storage/v1/object/public/car-images/' || seller || '/a.webp', -- off our storage (SSRF bait)
    base || 'car-images/' || seller || '/a.webp?x=1',                              -- dressed-up spelling
    base || 'car-images/' || seller || '/%61.webp',                                -- encoded spelling
    base || 'dispute-evidence/' || seller || '/a.webp',                            -- a private bucket
    'http://169.254.169.254/latest/meta-data/',
    'data:image/png;base64,AAAA'
  ] loop
    blocked := false;
    begin
      update public.cars set cover_image_url = evidence where id = car;
    exception when insufficient_privilege then
      blocked := sqlerrm like 'Photos must be your own uploads%';
    end;
    if not blocked then raise exception 'FAIL 5: a car cover accepted %', evidence; end if;
    blocked := false;
    begin
      insert into public.car_images(car_id, url, position) values (car, evidence, 5);
    exception when insufficient_privilege then
      blocked := sqlerrm like 'Photos must be your own uploads%';
    end;
    if not blocked then raise exception 'FAIL 5: a car gallery accepted %', evidence; end if;
    blocked := false;
    begin
      update public.profiles set avatar_url = evidence where id = seller;
    exception when insufficient_privilege then
      blocked := sqlerrm like 'Photos must be your own uploads%';
    end;
    if not blocked then raise exception 'FAIL 5: an avatar accepted %', evidence; end if;
  end loop;
  -- Posts are written through write_activity_post as the member; both its
  -- photo list and media embedded in the body are checked.
  blocked := false;
  begin
    perform public.write_activity_post('quick', post, car, null,
      jsonb_build_array(jsonb_build_object('type', 'images', 'urls', jsonb_build_array(base || 'activity-images/' || buyer || '/x.webp'))),
      array[base || 'activity-images/' || seller || '/post.webp']);
  exception when insufficient_privilege then
    blocked := sqlerrm like 'Photos must be your own uploads%';
  end;
  if not blocked then raise exception 'FAIL 5: a post body embedded another member''s photo'; end if;
  blocked := false;
  begin
    perform public.write_activity_post('quick', post, car, null, '[]'::jsonb,
      array[base || 'activity-images/' || buyer || '/x.webp']);
  exception when insufficient_privilege then
    blocked := sqlerrm like 'Photos must be your own uploads%';
  end;
  if not blocked then raise exception 'FAIL 5: a post''s photos took another member''s upload'; end if;
  -- Positive control: the member's own canonical uploads are accepted.
  update public.cars set cover_image_url = photo where id = car;
  perform public.write_activity_post('quick', post, car, null,
    jsonb_build_array(jsonb_build_object('type', 'before_after', 'beforeUrl', base || 'activity-images/' || seller || '/before.webp', 'afterUrl', base || 'activity-images/' || seller || '/after.webp')),
    array[base || 'activity-images/' || seller || '/post.webp']);
  perform set_config('role', 'none', true);
  if not exists (select 1 from public.activity_images where post_id = post) then
    raise exception 'FAIL 5: the member''s own post photo was not saved';
  end if;
  -- Server writers are not members: the service role is unaffected.
  perform set_config('role', 'service_role', true);
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  update public.profiles set avatar_url = 'https://lh3.googleusercontent.com/a/oauth-avatar' where id = buyer;
  perform set_config('role', 'none', true);
  raise notice 'PASS 5: member photo writes take only their own canonical uploads (N55)';

  -- ------------------------------------------------------------------
  -- 6. N51: deleting a car, a post or a listing queues its photos
  -- ------------------------------------------------------------------
  perform set_config('request.jwt.claims', '', true);
  insert into public.listings(seller_id, title, category, price_cents, shipping_cents, status, currency)
    values (seller, 'Media guard part', 'engine', 5000, 500, 'draft', 'USD') returning id into listing;
  insert into public.listing_images(listing_id, url, position) values (listing, base || 'listing-images/' || seller || '/part.webp', 0);
  -- Second review: a member puts someone else's upload URL, and an
  -- off-origin URL shaped like their own, in a post's ordinary text block.
  -- Deleting the post must not queue either: cleanup acts only as the
  -- deleted row's real owner, on our own storage origin.
  insert into public.activity_posts(id, car_id, author_id, title, body, published_at)
    values (gen_random_uuid(), car, seller, 'Bait', jsonb_build_array(
      jsonb_build_object('type', 'text', 'text', base || 'car-images/' || buyer || '/victim.webp'),
      jsonb_build_object('type', 'text', 'text', 'https://evil.example/storage/v1/object/public/car-images/' || seller || '/offsite.webp')), now());
  -- Since 20261110190000 a gallery row naming someone else's upload can't
  -- exist, whoever writes it, so it can't bait the cleanup either.
  blocked := false;
  begin
    insert into public.listing_images(listing_id, url, position) values (listing, base || 'listing-images/' || buyer || '/theirs.webp', 1);
  exception when insufficient_privilege then blocked := true;
  end;
  if not blocked then raise exception 'FAIL 6: a trusted writer put another member''s upload on a listing (N940)'; end if;
  -- A pin whose photo has since left the gallery: only the hotspot names it.
  insert into public.car_hotspots(car_id, image_url, x, y, label)
    values (car, base || 'car-images/' || seller || '/' || car || '/pin.webp', 0.5, 0.5, 'Turbo');
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', seller, 'role', 'authenticated')::text, true);
  delete from public.listings where id = listing;
  delete from public.cars where id = car;
  blocked := false;
  begin
    perform 1 from public.media_cleanup_queue limit 1;
  exception when insufficient_privilege then
    blocked := true;
  end;
  if not blocked then raise exception 'FAIL 6: members can read the cleanup queue'; end if;
  perform set_config('role', 'none', true);
  for evidence in
    select unnest(array[
      'car-images/' || seller || '/' || car || '/photo.webp',
      'activity-images/' || seller || '/post.webp',
      'activity-images/' || seller || '/before.webp',
      'activity-images/' || seller || '/after.webp',
      'listing-images/' || seller || '/part.webp',
      'car-images/' || seller || '/' || car || '/pin.webp'])
  loop
    if not exists (
      select 1 from public.media_cleanup_queue q
       where q.bucket || '/' || q.path = evidence and q.owner_id = seller
    ) then
      raise exception 'FAIL 6: % was not queued for cleanup', evidence;
    end if;
  end loop;
  select count(*) into n from public.media_cleanup_queue where owner_id = seller;
  -- 6 named above plus the legacy body-only photo from check 4.
  if n <> 7 then raise exception 'FAIL 6: expected 7 queued photos, found %', n; end if;
  if exists (select 1 from public.media_cleanup_queue where owner_id = seller and (next_attempt_at > now() or attempts <> 0)) then
    raise exception 'FAIL 6: newly queued photos are not due straight away';
  end if;
  if exists (select 1 from public.media_cleanup_queue where owner_id = buyer or path like buyer || '/%' or path like seller || '/offsite%') then
    raise exception 'FAIL 6: deleting content queued another member''s upload, or one off our storage';
  end if;
  -- Fifth review: the same photo queued again while a worker holds the old
  -- request (a second listing using it is deleted) gets a fresh generation,
  -- and the worker's acknowledgement of the old one leaves it queued.
  select generation into token_a from public.media_cleanup_queue
   where bucket = 'car-images' and path = seller || '/' || car || '/photo.webp';
  insert into public.listings(seller_id, title, category, price_cents, shipping_cents, status, currency)
    values (seller, 'Reuses the car photo', 'engine', 5000, 500, 'draft', 'USD') returning id into listing;
  insert into public.listing_images(listing_id, url, position) values (listing, base || 'car-images/' || seller || '/' || car || '/photo.webp', 0);
  delete from public.listings where id = listing;
  select generation into token_b from public.media_cleanup_queue
   where bucket = 'car-images' and path = seller || '/' || car || '/photo.webp';
  if token_b is null or token_b = token_a then
    raise exception 'FAIL 6: queuing a photo again did not start a new generation';
  end if;
  delete from public.media_cleanup_queue
   where bucket = 'car-images' and path = seller || '/' || car || '/photo.webp' and generation = token_a;
  if not exists (select 1 from public.media_cleanup_queue where bucket = 'car-images' and path = seller || '/' || car || '/photo.webp') then
    raise exception 'FAIL 6: an older acknowledgement removed a request queued again meanwhile';
  end if;
  raise notice 'PASS 6: deleted content queues its photos for reference-checked removal (N51)';

  -- ------------------------------------------------------------------
  -- 7. N12: removal claims an object; reference writes refuse a claimed one
  -- ------------------------------------------------------------------
  perform set_config('request.jwt.claims', '', true);
  evidence := buyer || '/' || dispute || '/' || gen_random_uuid() || '.jpg';
  claim := public.claim_media_deletion('dispute-evidence', evidence);
  if claim ->> 'status' <> 'claimed' or claim ->> 'token' is null then
    raise exception 'FAIL 7: an unattached evidence upload could not be claimed (got %)', claim;
  end if;
  token_a := (claim ->> 'token')::uuid;
  if not exists (select 1 from pg_locks where locktype = 'advisory' and pid = pg_backend_pid() and granted) then
    raise exception 'FAIL 7: the claim took no per-object lock';
  end if;
  -- Second review: a second remover (the after-delete run overlapping the
  -- daily job) gets no claim, so it can neither delete nor release.
  claim := public.claim_media_deletion('dispute-evidence', evidence);
  if claim ->> 'status' <> 'busy' or claim ? 'token' then
    raise exception 'FAIL 7: a second remover was handed the same object (got %)', claim;
  end if;
  if public.release_media_claim('dispute-evidence', evidence, gen_random_uuid())
     or public.complete_media_deletion('dispute-evidence', evidence, gen_random_uuid()) then
    raise exception 'FAIL 7: a token that does not hold the claim released or completed it';
  end if;
  if not exists (select 1 from private.media_deletion_claims where bucket = 'dispute-evidence' and path = evidence and token = token_a and state = 'active') then
    raise exception 'FAIL 7: the holder lost its claim to another remover';
  end if;
  -- The race: GC holds the claim, then addDisputeEvidence (service role) attaches it.
  perform set_config('role', 'service_role', true);
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  blocked := false;
  begin
    insert into public.dispute_evidence(order_id, uploader_id, url, storage_path) values (dispute, buyer, evidence, evidence);
  exception when object_not_in_prerequisite_state then
    blocked := sqlerrm like '%removed from storage%';
  end;
  if not blocked then raise exception 'FAIL 7: evidence claimed for deletion was attached anyway'; end if;
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
  -- A member adopting a claimed upload into a photo column is refused too.
  claim := public.claim_media_deletion('avatars', seller || '/claimed.webp');
  if claim ->> 'status' <> 'claimed' then
    raise exception 'FAIL 7: an unreferenced avatar could not be claimed';
  end if;
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', seller, 'role', 'authenticated')::text, true);
  blocked := false;
  begin
    update public.profiles set avatar_url = base || 'avatars/' || seller || '/claimed.webp' where id = seller;
  exception when object_not_in_prerequisite_state then
    blocked := true;
  end;
  if not blocked then raise exception 'FAIL 7: a member adopted an upload claimed for deletion'; end if;
  blocked := false;
  begin
    perform public.claim_media_deletion('avatars', seller || '/other.webp');
  exception when insufficient_privilege then
    blocked := true;
  end;
  if not blocked then raise exception 'FAIL 7: a member can claim objects for deletion'; end if;
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
  -- The other order: attached first, then the claim sees it and refuses.
  photo := buyer || '/' || dispute || '/' || gen_random_uuid() || '.jpg';
  insert into public.dispute_evidence(order_id, uploader_id, url, storage_path) values (dispute, buyer, photo, photo);
  if public.claim_media_deletion('dispute-evidence', photo) ->> 'status' <> 'referenced' then
    raise exception 'FAIL 7: attached evidence was claimed for deletion';
  end if;
  if exists (select 1 from private.media_deletion_claims where bucket = 'dispute-evidence' and path = photo) then
    raise exception 'FAIL 7: a refused claim left a claim behind';
  end if;
  -- The holder's failed Storage delete releases its claim; the object can be
  -- used again, and a later remover then sees the reference.
  if not public.release_media_claim('dispute-evidence', evidence, token_a) then
    raise exception 'FAIL 7: the holder could not release its own claim';
  end if;
  insert into public.dispute_evidence(order_id, uploader_id, url, storage_path) values (dispute, buyer, evidence, evidence);
  if public.claim_media_deletion('dispute-evidence', evidence) ->> 'status' <> 'referenced' then
    raise exception 'FAIL 7: a late remover was handed attached evidence';
  end if;
  -- A completed claim is a tombstone: no second delete, no later adoption.
  photo := seller || '/done.webp';
  token_a := (public.claim_media_deletion('car-images', photo) ->> 'token')::uuid;
  if not public.complete_media_deletion('car-images', photo, token_a) then
    raise exception 'FAIL 7: the holder could not complete its claim';
  end if;
  if public.claim_media_deletion('car-images', photo) ->> 'status' <> 'gone'
     or public.release_media_claim('car-images', photo, token_a) then
    raise exception 'FAIL 7: a completed deletion could be claimed again or released';
  end if;
  -- A holder that died mid-delete: past the 10-minute lease another remover
  -- takes over with a new token, and the old token can do nothing.
  photo := seller || '/stale.webp';
  token_a := (public.claim_media_deletion('car-images', photo) ->> 'token')::uuid;
  update private.media_deletion_claims set claimed_at = now() - interval '11 minutes' where bucket = 'car-images' and path = photo;
  claim := public.claim_media_deletion('car-images', photo);
  token_b := (claim ->> 'token')::uuid;
  if claim ->> 'status' <> 'claimed' or token_b = token_a then
    raise exception 'FAIL 7: an expired claim was not taken over with a new token (got %)', claim;
  end if;
  if public.release_media_claim('car-images', photo, token_a) or public.complete_media_deletion('car-images', photo, token_a) then
    raise exception 'FAIL 7: an expired token still controlled the claim';
  end if;
  -- Fourth review: the old holder may have deleted it, so the takeover is
  -- uncertain, and an uncertain claim is never released, even by its holder.
  if not (claim ->> 'maybe_deleted')::boolean
     or not exists (select 1 from private.media_deletion_claims where bucket = 'car-images' and path = photo and maybe_deleted) then
    raise exception 'FAIL 7: a lease takeover did not record that the object may be gone';
  end if;
  if public.release_media_claim('car-images', photo, token_b) then
    raise exception 'FAIL 7: an uncertain claim was released after a takeover';
  end if;
  if not public.complete_media_deletion('car-images', photo, token_b) then
    raise exception 'FAIL 7: the new holder could not complete a confirmed delete';
  end if;
  -- An unknown outcome recorded by the holder sticks the same way.
  photo := seller || '/unknown.webp';
  claim := public.claim_media_deletion('car-images', photo);
  token_a := (claim ->> 'token')::uuid;
  if (claim ->> 'maybe_deleted')::boolean then
    raise exception 'FAIL 7: a fresh claim started out uncertain';
  end if;
  if not public.mark_media_deletion_uncertain('car-images', photo, token_a)
     or public.mark_media_deletion_uncertain('car-images', photo, gen_random_uuid()) then
    raise exception 'FAIL 7: only the holder may record an unknown outcome';
  end if;
  if public.release_media_claim('car-images', photo, token_a) then
    raise exception 'FAIL 7: a claim with an unknown outcome was released';
  end if;
  if has_function_privilege('authenticated', 'public.claim_media_deletion(text,text)', 'execute')
     or has_function_privilege('anon', 'public.release_media_claim(text,text,uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.complete_media_deletion(text,text,uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.mark_media_deletion_uncertain(text,text,uuid)', 'execute') then
    raise exception 'FAIL 7: claims are callable by a client role';
  end if;
  raise notice 'PASS 7: one remover holds an object''s claim by token; reference writes refuse a claimed object (N12 race)';

  raise notice 'all media integrity checks passed';
end $$;

rollback;
