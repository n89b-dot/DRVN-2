-- P-1: followers · following on a profile header, for everyone.
--
-- `follows` is readable only by the follower and by the target's owner
-- (0001 "users manage own follows", 0002 "target owners read follows"), so a
-- visitor counting somebody else's followers through RLS got 0 — or 1, if
-- they happened to follow them. The header needs the two totals and nothing
-- else: never who follows whom. A definer function that returns only the
-- numbers, and only for a profile that is visible, keeps the rows private.
--
-- Idempotent: create or replace.

begin;

create or replace function public.profile_follow_counts(p_profile uuid)
returns table(followers bigint, following bigint)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    (select count(*) from public.follows f
      where f.target_type = 'profile' and f.target_id = p_profile) as followers,
    (select count(*) from public.follows f
      where f.follower_id = p_profile) as following
  where public.profile_is_visible(p_profile);
$$;

revoke all on function public.profile_follow_counts(uuid) from public;
grant execute on function public.profile_follow_counts(uuid) to anon, authenticated, service_role;

commit;
