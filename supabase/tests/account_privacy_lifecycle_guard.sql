-- OS-W11: the account privacy lifecycle (20261107220400).
--   N39  a member suspended by moderation can still export and delete their
--        data; only a deletion that has begun closes exports
--   N35  a member reads where their own deletion stands, and no one else's
begin;

do $$
declare
  suspended uuid := gen_random_uuid();
  bystander uuid := gen_random_uuid();
  export_id uuid;
  deletion jsonb;
  refused boolean;
  fresh jsonb;
begin
  insert into auth.users(id, email, raw_user_meta_data) values
    (suspended, 'w11-suspended@drvn.test', '{}'),
    (bystander, 'w11-bystander@drvn.test', '{}');
  update public.profiles set suspended_at = now(), suspended_reason = 'Spam listings' where id = suspended;

  if has_function_privilege('anon', 'public.my_account_deletion_status()', 'execute') then
    raise exception 'FAIL 1: visitors can read deletion status';
  end if;
  if has_function_privilege('authenticated', 'private.account_deletion_started(uuid)', 'execute') then
    raise exception 'FAIL 2: members can call the deletion-started check';
  end if;

  -- N39: the suspended member asks for their data.
  fresh := jsonb_build_object('sub', suspended, 'role', 'authenticated',
    'amr', jsonb_build_array(jsonb_build_object('method', 'password', 'timestamp', extract(epoch from now())::bigint)));
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', fresh::text, true);
  export_id := public.request_account_export();
  if export_id is null then raise exception 'FAIL 3: a suspended member could not request their export'; end if;
  if public.my_account_deletion_status() is not null then raise exception 'FAIL 4: a status appeared before any request'; end if;

  -- …and deletion, which now begins.
  deletion := public.request_account_deletion();
  if deletion->>'outcome' <> 'cleanup_pending' then
    raise exception 'FAIL 5: a suspended member could not request deletion (%)', deletion;
  end if;
  if public.my_account_deletion_status()->>'outcome' <> 'cleanup_pending' then
    raise exception 'FAIL 6: the member can''t see their own deletion state';
  end if;
  -- A second request answers with the case, not a refusal.
  if public.request_account_deletion()->>'outcome' <> 'cleanup_pending' then
    raise exception 'FAIL 7: a repeated request did not return the case';
  end if;

  -- Once deletion has begun, no new export: its packages are being destroyed.
  refused := false;
  begin
    perform public.request_account_export();
  exception when insufficient_privilege then refused := true;
  end;
  if not refused then raise exception 'FAIL 8: an export started after deletion began'; end if;
  perform set_config('role', 'none', true);
  if (select status from public.account_export_requests where id = export_id) <> 'expired' then
    raise exception 'FAIL 9: the earlier export package was not expired when deletion began';
  end if;
  -- The deletion stays started on the request record alone, whatever the
  -- profile row later says.
  if not private.account_deletion_started(suspended)
     or not exists (select 1 from public.account_deletion_requests where user_id = suspended and outcome = 'cleanup_pending') then
    raise exception 'FAIL 10: a deleting account is not recognised as deleting';
  end if;

  -- Someone else sees nothing of it.
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', bystander, 'role', 'authenticated')::text, true);
  if public.my_account_deletion_status() is not null then
    raise exception 'FAIL 11: a member read someone else''s deletion state';
  end if;
  perform set_config('role', 'none', true);

  raise notice 'all account privacy lifecycle checks passed';
end $$;

rollback;
