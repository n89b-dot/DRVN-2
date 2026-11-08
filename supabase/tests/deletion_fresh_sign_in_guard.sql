-- N41 (OS-W12 follow-up): request_account_deletion() refuses a caller whose
-- access token shows no sign-in in the last ten minutes, so an old or stolen
-- token can't queue the cleanup by calling the RPC directly.
begin;
do $$
declare
  uid uuid := gen_random_uuid();
  now_s bigint := extract(epoch from now())::bigint;
  refused boolean;
  claims jsonb;
  stale jsonb[] := array[
    -- signed in an hour ago, refreshed since (refresh keeps the timestamp)
    jsonb_build_object('sub', uid, 'role', 'authenticated', 'iat', now_s,
      'amr', jsonb_build_array(jsonb_build_object('method', 'password', 'timestamp', now_s - 3600))),
    -- eleven minutes: just outside the window
    jsonb_build_object('sub', uid, 'role', 'authenticated',
      'amr', jsonb_build_array(jsonb_build_object('method', 'oauth', 'timestamp', now_s - 660))),
    -- no amr at all
    jsonb_build_object('sub', uid, 'role', 'authenticated'),
    -- the untimed RFC 8176 form proves nothing about when
    jsonb_build_object('sub', uid, 'role', 'authenticated', 'amr', jsonb_build_array('password')),
    -- a timestamp from the future is a clock problem, not a fresh sign-in
    jsonb_build_object('sub', uid, 'role', 'authenticated',
      'amr', jsonb_build_array(jsonb_build_object('method', 'password', 'timestamp', now_s + 3600))),
    -- a malformed timestamp
    jsonb_build_object('sub', uid, 'role', 'authenticated',
      'amr', jsonb_build_array(jsonb_build_object('method', 'password', 'timestamp', 'now')))
  ];
begin
  insert into auth.users(id, email) values (uid, 'deletion-fresh-guard@example.test');

  foreach claims in array stale loop
    perform set_config('role', 'authenticated', true);
    perform set_config('request.jwt.claims', claims::text, true);
    refused := false;
    begin
      perform public.request_account_deletion();
    exception when insufficient_privilege then
      refused := sqlerrm = 'Recent sign-in required';
    end;
    perform set_config('role', 'none', true);
    if not refused then raise exception 'A deletion request without a fresh sign-in was accepted: %', claims; end if;
  end loop;

  -- Nothing was queued, suspended or recorded by the refused calls.
  if exists (select 1 from public.remediation_jobs where dedup_key = 'delete:' || uid) then raise exception 'Refused deletion queued a job'; end if;
  if exists (select 1 from public.profiles where id = uid and suspended_at is not null) then raise exception 'Refused deletion suspended the account'; end if;
  if exists (select 1 from public.account_deletion_requests where user_id = uid) then raise exception 'Refused deletion recorded a request'; end if;

  -- An old password entry plus a Google sign-in a minute ago: fresh.
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', uid, 'role', 'authenticated',
    'amr', jsonb_build_array(
      jsonb_build_object('method', 'password', 'timestamp', now_s - 86400),
      jsonb_build_object('method', 'oauth', 'timestamp', now_s - 60)))::text, true);
  if public.request_account_deletion() ->> 'outcome' <> 'cleanup_pending' then
    raise exception 'A fresh sign-in could not request deletion';
  end if;
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);

  if not exists (select 1 from public.remediation_jobs where dedup_key = 'delete:' || uid and kind = 'delete_account') then
    raise exception 'Fresh deletion was not queued';
  end if;

  -- The helper is not callable by clients.
  if has_function_privilege('authenticated', 'private.signed_in_within(integer)', 'execute')
     or has_function_privilege('anon', 'private.signed_in_within(integer)', 'execute') then
    raise exception 'private.signed_in_within is executable by clients';
  end if;

  raise notice 'all deletion fresh sign-in checks passed';
end $$;
rollback;
