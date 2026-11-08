-- 20261108160000 (N455): car, listing and post photos are private objects.
--   1. The three photo buckets are private; avatars stay public.
--   2. No visitor or member can read a photo object through storage policies;
--      an avatar still reads.
--   3. Stored references are unchanged: a canonical public-route URL is still
--      the one spelling a member's photo column accepts, and a signed URL
--      names the same object, so cleanup, takedowns and the reference report
--      need no change.
-- Transactional; disposable local or CI database only.
begin;

-- Hosted Supabase grants client roles the storage tables and lets row
-- security decide; the test image doesn't, so grant them here (rolled back)
-- to test the policies a visitor and a member really meet.
grant usage on schema storage to anon, authenticated;
grant select, insert, update, delete on storage.objects to anon, authenticated;

do $$
declare
  v_member uuid := gen_random_uuid();
  v_seen integer;
  v_canonical text;
begin
  -- 1. Buckets.
  if exists (select 1 from storage.buckets where id in ('car-images', 'listing-images', 'activity-images') and public) then
    raise exception 'FAIL 1: a member photo bucket is still public (N455)';
  end if;
  if not exists (select 1 from storage.buckets where id = 'avatars' and public) then
    raise exception 'FAIL 1b: avatars are no longer public (N455)';
  end if;

  -- 2. Storage reads under the visitor's and the member's own roles.
  insert into auth.users (id, email) values (v_member, 'private-photos@drvn.test');
  insert into storage.objects (bucket_id, name, owner) values
    ('car-images', v_member || '/private-car.webp', v_member),
    ('listing-images', v_member || '/draft.webp', v_member),
    ('activity-images', v_member || '/post.webp', v_member),
    ('avatars', v_member || '/me.webp', v_member);

  perform set_config('role', 'anon', true);
  select count(*) into v_seen from storage.objects where name like v_member || '/%' and bucket_id <> 'avatars';
  perform set_config('role', 'none', true);
  if v_seen <> 0 then raise exception 'FAIL 2: a visitor can read % member photo objects (N455)', v_seen; end if;

  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_member, 'role', 'authenticated')::text, true);
  select count(*) into v_seen from storage.objects where name like v_member || '/%' and bucket_id <> 'avatars';
  if v_seen <> 0 then raise exception 'FAIL 3: a member can read % photo objects directly, signed URLs bypassed (N455)', v_seen; end if;
  select count(*) into v_seen from storage.objects where name = v_member || '/me.webp' and bucket_id = 'avatars';
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
  if v_seen <> 1 then raise exception 'FAIL 4: an avatar is no longer readable (N455)'; end if;

  -- 3. References keep their canonical spelling and identity.
  delete from public.job_config where key = 'media_storage_origin';
  insert into public.job_config (key, value) values ('media_storage_origin', 'https://proj.supabase.co');
  v_canonical := 'https://proj.supabase.co/storage/v1/object/public/car-images/' || v_member || '/private-car.webp';
  if not private.member_media_ref_ok(v_canonical, v_member) then
    raise exception 'FAIL 5: a canonical member photo URL is no longer accepted (N455)';
  end if;
  if private.member_media_ref_ok('https://proj.supabase.co/storage/v1/object/sign/car-images/' || v_member || '/private-car.webp?token=x', v_member) then
    raise exception 'FAIL 6: a signed URL was accepted as a stored reference; only the canonical spelling may be stored (N455)';
  end if;
  if private.media_object_key('https://proj.supabase.co/storage/v1/object/sign/car-images/' || v_member || '/private-car.webp?token=x')
     is distinct from private.media_object_key(v_canonical) then
    raise exception 'FAIL 7: a signed URL names a different object than its canonical URL (N455)';
  end if;

  raise notice 'all member photo privacy checks passed';
end $$;

rollback;
