-- 20261107210200 — the agent's tool calls leave an audit record (OS-W07
-- R-audit).
--
-- agent_events has allowed kind 'tool_call' since 20261021100000, but
-- nothing wrote one, so a wrong reply couldn't be reconstructed: which tools
-- the model ran, on which objects, and what each answered. After every chat
-- turn the server now records one 'tool_call' event per tool call through
-- agent_record_tool_calls, successes, refusals and failures alike:
--
--   inputs = { tool, ids }            the tool's name (a capability name) and
--                                     the object ids it named (uuids only)
--   result = { outcome, code, ms, seq, turn }
--                                     ok | refused | failed, the error code,
--                                     how long it ran, its order in the turn,
--                                     and how the turn ended
--   initiated_by = 'chat:<request id>' the chat request it belongs to, the
--                                     correlation with agent_chat_requests
--   idempotency_key = 'tool:<request id>:<seq>'
--
-- Never the chat, a tool's other arguments (search words, a pasted list, a
-- link), its answer, or anything secret: the function rebuilds every field
-- from a fixed vocabulary and drops the rest, whatever the caller sends. The
-- tool name must be a capability's (anything else, which the model may have
-- made up, is kept as 'unknown_tool'); the id keys, error codes and turn
-- outcomes are fixed lists too (agent_audit_vocabulary below).
--
-- The insert trigger's card-number scrub (agent_redact_event) read the digit
-- groups of a uuid such as 42424242-4242-4242-8242-424242424242 as a card
-- number and replaced them. It now leaves a tool_call's `ids` alone when
-- every one of them is a validated uuid under a known key, and scrubs the
-- rest of the row as before; every other kind of event is unchanged.
-- The rows are owner-only through the existing "owners read their events"
-- policy, append-only (guard_agent_append_only), card-number redacted
-- (agent_redact_event), kept 12 months by the existing retention, and gone
-- with the owner (on delete cascade). No table, column, index or foreign key
-- changes; /agent's activity list reads only 'move' and 'decision' events,
-- so members don't see these as activity.
--
-- No money rule changes. Idempotent: a second call for the same request
-- records nothing more.

begin;

-- The fixed lists the audit keeps. The tools are the capabilities in
-- src/lib/capabilities/registry.ts (a unit test reads this list back), the
-- id keys AUDIT_ID_KEYS in src/lib/ai/run.ts, the codes CapabilityError's
-- and the turn outcomes AgentTurnFailure's.
create or replace function public.agent_audit_vocabulary(p_list text)
returns text[]
language sql
immutable
set search_path = public, pg_temp
as $function$
  select case p_list
    when 'tool' then array['search_parts', 'browse_marketplace', 'read_listing_messages', 'read_listing', 'read_my_car', 'read_product',
                           'fitment_evidence', 'price_comparables', 'list_my_cars', 'read_part_link', 'propose_build_change', 'draft_build_list',
                           'find_parts_to_list', 'draft_listing_from_photos', 'draft_car_update', 'move_offer', 'set_agent_limits', 'unknown_tool']
    when 'id_key' then array['listingId', 'carId', 'replacesModId', 'modId', 'modIds', 'offerId', 'proposalId']
    when 'code' then array['not_allowed', 'invalid_input', 'invalid_output', 'failed', 'stopped']
    when 'turn' then array['ok', 'ai_disabled', 'model_error', 'refused', 'incomplete', 'not_allowed', 'spend_cap', 'paused', 'suspended', 'timeout']
  end;
$function$;

-- Whether a tool_call's ids are exactly what agent_record_tool_calls builds:
-- known keys, each a lowercase uuid or a list of them.
create or replace function public.agent_audit_ids_valid(p_ids jsonb)
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $function$
  select jsonb_typeof(p_ids) = 'object' and not exists (
    select 1 from jsonb_each(p_ids) as kv(key, value)
    where kv.key <> all (public.agent_audit_vocabulary('id_key'))
       or not case jsonb_typeof(kv.value)
            when 'string' then (kv.value #>> '{}') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
            when 'array' then not exists (select 1 from jsonb_array_elements(kv.value) e
                                          where jsonb_typeof(e) <> 'string' or (e #>> '{}') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
            else false
          end);
$function$;

-- 20261021100000's scrub, the same for every event, except that a
-- tool_call's validated ids are kept as they are.
create or replace function public.agent_redact_event()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $function$
declare
  v_ids jsonb;
begin
  begin
    if new.kind = 'tool_call' and public.agent_audit_ids_valid(new.inputs->'ids') then
      v_ids := new.inputs->'ids';
      new.inputs := public.agent_redact_cards((new.inputs - 'ids')::text)::jsonb || jsonb_build_object('ids', v_ids);
    else
      new.inputs := public.agent_redact_cards(new.inputs::text)::jsonb;
    end if;
    new.result := public.agent_redact_cards(new.result::text)::jsonb;
  exception when others then
    new.inputs := jsonb_build_object('redacted', true);
    new.result := jsonb_build_object('redacted', true);
  end;
  return new;
end;
$function$;

revoke all on function public.agent_audit_vocabulary(text) from public, anon, authenticated, service_role;
revoke all on function public.agent_audit_ids_valid(jsonb) from public, anon, authenticated, service_role;

create or replace function public.agent_record_tool_calls(p_owner uuid, p_request uuid, p_turn text, p_calls jsonb)
returns integer
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $function$
declare
  v_call jsonb;
  v_seq integer := 0;
  v_tool text;
  v_outcome text;
  v_code text;
  v_ms integer;
  v_ids jsonb;
  v_key text;
  v_value jsonb;
  v_n integer := 0;
begin
  if p_owner is null or p_request is null then
    raise exception 'An owner and a request are required' using errcode = '22023';
  end if;
  if p_turn is null or p_turn <> all (public.agent_audit_vocabulary('turn')) then
    raise exception 'Bad turn outcome' using errcode = '22023';
  end if;
  if p_calls is null or jsonb_typeof(p_calls) <> 'array' or jsonb_array_length(p_calls) > 50 then
    raise exception 'Calls must be an array of at most 50' using errcode = '22023';
  end if;
  if not exists (select 1 from public.profiles where id = p_owner) then
    raise exception 'No such member' using errcode = 'P0002';
  end if;
  -- Recorded once per request: a repeat (a retried server action) adds nothing.
  if exists (select 1 from public.agent_events
             where owner_id = p_owner and kind = 'tool_call' and initiated_by = 'chat:' || p_request::text) then
    return 0;
  end if;

  for v_call in select value from jsonb_array_elements(p_calls) loop
    v_seq := v_seq + 1;
    if jsonb_typeof(v_call) <> 'object' then
      raise exception 'Call % is not an object', v_seq using errcode = '22023';
    end if;
    -- A capability's name, or unknown_tool: a name the model made up could hold anything.
    v_tool := v_call->>'tool';
    if v_tool is null or v_tool <> all (public.agent_audit_vocabulary('tool')) then v_tool := 'unknown_tool'; end if;
    v_outcome := v_call->>'outcome';
    if v_outcome is null or v_outcome not in ('ok', 'refused', 'failed') then
      raise exception 'Call % has a bad outcome', v_seq using errcode = '22023';
    end if;
    v_code := v_call->>'code';
    if v_code is not null and v_code <> all (public.agent_audit_vocabulary('code')) then v_code := 'failed'; end if;
    v_ms := case when jsonb_typeof(v_call->'ms') = 'number'
                 then least(greatest(round((v_call->>'ms')::numeric), 0), 600000)::integer end;
    -- Object ids only: a known key, and uuid values.
    v_ids := '{}'::jsonb;
    if jsonb_typeof(v_call->'ids') = 'object' then
      for v_key, v_value in select key, value from jsonb_each(v_call->'ids') loop
        continue when v_key <> all (public.agent_audit_vocabulary('id_key'));
        if jsonb_typeof(v_value) = 'string' and (v_value #>> '{}') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
          v_ids := v_ids || jsonb_build_object(v_key, lower(v_value #>> '{}'));
        elsif jsonb_typeof(v_value) = 'array' then
          v_ids := v_ids || jsonb_build_object(v_key, coalesce((
            select jsonb_agg(lower(e #>> '{}'))
            from (select e from jsonb_array_elements(v_value) e limit 40) picked
            where jsonb_typeof(e) = 'string'
              and (e #>> '{}') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'), '[]'::jsonb));
        end if;
      end loop;
    end if;

    insert into public.agent_events(owner_id, kind, initiated_by, inputs, result, idempotency_key)
    values (
      p_owner, 'tool_call', 'chat:' || p_request::text,
      jsonb_build_object('tool', v_tool, 'ids', v_ids),
      jsonb_strip_nulls(jsonb_build_object('outcome', v_outcome, 'code', v_code, 'ms', v_ms, 'seq', v_seq, 'turn', p_turn)),
      'tool:' || p_request::text || ':' || v_seq::text
    );
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$function$;

comment on function public.agent_record_tool_calls(uuid, uuid, text, jsonb) is
  'One tool_call agent_event per tool the model ran in a chat turn: tool name, object ids, outcome, code, timing, correlation. Never chat or arguments (20261107210200, OS-W07 R-audit). Server only.';

revoke all on function public.agent_record_tool_calls(uuid, uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.agent_record_tool_calls(uuid, uuid, text, jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- Self-check
-- ---------------------------------------------------------------------------
do $$
begin
  if has_function_privilege('authenticated', 'public.agent_record_tool_calls(uuid,uuid,text,jsonb)', 'execute')
     or has_function_privilege('anon', 'public.agent_record_tool_calls(uuid,uuid,text,jsonb)', 'execute') then
    raise exception 'SELF-CHECK FAILED: members can write the agent audit';
  end if;
  if not has_function_privilege('service_role', 'public.agent_record_tool_calls(uuid,uuid,text,jsonb)', 'execute') then
    raise exception 'SELF-CHECK FAILED: the server cannot write the agent audit';
  end if;
end $$;

notify pgrst, 'reload schema';
commit;
