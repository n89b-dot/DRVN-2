-- 20261107100000 — the agent's model boundary in the database (OS-W04, with
-- readiness report two's 66 and 67).
--
-- 1. Spend is reserved, not just checked (readiness 67). agent_spend_allowed
--    only compared today's spend with the cap, so a member at $1.99 of $2
--    could start a turn that cost $0.50, and N turns at once all passed the
--    same check. agent_spend_reserve now holds a turn's whole budget before
--    the model is called, under one lock on agent_spend_limits, against
--    today's spend plus every hold still open; agent_spend_settle swaps the
--    hold for what the turn really used. A hold that is never settled (the
--    server died mid-turn) keeps counting at its full amount for the rest of
--    the UTC day: unknown spend counts as spent.
-- 2. A suspended member is refused (N127) by the reservation and by the
--    chat functions below, whatever the app checks first.
-- 3. The kill switches that reach the model (`all`, and this member's own
--    `member` or `account` row; agent/controls.ts) refuse the reservation
--    too (readiness 66), so a skipped app check still can't spend.
-- 4. A chat turn is idempotent on the client's request id (N121):
--    agent_chat_turn_begin stores the member's message once per
--    (owner, request); a retry gets that message back, and the reply once
--    agent_chat_turn_finish has stored it, without a second model call.
--    agent_chat_append is unchanged apart from refusing a suspended member's
--    own message.
--
-- No money rule changes: this is the AI provider's bill, not a member's.
-- Idempotent.

begin;

-- ---------------------------------------------------------------------------
-- 1. Spend holds
-- ---------------------------------------------------------------------------
create table if not exists public.agent_spend_holds (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  feature text not null check (feature in ('agent_chat', 'agent_eval', 'listing_import', 'marketplace_filters')),
  amount_usd numeric(12, 6) not null check (amount_usd > 0 and amount_usd <= 5),
  created_at timestamptz not null default now()
);

comment on table public.agent_spend_holds is
  'Model budget held for a call in flight (20261107100000): counted against the daily caps like spend until agent_spend_settle records the real usage. Service role only; amounts, never content.';

create index if not exists agent_spend_holds_owner_idx on public.agent_spend_holds(owner_id, created_at);
create index if not exists agent_spend_holds_created_idx on public.agent_spend_holds(created_at);
alter table public.agent_spend_holds enable row level security;
revoke all on public.agent_spend_holds from public, anon, authenticated, service_role;

create or replace function public.agent_spend_reserve(p_owner uuid, p_feature text, p_amount_usd numeric)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $function$
declare
  v_limits public.agent_spend_limits;
  v_day timestamptz := date_trunc('day', now() at time zone 'utc') at time zone 'utc';
  v_member numeric;
  v_global numeric;
  v_hold uuid;
begin
  if p_owner is null or p_feature is null or p_feature not in ('agent_chat', 'agent_eval', 'listing_import', 'marketplace_filters')
     or p_amount_usd is null or p_amount_usd <= 0 or p_amount_usd > 5 then
    raise exception 'Invalid spend reservation' using errcode = '22023';
  end if;
  if public.is_suspended(p_owner) then
    return jsonb_build_object('allowed', false, 'reason', 'suspended');
  end if;
  -- Read the switches the way agent_halt_reason does, so a switch being
  -- flipped right now is seen either before or after, never half.
  perform pg_advisory_xact_lock_shared(public.agent_controls_lock_key());
  if exists (select 1 from public.agent_controls c
             where c.cleared_at is null
               and (c.scope = 'all' or (c.scope in ('member', 'account') and c.subject_id = p_owner))) then
    return jsonb_build_object('allowed', false, 'reason', 'paused');
  end if;

  -- One reservation at a time, everyone's: the global cap needs it, and the
  -- transaction is a few index reads long.
  select * into v_limits from public.agent_spend_limits where singleton for update;
  if not found then
    return jsonb_build_object('allowed', false, 'reason', 'spend_cap');
  end if;
  delete from public.agent_spend_holds where created_at < now() - interval '2 days';

  select coalesce(sum(u.cost_usd) filter (where u.owner_id = p_owner), 0), coalesce(sum(u.cost_usd), 0)
    into v_member, v_global
    from public.agent_usage u where u.created_at >= v_day;
  select v_member + coalesce(sum(h.amount_usd) filter (where h.owner_id = p_owner), 0), v_global + coalesce(sum(h.amount_usd), 0)
    into v_member, v_global
    from public.agent_spend_holds h where h.created_at >= v_day;

  if v_member + p_amount_usd > v_limits.per_member_daily_usd or v_global + p_amount_usd > v_limits.global_daily_usd then
    return jsonb_build_object('allowed', false, 'reason', 'spend_cap',
      'member_usd', v_member, 'global_usd', v_global,
      'member_cap', v_limits.per_member_daily_usd, 'global_cap', v_limits.global_daily_usd);
  end if;

  insert into public.agent_spend_holds(owner_id, feature, amount_usd)
  values (p_owner, p_feature, p_amount_usd)
  returning id into v_hold;
  return jsonb_build_object('allowed', true, 'hold', v_hold);
end;
$function$;

revoke all on function public.agent_spend_reserve(uuid, text, numeric) from public, anon, authenticated;
grant execute on function public.agent_spend_reserve(uuid, text, numeric) to service_role;

-- The hold goes, and what the call really used is stored, in one step. A
-- hold already gone (swept after two days) still records the usage.
create or replace function public.agent_spend_settle(p_hold uuid, p_owner uuid, p_feature text, p_model text,
  p_input_tokens integer, p_output_tokens integer, p_cost_usd numeric default null, p_task uuid default null)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $function$
begin
  if p_hold is null or p_owner is null or p_feature is null or p_model is null or p_input_tokens is null or p_output_tokens is null
     or p_input_tokens < 0 or p_output_tokens < 0 or (p_cost_usd is not null and p_cost_usd < 0) then
    raise exception 'Invalid spend settlement' using errcode = '22023';
  end if;
  delete from public.agent_spend_holds where id = p_hold and owner_id = p_owner;
  if p_input_tokens + p_output_tokens > 0 then
    insert into public.agent_usage(owner_id, task_id, feature, model, input_tokens, output_tokens, cost_usd)
    values (p_owner, p_task, p_feature, p_model, p_input_tokens, p_output_tokens, p_cost_usd);
  end if;
end;
$function$;

revoke all on function public.agent_spend_settle(uuid, uuid, text, text, integer, integer, numeric, uuid) from public, anon, authenticated;
grant execute on function public.agent_spend_settle(uuid, uuid, text, text, integer, integer, numeric, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 2. A suspended member's own chat message is refused
-- ---------------------------------------------------------------------------
-- Latest: 20261025130000. Changed: the is_suspended check for p_role = 'member'.
create or replace function public.agent_chat_append(p_owner uuid, p_role text, p_body text, p_cards jsonb default '[]'::jsonb, p_images text[] default '{}'::text[])
returns table(id uuid, role text, body text, cards jsonb, images text[], created_at timestamp with time zone)
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
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

-- ---------------------------------------------------------------------------
-- 3. One chat turn per request id
-- ---------------------------------------------------------------------------
create table if not exists public.agent_chat_requests (
  owner_id uuid not null references public.profiles(id) on delete cascade,
  request_id uuid not null,
  member_message_id uuid references public.agent_messages(id) on delete set null,
  reply_message_id uuid references public.agent_messages(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (owner_id, request_id)
);

comment on table public.agent_chat_requests is
  'Which chat messages a client request id produced (20261107100000), so a retried send replays its turn instead of running it twice. Ids only; kept 7 days. Service role only.';

create index if not exists agent_chat_requests_created_idx on public.agent_chat_requests(created_at);
alter table public.agent_chat_requests enable row level security;
revoke all on public.agent_chat_requests from public, anon, authenticated, service_role;

-- A message row as the app reads it, or null.
create or replace function public.agent_chat_message_json(p_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $function$
  select jsonb_build_object('id', m.id, 'role', m.role, 'body', m.body, 'cards', m.cards, 'images', m.images, 'created_at', m.created_at)
  from public.agent_messages m where m.id = p_id;
$function$;

revoke all on function public.agent_chat_message_json(uuid) from public, anon, authenticated, service_role;

-- The member's message, stored once per request. Returns
-- {replayed, member, reply}: replayed is true when this request id was seen
-- before, and reply is its stored answer (null while that turn still runs).
create or replace function public.agent_chat_turn_begin(p_owner uuid, p_request uuid, p_body text, p_images text[] default '{}'::text[])
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $function$
declare
  v_request public.agent_chat_requests;
  v_member uuid;
begin
  if p_owner is null or p_request is null then
    raise exception 'invalid chat message' using errcode = '22023';
  end if;
  if public.is_suspended(p_owner) then
    raise exception 'account is suspended' using errcode = '42501';
  end if;
  delete from public.agent_chat_requests where created_at < now() - interval '7 days';

  insert into public.agent_chat_requests(owner_id, request_id) values (p_owner, p_request)
  on conflict (owner_id, request_id) do nothing;
  if not found then
    -- Seen before: wait for the first attempt's row, then replay it.
    select * into v_request from public.agent_chat_requests
    where owner_id = p_owner and request_id = p_request for update;
    return jsonb_build_object('replayed', true,
      'member', public.agent_chat_message_json(v_request.member_message_id),
      'reply', public.agent_chat_message_json(v_request.reply_message_id));
  end if;

  select a.id into v_member from public.agent_chat_append(p_owner, 'member', p_body, '[]'::jsonb, coalesce(p_images, '{}'::text[])) a;
  update public.agent_chat_requests set member_message_id = v_member where owner_id = p_owner and request_id = p_request;
  return jsonb_build_object('replayed', false, 'member', public.agent_chat_message_json(v_member), 'reply', null);
end;
$function$;

revoke all on function public.agent_chat_turn_begin(uuid, uuid, text, text[]) from public, anon, authenticated;
grant execute on function public.agent_chat_turn_begin(uuid, uuid, text, text[]) to service_role;

-- The agent's reply to that request, stored once: a second finish for the
-- same request returns the first reply.
create or replace function public.agent_chat_turn_finish(p_owner uuid, p_request uuid, p_body text, p_cards jsonb default '[]'::jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $function$
declare
  v_request public.agent_chat_requests;
  v_reply uuid;
begin
  select * into v_request from public.agent_chat_requests
  where owner_id = p_owner and request_id = p_request for update;
  if not found or v_request.member_message_id is null then
    raise exception 'No such chat request' using errcode = 'P0002';
  end if;
  if v_request.reply_message_id is not null then
    return public.agent_chat_message_json(v_request.reply_message_id);
  end if;
  select a.id into v_reply from public.agent_chat_append(p_owner, 'agent', p_body, coalesce(p_cards, '[]'::jsonb), '{}'::text[]) a;
  update public.agent_chat_requests set reply_message_id = v_reply where owner_id = p_owner and request_id = p_request;
  return public.agent_chat_message_json(v_reply);
end;
$function$;

revoke all on function public.agent_chat_turn_finish(uuid, uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.agent_chat_turn_finish(uuid, uuid, text, jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- Self-check
-- ---------------------------------------------------------------------------
do $$
begin
  if has_function_privilege('authenticated', 'public.agent_spend_reserve(uuid,text,numeric)', 'execute')
     or has_function_privilege('authenticated', 'public.agent_chat_turn_begin(uuid,uuid,text,text[])', 'execute') then
    raise exception 'SELF-CHECK FAILED: members can call the model boundary functions';
  end if;
  if not has_function_privilege('service_role', 'public.agent_spend_reserve(uuid,text,numeric)', 'execute') then
    raise exception 'SELF-CHECK FAILED: the server cannot reserve spend';
  end if;
end $$;

notify pgrst, 'reload schema';
commit;
