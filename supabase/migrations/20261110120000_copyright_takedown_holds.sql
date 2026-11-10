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
-- 3. (Review of #200.) The blocklist binds every writer, not only members:
--    the photo-column guards returned early for any role but
--    'authenticated', so a service-role write (seeding, a script, a future
--    importer) could attach a blocked object. No app path writes a photo
--    column as the service role today (writes go through the member's
--    session or a member-called security-definer function, which keeps
--    the member's role); the seed and perf scripts under scripts/ do. Each
--    guard now refuses a blocked object for every writer first; only the
--    owner and origin checks stay member-only.
-- 4. Post bodies: the blocklist row's purge also strips the object from
--    activity_posts.body (an images block's urls, a before/after pair).
-- 5. A listing a takedown removed can't be restored by an admin or
--    re-published by its seller: the change is refused with the reason
--    (listing.restore sets 'paused', so the old hold only bit later, and
--    silently). One a checkout held is still turned into a removal when
--    the checkout fails.
-- 6. Locks are taken in key order: the purge runs once per statement over
--    every new blocklist row, sorted; a post body's new photos are checked
--    sorted. (Two multi-row gallery writes racing a takedown in opposite
--    orders can still deadlock; Postgres aborts one, nothing hangs.)
--
-- Blocking is by storage path: the same bytes uploaded again under a new
-- path are not caught (on the owner's list).
--
-- Restated from 20261107203000_media_integrity.sql: private.member_media_ref_ok
-- (now volatile, the blocklist added), private.guard_member_media_ref and
-- private.guard_member_post_body_media (the blocklist checked for every
-- writer before the member-only checks; otherwise unchanged).
-- New: private.media_url_blocked, private.strip_media_from_body,
-- private.copyright_listing_held, private.copyright_hold_listing_status and
-- its trigger, private.copyright_blocked_media_purge and its trigger.
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
       and ((jsonb_typeof(n.takedown -> 'keptListingStatus') = 'array' and (n.takedown -> 'keptListingStatus') ? p_listing::text)
         or (jsonb_typeof(n.takedown -> 'removedListings') = 'array' and (n.takedown -> 'removedListings') ? p_listing::text))
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
  -- Taken down and removed: no restore, no re-publish. Said, not silent.
  if old.status = 'removed' and new.status is distinct from 'removed' and private.copyright_listing_held(new.id) then
    raise exception 'This listing was taken down after a copyright notice, so it can''t be restored or put back on sale. The seller was sent the notice; a counter-notice is the way to dispute it.'
      using errcode = '42501';
  end if;
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
-- The object's lock (the media worker's and the blocklist's), then the
-- blocklist. Any URL naming a storage object, in any spelling.
create or replace function private.media_url_blocked(p_url text)
returns boolean
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  k text := private.media_object_key(p_url);
begin
  if k is null then return false; end if;
  perform pg_advisory_xact_lock(hashtextextended('drvn-media:' || k, 0));
  return exists (select 1 from public.copyright_blocked_media b where b.object_key = k);
end;
$$;
revoke all on function private.media_url_blocked(text) from public, anon, authenticated;

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
  -- 20261110120000: taken down means never attached again.
  if private.media_url_blocked(p_url) then return false; end if;
  return true;
end;
$$;
revoke all on function private.member_media_ref_ok(text, uuid) from public, anon, authenticated;

create or replace function private.guard_member_media_ref()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_new jsonb := to_jsonb(new);
  v_url text := v_new ->> tg_argv[0];
  v_owner uuid;
begin
  if v_url is null then return new; end if;
  if tg_op = 'UPDATE' and v_url is not distinct from (to_jsonb(old) ->> tg_argv[0]) then return new; end if;
  -- 20261110120000: every writer, whatever its role.
  if private.media_url_blocked(v_url) then
    raise exception 'This photo was removed after a copyright notice and can''t be used again' using errcode = '42501';
  end if;
  if coalesce(auth.role(), '') <> 'authenticated' then return new; end if;
  case
    when tg_argv[1] like 'self:%' then v_owner := (v_new ->> substr(tg_argv[1], 6))::uuid;
    when tg_argv[1] = 'car' then select c.owner_id into v_owner from public.cars c where c.id = (v_new ->> 'car_id')::uuid;
    when tg_argv[1] = 'listing' then select l.seller_id into v_owner from public.listings l where l.id = (v_new ->> 'listing_id')::uuid;
    when tg_argv[1] = 'post' then select p.author_id into v_owner from public.activity_posts p where p.id = (v_new ->> 'post_id')::uuid;
    else v_owner := null;
  end case;
  if not private.member_media_ref_ok(v_url, v_owner) then
    raise exception 'Photos must be your own uploads to DRVN' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_member_media_ref() from public, anon, authenticated;

create or replace function private.guard_member_post_body_media()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_url text;
  v_old text[] := '{}';
  v_added text[];
begin
  if tg_op = 'UPDATE' then
    if new.body is not distinct from old.body then return new; end if;
    v_old := private.activity_body_media(old.body);
  end if;
  -- The photos this write adds, in key order (so concurrent writes lock alike).
  select coalesce(array_agg(u order by private.media_object_key(u), u), '{}') into v_added
    from unnest(private.activity_body_media(new.body)) u
   where not (u = any(v_old));
  -- 20261110120000: every writer, whatever its role.
  foreach v_url in array v_added loop
    if private.media_url_blocked(v_url) then
      raise exception 'This photo was removed after a copyright notice and can''t be used again' using errcode = '42501';
    end if;
  end loop;
  if coalesce(auth.role(), '') <> 'authenticated' then return new; end if;
  foreach v_url in array v_added loop
    if not private.member_media_ref_ok(v_url, new.author_id) then
      raise exception 'Photos must be your own uploads to DRVN' using errcode = '42501';
    end if;
  end loop;
  return new;
end;
$$;
revoke all on function private.guard_member_post_body_media() from public, anon, authenticated;

-- A post body without these objects: an images block loses their URLs (and
-- goes if none is left); a before/after pair naming one goes.
create or replace function private.strip_media_from_body(p_body jsonb, p_keys text[])
returns jsonb
language sql
stable
set search_path = public, pg_temp
as $$
  select case when jsonb_typeof(p_body) <> 'array' then p_body else coalesce((
    select jsonb_agg(blk order by ord) from (
      select ord,
             case when b ->> 'type' = 'images' and jsonb_typeof(b -> 'urls') = 'array'
                  then jsonb_set(b, '{urls}', coalesce((
                         select jsonb_agg(u order by n) from jsonb_array_elements(b -> 'urls') with ordinality x(u, n)
                          where not coalesce(private.media_object_key(u #>> '{}') = any(p_keys), false)), '[]'::jsonb))
                  else b end as blk
        from jsonb_array_elements(p_body) with ordinality t(b, ord)
       where not (b ->> 'type' = 'before_after'
                  and (coalesce(private.media_object_key(b ->> 'beforeUrl') = any(p_keys), false)
                       or coalesce(private.media_object_key(b ->> 'afterUrl') = any(p_keys), false)))
    ) s
    where not (blk ->> 'type' = 'images' and jsonb_typeof(blk -> 'urls') = 'array' and jsonb_array_length(blk -> 'urls') = 0)
  ), '[]'::jsonb) end;
$$;
revoke all on function private.strip_media_from_body(jsonb, text[]) from public, anon, authenticated;

create or replace function private.copyright_blocked_media_purge()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_keys text[];
  k text;
  v_write text := current_setting('drvn.activity_write', true);
begin
  select coalesce(array_agg(distinct a.object_key order by a.object_key), '{}') into v_keys from added a;
  -- Waits for any write that is checking these objects right now, in key
  -- order; anything it committed is visible to the statements below, and
  -- anything after sees the rows and is refused.
  foreach k in array v_keys loop
    perform pg_advisory_xact_lock(hashtextextended('drvn-media:' || k, 0));
  end loop;
  delete from public.order_item_snapshot_images where private.media_object_key(url) = any(v_keys);
  delete from public.listing_images where private.media_object_key(url) = any(v_keys);
  delete from public.car_images where private.media_object_key(url) = any(v_keys);
  delete from public.activity_images where private.media_object_key(url) = any(v_keys);
  delete from public.car_hotspots where private.media_object_key(image_url) = any(v_keys);
  update public.mod_items set image_url = null where private.media_object_key(image_url) = any(v_keys);
  update public.cars set cover_image_url = null where private.media_object_key(cover_image_url) = any(v_keys);
  update public.profiles set avatar_url = null where private.media_object_key(avatar_url) = any(v_keys);
  -- The durable-write guard admits this one system edit (an admin's
  -- takedown runs in the admin's session); the setting is put back after.
  perform set_config('drvn.activity_write', 'v1', true);
  update public.activity_posts p
     set body = private.strip_media_from_body(p.body, v_keys)
   where strpos(p.body::text, '/storage/v1/') > 0
     and private.json_media_keys(p.body) && v_keys
     and private.strip_media_from_body(p.body, v_keys) is distinct from p.body;
  perform set_config('drvn.activity_write', coalesce(v_write, ''), true);
  return null;
end;
$$;
revoke all on function private.copyright_blocked_media_purge() from public, anon, authenticated;

drop trigger if exists copyright_blocked_media_purge on public.copyright_blocked_media;
create trigger copyright_blocked_media_purge
  after insert on public.copyright_blocked_media
  referencing new table as added
  for each statement execute function private.copyright_blocked_media_purge();

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
