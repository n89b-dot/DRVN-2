-- ============================================================================
-- 20261107150500 — Media integrity and lifecycle (OS-W15: N12, N99, N100,
-- N51, N55)
--
-- One storage object has one identity: (bucket, decoded object path). Every
-- reference check, deletion target and ownership test below compares that
-- identity, never a URL as typed, so an encoded or variant spelling of a URL
-- can neither hide a reference nor dodge one.
--
--  1. private.media_object_key (and media_path_ok) — the canonical
--     identity, mirrored exactly by canonicalStorageObject in
--     src/lib/media-url.ts. Pure and immutable, so reference columns are
--     indexed by it.
--  2. public.media_object_referenced(bucket, path) — the one "is this object
--     still in use?" answer. It adds dispute evidence by storage_path (B5:
--     evidence was saved as a bare path and never counted as in use) and
--     message photos by path. Service role only.
--  3. staged_uploads (N12) — members can no longer insert, delete or rewrite
--     ledger rows; they may only stamp consumed_at on their own. Every row,
--     whoever writes it, must name an object in its owner's own folder, and a
--     row's identity can't change afterwards. Rows registered before this
--     that break the rule (the B5 attack shape) are dropped from the ledger;
--     no storage object is touched by that.
--  4. Storage (N12, N100) — members cannot delete media or evidence objects
--     at all (the app never did: every removal goes through the server's
--     reference-aware helper), evidence cannot be overwritten, and evidence
--     can only be uploaded into `<uploader>/<order>/<file>` for an order the
--     uploader is party to, while it is disputed and under the 8-photo cap.
--  5. Member media references (N55) — a member's write to a photo column
--     (car cover and gallery, hotspots, mod thumbnail, listing gallery,
--     post photos and post-body media, avatar) must name a canonical public
--     URL in a public bucket under that member's own folder, on our storage
--     origin, `job_config.media_storage_origin`. That is fail-closed: the
--     migration can't know the origin, so until the deploy step records it
--     (docs/production-runbook.md; the upload route and media-gc also record
--     it from the server's own configuration) no new member photo reference
--     is accepted. Server writers (service role, migrations) are unaffected.
--  6. media_cleanup_queue (N51) — deleting a car, a post (including an
--     admin's removal) or a listing queues its photos; the media worker then
--     removes each object only if nothing references it any more, so photos a
--     buyer's order snapshot keeps stay.
--  7. Deletion claims (N12) — removal claims an object under a lock first,
--     and every reference write refuses a claimed object, so evidence
--     attached mid-removal is never lost.
--
-- Idempotent.
-- ============================================================================

begin;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- ============================================================
-- 1. Canonical identity
-- ============================================================

-- A decoded object path DRVN will name: at least '<folder>/<file>', no empty,
-- '.' or '..' segment, no control characters and none of \ ? # %.
create or replace function private.media_path_ok(p text)
returns boolean
language sql
immutable
parallel safe
set search_path = pg_catalog, pg_temp
as $$
  select p is not null
    and length(p) between 3 and 512
    and position('/' in p) > 1
    and p !~ '^/' and p !~ '/$' and p !~ '//'
    and p !~ '(^|/)\.{1,2}(/|$)'
    and p !~ '[[:cntrl:]\\?#%]';
$$;
revoke all on function private.media_path_ok(text) from public, anon, authenticated;

-- '<bucket>/<decoded path>' for any storage-object URL spelling (public, sign,
-- authenticated, image-render; any query or fragment), or null. The host is
-- not part of the identity: an unrecognised host only ever makes something
-- look referenced, which keeps it. Hosts are checked where URLs are accepted.
--
-- Self-contained on purpose (it does its own percent-decoding and repeats
-- media_path_ok rather than calling it): it is an index expression, evaluated as
-- whichever role writes the row, and members have no USAGE on `private` to
-- resolve another function's name. EXECUTE stays with PUBLIC for the same
-- reason; it is a pure function of its argument.
create or replace function private.media_object_key(p_ref text)
returns text
language plpgsql
immutable
parallel safe
set search_path = pg_catalog, pg_temp
as $$
declare
  v_m text[];
  v_raw text;
  v_path text;
  v_out bytea := ''::bytea;
  v_i int := 1;
  v_c text;
begin
  if p_ref is null or length(p_ref) > 2000 then return null; end if;
  v_m := regexp_match(
    p_ref,
    '^[A-Za-z][A-Za-z0-9+.-]*://[^/?#]+/storage/v1/(?:object|render/image)/(?:public|sign|authenticated)/([a-z0-9_-]{1,63})/([^?#]+)'
  );
  if v_m is null then return null; end if;
  v_raw := v_m[2];
  if strpos(v_raw, '%') = 0 then
    v_path := v_raw;
  else
    begin
      while v_i <= length(v_raw) loop
        v_c := substr(v_raw, v_i, 1);
        if v_c = '%' then
          if substr(v_raw, v_i + 1, 2) !~ '^[0-9A-Fa-f]{2}$' then return null; end if;
          v_out := v_out || decode(substr(v_raw, v_i + 1, 2), 'hex');
          v_i := v_i + 3;
        else
          v_out := v_out || convert_to(v_c, 'UTF8');
          v_i := v_i + 1;
        end if;
      end loop;
      v_path := convert_from(v_out, 'UTF8');
    exception when others then
      return null;
    end;
  end if;
  if not (length(v_path) between 3 and 512
          and position('/' in v_path) > 1
          and v_path !~ '/$' and v_path !~ '//'
          and v_path !~ '(^|/)\.{1,2}(/|$)'
          and v_path !~ '[[:cntrl:]\\?#%]') then
    return null;
  end if;
  return v_m[1] || '/' || v_path;
end;
$$;

comment on function private.media_object_key(text) is
  'Canonical storage identity ''<bucket>/<decoded path>'' of a storage URL, or null. Mirrors canonicalStorageObject in src/lib/media-url.ts.';

-- Reference columns are looked up by identity, not by spelling.
create index if not exists car_images_media_key_idx on public.car_images (private.media_object_key(url));
create index if not exists listing_images_media_key_idx on public.listing_images (private.media_object_key(url));
create index if not exists activity_images_media_key_idx on public.activity_images (private.media_object_key(url));
create index if not exists order_item_snapshot_images_media_key_idx on public.order_item_snapshot_images (private.media_object_key(url));
create index if not exists profiles_avatar_media_key_idx on public.profiles (private.media_object_key(avatar_url));
create index if not exists cars_cover_media_key_idx on public.cars (private.media_object_key(cover_image_url));
create index if not exists mod_items_image_media_key_idx on public.mod_items (private.media_object_key(image_url));
create index if not exists car_hotspots_image_media_key_idx on public.car_hotspots (private.media_object_key(image_url));
create index if not exists dispute_evidence_storage_path_idx on public.dispute_evidence (storage_path);

-- Every object key any string anywhere in a JSON document names. A post body
-- or a commercial snapshot may spell a URL with escapes (`%70hoto.webp`); a
-- substring test on the decoded path would miss it (N99), so the strings are
-- canonicalised one by one.
create or replace function private.json_media_keys(p jsonb)
returns text[]
language sql
immutable
parallel safe
set search_path = pg_catalog, pg_temp
as $$
  select coalesce(array_agg(distinct k) filter (where k is not null), '{}')
    from (
      select private.media_object_key(s #>> '{}') as k
        from jsonb_path_query(coalesce(p, 'null'::jsonb), 'lax $.** ? (@.type() == "string")') s
    ) x;
$$;
revoke all on function private.json_media_keys(jsonb) from public, anon, authenticated;

-- ============================================================
-- 2. The one reference check
-- ============================================================
-- Anything that can't be named canonically reads as referenced: deleting on
-- partial information is the mistake this exists to prevent.
create or replace function public.media_object_referenced(p_bucket text, p_path text)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  k text;
begin
  if p_bucket is null or p_bucket !~ '^[a-z0-9_-]{1,63}$' or not coalesce(private.media_path_ok(p_path), false) then
    return true;
  end if;
  k := p_bucket || '/' || p_path;
  return exists (select 1 from public.car_images where private.media_object_key(url) = k)
    or exists (select 1 from public.listing_images where private.media_object_key(url) = k)
    or exists (select 1 from public.activity_images where private.media_object_key(url) = k)
    -- Purchase evidence (0049): the gallery frozen onto an order.
    or exists (select 1 from public.order_item_snapshot_images where private.media_object_key(url) = k)
    or exists (select 1 from public.profiles where private.media_object_key(avatar_url) = k)
    or exists (select 1 from public.cars where private.media_object_key(cover_image_url) = k)
    or exists (select 1 from public.mod_items where private.media_object_key(image_url) = k)
    or exists (select 1 from public.car_hotspots where private.media_object_key(image_url) = k)
    -- Dispute evidence is stored by bare path (0027); legacy rows by URL.
    or (p_bucket = 'dispute-evidence' and exists (
      select 1 from public.dispute_evidence de
       where de.storage_path = p_path or de.url = p_path or private.media_object_key(de.url) = k))
    -- Message photos are stored on the message by path (20260928140000).
    or (p_bucket = 'message-photos' and exists (
      select 1 from public.messages where attachments @> array[p_path]))
    -- Embedded references: the commercial snapshot and post bodies. Every
    -- URL string in them is canonicalised (an escaped spelling still names
    -- its object); the substring test also keeps any bare path.
    or exists (select 1 from public.order_items
                where position(p_path in commercial_snapshot::text) > 0
                   or (strpos(commercial_snapshot::text, '/storage/v1/') > 0 and k = any(private.json_media_keys(commercial_snapshot))))
    or exists (select 1 from public.activity_posts
                where position(p_path in body::text) > 0
                   or (strpos(body::text, '/storage/v1/') > 0 and k = any(private.json_media_keys(body))));
end;
$$;
revoke all on function public.media_object_referenced(text, text) from public, anon, authenticated;
grant execute on function public.media_object_referenced(text, text) to service_role;

-- ============================================================
-- 3. staged_uploads — server-registered, owner-bound, immutable identity
-- ============================================================
drop policy if exists "owners insert staged uploads" on public.staged_uploads;
drop policy if exists "owners delete staged uploads" on public.staged_uploads;
revoke insert, update, delete on public.staged_uploads from anon, authenticated;
grant select on public.staged_uploads to authenticated;
-- Finalising (stamping consumed_at on your own rows) is the one member write.
grant update (consumed_at) on public.staged_uploads to authenticated;

create or replace function private.guard_staged_upload()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'UPDATE' then
    if new.owner_id is distinct from old.owner_id or new.bucket is distinct from old.bucket
       or new.path is distinct from old.path or new.url is distinct from old.url then
      raise exception 'A staged upload''s object cannot change' using errcode = '42501';
    end if;
    return new;
  end if;
  if new.bucket not in ('avatars', 'car-images', 'activity-images', 'listing-images', 'dispute-evidence', 'message-photos')
     or not coalesce(private.media_path_ok(new.path), false)
     or split_part(new.path, '/', 1) <> new.owner_id::text
     or private.media_object_key(new.url) is distinct from new.bucket || '/' || new.path then
    raise exception 'A staged upload must name an object in its owner''s own folder' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_staged_upload() from public, anon, authenticated;

drop trigger if exists staged_upload_guard on public.staged_uploads;
create trigger staged_upload_guard
  before insert or update on public.staged_uploads
  for each row execute function private.guard_staged_upload();

-- Ledger rows that name someone else's object, or nothing nameable, are not
-- a record of an upload by their owner. Drop them so the media-gc job never
-- acts on one. Storage itself is untouched.
delete from public.staged_uploads s
 where s.bucket not in ('avatars', 'car-images', 'activity-images', 'listing-images', 'dispute-evidence', 'message-photos')
    or not coalesce(private.media_path_ok(s.path), false)
    or split_part(s.path, '/', 1) <> s.owner_id::text
    or private.media_object_key(s.url) is distinct from s.bucket || '/' || s.path;

-- ============================================================
-- 4. Storage — no member deletes of media or evidence; evidence is immutable
--    and only uploads into an open dispute
-- ============================================================
drop policy if exists "users delete own media" on storage.objects;
drop policy if exists "users delete own dispute evidence" on storage.objects;
drop policy if exists "delete own message photos" on storage.objects;

-- Belt and braces: a later permissive policy can't reopen deletion.
drop policy if exists "members never delete media or evidence" on storage.objects;
create policy "members never delete media or evidence" on storage.objects
  as restrictive for delete to anon, authenticated
  using (bucket_id not in ('avatars', 'car-images', 'activity-images', 'listing-images', 'dispute-evidence', 'message-photos'));

drop policy if exists "dispute evidence is immutable" on storage.objects;
create policy "dispute evidence is immutable" on storage.objects
  as restrictive for update to anon, authenticated
  using (bucket_id <> 'dispute-evidence');

drop policy if exists "users upload dispute evidence" on storage.objects;
drop policy if exists "upload evidence into an open dispute" on storage.objects;
create policy "upload evidence into an open dispute" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'dispute-evidence'
    and name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[A-Za-z0-9_-]{1,80}\.[A-Za-z0-9]{1,10}$'
    and split_part(name, '/', 1) = (select auth.uid())::text
    and exists (
      select 1
        from public.orders o
       where o.id = (case when split_part(name, '/', 2) ~ '^[0-9a-f-]{36}$' then split_part(name, '/', 2)::uuid end)
         and o.status = 'disputed'
         and (select auth.uid()) in (o.buyer_id, o.seller_id)
         and (select count(*) from public.dispute_evidence de
               where de.order_id = o.id and de.uploader_id = (select auth.uid())) < 8
    )
  );

-- ============================================================
-- 5. Member media references (N55)
-- ============================================================
create or replace function private.member_media_ref_ok(p_url text, p_owner uuid)
returns boolean
language plpgsql
stable
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
  return true;
end;
$$;
revoke all on function private.member_media_ref_ok(text, uuid) from public, anon, authenticated;

-- The media strings a post body carries (images blocks and before/after).
create or replace function private.activity_body_media(p_body jsonb)
returns text[]
language sql
immutable
set search_path = pg_catalog, pg_temp
as $$
  select coalesce(array_agg(distinct u) filter (where u is not null and u <> ''), '{}')
    from (
      select jsonb_array_elements_text(case when jsonb_typeof(b -> 'urls') = 'array' then b -> 'urls' else '[]'::jsonb end) as u
        from jsonb_array_elements(case when jsonb_typeof(p_body) = 'array' then p_body else '[]'::jsonb end) b
       where b ->> 'type' = 'images'
      union all
      select b ->> 'beforeUrl' from jsonb_array_elements(case when jsonb_typeof(p_body) = 'array' then p_body else '[]'::jsonb end) b
       where b ->> 'type' = 'before_after'
      union all
      select b ->> 'afterUrl' from jsonb_array_elements(case when jsonb_typeof(p_body) = 'array' then p_body else '[]'::jsonb end) b
       where b ->> 'type' = 'before_after'
    ) s;
$$;
revoke all on function private.activity_body_media(jsonb) from public, anon, authenticated;

-- TG_ARGV[0]: the URL column. TG_ARGV[1]: whose folder it must be in —
-- 'self:<column>' (a column of the row), 'car', 'listing' or 'post' (the
-- owner of the parent row). Only a value the write introduces is checked, so
-- re-saving an unchanged legacy reference keeps working.
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
  if coalesce(auth.role(), '') <> 'authenticated' or v_url is null then return new; end if;
  if tg_op = 'UPDATE' and v_url is not distinct from (to_jsonb(old) ->> tg_argv[0]) then return new; end if;
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
begin
  if coalesce(auth.role(), '') <> 'authenticated' then return new; end if;
  if tg_op = 'UPDATE' then
    if new.body is not distinct from old.body then return new; end if;
    v_old := private.activity_body_media(old.body);
  end if;
  foreach v_url in array private.activity_body_media(new.body) loop
    if not (v_url = any(v_old)) and not private.member_media_ref_ok(v_url, new.author_id) then
      raise exception 'Photos must be your own uploads to DRVN' using errcode = '42501';
    end if;
  end loop;
  return new;
end;
$$;
revoke all on function private.guard_member_post_body_media() from public, anon, authenticated;

drop trigger if exists member_media_ref_guard on public.cars;
create trigger member_media_ref_guard before insert or update of cover_image_url on public.cars
  for each row execute function private.guard_member_media_ref('cover_image_url', 'self:owner_id');
drop trigger if exists member_media_ref_guard on public.profiles;
create trigger member_media_ref_guard before insert or update of avatar_url on public.profiles
  for each row execute function private.guard_member_media_ref('avatar_url', 'self:id');
drop trigger if exists member_media_ref_guard on public.car_images;
create trigger member_media_ref_guard before insert or update of url, car_id on public.car_images
  for each row execute function private.guard_member_media_ref('url', 'car');
drop trigger if exists member_media_ref_guard on public.car_hotspots;
create trigger member_media_ref_guard before insert or update of image_url, car_id on public.car_hotspots
  for each row execute function private.guard_member_media_ref('image_url', 'car');
drop trigger if exists member_media_ref_guard on public.mod_items;
create trigger member_media_ref_guard before insert or update of image_url, car_id on public.mod_items
  for each row execute function private.guard_member_media_ref('image_url', 'car');
drop trigger if exists member_media_ref_guard on public.listing_images;
create trigger member_media_ref_guard before insert or update of url, listing_id on public.listing_images
  for each row execute function private.guard_member_media_ref('url', 'listing');
drop trigger if exists member_media_ref_guard on public.activity_images;
create trigger member_media_ref_guard before insert or update of url, post_id on public.activity_images
  for each row execute function private.guard_member_media_ref('url', 'post');
drop trigger if exists member_post_body_media_guard on public.activity_posts;
create trigger member_post_body_media_guard before insert or update of body on public.activity_posts
  for each row execute function private.guard_member_post_body_media();

-- ============================================================
-- 6. Durable cleanup of deleted content's photos (N51)
-- ============================================================
create table if not exists public.media_cleanup_queue (
  bucket      text not null,
  path        text not null,
  owner_id    uuid not null,
  reason      text not null check (reason in ('car_deleted', 'post_deleted', 'listing_deleted')),
  enqueued_at timestamptz not null default now(),
  attempts    int not null default 0,
  last_error  text,
  primary key (bucket, path)
);
comment on table public.media_cleanup_queue is
  'Photos of deleted cars, posts and listings, removed by the media worker only once nothing references them. Service role only.';
create index if not exists media_cleanup_queue_due_idx on public.media_cleanup_queue (enqueued_at);
create index if not exists media_cleanup_queue_owner_idx on public.media_cleanup_queue (owner_id, enqueued_at);
alter table public.media_cleanup_queue enable row level security;
revoke all on public.media_cleanup_queue from public, anon, authenticated;
grant select, insert, update, delete on public.media_cleanup_queue to service_role;

-- BEFORE DELETE so the children (gallery rows, post photos) are still there
-- to read; a refused or rolled-back delete takes its queue rows with it.
create or replace function private.enqueue_deleted_media()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_urls text[];
  v_keys text[] := '{}';
  v_reason text;
begin
  if tg_table_name = 'cars' then
    v_reason := 'car_deleted';
    select array_agg(u) into v_urls from (
      select old.cover_image_url as u
      union all select url from public.car_images where car_id = old.id
      union all select image_url from public.mod_items where car_id = old.id
      -- A pin's photo can outlive its gallery row (removed from the gallery,
      -- pins left on it); the cascade would drop it unqueued.
      union all select image_url from public.car_hotspots where car_id = old.id
    ) s;
  elsif tg_table_name = 'activity_posts' then
    v_reason := 'post_deleted';
    select array_agg(u) into v_urls from (
      select url as u from public.activity_images where post_id = old.id
      union all select unnest(private.activity_body_media(old.body))
    ) s;
    -- Body media in any shape or spelling, already canonical keys.
    v_keys := private.json_media_keys(old.body);
  elsif tg_table_name = 'listings' then
    v_reason := 'listing_deleted';
    select array_agg(url) into v_urls from public.listing_images where listing_id = old.id;
  end if;

  insert into public.media_cleanup_queue (bucket, path, owner_id, reason)
  select split_part(k, '/', 1), substr(k, length(split_part(k, '/', 1)) + 2), split_part(k, '/', 2)::uuid, v_reason
    from (
      select private.media_object_key(u) as k from unnest(coalesce(v_urls, '{}')) u
      union
      select k from unnest(v_keys) k
    ) keys
   where k is not null
     and split_part(k, '/', 1) in ('avatars', 'car-images', 'activity-images', 'listing-images')
     and split_part(k, '/', 2) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  on conflict (bucket, path) do update
    set enqueued_at = now(), attempts = 0, last_error = null, reason = excluded.reason;
  return old;
end;
$$;
revoke all on function private.enqueue_deleted_media() from public, anon, authenticated;

drop trigger if exists enqueue_deleted_media on public.cars;
create trigger enqueue_deleted_media before delete on public.cars
  for each row execute function private.enqueue_deleted_media();
drop trigger if exists enqueue_deleted_media on public.activity_posts;
create trigger enqueue_deleted_media before delete on public.activity_posts
  for each row execute function private.enqueue_deleted_media();
drop trigger if exists enqueue_deleted_media on public.listings;
create trigger enqueue_deleted_media before delete on public.listings
  for each row execute function private.enqueue_deleted_media();

-- ============================================================
-- 7. Deletion claims — no check-then-delete race (N12)
-- ============================================================
-- Removing an object is two steps: the reference check here, then the
-- Storage delete over HTTP. Without a claim, evidence attached between the
-- two was deleted anyway. Now the worker claims the object first: under a
-- per-object transaction lock it re-checks every reference and records a
-- claim, and every write that would add a reference takes the same lock and
-- refuses a claimed object. Whichever commits first wins, and the loser
-- sees it. A claim stays as a tombstone once the object is gone, so a later
-- write can't adopt a deleted path either; a failed Storage delete releases
-- it.
create table if not exists private.media_deletion_claims (
  bucket     text not null,
  path       text not null,
  claimed_at timestamptz not null default now(),
  primary key (bucket, path)
);
revoke all on private.media_deletion_claims from public, anon, authenticated;

create or replace function public.claim_media_deletion(p_bucket text, p_path text)
returns boolean
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
begin
  if p_bucket is null or p_bucket !~ '^[a-z0-9_-]{1,63}$' or not coalesce(private.media_path_ok(p_path), false) then
    return false;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('drvn-media:' || p_bucket || '/' || p_path, 0));
  -- A fresh statement after the lock: it sees any reference committed by a
  -- writer that held the lock before us.
  if public.media_object_referenced(p_bucket, p_path) then return false; end if;
  insert into private.media_deletion_claims (bucket, path) values (p_bucket, p_path)
    on conflict (bucket, path) do nothing;
  return true;
end;
$$;
revoke all on function public.claim_media_deletion(text, text) from public, anon, authenticated;
grant execute on function public.claim_media_deletion(text, text) to service_role;

create or replace function public.release_media_claim(p_bucket text, p_path text)
returns void
language sql
volatile
security definer
set search_path = public, pg_temp
as $$
  delete from private.media_deletion_claims where bucket = p_bucket and path = p_path;
$$;
revoke all on function public.release_media_claim(text, text) from public, anon, authenticated;
grant execute on function public.release_media_claim(text, text) to service_role;

-- The keys a row's reference column names. TG_ARGV[0] is the column;
-- TG_ARGV[1] how to read it: 'url', 'json', 'evidence' (storage_path and
-- url) or 'paths:<bucket>' (a text[] of object paths).
create or replace function private.row_media_keys(p_row jsonb, p_column text, p_kind text)
returns text[]
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  v_keys text[];
begin
  if p_row is null then return '{}'; end if;
  if p_kind = 'url' then
    v_keys := array[private.media_object_key(p_row ->> p_column)];
  elsif p_kind = 'json' then
    v_keys := private.json_media_keys(p_row -> p_column);
  elsif p_kind = 'evidence' then
    v_keys := array[
      case when private.media_path_ok(p_row ->> 'storage_path') then 'dispute-evidence/' || (p_row ->> 'storage_path') end,
      private.media_object_key(p_row ->> 'url'),
      case when private.media_path_ok(p_row ->> 'url') then 'dispute-evidence/' || (p_row ->> 'url') end
    ];
  elsif p_kind like 'paths:%' then
    select array_agg(substr(p_kind, 7) || '/' || e) into v_keys
      from jsonb_array_elements_text(case when jsonb_typeof(p_row -> p_column) = 'array' then p_row -> p_column else '[]'::jsonb end) e
     where private.media_path_ok(e);
  end if;
  return coalesce(array(select distinct k from unnest(v_keys) k where k is not null order by k), '{}');
end;
$$;
revoke all on function private.row_media_keys(jsonb, text, text) from public, anon, authenticated;

create or replace function private.refuse_claimed_media()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_old text[] := '{}';
  k text;
begin
  if tg_op = 'UPDATE' then
    v_old := private.row_media_keys(to_jsonb(old), tg_argv[0], tg_argv[1]);
  end if;
  -- Sorted, so two writers lock in the same order.
  foreach k in array private.row_media_keys(to_jsonb(new), tg_argv[0], tg_argv[1]) loop
    continue when k = any(v_old);
    perform pg_advisory_xact_lock(hashtextextended('drvn-media:' || k, 0));
    if exists (select 1 from private.media_deletion_claims c
                where c.bucket = split_part(k, '/', 1) and c.path = substr(k, length(split_part(k, '/', 1)) + 2)) then
      raise exception 'That photo has been removed from storage. Upload it again.' using errcode = '55000';
    end if;
  end loop;
  return new;
end;
$$;
revoke all on function private.refuse_claimed_media() from public, anon, authenticated;

-- Named to run after every other BEFORE trigger (the commercial snapshot is
-- filled by one), and for every writer: the server attaches evidence.
drop trigger if exists zz_media_claim_guard on public.car_images;
create trigger zz_media_claim_guard before insert or update of url on public.car_images
  for each row execute function private.refuse_claimed_media('url', 'url');
drop trigger if exists zz_media_claim_guard on public.listing_images;
create trigger zz_media_claim_guard before insert or update of url on public.listing_images
  for each row execute function private.refuse_claimed_media('url', 'url');
drop trigger if exists zz_media_claim_guard on public.activity_images;
create trigger zz_media_claim_guard before insert or update of url on public.activity_images
  for each row execute function private.refuse_claimed_media('url', 'url');
drop trigger if exists zz_media_claim_guard on public.order_item_snapshot_images;
create trigger zz_media_claim_guard before insert or update of url on public.order_item_snapshot_images
  for each row execute function private.refuse_claimed_media('url', 'url');
drop trigger if exists zz_media_claim_guard on public.profiles;
create trigger zz_media_claim_guard before insert or update of avatar_url on public.profiles
  for each row execute function private.refuse_claimed_media('avatar_url', 'url');
drop trigger if exists zz_media_claim_guard on public.cars;
create trigger zz_media_claim_guard before insert or update of cover_image_url on public.cars
  for each row execute function private.refuse_claimed_media('cover_image_url', 'url');
drop trigger if exists zz_media_claim_guard on public.mod_items;
create trigger zz_media_claim_guard before insert or update of image_url on public.mod_items
  for each row execute function private.refuse_claimed_media('image_url', 'url');
drop trigger if exists zz_media_claim_guard on public.car_hotspots;
create trigger zz_media_claim_guard before insert or update of image_url on public.car_hotspots
  for each row execute function private.refuse_claimed_media('image_url', 'url');
drop trigger if exists zz_media_claim_guard on public.dispute_evidence;
create trigger zz_media_claim_guard before insert or update of url, storage_path on public.dispute_evidence
  for each row execute function private.refuse_claimed_media('url', 'evidence');
drop trigger if exists zz_media_claim_guard on public.messages;
create trigger zz_media_claim_guard before insert or update of attachments on public.messages
  for each row execute function private.refuse_claimed_media('attachments', 'paths:message-photos');
drop trigger if exists zz_media_claim_guard on public.activity_posts;
create trigger zz_media_claim_guard before insert or update of body on public.activity_posts
  for each row execute function private.refuse_claimed_media('body', 'json');
drop trigger if exists zz_media_claim_guard on public.order_items;
create trigger zz_media_claim_guard before insert or update of commercial_snapshot on public.order_items
  for each row execute function private.refuse_claimed_media('commercial_snapshot', 'json');

-- ============================================================
-- Self-checks
-- ============================================================
do $$
begin
  if private.media_object_key('https://x.supabase.co/storage/v1/object/public/car-images/u/a%2Eb.webp?x=1')
     is distinct from 'car-images/u/a.b.webp' then
    raise exception 'SELF-CHECK FAILED: media_object_key does not canonicalise encoded URLs';
  end if;
  if private.media_object_key('https://x.supabase.co/storage/v1/object/public/car-images/u/%2E%2E/v/a.webp') is not null then
    raise exception 'SELF-CHECK FAILED: media_object_key accepts a dot segment';
  end if;
  if exists (
    select 1 from pg_policies
     where schemaname = 'storage' and tablename = 'objects' and cmd = 'DELETE' and permissive = 'PERMISSIVE'
       and coalesce(qual, '') ~ '(avatars|car-images|activity-images|listing-images|dispute-evidence|message-photos)'
  ) then
    raise exception 'SELF-CHECK FAILED: a member can still delete media or evidence objects';
  end if;
  if has_table_privilege('authenticated', 'public.staged_uploads', 'insert')
     or has_table_privilege('authenticated', 'public.staged_uploads', 'delete')
     or has_column_privilege('authenticated', 'public.staged_uploads', 'url', 'update') then
    raise exception 'SELF-CHECK FAILED: members can still write staged upload rows';
  end if;
end;
$$;

notify pgrst, 'reload schema';

commit;
