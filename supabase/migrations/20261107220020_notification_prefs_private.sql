-- OS-W21 N62: a member's notification settings are theirs alone.
--
-- 0017_lock_payment_columns.sql replaced the table-wide SELECT on profiles
-- with a column list, and that list included notification_prefs for anon and
-- authenticated. Because the public profile policy lets anyone read any
-- visible profile, everyone's notification settings were public
-- (docs/production-readiness-2026-11-03.md §2.3).
--
-- The column is no longer granted to anon or authenticated. A member reads
-- their own settings through my_notification_prefs(), and still writes them
-- through the existing column UPDATE grant (Settings → Notifications). The
-- delivery path reads them with the service role, which keeps full access.

begin;

revoke select (notification_prefs) on public.profiles from anon, authenticated;

create or replace function public.my_notification_prefs()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(p.notification_prefs, '{}'::jsonb)
    from public.profiles p
   where p.id = (select auth.uid());
$$;

revoke all on function public.my_notification_prefs() from public, anon;
grant execute on function public.my_notification_prefs() to authenticated;

comment on function public.my_notification_prefs() is
  'N62: the caller''s own notification settings. The column is not readable by members otherwise.';

commit;
