-- N128 (production-readiness 2026-11-03): an approval is recorded as
-- accepted only when the offer move reports an accept.
--
-- Before this, agent_approval_decide('accept') marked the approval
-- 'approved' whatever offer_move_core did. When the offer's turn had run
-- out, offer_move_core recorded the expiry and returned outcome 'expired',
-- the outbox trigger superseded the approval, and the decide function then
-- overwrote it as 'approved' and logged an accept: the agent's measures
-- counted a sale that never happened.
--
-- Now each answer has its own outcome, stored on the approval and in the
-- 'approval' event, and returned to the app:
--   accepted   the move was an accept (status 'approved').
--   expired    the offer's turn had run out; offer_move_core recorded the
--              expiry, nothing was sold (status 'expired').
--   refused    the offer could not be accepted as asked: settled, moved on,
--              not the owner's turn, or the part is gone. The move is rolled
--              back and nothing changes on the offer (status 'refused').
--   noop       the approval was no longer pending when the owner answered
--              (superseded, or a repeat). Nothing is written.
--   dismissed  the owner dismissed it (unchanged).
--
-- Locks: listing → offer → task → approval, the outbox trigger's order, taken
-- before the approval is re-read so a concurrent answer or offer move can't
-- slip between the read and the write.
--
-- agent_approval_decide: restated from 20261021100100_agent_worker.sql, its
-- only definition. agent_compute_metrics: restated from
-- 20261024100000_agent_admin_measure.sql, its only definition; the one change
-- is that 'Approvals answered' counts an expired or refused answer too (the
-- owner answered; it was not left waiting).

alter table public.agent_approvals drop constraint if exists agent_approvals_status_check;
alter table public.agent_approvals add constraint agent_approvals_status_check
  check (status in ('pending', 'approved', 'dismissed', 'superseded', 'expired', 'refused'));

comment on column public.agent_approvals.status is
  'pending, then: approved (the owner''s accept went through), dismissed, expired (the offer ran out first), refused (the offer could not be accepted as asked), superseded (the offer moved on before the owner answered). 20261107210500.';

create or replace function public.agent_approval_decide(p_approval uuid, p_choice text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_actor uuid := auth.uid();
  v_approval public.agent_approvals;
  v_result jsonb;
  v_outcome text;
  v_status text;
  v_offer_status text;
begin
  if v_actor is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  if p_approval is null or p_choice is null or p_choice not in ('accept', 'dismiss') then
    raise exception 'Invalid choice' using errcode = '22023';
  end if;
  select * into v_approval from public.agent_approvals where id = p_approval and owner_id = v_actor;
  if not found then raise exception 'Not found' using errcode = 'P0002'; end if;

  -- Lock order: listing → offer → task → approval, as the outbox trigger takes them.
  perform 1 from public.listings l join public.offers o on o.listing_id = l.id where o.id = v_approval.offer_id for update of l;
  perform 1 from public.offers where id = v_approval.offer_id for update;
  perform 1 from public.agent_tasks where id = v_approval.task_id for update;
  select * into v_approval from public.agent_approvals where id = p_approval for update;

  if v_approval.status <> 'pending' then
    -- Already answered, or overtaken by the offer: say what it was, change nothing.
    return jsonb_build_object('approval_id', p_approval, 'status', v_approval.status, 'replayed', true,
      'outcome', case v_approval.status when 'approved' then 'accepted' when 'dismissed' then 'dismissed'
        when 'expired' then 'expired' when 'refused' then 'refused' else 'noop' end);
  end if;

  if p_choice = 'accept' then
    begin
      -- The owner accepts, as themself: the move is theirs, not the agent's.
      v_result := public.offer_move_core(v_actor, v_approval.offer_id, 'accept', null,
        'approval:' || p_approval, v_approval.round_no, null);
      v_outcome := case when v_result->>'kind' = 'accept' then 'accepted'
                        when v_result->>'outcome' = 'expired' then 'expired'
                        else 'refused' end;
    exception when sqlstate 'OF002' or sqlstate 'OF003' or sqlstate 'OF005' or sqlstate 'OF007' then
      -- The move is rolled back; the offer is as it was.
      select status into v_offer_status from public.offers where id = v_approval.offer_id;
      v_outcome := case when v_offer_status = 'expired' then 'expired' else 'refused' end;
      v_result := null;
    end;
    v_status := case v_outcome when 'accepted' then 'approved' else v_outcome end;
    -- Unconditional: the move's own round may already have superseded it.
    update public.agent_approvals set status = v_status, decided_at = now() where id = p_approval;
  else
    v_outcome := 'dismissed';
    v_status := 'dismissed';
    update public.agent_approvals set status = 'dismissed', decided_at = now() where id = p_approval;
  end if;

  if v_outcome in ('dismissed', 'refused') then
    -- No round was written, so the trigger didn't move the task: it waits again.
    update public.agent_tasks set status = 'waiting_for_event'
    where id = v_approval.task_id and status = 'needs_approval'
      and not exists (select 1 from public.agent_approvals a where a.task_id = v_approval.task_id and a.status = 'pending');
  end if;

  insert into public.agent_events(owner_id, task_id, kind, initiated_by, result)
  values (v_actor, v_approval.task_id, 'approval', 'owner',
    jsonb_build_object('approval_id', p_approval, 'choice', p_choice, 'outcome', v_outcome));
  return coalesce(v_result, '{}'::jsonb) || jsonb_build_object('approval_id', p_approval, 'status', v_status,
    'outcome', v_outcome, 'replayed', false);
end;
$function$;

revoke all on function public.agent_approval_decide(uuid, text) from public, anon, service_role;
grant execute on function public.agent_approval_decide(uuid, text) to authenticated;

-- Approvals answered: an expired or refused answer is still the owner's answer.
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
  select scope, 'approvals_answered', avg(case when status in ('approved', 'dismissed', 'expired', 'refused') then 1 else 0 end), count(*) from asked group by scope
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
