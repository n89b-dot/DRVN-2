-- 20261025110000 — "Update my build" cards in the agent chat (A3c, AG-9).
--
-- An agent reply can now carry a drafted build change for the member to
-- confirm: {kind: 'build_change', id (the new mod line's id), car, replaces,
-- brand, product, part_number, category, product_url, image_url}. Nothing is
-- saved until the member taps Confirm, which saves through save_mod_items as
-- the member; the card only describes the draft. agent_chat_append checks
-- each card's shape (agent_chat_card_ok) and still takes listing cards as
-- {kind, id} only. Idempotent.

begin;

CREATE OR REPLACE FUNCTION public.agent_chat_card_ok(p_card jsonb)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select case
    when jsonb_typeof(p_card) <> 'object' then false
    when p_card->>'kind' = 'listing' then
      (select count(*) from jsonb_object_keys(p_card)) = 2
      and coalesce(p_card->>'id', '') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    when p_card->>'kind' = 'build_change' then
      not exists (
        select 1 from jsonb_object_keys(p_card) k
         where k not in ('kind', 'id', 'car', 'replaces', 'brand', 'product', 'part_number', 'category', 'product_url', 'image_url'))
      and coalesce(p_card->>'id', '') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      and coalesce(p_card->>'car', '') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      and (p_card->'replaces' is null or jsonb_typeof(p_card->'replaces') = 'null'
           or coalesce(p_card->>'replaces', '') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
      and jsonb_typeof(p_card->'product') = 'string' and length(p_card->>'product') between 1 and 200
      and coalesce(jsonb_typeof(p_card->'brand'), 'null') in ('string', 'null') and coalesce(length(p_card->>'brand'), 0) <= 120
      and coalesce(jsonb_typeof(p_card->'part_number'), 'null') in ('string', 'null') and coalesce(length(p_card->>'part_number'), 0) <= 80
      and (coalesce(jsonb_typeof(p_card->'category'), 'null') = 'null'
           or p_card->>'category' in ('suspension', 'exhaust', 'intake', 'turbo', 'wheels', 'brakes', 'ecu-tune', 'aero-exterior', 'interior', 'drivetrain'))
      and (coalesce(jsonb_typeof(p_card->'product_url'), 'null') = 'null'
           or (jsonb_typeof(p_card->'product_url') = 'string' and length(p_card->>'product_url') <= 2000 and p_card->>'product_url' ~* '^https?://'))
      and (coalesce(jsonb_typeof(p_card->'image_url'), 'null') = 'null'
           or (jsonb_typeof(p_card->'image_url') = 'string' and length(p_card->>'image_url') <= 2000 and p_card->>'image_url' ~* '^https://'))
    else false
  end;
$function$;

revoke all on function public.agent_chat_card_ok(jsonb) from public, anon, authenticated;
grant execute on function public.agent_chat_card_ok(jsonb) to service_role;

CREATE OR REPLACE FUNCTION public.agent_chat_append(p_owner uuid, p_role text, p_body text, p_cards jsonb DEFAULT '[]'::jsonb)
 RETURNS TABLE(id uuid, role text, body text, cards jsonb, created_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_conversation uuid;
begin
  if p_owner is null or p_role not in ('member', 'agent') then
    raise exception 'invalid chat message' using errcode = '22023';
  end if;
  if p_cards is null or jsonb_typeof(p_cards) <> 'array' or jsonb_array_length(p_cards) > 5
     or exists (select 1 from jsonb_array_elements(p_cards) card where not public.agent_chat_card_ok(card))
     or (p_role = 'member' and jsonb_array_length(p_cards) > 0) then
    raise exception 'invalid chat cards' using errcode = '22023';
  end if;

  insert into public.agent_conversations as c (owner_id, last_message_at)
  values (p_owner, now())
  on conflict (owner_id) do update set last_message_at = now()
  returning c.id into v_conversation;

  return query
  insert into public.agent_messages as m (conversation_id, owner_id, role, body, cards)
  values (v_conversation, p_owner, p_role, p_body, p_cards)
  returning m.id, m.role, m.body, m.cards, m.created_at;
end;
$function$;

revoke all on function public.agent_chat_append(uuid, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.agent_chat_append(uuid, text, text, jsonb) to service_role;

comment on column public.agent_messages.cards is
  'Result cards on an agent reply, up to five (20261025100000, 20261025110000): a listing as {kind, id}, or a drafted build change for the member to confirm. Never a price or a limit.';

commit;
