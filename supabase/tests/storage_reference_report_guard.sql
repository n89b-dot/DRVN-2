-- N232 (20261108120020): the post-restore storage check. The report counts a
-- reference whose object Storage has no row for, and a member-media object
-- nothing names, but not an upload still staged; references are matched by
-- canonical identity, from every source the media cleanup knows plus agent
-- chat photos. A reference whose object is gone on purpose (a chat photo past
-- its 48 hours, or one the media cleanup deleted and tombstoned) is counted
-- apart, not as missing. Read-only, and service role only.
begin;

do $$
declare
  a uuid := gen_random_uuid();
  b uuid := gen_random_uuid();
  origin text := 'https://reportguard.supabase.co';
  chat_photo text := gen_random_uuid()::text || '.webp';
  expired_photo text := gen_random_uuid()::text || '.webp';
  live_gone_photo text := gen_random_uuid()::text || '.webp';
  photo_47h text := gen_random_uuid()::text || '.webp';
  photo_48h text := gen_random_uuid()::text || '.webp';
  photo_49h text := gen_random_uuid()::text || '.webp';
  object_47h text := gen_random_uuid()::text || '.webp';
  object_49h text := gen_random_uuid()::text || '.webp';
  tombstoned_row text;
  c uuid := gen_random_uuid();
  before jsonb;
  after jsonb;
  names text[];
begin
  insert into auth.users(id, email) values
    (a, 'storage-report-a@example.test'),
    (b, 'storage-report-b@example.test'),
    (c, 'storage-report-c@example.test');
  insert into storage.buckets(id, name, public) values
    ('avatars', 'avatars', true), ('agent-chat-photos', 'agent-chat-photos', false), ('message-photos', 'message-photos', false)
  on conflict (id) do nothing;

  before := public.storage_reference_report(0);

  -- a's avatar is in Storage; b's names an object Storage no longer has (a
  -- photo deleted after the recovery point). One of a's objects is named by
  -- nothing; another is an upload still staged, which is expected.
  insert into storage.objects(bucket_id, name, owner) values
    ('avatars', a || '/present.webp', a),
    ('avatars', a || '/orphan.webp', a),
    ('avatars', a || '/staged.webp', a),
    ('agent-chat-photos', a || '/' || chat_photo, a);
  update public.profiles set avatar_url = origin || '/storage/v1/object/public/avatars/' || a || '/present.webp' where id = a;
  -- Spelled with an escape: still the same object (b's, missing).
  update public.profiles set avatar_url = origin || '/storage/v1/object/public/avatars/' || b || '/gone%2Ewebp' where id = b;
  insert into public.staged_uploads(owner_id, bucket, path, url)
  values (a, 'avatars', a || '/staged.webp', origin || '/storage/v1/object/public/avatars/' || a || '/staged.webp');
  -- A chat photo, named by its authenticated address.
  perform public.agent_chat_append(a, 'member', 'Is this the right turbo?', '[]'::jsonb,
    array[origin || '/storage/v1/object/authenticated/agent-chat-photos/' || a || '/' || chat_photo]);

  -- Gone on purpose: c's avatar was deleted by the media cleanup (a
  -- tombstone), and a chat photo past its 48 hours was swept while its
  -- three-day-old message still names it.
  update public.profiles set avatar_url = origin || '/storage/v1/object/public/avatars/' || c || '/deleted.webp' where id = c;
  insert into private.media_deletion_claims(bucket, path, token, state, completed_at)
  values ('avatars', c || '/deleted.webp', gen_random_uuid(), 'done', now());
  perform public.agent_chat_append(a, 'member', 'Old photo', '[]'::jsonb,
    array[origin || '/storage/v1/object/authenticated/agent-chat-photos/' || a || '/' || expired_photo]);
  update public.agent_messages set created_at = now() - interval '3 days' where owner_id = a and body = 'Old photo';
  -- Not on purpose: a fresh chat message whose photo is gone.
  perform public.agent_chat_append(a, 'member', 'New photo', '[]'::jsonb,
    array[origin || '/storage/v1/object/authenticated/agent-chat-photos/' || a || '/' || live_gone_photo]);

  -- The sweep's own cutoff (N232 fix-check 3): 48 hours, and a sweep pass
  -- (every 5 minutes) since. 47½ hours, or 48 hours and a minute, is too
  -- young to have been swept: a missing photo then is a real loss.
  perform public.agent_chat_append(a, 'member', 'At 47.5h', '[]'::jsonb,
    array[origin || '/storage/v1/object/authenticated/agent-chat-photos/' || a || '/' || photo_47h]);
  update public.agent_messages set created_at = now() - interval '47 hours 30 minutes' where owner_id = a and body = 'At 47.5h';
  perform public.agent_chat_append(a, 'member', 'At 48h', '[]'::jsonb,
    array[origin || '/storage/v1/object/authenticated/agent-chat-photos/' || a || '/' || photo_48h]);
  update public.agent_messages set created_at = now() - interval '48 hours 1 minute' where owner_id = a and body = 'At 48h';
  perform public.agent_chat_append(a, 'member', 'At 49h', '[]'::jsonb,
    array[origin || '/storage/v1/object/authenticated/agent-chat-photos/' || a || '/' || photo_49h]);
  update public.agent_messages set created_at = now() - interval '49 hours' where owner_id = a and body = 'At 49h';

  after := public.storage_reference_report(500);

  -- 1. Counts move by exactly the fixtures.
  if (after->>'references')::int - (before->>'references')::int <> 9 then
    raise exception 'FAIL 1: % references added, expected 9', (after->>'references')::int - (before->>'references')::int;
  end if;
  -- Missing: b's avatar, the fresh chat photo, the 47½ h and 48 h 1 min ones.
  -- Expected: the tombstone, the 3-day and 49 h chat photos.
  if (after->>'missingObjects')::int - (before->>'missingObjects')::int <> 4 then
    raise exception 'FAIL 2: the missing object was not counted once: % → %', before->'missingObjects', after->'missingObjects';
  end if;
  if (after->>'unreferencedObjects')::int - (before->>'unreferencedObjects')::int <> 1 then
    raise exception 'FAIL 3: unreferenced objects moved % (a staged upload is not unreferenced)',
      (after->>'unreferencedObjects')::int - (before->>'unreferencedObjects')::int;
  end if;
  if coalesce((after->'missingByBucket'->>'avatars')::int, 0) - coalesce((before->'missingByBucket'->>'avatars')::int, 0) <> 1 then
    raise exception 'FAIL 4: the missing object was not counted under its bucket';
  end if;
  if (after->>'expectedMissing')::int - (before->>'expectedMissing')::int <> 3
     or coalesce((after->'expectedMissingByReason'->>'deleted')::int, 0) - coalesce((before->'expectedMissingByReason'->>'deleted')::int, 0) <> 1
     or coalesce((after->'expectedMissingByReason'->>'retention')::int, 0) - coalesce((before->'expectedMissingByReason'->>'retention')::int, 0) <> 2 then
    raise exception 'FAIL 4a: deletions on purpose were not told apart: %', after->'expectedMissingByReason';
  end if;
  if not (after->'expectedMissingSample') @> jsonb_build_array(jsonb_build_object('bucket', 'agent-chat-photos', 'path', a || '/' || expired_photo, 'reason', 'retention'))
     or not (after->'expectedMissingSample') @> jsonb_build_array(jsonb_build_object('bucket', 'avatars', 'path', c || '/deleted.webp', 'reason', 'deleted')) then
    raise exception 'FAIL 4b: the expected deletions are not the ones listed: %', after->'expectedMissingSample';
  end if;
  if (after->'missingSample') @> jsonb_build_array(jsonb_build_object('path', a || '/' || expired_photo))
     or not (after->'missingSample') @> jsonb_build_array(jsonb_build_object('bucket', 'agent-chat-photos', 'path', a || '/' || live_gone_photo)) then
    raise exception 'FAIL 4c: a fresh chat photo''s loss was excused, or an expired one reported: %', after->'missingSample';
  end if;

  -- N232 fix-check 3: 47½ h and 48 h 1 min are losses; 49 h is retention.
  if not (after->'missingSample') @> jsonb_build_array(jsonb_build_object('bucket', 'agent-chat-photos', 'path', a || '/' || photo_47h))
     or not (after->'missingSample') @> jsonb_build_array(jsonb_build_object('bucket', 'agent-chat-photos', 'path', a || '/' || photo_48h)) then
    raise exception 'FAIL 4d: a chat photo younger than the sweep''s cutoff was excused as expired: %', after->'expectedMissingSample';
  end if;
  if not (after->'expectedMissingSample') @> jsonb_build_array(jsonb_build_object('bucket', 'agent-chat-photos', 'path', a || '/' || photo_49h, 'reason', 'retention')) then
    raise exception 'FAIL 4e: a chat photo past the sweep''s cutoff was not expected: %', after->'missingSample';
  end if;

  -- N232 fix-check 2: object rows carry the same classification for the byte
  -- check. A restored row past retention, or at a tombstoned path, has its
  -- bytes deleted on purpose; one younger than the cutoff doesn't.
  tombstoned_row := a || '/' || b || '/tombstoned.jpg';
  insert into storage.objects(bucket_id, name, owner, created_at) values
    ('agent-chat-photos', a || '/' || object_47h, a, now() - interval '47 hours 30 minutes'),
    ('agent-chat-photos', a || '/' || object_49h, a, now() - interval '49 hours'),
    ('message-photos', tombstoned_row, a, now() - interval '1 day');
  insert into private.media_deletion_claims(bucket, path, token, state, completed_at)
  values ('message-photos', tombstoned_row, gen_random_uuid(), 'done', now());
  if (select expected_reason from public.storage_object_rows('agent-chat-photos', a || '/', 1000) where path = a || '/' || object_49h) is distinct from 'retention'
     or (select expected_reason from public.storage_object_rows('agent-chat-photos', a || '/', 1000) where path = a || '/' || object_47h) is not null
     or (select expected_reason from public.storage_object_rows('message-photos', null, 1000) where path = tombstoned_row) is distinct from 'deleted'
     or (select expected_reason from public.storage_object_rows('avatars', a || '/', 1000) where path = a || '/present.webp') is not null then
    raise exception 'FAIL 4f: object rows are not classified for the byte check';
  end if;

  -- 2. Each reference names its source; the escaped spelling decodes.
  if not exists (select 1 from private.storage_reference_rows()
                  where source = 'profiles.avatar_url' and bucket = 'avatars' and path = b || '/gone.webp') then
    raise exception 'FAIL 5: an escaped reference was not decoded to its object';
  end if;
  if not exists (select 1 from private.storage_reference_rows()
                  where source = 'agent_messages.images' and bucket = 'agent-chat-photos' and path = a || '/' || chat_photo) then
    raise exception 'FAIL 6: a chat photo reference was not read';
  end if;
  if (public.storage_reference_report(500)->'missingSample') @> jsonb_build_array(jsonb_build_object('bucket', 'avatars', 'path', a || '/present.webp')) then
    raise exception 'FAIL 7: an object Storage holds was reported missing';
  end if;

  -- 3. Object rows page by name, in member media buckets only.
  select array_agg(path order by path) into names from public.storage_object_rows('avatars', a || '/', 500) where path like a || '/%';
  if names is distinct from array[a || '/orphan.webp', a || '/present.webp', a || '/staged.webp'] then
    raise exception 'FAIL 8: object rows paged as %', names;
  end if;
  select array_agg(path order by path) into names from public.storage_object_rows('avatars', a || '/orphan.webp', 1) where path like a || '/%';
  if names is distinct from array[a || '/present.webp'] then raise exception 'FAIL 9: the next page is %', names; end if;
  if exists (select 1 from public.storage_object_rows('account-exports')) then
    raise exception 'FAIL 10: a non-media bucket was listed';
  end if;

  -- 4. Members can't run it.
  if has_function_privilege('authenticated', 'public.storage_reference_report(integer)', 'execute')
     or has_function_privilege('anon', 'public.storage_reference_report(integer)', 'execute')
     or has_function_privilege('authenticated', 'public.storage_object_rows(text,text,integer)', 'execute') then
    raise exception 'FAIL 11: a member credential can read the storage report';
  end if;

  raise notice 'all storage reference report checks passed';
end $$;

rollback;
