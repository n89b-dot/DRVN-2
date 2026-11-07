-- ============================================================================
-- Launch legal guards (R69-age, R69-dmca, N629): 20261107231001–231003
--
--  1. Age: a member can't write their own age confirmation, and can't take a
--     handle (finish onboarding) through the API without one; with the
--     server's record they can. The record is never rewritten.
--  2. Copyright: the `copyright` report reason is accepted; notices are not
--     member-writable; a takedown needs an admin with a fresh step-up; it
--     removes the listing and purges the photo from the listing gallery AND
--     the buyer's order snapshot, records the object as blocked, queues it for
--     storage deletion, closes the notice and writes the audit row; a closed
--     notice can't be acted on twice.
--  3. Announcements: a policy change notifies every member once, whatever
--     the number of calls, and members can't announce.
--
-- Rolled back at the end.
-- ============================================================================

begin;

do $$
declare
  v_member uuid := gen_random_uuid();
  v_seller uuid := gen_random_uuid();
  v_buyer uuid := gen_random_uuid();
  v_admin uuid := gen_random_uuid();
  v_listing uuid;
  v_order uuid;
  v_item uuid;
  v_notice uuid;
  v_base text := 'https://legal-guard.supabase.co/storage/v1/object/public/';
  v_photo text;
  v_result jsonb;
  v_failed boolean;
  v_claims text;
  v_count int;
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (v_member, 'legal-guard-member@drvn.test', '{}'),
    (v_seller, 'legal-guard-seller@drvn.test', '{}'),
    (v_buyer, 'legal-guard-buyer@drvn.test', '{}'),
    (v_admin, 'legal-guard-admin@drvn.test', '{}');
  -- Profiles exist for these accounts (handle_new_user, or a repair).
  insert into public.profiles (id) values (v_member), (v_seller), (v_buyer), (v_admin) on conflict (id) do nothing;
  update public.profiles set username = null where id = v_member;

  -- ------------------------------------------------------------------
  -- 1. Age confirmation
  -- ------------------------------------------------------------------
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_member, 'role', 'authenticated')::text, true);

  v_failed := false;
  begin
    insert into public.age_confirmations (user_id, source) values (v_member, 'onboarding');
  exception when insufficient_privilege then v_failed := true;
  end;
  if not v_failed then raise exception 'A member wrote their own age confirmation'; end if;

  v_failed := false;
  begin
    update public.profiles set username = 'legal_guard_member' where id = v_member;
  exception when insufficient_privilege then v_failed := true;
  end;
  if not v_failed then raise exception 'A handle was set through the API without an age confirmation'; end if;

  perform set_config('role', 'service_role', true);
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  insert into public.age_confirmations (user_id, source) values (v_member, 'onboarding');

  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_member, 'role', 'authenticated')::text, true);
  if (select count(*) from public.age_confirmations) <> 1 then
    raise exception 'A member must read exactly their own age confirmation';
  end if;
  update public.profiles set username = 'legal_guard_member' where id = v_member;
  if (select username from public.profiles where id = v_member) <> 'legal_guard_member' then
    raise exception 'A confirmed member could not take a handle';
  end if;

  perform set_config('role', 'service_role', true);
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  v_failed := false;
  begin
    update public.age_confirmations set age_confirmed_at = now() - interval '1 day' where user_id = v_member;
  exception when insufficient_privilege then v_failed := true;
  end;
  if not v_failed then raise exception 'An age confirmation was rewritten'; end if;
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
  raise notice 'PASS 1: age confirmation is server-written, immutable, and required for a handle';

  -- ------------------------------------------------------------------
  -- 2. Copyright
  -- ------------------------------------------------------------------
  update public.profiles set username = 'legal_guard_seller' where id = v_seller;
  update public.profiles set username = 'legal_guard_buyer' where id = v_buyer;
  v_photo := v_base || 'listing-images/' || v_seller || '/rehosted.webp';
  insert into public.listings (seller_id, title, category, price_cents, shipping_cents, status, currency)
    values (v_seller, 'Imported part', 'engine', 5000, 500, 'active', 'USD') returning id into v_listing;
  insert into public.listing_images (listing_id, url, position) values (v_listing, v_photo, 0);
  insert into public.orders (buyer_id, seller_id, status, subtotal_cents, platform_fee_cents, total_cents, currency)
    values (v_buyer, v_seller, 'paid', 5000, 500, 5500, 'USD') returning id into v_order;
  insert into public.order_items (order_id, listing_id, title, price_cents, shipping_cents)
    values (v_order, v_listing, 'Imported part', 5000, 500) returning id into v_item;
  if not exists (select 1 from public.order_item_snapshot_images where order_item_id = v_item and url = v_photo) then
    raise exception 'Fixture: the order snapshot did not freeze the photo';
  end if;

  -- The new report reason.
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_buyer, 'role', 'authenticated')::text, true);
  insert into public.reports (reporter_id, subject_type, subject_id, reason) values (v_buyer, 'listing', v_listing, 'copyright');

  v_failed := false;
  begin
    insert into public.copyright_notices (claimant_name, claimant_email, claimant_address, work_description, content_urls, good_faith, accurate_and_authorised, signature)
    values ('Mallory', 'm@example.test', '1 Fake Street', 'A photo I took', array['https://drvn.app/x'], true, true, 'Mallory');
  exception when insufficient_privilege then v_failed := true;
  end;
  if not v_failed then raise exception 'A member wrote a copyright notice directly'; end if;
  if exists (select 1 from public.copyright_notices) then raise exception 'A member read copyright notices'; end if;

  perform set_config('role', 'service_role', true);
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  v_failed := false;
  begin
    insert into public.copyright_notices (claimant_name, claimant_email, claimant_address, work_description, content_urls, good_faith, accurate_and_authorised, signature)
    values ('Pat Photographer', 'pat@example.test', '1 High Street, Leeds', 'My photo of a turbo', array['https://drvn.app/listings/' || v_listing], false, true, 'Pat Photographer');
  exception when check_violation then v_failed := true;
  end;
  if not v_failed then raise exception 'A notice without the good-faith statement was accepted'; end if;
  insert into public.copyright_notices (claimant_name, claimant_email, claimant_address, work_description, content_urls, good_faith, accurate_and_authorised, signature)
    values ('Pat Photographer', 'pat@example.test', '1 High Street, Leeds', 'My photo of a turbo', array['https://drvn.app/listings/' || v_listing], true, true, 'Pat Photographer')
    returning id into v_notice;

  -- Not an admin: refused.
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_buyer, 'role', 'authenticated', 'aal', 'aal2',
    'amr', json_build_array(json_build_object('method', 'totp', 'timestamp', extract(epoch from now())::bigint)))::text, true);
  v_failed := false;
  begin
    perform public.copyright_takedown(v_notice, array[v_listing], '{}', 'Rights holder notice');
  exception when insufficient_privilege then v_failed := true;
  end;
  if not v_failed then raise exception 'A non-admin took content down'; end if;

  -- An admin without a fresh step-up: refused.
  perform set_config('role', 'postgres', true);
  insert into public.admin_users (user_id, role) values (v_admin, 'admin');
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated', 'aal', 'aal2',
    'amr', json_build_array(json_build_object('method', 'totp', 'timestamp', extract(epoch from now() - interval '1 hour')::bigint)))::text, true);
  v_failed := false;
  begin
    perform public.copyright_takedown(v_notice, array[v_listing], '{}', 'Rights holder notice');
  exception when insufficient_privilege then v_failed := true;
  end;
  if not v_failed then raise exception 'A stale admin session took content down'; end if;

  -- An admin with a fresh step-up.
  v_claims := json_build_object('sub', v_admin, 'role', 'authenticated', 'aal', 'aal2',
    'amr', json_build_array(json_build_object('method', 'totp', 'timestamp', extract(epoch from now())::bigint)))::text;
  perform set_config('request.jwt.claims', v_claims, true);
  v_result := public.copyright_takedown(v_notice, array[v_listing], '{}', 'Rights holder notice');

  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
  if (select status from public.listings where id = v_listing) <> 'removed' then
    raise exception 'The listing was not removed: %', v_result;
  end if;
  if exists (select 1 from public.listing_images where listing_id = v_listing) then
    raise exception 'The listing photo survived the takedown';
  end if;
  if exists (select 1 from public.order_item_snapshot_images where order_item_id = v_item) then
    raise exception 'The order snapshot still holds the photo';
  end if;
  if (v_result -> 'purged' ->> 'order_snapshot_photos')::int <> 1 then
    raise exception 'The takedown did not report the snapshot purge: %', v_result;
  end if;
  if not exists (select 1 from public.copyright_blocked_media
                  where object_key = 'listing-images/' || v_seller || '/rehosted.webp' and notice_id = v_notice) then
    raise exception 'The object was not recorded as blocked';
  end if;
  if not exists (select 1 from public.media_cleanup_queue
                  where bucket = 'listing-images' and path = v_seller || '/rehosted.webp'
                    and owner_id = v_seller and reason = 'copyright_takedown') then
    raise exception 'The object was not queued for storage deletion';
  end if;
  if public.media_object_referenced('listing-images', v_seller || '/rehosted.webp') then
    raise exception 'The object is still referenced after the takedown';
  end if;
  if (select status from public.copyright_notices where id = v_notice) <> 'actioned' then
    raise exception 'The notice was not closed';
  end if;
  if not exists (select 1 from public.admin_audit_log
                  where action = 'copyright.takedown' and subject_type = 'copyright_notice' and subject_id = v_notice and actor_id = v_admin) then
    raise exception 'The takedown was not audited';
  end if;
  if not (v_result -> 'owners') ? v_seller::text then
    raise exception 'The takedown did not name the seller to tell: %', v_result;
  end if;

  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', v_claims, true);
  v_failed := false;
  begin
    perform public.copyright_takedown(v_notice, array[v_listing], '{}', 'Again');
  exception when object_not_in_prerequisite_state then v_failed := true;
  end;
  if not v_failed then raise exception 'A closed notice was acted on twice'; end if;
  v_failed := false;
  begin
    perform public.reject_copyright_notice(v_notice, 'Changed my mind');
  exception when object_not_in_prerequisite_state then v_failed := true;
  end;
  if not v_failed then raise exception 'A closed notice was rejected'; end if;
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
  raise notice 'PASS 2: copyright reason, private notices, step-up takedown purging gallery and order snapshot';

  -- ------------------------------------------------------------------
  -- 3. Policy announcements
  -- ------------------------------------------------------------------
  v_count := public.announce_policy_update('guard-test-change', 'Terms updated', 'What changed.', '/terms#changes');
  if v_count < 4 then raise exception 'Every member should be told (told %)', v_count; end if;
  if public.announce_policy_update('guard-test-change', 'Terms updated', 'What changed.', '/terms#changes') <> 0 then
    raise exception 'A change was announced twice';
  end if;
  if (select count(*) from public.notifications where user_id = v_member and kind = 'policy_updated' and title = 'Terms updated') <> 1 then
    raise exception 'A member was not told exactly once';
  end if;
  if has_function_privilege('authenticated', 'public.announce_policy_update(text, text, text, text)', 'execute') then
    raise exception 'Members can announce policy changes';
  end if;
  raise notice 'PASS 3: a policy change is announced in the app once per member';

  raise notice 'all launch legal checks passed';
end $$;

rollback;
