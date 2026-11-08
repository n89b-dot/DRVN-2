-- 20261108120020 — N232: after a restore, do the database's photo references
-- and Storage's objects agree?
--
-- A database restore brings back the rows that name photos and Storage's own
-- object rows (storage.objects) as they were at the recovery point; the bytes
-- live outside the database and are not rolled back. So after a restore a
-- photo deleted since the recovery point is still named, and its bytes may be
-- gone; one uploaded since is in the bucket with no row. These read-only
-- functions are the database half of the check
-- (scripts/owner/storage-reference-check.mjs, docs/production-runbook.md §6):
--
--   * storage_object_rows pages the objects Storage has rows for, so the
--     script can confirm each one's bytes through the Storage API.
--   * storage_reference_report counts references with no object, and objects
--     in member media buckets that nothing names (other than an upload still
--     staged), with samples. local-recovery-rehearsal.sh compares it before
--     and after the drill's restore.
--
-- Same identity as the media cleanup (20261107203000): '<bucket>/<decoded
-- path>' via private.media_object_key, so a reference is matched however its
-- URL is spelled. The reference list mirrors media_object_referenced, plus
-- agent chat photos (20261107220300). Nothing is changed or deleted here.

begin;

-- Every (source, bucket, path) a row names.
create or replace function private.storage_reference_rows()
returns table(source text, bucket text, path text)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with refs(source, k) as (
    select 'car_images', private.media_object_key(url) from public.car_images
    union all select 'listing_images', private.media_object_key(url) from public.listing_images
    union all select 'activity_images', private.media_object_key(url) from public.activity_images
    union all select 'order_item_snapshot_images', private.media_object_key(url) from public.order_item_snapshot_images
    union all select 'profiles.avatar_url', private.media_object_key(avatar_url) from public.profiles
    union all select 'cars.cover_image_url', private.media_object_key(cover_image_url) from public.cars
    union all select 'mod_items.image_url', private.media_object_key(image_url) from public.mod_items
    union all select 'car_hotspots.image_url', private.media_object_key(image_url) from public.car_hotspots
    -- Evidence by bare path (0027), legacy rows by URL or by bare path in url.
    union all select 'dispute_evidence', 'dispute-evidence/' || storage_path from public.dispute_evidence
      where private.media_path_ok(storage_path)
    union all select 'dispute_evidence',
      coalesce(private.media_object_key(url), case when private.media_path_ok(url) then 'dispute-evidence/' || url end)
      from public.dispute_evidence
    union all select 'messages.attachments', 'message-photos/' || a
      from public.messages m cross join lateral unnest(m.attachments) a where private.media_path_ok(a)
    union all select 'agent_messages.images', private.media_object_key(i)
      from public.agent_messages am cross join lateral unnest(am.images) i
    union all select 'order_items.commercial_snapshot', unnest(private.json_media_keys(commercial_snapshot))
      from public.order_items where strpos(commercial_snapshot::text, '/storage/v1/') > 0
    union all select 'activity_posts.body', unnest(private.json_media_keys(body))
      from public.activity_posts where strpos(body::text, '/storage/v1/') > 0
  )
  select distinct r.source, split_part(r.k, '/', 1), substr(r.k, length(split_part(r.k, '/', 1)) + 2)
    from refs r
   where r.k is not null;
$$;
revoke all on function private.storage_reference_rows() from public, anon, authenticated;

-- One keyset page of the objects Storage has rows for in a member media
-- bucket, for the script to confirm each one's bytes are really there (a
-- restored row whose bytes were deleted after the recovery point is the
-- failure only the Storage API can see).
create or replace function public.storage_object_rows(
  p_bucket text,
  p_after text default null,
  p_limit integer default 500
)
returns table(path text, created_at timestamptz)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select o.name::text, o.created_at
    from storage.objects o
   where o.bucket_id = p_bucket
     and p_bucket in ('avatars', 'car-images', 'activity-images', 'listing-images',
                      'dispute-evidence', 'message-photos', 'agent-chat-photos')
     and (p_after is null or o.name > p_after)
   order by o.name
   limit least(greatest(coalesce(p_limit, 500), 1), 1000);
$$;
revoke all on function public.storage_object_rows(text, text, integer) from public, anon, authenticated;
grant execute on function public.storage_object_rows(text, text, integer) to service_role;

-- The summary: references with no object, and member-media objects nothing
-- names. Samples are ordered, so two runs on equal data give equal reports.
create or replace function public.storage_reference_report(p_sample integer default 20)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with refs as materialized (
    select * from private.storage_reference_rows()
  ),
  keys as (
    select bucket, path, array_agg(distinct source order by source) as sources
      from refs group by bucket, path
  ),
  missing as (
    select k.* from keys k
     where not exists (select 1 from storage.objects o where o.bucket_id = k.bucket and o.name = k.path)
  ),
  unreferenced as (
    select o.bucket_id as bucket, o.name::text as path
      from storage.objects o
     where o.bucket_id in ('avatars', 'car-images', 'activity-images', 'listing-images',
                           'dispute-evidence', 'message-photos', 'agent-chat-photos')
       and not exists (select 1 from refs r where r.bucket = o.bucket_id and r.path = o.name)
       -- An upload not yet attached to anything is expected; the media
       -- cleanup reclaims it after 48 hours.
       and not exists (select 1 from public.staged_uploads s
                        where s.bucket = o.bucket_id and s.path = o.name and s.consumed_at is null)
  )
  select jsonb_build_object(
    'references', (select count(*) from keys),
    'missingObjects', (select count(*) from missing),
    'missingByBucket', coalesce((select jsonb_object_agg(bucket, n) from (select bucket, count(*) n from missing group by bucket) x), '{}'::jsonb),
    'missingSample', coalesce((select jsonb_agg(jsonb_build_object('bucket', bucket, 'path', path, 'sources', sources) order by bucket, path)
                                 from (select * from missing order by bucket, path limit least(greatest(coalesce(p_sample, 20), 0), 500)) s), '[]'::jsonb),
    'unreferencedObjects', (select count(*) from unreferenced),
    'unreferencedByBucket', coalesce((select jsonb_object_agg(bucket, n) from (select bucket, count(*) n from unreferenced group by bucket) x), '{}'::jsonb),
    'unreferencedSample', coalesce((select jsonb_agg(jsonb_build_object('bucket', bucket, 'path', path) order by bucket, path)
                                      from (select * from unreferenced order by bucket, path limit least(greatest(coalesce(p_sample, 20), 0), 500)) s), '[]'::jsonb)
  );
$$;
revoke all on function public.storage_reference_report(integer) from public, anon, authenticated;
grant execute on function public.storage_reference_report(integer) to service_role;

notify pgrst, 'reload schema';

commit;
