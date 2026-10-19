-- 20261025140000 — "Ask about DRVN" cards in the agent chat (A4).
--
-- One more card shape: a Marketplace search the agent counted for the
-- member (browse_marketplace, public listings only): the words, a count up
-- to 1,000 (capped above that), and the Marketplace URL with those filters.
-- The URL is a relative /marketplace path only.
--
-- And agent_usage takes a fourth feature, marketplace_filters: the
-- Marketplace's "turn this into filters" (A4) is one model call, capped and
-- counted with chat. Everything else unchanged. Idempotent.

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
    when p_card->>'kind' = 'marketplace' then
      not exists (select 1 from jsonb_object_keys(p_card) k where k not in ('kind', 'id', 'query', 'href', 'count', 'capped'))
      and coalesce(p_card->>'id', '') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      and jsonb_typeof(p_card->'query') = 'string' and length(p_card->>'query') between 1 and 200
      and jsonb_typeof(p_card->'href') = 'string' and length(p_card->>'href') <= 600
      and p_card->>'href' ~ '^/marketplace(/[a-z0-9-]+){0,2}(\?[^#]*)?$'
      and jsonb_typeof(p_card->'count') = 'number' and (p_card->>'count')::numeric between 0 and 1000
      and jsonb_typeof(p_card->'capped') = 'boolean'
    else false
  end;
$function$;

revoke all on function public.agent_chat_card_ok(jsonb) from public, anon, authenticated;
grant execute on function public.agent_chat_card_ok(jsonb) to service_role;

alter table public.agent_usage drop constraint if exists agent_usage_feature_check;
alter table public.agent_usage add constraint agent_usage_feature_check
  check (feature in ('agent_chat', 'agent_eval', 'listing_import', 'marketplace_filters'));

commit;
