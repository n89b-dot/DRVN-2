-- N136 (20261107200500, 20261107200550): admin privilege needs an authenticator
-- the operator confirmed, and a session raised to AAL2 with that factor. A
-- promoted member with no confirmed factor is "pending": no admin_role, no
-- is_admin, no admin command, step-up or not. The operator's
-- confirm_admin_mfa binds a verified factor of that member, and losing that
-- factor ends the privilege until the operator confirms again.
begin;

do $$
declare
  member uuid := gen_random_uuid();
  civilian uuid := gen_random_uuid();
  stranger uuid := gen_random_uuid();
  member_factor uuid := gen_random_uuid();
  pending_factor uuid := gen_random_uuid();
  stranger_factor uuid := gen_random_uuid();
  other_factor uuid := gen_random_uuid();
  session_a uuid := gen_random_uuid();
  session_b uuid := gen_random_uuid();
  claims jsonb;
  rejected boolean := false;
begin
  insert into auth.users(id, email) values
    (member, 'enrolment-member@example.test'),
    (civilian, 'enrolment-civilian@example.test'),
    (stranger, 'enrolment-stranger@example.test');
  -- The operator promotes the member: a row, and nothing confirmed yet.
  insert into public.admin_users(user_id, role, note) values (member, 'admin', 'enrolment guard');
  insert into auth.mfa_factors(id, user_id, friendly_name, factor_type, status, created_at, updated_at) values
    (pending_factor, member, 'unfinished', 'totp', 'unverified', now(), now()),
    (stranger_factor, stranger, 'stranger', 'totp', 'verified', now(), now());

  claims := jsonb_build_object('sub', member, 'role', 'authenticated', 'aal', 'aal2', 'session_id', session_a,
    'amr', jsonb_build_array(jsonb_build_object('method', 'totp', 'timestamp', extract(epoch from now()))));

  -- 1. Pending: a stepped-up session still has no admin privilege.
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', claims::text, true);
  if public.admin_role() is not null then raise exception 'FAIL 1: an unconfirmed member has an admin role'; end if;
  if public.is_admin() then raise exception 'FAIL 2: an unconfirmed member passes is_admin'; end if;
  if public.admin_enrolment_state() is distinct from 'pending' then
    raise exception 'FAIL 3: an unconfirmed member is not pending (%)', public.admin_enrolment_state();
  end if;
  begin
    perform public.execute_admin_command('note.internal', civilian, 'pending member tries a command');
  exception when insufficient_privilege then rejected := true; end;
  if not rejected then raise exception 'FAIL 4: an unconfirmed member ran an admin command'; end if;
  rejected := false;

  -- 2. Not a member at all: no state, no role.
  perform set_config('request.jwt.claims', (claims || jsonb_build_object('sub', civilian))::text, true);
  if public.admin_enrolment_state() is not null then raise exception 'FAIL 5: a civilian has an enrolment state'; end if;
  if public.admin_role() is not null then raise exception 'FAIL 6: a civilian has an admin role'; end if;

  -- 3. Only the service role confirms, and only a verified factor of that member.
  perform set_config('role', 'none', true);
  if has_function_privilege('authenticated', 'public.confirm_admin_mfa(uuid,uuid,text)', 'execute')
     or has_function_privilege('anon', 'public.confirm_admin_mfa(uuid,uuid,text)', 'execute') then
    raise exception 'FAIL 7: a client role can confirm an authenticator';
  end if;
  if has_function_privilege('anon', 'public.admin_enrolment_state()', 'execute')
     or has_function_privilege('anon', 'public.admin_confirmed_factor()', 'execute') then
    raise exception 'FAIL 8: a signed-out caller can read enrolment state';
  end if;
  begin
    perform public.confirm_admin_mfa(member, pending_factor, 'operator phoned the member');
  exception when invalid_parameter_value then rejected := true; end;
  if not rejected then raise exception 'FAIL 9: an unverified factor was confirmed'; end if;
  rejected := false;
  begin
    perform public.confirm_admin_mfa(member, stranger_factor, 'operator phoned the member');
  exception when invalid_parameter_value then rejected := true; end;
  if not rejected then raise exception 'FAIL 10: someone else''s factor was confirmed'; end if;
  rejected := false;
  begin
    perform public.confirm_admin_mfa(civilian, stranger_factor, 'operator phoned the member');
  exception when no_data_found then rejected := true; end;
  if not rejected then raise exception 'FAIL 11: a non-member was confirmed'; end if;
  rejected := false;
  begin
    perform public.confirm_admin_mfa(member, pending_factor, '');
  exception when invalid_parameter_value then rejected := true; end;
  if not rejected then raise exception 'FAIL 12: a confirmation without who and how was accepted'; end if;
  rejected := false;

  -- 4. The member finishes enrolment; the operator confirms that factor.
  insert into auth.mfa_factors(id, user_id, friendly_name, factor_type, status, created_at, updated_at)
  values (member_factor, member, 'DRVN admin', 'totp', 'verified', now(), now());
  -- The member's session was raised to AAL2 with that factor.
  insert into auth.sessions(id, user_id, factor_id, aal, created_at, updated_at)
  values (session_a, member, member_factor, 'aal2', now(), now());
  -- Verified is not enough on its own: still pending until confirmed.
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', claims::text, true);
  if public.admin_role() is not null then raise exception 'FAIL 13: a verified but unconfirmed factor gave admin'; end if;
  perform set_config('role', 'none', true);
  perform public.confirm_admin_mfa(member, member_factor, 'operator phoned the member and matched the reference');
  if (select mfa_factor_id from public.admin_users where user_id = member) <> member_factor then
    raise exception 'FAIL 14: the confirmed factor was not recorded';
  end if;

  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', claims::text, true);
  if public.admin_role() is distinct from 'admin' then raise exception 'FAIL 15: a confirmed member has no admin role'; end if;
  if not public.is_admin() then raise exception 'FAIL 16: a confirmed member fails is_admin'; end if;
  if public.admin_enrolment_state() is distinct from 'confirmed' then raise exception 'FAIL 17: a confirmed member is not confirmed'; end if;
  perform set_config('request.jwt.claims', (claims || jsonb_build_object('aal', 'aal1'))::text, true);
  if public.is_admin() then raise exception 'FAIL 18: a confirmed member passes is_admin without a step-up'; end if;
  perform set_config('request.jwt.claims', claims::text, true);
  if public.admin_confirmed_factor() is distinct from member_factor then
    raise exception 'FAIL 18a: the step-up page would not challenge the confirmed factor';
  end if;

  -- 4b. A second verified factor B (someone else's, enrolled first-come) is
  --     not the confirmed one: a fresh AAL2 session raised with B is no admin,
  --     in policies and in commands, though the membership stands.
  perform set_config('role', 'none', true);
  insert into auth.mfa_factors(id, user_id, friendly_name, factor_type, status, created_at, updated_at)
  values (other_factor, member, 'not confirmed', 'totp', 'verified', now(), now());
  insert into auth.sessions(id, user_id, factor_id, aal, created_at, updated_at)
  values (session_b, member, other_factor, 'aal2', now(), now());
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', (claims || jsonb_build_object('session_id', session_b))::text, true);
  if public.is_admin() then raise exception 'FAIL 18b: a session raised with an unconfirmed factor passes is_admin'; end if;
  if public.admin_role() is distinct from 'admin' then raise exception 'FAIL 18c: the membership itself was lost'; end if;
  begin
    perform public.execute_admin_command('note.internal', civilian, 'session raised with factor B');
  exception when insufficient_privilege then rejected := true; end;
  if not rejected then raise exception 'FAIL 18d: a session raised with an unconfirmed factor ran an admin command'; end if;
  rejected := false;
  -- No session id, or someone else's session: no admin either.
  perform set_config('request.jwt.claims', (claims - 'session_id')::text, true);
  if public.is_admin() then raise exception 'FAIL 18e: a token without a session passes is_admin'; end if;
  perform set_config('request.jwt.claims', (claims || jsonb_build_object('sub', civilian))::text, true);
  if public.is_admin() then raise exception 'FAIL 18f: another account''s session passed is_admin'; end if;
  -- The confirmed factor's session still is.
  perform set_config('request.jwt.claims', claims::text, true);
  if not public.is_admin() then raise exception 'FAIL 18g: the confirmed factor''s session lost admin'; end if;

  -- 5. The confirmed factor goes away (lost phone, unenrolled): privilege ends,
  --    and a factor added afterwards needs the operator again.
  perform set_config('role', 'none', true);
  delete from auth.mfa_factors where id = member_factor;
  insert into auth.mfa_factors(id, user_id, friendly_name, factor_type, status, created_at, updated_at)
  values (gen_random_uuid(), member, 'replacement', 'totp', 'verified', now(), now());
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', claims::text, true);
  if public.admin_role() is not null then raise exception 'FAIL 19: privilege survived losing the confirmed factor'; end if;
  if public.admin_enrolment_state() is distinct from 'pending' then raise exception 'FAIL 20: a member without the confirmed factor is not pending'; end if;

  perform set_config('role', 'none', true);
  raise notice 'all admin enrolment checks passed';
end $$;

rollback;
