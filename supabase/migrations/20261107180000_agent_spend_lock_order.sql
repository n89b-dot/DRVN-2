-- 20261107180000 — the agent's model boundary, follow-up to 20261107100000
-- (OS-PR64 / OS-W04, after GPT's review of #64).
--
-- 1. A reservation could miss spend settled at the same moment (readiness
--    67). agent_spend_reserve read today's usage and the open holds in two
--    statements, and agent_spend_settle took no lock, so a settlement
--    between the two reads made a $0.50 hold vanish from the count while
--    its $0.30 usage wasn't counted yet: with a $1 cap, $0.40 recorded and
--    that hold, a second $0.50 was approved ($1.20 committed). Now settling
--    takes the same agent_spend_limits row lock first, and the reservation
--    reads both totals in one statement under that lock.
-- 2. A call whose outcome is unknown is now settled with a cost but no
--    tokens (run.ts charges a lost request's worst case). agent_spend_settle
--    stored usage only when it had tokens; it now stores a row whenever
--    there are tokens or a cost.
-- 3. agent_chat_turn_status: a retried send that finds its first attempt
--    still running gets the request id back as pending, and the client asks
--    here until the reply is stored (N121). Read only.
--
-- Idempotent.

begin;

-- Latest: 20261107100000. Changed: the usage and hold totals are read in one
-- statement, after the lock.
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

  -- One reservation or settlement at a time, everyone's: agent_spend_settle
  -- takes this lock too, so no hold can turn into usage between the reads
  -- below. The transaction is a few index reads long.
  select * into v_limits from public.agent_spend_limits where singleton for update;
  if not found then
    return jsonb_build_object('allowed', false, 'reason', 'spend_cap');
  end if;
  delete from public.agent_spend_holds where created_at < now() - interval '2 days';

  -- Spend and holds from one snapshot.
  select
    coalesce((select sum(u.cost_usd) from public.agent_usage u where u.created_at >= v_day and u.owner_id = p_owner), 0)
      + coalesce((select sum(h.amount_usd) from public.agent_spend_holds h where h.created_at >= v_day and h.owner_id = p_owner), 0),
    coalesce((select sum(u.cost_usd) from public.agent_usage u where u.created_at >= v_day), 0)
      + coalesce((select sum(h.amount_usd) from public.agent_spend_holds h where h.created_at >= v_day), 0)
  into v_member, v_global;

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

-- Latest: 20261107100000. Changed: the agent_spend_limits lock first, and a
-- usage row whenever there are tokens or a cost.
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
  -- The reservation's lock: a reservation sees this hold or this usage, never neither.
  perform 1 from public.agent_spend_limits where singleton for update;
  delete from public.agent_spend_holds where id = p_hold and owner_id = p_owner;
  if p_input_tokens + p_output_tokens > 0 or coalesce(p_cost_usd, 0) > 0 then
    insert into public.agent_usage(owner_id, task_id, feature, model, input_tokens, output_tokens, cost_usd)
    values (p_owner, p_task, p_feature, p_model, p_input_tokens, p_output_tokens, p_cost_usd);
  end if;
end;
$function$;

revoke all on function public.agent_spend_settle(uuid, uuid, text, text, integer, integer, numeric, uuid) from public, anon, authenticated;
grant execute on function public.agent_spend_settle(uuid, uuid, text, text, integer, integer, numeric, uuid) to service_role;

-- A chat request's messages so far: {found, member, reply}; reply is null
-- while the turn still runs. The owner's own request only.
create or replace function public.agent_chat_turn_status(p_owner uuid, p_request uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $function$
  select coalesce(
    (select jsonb_build_object('found', true,
              'member', public.agent_chat_message_json(r.member_message_id),
              'reply', public.agent_chat_message_json(r.reply_message_id))
       from public.agent_chat_requests r
      where r.owner_id = p_owner and r.request_id = p_request),
    jsonb_build_object('found', false, 'member', null, 'reply', null));
$function$;

revoke all on function public.agent_chat_turn_status(uuid, uuid) from public, anon, authenticated;
grant execute on function public.agent_chat_turn_status(uuid, uuid) to service_role;

do $$
begin
  if has_function_privilege('authenticated', 'public.agent_chat_turn_status(uuid,uuid)', 'execute') then
    raise exception 'SELF-CHECK FAILED: members can read chat request status';
  end if;
  if pg_get_functiondef('public.agent_spend_settle(uuid,uuid,text,text,integer,integer,numeric,uuid)'::regprocedure) !~* 'agent_spend_limits where singleton for update' then
    raise exception 'SELF-CHECK FAILED: settlement does not take the reservation lock';
  end if;
end $$;

notify pgrst, 'reload schema';
commit;
