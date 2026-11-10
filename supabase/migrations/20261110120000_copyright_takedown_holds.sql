-- ============================================================================
-- 20261110120000 — a takedown stays taken down (report five #109; Codex's
-- review of PR #117, the two open database findings)
--
-- 1. A reserved listing could come back. copyright_takedown leaves a
--    listing a checkout holds as 'reserved' (the order owns it), records it
--    in the notice's takedown.keptListingStatus, and purges its photos. If
--    that payment then failed, purchase_finalize put it back to 'active':
--    on sale again after a takedown. Now a listing named in an actioned
--    notice's keptListingStatus can never become active again: the change
--    is turned into a removal, whatever path makes it (a failed or
--    abandoned checkout, a release, an expiry). A sale that completes still
--    goes to 'sold' as before. Listings already back on sale this way are
--    removed once, here.
--
-- 2. Media could be reattached before clean-up. After the purge, the same
--    URL could be written into another gallery before the media worker
--    deleted the object; the worker then found a reference and kept the
--    object, still reachable. Two changes, both under the per-object lock
--    the media worker already takes ('drvn-media:' || bucket/path):
--      * private.member_media_ref_ok (every photo column's write guard)
--        takes the object's lock and refuses an object on the copyright
--        blocklist;
--      * a row added to the blocklist takes the same lock and purges every
--        reference to the object again, so an attach that committed between
--        the takedown's purge and its blocklist insert is removed too, and
--        one still waiting for the lock is refused once the blocklist row
--        is visible.
--
-- Restated: private.member_media_ref_ok from 20261107203000_media_integrity.sql
-- (now volatile, for the lock; the checks are unchanged, plus the blocklist).
-- New: private.copyright_listing_held, private.copyright_hold_listing_status
-- and its trigger, private.copyright_blocked_media_purge and its trigger.
-- The third finding (the blocklist read truncating at 1,000 rows) is fixed
-- in the app, src/lib/copyright/blocked-media.ts. Idempotent.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. A taken-down reserved listing never goes back on sale.
-- ---------------------------------------------------------------------------
create or replace function private.copyright_listing_held(p_listing uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.copyright_notices n
     where n.status = 'actioned'
       and jsonb_typeof(n.takedown -> 'keptListingStatus') = 'array'
       and (n.takedown -> 'keptListingStatus') ? p_listing::text
  );
$$;
revoke all on function private.copyright_listing_held(uuid) from public, anon, authenticated;

create or replace function private.copyright_hold_listing_status()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.status = 'active' and old.status is distinct from 'active' and private.copyright_listing_held(new.id) then
    new.status := 'removed';
    new.removed_at := coalesce(new.removed_at, now());
    new.removed_reason := coalesce(new.removed_reason, 'Copyright notice: taken down while a checkout held it');
  end if;
  return new;
end;
$$;
revoke all on function private.copyright_hold_listing_status() from public, anon, authenticated;

-- Named to run after the other BEFORE triggers on listings, which see the
-- status the writer asked for; this one has the last word on it.
drop trigger if exists listings_zz_copyright_hold on public.listings;
create trigger listings_zz_copyright_hold
  before update of status on public.listings
  for each row execute function private.copyright_hold_listing_status();

-- Any already back on sale.
update public.listings l
   set status = 'removed', removed_at = coalesce(l.removed_at, now()),
       removed_reason = coalesce(l.removed_reason, 'Copyright notice: taken down while a checkout held it')
 where l.status = 'active' and private.copyright_listing_held(l.id);

-- ---------------------------------------------------------------------------
-- 2. A blocked object can't be attached again, and a racing attach is undone.
-- ---------------------------------------------------------------------------
create or replace function private.member_media_ref_ok(p_url text, p_owner uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  k text;
  v_origin text;
  v_prefix text;
begin
  if p_url is null then return true; end if;
  if p_owner is null or length(p_url) > 2000 or p_url ~ '[?#%@\\[:space:][:cntrl:]]' then return false; end if;
  if p_url !~ '^https?://[^/]+/storage/v1/object/public/' then return false; end if;
  k := private.media_object_key(p_url);
  if k is null
     or split_part(k, '/', 1) not in ('avatars', 'car-images', 'activity-images', 'listing-images')
     or split_part(k, '/', 2) <> p_owner::text then
    return false;
  end if;
  -- Fail closed: until the deployment records its storage origin (see
  -- docs/production-runbook.md), no new member photo reference is accepted —
  -- otherwise one saved on another host before then would never be
  -- revalidated.
  select value into v_origin from public.job_config where key = 'media_storage_origin';
  if v_origin is null or v_origin !~ '^https?://[^/?#@]+/?$' then return false; end if;
  v_prefix := rtrim(v_origin, '/') || '/storage/v1/object/public/';
  if left(p_url, length(v_prefix)) <> v_prefix then return false; end if;
  -- 20261110120000: the object's lock (the media worker's and the
  -- blocklist's), then the blocklist. Taken down means never attached again.
  perform pg_advisory_xact_lock(hashtextextended('drvn-media:' || k, 0));
  if exists (select 1 from public.copyright_blocked_media b where b.object_key = k) then return false; end if;
  return true;
end;
$$;
revoke all on function private.member_media_ref_ok(text, uuid) from public, anon, authenticated;

create or replace function private.copyright_blocked_media_purge()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- Waits for any write that is checking this object right now; anything it
  -- committed is visible to the statements below, and anything after sees
  -- this row and is refused.
  perform pg_advisory_xact_lock(hashtextextended('drvn-media:' || new.object_key, 0));
  delete from public.order_item_snapshot_images where private.media_object_key(url) = new.object_key;
  delete from public.listing_images where private.media_object_key(url) = new.object_key;
  delete from public.car_images where private.media_object_key(url) = new.object_key;
  delete from public.activity_images where private.media_object_key(url) = new.object_key;
  delete from public.car_hotspots where private.media_object_key(image_url) = new.object_key;
  update public.mod_items set image_url = null where private.media_object_key(image_url) = new.object_key;
  update public.cars set cover_image_url = null where private.media_object_key(cover_image_url) = new.object_key;
  update public.profiles set avatar_url = null where private.media_object_key(avatar_url) = new.object_key;
  return new;
end;
$$;
revoke all on function private.copyright_blocked_media_purge() from public, anon, authenticated;

drop trigger if exists copyright_blocked_media_purge on public.copyright_blocked_media;
create trigger copyright_blocked_media_purge
  after insert on public.copyright_blocked_media
  for each row execute function private.copyright_blocked_media_purge();

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'listings_zz_copyright_hold' and tgrelid = 'public.listings'::regclass) then
    raise exception '20261110120000: the listing hold trigger is missing';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'copyright_blocked_media_purge' and tgrelid = 'public.copyright_blocked_media'::regclass) then
    raise exception '20261110120000: the blocklist purge trigger is missing';
  end if;
  raise notice 'PASS: 20261110120000 self-checks';
end $$;

commit;
