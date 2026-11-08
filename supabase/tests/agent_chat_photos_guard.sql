-- OS-W08 R81: private agent chat photos (20261107220300).
--   * the bucket is private and no member policy reads, writes or deletes it
--   * a chat message names only the member's own private chat photo
--   * agent_chat_photos_expired lists exactly the photos past 48 hours, as the
--     privacy page promises
begin;

-- Hosted Supabase grants client roles the storage tables and lets row
-- security decide; the test image doesn't, so grant them here (rolled back)
-- to test the policies a member really meets.
grant usage on schema storage to anon, authenticated;
grant select, insert, update, delete on storage.objects to anon, authenticated;

do $$
declare
  member uuid := gen_random_uuid();
  other uuid := gen_random_uuid();
  kept text := gen_random_uuid()::text || '.webp';
  orphan text := gen_random_uuid()::text || '.webp';
  fresh text := gen_random_uuid()::text || '.webp';
  refused boolean;
  n int;
  listed text[];
begin
  if (select public from storage.buckets where id = 'agent-chat-photos') is distinct from false then
    raise exception 'FAIL 1: the agent chat photo bucket is missing or public';
  end if;
  if exists (select 1 from pg_policies where schemaname = 'storage' and permissive = 'PERMISSIVE'
               and coalesce(qual, '') || coalesce(with_check, '') like '%agent-chat-photos%') then
    raise exception 'FAIL 2: a storage policy lets members at agent chat photos';
  end if;
  if has_function_privilege('authenticated', 'public.agent_chat_photos_expired(interval,integer)', 'execute')
     or has_function_privilege('authenticated', 'public.agent_chat_append(uuid,text,text,jsonb,text[])', 'execute') then
    raise exception 'FAIL 3: members can call the chat photo functions';
  end if;

  insert into auth.users(id, email, raw_user_meta_data) values
    (member, 'w08-member@drvn.test', '{}'), (other, 'w08-other@drvn.test', '{}');
  insert into storage.objects(bucket_id, name, owner, created_at) values
    ('agent-chat-photos', member || '/' || kept, member, now() - interval '3 days'),
    ('agent-chat-photos', member || '/' || orphan, member, now() - interval '3 days'),
    ('agent-chat-photos', member || '/' || fresh, member, now());

  -- A member, signed in, can't upload, see or delete chat photos directly.
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', member, 'role', 'authenticated')::text, true);
  refused := false;
  begin
    insert into storage.objects(bucket_id, name, owner) values ('agent-chat-photos', member || '/' || gen_random_uuid() || '.webp', member);
  exception when insufficient_privilege then refused := true;
  end;
  if not refused then raise exception 'FAIL 4: a member uploaded a chat photo past the server re-encode'; end if;
  if exists (select 1 from storage.objects where bucket_id = 'agent-chat-photos') then
    raise exception 'FAIL 5: a member can read chat photo objects directly';
  end if;
  delete from storage.objects where bucket_id = 'agent-chat-photos';
  perform set_config('role', 'anon', true);
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  if exists (select 1 from storage.objects where bucket_id = 'agent-chat-photos') then
    raise exception 'FAIL 6: a visitor can read chat photo objects';
  end if;
  perform set_config('role', 'none', true);
  if (select count(*) from storage.objects where bucket_id = 'agent-chat-photos') <> 3 then
    raise exception 'FAIL 7: a member deleted chat photo objects directly';
  end if;

  -- The message keeps one photo; the other is orphaned.
  perform public.agent_chat_append(member, 'member', 'List this part', '[]'::jsonb,
    array['https://x.supabase.co/storage/v1/object/authenticated/agent-chat-photos/' || member || '/' || kept]);
  refused := false;
  begin
    perform public.agent_chat_append(member, 'member', 'x', '[]'::jsonb,
      array['https://x.supabase.co/storage/v1/object/authenticated/agent-chat-photos/' || other || '/' || kept]);
  exception when invalid_parameter_value then refused := true;
  end;
  if not refused then raise exception 'FAIL 8: a message named someone else''s chat photo'; end if;
  refused := false;
  begin
    perform public.agent_chat_append(member, 'member', 'x', '[]'::jsonb,
      array['https://x.supabase.co/storage/v1/object/public/agent-chat-photos/' || member || '/' || kept]);
  exception when invalid_parameter_value then refused := true;
  end;
  if not refused then raise exception 'FAIL 9: a message named a chat photo by a public address'; end if;

  -- Past 48 hours every chat photo goes, named by a message or not; a used
  -- one lives on as its listing's or update's own copy.
  select array_agg(name order by name) into listed from public.agent_chat_photos_expired(interval '48 hours', 100)
   where name like member || '/%';
  if listed is distinct from (select array_agg(x order by x) from unnest(array[member || '/' || kept, member || '/' || orphan]) x) then
    raise exception 'FAIL 10: expired photos listed were %, not the two over 48 hours old', listed;
  end if;
  -- A caller can't shrink the window to nothing.
  select count(*) into n from public.agent_chat_photos_expired(interval '0 seconds', 100) where name like member || '/%';
  if n <> 2 then raise exception 'FAIL 11: a fresh photo was listed as expired (%)', n; end if;

  raise notice 'all agent chat photo checks passed';
end $$;

rollback;
