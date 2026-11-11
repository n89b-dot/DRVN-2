-- 20261005100000 — message photos go through the server re-encode.
--
-- The composer uploaded message photos straight from the browser into the
-- private `message-photos` bucket, and the client-side re-encode passed small
-- files (and any it failed on) through untouched — EXIF, GPS and all. A photo
-- taken at home and sent in a DM handed its recipient the address.
--
-- /api/media/public-photo now accepts `message-photos`: it checks the path is
-- `<caller>/<recipient>/`, re-encodes with Sharp (which drops all metadata)
-- and writes with the service role. This makes that the only way in, the same
-- way 20260905011618 did for the public buckets: a browser credential can no
-- longer insert or overwrite an object in the bucket. Reading and deleting
-- your own message photos are unchanged.
--
-- Dispute evidence is untouched on purpose: it is kept exactly as uploaded,
-- as a record (docs/remediation-data-inventory.md).
--
-- Idempotent: drop-if-exists then create.

begin;

drop policy if exists "message photos require server normalization insert" on storage.objects;
create policy "message photos require server normalization insert" on storage.objects
  as restrictive for insert to authenticated
  with check (bucket_id <> 'message-photos');

drop policy if exists "message photos require server normalization update" on storage.objects;
create policy "message photos require server normalization update" on storage.objects
  as restrictive for update to authenticated
  using (bucket_id <> 'message-photos');

commit;
