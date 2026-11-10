-- ============================================================================
-- Admin guard verification (0018)
--
-- Proves the properties the admin console's safety rests on:
--   * admin_users is unreachable and unwritable from client roles
--   * is_admin() is false for civilians and for null-uid contexts
--   * the audit log is append-only for every role, and invisible to non-admins
--   * suspension and takedown cannot be set, cleared, or read by their subject
--   * a suspended seller's stock leaves browse; their own view survives
--   * admins read cross-user rows through ordinary RLS
--
-- Same contract as purchase_guard.sql: run against a NON-PRODUCTION database;
-- everything rolls back; raises on failure, NOTICEs on success. Impersonation
-- uses transaction-local set_config('role', …) + request.jwt.claims, i.e. the
-- same mechanism PostgREST uses — not SECURITY DEFINER shortcuts.
-- ============================================================================

begin;

-- plpgsql has no nested procedures, so the impersonation helpers live in
-- pg_temp; the rollback removes them with everything else.
create function pg_temp.impersonate(uid uuid) returns void
language sql as $$
  select set_config('role', 'authenticated', true);
  select set_config(
    'request.jwt.claims',
    json_build_object('sub', uid::text, 'role', 'authenticated', 'aal', 'aal2', 'session_id', uid::text)::text,
    true
  );
$$;

-- 'none' = SET ROLE NONE: back to the session user (supabase_admin in CI,
-- postgres against a live project) — both trusted writers.
create function pg_temp.back_to_admin() returns void
language sql as $$
  select set_config('role', 'none', true);
  select set_config('request.jwt.claims', '', true);
$$;

-- This guard's own helpers are called while acting as other roles. A new
-- function is closed by default (20261110170000), so they are opened here.
grant execute on all routines in schema pg_temp to public;

do $$
declare
  v_admin    uuid := gen_random_uuid();
  v_civilian uuid := gen_random_uuid();
  v_seller   uuid := gen_random_uuid();
  v_listing  uuid;
  v_order    uuid;
  v_report   uuid;
  v_count    int;
begin
  -- ---------- fixtures ----------
  insert into auth.users (id, email) values
    (v_admin, 'admin-guard-admin@example.test'),
    (v_civilian, 'admin-guard-civilian@example.test'),
    (v_seller, 'admin-guard-seller@example.test');

  update public.profiles set username = 'ag_admin'    where id = v_admin;
  update public.profiles set username = 'ag_civilian' where id = v_civilian;
  update public.profiles set username = 'ag_seller'   where id = v_seller;

  insert into public.listings
    (seller_id, title, category, price_cents, shipping_cents, status, currency)
  values
    (v_seller, 'Admin guard manifold', 'engine', 30000, 1000, 'active', 'USD')
  returning id into v_listing;

  insert into public.orders (buyer_id, seller_id, status, subtotal_cents, platform_fee_cents, shipping_cents, total_cents, currency)
  values (v_civilian, v_seller, 'paid', 30000, 3000, 1000, 31000, 'USD')
  returning id into v_order;

  -- A confirmed authenticator (20261107200500): without one no admin privilege.
  insert into auth.mfa_factors(id, user_id, friendly_name, factor_type, status, created_at, updated_at) values (gen_random_uuid(), v_admin, 'guard', 'totp', 'verified', now(), now());
  insert into public.admin_users (user_id, note, mfa_factor_id) select v_admin, 'guard fixture', id from auth.mfa_factors where user_id = v_admin;
  -- Its session was raised to AAL2 with that factor (20261107200550); the claims carry it.
  insert into auth.sessions(id, user_id, factor_id, aal, created_at, updated_at) select f.user_id, f.user_id, f.id, 'aal2', now(), now() from auth.mfa_factors f where f.user_id = v_admin;

  -- ---------- 1. admin_users unreachable from client roles ----------
  perform pg_temp.impersonate(v_civilian);
  begin
    perform * from public.admin_users;
    raise exception 'FAIL: civilian read admin_users';
  exception when insufficient_privilege then
    raise notice 'PASS: civilian cannot read admin_users';
  end;

  perform pg_temp.impersonate(v_civilian);
  begin
    insert into public.admin_users (user_id) values (v_civilian);
    raise exception 'FAIL: civilian self-inserted into admin_users';
  exception when insufficient_privilege then
    raise notice 'PASS: civilian cannot self-insert into admin_users';
  end;

  -- ---------- 2. is_admin() ----------
  perform pg_temp.impersonate(v_civilian);
  if public.is_admin() then
    raise exception 'FAIL: is_admin() true for civilian';
  end if;
  raise notice 'PASS: is_admin() false for civilian';

  perform pg_temp.impersonate(v_admin);
  if not public.is_admin() then
    raise exception 'FAIL: is_admin() false for admin member';
  end if;
  raise notice 'PASS: is_admin() true for admin member';
  perform set_config('request.jwt.claims',json_build_object('sub',v_admin,'role','authenticated','aal','aal1')::text,true);
  if public.is_admin() then raise exception 'FAIL: low-assurance admin received RLS admin access'; end if;
  raise notice 'PASS: low-assurance admin cannot use RLS admin access';
  perform pg_temp.impersonate(v_admin);

  perform pg_temp.back_to_admin();
  if public.is_admin() then
    raise exception 'FAIL: is_admin() true with no jwt (null uid)';
  end if;
  raise notice 'PASS: is_admin() false for null-uid context';

  -- ---------- 3. audit log ----------
  perform pg_temp.impersonate(v_civilian);
  begin
    insert into public.admin_audit_log (actor_id, action, subject_type, subject_id, reason)
    values (v_civilian, 'x', 'user', v_civilian, 'r');
    raise exception 'FAIL: civilian wrote to audit log';
  exception when insufficient_privilege then
    raise notice 'PASS: civilian cannot write audit log';
  end;

  perform pg_temp.back_to_admin();
  insert into public.admin_audit_log (actor_id, action, subject_type, subject_id, order_id, reason)
  values (v_admin, 'guard.test', 'order', v_order, v_order, 'fixture');

  perform pg_temp.impersonate(v_civilian);
  select count(*) into v_count from public.admin_audit_log;
  if v_count <> 0 then
    raise exception 'FAIL: civilian sees % audit rows', v_count;
  end if;
  raise notice 'PASS: audit log invisible to civilian';

  perform pg_temp.impersonate(v_admin);
  select count(*) into v_count from public.admin_audit_log;
  if v_count < 1 then
    raise exception 'FAIL: admin cannot read audit log';
  end if;
  raise notice 'PASS: admin reads audit log through RLS';

  perform pg_temp.back_to_admin();
  begin
    update public.admin_audit_log set reason = 'edited' where order_id = v_order;
    raise exception 'FAIL: audit log accepted an UPDATE';
  exception when insufficient_privilege then
    raise notice 'PASS: audit log append-only (UPDATE blocked, superuser included)';
  end;
  begin
    delete from public.admin_audit_log where order_id = v_order;
    raise exception 'FAIL: audit log accepted a DELETE';
  exception when insufficient_privilege then
    raise notice 'PASS: audit log append-only (DELETE blocked, superuser included)';
  end;

  -- ---------- 4. suspension columns ----------
  perform pg_temp.impersonate(v_seller);
  begin
    update public.profiles set suspended_at = null where id = v_seller;
    raise exception 'FAIL: seller updated suspension columns';
  exception when insufficient_privilege then
    raise notice 'PASS: suspension columns unwritable by their subject';
  end;
  begin
    perform suspended_at from public.profiles where id = v_seller;
    raise exception 'FAIL: seller read suspension columns';
  exception when insufficient_privilege then
    raise notice 'PASS: suspension columns unreadable by client roles';
  end;

  -- ---------- 5. suspension bites in browse ----------
  perform pg_temp.back_to_admin();
  update public.profiles set suspended_at = now(), suspended_reason = 'guard' where id = v_seller;

  perform pg_temp.impersonate(v_civilian);
  select count(*) into v_count from public.listings where id = v_listing;
  if v_count <> 0 then
    raise exception 'FAIL: suspended seller''s listing still in browse';
  end if;
  raise notice 'PASS: suspended seller''s listing hidden from browse';

  perform pg_temp.impersonate(v_seller);
  select count(*) into v_count from public.listings where id = v_listing;
  if v_count <> 1 then
    raise exception 'FAIL: suspended seller lost own-listing read';
  end if;
  raise notice 'PASS: suspended seller still sees own listing';

  begin
    insert into public.listings (seller_id, title, category, price_cents, status)
    values (v_seller, 'nope', 'engine', 1000, 'active');
    raise exception 'FAIL: suspended seller created a listing';
  exception when insufficient_privilege then
    raise notice 'PASS: suspended seller cannot create listings';
  end;

  perform pg_temp.back_to_admin();
  update public.profiles set suspended_at = null, suspended_reason = null where id = v_seller;

  -- ---------- 6. takedown ----------
  perform pg_temp.impersonate(v_seller);
  begin
    update public.listings set status = 'removed' where id = v_listing;
    raise exception 'FAIL: seller set own listing to removed';
  exception when insufficient_privilege then
    raise notice 'PASS: seller cannot set removed';
  end;

  perform pg_temp.back_to_admin();
  update public.listings set status = 'removed', removed_at = now(), removed_reason = 'guard' where id = v_listing;

  perform pg_temp.impersonate(v_seller);
  begin
    update public.listings set status = 'active' where id = v_listing;
    raise exception 'FAIL: seller cleared a takedown';
  exception when insufficient_privilege then
    raise notice 'PASS: seller cannot clear a takedown';
  end;

  perform pg_temp.impersonate(v_civilian);
  select count(*) into v_count from public.listings where id = v_listing;
  if v_count <> 0 then
    raise exception 'FAIL: removed listing still visible in browse';
  end if;
  raise notice 'PASS: removed listing hidden from browse';

  -- ---------- 7. admin cross-user reads ----------
  perform pg_temp.impersonate(v_admin);
  select count(*) into v_count from public.orders where id = v_order;
  if v_count <> 1 then
    raise exception 'FAIL: admin cannot read another user''s order';
  end if;
  raise notice 'PASS: admin reads cross-user orders through RLS';

  -- ---------- 8. reports ----------
  perform pg_temp.impersonate(v_civilian);
  insert into public.reports (reporter_id, subject_type, subject_id, reason, detail)
  values (v_civilian, 'listing', v_listing, 'prohibited_item', 'guard')
  returning id into v_report;
  raise notice 'PASS: user can file a report';

  begin
    update public.reports set status = 'dismissed' where id = v_report;
    raise exception 'FAIL: reporter resolved own report';
  exception when insufficient_privilege then
    raise notice 'PASS: reporter cannot resolve own report';
  end;

  perform pg_temp.impersonate(v_seller);
  select count(*) into v_count from public.reports where id = v_report;
  if v_count <> 0 then
    raise exception 'FAIL: non-reporter non-admin sees the report';
  end if;
  raise notice 'PASS: reports invisible to third parties';

  perform pg_temp.impersonate(v_admin);
  select count(*) into v_count from public.reports where id = v_report;
  if v_count <> 1 then
    raise exception 'FAIL: admin cannot read reports';
  end if;
  raise notice 'PASS: admin reads reports through RLS';

  -- ---------- 9. actor enforcement (0040) ----------
  perform pg_temp.back_to_admin();

  -- A viewer is a console member but not a full admin: the DB must refuse it
  -- as an actor, service role or not.
  insert into public.admin_users (user_id, role, note)
  values (v_civilian, 'viewer', 'guard viewer fixture')
  on conflict (user_id) do update set role = 'viewer';

  begin
    perform public.assert_admin_actor(v_civilian);
    raise exception 'FAIL: assert_admin_actor accepted a viewer';
  exception when insufficient_privilege then
    raise notice 'PASS: assert_admin_actor refuses a viewer';
  end;

  perform public.assert_admin_actor(v_admin);
  raise notice 'PASS: assert_admin_actor accepts a full admin';

  begin
    insert into public.admin_audit_log (actor_id, action, subject_type, subject_id, reason)
    values (v_civilian, 'note.internal', 'order', v_order, 'guard');
    raise exception 'FAIL: audit row recorded a viewer as actor';
  exception when insufficient_privilege then
    raise notice 'PASS: audit trail refuses non-admin actors';
  end;

  insert into public.admin_audit_log (actor_id, action, subject_type, subject_id, reason)
  values (v_admin, 'note.internal', 'order', v_order, 'guard');
  raise notice 'PASS: audit trail accepts a full-admin actor';

  perform pg_temp.back_to_admin();
  raise notice '--- all admin-guard checks passed ---';
end $$;

rollback;
