-- 0040 — database-enforced admin actor checks (brief §L).
--
-- The documented weakness: admin mutations run on the service role, which RLS
-- cannot distinguish, so the admin/viewer split (0023) was TypeScript-only. A
-- read-only viewer could not act through the UI, but nothing in the database
-- refused a mutation made in their name.
--
-- Two boundaries move into the database:
--
-- 1. assert_admin_actor(p_actor) — raises unless the actor holds role 'admin'
--    in admin_users. auditedAction (src/lib/admin/audit.ts) calls it BEFORE
--    running any mutation, so every admin action now fails at the database if
--    the named actor is not a full admin — whatever the app layer believed.
--    Service-role only: client roles cannot even probe who is an admin.
--
-- 2. admin_audit_log gains a BEFORE INSERT trigger enforcing that actor_id is
--    a current full admin, for every role including service_role (same
--    posture as guard_audit_append_only). The audit trail can no longer
--    record a viewer — or anyone else — as having acted.
--
-- Future roles (shops, staff, specialized moderators) extend here: the
-- capability registry in src/lib/admin/capabilities.ts names action families,
-- and when a finer-grained role exists, assert_admin_actor grows a
-- p_capability argument checked against a capability table — the call sites
-- do not change shape. Deliberately NOT built now (brief §L: no speculative
-- role machinery).
--
-- Idempotent: create or replace + drop-if-exists trigger. Safe to re-run.

begin;

create or replace function public.assert_admin_actor(p_actor uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_actor is null or not exists (
    select 1 from public.admin_users au
    where au.user_id = p_actor and au.role = 'admin'
  ) then
    raise exception 'actor % is not a full admin — mutation refused', p_actor
      using errcode = '42501';
  end if;
end;
$$;

revoke all on function public.assert_admin_actor(uuid) from public, anon, authenticated;

create or replace function public.guard_audit_actor()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.actor_id is null or not exists (
    select 1 from public.admin_users au
    where au.user_id = new.actor_id and au.role = 'admin'
  ) then
    raise exception 'audit rows can only name full admins as actors (got %)', new.actor_id
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists admin_audit_log_actor_guard on public.admin_audit_log;
create trigger admin_audit_log_actor_guard
  before insert on public.admin_audit_log
  for each row execute function public.guard_audit_actor();

-- ============================================================
-- Self-checks
-- ============================================================
do $$
declare
  v_ok boolean := false;
begin
  if to_regprocedure('public.assert_admin_actor(uuid)') is null then
    raise exception '0040: assert_admin_actor missing';
  end if;

  if not exists (
    select 1 from pg_trigger
    where tgname = 'admin_audit_log_actor_guard'
      and tgrelid = 'public.admin_audit_log'::regclass
  ) then
    raise exception '0040: admin_audit_log_actor_guard trigger missing';
  end if;

  -- The assertion must actually refuse a non-admin uuid.
  begin
    perform public.assert_admin_actor('00000000-0000-0000-0000-000000000000'::uuid);
  exception when insufficient_privilege then
    v_ok := true;
  end;
  if not v_ok then
    raise exception '0040: assert_admin_actor accepted a non-admin actor';
  end if;

  raise notice 'PASS: 0040 self-checks';
end $$;

commit;
