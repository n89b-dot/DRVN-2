-- 20260919193000 — Builders to follow (PRD 2026-09 H-4, E-4).
--
-- Home's rail and Explore's breaker both ask the same question: who should
-- this person follow? The honest answer with no personalisation engine — and
-- the PRD rules one out — is "people who are actually building something,
-- that you don't already follow".
--
-- Ranked by public cars with a cover, then recent published updates. That
-- ordering is the point: it surfaces people who post, not people with the
-- most followers, so a new member with three good updates can be suggested
-- and the same five accounts don't win forever.
--
-- Excludes: the viewer, anyone they already follow, and suspended accounts.
-- Deterministic — no random() — so the list doesn't reshuffle on every
-- render and a breaker that "renders only when it has enough" (E-4) gives
-- the same answer twice.
--
-- Idempotent.

begin;

create or replace function public.suggested_builders(p_viewer uuid default null, p_limit int default 6)
returns table(
  id uuid,
  username text,
  display_name text,
  avatar_url text,
  headline text,
  car_count bigint,
  update_count bigint
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select
    p.id,
    p.username,
    p.display_name,
    p.avatar_url,
    p.headline,
    count(distinct c.id) as car_count,
    count(distinct a.id) as update_count
  from public.profiles p
  join public.cars c
    on c.owner_id = p.id and c.is_public and c.cover_image_url is not null
  left join public.activity_posts a
    on a.car_id = c.id and a.published_at is not null
  where p.username is not null
    and p.suspended_at is null
    and (p_viewer is null or p.id <> p_viewer)
    -- A signed-out visitor follows nobody, so nothing is excluded.
    and not exists (
      select 1 from public.follows f
       where p_viewer is not null
         and f.follower_id = p_viewer
         and f.target_type = 'profile'
         and f.target_id = p.id
    )
  group by p.id, p.username, p.display_name, p.avatar_url, p.headline
  order by count(distinct c.id) desc, count(distinct a.id) desc, p.id
  limit greatest(1, least(p_limit, 24));
$$;

revoke all on function public.suggested_builders(uuid, int) from public;
grant execute on function public.suggested_builders(uuid, int) to anon, authenticated, service_role;

commit;
