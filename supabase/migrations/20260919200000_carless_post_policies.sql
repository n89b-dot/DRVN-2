-- 20260919200000 — RLS for posts with no car (WS14b, W-5).
--
-- Both activity_posts policies were written when every post had a car, and
-- both express the car requirement as an EXISTS against `cars`:
--
--   insert: auth.uid() = author_id AND exists(car owned by me)
--   select: published AND exists(public car)  OR  auth.uid() = author_id
--
-- So after 197000 made car_id nullable, a carless post could not be written
-- at all, and if it somehow existed only its author could read it. This is
-- the policy half of the same change — not a widening of what anyone may
-- see, but the same rule restated for a post whose subject is a part:
--
--   * INSERT — you must own the car you name. Naming no car is allowed;
--     what makes a carless post legitimate is the tagged part, which the
--     deferred `guard_post_has_subject` trigger (197000) requires at commit
--     and `write_activity_post` (199000) refuses up front.
--   * SELECT — a published post with no car is public. There is no private
--     car to hide behind, and publishing IS the act of making it public;
--     the alternative is a post its author can see and no one else can,
--     which is the silent failure this workstream exists to remove.
--
-- Unpublished drafts stay author-only, exactly as before. A post that HAS a
-- car is unaffected: its car's privacy still decides, clause for clause.
--
-- Idempotent.

begin;

drop policy if exists "published activity readable" on public.activity_posts;
create policy "published activity readable" on public.activity_posts
  for select
  using (
    (
      published_at is not null
      and (
        car_id is null
        or exists (select 1 from public.cars c where c.id = activity_posts.car_id and c.is_public)
      )
    )
    or auth.uid() = author_id
  );

drop policy if exists "authors insert activity" on public.activity_posts;
create policy "authors insert activity" on public.activity_posts
  for insert
  with check (
    auth.uid() = author_id
    and (
      car_id is null
      or exists (select 1 from public.cars c where c.id = activity_posts.car_id and c.owner_id = auth.uid())
    )
  );

-- ============================================================
-- Everything that hangs off a post: images, comments, reactions
-- ============================================================
-- `activity_post_visible()` is the shared answer to "may this person see
-- this post", and comments and reactions both gate on it. It joined cars
-- INNER, so on a carless post it returned false for everyone including the
-- author — nobody could comment, react, or even load the photos.
create or replace function public.activity_post_visible(p_post_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1
    from public.activity_posts p
    left join public.cars c on c.id = p.car_id
    where p.id = p_post_id
      and (
        (p.published_at is not null and (p.car_id is null or c.is_public))
        or p.author_id = auth.uid()
      )
  );
$$;

-- The images policy spells the same rule out by hand rather than calling
-- the function. Restated, not widened.
drop policy if exists "activity images follow post" on public.activity_images;
create policy "activity images follow post" on public.activity_images
  for select
  using (
    exists (
      select 1
      from public.activity_posts p
      left join public.cars c on c.id = p.car_id
      where p.id = activity_images.post_id
        and (
          (p.published_at is not null and (p.car_id is null or c.is_public))
          or p.author_id = auth.uid()
        )
    )
  );

do $$
begin
  if exists (
    select 1 from pg_policy
    where polrelid = 'public.activity_posts'::regclass
      and polname in ('published activity readable', 'authors insert activity')
      and coalesce(pg_get_expr(polwithcheck, polrelid), '') || coalesce(pg_get_expr(polqual, polrelid), '')
          not like '%car_id IS NULL%'
  ) then
    raise exception 'an activity_posts policy still requires a car';
  end if;
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'activity_post_visible'
      and pg_get_functiondef(p.oid) like '%left join%'
  ) then
    raise exception 'activity_post_visible still requires a car';
  end if;
  raise notice '200000 self-checks pass';
end $$;

commit;
