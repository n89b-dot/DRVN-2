-- ============================================================================
-- 20261108160000 — member photos are private objects (N455, remediation C4)
--
-- car-images, listing-images and activity-images were public buckets, so a
-- private car's photos, a draft listing's photos and a private car's post
-- photos opened for anyone holding their URL, though the pages showing them
-- were private. From here those three buckets are private and nothing but
-- the service role reads them; the app signs a photo for a reader after the
-- row that names it was read under that reader's own row policies
-- (src/lib/supabase/photo-signing.ts). Avatars stay public.
--
-- Nothing is moved and no stored URL changes: every photo column keeps the
-- canonical /storage/v1/object/public/ spelling as the object's identity, so
-- member_media_ref_ok, the cleanup queue, the reference check, copyright
-- takedowns and the storage reference report are unchanged.
--
-- Order on a live project: deploy the app that signs photos FIRST, then apply
-- this. Applied before that app, every car, listing and post photo stops
-- loading until it ships.
--
-- Idempotent.
-- ============================================================================

begin;

update storage.buckets
   set public = false
 where id in ('car-images', 'listing-images', 'activity-images')
   and public;

-- 0001's read policy covered all four buckets; only avatars stay readable
-- by anyone. The three photo buckets get no member or visitor read policy:
-- signed URLs carry their own authorisation, and every server reader is the
-- service role.
drop policy if exists "public read media" on storage.objects;
create policy "public read media" on storage.objects for select
  using (bucket_id = 'avatars');

do $$
begin
  if exists (select 1 from storage.buckets where id in ('car-images', 'listing-images', 'activity-images') and public) then
    raise exception '20261108160000: a member photo bucket is still public';
  end if;
  if not exists (select 1 from storage.buckets where id = 'avatars' and public) then
    raise exception '20261108160000: avatars must stay public';
  end if;
end $$;

commit;
