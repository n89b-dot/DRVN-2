-- OS-W34: deletion scrub (N16) and username rules (N38).
--   20261107220500_username_rules.sql, 20261107220510_account_deletion_scrub.sql
--
--   U1-U6  usernames: format, reserved names, the audit-and-fix remediation,
--          availability, privileges.
--   S1-S12 the scrub: refused without a deletion or while money moves; Auth
--          email and metadata, addresses, party labels, message, question
--          and comment bodies gone; transaction keys and the other party's
--          words kept; the handle retired; the 6-year clock; a second run
--          changes nothing (resumable); privileges.
begin;

create function pg_temp.raises(p_sql text, p_state text) returns boolean language plpgsql as $$
begin
  execute p_sql;
  return false;
exception when others then
  if sqlstate = p_state then return true; end if;
  raise;
end $$;

-- This guard's own helpers are called while acting as other roles. A new
-- function is closed by default (20261110170000), so they are opened here.
grant execute on all routines in schema pg_temp to public;

do $$
declare
  m uuid := gen_random_uuid();          -- the member deleting their account
  o uuid := gen_random_uuid();          -- someone they traded with
  held uuid := gen_random_uuid();       -- a member whose money is still moving
  bought uuid := gen_random_uuid();     -- m bought from o (accepted offer)
  sold uuid := gen_random_uuid();       -- m sold to o
  pending_order uuid := gen_random_uuid();
  part uuid := gen_random_uuid();
  their_part uuid := gen_random_uuid();
  post uuid := gen_random_uuid();
  msg_mine uuid := gen_random_uuid();
  msg_theirs uuid := gen_random_uuid();
  conv uuid;
  r jsonb;
  req public.account_deletion_requests%rowtype;
  later timestamptz := now() + interval '3 days';
  u1 uuid := gen_random_uuid(); u2 uuid := gen_random_uuid(); u3 uuid := gen_random_uuid();
  u4 uuid := gen_random_uuid(); u5 uuid := gen_random_uuid(); u6 uuid := gen_random_uuid();
  u7 uuid := gen_random_uuid();
  digest text := repeat('ab', 32);
begin
  insert into public.job_config (key, value) values ('payments_mode', 'stub')
    on conflict (key) do update set value = excluded.value;
  insert into auth.users (id, email, raw_user_meta_data) values
    (m, 'Deleter@Example.test', '{"full_name":"Dana Deleter","avatar_url":"https://x.test/a.png"}'),
    (o, 'other@example.test', '{}'),
    (held, 'held@example.test', '{}');
  update public.profiles set username = 'dana_deletes', display_name = 'Dana Deleter', bio = 'I sell turbos' where id = m;
  update public.profiles set username = 'olly_other', display_name = 'Olly' where id = o;

  -- ---------- N38: usernames ----------
  if not pg_temp.raises(format('update public.profiles set username = %L where id = %L', 'Olly_Other', o), '23514')
     or not pg_temp.raises(format('update public.profiles set username = %L where id = %L', 'ab', o), '23514')
     or not pg_temp.raises(format('update public.profiles set username = %L where id = %L', repeat('a', 31), o), '23514')
     or not pg_temp.raises(format('update public.profiles set username = %L where id = %L', 'has space', o), '23514') then
    raise exception 'FAIL U1: a handle outside lowercase a-z, 0-9 and _ at 3-30 characters was accepted (N38)';
  end if;
  update public.profiles set username = repeat('a', 30) where id = o;
  update public.profiles set username = 'olly_other' where id = o;

  if not pg_temp.raises(format('update public.profiles set username = %L where id = %L', 'admin', o), '23505')
     or not pg_temp.raises(format('update public.profiles set username = %L where id = %L', 'support', o), '23505') then
    raise exception 'FAIL U2: a reserved handle was taken (N38)';
  end if;

  if public.username_available('admin') <> 'taken' or public.username_available('olly_other') <> 'taken'
     or public.username_available('Neil') <> 'invalid' or public.username_available('ab') <> 'invalid'
     or public.username_available(null) <> 'invalid' or public.username_available('fresh_handle_9') <> 'available' then
    raise exception 'FAIL U3: availability does not follow the rules (N38)';
  end if;

  -- U4: the audit-and-fix the migration ran, against handles that existed
  -- before the rules (seeded with the format check and reserved trigger off).
  alter table public.profiles drop constraint profiles_username_format;
  alter table public.profiles disable trigger profiles_username_choice;
  insert into auth.users (id, email) values
    (u1, 'u1@example.test'), (u2, 'u2@example.test'), (u3, 'u3@example.test'), (u4, 'u4@example.test'),
    (u5, 'u5@example.test'), (u6, 'u6@example.test'), (u7, 'u7@example.test');
  update public.profiles set created_at = now() - interval '9 days', username = 'neil' where id = u1;
  update public.profiles set created_at = now() - interval '8 days', username = 'Neil' where id = u2;
  update public.profiles set created_at = now() - interval '7 days', username = 'BOB' where id = u3;
  update public.profiles set created_at = now() - interval '6 days', username = 'Bob ' where id = u4;
  update public.profiles set created_at = now() - interval '5 days', username = 'has space' where id = u5;
  update public.profiles set created_at = now() - interval '4 days', username = 'Admin' where id = u6;
  update public.profiles set created_at = now() - interval '3 days', username = 'drvn' where id = u7;
  alter table public.profiles enable trigger profiles_username_choice;
  if private.audit_and_fix_usernames() <> 6 then
    raise exception 'FAIL U4a: the audit did not record exactly the six problem handles (N38)';
  end if;
  if (select username from public.profiles where id = u1) is distinct from 'neil'
     or (select username from public.profiles where id = u2) is not null
     or (select username from public.profiles where id = u3) is distinct from 'bob'
     or (select username from public.profiles where id = u4) is not null
     or (select username from public.profiles where id = u5) is not null
     or (select username from public.profiles where id = u6) is not null
     or (select username from public.profiles where id = u7) is distinct from 'drvn' then
    raise exception 'FAIL U4b: remediation did not lowercase the unambiguous, clear the rest and keep a held reserved name (N38)';
  end if;
  if not exists (select 1 from private.username_audit where user_id = u2 and problem = 'case_collision' and action = 'cleared' and old_username = 'Neil')
     or not exists (select 1 from private.username_audit where user_id = u3 and action = 'lowercased' and new_username = 'bob')
     or not exists (select 1 from private.username_audit where user_id = u6 and action = 'cleared')
     or not exists (select 1 from private.username_audit where user_id = u7 and problem = 'reserved' and action = 'kept') then
    raise exception 'FAIL U4c: the audit does not say what happened to each handle (N38)';
  end if;
  if private.audit_and_fix_usernames() <> 0 then
    raise exception 'FAIL U4d: a second audit found work the first left (N38)';
  end if;
  alter table public.profiles add constraint profiles_username_format
    check (username is null or username ~ '^[a-z0-9_]{3,30}$');

  if not has_function_privilege('anon', 'public.username_available(text)', 'execute')
     or has_table_privilege('authenticated', 'private.username_tombstones', 'select')
     or has_table_privilege('authenticated', 'private.reserved_usernames', 'select')
     or has_table_privilege('authenticated', 'private.username_audit', 'select') then
    raise exception 'FAIL U5: the username rules are exposed wrongly (N38)';
  end if;
  if has_function_privilege('authenticated', 'private.audit_and_fix_usernames()', 'execute') then
    raise exception 'FAIL U6: members can run the username remediation (N38)';
  end if;

  -- ---------- N16: the scrub ----------
  insert into public.listings (id, seller_id, title, category, price_cents, status) values
    (part, m, 'Dana''s turbo', 'performance', 50000, 'sold'),
    (their_part, o, 'Olly''s wheels', 'performance', 80000, 'active');
  insert into public.orders (id, buyer_id, seller_id, status, subtotal_cents, total_cents, completed_at,
                             ship_name, ship_line1, ship_line2, ship_city, ship_postcode, ship_country, ship_state, ship_phone,
                             accepted_checkout_shipping)
  values
    (bought, m, o, 'completed', 80000, 82500, later,
     'Dana Deleter', '1 Private Road', 'Flat 2', 'Leeds', 'LS1 1AA', 'GB', 'West Yorkshire', '+44 7000 000000',
     '{"name":"Dana Deleter","line1":"1 Private Road","city":"Leeds","postcode":"LS1 1AA","country":"GB","isCollection":false}'),
    (sold, o, m, 'completed', 50000, 52000, now() - interval '1 day',
     'Olly Other', '9 Other Street', null, 'York', 'YO1 1AA', 'GB', null, null, null);
  update public.orders set buyer_label = 'Dana Deleter', seller_label = 'Olly' where id = bought;
  update public.orders set buyer_label = 'Olly', seller_label = 'Dana Deleter' where id = sold;
  insert into public.seller_fulfillment_profiles (seller_id, ship_from_name, street1, city, postal_code, country, phone)
    values (m, 'Dana Deleter', '1 Private Road', 'Leeds', 'LS1 1AA', 'GB', '+44 7000 000000');
  insert into public.purchase_attempts (idempotency_key, buyer_id, result, checkout_context)
    values (repeat('c', 64), m, '{}', '{"version":1,"shipping":{"name":"Dana Deleter","line1":"1 Private Road"},"destinationHash":"x","quoteIds":{}}');
  insert into public.messages (id, order_id, sender_id, recipient_id, body, attachments) values
    (msg_theirs, sold, o, m, 'Posted it today', '{}');
  insert into public.messages (id, order_id, sender_id, recipient_id, body, attachments) values
    (msg_mine, sold, m, o, 'My number is 07000 000000', array[m::text || '/' || o::text || '/a.webp']);
  select conversation_id into conv from public.messages where id = msg_mine;
  insert into public.listing_questions (listing_id, author_id, body) values (their_part, m, 'Do they fit an E46? Call me on 07000');
  insert into public.activity_posts (id, car_id, author_id, title, body, published_at)
    values (post, null, o, 'Olly''s update', '{"type":"doc","content":[]}', now());
  insert into public.activity_comments (post_id, author_id, body) values (post, m, 'Love it, Dana here');
  insert into public.follows (follower_id, target_type, target_id) values (m, 'profile', o), (o, 'profile', m);
  insert into public.saved_searches (user_id, name) values (m, 'E46 parts');
  insert into public.notifications (user_id, kind, section, title) values (m, 'follow', 'engagement', 'Olly followed you');

  -- S1: nothing to scrub without a deletion under way.
  if not pg_temp.raises(format('select public.scrub_deleted_account(%L, %L, %L)', m, digest, 'test-v1'), '55000') then
    raise exception 'FAIL S1: an account was scrubbed with no deletion requested (N16)';
  end if;

  -- S2: never while money is still moving.
  insert into public.orders (id, buyer_id, seller_id, status, subtotal_cents, total_cents)
    values (pending_order, held, o, 'paid', 1000, 1000);
  insert into public.remediation_jobs (kind, dedup_key, payload) values ('delete_account', 'delete:' || held, jsonb_build_object('user_id', held));
  insert into public.account_deletion_requests (user_id, outcome, next_action) values (held, 'cleanup_pending', 'x');
  if not pg_temp.raises(format('select public.scrub_deleted_account(%L, %L, %L)', held, digest, 'test-v1'), '55000') then
    raise exception 'FAIL S2: an account with an order in progress was scrubbed (N16)';
  end if;

  insert into public.remediation_jobs (kind, dedup_key, payload) values ('delete_account', 'delete:' || m, jsonb_build_object('user_id', m));
  insert into public.account_deletion_requests (user_id, outcome, next_action, policy_decisions_pending)
    values (m, 'cleanup_pending', 'x', array['financial record retention duration','audit/log retention','backup expiry','eventual identity anonymization']);
  r := public.scrub_deleted_account(m, digest, 'test-v1');

  -- S3: Auth email and metadata.
  if (select email from auth.users where id = m) is not null
     or (select raw_user_meta_data from auth.users where id = m) <> '{}'::jsonb
     or exists (select 1 from public.account_emails where user_id = m) then
    raise exception 'FAIL S3: the sign-in email or metadata survived (N16)';
  end if;

  -- S4: the profile, and the handle retired.
  if (select display_name from public.profiles where id = m) <> 'Deleted member'
     or (select username from public.profiles where id = m) is not null
     or (select bio from public.profiles where id = m) is not null
     or not exists (select 1 from private.username_tombstones where username = 'dana_deletes')
     or public.username_available('dana_deletes') <> 'taken'
     or not pg_temp.raises(format('update public.profiles set username = %L where id = %L', 'dana_deletes', u2), '23505') then
    raise exception 'FAIL S4: the profile kept personal fields, or its handle can be taken again (N16)';
  end if;

  -- S5: addresses.
  if exists (select 1 from public.seller_fulfillment_profiles where seller_id = m)
     or exists (select 1 from public.orders where id = bought and (ship_name is not null or ship_line1 is not null or ship_line2 is not null
                or ship_city is not null or ship_postcode is not null or ship_state is not null or ship_phone is not null))
     or (select accepted_checkout_shipping from public.orders where id = bought) <> '{"country":"GB","isCollection":false}'::jsonb
     or exists (select 1 from public.purchase_attempts where buyer_id = m and (checkout_context ? 'shipping' or checkout_context ? 'destinationHash')) then
    raise exception 'FAIL S5: an address survived (N16)';
  end if;

  -- S6: party labels, on both sides.
  if (select buyer_label from public.orders where id = bought) <> 'Deleted member'
     or (select seller_label from public.orders where id = sold) <> 'Deleted member'
     or (select seller_label from public.orders where id = bought) <> 'Olly'
     or (select buyer_label from public.orders where id = sold) <> 'Olly' then
    raise exception 'FAIL S6: order party labels were not scrubbed, or the other party''s were (N16)';
  end if;

  -- S7: what they wrote is gone; what the other party wrote is not.
  if (select body from public.messages where id = msg_mine) <> 'Removed: this member deleted their account.'
     or cardinality((select attachments from public.messages where id = msg_mine)) <> 0
     or (select body from public.messages where id = msg_theirs) <> 'Posted it today'
     or exists (select 1 from public.listing_questions where author_id = m and body <> 'Removed: this member deleted their account.')
     or exists (select 1 from public.activity_comments where author_id = m)
     or (conv is not null and (select last_message_preview from public.conversations where id = conv) ilike '%07000%') then
    raise exception 'FAIL S7: message, question or comment bodies survived, or the other party''s were touched (N16)';
  end if;

  -- S8: their own social record.
  if exists (select 1 from public.follows where follower_id = m or target_id = m)
     or exists (select 1 from public.saved_searches where user_id = m)
     or exists (select 1 from public.notifications where user_id = m) then
    raise exception 'FAIL S8: follows, saved searches or notifications survived (N16)';
  end if;

  -- S9: transaction keys are kept.
  if (select count(*) from public.orders where id in (bought, sold)) <> 2
     or (select total_cents from public.orders where id = bought) <> 82500
     or (select ship_country from public.orders where id = bought) <> 'GB'
     or (select buyer_id from public.orders where id = bought) <> m
     or not exists (select 1 from public.profiles where id = m) then
    raise exception 'FAIL S9: a transaction key went with the personal data (N16)';
  end if;

  -- S10: the keyed digest and the 6-year clock, from the later of now and
  -- the last order activity (the bought order completes in 3 days).
  select * into req from public.account_deletion_requests where user_id = m;
  if req.email_digest <> digest or req.email_digest_key <> 'test-v1' or req.scrubbed_at is null
     or req.retention_starts_at <> later
     or req.retain_until <> later + interval '6 years'
     or (r->>'retain_until')::timestamptz <> req.retain_until
     or 'financial record retention duration' = any (req.policy_decisions_pending)
     or 'eventual identity anonymization' = any (req.policy_decisions_pending)
     or not ('backup expiry' = any (req.policy_decisions_pending)) then
    raise exception 'FAIL S10: digest or retention clock wrong (%) (N16)', row_to_json(req);
  end if;

  -- S11: resumable — a second run changes nothing and keeps the first digest.
  r := public.scrub_deleted_account(m, repeat('cd', 32), 'other-key');
  if (r->>'messages')::int <> 0 or (r->>'questions')::int <> 0
     or (select email_digest from public.account_deletion_requests where user_id = m) <> digest
     or (select retain_until from public.account_deletion_requests where user_id = m) <> later + interval '6 years' then
    raise exception 'FAIL S11: a second scrub rewrote the record (%) (N16)', r;
  end if;

  -- The frozen accepted-offer address still can't be edited by anything else.
  if not pg_temp.raises(format('update public.orders set ship_country = %L where id = %L', 'FR', bought), 'P0001') then
    raise exception 'FAIL S11b: an accepted-offer delivery address became editable (N16)';
  end if;

  -- S11c: the worker can checkpoint every bucket it drains, the member's
  -- own message photos included (20261107220520).
  insert into public.deletion_storage_tasks (job_id, bucket, path, folder)
  select j.id, b, m::text, true
    from public.remediation_jobs j,
         unnest(array['avatars', 'car-images', 'activity-images', 'listing-images', 'message-photos']) b
   where j.dedup_key = 'delete:' || m;
  if (select count(*) from public.deletion_storage_tasks t join public.remediation_jobs j on j.id = t.job_id
       where j.dedup_key = 'delete:' || m) <> 5 then
    raise exception 'FAIL S11c: the deletion worker can''t checkpoint every bucket it drains (N16)';
  end if;

  -- S12: members can't call the scrub.
  if has_function_privilege('authenticated', 'public.scrub_deleted_account(uuid,text,text)', 'execute')
     or has_function_privilege('anon', 'public.scrub_deleted_account(uuid,text,text)', 'execute') then
    raise exception 'FAIL S12: a member can call the deletion scrub (N16)';
  end if;

  raise notice 'all account deletion scrub (N16) and username (N38) checks passed';
end $$;

rollback;
