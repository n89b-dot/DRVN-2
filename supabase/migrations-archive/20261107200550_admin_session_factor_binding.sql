-- 20261107200550 — admin privilege binds to the confirmed authenticator,
-- and the audit actor filter is a paged query (OS-W14 follow-up to #87).
--
-- 1. The session, not just the account (P1). 20261107200500 made admin
--    privilege need the TOTP factor the operator confirmed — but only that
--    it EXISTS. An account with two verified factors, A (confirmed) and B,
--    got admin rights in a fresh AAL2 session authenticated with B: the
--    database only checked that A was on file, and the app accepted any
--    recent TOTP check. Whoever held B kept console and RLS access.
--    Supabase Auth records which factor raised each session to AAL2
--    (auth.sessions.factor_id, the JWT's session_id). is_admin() — behind
--    execute_admin_command, reconcile_admin_external_operation, the agent
--    switches, product identity and every is_admin() policy — now also needs
--    that factor to be the confirmed one. admin_role() stays the membership
--    answer (so a member at AAL1 is still sent to verify, not 404'd), and
--    admin_confirmed_factor() tells /admin-verify which factor to challenge.
--
-- 2. The audit actor filter (P2). admin_audit_actor_ids (20261107200520)
--    returned every matching actor id for the app to put in one `in (...)`:
--    a search matching 1,000 historical actors made a ~39 KB URL that was
--    refused, failing the page and the export. admin_audit_page does the
--    filters, actor name included, inside one paged query (offset for the
--    screen, a (created_at, id) cursor for the export). The old function
--    is dropped.

begin;

-- ---------- 1. Session bound to the confirmed factor ----------

-- The factor that raised the caller's current session to AAL2.
create or replace function private.admin_session_factor()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select s.factor_id
  from auth.sessions s
  where s.id = nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'session_id', '')::uuid
    and s.user_id = auth.uid();
$$;

revoke all on function private.admin_session_factor() from public, anon, authenticated;

-- Restated from 20260905135839 with the session-factor condition added.
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'aal', 'aal1') = 'aal2'
    and public.admin_role() is not null
    and exists (
      select 1 from public.admin_users a
      where a.user_id = auth.uid()
        and a.mfa_factor_id is not null
        and a.mfa_factor_id = private.admin_session_factor()
    );
$$;

-- The caller's confirmed factor, for the step-up page to challenge; null
-- for anyone who isn't a confirmed console member.
create or replace function public.admin_confirmed_factor() returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select a.mfa_factor_id from public.admin_users a
  where a.user_id = auth.uid()
    and private.admin_factor_confirmed(a.user_id, a.mfa_factor_id);
$$;

revoke all on function public.admin_confirmed_factor() from public, anon;
grant execute on function public.admin_confirmed_factor() to authenticated;

-- ---------- 2. Audit log, filtered and paged in the database ----------

drop function if exists public.admin_audit_actor_ids(text);

create or replace function public.admin_audit_page(
  p_action text default null,
  p_actor text default null,
  p_subject_type text default null,
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_before_at timestamptz default null,
  p_before_id bigint default null,
  p_offset integer default 0,
  p_limit integer default 50
)
returns setof public.admin_audit_log
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare
  v_action text := nullif(trim(coalesce(p_action, '')), '');
  v_actor text := nullif(trim(coalesce(p_actor, '')), '');
  -- Literal text inside an ILIKE pattern: \ % and _ match themselves.
  v_action_like text := replace(replace(replace(coalesce(v_action, ''), '\', '\\'), '%', '\%'), '_', '\_') || '%';
  v_actor_like text := '%' || replace(replace(replace(coalesce(v_actor, ''), '\', '\\'), '%', '\%'), '_', '\_') || '%';
begin
  if (p_before_at is null) <> (p_before_id is null) then
    raise exception 'A page cursor needs both its time and its id' using errcode = '22023';
  end if;
  return query
  select a.*
  from public.admin_audit_log a
  where (v_action is null or a.action ilike v_action_like)
    and (p_subject_type is null or a.subject_type = p_subject_type)
    and (p_from is null or a.created_at >= p_from)
    and (p_to is null or a.created_at < p_to)
    and (v_actor is null or exists (
          select 1 from public.profiles pr
          where pr.id = a.actor_id
            and (pr.username ilike v_actor_like or pr.display_name ilike v_actor_like)))
    and (p_before_id is null or (a.created_at, a.id) < (p_before_at, p_before_id))
  order by a.created_at desc, a.id desc
  offset greatest(coalesce(p_offset, 0), 0)
  limit least(greatest(coalesce(p_limit, 50), 1), 1000);
end;
$$;

revoke all on function public.admin_audit_page(text, text, text, timestamptz, timestamptz, timestamptz, bigint, integer, integer)
  from public, anon, authenticated;
grant execute on function public.admin_audit_page(text, text, text, timestamptz, timestamptz, timestamptz, bigint, integer, integer)
  to service_role;

notify pgrst, 'reload schema';

commit;
