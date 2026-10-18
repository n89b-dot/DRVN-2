-- 20261024100000 — the agent's admin controls and measurement.
--
-- The agent plan's "Alongside A3 — admin controls" and "measuring the
-- agent" (docs/plans/2026-10-agent-and-graph-plan.md):
--
-- 1. agent_beta_steps: each A3 step (seller, buyer, chat, jobs) opens from
--    /admin/agent, MFA step-up and audited, instead of a deploy. AGENTS_BETA
--    stays the master switch; the kill switches still decide whether the
--    agent may act. Readable by anyone (it says only which steps are open).
-- 2. agent_usage + agent_spend_limits: the model usage log made durable
--    (task, owner, feature, model, tokens, cost; never text), and the
--    per-member and global daily caps from the plan's risk 8, checked by
--    agent_spend_allowed before a model turn. Service role only.
-- 3. agent_metrics_daily + agent_compute_metrics(day): the plan's measures
--    as first-party daily aggregates from DRVN's own records. No member ids;
--    any value from fewer than five cases is stored as null (suppressed).
--    Definitions: docs/site/agent-measures.md.
-- 4. admin_open_agent_chat: an admin may read one member's agent chat only
--    for an abuse report or a dispute, naming the case and a reason;
--    audited (agent-data-rules.md). Returns the messages.
--
-- Idempotent.

begin;

-- ---------------------------------------------------------------------------
-- 1. Beta steps
-- ---------------------------------------------------------------------------
create table if not exists public.agent_beta_steps (
  step text primary key check (step in ('seller', 'buyer', 'chat', 'jobs')),
  open boolean not null default false,
  changed_by uuid references public.profiles(id) on delete set null,
  changed_at timestamptz not null default now(),
  reason text check (reason is null or length(reason) <= 1000)
);

comment on table public.agent_beta_steps is
  'Which A3 agent steps are open (20261024100000). Opened from /admin/agent, audited. AGENTS_BETA is the master switch; agent_controls still decide whether the agent acts.';

insert into public.agent_beta_steps(step) values ('seller'), ('buyer'), ('chat'), ('jobs')
on conflict (step) do nothing;

alter table public.agent_beta_steps enable row level security;
drop policy if exists "anyone reads the open steps" on public.agent_beta_steps;
create policy "anyone reads the open steps" on public.agent_beta_steps for select using (true);
revoke all on public.agent_beta_steps from anon, authenticated;
grant select on public.agent_beta_steps to anon, authenticated;

create or replace function public.admin_set_agent_beta_step(p_step text, p_open boolean, p_reason text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_actor uuid := auth.uid();
begin
  if not public.is_admin() or public.admin_role() <> 'admin' or not exists(
    select 1 from jsonb_array_elements(coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb->'amr', '[]'::jsonb)) m
    where m->>'method' in ('totp', 'mfa/totp')
      and (m->>'timestamp')::numeric between extract(epoch from now()) - 900 and extract(epoch from now()) + 60
  ) then raise exception 'Admin step-up required' using errcode = '42501'; end if;
  if p_reason is null or length(btrim(p_reason)) not between 1 and 1000 then
    raise exception 'A reason of 1–1000 characters is required' using errcode = '22023';
  end if;
  if p_step is null or p_step not in ('seller', 'buyer', 'chat', 'jobs') or p_open is null then
    raise exception 'Invalid step' using errcode = '22023';
  end if;
  update public.agent_beta_steps set open = p_open, changed_by = v_actor, changed_at = now(), reason = btrim(p_reason)
  where step = p_step;
  insert into public.admin_audit_log(actor_id, action, subject_type, subject_id, reason, metadata)
  values (v_actor, case when p_open then 'agent.beta_open' else 'agent.beta_close' end, 'agent', gen_random_uuid(), btrim(p_reason),
    jsonb_build_object('step', p_step));
end;
$function$;

revoke all on function public.admin_set_agent_beta_step(text, boolean, text) from public, anon;
grant execute on function public.admin_set_agent_beta_step(text, boolean, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Model usage and spend caps
-- ---------------------------------------------------------------------------
create table if not exists public.agent_usage (
  id bigint generated always as identity primary key,
  owner_id uuid references public.profiles(id) on delete set null,
  task_id uuid references public.agent_tasks(id) on delete set null,
  feature text not null check (feature in ('agent_chat', 'agent_eval', 'listing_import')),
  model text not null check (length(model) between 1 and 100),
  input_tokens integer not null check (input_tokens >= 0),
  output_tokens integer not null check (output_tokens >= 0),
  cost_usd numeric(12, 6) check (cost_usd is null or cost_usd >= 0),
  created_at timestamptz not null default now()
);

comment on table public.agent_usage is
  'Model usage per turn (20261024100000): model, tokens, cost, task and owner — never the conversation. Service role only; kept 12 months.';

create index if not exists agent_usage_owner_day_idx on public.agent_usage(owner_id, created_at);
create index if not exists agent_usage_created_idx on public.agent_usage(created_at);
alter table public.agent_usage enable row level security;
revoke all on public.agent_usage from anon, authenticated;

create table if not exists public.agent_spend_limits (
  singleton boolean primary key default true check (singleton),
  per_member_daily_usd numeric(10, 2) not null default 2.00 check (per_member_daily_usd >= 0),
  global_daily_usd numeric(10, 2) not null default 50.00 check (global_daily_usd >= 0),
  changed_by uuid references public.profiles(id) on delete set null,
  changed_at timestamptz not null default now()
);
insert into public.agent_spend_limits(singleton) values (true) on conflict (singleton) do nothing;
alter table public.agent_spend_limits enable row level security;
revoke all on public.agent_spend_limits from anon, authenticated;

-- Whether one more model turn is within today's caps (UTC day).
create or replace function public.agent_spend_allowed(p_owner uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $function$
  with lim as (select per_member_daily_usd, global_daily_usd from public.agent_spend_limits where singleton),
  today as (
    select coalesce(sum(cost_usd) filter (where owner_id = p_owner), 0) as member_usd, coalesce(sum(cost_usd), 0) as global_usd
    from public.agent_usage where created_at >= date_trunc('day', now() at time zone 'utc') at time zone 'utc'
  )
  select jsonb_build_object(
    'allowed', today.member_usd < lim.per_member_daily_usd and today.global_usd < lim.global_daily_usd,
    'member_usd', today.member_usd, 'global_usd', today.global_usd,
    'member_cap', lim.per_member_daily_usd, 'global_cap', lim.global_daily_usd)
  from lim, today;
$function$;

revoke all on function public.agent_spend_allowed(uuid) from public, anon, authenticated;
grant execute on function public.agent_spend_allowed(uuid) to service_role;

create or replace function public.admin_set_agent_spend_limits(p_member_usd numeric, p_global_usd numeric, p_reason text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_actor uuid := auth.uid();
begin
  if not public.is_admin() or public.admin_role() <> 'admin' or not exists(
    select 1 from jsonb_array_elements(coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb->'amr', '[]'::jsonb)) m
    where m->>'method' in ('totp', 'mfa/totp')
      and (m->>'timestamp')::numeric between extract(epoch from now()) - 900 and extract(epoch from now()) + 60
  ) then raise exception 'Admin step-up required' using errcode = '42501'; end if;
  if p_reason is null or length(btrim(p_reason)) not between 1 and 1000 then
    raise exception 'A reason of 1–1000 characters is required' using errcode = '22023';
  end if;
  if p_member_usd is null or p_global_usd is null or p_member_usd < 0 or p_global_usd < 0 or p_member_usd > p_global_usd then
    raise exception 'Caps must be zero or more, and the member cap no more than the global one' using errcode = '22023';
  end if;
  update public.agent_spend_limits set per_member_daily_usd = p_member_usd, global_daily_usd = p_global_usd,
    changed_by = v_actor, changed_at = now() where singleton;
  insert into public.admin_audit_log(actor_id, action, subject_type, subject_id, reason, metadata)
  values (v_actor, 'agent.spend_limits', 'agent', gen_random_uuid(), btrim(p_reason),
    jsonb_build_object('per_member_daily_usd', p_member_usd, 'global_daily_usd', p_global_usd));
end;
$function$;

revoke all on function public.admin_set_agent_spend_limits(numeric, numeric, text) from public, anon;
grant execute on function public.admin_set_agent_spend_limits(numeric, numeric, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Daily measures (first-party aggregates, no member ids)
-- ---------------------------------------------------------------------------
create table if not exists public.agent_metrics_daily (
  day date not null,
  scope text not null check (scope in ('seller', 'buyer', 'all')),
  measure text not null check (length(measure) between 1 and 60),
  value numeric,
  sample integer not null check (sample >= 0),
  computed_at timestamptz not null default now(),
  primary key (day, scope, measure)
);

comment on table public.agent_metrics_daily is
  'The agent''s measures per day (20261024100000; definitions in docs/site/agent-measures.md). Aggregates only, no member ids; value is null when sample < 5.';

alter table public.agent_metrics_daily enable row level security;
revoke all on public.agent_metrics_daily from anon, authenticated;

create or replace function public.agent_compute_metrics(p_day date)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_from timestamptz := p_day::timestamp at time zone 'utc';
  v_to timestamptz := (p_day + 1)::timestamp at time zone 'utc';
  v_rows integer := 0;
begin
  if p_day is null then raise exception 'A day is required' using errcode = '22023'; end if;

  create temporary table if not exists pg_temp.agent_measure(scope text, measure text, value numeric, sample integer) on commit drop;
  truncate pg_temp.agent_measure;

  -- Offers made that day on listings the seller's agent was handling.
  with agent_offers as (
    select o.id, o.status, o.listing_id,
      exists (select 1 from public.offer_rounds r where r.offer_id = o.id and r.actor_role = 'seller'
              and r.actor_task_id is null and r.kind in ('counter', 'decline')) as seller_stepped_in
    from public.offers o
    where o.created_at >= v_from and o.created_at < v_to
      and exists (select 1 from public.agent_mandates m where m.listing_id = o.listing_id and m.scope = 'seller'
                  and m.created_at <= o.created_at and (m.ended_at is null or m.ended_at > o.created_at))
  )
  insert into pg_temp.agent_measure
  select 'seller', 'offers_handled', count(*), count(*) from agent_offers
  union all
  select 'seller', 'share_without_seller_action', avg(case when seller_stepped_in then 0 else 1 end), count(*) from agent_offers;

  -- Agent-reached seller deals that day, how they ended, and where they landed.
  with deals as (
    select ord.id, ord.status, ord.subtotal_cents, l.price_cents, m.minimum_cents
    from public.orders ord
    join public.offers o on o.id = ord.origin_offer_id
    join public.listings l on l.id = o.listing_id
    left join lateral (select m.minimum_cents from public.agent_mandates m where m.listing_id = o.listing_id and m.scope = 'seller'
                       order by m.created_at desc limit 1) m on true
    where ord.created_at >= v_from and ord.created_at < v_to
      and exists (select 1 from public.offer_rounds r where r.offer_id = o.id and r.actor_role = 'seller' and r.actor_task_id is not null)
  )
  insert into pg_temp.agent_measure
  select 'seller', 'agent_deals', count(*), count(*) from deals
  union all
  select 'seller', 'agent_deal_cancel_rate', avg(case when status = 'cancelled' then 1 else 0 end), count(*) from deals
  union all
  select 'seller', 'agent_deal_paid_rate', avg(case when status in ('paid', 'shipped', 'delivered', 'completed') then 1 else 0 end), count(*) from deals
  union all
  -- 0 = at the minimum, 1 = at asking.
  select 'seller', 'price_position', avg(case when price_cents > minimum_cents then (subtotal_cents - minimum_cents)::numeric / (price_cents - minimum_cents) end),
    count(*) filter (where price_cents > minimum_cents) from deals;

  -- Approvals answered, and how fast.
  with asked as (
    select a.status, a.created_at, a.decided_at, t.scope from public.agent_approvals a join public.agent_tasks t on t.id = a.task_id
    where a.created_at >= v_from and a.created_at < v_to
  )
  insert into pg_temp.agent_measure
  select scope, 'approvals', count(*), count(*) from asked group by scope
  union all
  select scope, 'approvals_answered', avg(case when status in ('approved', 'dismissed') then 1 else 0 end), count(*) from asked group by scope
  union all
  select scope, 'minutes_to_answer', percentile_cont(0.5) within group (order by extract(epoch from decided_at - created_at) / 60),
    count(*) filter (where decided_at is not null) from asked where decided_at is not null group by scope;

  -- Buyers who handed a negotiation to the agent, and its deals.
  insert into pg_temp.agent_measure
  select 'buyer', 'negotiations_started', count(*), count(*) from public.agent_mandates
  where scope = 'buyer' and created_at >= v_from and created_at < v_to;
  insert into pg_temp.agent_measure
  select 'buyer', 'agent_accepts', count(*), count(*) from public.offer_rounds
  where kind = 'accept' and actor_role = 'buyer' and actor_task_id is not null and created_at >= v_from and created_at < v_to;

  -- Signs of an incorrect action: each a count, not a judgement.
  insert into pg_temp.agent_measure
  select 'all', 'permission_denials', count(*), count(*) from public.agent_telemetry
  where kind = 'permission_denied' and created_at >= v_from and created_at < v_to;
  insert into pg_temp.agent_measure
  select 'all', 'approvals_dismissed', count(*), count(*) from public.agent_approvals
  where status = 'dismissed' and decided_at >= v_from and decided_at < v_to;
  insert into pg_temp.agent_measure
  select 'seller', 'turned_off_after_a_move', count(*), count(*) from public.agent_mandates m
  where m.status = 'revoked' and m.ended_at >= v_from and m.ended_at < v_to
    and exists (select 1 from public.agent_events e where e.mandate_id = m.id and e.kind = 'move'
                and e.created_at > m.ended_at - interval '1 day' and e.created_at <= m.ended_at);

  -- What the model cost, and per finished task.
  insert into pg_temp.agent_measure
  select 'all', 'model_cost_usd', coalesce(sum(cost_usd), 0), count(*) from public.agent_usage where created_at >= v_from and created_at < v_to;
  insert into pg_temp.agent_measure
  select 'all', 'cost_per_completed_task_usd',
    (select coalesce(sum(cost_usd), 0) from public.agent_usage where created_at >= v_from and created_at < v_to)
      / nullif(count(*), 0), count(*)
  from public.agent_tasks where status = 'completed' and finished_at >= v_from and finished_at < v_to;

  -- Repeat use: members whose agent did something that day and had done something before.
  with active as (
    select distinct t.owner_id from public.agent_tasks t where t.updated_at >= v_from and t.updated_at < v_to
  )
  insert into pg_temp.agent_measure
  select 'all', 'active_members', count(*), count(*) from active
  union all
  select 'all', 'repeat_share', avg(case when exists (select 1 from public.agent_tasks p where p.owner_id = a.owner_id and p.created_at < v_from) then 1 else 0 end), count(*)
  from active a;

  insert into public.agent_metrics_daily(day, scope, measure, value, sample, computed_at)
  select p_day, scope, measure, case when sample < 5 then null else round(value, 4) end, coalesce(sample, 0), now()
  from pg_temp.agent_measure where scope is not null
  on conflict (day, scope, measure) do update set value = excluded.value, sample = excluded.sample, computed_at = excluded.computed_at;
  get diagnostics v_rows = row_count;
  return v_rows;
end;
$function$;

revoke all on function public.agent_compute_metrics(date) from public, anon, authenticated;
grant execute on function public.agent_compute_metrics(date) to service_role;

-- ---------------------------------------------------------------------------
-- 4. Opening a member's agent chat: abuse or dispute only, audited.
--    The case is a report (public.reports) or an order under dispute.
-- ---------------------------------------------------------------------------
create or replace function public.admin_open_agent_chat(p_member uuid, p_case_kind text, p_case uuid, p_reason text)
returns table(id uuid, role text, body text, created_at timestamptz)
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_actor uuid := auth.uid();
begin
  if not public.is_admin() or not exists(
    select 1 from jsonb_array_elements(coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb->'amr', '[]'::jsonb)) m
    where m->>'method' in ('totp', 'mfa/totp')
      and (m->>'timestamp')::numeric between extract(epoch from now()) - 900 and extract(epoch from now()) + 60
  ) then raise exception 'Admin step-up required' using errcode = '42501'; end if;
  if p_reason is null or length(btrim(p_reason)) not between 1 and 1000 then
    raise exception 'A reason of 1–1000 characters is required' using errcode = '22023';
  end if;
  if p_case_kind is null or p_case_kind not in ('dispute', 'report') or p_case is null or p_member is null then
    raise exception 'Name the dispute or report this is for' using errcode = '22023';
  end if;
  -- A dispute is an order that has one (orders.dispute_reason, 0007/0046);
  -- the member must be a party to it.
  if (p_case_kind = 'dispute' and not exists (select 1 from public.orders o where o.id = p_case
        and (o.dispute_reason is not null or o.status = 'disputed') and p_member in (o.buyer_id, o.seller_id)))
     -- A report about this member: them, a listing of theirs, or one they filed.
     or (p_case_kind = 'report' and not exists (select 1 from public.reports r where r.id = p_case
        and (r.reporter_id = p_member
             or (r.subject_type = 'user' and r.subject_id = p_member)
             or (r.subject_type = 'listing' and exists (select 1 from public.listings l where l.id = r.subject_id and l.seller_id = p_member))))) then
    raise exception 'No such case' using errcode = 'P0002';
  end if;
  insert into public.admin_audit_log(actor_id, action, subject_type, subject_id, reason, metadata)
  values (v_actor, 'agent.chat_opened', 'user', p_member, btrim(p_reason),
    jsonb_build_object('case_kind', p_case_kind, 'case_id', p_case));
  return query
    select m.id, m.role, m.body, m.created_at
    from public.agent_messages m join public.agent_conversations c on c.id = m.conversation_id
    where c.owner_id = p_member order by m.created_at;
end;
$function$;

revoke all on function public.admin_open_agent_chat(uuid, text, uuid, text) from public, anon;
grant execute on function public.admin_open_agent_chat(uuid, text, uuid, text) to authenticated;

-- Retention: usage kept 12 months like the agent's other records.
create or replace function public.agent_usage_retention_sweep()
returns integer
language sql
security definer
set search_path = public, pg_temp
as $function$
  with gone as (delete from public.agent_usage where created_at < now() - interval '12 months' returning 1)
  select count(*)::integer from gone;
$function$;

revoke all on function public.agent_usage_retention_sweep() from public, anon, authenticated;
grant execute on function public.agent_usage_retention_sweep() to service_role;

commit;
