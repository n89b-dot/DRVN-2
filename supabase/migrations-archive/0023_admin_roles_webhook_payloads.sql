-- ============================================================================
-- 0023 — Console roles + webhook payload retention (console audit follow-ups)
--
-- 1. admin_users.role: 'admin' (full) or 'viewer' (read-only). Membership
--    stays SQL-managed; is_admin() is unchanged (a viewer still passes the
--    read gate — the console layout and RLS read policies serve both). The
--    new admin_role() RPC tells the app WHICH tier, and every server action
--    refuses mutations for viewers.
--
-- 2. webhook_events.payload: the raw Stripe event, kept so the console can
--    show what actually arrived and replay an event through the same
--    idempotent handlers when an investigation needs it. Events recorded
--    before this migration have a null payload and cannot be replayed.
--
-- Idempotent: safe to re-run.
-- ============================================================================

begin;

alter table public.admin_users
  add column if not exists role text not null default 'admin';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'admin_users_role_check' and conrelid = 'public.admin_users'::regclass
  ) then
    alter table public.admin_users
      add constraint admin_users_role_check check (role in ('admin', 'viewer'));
  end if;
end $$;

-- Which tier the caller holds; null when not an admin at all. SECURITY
-- DEFINER for the same reason as is_admin(): admin_users is unreadable by
-- client roles.
create or replace function public.admin_role()
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select au.role from public.admin_users au where au.user_id = auth.uid();
$$;

grant execute on function public.admin_role() to anon, authenticated;

alter table public.webhook_events
  add column if not exists payload jsonb;

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'webhook_events' and column_name = 'payload'
  ) then
    raise exception 'SELF-CHECK FAILED: webhook_events.payload missing';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'admin_users' and column_name = 'role'
  ) then
    raise exception 'SELF-CHECK FAILED: admin_users.role missing';
  end if;
  if public.admin_role() is not null then
    raise exception 'SELF-CHECK FAILED: admin_role() should be null without auth context';
  end if;
  raise notice 'PASS: 0023 self-checks';
end $$;

commit;
