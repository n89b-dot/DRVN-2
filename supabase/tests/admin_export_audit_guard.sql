-- N531 (20261108120000): every console export is on the audit log. An admin
-- session records export.started (view, filters, role) and then
-- export.completed (rows) or export.failed (why), once, on its own export.
-- A read-only viewer's exports are recorded too (who may export is
-- unchanged), but a viewer still can't be named on any other audit row.
-- Nobody records an export in someone else's name or without an admin session.
begin;

do $$
declare
  admin_user uuid := gen_random_uuid();
  viewer uuid := gen_random_uuid();
  civilian uuid := gen_random_uuid();
  admin_factor uuid := gen_random_uuid();
  viewer_factor uuid := gen_random_uuid();
  admin_session uuid := gen_random_uuid();
  viewer_session uuid := gen_random_uuid();
  admin_claims jsonb;
  viewer_claims jsonb;
  export_one uuid;
  export_two uuid;
  export_three uuid;
  r public.admin_audit_log%rowtype;
  rejected boolean := false;
begin
  insert into auth.users(id, email) values
    (admin_user, 'export-audit-admin@example.test'),
    (viewer, 'export-audit-viewer@example.test'),
    (civilian, 'export-audit-civilian@example.test');
  insert into public.admin_users(user_id, role, note) values
    (admin_user, 'admin', 'export audit guard'),
    (viewer, 'viewer', 'export audit guard');
  insert into auth.mfa_factors(id, user_id, friendly_name, factor_type, status, created_at, updated_at) values
    (admin_factor, admin_user, 'DRVN admin', 'totp', 'verified', now(), now()),
    (viewer_factor, viewer, 'DRVN viewer', 'totp', 'verified', now(), now());
  insert into auth.sessions(id, user_id, factor_id, aal, created_at, updated_at) values
    (admin_session, admin_user, admin_factor, 'aal2', now(), now()),
    (viewer_session, viewer, viewer_factor, 'aal2', now(), now());
  perform public.confirm_admin_mfa(admin_user, admin_factor, 'export audit guard: operator confirmed');
  perform public.confirm_admin_mfa(viewer, viewer_factor, 'export audit guard: operator confirmed');

  admin_claims := jsonb_build_object('sub', admin_user, 'role', 'authenticated', 'aal', 'aal2', 'session_id', admin_session,
    'amr', jsonb_build_array(jsonb_build_object('method', 'totp', 'timestamp', extract(epoch from now()))));
  viewer_claims := jsonb_build_object('sub', viewer, 'role', 'authenticated', 'aal', 'aal2', 'session_id', viewer_session,
    'amr', jsonb_build_array(jsonb_build_object('method', 'totp', 'timestamp', extract(epoch from now()))));

  -- 1. A completed export: started before reading, then its row count.
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', admin_claims::text, true);
  export_one := public.record_admin_export('started', 'orders', '{"q": "turbo", "status": "paid"}'::jsonb);
  if export_one is null then raise exception 'FAIL 1: starting an export returned no id'; end if;
  perform public.record_admin_export('completed', p_export => export_one, p_rows => 2500);
  perform set_config('role', 'none', true);

  select * into r from public.admin_audit_log where subject_id = export_one and action = 'export.started';
  if not found or r.actor_id <> admin_user or r.subject_type <> 'export'
     or r.metadata->>'view' <> 'orders' or r.metadata->'filters' <> '{"q": "turbo", "status": "paid"}'::jsonb
     or r.metadata->>'role' <> 'admin' then
    raise exception 'FAIL 2: the start record is wrong: %', to_jsonb(r);
  end if;
  select * into r from public.admin_audit_log where subject_id = export_one and action = 'export.completed';
  if not found or r.actor_id <> admin_user or (r.metadata->>'rows')::int <> 2500 or r.metadata->>'phase' <> 'completed'
     or r.metadata->>'view' <> 'orders' or r.metadata->'filters'->>'q' <> 'turbo' or r.metadata->>'startedAt' is null then
    raise exception 'FAIL 3: the completion record is wrong: %', to_jsonb(r);
  end if;

  -- 2. An export finishes once.
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', admin_claims::text, true);
  begin
    perform public.record_admin_export('failed', p_export => export_one, p_detail => 'late');
  exception when object_not_in_prerequisite_state then rejected := true; end;
  if not rejected then raise exception 'FAIL 4: a finished export was finished again'; end if;
  rejected := false;

  -- 3. A failed export is recorded as failed, with why.
  export_two := public.record_admin_export('started', 'disputes_open', '{}'::jsonb);
  perform public.record_admin_export('failed', p_export => export_two, p_detail => 'read_failed');
  perform set_config('role', 'none', true);
  select * into r from public.admin_audit_log where subject_id = export_two and action = 'export.failed';
  if not found or r.metadata->>'detail' <> 'read_failed' or r.metadata ? 'rows' then
    raise exception 'FAIL 5: the failure record is wrong: %', to_jsonb(r);
  end if;

  -- 4. A viewer may still export (N135 is policy), and is recorded doing so.
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', viewer_claims::text, true);
  export_three := public.record_admin_export('started', 'audit', '{"actor": "dana"}'::jsonb);
  perform public.record_admin_export('completed', p_export => export_three, p_rows => 0);
  perform set_config('role', 'none', true);
  if (select count(*) from public.admin_audit_log where subject_id = export_three and actor_id = viewer) <> 2
     or (select metadata->>'role' from public.admin_audit_log where subject_id = export_three and action = 'export.started') <> 'viewer' then
    raise exception 'FAIL 6: a viewer''s export was not recorded as theirs';
  end if;

  -- 5. Nobody finishes someone else's export.
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', viewer_claims::text, true);
  export_two := public.record_admin_export('started', 'orders', '{}'::jsonb);
  perform set_config('request.jwt.claims', admin_claims::text, true);
  begin
    perform public.record_admin_export('completed', p_export => export_two, p_rows => 1);
  exception when no_data_found then rejected := true; end;
  if not rejected then raise exception 'FAIL 7: an admin finished a viewer''s export'; end if;
  rejected := false;

  -- 6. Only an admin session records: not a step-up-less one, not a civilian.
  perform set_config('request.jwt.claims', (admin_claims || jsonb_build_object('aal', 'aal1'))::text, true);
  begin
    perform public.record_admin_export('started', 'orders', '{}'::jsonb);
  exception when insufficient_privilege then rejected := true; end;
  if not rejected then raise exception 'FAIL 8: an export was recorded without a step-up'; end if;
  rejected := false;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', civilian, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  begin
    perform public.record_admin_export('started', 'orders', '{}'::jsonb);
  exception when insufficient_privilege then rejected := true; end;
  if not rejected then raise exception 'FAIL 9: a civilian recorded an export'; end if;
  rejected := false;

  -- 7. Malformed records are refused.
  perform set_config('request.jwt.claims', admin_claims::text, true);
  begin
    perform public.record_admin_export('started', 'members', '{}'::jsonb);
  exception when invalid_parameter_value then rejected := true; end;
  if not rejected then raise exception 'FAIL 10: an unknown view was recorded'; end if;
  rejected := false;
  export_one := public.record_admin_export('started', 'orders', '{}'::jsonb);
  begin
    perform public.record_admin_export('completed', p_export => export_one);
  exception when invalid_parameter_value then rejected := true; end;
  if not rejected then raise exception 'FAIL 11: a completion without a row count was recorded'; end if;
  rejected := false;
  begin
    perform public.record_admin_export('started', 'orders', '["not", "an", "object"]'::jsonb);
  exception when invalid_parameter_value then rejected := true; end;
  if not rejected then raise exception 'FAIL 12: filters that are not an object were recorded'; end if;
  rejected := false;
  perform set_config('role', 'none', true);

  -- 8. The actor guard still keeps viewers off every other audit row, and
  --    export rows stay export rows.
  begin
    insert into public.admin_audit_log(actor_id, action, subject_type, subject_id, reason)
    values (viewer, 'note.internal', 'user', civilian, 'a viewer acting');
  exception when insufficient_privilege then rejected := true; end;
  if not rejected then raise exception 'FAIL 13: a viewer was named on a non-export audit row'; end if;
  rejected := false;
  begin
    insert into public.admin_audit_log(actor_id, action, subject_type, subject_id, reason)
    values (viewer, 'export.deleted', 'export', gen_random_uuid(), 'not an export phase');
  exception when invalid_parameter_value then rejected := true; end;
  if not rejected then raise exception 'FAIL 14: an export row with another action was accepted'; end if;
  rejected := false;
  begin
    insert into public.admin_audit_log(actor_id, action, subject_type, subject_id, reason)
    values (civilian, 'export.started', 'export', gen_random_uuid(), 'not a member');
  exception when insufficient_privilege then rejected := true; end;
  if not rejected then raise exception 'FAIL 15: a non-member was named on an export row'; end if;
  rejected := false;

  -- 9. Append-only, and closed to signed-out callers.
  begin
    update public.admin_audit_log set reason = 'edited' where subject_id = export_three;
  exception when insufficient_privilege then rejected := true; end;
  if not rejected then raise exception 'FAIL 16: an export record was edited'; end if;
  rejected := false;
  if has_function_privilege('anon', 'public.record_admin_export(text,text,jsonb,uuid,integer,text)', 'execute') then
    raise exception 'FAIL 17: a signed-out caller can record an export';
  end if;

  raise notice 'all admin export audit checks passed';
end $$;

rollback;
