-- 20261110190000 (report five #109, OS id N946): a valid counter-notice can
-- reinstate what a takedown removed.
--   C  only an admin with a fresh step-up records it, on an acted-on notice,
--      with consent to jurisdiction, once
--   R  reinstating needs the counter-notice and 14 days; then the notice is
--      'reinstated', its removed listing is back to paused (no longer held)
--      and its photos are off the blocklist
--   P  counter-notices are never readable by members
-- Every failed check is collected and reported together at the end.
begin;

do $$
declare
  admin_actor uuid := gen_random_uuid();
  member uuid := gen_random_uuid();
  seller uuid := gen_random_uuid();
  gone uuid := gen_random_uuid();
  v_notice uuid;
  r jsonb;
  msg text;
  fails text[] := '{}';
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (admin_actor, 'n946c-admin@drvn.test', '{}'), (member, 'n946c-member@drvn.test', '{}'), (seller, 'n946c-seller@drvn.test', '{}');
  -- An enrolled admin whose session is bound to their factor (aal2).
  insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at)
  values (gen_random_uuid(), admin_actor, 'guard', 'totp', 'verified', now(), now());
  insert into public.admin_users (user_id, role, note, mfa_factor_id) select admin_actor, 'admin', 'guard', id from auth.mfa_factors where user_id = admin_actor;
  insert into auth.sessions (id, user_id, factor_id, aal, created_at, updated_at)
  select f.user_id, f.user_id, f.id, 'aal2', now(), now() from auth.mfa_factors f where f.user_id = admin_actor;
  insert into public.listings (id, seller_id, title, category, price_cents, status) values (gone, seller, 'N946c part', 'performance', 10000, 'removed');
  update public.listings set removed_at = now(), removed_reason = 'Copyright notice: guard' where id = gone;
  insert into public.copyright_notices (claimant_name, claimant_email, claimant_address, work_description, content_urls,
    good_faith, accurate_and_authorised, signature, status, resolved_at, takedown)
  values ('Pat Photographer', 'pat-n946c@example.test', '1 High Street, Leeds', 'My photograph of a turbo', array['https://drvn.app/x'],
    true, true, 'Pat Photographer', 'actioned', now() - interval '20 days',
    jsonb_build_object('removedListings', jsonb_build_array(gone), 'keptListingStatus', '[]'::jsonb))
  returning id into v_notice;
  insert into public.copyright_blocked_media (object_key, notice_id) values ('listing-images/' || seller || '/turbo.webp', v_notice);
  if not private.copyright_listing_held(gone) then raise exception 'Fixture: the notice does not hold its listing (N946)'; end if;

  -- ---------- C: not an admin ----------
  perform set_config('request.jwt.claims', json_build_object('sub', member, 'role', 'authenticated',
    'amr', json_build_array(json_build_object('method', 'totp', 'timestamp', extract(epoch from now())::bigint)))::text, true);
  begin
    perform public.record_copyright_counter_notice(v_notice, 'Sam Seller', '2 Low Road, York', 'The photo is my own, taken in my garage.', true, 'Sam Seller', now() - interval '13 days');
    fails := fails || 'FAIL C1: a member recorded a counter-notice (N946)'::text;
  exception when insufficient_privilege then null;
  end;

  -- As an admin with a fresh step-up.
  perform set_config('request.jwt.claims', json_build_object('sub', admin_actor, 'role', 'authenticated', 'aal', 'aal2', 'session_id', admin_actor,
    'amr', json_build_array(json_build_object('method', 'totp', 'timestamp', extract(epoch from now())::bigint)))::text, true);

  -- ---------- R: nothing to reinstate on yet ----------
  begin
    perform public.reinstate_after_counter_notice(v_notice, 'No court action notified');
    fails := fails || 'FAIL R1: content was reinstated with no counter-notice (N946)'::text;
  exception when others then
    get stacked diagnostics msg = message_text;
    if msg not like '%counter-notice first%' then fails := fails || format('FAIL R1b: the refusal said "%s" (N946)', msg); end if;
  end;

  begin
    perform public.record_copyright_counter_notice(v_notice, 'Sam Seller', '2 Low Road, York', 'The photo is my own, taken in my garage.', false, 'Sam Seller', now() - interval '13 days');
    fails := fails || 'FAIL C2: a counter-notice without consent to jurisdiction was recorded (N946)'::text;
  exception when others then null;
  end;
  perform public.record_copyright_counter_notice(v_notice, 'Sam Seller', '2 Low Road, York', 'The photo is my own, taken in my garage.', true, 'Sam Seller', now() - interval '13 days');
  begin
    perform public.record_copyright_counter_notice(v_notice, 'Sam Seller', '2 Low Road, York', 'Again, the photo is mine.', true, 'Sam Seller', now() - interval '12 days');
    fails := fails || 'FAIL C3: a second counter-notice was recorded (N946)'::text;
  exception when others then null;
  end;

  begin
    perform public.reinstate_after_counter_notice(v_notice, 'No court action notified');
    fails := fails || 'FAIL R2: content was reinstated before 14 days (N946)'::text;
  exception when others then
    get stacked diagnostics msg = message_text;
    if msg not like '%14 days%' then fails := fails || format('FAIL R2b: the early refusal said "%s" (N946)', msg); end if;
  end;
  if (select status from public.listings where id = gone) <> 'removed' then
    fails := fails || 'FAIL R3: a refused reinstatement moved the listing (N946)'::text;
  end if;

  update public.copyright_counter_notices set received_at = now() - interval '14 days' where notice_id = v_notice;
  r := public.reinstate_after_counter_notice(v_notice, 'Counter-notice 14 days ago; no court action notified');
  if (select status from public.copyright_notices where id = v_notice) <> 'reinstated'
     or (select status from public.listings where id = gone) <> 'paused'
     or private.copyright_listing_held(gone)
     or exists (select 1 from public.copyright_blocked_media where notice_id = v_notice)
     or (r->>'unblockedPhotos')::int <> 1 then
    fails := fails || format('FAIL R4: reinstating did not release the listing and unblock the photos (%s) (N946)', r);
  end if;
  if not exists (select 1 from public.admin_audit_log where action = 'copyright.reinstate' and subject_id = v_notice and actor_id = admin_actor) then
    fails := fails || 'FAIL R5: the reinstatement was not audited (N946)'::text;
  end if;

  -- ---------- P ----------
  if has_table_privilege('authenticated', 'public.copyright_counter_notices', 'select')
     or has_table_privilege('anon', 'public.copyright_counter_notices', 'select') then
    fails := fails || 'FAIL P1: members can read counter-notices (N946)'::text;
  end if;

  if cardinality(fails) > 0 then
    raise exception '%', array_to_string(fails, E'\n');
  end if;
  raise notice 'all counter-notice checks passed';
end $$;

rollback;
