-- 20260919194000 — quick posts, the photo rule and tagged parts
-- (PRD 2026-09 W-1…W-4; build plan WS14a).
--
-- RELEASE-BLOCKING, and the reason this file exists in the shape it does:
-- `write_activity_post` in publish mode finds the car's unpublished draft
-- and converts THAT ROW into the published post. For the full editor that is
-- exactly right — you were writing a draft and now you are publishing it.
-- For a quick post it is catastrophic: somebody halfway through a long
-- update, who fires off a photo and a caption about something else, would
-- find the long one gone and its text replaced by the caption.
--
-- So a quick post gets its own mode, which returns before the draft lookup
-- can run. It is still retry-safe, through the same publish_operation_id the
-- publish path uses, so a lost response replays rather than double-posting.
-- `supabase/tests/activity_quick_post_guard.sql` proves the draft survives
-- byte for byte.
--
-- Also here:
--   * `activity_posts.title` becomes nullable — a quick post is a photo and
--     a caption, and inventing a heading for it would be writing on somebody
--     else's behalf. Readers fall back through `postHeadline()`.
--   * `activity_post_listings` — up to three parts tagged on a post (W-3),
--     as a mirror table rather than only inside the body JSON, so "posts
--     about this part" (W-4) is an indexed lookup rather than a JSON scan.
--   * every NEW publish needs a photo (W-2). Drafts are exempt, and `update`
--     is exempt so a post published before this rule can still be edited.
--
-- Idempotent.

begin;

alter table public.activity_posts
  alter column title drop not null;

comment on column public.activity_posts.title is
  'Optional since the 2026-09 direction: a quick post is a photo and a caption. Readers use postHeadline() rather than assuming a value.';

create table if not exists public.activity_post_listings (
  post_id uuid not null references public.activity_posts (id) on delete cascade,
  listing_id uuid not null references public.listings (id) on delete cascade,
  position int not null default 0,
  created_at timestamptz not null default now(),
  primary key (post_id, listing_id)
);

comment on table public.activity_post_listings is
  'Parts tagged on an update (W-3). Mirrors the body''s listing blocks so "posts about this part" (W-4) is an indexed lookup.';

create index if not exists activity_post_listings_listing_idx
  on public.activity_post_listings (listing_id);

alter table public.activity_post_listings enable row level security;

-- Readable by anyone who can read the post; written only through the
-- function below, which has already checked the author owns the car.
drop policy if exists "tagged parts are public" on public.activity_post_listings;
create policy "tagged parts are public" on public.activity_post_listings
  for select to anon, authenticated using (true);

/**
 * Replace a post's tagged parts.
 *
 * A seller may only tag their OWN active listings: a post is a place to
 * say "this is for sale", not a place to advertise somebody else's stock.
 * Anything that fails that test is dropped silently rather than raising —
 * a listing can sell between opening the composer and pressing publish, and
 * losing the whole post to that would be the wrong trade.
 */
create or replace function public.sync_activity_post_listings(
  p_post_id uuid,
  p_listing_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_author uuid;
begin
  select author_id into v_author from public.activity_posts where id = p_post_id;
  -- Callable directly (the writer above runs as the caller), so it checks
  -- the caller IS the author. Without this, granting execute would let
  -- anyone re-tag anybody's post with that author's own listings.
  if v_author is null or v_author is distinct from auth.uid() then
    return;
  end if;

  delete from public.activity_post_listings where post_id = p_post_id;
  if coalesce(array_length(p_listing_ids, 1), 0) = 0 then
    return;
  end if;

  insert into public.activity_post_listings (post_id, listing_id, position)
  select p_post_id, l.id, tagged.ordinality - 1
    from unnest(p_listing_ids) with ordinality as tagged(listing_id, ordinality)
    join public.listings l
      on l.id = tagged.listing_id
     and l.seller_id = v_author
     and l.status in ('active', 'reserved', 'sold')
  order by tagged.ordinality
  on conflict do nothing;
end;
$$;

revoke all on function public.sync_activity_post_listings(uuid, uuid[]) from public, anon;
grant execute on function public.sync_activity_post_listings(uuid, uuid[]) to authenticated, service_role;

-- Adding a defaulted parameter creates an OVERLOAD, not a replacement, and
-- two candidates make every existing call ambiguous. Drop the old arity
-- explicitly; the new one below takes its place.
drop function if exists public.write_activity_post(text, uuid, uuid, text, jsonb, text[], text, text);


CREATE OR REPLACE FUNCTION public.write_activity_post(p_mode text, p_post_id uuid, p_car_id uuid, p_title text, p_body jsonb DEFAULT NULL::jsonb, p_image_urls text[] DEFAULT NULL::text[], p_intro text DEFAULT NULL::text, p_video_url text DEFAULT NULL::text, p_listing_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS TABLE(post_id uuid, outcome text)
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
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
  if p_mode not in ('draft', 'publish', 'update', 'quick') then
    raise exception 'invalid activity write mode' using errcode = '22023';
  end if;
  if p_post_id is null or p_car_id is null then
    raise exception 'post and car identity are required' using errcode = '22023';
  end if;
  -- W-1: a quick post has no title. Everywhere else a title is still
  -- required, because the full editor asks for one and a blank heading on a
  -- long update reads as a bug rather than a choice.
  if p_mode = 'quick' then
    if char_length(trim(coalesce(p_title, ''))) > 160 then
      raise exception 'activity title must contain 1 to 160 characters' using errcode = '22023';
    end if;
  elsif char_length(trim(coalesce(p_title, ''))) not between 1 and 160 then
    raise exception 'activity title must contain 1 to 160 characters' using errcode = '22023';
  end if;
  if p_mode in ('draft', 'publish', 'quick') and jsonb_typeof(p_body) is distinct from 'array' then
    raise exception 'activity body must be an array' using errcode = '22023';
  end if;
  -- W-2: every NEW publish needs a photo. Drafts are exempt (you write
  -- first and photograph later), and `update` is exempt so a post published
  -- before this rule can still be edited without one.
  if p_mode in ('publish', 'quick')
     and coalesce(array_length(p_image_urls, 1), 0) = 0 then
    raise exception 'a published update needs at least one photo' using errcode = '22023';
  end if;
  if coalesce(array_length(p_listing_ids, 1), 0) > 3 then
    raise exception 'an update can tag at most three parts' using errcode = '22023';
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
    if p_listing_ids is not null then
      perform public.sync_activity_post_listings(v_post.id, p_listing_ids);
    end if;
    perform set_config('drvn.activity_write', '', true);

    return query select v_post.id, 'updated'::text;
    return;
  end if;

  -- ========================================================
  -- W-1, release-blocking: a quick post NEVER touches a draft.
  --
  -- `publish` finds the car's unpublished draft and converts that row into
  -- the published post — which is right for the full editor, and catastrophic
  -- for a quick post: somebody halfway through writing a long update, who
  -- fires off a photo and a caption, would find the long one gone and its
  -- text replaced. So `quick` returns before the draft lookup below ever
  -- runs. It is still retry-safe, through the same publish_operation_id the
  -- publish path uses.
  -- ========================================================
  if p_mode = 'quick' then
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
      return query select v_post.id, 'replayed'::text;
      return;
    end if;

    perform set_config('drvn.activity_write', 'v1', true);
    insert into public.activity_posts (
      id, car_id, author_id, title, intro, body, published_at, publish_operation_id
    ) values (
      p_post_id, p_car_id, v_user_id,
      nullif(trim(coalesce(p_title, '')), ''),
      null, p_body, clock_timestamp(), p_post_id
    )
    returning id into v_post_id;

    insert into public.activity_images (post_id, url, position)
    select v_post_id, image.url, image.position - 1
    from unnest(coalesce(p_image_urls, array[]::text[])) with ordinality as image(url, position);

    perform public.sync_activity_post_listings(v_post_id, p_listing_ids);
    perform set_config('drvn.activity_write', '', true);

    return query select v_post_id, 'published'::text;
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
  perform public.sync_activity_post_listings(v_post_id, p_listing_ids);
  perform set_config('drvn.activity_write', '', true);

  return query select v_post_id, 'published'::text;
end;
$function$;

commit;
