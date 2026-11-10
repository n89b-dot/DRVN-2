-- 20261110130000 (report five #110, OS id N662): whether the signed-in member
-- still owes the 18+ answer, asked by the proxy on their next page request.
--   1. An account from before the confirmation, with a handle and no record: due.
--   2. Once confirmed: not due.
--   3. An account from after the confirmation shipped, or with no handle: never due.
--   4. Signed out, or another member: false, never someone else's answer.
-- Transactional; disposable local or CI database only.
begin;

do $$
declare
  v_early uuid := gen_random_uuid();
  v_late uuid := gen_random_uuid();
  v_nohandle uuid := gen_random_uuid();
  fails text[] := '{}';
begin
  insert into auth.users (id, email, created_at) values
    (v_early, 'n662-early@drvn.test', timestamptz '2026-10-01 00:00:00+00'),
    (v_late, 'n662-late@drvn.test', timestamptz '2026-11-09 00:00:00+00'),
    (v_nohandle, 'n662-nohandle@drvn.test', timestamptz '2026-10-01 00:00:00+00');
  update public.profiles set username = 'n662early' where id = v_early;
  update public.profiles set username = 'n662late' where id = v_late;
  update public.profiles set username = null where id = v_nohandle;

  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_early, 'role', 'authenticated')::text, true);
  if not public.my_age_confirmation_due() then
    fails := fails || 'FAIL 1: an earlier member with no confirmation is not asked (N662)'::text;
  end if;

  perform set_config('role', 'postgres', true);
  insert into public.age_confirmations (user_id, source) values (v_early, 'returning_member');
  perform set_config('role', 'authenticated', true);
  if public.my_age_confirmation_due() then
    fails := fails || 'FAIL 2: a confirmed member is still asked (N662)'::text;
  end if;

  perform set_config('request.jwt.claims', json_build_object('sub', v_late, 'role', 'authenticated')::text, true);
  if public.my_age_confirmation_due() then
    fails := fails || 'FAIL 3a: a member who joined after the confirmation shipped is asked (N662)'::text;
  end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_nohandle, 'role', 'authenticated')::text, true);
  if public.my_age_confirmation_due() then
    fails := fails || 'FAIL 3b: a member with no handle (onboarding asks them) is asked here (N662)'::text;
  end if;

  perform set_config('request.jwt.claims', '{}', true);
  if public.my_age_confirmation_due() then
    fails := fails || 'FAIL 4: the answer is true with no signed-in member (N662)'::text;
  end if;
  perform set_config('role', 'postgres', true);
  if has_function_privilege('anon', 'public.my_age_confirmation_due()', 'execute') then
    fails := fails || 'FAIL 4b: a signed-out visitor can call the check (N662)'::text;
  end if;

  if cardinality(fails) > 0 then
    raise exception '% (N662)', array_to_string(fails, E'\n');
  end if;
  raise notice 'all age confirmation due checks passed';
end $$;

rollback;
