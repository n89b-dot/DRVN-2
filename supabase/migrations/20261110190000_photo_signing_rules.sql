-- ============================================================================
-- 20261110190000 — photo signing signs only what the database guards (N940,
-- report five #105 follow-up; review of #196)
--
-- The app signs a member photo (makes a private object readable) only where
-- it sits in a place listed by private.photo_signable_positions() below, and
-- src/lib/photo-urls.ts (PHOTO_POSITIONS) holds the same list: a vitest
-- compares the two, and supabase/tests/photo_signing_rules_guard.sql compares
-- this list with the triggers the database actually runs. A place is listed
-- only if every value written there, by any writer, names an object in the
-- folder of the row's owner, resolved here from the row's parent (its car,
-- listing, post or order), never from anything the row's own text says.
--
--  1. private.photo_signable_positions() — the list: seven photo columns,
--     a post's body (its images blocks and before/after pairs only), and the
--     RPC answer paths that copy one of those (feed_hydration's cover_url,
--     garage_car_stats' latest_update, seller_listing_stats' cover_url,
--     car_update_page's body).
--  2. private.guard_photo_owner_folder / _body — a write to a listed place,
--     by ANY writer (member, service role, a security-definer function, a
--     seed), that names an object in a signed bucket (car-images,
--     listing-images, activity-images) outside the row owner's folder is
--     refused. The member guards (private.guard_member_media_ref and
--     private.guard_member_post_body_media, 20261107203000, restated by
--     20261110120000) stay as they are and still apply to members only; this
--     adds the owner rule for everyone else. order_item_snapshot_images.url
--     (a buyer's frozen copy of the seller's gallery) is guarded here for the
--     first time: its owner is the order's seller.
--  3. private.activity_body_media (restated) — strings only. A body's photos
--     are the top-level array's blocks of type images with an array `urls`
--     (its string elements) and blocks of type before_after (string
--     beforeUrl / afterUrl). Nothing nested, nothing in another block type.
--     The signer walks exactly this shape (bodyPhotoUrls in
--     src/lib/photo-urls.ts); the guard and a vitest run the same cases.
--  4. Rows written before this that break the rule are moved aside once,
--     into private.photo_refs_quarantined (the whole row, so nothing is
--     lost): gallery, pin and snapshot rows are deleted, a cover or part
--     thumbnail is cleared, a body loses just the offending photos. Each is
--     restorable exactly (private.restore_quarantined_photo_ref). With more
--     than ten in all the migration refuses, with the counts, unless the
--     apply sets drvn.photo_quarantine_confirm to that total. Rows are
--     deleted rather than hidden: the gallery, pin and snapshot tables have
--     no hidden state, and adding one to each (and to every read of them)
--     is a wider change than the handful of rows this moves.
--
-- dispute_evidence.url and the JSON columns (agent_events.inputs/result, a
-- listing's condition checklist, its order copy, every Json-returning RPC)
-- are not listed: the app no longer signs anything in them.
-- Idempotent.
-- ============================================================================

begin;

create schema if not exists private;

-- ---------------------------------------------------------------------------
-- 1. The list. src/lib/photo-urls.ts PHOTO_POSITIONS must equal it.
-- ---------------------------------------------------------------------------
-- kind 'column': relation.field is a photo column.
-- kind 'body':   relation.field is a post body (bodyPhotoUrls' shape).
-- kind 'rpc':    field is a dotted path in the RPC's answer (arrays are
--                walked through) whose value is copied from `source`.
create or replace function private.photo_signable_positions()
returns table(kind text, relation text, field text, source text)
language sql
immutable
set search_path = pg_catalog, pg_temp
as $$
  values
    ('column', 'cars', 'cover_image_url', null::text),
    ('column', 'car_images', 'url', null::text),
    ('column', 'car_hotspots', 'image_url', null::text),
    ('column', 'mod_items', 'image_url', null::text),
    ('column', 'listing_images', 'url', null::text),
    ('column', 'activity_images', 'url', null::text),
    ('column', 'order_item_snapshot_images', 'url', null::text),
    ('body', 'activity_posts', 'body', null::text),
    ('rpc', 'feed_hydration', 'posts.cover_url', 'activity_images.url'),
    ('rpc', 'feed_hydration', 'posts.body', 'activity_posts.body'),
    ('rpc', 'feed_hydration', 'cars.cover_image_url', 'cars.cover_image_url'),
    ('rpc', 'feed_hydration', 'listings.cover_url', 'listing_images.url'),
    ('rpc', 'feed_hydration', 'post_cars.cover_image_url', 'cars.cover_image_url'),
    ('rpc', 'garage_car_stats', 'latest_update.cover_url', 'activity_images.url'),
    ('rpc', 'garage_car_stats', 'latest_update.body', 'activity_posts.body'),
    ('rpc', 'seller_listing_stats', 'cover_url', 'listing_images.url'),
    ('rpc', 'car_update_page', 'body', 'activity_posts.body')
$$;
revoke all on function private.photo_signable_positions() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. The owner rule, for every writer.
-- ---------------------------------------------------------------------------
-- True unless the URL names an object in a signed bucket outside p_owner's
-- folder (any spelling: media_object_key decodes it). Objects in other
-- buckets, and strings that name no object, are not this rule's business:
-- the signer never signs them.
create or replace function private.photo_in_owner_folder(p_url text, p_owner uuid)
returns boolean
language sql
immutable
set search_path = pg_catalog, pg_temp
as $$
  select case
    when p_url is null then true
    when private.media_object_key(p_url) is null then true
    when split_part(private.media_object_key(p_url), '/', 1) not in ('car-images', 'listing-images', 'activity-images') then true
    else p_owner is not null and split_part(private.media_object_key(p_url), '/', 2) = p_owner::text
  end;
$$;
revoke all on function private.photo_in_owner_folder(text, uuid) from public, anon, authenticated;

-- Whose folder a row's photo must be in: 'self:<column>', or the owner of
-- the row's car, listing, post or order item (the order's seller).
create or replace function private.photo_row_owner(p_kind text, p_row jsonb)
returns uuid
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_owner uuid;
begin
  if p_kind like 'self:%' then
    return (p_row ->> substr(p_kind, 6))::uuid;
  elsif p_kind = 'car' then
    select c.owner_id into v_owner from public.cars c where c.id = (p_row ->> 'car_id')::uuid;
  elsif p_kind = 'listing' then
    select l.seller_id into v_owner from public.listings l where l.id = (p_row ->> 'listing_id')::uuid;
  elsif p_kind = 'post' then
    select p.author_id into v_owner from public.activity_posts p where p.id = (p_row ->> 'post_id')::uuid;
  elsif p_kind = 'order_item' then
    select o.seller_id into v_owner
      from public.order_items oi join public.orders o on o.id = oi.order_id
     where oi.id = (p_row ->> 'order_item_id')::uuid;
  else
    raise exception 'Unknown photo owner kind % (N940)', p_kind;
  end if;
  return v_owner;
end;
$$;
revoke all on function private.photo_row_owner(text, jsonb) from public, anon, authenticated;

-- TG_ARGV[0]: the photo column. TG_ARGV[1]: the owner kind.
create or replace function private.guard_photo_owner_folder()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row jsonb := to_jsonb(new);
  v_url text := v_row ->> tg_argv[0];
begin
  if v_url is null then return new; end if;
  if not private.photo_in_owner_folder(v_url, private.photo_row_owner(tg_argv[1], v_row)) then
    raise exception 'A photo on %.% must be in its owner''s own folder (N940)', tg_table_name, tg_argv[0]
      using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_photo_owner_folder() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. A body's photos: one shape, shared with the signer.
-- ---------------------------------------------------------------------------
create or replace function private.activity_body_media(p_body jsonb)
returns text[]
language sql
immutable
set search_path = pg_catalog, pg_temp
as $$
  select coalesce(array_agg(distinct u) filter (where u is not null and u <> ''), '{}')
    from (
      select e #>> '{}' as u
        from jsonb_array_elements(case when jsonb_typeof(p_body) = 'array' then p_body else '[]'::jsonb end) b
        cross join lateral jsonb_array_elements(case when jsonb_typeof(b) = 'object' and jsonb_typeof(b -> 'urls') = 'array' then b -> 'urls' else '[]'::jsonb end) e
       where jsonb_typeof(b) = 'object' and b ->> 'type' = 'images' and jsonb_typeof(e) = 'string'
      union all
      select b ->> 'beforeUrl'
        from jsonb_array_elements(case when jsonb_typeof(p_body) = 'array' then p_body else '[]'::jsonb end) b
       where jsonb_typeof(b) = 'object' and b ->> 'type' = 'before_after' and jsonb_typeof(b -> 'beforeUrl') = 'string'
      union all
      select b ->> 'afterUrl'
        from jsonb_array_elements(case when jsonb_typeof(p_body) = 'array' then p_body else '[]'::jsonb end) b
       where jsonb_typeof(b) = 'object' and b ->> 'type' = 'before_after' and jsonb_typeof(b -> 'afterUrl') = 'string'
    ) s;
$$;
revoke all on function private.activity_body_media(jsonb) from public, anon, authenticated;

create or replace function private.guard_photo_owner_folder_body()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_url text;
begin
  foreach v_url in array private.activity_body_media(new.body) loop
    if not private.photo_in_owner_folder(v_url, new.author_id) then
      raise exception 'A photo in a post must be in its author''s own folder (N940)' using errcode = '42501';
    end if;
  end loop;
  return new;
end;
$$;
revoke all on function private.guard_photo_owner_folder_body() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Rows that already break the rule, moved aside once.
-- ---------------------------------------------------------------------------
create table if not exists private.photo_refs_quarantined (
  id             bigint generated always as identity primary key,
  relation       text not null,
  field          text not null,
  value          text not null,
  row_data       jsonb not null,
  action         text not null check (action in ('deleted', 'cleared', 'stripped')),
  quarantined_at timestamptz not null default now()
);
revoke all on private.photo_refs_quarantined from public, anon, authenticated;
comment on table private.photo_refs_quarantined is
  'Photo references that named another member''s object, moved aside by 20261110190000 (N940). The whole row is kept.';

-- A body without the photos that break the rule: an images block loses
-- those URLs (and goes if none is left); a before/after pair naming one goes.
create or replace function private.body_without_foreign_photos(p_body jsonb, p_author uuid)
returns jsonb
language sql
immutable
set search_path = pg_catalog, pg_temp
as $$
  select case when jsonb_typeof(p_body) <> 'array' then p_body else coalesce((
    select jsonb_agg(blk order by ord) from (
      select ord,
             case when jsonb_typeof(b) = 'object' and b ->> 'type' = 'images' and jsonb_typeof(b -> 'urls') = 'array'
                  then jsonb_set(b, '{urls}', coalesce((
                         select jsonb_agg(u order by n) from jsonb_array_elements(b -> 'urls') with ordinality x(u, n)
                          where jsonb_typeof(u) <> 'string' or private.photo_in_owner_folder(u #>> '{}', p_author)), '[]'::jsonb))
                  else b end as blk
        from jsonb_array_elements(p_body) with ordinality t(b, ord)
       where not (jsonb_typeof(b) = 'object' and b ->> 'type' = 'before_after'
                  and ((jsonb_typeof(b -> 'beforeUrl') = 'string' and not private.photo_in_owner_folder(b ->> 'beforeUrl', p_author))
                    or (jsonb_typeof(b -> 'afterUrl') = 'string' and not private.photo_in_owner_folder(b ->> 'afterUrl', p_author))))
    ) s
    where not (jsonb_typeof(blk) = 'object' and blk ->> 'type' = 'images' and jsonb_typeof(blk -> 'urls') = 'array'
               and jsonb_array_length(blk -> 'urls') = 0)
  ), '[]'::jsonb) end;
$$;
revoke all on function private.body_without_foreign_photos(jsonb, uuid) from public, anon, authenticated;

-- How many references it moved aside. Runs as the migration's owner (a
-- trusted writer), so the durable-write and listing-edit guards admit it.
create or replace function private.quarantine_foreign_photo_refs()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  n integer := 0;
  c integer;
  v_write text := current_setting('drvn.activity_write', true);
begin
  with bad as (
    select ci.id, ci.url, to_jsonb(ci) as row_data from public.car_images ci
      left join public.cars c on c.id = ci.car_id
     where not private.photo_in_owner_folder(ci.url, c.owner_id)
  ), moved as (
    insert into private.photo_refs_quarantined (relation, field, value, row_data, action)
    select 'car_images', 'url', url, row_data, 'deleted' from bad returning 1
  ), gone as (delete from public.car_images where id in (select id from bad) returning 1)
  select (select count(*) from moved) into c;
  n := n + c;

  with bad as (
    select h.id, h.image_url, to_jsonb(h) as row_data from public.car_hotspots h
      left join public.cars c on c.id = h.car_id
     where not private.photo_in_owner_folder(h.image_url, c.owner_id)
  ), moved as (
    insert into private.photo_refs_quarantined (relation, field, value, row_data, action)
    select 'car_hotspots', 'image_url', image_url, row_data, 'deleted' from bad returning 1
  ), gone as (delete from public.car_hotspots where id in (select id from bad) returning 1)
  select (select count(*) from moved) into c;
  n := n + c;

  with bad as (
    select li.id, li.url, to_jsonb(li) as row_data from public.listing_images li
      left join public.listings l on l.id = li.listing_id
     where not private.photo_in_owner_folder(li.url, l.seller_id)
  ), moved as (
    insert into private.photo_refs_quarantined (relation, field, value, row_data, action)
    select 'listing_images', 'url', url, row_data, 'deleted' from bad returning 1
  ), gone as (delete from public.listing_images where id in (select id from bad) returning 1)
  select (select count(*) from moved) into c;
  n := n + c;

  perform set_config('drvn.activity_write', 'v1', true);
  with bad as (
    select ai.id, ai.url, to_jsonb(ai) as row_data from public.activity_images ai
      left join public.activity_posts p on p.id = ai.post_id
     where not private.photo_in_owner_folder(ai.url, p.author_id)
  ), moved as (
    insert into private.photo_refs_quarantined (relation, field, value, row_data, action)
    select 'activity_images', 'url', url, row_data, 'deleted' from bad returning 1
  ), gone as (delete from public.activity_images where id in (select id from bad) returning 1)
  select (select count(*) from moved) into c;
  n := n + c;

  with bad as (
    select p.id, u.url, to_jsonb(p) as row_data
      from public.activity_posts p
      cross join lateral unnest(private.activity_body_media(p.body)) u(url)
     where strpos(p.body::text, '/storage/v1/') > 0
       and not private.photo_in_owner_folder(u.url, p.author_id)
  ), moved as (
    insert into private.photo_refs_quarantined (relation, field, value, row_data, action)
    select 'activity_posts', 'body', url, row_data, 'stripped' from bad returning 1
  ), fixed as (
    update public.activity_posts p
       set body = private.body_without_foreign_photos(p.body, p.author_id)
     where p.id in (select id from bad) returning 1
  )
  select (select count(*) from moved) into c;
  n := n + c;
  perform set_config('drvn.activity_write', coalesce(v_write, ''), true);

  with bad as (
    select s.id, s.url, to_jsonb(s) as row_data from public.order_item_snapshot_images s
      left join public.order_items oi on oi.id = s.order_item_id
      left join public.orders o on o.id = oi.order_id
     where not private.photo_in_owner_folder(s.url, o.seller_id)
  ), moved as (
    insert into private.photo_refs_quarantined (relation, field, value, row_data, action)
    select 'order_item_snapshot_images', 'url', url, row_data, 'deleted' from bad returning 1
  ), gone as (delete from public.order_item_snapshot_images where id in (select id from bad) returning 1)
  select (select count(*) from moved) into c;
  n := n + c;

  with bad as (
    select c2.id, c2.cover_image_url, to_jsonb(c2) as row_data from public.cars c2
     where not private.photo_in_owner_folder(c2.cover_image_url, c2.owner_id)
  ), moved as (
    insert into private.photo_refs_quarantined (relation, field, value, row_data, action)
    select 'cars', 'cover_image_url', cover_image_url, row_data, 'cleared' from bad returning 1
  ), fixed as (update public.cars set cover_image_url = null where id in (select id from bad) returning 1)
  select (select count(*) from moved) into c;
  n := n + c;

  with bad as (
    select m.id, m.image_url, to_jsonb(m) as row_data from public.mod_items m
      left join public.cars c on c.id = m.car_id
     where not private.photo_in_owner_folder(m.image_url, c.owner_id)
  ), moved as (
    insert into private.photo_refs_quarantined (relation, field, value, row_data, action)
    select 'mod_items', 'image_url', image_url, row_data, 'cleared' from bad returning 1
  ), fixed as (update public.mod_items set image_url = null where id in (select id from bad) returning 1)
  select (select count(*) from moved) into c;
  n := n + c;

  return n;
end;
$$;
revoke all on function private.quarantine_foreign_photo_refs() from public, anon, authenticated;

-- How many references the step would move, per place, before anything moves.
create or replace function private.foreign_photo_ref_counts()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'car_images', nullif((select count(*) from public.car_images ci left join public.cars c on c.id = ci.car_id
                           where not private.photo_in_owner_folder(ci.url, c.owner_id)), 0),
    'car_hotspots', nullif((select count(*) from public.car_hotspots h left join public.cars c on c.id = h.car_id
                             where not private.photo_in_owner_folder(h.image_url, c.owner_id)), 0),
    'listing_images', nullif((select count(*) from public.listing_images li left join public.listings l on l.id = li.listing_id
                               where not private.photo_in_owner_folder(li.url, l.seller_id)), 0),
    'activity_images', nullif((select count(*) from public.activity_images ai left join public.activity_posts p on p.id = ai.post_id
                                where not private.photo_in_owner_folder(ai.url, p.author_id)), 0),
    'activity_posts.body', nullif((select count(*) from public.activity_posts p cross join lateral unnest(private.activity_body_media(p.body)) u(url)
                                    where strpos(p.body::text, '/storage/v1/') > 0 and not private.photo_in_owner_folder(u.url, p.author_id)), 0),
    'order_item_snapshot_images', nullif((select count(*) from public.order_item_snapshot_images s
                                           left join public.order_items oi on oi.id = s.order_item_id left join public.orders o on o.id = oi.order_id
                                           where not private.photo_in_owner_folder(s.url, o.seller_id)), 0),
    'cars.cover_image_url', nullif((select count(*) from public.cars c2 where not private.photo_in_owner_folder(c2.cover_image_url, c2.owner_id)), 0),
    'mod_items.image_url', nullif((select count(*) from public.mod_items m left join public.cars c on c.id = m.car_id
                                    where not private.photo_in_owner_folder(m.image_url, c.owner_id)), 0)
  ));
$$;
revoke all on function private.foreign_photo_ref_counts() from public, anon, authenticated;

-- Puts one quarantined reference back exactly as it was (the whole row, the
-- cleared column, or the post's body as it was), for an operator who finds a
-- row moved aside wrongly. The triggers below still apply, so a row that
-- still breaks the rule is refused.
create or replace function private.restore_quarantined_photo_ref(p_id bigint)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  q private.photo_refs_quarantined%rowtype;
begin
  select * into strict q from private.photo_refs_quarantined where id = p_id for update;
  if q.action = 'deleted' then
    execute format('insert into public.%I select * from jsonb_populate_record(null::public.%I, $1)', q.relation, q.relation) using q.row_data;
  elsif q.action = 'cleared' then
    execute format('update public.%I set %I = $1 where id = ($2 ->> ''id'')::uuid', q.relation, q.field) using q.value, q.row_data;
  else
    perform set_config('drvn.activity_write', 'v1', true);
    update public.activity_posts set body = q.row_data -> 'body' where id = (q.row_data ->> 'id')::uuid;
  end if;
  delete from private.photo_refs_quarantined where id = p_id;
  return q.relation || '.' || q.field || ' ' || q.action || ' row restored';
end;
$$;
revoke all on function private.restore_quarantined_photo_ref(bigint) from public, anon, authenticated;

-- Refuses to move more than a few references silently: with more than ten,
-- an operator checks the counts and sets drvn.photo_quarantine_confirm to the
-- total for that apply, so a first apply on production can never drop rows
-- unseen. Rerunning is safe: once moved, nothing is left to count.
do $$
declare
  counts jsonb := private.foreign_photo_ref_counts();
  total integer := (select coalesce(sum(value::integer), 0) from jsonb_each_text(counts));
  confirm text := nullif(current_setting('drvn.photo_quarantine_confirm', true), '');
  n integer;
begin
  if total > 10 and confirm is distinct from total::text then
    raise exception '20261110190000: % photo reference(s) outside their owner''s folder would be moved aside: %. Check them, then apply with drvn.photo_quarantine_confirm = ''%'' (N940)', total, counts, total;
  end if;
  n := private.quarantine_foreign_photo_refs();
  raise notice '20261110190000: % photo reference(s) outside their owner''s folder moved to private.photo_refs_quarantined (%); restore one with private.restore_quarantined_photo_ref(id)', n, counts;
end $$;

-- The triggers, one per listed place (the guard reads them back from
-- pg_trigger by this name and function).
drop trigger if exists photo_owner_folder_guard on public.cars;
create trigger photo_owner_folder_guard before insert or update of cover_image_url on public.cars
  for each row execute function private.guard_photo_owner_folder('cover_image_url', 'self:owner_id');
drop trigger if exists photo_owner_folder_guard on public.car_images;
create trigger photo_owner_folder_guard before insert or update of url, car_id on public.car_images
  for each row execute function private.guard_photo_owner_folder('url', 'car');
drop trigger if exists photo_owner_folder_guard on public.car_hotspots;
create trigger photo_owner_folder_guard before insert or update of image_url, car_id on public.car_hotspots
  for each row execute function private.guard_photo_owner_folder('image_url', 'car');
drop trigger if exists photo_owner_folder_guard on public.mod_items;
create trigger photo_owner_folder_guard before insert or update of image_url, car_id on public.mod_items
  for each row execute function private.guard_photo_owner_folder('image_url', 'car');
drop trigger if exists photo_owner_folder_guard on public.listing_images;
create trigger photo_owner_folder_guard before insert or update of url, listing_id on public.listing_images
  for each row execute function private.guard_photo_owner_folder('url', 'listing');
drop trigger if exists photo_owner_folder_guard on public.activity_images;
create trigger photo_owner_folder_guard before insert or update of url, post_id on public.activity_images
  for each row execute function private.guard_photo_owner_folder('url', 'post');
drop trigger if exists photo_owner_folder_guard on public.order_item_snapshot_images;
create trigger photo_owner_folder_guard before insert or update of url, order_item_id on public.order_item_snapshot_images
  for each row execute function private.guard_photo_owner_folder('url', 'order_item');
drop trigger if exists photo_owner_folder_guard on public.activity_posts;
create trigger photo_owner_folder_guard before insert or update of body, author_id on public.activity_posts
  for each row execute function private.guard_photo_owner_folder_body();

-- Self-check: every listed column has its trigger.
do $$
declare
  missing text;
begin
  select string_agg(p.relation || '.' || p.field, ', ') into missing
    from private.photo_signable_positions() p
   where p.kind in ('column', 'body')
     and not exists (
       select 1 from pg_trigger t
        where t.tgrelid = format('public.%I', p.relation)::regclass
          and t.tgname = 'photo_owner_folder_guard' and t.tgenabled <> 'D');
  if missing is not null then
    raise exception '20261110190000: no owner-folder guard on % (N940)', missing;
  end if;
  raise notice 'PASS: 20261110190000 self-checks';
end $$;

commit;
