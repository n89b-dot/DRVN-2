-- 20261107200500 — admin privilege needs an authenticator the operator
-- confirmed (N136, OS-W14).
--
-- An operator promoted a member by inserting an admin_users row. The member
-- then set up TOTP at /admin-verify after a password sign-in, first come,
-- first served: whoever held the password first could enrol their own
-- authenticator and get full console control, and the database counted the
-- membership from the moment the row existed.
--
-- Now a membership counts only once the operator has confirmed which TOTP
-- factor belongs to the person they promoted:
--   * admin_users.mfa_factor_id is the confirmed factor. admin_role() (and so
--     is_admin(), execute_admin_command, reconcile_admin_external_operation
--     and every is_admin() policy) is null until that factor is on file,
--     belongs to the member and is verified. A deleted or replaced factor
--     stops the privilege until the operator confirms again.
--   * admin_enrolment_state() tells the signed-in member whether they are a
--     member awaiting that confirmation ('pending') or confirmed, so
--     /admin-verify can offer enrolment to them and no one else.
--   * confirm_admin_mfa(user, factor, confirmed_by) is the operator's step,
--     service role only (the SQL editor), after checking the factor with
--     the person out of band (docs/production-runbook.md §5).
-- Existing members with exactly one verified TOTP factor are confirmed with
-- it here; anyone else must be confirmed by the operator.
-- assert_admin_actor (0040) is unchanged: it checks the actor the app
-- already identified through admin_role().

begin;

alter table public.admin_users
  add column if not exists mfa_factor_id uuid,
  add column if not exists mfa_confirmed_at timestamptz,
  add column if not exists mfa_confirmed_by text;

comment on column public.admin_users.mfa_factor_id is
  'The TOTP factor (auth.mfa_factors.id) the operator confirmed belongs to this member. Admin privilege needs it present and verified (20261107200500).';

create or replace function private.admin_factor_confirmed(p_user uuid, p_factor uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p_factor is not null and exists (
    select 1 from auth.mfa_factors f
    where f.id = p_factor
      and f.user_id = p_user
      and f.factor_type::text = 'totp'
      and f.status::text = 'verified'
  );
$$;

revoke all on function private.admin_factor_confirmed(uuid, uuid) from public, anon, authenticated;

-- Restated from 20260905135839 with the confirmed-factor condition added.
create or replace function public.admin_role() returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select a.role from public.admin_users a
  where a.user_id = auth.uid()
    and (a.sessions_valid_after is null
      or coalesce((nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'iat')::numeric, 0)
         > extract(epoch from a.sessions_valid_after))
    and private.admin_factor_confirmed(a.user_id, a.mfa_factor_id);
$$;

create or replace function public.admin_enrolment_state() returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select case when private.admin_factor_confirmed(a.user_id, a.mfa_factor_id) then 'confirmed' else 'pending' end
  from public.admin_users a
  where a.user_id = auth.uid();
$$;

revoke all on function public.admin_enrolment_state() from public, anon;
grant execute on function public.admin_enrolment_state() to authenticated;

create or replace function public.confirm_admin_mfa(p_user uuid, p_factor uuid, p_confirmed_by text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_confirmed_by is null or length(trim(p_confirmed_by)) < 3 then
    raise exception 'Say who confirmed the authenticator and how' using errcode = '22023';
  end if;
  if not exists (select 1 from public.admin_users where user_id = p_user) then
    raise exception 'This account is not a console member' using errcode = 'P0002';
  end if;
  if not private.admin_factor_confirmed(p_user, p_factor) then
    raise exception 'That factor is not a verified authenticator of this account' using errcode = '22023';
  end if;
  update public.admin_users
     set mfa_factor_id = p_factor,
         mfa_confirmed_at = now(),
         mfa_confirmed_by = left(trim(p_confirmed_by), 500)
   where user_id = p_user;
  return jsonb_build_object('user', p_user, 'factor', p_factor, 'confirmedAt', now());
end;
$$;

revoke all on function public.confirm_admin_mfa(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.confirm_admin_mfa(uuid, uuid, text) to service_role;

-- Members already in use keep working when exactly one verified TOTP factor
-- is theirs; with none or several the operator confirms the right one.
update public.admin_users a
   set mfa_factor_id = f.factor_id,
       mfa_confirmed_at = now(),
       mfa_confirmed_by = 'migration 20261107200500: the only verified authenticator on file'
  from (
    select user_id, (array_agg(id))[1] as factor_id
    from auth.mfa_factors
    where factor_type::text = 'totp' and status::text = 'verified'
    group by user_id
    having count(*) = 1
  ) f
 where f.user_id = a.user_id
   and a.mfa_factor_id is null;

notify pgrst, 'reload schema';

commit;
