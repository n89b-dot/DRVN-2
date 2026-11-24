-- ============================================================================
-- 20261124220000 — published photos get a public copy
--
-- Member photos are private objects (20261108160000, N455): a private car's
-- and a draft listing's photos must not open for anyone holding the link.
-- That stays exactly as it is. But a published photo was served the same
-- way, through a link signed for an hour, so its address changed every hour:
-- the image optimiser re-encoded every viewed photo every hour, and no cache
-- could keep one.
--
-- Nothing a row stores changes. A photo that something public shows gets a
-- COPY in a public bucket at the same path, and a registry says which copies
-- are ready. The read path hands out the copy's stable address where there
-- is one, and signs as before where there is not.
--
--   * Buckets public-car-images, public-listing-images,
--     public-activity-images: public to read, written by the server only.
--   * public.public_photo_copies: one row per copy. 'copying' while the
--     server makes it, 'live' once it is there and the photo is still shown
--     publicly, 'removing' from the moment it is not.
--   * public.revoked_photo_copies: a copy that was withdrawn, for a little
--     over a day, which is how long a resized copy of it can be kept.
--   * private.public_photo_refs: what "shown publicly" means. A photo of a
--     listing that is active, reserved, sold or paused; of a car that is
--     public; of a published post on no car or a public one. Only a photo in
--     its owner's own folder, and never one a copyright notice took down.
--   * public.public_photo_copies_claim / _confirm / _retire / _removed /
--     _unavailable / public.public_photo_copy_orphans: the steps the media
--     job runs. A photo a row names whose bytes are not in storage is
--     recorded 'unavailable', so it is not asked about on every run.
--     Retiring is one statement, so withdrawing a copy and revoking it
--     happen together.
--   * public.photo_signatures_read: also answers with the copy's address for
--     a photo whose copy is live. The signer already asks it first.
--   * public.media_gate_status: the image gate's one question. Is this
--     object under a copyright takedown (a copy is asked about as its
--     original too), or a withdrawn copy, or neither.
--   * drvn-media-gc runs every ten minutes, not nightly: it is what withdraws
--     and makes copies, so a hidden photo's copy is gone within minutes.
--
-- A photo whose copy is not made yet, or never is, is still signed and shown
-- exactly as today: nothing depends on the copy existing. No row is changed.
-- ============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('public-car-images', 'public-car-images', true, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/gif']::text[]),
  ('public-listing-images', 'public-listing-images', true, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/gif']::text[]),
  ('public-activity-images', 'public-activity-images', true, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/gif']::text[])
on conflict (id) do nothing;

create table public.public_photo_copies (
  bucket text not null,
  path text not null,
  owner_id uuid not null,
  state text not null default 'copying',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint public_photo_copies_pkey primary key (bucket, path),
  constraint public_photo_copies_bucket_check check (bucket in ('car-images', 'listing-images', 'activity-images')),
  constraint public_photo_copies_path_check check (length(path) between 3 and 512 and path ~ '^[A-Za-z0-9][A-Za-z0-9/_.-]+$' and path !~ '//' and path !~ '(^|/)\.{1,2}(/|$)'),
  constraint public_photo_copies_state_check check (state in ('copying', 'live', 'removing', 'unavailable'))
);
comment on table public.public_photo_copies is 'A member photo that has a copy in its public bucket (public-<bucket>, same path), because something public shows it. bucket is the member''s private bucket. state unavailable: a row names the photo but its bytes are not in storage, so there is no copy. Service role only (20261124220000).';
create index public_photo_copies_pending_idx on public.public_photo_copies (state, updated_at) where state <> 'live';
create index public_photo_copies_owner_idx on public.public_photo_copies (owner_id);
alter table public.public_photo_copies enable row level security;
revoke all on table public.public_photo_copies from anon, authenticated;
grant all on table public.public_photo_copies to service_role;

create table public.revoked_photo_copies (
  object_key text not null,
  revoked_at timestamptz not null default now(),
  expires_at timestamptz not null,
  constraint revoked_photo_copies_pkey primary key (object_key),
  constraint revoked_photo_copies_key_check check (position('/' in object_key) > 1)
);
comment on table public.revoked_photo_copies is 'Public copies that were withdrawn (''public-<bucket>/<path>''), kept a little over a day: the image gate refuses a resized copy of one for as long as one can exist. Service role only (20261124220000).';
alter table public.revoked_photo_copies enable row level security;
revoke all on table public.revoked_photo_copies from anon, authenticated;
grant all on table public.revoked_photo_copies to service_role;

CREATE FUNCTION private.public_photo_refs(p_owner uuid DEFAULT NULL::uuid)
 RETURNS TABLE(bucket text, path text, owner_id uuid)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  with shown(k, owner) as (
    -- A part for sale, held, sold or paused. Paused keeps its copy: pausing
    -- is meant to be undone.
    select private.media_object_key(li.url), l.seller_id
      from public.listing_images li join public.listings l on l.id = li.listing_id
     where l.status in ('active', 'reserved', 'sold', 'paused') and (p_owner is null or l.seller_id = p_owner)
    -- A public car: its cover, gallery, pins and the parts on its sheet.
    union all select private.media_object_key(c.cover_image_url), c.owner_id
      from public.cars c where c.is_public and (p_owner is null or c.owner_id = p_owner)
    union all select private.media_object_key(ci.url), c.owner_id
      from public.car_images ci join public.cars c on c.id = ci.car_id
     where c.is_public and (p_owner is null or c.owner_id = p_owner)
    union all select private.media_object_key(h.image_url), c.owner_id
      from public.car_hotspots h join public.cars c on c.id = h.car_id
     where c.is_public and (p_owner is null or c.owner_id = p_owner)
    union all select private.media_object_key(m.image_url), c.owner_id
      from public.mod_items m join public.cars c on c.id = m.car_id
     where c.is_public and (p_owner is null or c.owner_id = p_owner)
    -- A published post, on no car or on a public one (activity_post_visible).
    union all select private.media_object_key(ai.url), p.author_id
      from public.activity_images ai
      join public.activity_posts p on p.id = ai.post_id
      left join public.cars c on c.id = p.car_id
     where p.published_at is not null and (p.car_id is null or c.is_public) and (p_owner is null or p.author_id = p_owner)
    union all select unnest(private.json_media_keys(p.body)), p.author_id
      from public.activity_posts p
      left join public.cars c on c.id = p.car_id
     where p.published_at is not null and (p.car_id is null or c.is_public) and (p_owner is null or p.author_id = p_owner)
       and strpos(p.body::text, '/storage/v1/') > 0
  )
  select distinct split_part(s.k, '/', 1), substr(s.k, length(split_part(s.k, '/', 1)) + 2), s.owner
    from shown s
   where s.k is not null
     and split_part(s.k, '/', 1) in ('car-images', 'listing-images', 'activity-images')
     -- Only a photo in its owner's own folder is copied on their account.
     and split_part(s.k, '/', 2) = s.owner::text
     -- A path the copy's address can carry as it is.
     and substr(s.k, length(split_part(s.k, '/', 1)) + 2) ~ '^[A-Za-z0-9][A-Za-z0-9/_.-]+$'
     -- Taken down means no copy, ever.
     and not exists (select 1 from public.copyright_blocked_media b where b.object_key = s.k);
$function$;

CREATE FUNCTION public.public_photo_copies_claim(p_owner uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 50)
 RETURNS TABLE(bucket text, path text)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  with wanted as (
    select r.bucket, r.path, r.owner_id
      from private.public_photo_refs(p_owner) r
     where not exists (select 1 from public.public_photo_copies c where c.bucket = r.bucket and c.path = r.path)
     order by r.bucket, r.path
     limit greatest(least(coalesce(p_limit, 50), 500), 1)
  ),
  added as (
    insert into public.public_photo_copies (bucket, path, owner_id)
    select w.bucket, w.path, w.owner_id from wanted w
    on conflict on constraint public_photo_copies_pkey do nothing
    returning public_photo_copies.bucket, public_photo_copies.path
  ),
  -- A copy that was started and never finished (the server stopped, or
  -- Storage refused it) is handed out again after ten minutes. A photo whose
  -- bytes were not there is asked about again once a day, in case the answer
  -- was wrong. Bounded like the rest, oldest first.
  again as (
    select c.bucket, c.path
      from public.public_photo_copies c
     where ((c.state = 'copying' and c.updated_at < now() - interval '10 minutes')
         or (c.state = 'unavailable' and c.updated_at < now() - interval '1 day'))
       and (p_owner is null or c.owner_id = p_owner)
     order by c.updated_at
     limit greatest(least(coalesce(p_limit, 50), 500), 1)
       for update skip locked
  ),
  stuck as (
    update public.public_photo_copies c
       set state = 'copying', updated_at = now()
      from again a
     where c.bucket = a.bucket and c.path = a.path
    returning c.bucket, c.path
  )
  select a.bucket, a.path from added a
  union all
  select s.bucket, s.path from stuck s;
$function$;

CREATE FUNCTION public.public_photo_copy_confirm(p_bucket text, p_path text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_owner uuid;
begin
  select c.owner_id into v_owner from public.public_photo_copies c
   where c.bucket = p_bucket and c.path = p_path and c.state = 'copying' for update;
  if not found then
    -- Withdrawn while it was being made: the caller removes what it wrote.
    return 'gone';
  end if;
  if exists (select 1 from private.public_photo_refs(v_owner) r where r.bucket = p_bucket and r.path = p_path) then
    update public.public_photo_copies set state = 'live', updated_at = now() where bucket = p_bucket and path = p_path;
    -- Shown again: a copy withdrawn earlier today is no longer refused.
    delete from public.revoked_photo_copies where object_key = 'public-' || p_bucket || '/' || p_path;
    return 'live';
  end if;
  -- No longer shown publicly by the time the copy was made.
  update public.public_photo_copies set state = 'removing', updated_at = now() where bucket = p_bucket and path = p_path;
  insert into public.revoked_photo_copies (object_key, expires_at)
  values ('public-' || p_bucket || '/' || p_path, now() + interval '25 hours')
  on conflict (object_key) do update set revoked_at = now(), expires_at = excluded.expires_at;
  return 'removing';
end;
$function$;

CREATE FUNCTION public.public_photo_copies_retire(p_owner uuid DEFAULT NULL::uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_retired integer;
begin
  -- One statement: the copy stops being handed out and is revoked together.
  with shown as materialized (
    select r.bucket, r.path from private.public_photo_refs(p_owner) r
  ),
  gone as (
    update public.public_photo_copies c
       set state = 'removing', updated_at = now()
     where c.state in ('copying', 'live')
       and (p_owner is null or c.owner_id = p_owner)
       and not exists (select 1 from shown s where s.bucket = c.bucket and s.path = c.path)
    returning c.bucket, c.path
  ),
  revoked as (
    insert into public.revoked_photo_copies (object_key, expires_at)
    select 'public-' || g.bucket || '/' || g.path, now() + interval '25 hours' from gone g
    on conflict (object_key) do update set revoked_at = now(), expires_at = excluded.expires_at
    returning 1
  ),
  -- A photo that never had a copy (its bytes were not there) and is no
  -- longer shown: nothing to withdraw, so its record just goes.
  forgotten as (
    delete from public.public_photo_copies c
     where c.state = 'unavailable'
       and (p_owner is null or c.owner_id = p_owner)
       and not exists (select 1 from shown s where s.bucket = c.bucket and s.path = c.path)
    returning 1
  )
  select (select count(*) from gone) into v_retired
    from (select count(*) from revoked) r, (select count(*) from forgotten) f;
  -- A resized copy cannot outlive its day; neither does the record of it.
  delete from public.revoked_photo_copies where expires_at < now();
  return v_retired;
end;
$function$;

CREATE FUNCTION public.public_photo_copy_removed(p_bucket text, p_path text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_deleted integer;
begin
  delete from public.public_photo_copies where bucket = p_bucket and path = p_path and state = 'removing';
  get diagnostics v_deleted = row_count;
  return v_deleted > 0;
end;
$function$;

CREATE FUNCTION public.public_photo_copy_unavailable(p_bucket text, p_path text)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  -- Storage said the photo's bytes are not there. No copy was written, so
  -- there is nothing to withdraw: the row stays, so the photo is not claimed
  -- again on every run, and is signed and shown (or not) exactly as before.
  update public.public_photo_copies
     set state = 'unavailable', updated_at = now()
   where bucket = p_bucket and path = p_path and state = 'copying';
$function$;

CREATE FUNCTION public.public_photo_copy_orphans(p_limit integer DEFAULT 100)
 RETURNS TABLE(bucket text, path text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  -- An object in a public bucket with no row saying why it is there: a copy
  -- whose making was interrupted between the write and the record. Fifteen
  -- minutes' grace, so a copy being made right now is not one.
  select substr(o.bucket_id, 8), o.name::text
    from storage.objects o
   where o.bucket_id in ('public-car-images', 'public-listing-images', 'public-activity-images')
     and o.created_at < now() - interval '15 minutes'
     and not exists (select 1 from public.public_photo_copies c
                      where c.bucket = substr(o.bucket_id, 8) and c.path = o.name)
   order by o.created_at
   limit greatest(least(coalesce(p_limit, 100), 1000), 1);
$function$;

CREATE OR REPLACE FUNCTION public.photo_signatures_read(p_window bigint, p_objects jsonb)
 RETURNS TABLE(bucket text, path text, signed_url text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with asked as (
    select o.bucket, o.path
      from jsonb_to_recordset(coalesce(p_objects, '[]'::jsonb)) as o(bucket text, path text)
  ),
  -- 20261124220000: where the storage origin is recorded, a photo whose
  -- public copy is live is answered with the copy's address, which does not
  -- change. The caller treats whatever comes back as the link to hand out.
  origin as (
    select rtrim(c.value, '/') as value from public.job_config c
     where c.key = 'media_storage_origin' and c.value ~ '^https?://[^/?#@]+/?$'
  ),
  copies as (
    select a.bucket, a.path, g.value || '/storage/v1/object/public/public-' || a.bucket || '/' || a.path as url
      from asked a
      join public.public_photo_copies c on c.bucket = a.bucket and c.path = a.path and c.state = 'live'
      cross join origin g
  )
  select k.bucket, k.path, k.url from copies k
  union all
  select s.bucket, s.path, s.signed_url
    from asked o
    join private.photo_signatures s
      on s.bucket = o.bucket and s.path = o.path and s.signing_window = p_window
   where not exists (select 1 from copies k where k.bucket = o.bucket and k.path = o.path);
$function$;

CREATE FUNCTION public.media_gate_status(p_key text)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select case
    -- A copy is its original for a takedown: 'public-<bucket>/<path>' is
    -- asked about as '<bucket>/<path>' too.
    when exists (select 1 from public.copyright_blocked_media b
                  where b.object_key = p_key
                     or (p_key like 'public-%' and b.object_key = substr(p_key, 8))) then 'copyright'
    when exists (select 1 from public.revoked_photo_copies r
                  where r.object_key = p_key and r.expires_at > now()) then 'revoked'
    else 'ok'
  end;
$function$;

revoke all on function private.public_photo_refs(uuid) from public, anon, authenticated;
revoke all on function public.public_photo_copies_claim(uuid, integer) from public, anon, authenticated;
revoke all on function public.public_photo_copy_confirm(text, text) from public, anon, authenticated;
revoke all on function public.public_photo_copies_retire(uuid) from public, anon, authenticated;
revoke all on function public.public_photo_copy_removed(text, text) from public, anon, authenticated;
revoke all on function public.public_photo_copy_unavailable(text, text) from public, anon, authenticated;
grant execute on function public.public_photo_copy_unavailable(text, text) to service_role;
revoke all on function public.public_photo_copy_orphans(integer) from public, anon, authenticated;
revoke all on function public.media_gate_status(text) from public, anon, authenticated;
grant execute on function public.public_photo_copies_claim(uuid, integer) to service_role;
grant execute on function public.public_photo_copy_confirm(text, text) to service_role;
grant execute on function public.public_photo_copies_retire(uuid) to service_role;
grant execute on function public.public_photo_copy_removed(text, text) to service_role;
grant execute on function public.public_photo_copy_orphans(integer) to service_role;
grant execute on function public.media_gate_status(text) to service_role;

-- The media job is what withdraws and makes copies, so it runs every ten
-- minutes. Its other work (photos of deleted content, uploads nobody
-- attached) is bounded and finds nothing to do on most runs.
CREATE OR REPLACE FUNCTION private.scheduled_job_inventory()
 RETURNS TABLE(job text, schedule text, command text, families text[], budget interval)
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  values
    ('drvn-agent-worker', '*/5 * * * *', 'select public.invoke_remediation_worker(''agent'');', array['agent'], interval '30 minutes'),
    ('drvn-cron-history-prune', '27 4 * * *', 'select private.prune_cron_history();', array[]::text[], interval '26 hours'),
    ('drvn-deletion-worker', '*/5 * * * *', 'select public.invoke_remediation_worker(''account-deletions'');', array['deletions'], interval '30 minutes'),
    ('drvn-delivery-auto-confirm', '23 * * * *', 'select public.auto_confirm_untracked_deliveries();', array['deliveryAutoConfirm'], interval '3 hours'),
    ('drvn-dispute-sla', '5 8 * * *', 'select public.escalate_stale_disputes();', array[]::text[], interval '26 hours'),
    ('drvn-explore-builders', '*/10 * * * *', 'select public.refresh_explore_builders();', array[]::text[], interval '30 minutes'),
    ('drvn-explore-trending', '*/2 * * * *', 'select public.refresh_explore_trending();', array[]::text[], interval '30 minutes'),
    ('drvn-grow-products', '17 * * * *', 'select public.grow_products()', array[]::text[], interval '3 hours'),
    ('drvn-grow-products-full', '47 4 * * *', 'select public.grow_products(true)', array[]::text[], interval '26 hours'),
    ('drvn-ledger-reconciliation', '50 5 * * *', 'select public.invoke_remediation_worker(''ledger-reconciliation'');', array['ledgerReconciliation'], interval '26 hours'),
    ('drvn-listing-edit-sweep', '45 3 * * *', 'select public.prune_listing_edit_requests();', array[]::text[], interval '26 hours'),
    ('drvn-listing-import-sweep', '37 3 * * *', 'select public.invoke_remediation_worker(''listing-imports'');', array['listingImports'], interval '26 hours'),
    ('drvn-marketplace-counts', '30 seconds', 'select public.refresh_marketplace_facet_counts();', array[]::text[], interval '10 minutes'),
    ('drvn-media-gc', '*/10 * * * *', 'select public.invoke_remediation_worker(''media-gc'');', array['media'], interval '45 minutes'),
    ('drvn-prune-rate-limits', '15 3 * * *', 'select public.prune_rate_limits();', array[]::text[], interval '26 hours'),
    ('drvn-release-reservations', '*/5 * * * *', 'select public.release_expired_reservations();', array[]::text[], interval '30 minutes'),
    ('drvn-saved-search-digests', '41 * * * *', 'select public.invoke_remediation_worker(''saved-search-digests'');', array['savedSearchDigests'], interval '3 hours'),
    ('drvn-saved-search-worker', '*/30 * * * *', 'select public.invoke_remediation_worker(''saved-searches'');', array['savedSearches'], interval '90 minutes'),
    ('drvn-search-words', '23 * * * *', 'select public.refresh_search_words();', array[]::text[], interval '3 hours'),
    ('drvn-search-worker', '*/2 * * * *', 'select public.invoke_remediation_worker(''search'');', array['search'], interval '30 minutes'),
    ('drvn-transfer-worker', '*/10 * * * *', 'select public.mark_due_transfer_intents(); select public.invoke_transfer_worker();',
      array['expiries','captures','transfers','transferReconciliation','refunds','labelVoids','returns','disputes','payoutDeadlines','alerts','receipts','analytics','orderEmails'],
      interval '30 minutes')
$function$;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('drvn-media-gc', '*/10 * * * *', 'select public.invoke_remediation_worker(''media-gc'');');
  end if;
end $$;
