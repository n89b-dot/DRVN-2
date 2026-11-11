-- OS-W08 R81 (with R-photos): private chat attachments.
--
-- Photos sent to the agent were uploaded to the member's public
-- listing-images folder (Codex D2): a chat-only photo was readable by anyone
-- with the link, cached for a year, and clearing the chat couldn't remove it
-- because a listing might use the same file.
--
-- 1. A private bucket, agent-chat-photos (`<owner>/<uuid>.webp`). No member
--    policy reads, writes or deletes it: the server re-encodes every upload
--    (no EXIF/GPS) and writes it with the service role, shows it through
--    short-lived signed links, and reads it back for the model only in a
--    photo job (R-photos). A photo that becomes a listing or update photo is
--    copied to that public bucket at that moment, so the chat copy stays
--    the chat's.
-- 2. agent_chat_append accepts only those photos, named by their Storage
--    "authenticated" address (which serves nothing without a signature).
--    This migration owns agent_chat_append from here; the body is
--    20261107100000's apart from the photo rule.
-- 3. agent_chat_photos_expired lists chat photos over 48 hours old, for the
--    agent sweep to delete: the privacy page's promise ("deleted after 48
--    hours unless you use them in a listing or an update" — a used photo
--    lives on as that listing's or update's own copy). Clearing the chat
--    deletes its photos at once (afterChatCleared).

begin;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('agent-chat-photos', 'agent-chat-photos', false, 10485760, array['image/webp'])
on conflict (id) do update
  set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create or replace function public.agent_chat_append(p_owner uuid, p_role text, p_body text, p_cards jsonb DEFAULT '[]'::jsonb, p_images text[] DEFAULT '{}'::text[])
returns table(id uuid, role text, body text, cards jsonb, images text[], created_at timestamp with time zone)
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_conversation uuid;
begin
  if p_owner is null or p_role not in ('member', 'agent') then
    raise exception 'invalid chat message' using errcode = '22023';
  end if;
  if p_role = 'member' and public.is_suspended(p_owner) then
    raise exception 'account is suspended' using errcode = '42501';
  end if;
  if p_cards is null or jsonb_typeof(p_cards) <> 'array' or jsonb_array_length(p_cards) > 5
     or exists (select 1 from jsonb_array_elements(p_cards) card where not public.agent_chat_card_ok(card))
     or (p_role = 'member' and jsonb_array_length(p_cards) > 0) then
    raise exception 'invalid chat cards' using errcode = '22023';
  end if;
  -- Photos: the member's own private chat uploads only, on their own
  -- message (R81, 20261107220300): never a public listing photo any more.
  if p_images is null or cardinality(p_images) > 4
     or (p_role = 'agent' and cardinality(p_images) > 0)
     or exists (select 1 from unnest(p_images) url
                 where url !~ ('^https?://[^/?#]+/storage/v1/object/authenticated/agent-chat-photos/' || p_owner::text
                               || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.webp$')
                    or length(url) > 2000) then
    raise exception 'invalid chat photos' using errcode = '22023';
  end if;

  insert into public.agent_conversations as c (owner_id, last_message_at)
  values (p_owner, now())
  on conflict (owner_id) do update set last_message_at = now()
  returning c.id into v_conversation;

  return query
  insert into public.agent_messages as m (conversation_id, owner_id, role, body, cards, images)
  values (v_conversation, p_owner, p_role, p_body, p_cards, p_images)
  returning m.id, m.role, m.body, m.cards, m.images, m.created_at;
end;
$function$;


revoke all on function public.agent_chat_append(uuid, text, text, jsonb, text[]) from public, anon, authenticated;
grant execute on function public.agent_chat_append(uuid, text, text, jsonb, text[]) to service_role;

-- Chat photos past the 48 hours the privacy page promises. The sweep
-- removes them through the Storage API; a message naming one then shows
-- no photo.
create or replace function public.agent_chat_photos_expired(p_older_than interval default interval '48 hours', p_limit integer default 500)
returns table (name text)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select o.name
    from storage.objects o
   where o.bucket_id = 'agent-chat-photos'
     and o.created_at < now() - greatest(coalesce(p_older_than, interval '48 hours'), interval '1 hour')
   order by o.created_at
   limit greatest(1, least(coalesce(p_limit, 500), 1000));
$$;

revoke all on function public.agent_chat_photos_expired(interval, integer) from public, anon, authenticated;
grant execute on function public.agent_chat_photos_expired(interval, integer) to service_role;

commit;
