-- ============================================================================
-- Listing-import guard (0047)
--
-- Regression-tests the importer's DB-level invariants:
--   RLS isolation (user A cannot read/update/consume user B's imports),
--   the status-transition trigger (illegal moves refused; consumed requires
--   a listing_id), the per-user in-progress cap, and the active-URL dedupe
--   index.
--
-- Same contract as the other guards: NON-PRODUCTION database only; the whole
-- run is one rolled-back transaction; impersonation uses the PostgREST
-- mechanism (transaction-local role + request.jwt.claims); raises on failure,
-- NOTICEs on success.
-- ============================================================================

begin;

create function pg_temp.impersonate(uid uuid) returns void
language sql as $$
  select set_config('role', 'authenticated', true);
  select set_config(
    'request.jwt.claims',
    json_build_object('sub', uid::text, 'role', 'authenticated')::text,
    true
  );
$$;

create function pg_temp.back_to_admin() returns void
language sql as $$
  select set_config('role', 'none', true);
  select set_config('request.jwt.claims', '', true);
$$;

do $$
declare
  v_a uuid := gen_random_uuid();
  v_b uuid := gen_random_uuid();
  v_import uuid;
  v_import_b uuid;
  v_listing uuid;
  v_count int;
  v_failed boolean;
begin
  -- ---------- fixtures ----------
  insert into auth.users (id, email) values
    (v_a, 'import-guard-a@example.test'),
    (v_b, 'import-guard-b@example.test');
  update public.profiles set username = 'import_guard_a' where id = v_a;
  update public.profiles set username = 'import_guard_b' where id = v_b;

  insert into public.listings (seller_id, title, category, price_cents, shipping_cents, status, currency)
  values (v_a, 'Import guard downpipe', 'performance', 40000, 0, 'draft', 'USD')
  returning id into v_listing;

  perform pg_temp.impersonate(v_a);
  insert into public.listing_imports (user_id, source_mode, source_url, canonical_url, source_domain)
  values (v_a, 'url', 'https://forum.example/t/fs-downpipe/1', 'https://forum.example/t/fs-downpipe/1', 'forum.example')
  returning id into v_import;

  perform pg_temp.impersonate(v_b);
  insert into public.listing_imports (user_id, source_mode, normalized_source)
  values (v_b, 'paste', '{"sourceType":"paste","text":"FS: coilovers $500","images":[]}'::jsonb)
  returning id into v_import_b;

  -- ---------- 1. cross-user reads are empty ----------
  select count(*) into v_count from public.listing_imports where id = v_import;
  if v_count <> 0 then
    raise exception 'FAIL: user B can read user A''s import';
  end if;
  raise notice 'PASS: cross-user import reads are blocked';

  -- ---------- 2. cross-user update is a silent no-op ----------
  update public.listing_imports set error_detail = 'forged' where id = v_import;
  perform pg_temp.back_to_admin();
  select count(*) into v_count from public.listing_imports
    where id = v_import and error_detail = 'forged';
  if v_count <> 0 then
    raise exception 'FAIL: user B mutated user A''s import';
  end if;
  raise notice 'PASS: cross-user import writes are blocked';

  -- ---------- 3. user B cannot forge an import owned by A ----------
  perform pg_temp.impersonate(v_b);
  v_failed := false;
  begin
    insert into public.listing_imports (user_id, source_mode) values (v_a, 'paste');
  exception when others then
    v_failed := true;
  end;
  if not v_failed then
    raise exception 'FAIL: user B inserted an import owned by A';
  end if;
  raise notice 'PASS: imports cannot be created for another user';

  -- ---------- 4. illegal transition refused ----------
  perform pg_temp.back_to_admin();
  v_failed := false;
  begin
    update public.listing_imports set status = 'ready' where id = v_import; -- pending -> ready
  exception when others then
    v_failed := true;
  end;
  if not v_failed then
    raise exception 'FAIL: pending -> ready transition was allowed';
  end if;
  raise notice 'PASS: illegal status transitions are refused';

  -- ---------- 5. consumed requires a listing ----------
  update public.listing_imports set status = 'fetching' where id = v_import;
  update public.listing_imports set status = 'extracting' where id = v_import;
  update public.listing_imports set status = 'ready' where id = v_import;
  v_failed := false;
  begin
    update public.listing_imports set status = 'consumed' where id = v_import;
  exception when others then
    v_failed := true;
  end;
  if not v_failed then
    raise exception 'FAIL: consumed without listing_id was allowed';
  end if;
  update public.listing_imports
    set status = 'consumed', listing_id = v_listing, consumed_at = now()
    where id = v_import;
  raise notice 'PASS: consumed requires its listing reference';

  -- ---------- 6. terminal states stay terminal ----------
  v_failed := false;
  begin
    update public.listing_imports set status = 'ready' where id = v_import;
  exception when others then
    v_failed := true;
  end;
  if not v_failed then
    raise exception 'FAIL: consumed import was reopened';
  end if;
  raise notice 'PASS: consumed imports are terminal';

  -- ---------- 7. active-URL dedupe index ----------
  perform pg_temp.impersonate(v_a);
  insert into public.listing_imports (user_id, source_mode, source_url, canonical_url, source_domain)
  values (v_a, 'url', 'https://forum.example/t/fs-intake/2', 'https://forum.example/t/fs-intake/2', 'forum.example');
  v_failed := false;
  begin
    insert into public.listing_imports (user_id, source_mode, source_url, canonical_url, source_domain)
    values (v_a, 'url', 'https://forum.example/t/fs-intake/2', 'https://forum.example/t/fs-intake/2', 'forum.example');
  exception when others then
    v_failed := true;
  end;
  if not v_failed then
    raise exception 'FAIL: duplicate live import for the same canonical URL was allowed';
  end if;
  raise notice 'PASS: same-URL live imports dedupe';

  -- ---------- 8. per-user in-progress cap (20) ----------
  perform pg_temp.back_to_admin();
  for v_count in 1..18 loop
    insert into public.listing_imports (user_id, source_mode)
    values (v_a, 'paste');
  end loop;
  -- A already holds 1 live URL import + 18 pastes + (consumed doesn't count) = 19
  insert into public.listing_imports (user_id, source_mode) values (v_a, 'paste'); -- 20th
  v_failed := false;
  begin
    insert into public.listing_imports (user_id, source_mode) values (v_a, 'paste'); -- 21st
  exception when others then
    v_failed := true;
  end;
  if not v_failed then
    raise exception 'FAIL: in-progress import cap did not enforce';
  end if;
  raise notice 'PASS: per-user in-progress cap enforced';

  raise notice '--- all import-guard checks passed ---';
end $$;

rollback;
