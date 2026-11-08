-- N627 (20261108120010): the old-photo metadata job rewrites message and chat
-- photos one at a time under the media cleanup's per-object lock. A rewrite
-- lease and a deletion claim exclude each other; only the lease's token
-- finishes it; finished objects drop out of the candidates until Storage holds
-- a newer version; dispute evidence is never a candidate. Service role only.
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
  if public.claim_photo_rewrite('message-photos', photo_a)->>'status' <> 'busy' then
    raise exception 'FAIL 7: two rewrites held one object';
  end if;
  if public.claim_media_deletion('message-photos', photo_a)->>'status' <> 'busy' then
    raise exception 'FAIL 8: cleanup claimed an object mid-rewrite';
  end if;

  -- 4. Only the lease's token finishes it.
  if public.finish_photo_rewrite('message-photos', photo_a, gen_random_uuid(), 'scrubbed') then
    raise exception 'FAIL 9: another token finished the rewrite';
  end if;
  if not public.finish_photo_rewrite('message-photos', photo_a, token, 'scrubbed', 'exif') then
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
  token := (public.claim_photo_rewrite('message-photos', photo_c)->>'token')::uuid;
  perform public.finish_photo_rewrite('message-photos', photo_c, token, 'failed', 'download failed');
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
  perform public.complete_media_deletion('message-photos', photo_b, (answer->>'token')::uuid);
  if public.claim_photo_rewrite('message-photos', photo_b)->>'status' <> 'gone' then
    raise exception 'FAIL 19: a deleted photo was claimed for a rewrite';
  end if;

  -- 8. An object Storage no longer holds is gone.
  if public.claim_photo_rewrite('message-photos', sender || '/' || recipient || '/never.jpg')->>'status' <> 'gone' then
    raise exception 'FAIL 20: a missing object was claimed for a rewrite';
  end if;

  -- 9. A lease that ran out (a job that died) no longer holds off cleanup.
  token := (public.claim_photo_rewrite('message-photos', photo_a)->>'token')::uuid;
  update private.media_rewrite_claims set claimed_at = now() - interval '11 minutes' where bucket = 'message-photos' and path = photo_a;
  if public.claim_media_deletion('message-photos', photo_a)->>'status' <> 'claimed' then
    raise exception 'FAIL 21: a lapsed rewrite lease still blocked cleanup';
  end if;

  -- 10. Members can't call any of it.
  if has_function_privilege('authenticated', 'public.claim_photo_rewrite(text,text)', 'execute')
     or has_function_privilege('authenticated', 'public.finish_photo_rewrite(text,text,uuid,text,text)', 'execute')
     or has_function_privilege('authenticated', 'public.photo_metadata_candidates(text,text,integer,timestamp with time zone)', 'execute')
     or has_function_privilege('anon', 'public.photo_metadata_scrub_summary()', 'execute') then
    raise exception 'FAIL 22: a member credential can drive the metadata job';
  end if;

  raise notice 'all photo metadata scrub checks passed';
end $$;

rollback;
