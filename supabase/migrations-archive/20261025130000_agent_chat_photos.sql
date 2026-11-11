-- 20261025130000 — photos in the agent chat (A3d), and export contract 2026-10-25.v12.
--
-- A member's message can carry up to four photos: their own uploads to
-- listing-images (re-encoded on upload, so no location data), checked here
-- against the sender's folder. They go to the model with that one message
-- and are deleted with other unused uploads after 48 hours unless the member
-- uses them in a listing or update. Two more card shapes, both drafts that
-- open the real page prefilled and save nothing themselves:
--   * listing_draft ("Listing from photos"): what the photos show (title,
--     brand, part number, category) and the photos. Never a price or a
--     condition: the member adds those on the sell form;
--   * update_draft ("Post an update"): a title, a short body, the photos and
--     up to five parts on the car, for the update composer.
-- agent_chat_append gains p_images (so its signature changes: dropped and
-- recreated, service role only). The export carries the column (v12).
-- Idempotent.

begin;

alter table public.agent_messages add column if not exists images text[] not null default '{}';
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'agent_messages_images_shape') then
    alter table public.agent_messages add constraint agent_messages_images_shape
      check (cardinality(images) <= 4 and (role = 'member' or cardinality(images) = 0));
  end if;
end $$;
comment on column public.agent_messages.images is
  'Photos on a member''s message to their agent (20261025130000): up to four of their own listing-images uploads.';

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
    when p_card->>'kind' = 'build_list' then
      not exists (select 1 from jsonb_object_keys(p_card) k where k not in ('kind', 'id', 'car', 'lines'))
      and coalesce(p_card->>'id', '') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      and coalesce(p_card->>'car', '') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      and jsonb_typeof(p_card->'lines') = 'array'
      and jsonb_array_length(p_card->'lines') between 1 and 40
      and not exists (
        select 1 from jsonb_array_elements(p_card->'lines') line
         where jsonb_typeof(line) <> 'object'
            or exists (select 1 from jsonb_object_keys(line) k where k not in ('id', 'group_label', 'brand', 'product', 'part_number', 'category', 'confidence'))
            or coalesce(line->>'id', '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
            or coalesce(line->>'group_label', '') not in ('Performance', 'Suspension', 'Exterior', 'Interior', 'Wheels & Tires', 'Other')
            or coalesce(jsonb_typeof(line->'brand'), 'null') not in ('string', 'null') or coalesce(length(line->>'brand'), 0) > 120
            or coalesce(jsonb_typeof(line->'product'), 'null') not in ('string', 'null') or coalesce(length(line->>'product'), 0) > 200
            or coalesce(line->>'brand', line->>'product') is null
            or coalesce(jsonb_typeof(line->'part_number'), 'null') not in ('string', 'null') or coalesce(length(line->>'part_number'), 0) > 80
            or (coalesce(jsonb_typeof(line->'category'), 'null') <> 'null' and line->>'category' not in ('suspension', 'exhaust', 'intake', 'turbo', 'wheels', 'brakes', 'ecu-tune', 'aero-exterior', 'interior', 'drivetrain'))
            or jsonb_typeof(line->'confidence') <> 'number' or (line->>'confidence')::numeric not between 0 and 1)
    when p_card->>'kind' = 'list_part' then
      (select count(*) from jsonb_object_keys(p_card)) = 3
      and coalesce(p_card->>'id', '') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      and coalesce(p_card->>'car', '') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    when p_card->>'kind' = 'listing_draft' then
      not exists (select 1 from jsonb_object_keys(p_card) k where k not in ('kind', 'id', 'title', 'brand', 'part_number', 'category', 'images'))
      and coalesce(p_card->>'id', '') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      and jsonb_typeof(p_card->'title') = 'string' and length(p_card->>'title') between 1 and 140
      and coalesce(jsonb_typeof(p_card->'brand'), 'null') in ('string', 'null') and coalesce(length(p_card->>'brand'), 0) <= 80
      and coalesce(jsonb_typeof(p_card->'part_number'), 'null') in ('string', 'null') and coalesce(length(p_card->>'part_number'), 0) <= 80
      and (coalesce(jsonb_typeof(p_card->'category'), 'null') = 'null' or p_card->>'category' in ('suspension', 'exhaust', 'intake', 'turbo', 'wheels', 'brakes', 'ecu-tune', 'aero-exterior', 'interior', 'drivetrain'))
      and (jsonb_typeof(p_card->'images') = 'array' and jsonb_array_length(p_card->'images') between 1 and 4
           and not exists (select 1 from jsonb_array_elements(p_card->'images') img
                            where jsonb_typeof(img) <> 'string' or length(img #>> '{}') > 2000 or (img #>> '{}') !~* '^https?://'))
    when p_card->>'kind' = 'update_draft' then
      not exists (select 1 from jsonb_object_keys(p_card) k where k not in ('kind', 'id', 'car', 'title', 'body', 'images', 'mods'))
      and coalesce(p_card->>'id', '') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      and coalesce(p_card->>'car', '') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      and jsonb_typeof(p_card->'title') = 'string' and length(p_card->>'title') between 1 and 140
      and jsonb_typeof(p_card->'body') = 'string' and length(p_card->>'body') <= 2000
      and (jsonb_typeof(p_card->'images') = 'array' and jsonb_array_length(p_card->'images') between 1 and 4
           and not exists (select 1 from jsonb_array_elements(p_card->'images') img
                            where jsonb_typeof(img) <> 'string' or length(img #>> '{}') > 2000 or (img #>> '{}') !~* '^https?://'))
      and jsonb_typeof(p_card->'mods') = 'array' and jsonb_array_length(p_card->'mods') <= 5
      and not exists (select 1 from jsonb_array_elements(p_card->'mods') m where coalesce(m #>> '{}', '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
    else false
  end;
$function$;

revoke all on function public.agent_chat_card_ok(jsonb) from public, anon, authenticated;
grant execute on function public.agent_chat_card_ok(jsonb) to service_role;

drop function if exists public.agent_chat_append(uuid, text, text, jsonb);
CREATE OR REPLACE FUNCTION public.agent_chat_append(p_owner uuid, p_role text, p_body text, p_cards jsonb DEFAULT '[]'::jsonb, p_images text[] DEFAULT '{}'::text[])
 RETURNS TABLE(id uuid, role text, body text, cards jsonb, images text[], created_at timestamp with time zone)
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
  -- Photos: the member's own uploads only, on their own message.
  if p_images is null or cardinality(p_images) > 4
     or (p_role = 'agent' and cardinality(p_images) > 0)
     or exists (select 1 from unnest(p_images) url
                 where url !~* ('^https?://[^/]+/storage/v1/object/public/listing-images/' || p_owner::text || '/[^/]+$')
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

comment on column public.agent_messages.cards is
  'Result cards on an agent reply, up to five (20261025100000–20261025130000): a listing, a drafted build change, a parsed build list, a part to list, or a listing or update drafted from photos. Never a price or a limit.';

alter table public.account_export_requests drop constraint if exists account_export_requests_contract_version_check;
alter table public.account_export_requests add constraint account_export_requests_contract_version_check
  check (contract_version in ('2026-09-05.v1', '2026-09-05.v2', '2026-09-19.v4', '2026-10-08.v5', '2026-10-17.v6', '2026-10-17.v7', '2026-10-18.v8', '2026-10-19.v9', '2026-10-21.v10', '2026-10-25.v11', '2026-10-25.v12'));

update public.account_export_requests
   set status = 'expired',
       expires_at = least(expires_at, now()),
       last_error = 'Superseded by export contract 2026-10-25.v12'
 where contract_version <> '2026-10-25.v12'
   and status in ('pending', 'processing', 'failed');

CREATE OR REPLACE FUNCTION public.request_account_export()
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare uid uuid := auth.uid(); request_id uuid;
begin
  if uid is null then raise exception 'Sign in first' using errcode='42501'; end if;
  -- Shared with deletion and export publication so eligibility changes are
  -- serialized in one order for this account.
  perform pg_advisory_xact_lock(hashtextextended(uid::text,0));
  perform 1 from public.profiles where id=uid and suspended_at is null for share;
  if not found then raise exception 'Account access is suspended' using errcode='42501'; end if;
  select id into request_id from public.account_export_requests
   where user_id=uid and status in ('pending','processing') and expires_at>now()
   order by requested_at desc limit 1;
  if found then return request_id; end if;
  insert into public.account_export_requests(user_id,contract_version)
    values(uid,'2026-10-25.v12') returning id into request_id;
  insert into public.remediation_jobs(kind,dedup_key,payload)
    values('account_export','export:'||request_id,jsonb_build_object('request_id',request_id,'user_id',uid))
    on conflict(dedup_key) do nothing;
  return request_id;
end $function$
;

revoke all on function public.request_account_export() from public, anon;
grant execute on function public.request_account_export() to authenticated, service_role;

commit;
