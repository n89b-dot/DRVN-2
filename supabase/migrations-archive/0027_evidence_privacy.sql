-- ============================================================================
-- 0027 — Dispute evidence privacy (P0)
--
-- 0024 created 'dispute-evidence' as a PUBLIC bucket with a blanket
-- "public read dispute evidence" storage policy — any object's URL, once
-- known or guessed (uploader-uid/uuid.ext is not a secret), was viewable by
-- anyone, unauthenticated, forever. The dispute_evidence TABLE's RLS was
-- always correct (participants-only select, 0024); it's the storage layer
-- that leaked. Evidence photos can carry VINs, plates, addresses in EXIF,
-- interior shots, ids in the frame — this closes that off.
--
--  * Bucket flips to private. Existing "own folder" upload/delete policies
--    are untouched — they never depended on public read.
--  * The public-read policy is replaced with one scoped to: the uploader
--    (own folder), admins (public.is_admin(), 0018), or a participant on an
--    order that has a dispute_evidence row pointing at this exact object.
--  * dispute_evidence.storage_path is new — the object path ('{uid}/{file}'),
--    independent of however the URL column happened to be shaped. The
--    policy's EXISTS predicate matches on this column rather than parsing
--    the legacy `url` text at query time. Backfilled from `url` below.
--  * App code now mints short-lived signed URLs server-side
--    (src/lib/evidence-urls.ts) instead of rendering the old public URL —
--    this migration only fixes the database side of that.
--
-- Idempotent: safe to re-run.
-- ============================================================================

begin;

-- ============================================================
-- dispute_evidence — object path, independent of URL shape
-- ============================================================
alter table public.dispute_evidence
  add column if not exists storage_path text;

-- Backfill from the legacy public URL: everything after
-- '/object/public/dispute-evidence/' (or '/object/sign/dispute-evidence/',
-- in case a prior partial fix already re-signed some rows) is the path.
-- Few or no rows exist at 0024's age, but written for correctness either way.
update public.dispute_evidence
   set storage_path = regexp_replace(
         url,
         '^.*/storage/v1/object/(?:public|sign|authenticated)/dispute-evidence/([^?]+).*$',
         '\1'
       )
 where storage_path is null
   and url ~ '/storage/v1/object/[^/]+/dispute-evidence/';

-- Anything that didn't match the pattern above (already a bare path, or a
-- shape we don't recognize) — try it as-is if it looks like '{uid}/{file}'.
update public.dispute_evidence
   set storage_path = url
 where storage_path is null
   and url ~ '^[0-9a-f-]{36}/[^/]+\.[a-zA-Z0-9]+$';

-- ============================================================
-- Storage — bucket private, participant/uploader/admin read
-- ============================================================
update storage.buckets set public = false where id = 'dispute-evidence';

drop policy if exists "public read dispute evidence" on storage.objects;
drop policy if exists "read dispute evidence" on storage.objects;
create policy "read dispute evidence" on storage.objects for select
  using (
    bucket_id = 'dispute-evidence'
    and (
      -- own upload
      (storage.foldername(name))[1] = auth.uid()::text
      or public.is_admin()
      or exists (
        select 1
          from public.dispute_evidence de
          join public.orders o on o.id = de.order_id
         where de.storage_path = name
           and auth.uid() in (o.buyer_id, o.seller_id)
      )
    )
  );

-- Upload/delete policies are unchanged from 0024 — already scoped to the
-- uploader's own uid-named folder, which never depended on public read.

-- ============================================================
-- Self-checks
-- ============================================================
do $$
begin
  if exists (
    select 1 from storage.buckets where id = 'dispute-evidence' and public = true
  ) then
    raise exception 'SELF-CHECK FAILED: dispute-evidence bucket is still public';
  end if;

  if exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'public read dispute evidence'
  ) then
    raise exception 'SELF-CHECK FAILED: public read dispute evidence policy still exists';
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'read dispute evidence'
  ) then
    raise exception 'SELF-CHECK FAILED: read dispute evidence policy missing';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'dispute_evidence'
      and column_name = 'storage_path'
  ) then
    raise exception 'SELF-CHECK FAILED: dispute_evidence.storage_path missing';
  end if;

  raise notice 'PASS: 0027 self-checks';
end $$;

commit;
