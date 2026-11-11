-- ============================================================================
-- 20261107231002 — Copyright notices and takedown (R69-dmca)
--
-- The listing importer rehosts photos found elsewhere, and there was no way
-- for a rights holder to tell DRVN, nor for DRVN to act. This adds:
--
--  1. A `copyright` report reason, beside the existing ones.
--  2. public.copyright_notices — a notice filed from the public /copyright
--     form: claimant and contact, the work, the URLs on DRVN, the good-faith
--     and accuracy statements, and a typed signature. Written by the server
--     (service role) after validation and a rate limit; read by admins.
--  3. public.copyright_blocked_media — every storage object a takedown
--     removed. The proxy refuses optimised-image requests for these, because
--     Next.js keeps resized variants for a month and has no way to evict one
--     (src/lib/copyright/blocked-media.ts).
--  4. public.copyright_takedown(...) — the admin's action on a notice, in one
--     transaction, as the signed-in admin with a fresh authenticator step-up:
--       * the named listings are removed from the marketplace (a listing
--         mid-checkout or sold keeps its status; its photos still go);
--       * every photo named, and every photo of those listings, is purged
--         wherever it is held: listing, car, post and mod galleries, avatars,
--         car covers and hotspots, and the photos frozen onto buyers' order
--         snapshots (order_item_snapshot_images);
--       * each object is recorded as blocked and queued for the media worker,
--         which deletes it from storage once nothing references it;
--       * anything still referenced (a post body, a message photo) is
--         returned so the admin can deal with it by hand;
--       * the notice is closed and the audit row written.
--     public.reject_copyright_notice(...) closes a notice with no action.
--
-- The order snapshot is otherwise immutable (0049). Its photos are evidence
-- of what was sold; a valid copyright notice is the one reason that outranks
-- that, and only this function, under an admin's step-up, removes them.
--
-- Idempotent.
-- ============================================================================

begin;

-- ============================================================
-- 1. Report reason
-- ============================================================
alter table public.reports drop constraint if exists reports_reason_check;
alter table public.reports add constraint reports_reason_check check (reason in (
  'prohibited_item', 'counterfeit', 'stolen_goods', 'scam_or_fraud',
  'offensive_content', 'wrong_category', 'copyright', 'other'
));

-- ============================================================
-- 2. Notices
-- ============================================================
create table if not exists public.copyright_notices (
  id                      uuid primary key default gen_random_uuid(),
  claimant_name           text not null check (length(btrim(claimant_name)) between 2 and 200),
  claimant_email          text not null check (length(claimant_email) <= 320 and claimant_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  claimant_address        text not null check (length(btrim(claimant_address)) between 5 and 1000),
  claimant_phone          text check (claimant_phone is null or length(claimant_phone) <= 50),
  -- The rights holder, when the claimant is acting for someone else.
  rights_holder           text check (rights_holder is null or length(rights_holder) <= 200),
  work_description        text not null check (length(btrim(work_description)) between 10 and 4000),
  content_urls            text[] not null check (cardinality(content_urls) between 1 and 20),
  good_faith              boolean not null check (good_faith),
  accurate_and_authorised boolean not null check (accurate_and_authorised),
  signature               text not null check (length(btrim(signature)) between 2 and 200),
  -- Set when the claimant was signed in; a notice needs no account.
  submitted_by            uuid references auth.users (id) on delete set null,
  status                  text not null default 'received' check (status in ('received', 'actioned', 'rejected')),
  resolved_by             uuid references public.profiles (id) on delete set null,
  resolved_at             timestamptz,
  resolution_note         text,
  -- What a takedown removed (copyright_takedown's result).
  takedown                jsonb,
  created_at              timestamptz not null default now()
);

comment on table public.copyright_notices is
  'Copyright notices filed from /copyright (R69-dmca). Server-written; admins read and act. Holds the claimant''s contact details: never public.';

create index if not exists copyright_notices_open_idx on public.copyright_notices (created_at) where status = 'received';
create index if not exists copyright_notices_resolved_by_idx on public.copyright_notices (resolved_by);
create index if not exists copyright_notices_submitted_by_idx on public.copyright_notices (submitted_by);

alter table public.copyright_notices enable row level security;
revoke all on public.copyright_notices from public, anon, authenticated;
grant select, insert on public.copyright_notices to service_role;
grant select on public.copyright_notices to authenticated;
drop policy if exists "admins read copyright notices" on public.copyright_notices;
create policy "admins read copyright notices" on public.copyright_notices
  for select to authenticated
  using ((select public.is_admin()));

create table if not exists public.copyright_blocked_media (
  object_key text primary key check (position('/' in object_key) > 1),
  notice_id  uuid not null references public.copyright_notices (id) on delete restrict,
  blocked_at timestamptz not null default now()
);
comment on table public.copyright_blocked_media is
  'Storage objects ''<bucket>/<path>'' removed by a copyright takedown. The proxy refuses /_next/image for these. Service role only.';
create index if not exists copyright_blocked_media_notice_idx on public.copyright_blocked_media (notice_id);
alter table public.copyright_blocked_media enable row level security;
revoke all on public.copyright_blocked_media from public, anon, authenticated;
grant select on public.copyright_blocked_media to service_role;

-- The media worker's queue learns the new reason.
alter table public.media_cleanup_queue drop constraint if exists media_cleanup_queue_reason_check;
alter table public.media_cleanup_queue add constraint media_cleanup_queue_reason_check
  check (reason in ('car_deleted', 'post_deleted', 'listing_deleted', 'copyright_takedown'));

-- The audit trail names the notice. Built from the constraint as it stands
-- (20261020120000's method), so values other migrations added are kept.
do $$
declare
  v_values text[];
begin
  select array_agg(distinct v order by v) into v_values
  from (
    select (regexp_matches(pg_get_constraintdef(c.oid), '[''{,]([a-z_]+)(?=[''},])', 'g'))[1] as v
    from pg_constraint c
    where c.conrelid = 'public.admin_audit_log'::regclass and c.conname = 'admin_audit_log_subject_type_check'
    union select 'copyright_notice'
  ) x;
  if not v_values @> array['order', 'listing', 'user', 'report', 'dispute', 'payment', 'product_review', 'copyright_notice'] then
    raise exception 'admin_audit_log subject types lost a value: %', v_values;
  end if;
  alter table public.admin_audit_log drop constraint if exists admin_audit_log_subject_type_check;
  execute format('alter table public.admin_audit_log add constraint admin_audit_log_subject_type_check check (subject_type in (%s))',
                 (select string_agg(quote_literal(v), ', ' order by v) from unnest(v_values) v));
end $$;

-- ============================================================
-- 3. The admin's step-up, as resolve_product_identity_review checks it
-- ============================================================
create or replace function private.copyright_admin_step_up()
returns uuid
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_admin() or public.admin_role() is distinct from 'admin' or not exists (
    select 1 from jsonb_array_elements(coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb -> 'amr', '[]'::jsonb)) m
    where m ->> 'method' in ('totp', 'mfa/totp')
      and (m ->> 'timestamp')::numeric between extract(epoch from now()) - 900 and extract(epoch from now()) + 60
  ) then
    raise exception 'Admin step-up required' using errcode = '42501';
  end if;
  return (select auth.uid());
end;
$$;
revoke all on function private.copyright_admin_step_up() from public, anon, authenticated;

-- ============================================================
-- 4. Takedown
-- ============================================================
create or replace function public.copyright_takedown(
  p_notice uuid,
  p_listing_ids uuid[],
  p_media_urls text[],
  p_note text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := private.copyright_admin_step_up();
  v_notice public.copyright_notices;
  v_listings uuid[] := coalesce((select array_agg(distinct x) from unnest(coalesce(p_listing_ids, '{}')) x where x is not null), '{}');
  v_urls text[] := coalesce((select array_agg(distinct btrim(u)) from unnest(coalesce(p_media_urls, '{}')) u where btrim(coalesce(u, '')) <> ''), '{}');
  v_keys text[];
  v_removed uuid[];
  v_kept uuid[];
  v_owners uuid[];
  v_still text[];
  v_n int;
  v_counts jsonb := '{}'::jsonb;
  v_result jsonb;
begin
  if p_note is null or length(btrim(p_note)) < 1 or length(p_note) > 4000 then
    raise exception 'A note of 1–4000 characters is required' using errcode = '22023';
  end if;
  if cardinality(v_listings) + cardinality(v_urls) = 0 then
    raise exception 'Name at least one listing or photo to take down' using errcode = '22023';
  end if;
  if cardinality(v_listings) > 50 or cardinality(v_urls) > 200 then
    raise exception 'Take down at most 50 listings and 200 photos at a time' using errcode = '22023';
  end if;
  if exists (select 1 from unnest(v_urls) u where private.media_object_key(u) is null) then
    raise exception 'Every photo must be a DRVN storage URL' using errcode = '22023';
  end if;

  select * into v_notice from public.copyright_notices where id = p_notice for update;
  if not found then
    raise exception 'Notice not found' using errcode = 'P0002';
  end if;
  if v_notice.status <> 'received' then
    raise exception 'This notice is already closed (%)', v_notice.status using errcode = '55000';
  end if;
  if (select count(*) from public.listings where id = any(v_listings)) <> cardinality(v_listings) then
    raise exception 'A listing named here does not exist' using errcode = 'P0002';
  end if;

  -- Listings: off the marketplace. One a checkout holds, or one already sold,
  -- keeps its status (the order owns it); its photos are purged regardless.
  perform 1 from public.listings where id = any(v_listings) order by id for update;
  with taken as (
    update public.listings
       set status = 'removed', removed_at = now(),
           removed_reason = left('Copyright notice: ' || btrim(p_note), 500)
     where id = any(v_listings) and status not in ('reserved', 'sold', 'removed')
    returning id
  )
  select coalesce(array_agg(id), '{}') into v_removed from taken;
  select coalesce(array_agg(id), '{}') into v_kept
    from public.listings where id = any(v_listings) and not (id = any(v_removed));

  -- Every object: the photos named, and every photo of those listings.
  select coalesce(array_agg(distinct k) filter (where k is not null), '{}') into v_keys
    from (
      select private.media_object_key(u) as k from unnest(v_urls) u
      union all
      select private.media_object_key(li.url) from public.listing_images li where li.listing_id = any(v_listings)
    ) s;

  -- Who held them: told afterwards (the app sends the notices).
  select coalesce(array_agg(distinct o), '{}') into v_owners
    from (
      select seller_id as o from public.listings where id = any(v_listings)
      union all
      select case when split_part(k, '/', 2) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                  then split_part(k, '/', 2)::uuid end
        from unnest(v_keys) k
    ) s
   where o is not null and exists (select 1 from public.profiles p where p.id = o);

  -- Purge every place the object is held. The order snapshot first: it is
  -- the copy a buyer's order would otherwise keep showing for ever.
  delete from public.order_item_snapshot_images where private.media_object_key(url) = any(v_keys);
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('order_snapshot_photos', v_n);
  delete from public.listing_images where private.media_object_key(url) = any(v_keys);
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('listing_photos', v_n);
  delete from public.car_images where private.media_object_key(url) = any(v_keys);
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('car_photos', v_n);
  delete from public.activity_images where private.media_object_key(url) = any(v_keys);
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('post_photos', v_n);
  delete from public.car_hotspots where private.media_object_key(image_url) = any(v_keys);
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('hotspots', v_n);
  update public.mod_items set image_url = null where private.media_object_key(image_url) = any(v_keys);
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('mod_photos', v_n);
  update public.cars set cover_image_url = null where private.media_object_key(cover_image_url) = any(v_keys);
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('car_covers', v_n);
  update public.profiles set avatar_url = null where private.media_object_key(avatar_url) = any(v_keys);
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('avatars', v_n);

  insert into public.copyright_blocked_media (object_key, notice_id)
  select k, p_notice from unnest(v_keys) k
  on conflict (object_key) do nothing;

  -- Storage: the media worker deletes each object once nothing references
  -- it (its own check, under a lock). Only member folders are queued; the
  -- folder names the owner, as every member upload path does.
  insert into public.media_cleanup_queue (bucket, path, owner_id, reason)
  select split_part(k, '/', 1), substr(k, length(split_part(k, '/', 1)) + 2), split_part(k, '/', 2)::uuid, 'copyright_takedown'
    from unnest(v_keys) k
   where split_part(k, '/', 1) in ('avatars', 'car-images', 'activity-images', 'listing-images')
     and split_part(k, '/', 2) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  on conflict (bucket, path) do update
    set enqueued_at = now(), attempts = 0, next_attempt_at = now(), last_error = null,
        reason = excluded.reason, generation = gen_random_uuid()
    where media_cleanup_queue.owner_id = excluded.owner_id;

  -- What this couldn't purge (a post body or a message still names it).
  select coalesce(array_agg(k order by k), '{}') into v_still
    from unnest(v_keys) k
   where public.media_object_referenced(split_part(k, '/', 1), substr(k, length(split_part(k, '/', 1)) + 2));

  v_result := jsonb_build_object(
    'removedListings', to_jsonb(v_removed),
    'keptListingStatus', to_jsonb(v_kept),
    'objects', to_jsonb(v_keys),
    'purged', v_counts,
    'stillReferenced', to_jsonb(v_still),
    'owners', to_jsonb(v_owners)
  );

  update public.copyright_notices
     set status = 'actioned', resolved_by = v_actor, resolved_at = now(), resolution_note = p_note, takedown = v_result
   where id = p_notice;

  insert into public.admin_audit_log (actor_id, action, subject_type, subject_id, reason, metadata)
  values (v_actor, 'copyright.takedown', 'copyright_notice', p_notice, p_note,
          jsonb_build_object('phase', 'completed') || v_result);

  return v_result;
end;
$$;
revoke all on function public.copyright_takedown(uuid, uuid[], text[], text) from public, anon;
grant execute on function public.copyright_takedown(uuid, uuid[], text[], text) to authenticated;

create or replace function public.reject_copyright_notice(p_notice uuid, p_note text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := private.copyright_admin_step_up();
begin
  if p_note is null or length(btrim(p_note)) < 1 or length(p_note) > 4000 then
    raise exception 'A note of 1–4000 characters is required' using errcode = '22023';
  end if;
  update public.copyright_notices
     set status = 'rejected', resolved_by = v_actor, resolved_at = now(), resolution_note = p_note
   where id = p_notice and status = 'received';
  if not found then
    raise exception 'This notice is not open' using errcode = '55000';
  end if;
  insert into public.admin_audit_log (actor_id, action, subject_type, subject_id, reason, metadata)
  values (v_actor, 'copyright.reject', 'copyright_notice', p_notice, p_note, jsonb_build_object('phase', 'completed'));
end;
$$;
revoke all on function public.reject_copyright_notice(uuid, text) from public, anon;
grant execute on function public.reject_copyright_notice(uuid, text) to authenticated;

commit;
