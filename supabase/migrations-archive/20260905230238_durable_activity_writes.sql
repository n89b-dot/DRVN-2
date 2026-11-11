-- Durable activity composer writes.
--
-- Existing installations can contain more than one unpublished row for a
-- car because the old read-then-insert autosave raced. Keep every row: the
-- newest becomes the active draft and older copies are archived in place so
-- their title/body/media references remain available to account export and
-- operator recovery.

alter table public.activity_posts
  add column if not exists draft_key uuid,
  add column if not exists draft_archived_at timestamptz,
  add column if not exists publish_operation_id uuid;

with ranked as (
  select p.id,
         row_number() over (
           partition by p.car_id, p.author_id
           order by p.updated_at desc, p.created_at desc, p.id desc
         ) as position
  from public.activity_posts p
  where p.published_at is null
    and p.draft_archived_at is null
)
update public.activity_posts p
set draft_key = case when ranked.position = 1 then p.car_id else null end,
    draft_archived_at = case when ranked.position = 1 then null else now() end
from ranked
where p.id = ranked.id;

create unique index if not exists activity_posts_one_active_draft_idx
  on public.activity_posts (car_id, author_id)
  where published_at is null and draft_archived_at is null;

create unique index if not exists activity_posts_publish_operation_idx
  on public.activity_posts (author_id, publish_operation_id)
  where publish_operation_id is not null;

comment on column public.activity_posts.draft_archived_at is
  'Older duplicate drafts retained in place during the durable-draft upgrade; excluded from the active composer.';
comment on column public.activity_posts.publish_operation_id is
  'Client-stable UUID used to reconcile a publish whose response was lost.';

create or replace function public.guard_activity_durable_write()
returns trigger
language plpgsql
set search_path = public, extensions, pg_temp
as $$
begin
  if public.is_trusted_writer()
    or current_setting('drvn.activity_write', true) = 'v1'
    or (tg_table_name = 'activity_images' and tg_op = 'DELETE' and pg_trigger_depth() > 1)
  then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  raise exception 'activity content must use the durable write operation'
    using errcode = '42501';
end;
$$;

drop trigger if exists activity_posts_durable_write_guard on public.activity_posts;
create trigger activity_posts_durable_write_guard
  before insert or update on public.activity_posts
  for each row execute function public.guard_activity_durable_write();

drop trigger if exists activity_images_durable_write_guard on public.activity_images;
create trigger activity_images_durable_write_guard
  before insert or update or delete on public.activity_images
  for each row execute function public.guard_activity_durable_write();

create or replace function public.write_activity_post(
  p_mode text,
  p_post_id uuid,
  p_car_id uuid,
  p_title text,
  p_body jsonb default null,
  p_image_urls text[] default null,
  p_intro text default null,
  p_video_url text default null
)
returns table(post_id uuid, outcome text)
language plpgsql
security invoker
set search_path = public, extensions, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_post_id uuid;
  v_post public.activity_posts%rowtype;
  v_existing_images text[];
  v_has_draft boolean;
begin
  if v_user_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if p_mode not in ('draft', 'publish', 'update') then
    raise exception 'invalid activity write mode' using errcode = '22023';
  end if;
  if p_post_id is null or p_car_id is null then
    raise exception 'post and car identity are required' using errcode = '22023';
  end if;
  if char_length(trim(coalesce(p_title, ''))) not between 1 and 160 then
    raise exception 'activity title must contain 1 to 160 characters' using errcode = '22023';
  end if;
  if p_mode in ('draft', 'publish') and jsonb_typeof(p_body) is distinct from 'array' then
    raise exception 'activity body must be an array' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.cars c
    where c.id = p_car_id and c.owner_id = v_user_id
  ) then
    raise exception 'car not found' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('activity:' || v_user_id::text || ':' || p_car_id::text, 0)
  );

  if p_mode = 'update' then
    select p.* into v_post
    from public.activity_posts p
    where p.id = p_post_id
      and p.car_id = p_car_id
      and p.author_id = v_user_id
      and p.published_at is not null
    for update;
    if not found then
      raise exception 'published update not found' using errcode = 'P0002';
    end if;

    perform set_config('drvn.activity_write', 'v1', true);
    update public.activity_posts p
    set title = trim(p_title),
        intro = nullif(trim(coalesce(p_intro, '')), ''),
        video_url = nullif(trim(coalesce(p_video_url, '')), ''),
        body = case when p_body is null then p.body else p_body end
    where p.id = v_post.id;

    if p_body is not null then
      delete from public.activity_images ai where ai.post_id = v_post.id;
      insert into public.activity_images (post_id, url, position)
      select v_post.id, image.url, image.position - 1
      from unnest(coalesce(p_image_urls, array[]::text[])) with ordinality as image(url, position);
    end if;
    perform set_config('drvn.activity_write', '', true);

    return query select v_post.id, 'updated'::text;
    return;
  end if;

  if p_mode = 'publish' then
    -- A response can disappear after commit. The next attempt uses the same
    -- operation UUID and adopts only the exact row and image projection.
    select p.* into v_post
    from public.activity_posts p
    where p.author_id = v_user_id
      and p.car_id = p_car_id
      and p.published_at is not null
      and (p.publish_operation_id = p_post_id or p.id = p_post_id)
    order by (p.publish_operation_id = p_post_id) desc
    limit 1
    for update;
    if found then
      select coalesce(array_agg(ai.url order by ai.position), array[]::text[])
      into v_existing_images
      from public.activity_images ai
      where ai.post_id = v_post.id;
      if v_post.title is distinct from trim(p_title)
        or v_post.body is distinct from p_body
        or v_existing_images is distinct from coalesce(p_image_urls, array[]::text[])
      then
        raise exception 'publish operation content changed' using errcode = '22023';
      end if;
      return query select v_post.id, 'replayed'::text;
      return;
    end if;
  end if;

  if p_mode = 'draft' then
    -- An autosave request can already be in flight when publish begins. If
    -- publish commits first, that older save must not resurrect a new draft.
    select p.* into v_post
    from public.activity_posts p
    where p.author_id = v_user_id
      and p.car_id = p_car_id
      and p.published_at is not null
      and (p.publish_operation_id = p_post_id or p.id = p_post_id)
    order by (p.publish_operation_id = p_post_id) desc
    limit 1
    for update;
    if found then
      return query select v_post.id, 'publish_won'::text;
      return;
    end if;
  end if;

  select p.* into v_post
  from public.activity_posts p
  where p.car_id = p_car_id
    and p.author_id = v_user_id
    and p.published_at is null
    and p.draft_archived_at is null
  limit 1
  for update;
  v_has_draft := found;

  if p_mode = 'draft' then
    perform set_config('drvn.activity_write', 'v1', true);
    if v_has_draft then
      update public.activity_posts p
      set title = trim(p_title), body = p_body, draft_key = p_car_id
      where p.id = v_post.id
      returning p.id into v_post_id;
    else
      insert into public.activity_posts (
        id, car_id, author_id, title, intro, body, published_at, draft_key
      ) values (
        p_post_id, p_car_id, v_user_id, trim(p_title), null, p_body, null, p_car_id
      )
      returning id into v_post_id;
    end if;
    perform set_config('drvn.activity_write', '', true);
    return query select v_post_id, 'draft_saved'::text;
    return;
  end if;

  perform set_config('drvn.activity_write', 'v1', true);
  if v_has_draft then
    update public.activity_posts p
    set title = trim(p_title),
        intro = null,
        body = p_body,
        published_at = clock_timestamp(),
        draft_key = null,
        publish_operation_id = p_post_id
    where p.id = v_post.id
    returning p.id into v_post_id;
  else
    insert into public.activity_posts (
      id, car_id, author_id, title, intro, body, published_at, publish_operation_id
    ) values (
      p_post_id, p_car_id, v_user_id, trim(p_title), null, p_body, clock_timestamp(), p_post_id
    )
    returning id into v_post_id;
  end if;

  delete from public.activity_images ai where ai.post_id = v_post_id;
  insert into public.activity_images (post_id, url, position)
  select v_post_id, image.url, image.position - 1
  from unnest(coalesce(p_image_urls, array[]::text[])) with ordinality as image(url, position);
  perform set_config('drvn.activity_write', '', true);

  return query select v_post_id, 'published'::text;
end;
$$;

revoke all on function public.write_activity_post(text, uuid, uuid, text, jsonb, text[], text, text) from public, anon;
grant execute on function public.write_activity_post(text, uuid, uuid, text, jsonb, text[], text, text) to authenticated;
