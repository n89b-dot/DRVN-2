-- 20261025100000 — the agent chat (A3c), and export contract 2026-10-25.v11.
--
-- agent_messages gains `cards`: what the agent's reply points at (a listing
-- it looked up), as a short list of {kind, id} — never text, amounts or
-- limits. The chat page renders them as result cards that open the real
-- page (design 02/05). Members still can't write messages: the server
-- writes both sides after the member's own sign-in (src/features/agent/
-- chat.ts) through agent_chat_append, and the model reads only through
-- the member's own client.
-- The export carries the new column (v11). Idempotent.

begin;

alter table public.agent_messages add column if not exists cards jsonb not null default '[]'::jsonb;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'agent_messages_cards_shape') then
    alter table public.agent_messages add constraint agent_messages_cards_shape
      check (jsonb_typeof(cards) = 'array' and jsonb_array_length(cards) <= 5);
  end if;
end $$;
comment on column public.agent_messages.cards is
  'Result cards on an agent reply: up to five {kind, id} (20261025100000). Ids only.';

-- The service role still changes nothing in the agent tables directly
-- (20261021100000): the chat action stores each message through this one
-- function, after the member's own sign-in. It finds or makes the member's
-- one conversation, stores the message (the redaction trigger still runs),
-- and moves last_message_at. Cards are checked here as well as by the
-- column: listing ids only, nothing else in them.
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
     or exists (
       select 1 from jsonb_array_elements(p_cards) card
        where jsonb_typeof(card) <> 'object'
           or card->>'kind' is distinct from 'listing'
           or coalesce(card->>'id', '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
           or (select count(*) from jsonb_object_keys(card)) <> 2)
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


alter table public.account_export_requests drop constraint if exists account_export_requests_contract_version_check;
alter table public.account_export_requests add constraint account_export_requests_contract_version_check
  check (contract_version in ('2026-09-05.v1', '2026-09-05.v2', '2026-09-19.v4', '2026-10-08.v5', '2026-10-17.v6', '2026-10-17.v7', '2026-10-18.v8', '2026-10-19.v9', '2026-10-21.v10', '2026-10-25.v11'));

update public.account_export_requests
   set status = 'expired',
       expires_at = least(expires_at, now()),
       last_error = 'Superseded by export contract 2026-10-25.v11'
 where contract_version <> '2026-10-25.v11'
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
    values(uid,'2026-10-25.v11') returning id into request_id;
  insert into public.remediation_jobs(kind,dedup_key,payload)
    values('account_export','export:'||request_id,jsonb_build_object('request_id',request_id,'user_id',uid))
    on conflict(dedup_key) do nothing;
  return request_id;
end $function$
;

revoke all on function public.request_account_export() from public, anon;
grant execute on function public.request_account_export() to authenticated, service_role;

commit;
