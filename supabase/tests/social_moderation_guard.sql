-- OS-W21: social abuse and moderation, held in the database.
--   N247  member write quotas on direct PostgREST inserts; one relationship
--         notification per person, target and day; evidence folder cap
--   N53   builds can be reported and hidden; the owner can't undo the hold
--   N62   notification settings are readable only by their owner
-- Migrations 20261107220000, 20261107220010, 20261107220020.
-- Follow-up 20261108130100 (Codex on PR #95): listing saves are de-duplicated
-- too (FAIL 23); a post takedown closes every reply's report, past 1,000
-- replies, in one call (FAIL 24–28); the hold and evidence-count definitions
-- take the locks the two-session checks in social_moderation_race_guard.sql
-- prove (FAIL 29–30).
begin;

do $$
declare
  member uuid := gen_random_uuid();
  seller uuid := gen_random_uuid();
  car uuid := gen_random_uuid();
  post uuid := gen_random_uuid();
  part uuid := gen_random_uuid();
  hidden_car uuid := gen_random_uuid();
  order_id uuid := gen_random_uuid();
  admin_id uuid := gen_random_uuid();
  reporter uuid := gen_random_uuid();
  big_post uuid := gen_random_uuid();
  post_report uuid;
  stray_report uuid;
  takedown jsonb;
  refused boolean;
  n int;
  quota_tables text[];
begin
  insert into auth.users(id, email, raw_user_meta_data) values
    (member, 'w21-member@drvn.test', '{}'),
    (seller, 'w21-seller@drvn.test', '{}'),
    (admin_id, 'w21-admin@drvn.test', '{}'),
    (reporter, 'w21-reporter@drvn.test', '{}');
  insert into public.cars(id, owner_id, slug, name, is_public) values
    (car, seller, 'w21-car', 'W21 build', true),
    (hidden_car, seller, 'w21-hidden-car', 'W21 hidden build', true);
  insert into public.activity_posts(id, car_id, author_id, title, body, published_at)
    values (post, car, seller, 'W21 update', '{"type":"doc","content":[]}', now());
  insert into public.listings(id, seller_id, title, category, price_cents, status, source_car_id)
    values (part, seller, 'W21 part', 'performance', 5000, 'active', car);

  -- ---------- N247: every direct write path has a database quota ----------
  select array_agg(c.relname::text order by c.relname) into quota_tables
    from pg_trigger t join pg_class c on c.oid = t.tgrelid
   where not t.tgisinternal and t.tgfoid = 'private.member_write_quota()'::regprocedure;
  if quota_tables is distinct from array['activity_comments','activity_reactions','follows','likes','listing_questions','messages','reports','saves'] then
    raise exception 'FAIL 1: write quota triggers are on %', quota_tables;
  end if;

  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', member, 'role', 'authenticated')::text, true);

  -- Replies: 20 per 10 minutes, then refused with RL429.
  for i in 1..20 loop
    insert into public.activity_comments(post_id, author_id, body) values (post, member, 'reply ' || i);
  end loop;
  refused := false;
  begin
    insert into public.activity_comments(post_id, author_id, body) values (post, member, 'reply 21');
  exception when sqlstate 'RL429' then refused := true;
  end;
  if not refused then raise exception 'FAIL 2: a 21st direct reply in 10 minutes was accepted'; end if;

  -- Listing questions: 10 per 10 minutes.
  for i in 1..10 loop
    insert into public.listing_questions(listing_id, author_id, body) values (part, member, 'question ' || i);
  end loop;
  refused := false;
  begin
    insert into public.listing_questions(listing_id, author_id, body) values (part, member, 'question 11');
  exception when sqlstate 'RL429' then refused := true;
  end;
  if not refused then raise exception 'FAIL 3: an 11th direct question was accepted'; end if;

  -- Messages to a seller: 40 per 10 minutes.
  for i in 1..40 loop
    insert into public.messages(listing_id, sender_id, recipient_id, body) values (part, member, seller, 'hello ' || i);
  end loop;
  refused := false;
  begin
    insert into public.messages(listing_id, sender_id, recipient_id, body) values (part, member, seller, 'hello 41');
  exception when sqlstate 'RL429' then refused := true;
  end;
  if not refused then raise exception 'FAIL 4: a 41st direct message was accepted'; end if;

  -- Reports: 5 an hour. A build is a report subject now (N53).
  for i in 1..5 loop
    insert into public.reports(reporter_id, subject_type, subject_id, reason) values (member, 'car', car, 'offensive_content');
  end loop;
  refused := false;
  begin
    insert into public.reports(reporter_id, subject_type, subject_id, reason) values (member, 'car', car, 'offensive_content');
  exception when sqlstate 'RL429' then refused := true;
  end;
  if not refused then raise exception 'FAIL 5: a 6th direct report in an hour was accepted'; end if;

  -- ---------- N247: follow, unfollow, follow notifies once a day ----------
  perform public.set_social_relationship('follow', 'profile', seller, true);
  perform public.set_social_relationship('follow', 'profile', seller, false);
  perform public.set_social_relationship('follow', 'profile', seller, true);
  perform public.set_social_relationship('follow', 'profile', seller, false);
  perform public.set_social_relationship('follow', 'profile', seller, true);
  perform set_config('role', 'none', true);
  select count(*) into n from public.notifications where user_id = seller and actor_id = member and kind = 'follow';
  if n <> 1 then raise exception 'FAIL 6: re-following sent % follow notifications, not 1', n; end if;
  -- A different kind from the same person still arrives.
  insert into public.activity_reactions(post_id, user_id, emoji) values (post, member, '🔥');
  select count(*) into n from public.notifications where user_id = seller and actor_id = member and kind = 'reaction';
  if n <> 1 then raise exception 'FAIL 7: a reaction after a follow was not notified (%)', n; end if;

  -- Trusted server paths carry no auth.uid() and are limited where they run.
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  for i in 1..30 loop
    insert into public.activity_comments(post_id, author_id, body) values (post, member, 'server reply ' || i);
  end loop;

  -- ---------- N247: dispute-evidence folder cap ----------
  insert into public.orders(id, buyer_id, seller_id, status, subtotal_cents, total_cents)
    values (order_id, member, seller, 'disputed', 5000, 5000);
  insert into storage.objects(bucket_id, name, owner)
    select 'dispute-evidence', member || '/' || order_id || '/f' || g || '.jpg', member from generate_series(1, 3) g;
  insert into storage.objects(bucket_id, name, owner)
    select 'dispute-evidence', seller || '/' || order_id || '/f' || g || '.jpg', seller from generate_series(1, 5) g;
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', member, 'role', 'authenticated')::text, true);
  if public.my_dispute_evidence_upload_count(order_id) <> 3 then
    raise exception 'FAIL 8: the evidence count is not just the caller''s own folder';
  end if;
  perform set_config('role', 'none', true);
  if not exists (
    select 1 from pg_policies where schemaname = 'storage' and policyname = 'upload evidence into an open dispute'
       and with_check like '%my_dispute_evidence_upload_count(o.id) < 16%'
  ) then raise exception 'FAIL 9: evidence uploads are not capped per folder'; end if;

  -- ---------- N53: hiding a build ----------
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', seller, 'role', 'authenticated')::text, true);
  refused := false;
  begin
    insert into public.car_moderation_holds(car_id, reason) values (car, 'self-hold');
  exception when insufficient_privilege then refused := true;
  end;
  if not refused then raise exception 'FAIL 10: an owner placed a moderation hold'; end if;

  -- The admin console hides it with the service role.
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  insert into public.car_moderation_holds(car_id, reason, hidden_by) values (hidden_car, 'Offensive build name', null);
  if (select is_public from public.cars where id = hidden_car) then
    raise exception 'FAIL 11: a hidden build stayed public';
  end if;

  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', seller, 'role', 'authenticated')::text, true);
  update public.cars set is_public = true, name = 'W21 renamed' where id = hidden_car;
  if (select is_public from public.cars where id = hidden_car) then
    raise exception 'FAIL 12: the owner republished a hidden build';
  end if;
  if (select name from public.cars where id = hidden_car) <> 'W21 renamed' then
    raise exception 'FAIL 12b: the hold blocked an ordinary edit';
  end if;
  refused := false;
  begin
    delete from public.car_moderation_holds where car_id = hidden_car;
  exception when insufficient_privilege then refused := true;
  end;
  if not refused then raise exception 'FAIL 13: the owner could delete the hold'; end if;
  refused := false;
  begin
    update public.car_moderation_holds set reason = 'x' where car_id = hidden_car;
  exception when insufficient_privilege then refused := true;
  end;
  if not refused then raise exception 'FAIL 13a: the owner could edit the hold'; end if;
  if not exists (select 1 from public.car_moderation_holds where car_id = hidden_car and reason = 'Offensive build name') then
    raise exception 'FAIL 13: the owner lifted or changed the hold';
  end if;
  perform set_config('request.jwt.claims', json_build_object('sub', member, 'role', 'authenticated')::text, true);
  if exists (select 1 from public.car_moderation_holds where car_id = hidden_car) then
    raise exception 'FAIL 14: another member can read a build''s hold';
  end if;

  perform set_config('role', 'anon', true);
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  if exists (select 1 from public.cars where id = hidden_car) then
    raise exception 'FAIL 15: a visitor can see a hidden build';
  end if;
  if not exists (select 1 from public.cars where id = car) then
    raise exception 'FAIL 16: a visible build disappeared';
  end if;

  -- Lifting the hold leaves the build private until its owner republishes.
  perform set_config('role', 'none', true);
  delete from public.car_moderation_holds where car_id = hidden_car;
  if (select is_public from public.cars where id = hidden_car) then
    raise exception 'FAIL 16b: lifting the hold republished the build';
  end if;
  update public.cars set is_public = true where id = hidden_car;
  if not (select is_public from public.cars where id = hidden_car) then
    raise exception 'FAIL 16c: a lifted hold still keeps the build private';
  end if;

  -- ---------- N62: notification settings ----------
  perform set_config('role', 'none', true);
  update public.profiles set notification_prefs = '{"follow": false}' where id = seller;
  perform set_config('role', 'anon', true);
  refused := false;
  begin
    perform notification_prefs from public.profiles where id = seller;
  exception when insufficient_privilege then refused := true;
  end;
  if not refused then raise exception 'FAIL 17: a visitor can read notification settings'; end if;
  refused := false;
  begin
    perform public.my_notification_prefs();
  exception when insufficient_privilege then refused := true;
  end;
  if not refused then raise exception 'FAIL 18: a visitor can call my_notification_prefs'; end if;

  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', member, 'role', 'authenticated')::text, true);
  refused := false;
  begin
    perform notification_prefs from public.profiles where id = seller;
  exception when insufficient_privilege then refused := true;
  end;
  if not refused then raise exception 'FAIL 19: a member can read another member''s notification settings'; end if;
  if public.my_notification_prefs() ? 'follow' then
    raise exception 'FAIL 20: my_notification_prefs answered with someone else''s settings';
  end if;
  perform set_config('request.jwt.claims', json_build_object('sub', seller, 'role', 'authenticated')::text, true);
  if public.my_notification_prefs() is distinct from '{"follow": false}'::jsonb then
    raise exception 'FAIL 21: my_notification_prefs did not return the caller''s own settings';
  end if;
  -- Settings → Notifications still saves.
  update public.profiles set notification_prefs = '{"follow": true}' where id = seller;
  if public.my_notification_prefs() is distinct from '{"follow": true}'::jsonb then
    raise exception 'FAIL 22: a member can no longer save their notification settings';
  end if;
  perform set_config('role', 'none', true);

  -- ---------- Follow-up: save, unsave, save a part notifies once a day ----------
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', member, 'role', 'authenticated')::text, true);
  perform public.set_social_relationship('save', 'listing', part, true);
  perform public.set_social_relationship('save', 'listing', part, false);
  perform public.set_social_relationship('save', 'listing', part, true);
  perform public.set_social_relationship('save', 'listing', part, false);
  perform public.set_social_relationship('save', 'listing', part, true);
  perform set_config('role', 'none', true);
  select count(*) into n from public.notifications where user_id = seller and actor_id = member and kind = 'listing_save';
  if n <> 1 then raise exception 'FAIL 23: re-saving a part sent % listing_save notifications, not 1', n; end if;

  -- ---------- Follow-up: a post takedown closes every reply's report ----------
  -- 1,001 replies, each reported, plus a report on the post: more than one
  -- PostgREST read (max_rows = 1000) returns. Trusted inserts, no quota.
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  insert into public.admin_users(user_id, role, note) values (admin_id, 'admin', 'w21 follow-up guard');
  insert into public.activity_posts(id, car_id, author_id, title, body, published_at)
    values (big_post, car, seller, 'W21 big thread', '{"type":"doc","content":[]}', now());
  insert into public.activity_comments(post_id, author_id, body)
    select big_post, member, 'big reply ' || g from generate_series(1, 1001) g;
  insert into public.reports(reporter_id, subject_type, subject_id, reason)
    select reporter, 'comment', c.id, 'offensive_content' from public.activity_comments c where c.post_id = big_post;
  insert into public.reports(reporter_id, subject_type, subject_id, reason)
    values (reporter, 'post', big_post, 'offensive_content') returning id into post_report;
  -- A report on a reply elsewhere must stay open.
  insert into public.reports(reporter_id, subject_type, subject_id, reason)
    select reporter, 'comment', c.id, 'offensive_content' from public.activity_comments c where c.post_id = post limit 1
    returning id into stray_report;

  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', admin_id, 'role', 'authenticated')::text, true);
  refused := false;
  begin
    perform public.take_down_reported_content(admin_id, post_report, 'Spam thread');
  exception when insufficient_privilege then refused := true;
  end;
  if not refused then raise exception 'FAIL 24: a signed-in member can call take_down_reported_content'; end if;
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  refused := false;
  begin
    perform public.take_down_reported_content(member, post_report, 'Spam thread');
  exception when insufficient_privilege then refused := true;
  end;
  if not refused then raise exception 'FAIL 25: a non-admin actor took down a post'; end if;

  takedown := public.take_down_reported_content(admin_id, post_report, 'Spam thread');
  if jsonb_array_length(takedown -> 'closed') <> 1002 or (takedown ->> 'replyCount')::int <> 1001 then
    raise exception 'FAIL 26: the takedown closed % reports for % replies, not 1002 for 1001',
      jsonb_array_length(takedown -> 'closed'), takedown ->> 'replyCount';
  end if;
  if exists (select 1 from public.activity_posts where id = big_post)
     or exists (select 1 from public.activity_comments where post_id = big_post) then
    raise exception 'FAIL 27: the post or its replies survived the takedown';
  end if;
  select count(*) into n from public.reports
   where reporter_id = reporter and status = 'actioned' and resolved_by = admin_id
     and resolution_note = 'Removed: Spam thread';
  if n <> 1002 then raise exception 'FAIL 28: % of the post''s 1002 reports were closed', n; end if;
  if (select status from public.reports where id = stray_report) <> 'open' then
    raise exception 'FAIL 28b: a report on another post''s reply was closed';
  end if;
  if (takedown -> 'removed' ->> 'author_id')::uuid is distinct from seller then
    raise exception 'FAIL 28c: the takedown did not return the removed post''s author';
  end if;

  -- ---------- Follow-up: the lock-taking definitions ----------
  if position('and is_public' in pg_get_functiondef('private.car_moderation_hold_apply()'::regprocedure)) > 0
     or (select provolatile from pg_proc where oid = 'private.car_moderation_hold_keeps_private()'::regprocedure) <> 'v' then
    raise exception 'FAIL 29: placing a hold can skip the car''s row lock, or the publish check can''t re-read after waiting';
  end if;
  if (select provolatile from pg_proc where oid = 'public.my_dispute_evidence_upload_count(uuid)'::regprocedure) <> 'v'
     or position('pg_advisory_xact_lock' in pg_get_functiondef('public.my_dispute_evidence_upload_count(uuid)'::regprocedure)) = 0 then
    raise exception 'FAIL 30: the evidence count does not lock the folder before it counts';
  end if;

  raise notice 'all social moderation checks passed';
end $$;

rollback;
