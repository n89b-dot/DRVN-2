-- N627 (20261108120010): the old-photo metadata job rewrites message and chat
-- photos one at a time under the media cleanup's per-object lock. A rewrite
-- lease and a deletion claim exclude each other; only the lease's token
-- finishes it; finished objects drop out of the candidates until Storage holds
-- a newer version; dispute evidence is never a candidate. The write is fenced
-- on the object's identity: Storage's write always upserts, so a write after a
-- deletion makes a new row, and finish says 'recreated' (also to the next
-- claim, if the run died). The chat sweep skips a photo mid-rewrite. Service
-- role only.
begin;

do $$
declare
  sender uuid := gen_random_uuid();
  recipient uuid := gen_random_uuid();
  photo_a text;
  photo_b text;
  photo_c text;
  answer jsonb;
  token uuid;
  object_id uuid;
  chat text;
  names text[];
  rejected boolean := false;
begin
  insert into auth.users(id, email) values
    (sender, 'scrub-guard-sender@example.test'),
    (recipient, 'scrub-guard-recipient@example.test');
  insert into storage.buckets(id, name, public) values
    ('message-photos', 'message-photos', false), ('dispute-evidence', 'dispute-evidence', false), ('agent-chat-photos', 'agent-chat-photos', false)
  on conflict (id) do nothing;
  photo_a := sender || '/' || recipient || '/a-old.jpg';
  photo_b := sender || '/' || recipient || '/b-old.jpg';
  photo_c := sender || '/' || recipient || '/c-old.jpg';
  insert into storage.objects(bucket_id, name, owner, created_at, updated_at, metadata) values
    ('message-photos', photo_a, sender, now() - interval '60 days', now() - interval '60 days', '{"size": 2048}'),
    ('message-photos', photo_b, sender, now() - interval '60 days', now() - interval '60 days', '{"size": 4096}'),
    ('message-photos', photo_c, sender, now() - interval '60 days', now() - interval '60 days', '{"size": 1024}'),
    ('dispute-evidence', sender || '/case/evidence.jpg', sender, now() - interval '60 days', now() - interval '60 days', '{}');

  -- 1. Candidates page by name, from where the last page stopped.
  select array_agg(path order by path) into names
    from public.photo_metadata_candidates('message-photos', null, 2) where path like sender || '/%';
  if names is distinct from array[photo_a, photo_b] then raise exception 'FAIL 1: the first page is %', names; end if;
  select array_agg(path order by path) into names
    from public.photo_metadata_candidates('message-photos', photo_b, 2) where path like sender || '/%';
  if names is distinct from array[photo_c] then raise exception 'FAIL 2: the next page is %', names; end if;
  if (select size_bytes from public.photo_metadata_candidates('message-photos', null, 500) where path = photo_b) <> 4096 then
    raise exception 'FAIL 3: a candidate''s size was not read';
  end if;

  -- 2. Dispute evidence (kept as uploaded) is never a candidate or a rewrite.
  begin
    perform * from public.photo_metadata_candidates('dispute-evidence');
  exception when invalid_parameter_value then rejected := true; end;
  if not rejected then raise exception 'FAIL 4: dispute evidence was offered for rewriting'; end if;
  rejected := false;
  if public.claim_photo_rewrite('dispute-evidence', sender || '/case/evidence.jpg')->>'status' <> 'invalid' then
    raise exception 'FAIL 5: dispute evidence could be claimed for a rewrite';
  end if;

  -- 3. A rewrite lease excludes a second rewrite and the cleanup.
  answer := public.claim_photo_rewrite('message-photos', photo_a);
  if answer->>'status' <> 'claimed' then raise exception 'FAIL 6: the rewrite was not claimed: %', answer; end if;
  token := (answer->>'token')::uuid;
  object_id := (answer->>'object_id')::uuid;
  if object_id is distinct from (select id from storage.objects where bucket_id = 'message-photos' and name = photo_a) then
    raise exception 'FAIL 6a: the lease did not record the object''s identity';
  end if;
  if public.claim_photo_rewrite('message-photos', photo_a)->>'status' <> 'busy' then
    raise exception 'FAIL 7: two rewrites held one object';
  end if;
  if public.claim_media_deletion('message-photos', photo_a)->>'status' <> 'busy' then
    raise exception 'FAIL 8: cleanup claimed an object mid-rewrite';
  end if;

  -- 4. Only the lease's token finishes it.
  if public.check_photo_rewrite('message-photos', photo_a, token, object_id) <> 'current' then
    raise exception 'FAIL 8a: the holder''s pre-write check failed';
  end if;
  if public.check_photo_rewrite('message-photos', photo_a, gen_random_uuid(), object_id) <> 'lost' then
    raise exception 'FAIL 8b: another token passed the pre-write check';
  end if;
  if public.finish_photo_rewrite('message-photos', photo_a, gen_random_uuid(), object_id, 'scrubbed') <> 'lease_lost' then
    raise exception 'FAIL 9: another token finished the rewrite';
  end if;
  -- Written over in place (Storage merges into the row): same identity.
  update storage.objects set updated_at = now() - interval '1 day' where bucket_id = 'message-photos' and name = photo_a;
  if public.finish_photo_rewrite('message-photos', photo_a, token, object_id, 'scrubbed', 'exif') <> 'recorded' then
    raise exception 'FAIL 10: the holder could not finish its rewrite';
  end if;
  if exists (select 1 from private.media_rewrite_claims where bucket = 'message-photos' and path = photo_a) then
    raise exception 'FAIL 11: the lease outlived its finish';
  end if;
  if (select outcome from private.photo_metadata_scrubs where bucket = 'message-photos' and path = photo_a) <> 'scrubbed' then
    raise exception 'FAIL 12: the outcome was not recorded';
  end if;

  -- 5. Settled objects drop out (resumable); a newer version comes back.
  if exists (select 1 from public.photo_metadata_candidates('message-photos', null, 500) where path = photo_a) then
    raise exception 'FAIL 13: a re-encoded photo is offered again';
  end if;
  update storage.objects set updated_at = now() where bucket_id = 'message-photos' and name = photo_a;
  if not exists (select 1 from public.photo_metadata_candidates('message-photos', null, 500) where path = photo_a) then
    raise exception 'FAIL 14: a newer version of a checked photo is not checked again';
  end if;

  -- 6. A failed outcome is retried by the next run.
  answer := public.claim_photo_rewrite('message-photos', photo_c);
  perform public.finish_photo_rewrite('message-photos', photo_c, (answer->>'token')::uuid, (answer->>'object_id')::uuid, 'failed', 'download failed');
  if not exists (select 1 from public.photo_metadata_candidates('message-photos', null, 500) where path = photo_c) then
    raise exception 'FAIL 15: a failed photo is not retried';
  end if;

  -- 7. A deletion claim excludes the rewrite: busy while active, gone once done.
  answer := public.claim_media_deletion('message-photos', photo_b);
  if answer->>'status' <> 'claimed' then raise exception 'FAIL 16: cleanup could not claim an unreferenced photo: %', answer; end if;
  if public.claim_photo_rewrite('message-photos', photo_b)->>'status' <> 'busy' then
    raise exception 'FAIL 17: a photo being deleted was claimed for a rewrite';
  end if;
  if exists (select 1 from public.photo_metadata_candidates('message-photos', null, 500) where path = photo_b) then
    raise exception 'FAIL 18: a photo being deleted is a candidate';
  end if;
  delete from storage.objects where bucket_id = 'message-photos' and name = photo_b;   -- the cleanup's delete
  perform public.complete_media_deletion('message-photos', photo_b, (answer->>'token')::uuid);
  if public.claim_photo_rewrite('message-photos', photo_b)->>'status' <> 'gone' then
    raise exception 'FAIL 19: a deleted photo was claimed for a rewrite';
  end if;

  -- 8. An object Storage no longer holds is gone.
  if public.claim_photo_rewrite('message-photos', sender || '/' || recipient || '/never.jpg')->>'status' <> 'gone' then
    raise exception 'FAIL 20: a missing object was claimed for a rewrite';
  end if;

  -- 9. The write fence. A chat photo deleted (the member cleared the chat)
  --    before the write landed: Storage's upsert made a new row.
  chat := sender || '/' || gen_random_uuid() || '.webp';
  insert into storage.objects(bucket_id, name, owner, created_at) values ('agent-chat-photos', chat, sender, now() - interval '60 days');
  answer := public.claim_photo_rewrite('agent-chat-photos', chat);
  token := (answer->>'token')::uuid; object_id := (answer->>'object_id')::uuid;
  -- Mid-rewrite, the 48-hour sweep leaves it for its next pass.
  if exists (select 1 from public.agent_chat_photos_expired() where name = chat) then
    raise exception 'FAIL 20a: the chat sweep picked a photo mid-rewrite';
  end if;
  delete from storage.objects where bucket_id = 'agent-chat-photos' and name = chat;
  if public.check_photo_rewrite('agent-chat-photos', chat, token, object_id) <> 'gone' then
    raise exception 'FAIL 20b: the pre-write check missed a deletion';
  end if;
  insert into storage.objects(bucket_id, name, owner) values ('agent-chat-photos', chat, sender);
  if public.finish_photo_rewrite('agent-chat-photos', chat, token, object_id, 'scrubbed') <> 'recreated' then
    raise exception 'FAIL 20c: a write that recreated a deleted photo was recorded as a rewrite';
  end if;
  if not exists (select 1 from private.media_rewrite_claims where bucket = 'agent-chat-photos' and path = chat) then
    raise exception 'FAIL 20d: the lease was released over a recreated photo';
  end if;
  if public.claim_media_deletion('agent-chat-photos', chat)->>'status' <> 'busy' then
    raise exception 'FAIL 20e: the recreated photo was left unguarded';
  end if;
  -- The job deletes it again; then the lease goes.
  delete from storage.objects where bucket_id = 'agent-chat-photos' and name = chat;
  if public.finish_photo_rewrite('agent-chat-photos', chat, token, object_id, 'failed') <> 'gone' then
    raise exception 'FAIL 20f: a deleted photo was not reported gone';
  end if;
  if exists (select 1 from private.media_rewrite_claims where bucket = 'agent-chat-photos' and path = chat)
     or exists (select 1 from private.photo_metadata_scrubs where bucket = 'agent-chat-photos' and path = chat) then
    raise exception 'FAIL 20g: a gone photo kept its lease or got an outcome';
  end if;

  -- 10. A run that died after recreating one: the next claim, once the lease
  --     lapses, says so.
  insert into storage.objects(bucket_id, name, owner, created_at) values ('agent-chat-photos', chat, sender, now() - interval '60 days');
  answer := public.claim_photo_rewrite('agent-chat-photos', chat);
  object_id := (answer->>'object_id')::uuid;
  delete from storage.objects where bucket_id = 'agent-chat-photos' and name = chat;
  insert into storage.objects(bucket_id, name, owner) values ('agent-chat-photos', chat, sender);
  update private.media_rewrite_claims set claimed_at = now() - interval '11 minutes' where bucket = 'agent-chat-photos' and path = chat;
  answer := public.claim_photo_rewrite('agent-chat-photos', chat);
  if answer->>'status' <> 'recreated' or (answer->>'object_id')::uuid <> object_id then
    raise exception 'FAIL 20h: the next claim did not find the recreated photo: %', answer;
  end if;
  delete from storage.objects where bucket_id = 'agent-chat-photos' and name = chat;
  if public.finish_photo_rewrite('agent-chat-photos', chat, (answer->>'token')::uuid, object_id, 'failed') <> 'gone' then
    raise exception 'FAIL 20i: the recreated photo''s lease was not closed';
  end if;

  -- N627 fix-check 1: a tombstone must not hide a live object. A write that
  -- landed after the cleanup deleted the photo, then a crash: the stale lease
  -- and the tombstoned path with a row are both listed as strays, and the
  -- next claim says 'recreated' so the job deletes it again.
  photo_b := sender || '/' || recipient || '/late-write.jpg';
  insert into storage.objects(bucket_id, name, owner, created_at) values ('message-photos', photo_b, sender, now() - interval '60 days');
  answer := public.claim_photo_rewrite('message-photos', photo_b);
  update private.media_rewrite_claims set claimed_at = now() - interval '11 minutes' where bucket = 'message-photos' and path = photo_b;
  answer := public.claim_media_deletion('message-photos', photo_b);
  if answer->>'status' <> 'claimed' then raise exception 'FAIL 20j: cleanup could not claim after the lease lapsed: %', answer; end if;
  delete from storage.objects where bucket_id = 'message-photos' and name = photo_b;
  perform public.complete_media_deletion('message-photos', photo_b, (answer->>'token')::uuid);
  insert into storage.objects(bucket_id, name, owner) values ('message-photos', photo_b, sender);   -- the late write
  if exists (select 1 from public.photo_metadata_candidates('message-photos', null, 500) where path = photo_b) then
    raise exception 'FAIL 20k: a tombstoned path became an ordinary candidate';
  end if;
  if not exists (select 1 from public.photo_rewrite_strays('message-photos') where path = photo_b) then
    raise exception 'FAIL 20l: the recreated photo at a tombstoned path is not listed as a stray';
  end if;
  answer := public.claim_photo_rewrite('message-photos', photo_b);
  if answer->>'status' <> 'recreated' then raise exception 'FAIL 20m: the next claim did not say recreated: %', answer; end if;
  delete from storage.objects where bucket_id = 'message-photos' and name = photo_b;
  if public.finish_photo_rewrite('message-photos', photo_b, (answer->>'token')::uuid, (answer->>'object_id')::uuid, 'failed') <> 'gone' then
    raise exception 'FAIL 20n: the stray''s lease was not closed';
  end if;
  if exists (select 1 from public.photo_rewrite_strays('message-photos') where path = photo_b) then
    raise exception 'FAIL 20o: a deleted stray is still listed';
  end if;
  -- The same with no lease left at all: an object at a tombstoned path.
  insert into storage.objects(bucket_id, name, owner) values ('message-photos', photo_b, sender);
  if not exists (select 1 from public.photo_rewrite_strays('message-photos') where path = photo_b)
     or public.claim_photo_rewrite('message-photos', photo_b)->>'status' <> 'recreated' then
    raise exception 'FAIL 20p: an object at a tombstoned path with no lease is not deleted again';
  end if;

  -- 11. A lease that ran out (a job that died) no longer holds off cleanup.
  token := (public.claim_photo_rewrite('message-photos', photo_a)->>'token')::uuid;
  update private.media_rewrite_claims set claimed_at = now() - interval '11 minutes' where bucket = 'message-photos' and path = photo_a;
  if public.claim_media_deletion('message-photos', photo_a)->>'status' <> 'claimed' then
    raise exception 'FAIL 21: a lapsed rewrite lease still blocked cleanup';
  end if;

  -- 12. Members can't call any of it.
  if has_function_privilege('authenticated', 'public.claim_photo_rewrite(text,text)', 'execute')
     or has_function_privilege('authenticated', 'public.finish_photo_rewrite(text,text,uuid,uuid,text,text)', 'execute')
     or has_function_privilege('authenticated', 'public.check_photo_rewrite(text,text,uuid,uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.photo_rewrite_strays(text,integer)', 'execute')
     or has_function_privilege('authenticated', 'public.photo_metadata_candidates(text,text,integer,timestamp with time zone)', 'execute')
     or has_function_privilege('anon', 'public.photo_metadata_scrub_summary()', 'execute') then
    raise exception 'FAIL 22: a member credential can drive the metadata job';
  end if;

  raise notice 'all photo metadata scrub checks passed';
end $$;

rollback;
