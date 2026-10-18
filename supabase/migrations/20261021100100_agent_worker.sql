-- 20261021100100 — the agent worker and every function that writes agent data
-- (A2; docs/decisions/agent-foundations.md §1, §4–§7).
--
-- The worker's identity. agent_worker is its own Postgres role, created
-- NOLOGIN here: no password lives in a migration or on the hosted project.
-- Giving it a login credential is an operator step (docs/site/operations.md,
-- "Agent worker"). It has no table grants; it may execute only the worker
-- functions below. Each worker write presents a job the worker claimed and the
-- lease it holds, and the function checks that the job is leased to it, the
-- lease is live, and the job's action, offer and round are this exact call.
-- Only then does it load the owner from the task and the mandate (never from
-- an argument) and re-check the owner's role on the offer, suspension, the
-- mandate's state, expiry and limits, and the kill switches.
--
-- Negotiation goes through the one move path. offer_open and offer_move
-- (20261017160000) become thin wrappers over offer_open_core and
-- offer_move_core, which take the acting member as an argument and are
-- callable by no client role. The member's wrappers pass auth.uid(); the
-- agent's (agent_offer_open, agent_offer_move) pass the mandate's owner and
-- the agent's task, job and mandate version, which the round records. The
-- bodies are 20261017160000's, changed only where marked "A2".
--
-- The floor: offer_effective_floor is now the higher of the listing's own
-- minimum and an active seller mandate's minimum (agent-foundations.md §6).
--
-- The outbox: a trigger on offer_rounds writes agent jobs in the same
-- transaction as the move, for whichever side's agent has the next turn, and
-- settles tasks when an offer ends. agent_reconcile_outbox sweeps anything
-- missed. Lock order: listing → offer → agent job → mandate → task → approval
-- (→ order → payment, as before); every function here takes them in that
-- order.
--
-- Errors the worker maps: AG001 job not leased to you, AG002 job is for another
-- action, AG003 the owner turned this off (mandate not active, task finished),
-- AG004 a kill switch is on, AG005 not the owner's side, AG006 amount outside
-- the owner's limits, AG007 owner suspended, AG008 action not allowed for this
-- side. Offer errors (OF00x) pass through from offer_move_core.
-- Idempotent.

begin;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'agent_worker') then
    create role agent_worker nologin noinherit;
  end if;
end $$;

comment on role agent_worker is
  'The agent worker (20261021100100). NOLOGIN in migrations; may execute only the agent worker functions. Never grant it table privileges.';

grant usage on schema public to agent_worker;

-- ---------------------------------------------------------------------------
-- The effective floor: the stricter of the listing's minimum and the agent's.
-- ---------------------------------------------------------------------------
create or replace function public.offer_effective_floor(p_listing uuid)
returns integer
language sql
stable
security definer
set search_path = public, pg_temp
as $function$
  select greatest(
    (select t.offer_floor_cents from public.listing_private_terms t where t.listing_id = p_listing),
    (select max(m.minimum_cents) from public.agent_mandates m
      where m.listing_id = p_listing and m.scope = 'seller' and m.status = 'active'
        and (m.expires_at is null or m.expires_at > now())
        and m.owner_id = (select l.seller_id from public.listings l where l.id = p_listing))
  );
$function$;

revoke all on function public.offer_effective_floor(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- The move cores (from 20261017160000; the actor is an argument).
-- p_agent, when the agent moves: {task_id, job_id, mandate_version, ceiling_cents}.
-- ---------------------------------------------------------------------------
create or replace function public.offer_open_core(p_actor uuid, p_offer uuid, p_listing uuid, p_amount integer,
  p_message text default null, p_agent jsonb default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_actor uuid := p_actor; -- A2: the caller passes the actor
  v_listing public.listings;
  v_existing public.offers;
  v_first public.offer_rounds;
  v_opening public.messages;
  v_floor integer;
  v_used integer;
  v_round uuid;
  -- A2: the agent's authority, recorded on the round
  v_task uuid := (p_agent->>'task_id')::uuid;
  v_job uuid := (p_agent->>'job_id')::uuid;
  v_version integer := (p_agent->>'mandate_version')::integer;
  v_ceiling integer := (p_agent->>'ceiling_cents')::integer;
begin
  if v_actor is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  if p_offer is null or p_listing is null or p_amount is null or p_amount <= 0 or p_amount > 100000000 then
    raise exception 'Invalid offer request' using errcode = '22023';
  end if;
  if p_message is not null and (p_message = '' or p_message <> btrim(p_message) or length(p_message) > 2000) then
    raise exception 'Invalid offer message' using errcode = '22023';
  end if;

  -- An exact retry of a committed opening offer replays it.
  select * into v_existing from public.offers where id = p_offer;
  if found then
    select * into v_first from public.offer_rounds where offer_id = p_offer and round_no = 1;
    if v_existing.buyer_id <> v_actor or v_existing.listing_id <> p_listing
       or v_first.amount_cents is distinct from p_amount then
      raise exception 'Offer retry identity changed' using errcode = '23505';
    end if;
    if v_first.kind = 'offer' then
      select * into v_opening from public.messages where id = p_offer;
      if (p_message is null) is distinct from (not found)
         or (found and (v_opening.sender_id <> v_actor or v_opening.body <> p_message)) then
        raise exception 'Offer retry message changed' using errcode = '23505';
      end if;
    end if;
    return jsonb_build_object('offer_id', p_offer, 'replayed', true,
      'outcome', case when v_first.kind = 'below_minimum' then 'below_minimum' else 'sent' end);
  end if;

  perform set_config('drvn.offer_move', 'on', true);
  select * into v_listing from public.listings where id = p_listing for update;
  if not found or v_listing.status <> 'active' then raise exception 'Listing is not available' using errcode = 'OF007'; end if;
  if v_listing.seller_id = v_actor then raise exception 'You can''t offer on your own listing' using errcode = '42501'; end if;
  if public.is_suspended(v_actor) then raise exception 'account is suspended' using errcode = '42501'; end if;
  if v_listing.shipping_mode = 'drvn' then raise exception 'Offers are unavailable with rated shipping' using errcode = 'OF007'; end if;
  if p_amount > v_listing.price_cents then raise exception 'An offer can''t be above the asking price' using errcode = 'OF004'; end if;
  if exists (select 1 from public.offers o where o.listing_id = p_listing and o.buyer_id = v_actor and o.status in ('open', 'countered')) then
    raise exception 'You already have a live offer on this part' using errcode = '23505';
  end if;
  select count(*) into v_used from public.offer_rounds r
  where r.listing_id = p_listing and r.buyer_id = v_actor and r.actor_role = 'buyer' and r.kind in ('offer', 'counter', 'below_minimum');
  if v_used >= 3 then raise exception 'No offers left on this part' using errcode = 'OF001'; end if;
  if not public.consume_rate_limit('offer-move:' || v_actor, 30, interval '10 minutes') then
    raise exception 'Too many offer moves; try again shortly' using errcode = 'OF009';
  end if;

  v_floor := public.offer_effective_floor(p_listing);
  if v_floor is not null and p_amount < v_floor then
    -- Declined at once, and it uses one of the buyer's 3. Nothing says why.
    insert into public.offers(id, listing_id, buyer_id, amount_cents, status, responded_at)
    values (p_offer, p_listing, v_actor, p_amount, 'declined', now());
    insert into public.offer_rounds(offer_id, round_no, listing_id, buyer_id, actor_role, kind, amount_cents, actor_member_id, idempotency_key,
      actor_task_id, actor_job_id, mandate_version)
    values (p_offer, 1, p_listing, v_actor, 'buyer', 'below_minimum', p_amount, v_actor, 'open:' || p_offer,
      v_task, v_job, v_version)
    returning id into v_round;
    insert into public.offer_round_terms(round_id, effective_floor_cents, buyer_ceiling_cents) values (v_round, v_floor, v_ceiling);
    update public.offers set round_count = 1, last_round_id = v_round where id = p_offer;
    perform set_config('drvn.offer_move', '', true);
    return jsonb_build_object('offer_id', p_offer, 'replayed', false, 'outcome', 'below_minimum');
  end if;

  insert into public.offers(id, listing_id, buyer_id, amount_cents, status, expires_at)
  values (p_offer, p_listing, v_actor, p_amount, 'open', now() + interval '72 hours');
  if p_message is not null then
    insert into public.messages(id, listing_id, offer_id, order_id, sender_id, recipient_id, body)
    values (p_offer, p_listing, p_offer, null, v_actor, v_listing.seller_id, p_message);
  end if;
  insert into public.offer_rounds(offer_id, round_no, listing_id, buyer_id, actor_role, kind, amount_cents, expires_at, actor_member_id, idempotency_key,
    actor_task_id, actor_job_id, mandate_version)
  values (p_offer, 1, p_listing, v_actor, 'buyer', 'offer', p_amount, now() + interval '72 hours', v_actor, 'open:' || p_offer,
    v_task, v_job, v_version)
  returning id into v_round;
  insert into public.offer_round_terms(round_id, effective_floor_cents, buyer_ceiling_cents) values (v_round, v_floor, v_ceiling);
  update public.offers set round_count = 1, last_round_id = v_round where id = p_offer;
  perform set_config('drvn.offer_move', '', true);
  return jsonb_build_object('offer_id', p_offer, 'replayed', false, 'outcome', 'sent');
end;
$function$;

revoke all on function public.offer_open_core(uuid, uuid, uuid, integer, text, jsonb) from public, anon, authenticated, service_role;

create or replace function public.offer_move_core(p_actor uuid, p_offer uuid, p_kind text, p_amount integer,
  p_idempotency_key text, p_expected_round integer, p_agent jsonb default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_actor uuid := p_actor; -- A2: the caller passes the actor
  v_prior public.offer_rounds;
  v_listing_id uuid;
  v_listing public.listings;
  v_offer public.offers;
  v_role text;
  v_turn text;
  v_floor integer;
  v_used integer;
  v_no integer;
  v_round uuid;
  v_kind text := p_kind;
  v_amount integer;
  v_expires timestamptz;
  v_order uuid;
  -- A2: the agent's authority, recorded on the round
  v_task uuid := (p_agent->>'task_id')::uuid;
  v_job uuid := (p_agent->>'job_id')::uuid;
  v_version integer := (p_agent->>'mandate_version')::integer;
  v_ceiling integer := (p_agent->>'ceiling_cents')::integer;
begin
  if v_actor is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  if p_offer is null or p_kind is null or p_kind not in ('counter', 'accept', 'decline', 'withdraw')
     or p_idempotency_key is null or length(p_idempotency_key) not between 8 and 200
     or (p_kind = 'counter' and (p_amount is null or p_amount <= 0 or p_amount > 100000000)) then
    raise exception 'Invalid offer move' using errcode = '22023';
  end if;

  -- An exact retry replays the move it already made.
  select * into v_prior from public.offer_rounds where actor_member_id = v_actor and idempotency_key = p_idempotency_key;
  if found then
    if v_prior.offer_id <> p_offer then raise exception 'Move retry identity changed' using errcode = '23505'; end if;
    return jsonb_build_object('offer_id', p_offer, 'round_no', v_prior.round_no, 'kind', v_prior.kind, 'replayed', true,
      'order_id', (select o.id from public.orders o where o.origin_offer_id = p_offer and v_prior.kind = 'accept'));
  end if;

  select o.listing_id into v_listing_id from public.offers o where o.id = p_offer;
  if not found then raise exception 'Offer not found' using errcode = 'P0002'; end if;
  perform set_config('drvn.offer_move', 'on', true);
  select * into v_listing from public.listings where id = v_listing_id for update;
  select * into v_offer from public.offers where id = p_offer for update;
  v_role := case when v_offer.buyer_id = v_actor then 'buyer' when v_listing.seller_id = v_actor then 'seller' end;
  if v_role is null then raise exception 'Offer not found' using errcode = 'P0002'; end if;
  if public.is_suspended(v_actor) then raise exception 'account is suspended' using errcode = '42501'; end if;
  if v_offer.status not in ('open', 'countered') then raise exception 'This offer is already settled' using errcode = 'OF005'; end if;
  if v_offer.round_count is distinct from p_expected_round then
    raise exception 'This offer changed; reload it' using errcode = 'OF003';
  end if;

  v_no := v_offer.round_count + 1;
  -- The turn ran out: record the expiry and say so (it commits).
  if v_offer.expires_at is not null and v_offer.expires_at < now() then
    update public.offers set status = 'expired', responded_at = now() where id = p_offer;
    insert into public.offer_rounds(offer_id, round_no, listing_id, buyer_id, actor_role, kind)
    values (p_offer, v_no, v_listing.id, v_offer.buyer_id, 'system', 'expire') returning id into v_round;
    update public.offers set round_count = v_no, last_round_id = v_round where id = p_offer;
    perform set_config('drvn.offer_move', '', true);
    return jsonb_build_object('offer_id', p_offer, 'round_no', v_no, 'kind', 'expire', 'outcome', 'expired', 'replayed', false);
  end if;

  v_turn := case v_offer.status when 'open' then 'seller' else 'buyer' end;

  if p_kind = 'withdraw' then
    if v_role <> 'buyer' then raise exception 'Only the buyer can withdraw' using errcode = '42501'; end if;
    update public.offers set status = 'withdrawn', responded_at = now() where id = p_offer;
  elsif p_kind = 'decline' then
    if v_role <> 'seller' then raise exception 'Only the seller can decline' using errcode = '42501'; end if;
    update public.offers set status = 'declined', responded_at = now() where id = p_offer;
  elsif p_kind = 'accept' then
    if v_role <> v_turn then raise exception 'It''s not your turn' using errcode = 'OF002'; end if;
    v_amount := case v_role when 'seller' then v_offer.amount_cents else v_offer.counter_amount_cents end;
    -- Under the listing and offer locks taken above; it locks nothing new
    -- before the order it creates.
    v_order := public.offer_accept_begin(p_offer, v_listing.seller_id);
    if v_order is null then raise exception 'This part is no longer available' using errcode = 'OF007'; end if;
  else
    if v_role <> v_turn then raise exception 'It''s not your turn' using errcode = 'OF002'; end if;
    if not public.consume_rate_limit('offer-move:' || v_actor, 30, interval '10 minutes') then
      raise exception 'Too many offer moves; try again shortly' using errcode = 'OF009';
    end if;
    v_floor := public.offer_effective_floor(v_listing.id);
    v_amount := p_amount;
    v_expires := now() + interval '72 hours';
    if v_role = 'seller' then
      if p_amount <= v_offer.amount_cents or p_amount > v_listing.price_cents or (v_floor is not null and p_amount < v_floor) then
        raise exception 'A counter must be above the offer, no more than the asking price and no less than your minimum' using errcode = 'OF004';
      end if;
      update public.offers set status = 'countered', counter_amount_cents = p_amount, countered_at = now(), expires_at = v_expires
      where id = p_offer;
    else
      if p_amount <= v_offer.amount_cents or p_amount >= v_offer.counter_amount_cents then
        raise exception 'A counter-offer must be above your last offer and below the seller''s counter' using errcode = 'OF004';
      end if;
      select count(*) into v_used from public.offer_rounds r
      where r.listing_id = v_listing.id and r.buyer_id = v_actor and r.actor_role = 'buyer' and r.kind in ('offer', 'counter', 'below_minimum');
      if v_used >= 3 then raise exception 'No offers left on this part' using errcode = 'OF001'; end if;
      if v_floor is not null and p_amount < v_floor then
        v_kind := 'below_minimum';
        v_expires := null;
        update public.offers set status = 'declined', amount_cents = p_amount, counter_amount_cents = null, responded_at = now()
        where id = p_offer;
      else
        update public.offers set status = 'open', amount_cents = p_amount, counter_amount_cents = null, countered_at = null, expires_at = v_expires
        where id = p_offer;
      end if;
    end if;
  end if;

  insert into public.offer_rounds(offer_id, round_no, listing_id, buyer_id, actor_role, kind, amount_cents, expires_at, actor_member_id, idempotency_key,
    actor_task_id, actor_job_id, mandate_version)
  values (p_offer, v_no, v_listing.id, v_offer.buyer_id, v_role, v_kind, v_amount,
          case when v_kind = 'counter' then v_expires end, v_actor, p_idempotency_key,
          v_task, v_job, v_version)
  returning id into v_round;
  if v_kind in ('counter', 'below_minimum') then
    insert into public.offer_round_terms(round_id, effective_floor_cents, buyer_ceiling_cents) values (v_round, v_floor, v_ceiling);
  end if;
  update public.offers set round_count = v_no, last_round_id = v_round where id = p_offer;
  perform set_config('drvn.offer_move', '', true);
  return jsonb_build_object('offer_id', p_offer, 'round_no', v_no, 'kind', v_kind, 'replayed', false,
    'outcome', case when v_kind = 'below_minimum' then 'below_minimum' else 'done' end, 'order_id', v_order);
end;
$function$;

revoke all on function public.offer_move_core(uuid, uuid, text, integer, text, integer, jsonb) from public, anon, authenticated, service_role;

-- The member's moves: the same functions as 20261017160000, the actor from the session.
create or replace function public.offer_open(p_offer uuid, p_listing uuid, p_amount integer, p_message text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
begin
  if auth.uid() is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  return public.offer_open_core(auth.uid(), p_offer, p_listing, p_amount, p_message, null);
end;
$function$;

revoke all on function public.offer_open(uuid, uuid, integer, text) from public, anon;
grant execute on function public.offer_open(uuid, uuid, integer, text) to authenticated;

create or replace function public.offer_move(p_offer uuid, p_kind text, p_amount integer, p_idempotency_key text, p_expected_round integer)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
begin
  if auth.uid() is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  return public.offer_move_core(auth.uid(), p_offer, p_kind, p_amount, p_idempotency_key, p_expected_round, null);
end;
$function$;

revoke all on function public.offer_move(uuid, text, integer, text, integer) from public, anon;
grant execute on function public.offer_move(uuid, text, integer, text, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- Kill switches: the first one that applies, or null.
-- ---------------------------------------------------------------------------
-- The worker reads the switches under a shared lock that
-- admin_set_agent_control takes exclusively, so throwing a switch waits for
-- any agent write already past this check, and every later one sees it.
create or replace function public.agent_controls_lock_key()
returns bigint
language sql
immutable
set search_path = public, pg_temp
as $function$
  select hashtextextended('drvn.agent_controls', 0);
$function$;

revoke all on function public.agent_controls_lock_key() from public, anon, authenticated, service_role;

create or replace function public.agent_halt_reason(p_scope text, p_owner uuid, p_mandate uuid, p_listing uuid, p_counterparty uuid)
returns text
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $function$
begin
  perform pg_advisory_xact_lock_shared(public.agent_controls_lock_key());
  return (select c.scope from public.agent_controls c
  where c.cleared_at is null
    and (c.scope = 'all'
      or (c.scope = p_scope and c.subject_id is null)
      or (c.scope = 'member' and c.subject_id = p_owner)
      or (c.scope = 'mandate' and c.subject_id = p_mandate)
      or (c.scope = 'listing' and c.subject_id = p_listing)
      or (c.scope = 'account' and c.subject_id in (p_owner, p_counterparty)))
  order by case c.scope when 'all' then 1 when 'buyer' then 2 when 'seller' then 2 when 'account' then 3
    when 'member' then 4 when 'listing' then 5 else 6 end
  limit 1);
end;
$function$;

revoke all on function public.agent_halt_reason(text, uuid, uuid, uuid, uuid) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- The mandate's open task, created when there is none (a new mandate, or one
-- resumed after its task ended).
-- ---------------------------------------------------------------------------
create or replace function public.agent_open_task(p_mandate uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_mandate public.agent_mandates;
  v_task uuid;
begin
  select * into v_mandate from public.agent_mandates where id = p_mandate;
  if not found or v_mandate.status not in ('active', 'paused') then return null; end if;
  select id into v_task from public.agent_tasks where mandate_id = p_mandate and finished_at is null for update;
  if v_task is null then
    insert into public.agent_tasks(owner_id, mandate_id, scope, objective, status, listing_id)
    values (v_mandate.owner_id, v_mandate.id, v_mandate.scope,
      case v_mandate.scope when 'seller' then 'Handle offers on this listing' else 'Negotiate this part for me' end,
      case v_mandate.scope when 'seller' then 'waiting_for_event' else 'working' end, v_mandate.listing_id)
    returning id into v_task;
  end if;
  return v_task;
end;
$function$;

revoke all on function public.agent_open_task(uuid) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Enqueue: a job for every live turn this task's owner has, deduplicated.
-- Returns how many jobs it added.
-- ---------------------------------------------------------------------------
create or replace function public.agent_enqueue_turns(p_task uuid)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_task public.agent_tasks;
  v_mandate public.agent_mandates;
  v_listing public.listings;
  v_used integer;
  v_added integer := 0;
  v_n integer;
begin
  select * into v_task from public.agent_tasks where id = p_task;
  if not found or v_task.finished_at is not null then return 0; end if;
  select * into v_mandate from public.agent_mandates where id = v_task.mandate_id;
  if not found or v_mandate.status <> 'active' then return 0; end if;
  select * into v_listing from public.listings where id = v_mandate.listing_id;
  if not found or v_listing.status <> 'active' then return 0; end if;

  if v_mandate.scope = 'seller' then
    insert into public.agent_jobs(task_id, kind, expected_action, listing_id, offer_id, round_no, dedup_key)
    select v_task.id, 'offer_turn', 'offer_move', o.listing_id, o.id, o.round_count,
           'turn:' || o.id || ':r' || o.round_count || ':' || v_task.id
    from public.offers o
    where o.listing_id = v_listing.id and o.status = 'open' and o.round_count > 0
      and v_listing.seller_id = v_mandate.owner_id
    on conflict (dedup_key) do nothing;
    get diagnostics v_n = row_count;
    v_added := v_added + v_n;
  else
    insert into public.agent_jobs(task_id, kind, expected_action, listing_id, offer_id, round_no, dedup_key)
    select v_task.id, 'offer_turn', 'offer_move', o.listing_id, o.id, o.round_count,
           'turn:' || o.id || ':r' || o.round_count || ':' || v_task.id
    from public.offers o
    where o.listing_id = v_listing.id and o.buyer_id = v_mandate.owner_id and o.status = 'countered'
    on conflict (dedup_key) do nothing;
    get diagnostics v_n = row_count;
    v_added := v_added + v_n;
    if not exists (select 1 from public.offers o where o.listing_id = v_listing.id and o.buyer_id = v_mandate.owner_id
                   and o.status in ('open', 'countered')) then
      select count(*) into v_used from public.offer_rounds r
      where r.listing_id = v_listing.id and r.buyer_id = v_mandate.owner_id and r.actor_role = 'buyer'
        and r.kind in ('offer', 'counter', 'below_minimum');
      if v_used < 3 and not exists (select 1 from public.offers o where o.listing_id = v_listing.id
                                    and o.buyer_id = v_mandate.owner_id and o.status = 'accepted') then
        insert into public.agent_jobs(task_id, kind, expected_action, listing_id, dedup_key)
        values (v_task.id, 'offer_open', 'offer_open', v_listing.id, 'open:' || v_task.id || ':n' || v_used)
        on conflict (dedup_key) do nothing;
        get diagnostics v_n = row_count;
        v_added := v_added + v_n;
      end if;
    end if;
  end if;
  return v_added;
end;
$function$;

revoke all on function public.agent_enqueue_turns(uuid) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- The outbox: every round (whoever made it, by whichever path) queues the
-- next turn for that side's agent, and settles tasks when the offer ends.
-- Runs inside the move's transaction, under its listing and offer locks.
-- ---------------------------------------------------------------------------
create or replace function public.agent_on_offer_round()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_offer public.offers;
  v_seller uuid;
  v_task record;
  v_ended boolean;
begin
  select * into v_offer from public.offers where id = new.offer_id;
  select l.seller_id into v_seller from public.listings l where l.id = new.listing_id;

  -- Earlier turns on this offer are over: their jobs and approvals lapse.
  update public.agent_jobs set status = 'cancelled', lease_id = null, lease_expires_at = null,
    finished_at = now(), last_error = 'superseded'
  where offer_id = new.offer_id and status in ('pending', 'leased') and round_no < new.round_no;

  v_ended := v_offer.status not in ('open', 'countered');

  if not v_ended then
    -- Whose turn now: open = the seller's, countered = the buyer's.
    for v_task in
      select t.id, t.status from public.agent_tasks t
      join public.agent_mandates m on m.id = t.mandate_id
      where m.listing_id = new.listing_id and m.status = 'active' and t.finished_at is null
        and ((v_offer.status = 'open' and m.scope = 'seller' and m.owner_id = v_seller)
          or (v_offer.status = 'countered' and m.scope = 'buyer' and m.owner_id = v_offer.buyer_id))
      order by m.id
    loop
      insert into public.agent_jobs(task_id, kind, expected_action, listing_id, offer_id, round_no, dedup_key)
      values (v_task.id, 'offer_turn', 'offer_move', new.listing_id, new.offer_id, new.round_no,
              'turn:' || new.offer_id || ':r' || new.round_no || ':' || v_task.id)
      on conflict (dedup_key) do nothing;
      update public.agent_tasks set status = 'working' where id = v_task.id and status = 'waiting_for_event';
    end loop;
  end if;

  if v_ended then
    -- Settle the tasks this offer was about.
    for v_task in
      select t.id, t.status, m.id mandate_id, m.scope, m.status mandate_status from public.agent_tasks t
      join public.agent_mandates m on m.id = t.mandate_id
      where m.listing_id = new.listing_id and t.finished_at is null
        and ((m.scope = 'seller' and m.owner_id = v_seller)
          or (m.scope = 'buyer' and m.owner_id = v_offer.buyer_id))
      order by m.id
    loop
      -- Each update re-checks the row's state: a concurrent revoke or sweep
      -- may have finished it, and this must never fail a person's move.
      if v_offer.status = 'accepted' and v_task.scope = 'buyer' then
        update public.agent_mandates set status = 'ended', ended_at = now(), updated_at = now()
        where id = v_task.mandate_id and status in ('active', 'paused');
        update public.agent_tasks set status = 'completed', outcome = 'bought' where id = v_task.id and finished_at is null;
        insert into public.agent_events(owner_id, task_id, mandate_id, kind, initiated_by, result)
        select t.owner_id, t.id, v_task.mandate_id, 'status', 'offer_round:' || new.offer_id || ':r' || new.round_no,
               jsonb_build_object('status', t.status, 'outcome', t.outcome)
        from public.agent_tasks t where t.id = v_task.id;
      elsif v_offer.status = 'accepted' then
        -- The seller's task and minimum stay until the sale completes: if
        -- checkout is cancelled the listing comes back with its agent's
        -- minimum still in force. The sweep completes it once sold.
        update public.agent_tasks set status = 'waiting_for_event' where id = v_task.id and status = 'working';
      elsif v_task.scope = 'buyer' then
        -- A buyer's agent tries again after a decline while it has offers left.
        if v_task.mandate_status = 'active' and new.kind in ('decline', 'below_minimum')
           and public.agent_enqueue_turns(v_task.id) > 0 then
          update public.agent_tasks set status = 'working' where id = v_task.id and finished_at is null and status <> 'working';
        else
          update public.agent_tasks set status = 'failed', outcome = 'offer ' || new.kind where id = v_task.id and finished_at is null;
          insert into public.agent_events(owner_id, task_id, mandate_id, kind, initiated_by, result)
          select t.owner_id, t.id, v_task.mandate_id, 'status', 'offer_round:' || new.offer_id || ':r' || new.round_no,
                 jsonb_build_object('status', t.status, 'outcome', t.outcome)
          from public.agent_tasks t where t.id = v_task.id;
        end if;
      end if;
    end loop;
  end if;

  update public.agent_approvals set status = 'superseded', decided_at = now()
  where offer_id = new.offer_id and status = 'pending' and (round_no < new.round_no or v_ended);
  -- A seller task waiting only on approvals that just lapsed goes back to waiting.
  update public.agent_tasks t set status = 'waiting_for_event'
  where t.status = 'needs_approval' and t.listing_id = new.listing_id
    and not exists (select 1 from public.agent_approvals a where a.task_id = t.id and a.status = 'pending')
    and not exists (select 1 from public.agent_jobs j where j.task_id = t.id and j.status in ('pending', 'leased'));
  return null;
end;
$function$;

revoke all on function public.agent_on_offer_round() from public, anon, authenticated, service_role;

drop trigger if exists offer_rounds_agent_outbox on public.offer_rounds;
create trigger offer_rounds_agent_outbox
  after insert on public.offer_rounds
  for each row execute function public.agent_on_offer_round();

-- ---------------------------------------------------------------------------
-- Worker functions (agent_worker only)
-- ---------------------------------------------------------------------------

-- Lease up to p_limit ready jobs. A job whose task is finished or whose
-- mandate was turned off is cancelled; one under a kill switch or a paused
-- mandate stays queued until it lifts.
create or replace function public.agent_claim_jobs(p_limit integer default 5, p_lease_seconds integer default 60)
returns table(job_id uuid, lease_id uuid, task_id uuid, kind text, expected_action text, listing_id uuid, offer_id uuid, round_no integer)
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
#variable_conflict use_column
declare
  v_job public.agent_jobs;
  v_task public.agent_tasks;
  v_mandate public.agent_mandates;
  v_seller uuid;
  v_buyer uuid;
  v_lease uuid;
  v_taken integer := 0;
begin
  if p_limit is null or p_limit not between 1 and 50 or p_lease_seconds is null or p_lease_seconds not between 10 and 600 then
    raise exception 'Invalid claim' using errcode = '22023';
  end if;

  -- Jobs that kept losing their lease stop retrying.
  with dead as (
    update public.agent_jobs j set status = 'dead', lease_id = null, lease_expires_at = null, finished_at = now(),
      last_error = coalesce(j.last_error, 'lease lost too often')
    where j.status = 'leased' and j.lease_expires_at < now() and j.attempts >= j.max_attempts
    returning j.id, j.task_id
  )
  insert into public.agent_telemetry(kind, task_id, job_id, owner_id)
  select 'job_dead', d.task_id, d.id, t.owner_id from dead d join public.agent_tasks t on t.id = d.task_id;

  for v_job in
    select * from public.agent_jobs j
    where (j.status = 'pending' and j.available_at <= now())
       or (j.status = 'leased' and j.lease_expires_at < now() and j.attempts < j.max_attempts)
    order by j.available_at, j.id
    limit p_limit * 4
    for update skip locked
  loop
    exit when v_taken >= p_limit;
    select * into v_task from public.agent_tasks where id = v_job.task_id;
    select * into v_mandate from public.agent_mandates where id = v_task.mandate_id;
    if v_task.finished_at is not null or v_mandate.id is null or v_mandate.status in ('revoked', 'ended')
       or (v_mandate.expires_at is not null and v_mandate.expires_at <= now()) then
      update public.agent_jobs set status = 'cancelled', lease_id = null, lease_expires_at = null, finished_at = now(),
        last_error = 'task or mandate ended'
      where id = v_job.id;
      continue;
    end if;
    -- Paused or switched off: leave it queued, but behind everyone else's.
    if v_mandate.status = 'paused' then
      update public.agent_jobs set available_at = now() + interval '1 minute' where id = v_job.id;
      continue;
    end if;
    select l.seller_id into v_seller from public.listings l where l.id = v_job.listing_id;
    select o.buyer_id into v_buyer from public.offers o where o.id = v_job.offer_id;
    if public.agent_halt_reason(v_mandate.scope, v_mandate.owner_id, v_mandate.id, v_job.listing_id,
         case v_mandate.scope when 'seller' then v_buyer else v_seller end) is not null then
      update public.agent_jobs set available_at = now() + interval '1 minute' where id = v_job.id;
      continue;
    end if;
    v_lease := gen_random_uuid();
    update public.agent_jobs set status = 'leased', lease_id = v_lease,
      lease_expires_at = now() + make_interval(secs => p_lease_seconds), attempts = attempts + 1
    where id = v_job.id;
    v_taken := v_taken + 1;
    job_id := v_job.id; lease_id := v_lease; task_id := v_job.task_id; kind := v_job.kind;
    expected_action := v_job.expected_action; listing_id := v_job.listing_id; offer_id := v_job.offer_id; round_no := v_job.round_no;
    return next;
  end loop;
end;
$function$;

-- The job, locked, if it is leased to the caller for this action.
create or replace function public.agent_lock_job(p_job uuid, p_lease uuid, p_action text)
returns public.agent_jobs
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_job public.agent_jobs;
begin
  select * into v_job from public.agent_jobs where id = p_job for update;
  if not found or v_job.status <> 'leased' or v_job.lease_id is distinct from p_lease or v_job.lease_expires_at <= now() then
    raise exception 'This job is not leased to you' using errcode = 'AG001';
  end if;
  if p_action is not null and v_job.expected_action <> p_action then
    raise exception 'This job is for another action' using errcode = 'AG002';
  end if;
  return v_job;
end;
$function$;

revoke all on function public.agent_lock_job(uuid, uuid, text) from public, anon, authenticated, service_role;

-- The owner's authority for a locked job: the task and mandate, re-checked.
-- Raises unless the agent may act for this owner right now.
create or replace function public.agent_authority(p_job public.agent_jobs, p_listing public.listings, p_offer public.offers)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_task public.agent_tasks;
  v_mandate public.agent_mandates;
  v_owner uuid;
  v_counterparty uuid;
  v_halt text;
begin
  select * into v_task from public.agent_tasks where id = p_job.task_id;
  select * into v_mandate from public.agent_mandates where id = v_task.mandate_id for share;
  select * into v_task from public.agent_tasks where id = p_job.task_id for update;
  if v_task.finished_at is not null or v_mandate.id is null or v_mandate.status <> 'active'
     or (v_mandate.expires_at is not null and v_mandate.expires_at <= now()) then
    raise exception 'The owner turned this off' using errcode = 'AG003';
  end if;
  v_owner := v_mandate.owner_id;
  if v_task.owner_id <> v_owner or v_task.scope <> v_mandate.scope or v_mandate.listing_id <> p_listing.id
     or p_job.listing_id <> p_listing.id
     or (v_mandate.scope = 'seller' and p_listing.seller_id <> v_owner)
     or (v_mandate.scope = 'buyer' and (p_listing.seller_id = v_owner or (p_offer.id is not null and p_offer.buyer_id <> v_owner))) then
    raise exception 'Not the owner''s side of this' using errcode = 'AG005';
  end if;
  if public.is_suspended(v_owner) then raise exception 'The owner''s account is suspended' using errcode = 'AG007'; end if;
  v_counterparty := case v_mandate.scope when 'seller' then p_offer.buyer_id else p_listing.seller_id end;
  v_halt := public.agent_halt_reason(v_mandate.scope, v_owner, v_mandate.id, p_listing.id, v_counterparty);
  if v_halt is not null then raise exception 'Agents are paused (%)', v_halt using errcode = 'AG004'; end if;
  return jsonb_build_object('owner_id', v_owner, 'task_id', v_task.id, 'mandate_id', v_mandate.id,
    'mandate_version', v_mandate.version, 'scope', v_mandate.scope, 'ceiling_cents', v_mandate.ceiling_cents,
    'ceiling_basis', v_mandate.ceiling_basis);
end;
$function$;

revoke all on function public.agent_authority(public.agent_jobs, public.listings, public.offers) from public, anon, authenticated, service_role;

create or replace function public.agent_renew_lease(p_job uuid, p_lease uuid, p_lease_seconds integer default 60)
returns timestamptz
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_job public.agent_jobs;
begin
  v_job := public.agent_lock_job(p_job, p_lease, null);
  update public.agent_jobs set lease_expires_at = now() + make_interval(secs => least(greatest(coalesce(p_lease_seconds, 60), 10), 600))
  where id = v_job.id returning lease_expires_at into v_job.lease_expires_at;
  return v_job.lease_expires_at;
end;
$function$;

-- What the worker needs to decide, for the owner only: the owner's own limits
-- (the seller's effective floor, or the buyer's ceiling), the listing's
-- public facts and the moves both sides already see. Never the other side's
-- limits.
create or replace function public.agent_job_context(p_job uuid, p_lease uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_job public.agent_jobs;
  v_task public.agent_tasks;
  v_mandate public.agent_mandates;
  v_listing public.listings;
  v_offer public.offers;
  v_owner uuid;
  v_buyer uuid;
begin
  v_job := public.agent_lock_job(p_job, p_lease, null);
  select * into v_task from public.agent_tasks where id = v_job.task_id;
  select * into v_mandate from public.agent_mandates where id = v_task.mandate_id;
  select * into v_listing from public.listings where id = v_job.listing_id;
  select * into v_offer from public.offers where id = v_job.offer_id;
  v_owner := v_mandate.owner_id;
  v_buyer := coalesce(v_offer.buyer_id, case when v_mandate.scope = 'buyer' then v_owner end);
  return jsonb_build_object(
    'job', jsonb_build_object('id', v_job.id, 'kind', v_job.kind, 'expected_action', v_job.expected_action,
      'offer_id', v_job.offer_id, 'round_no', v_job.round_no),
    'task', jsonb_build_object('id', v_task.id, 'scope', v_task.scope, 'status', v_task.status),
    'mandate', jsonb_build_object('id', v_mandate.id, 'version', v_mandate.version, 'status', v_mandate.status,
      'style', v_mandate.style, 'target_cents', v_mandate.target_cents,
      'ceiling_cents', case when v_mandate.scope = 'buyer' then v_mandate.ceiling_cents end,
      'ceiling_basis', case when v_mandate.scope = 'buyer' then v_mandate.ceiling_basis end),
    'effective_floor_cents', case when v_mandate.scope = 'seller' and v_listing.seller_id = v_owner
      then public.offer_effective_floor(v_listing.id) end,
    'listing', jsonb_build_object('id', v_listing.id, 'status', v_listing.status, 'price_cents', v_listing.price_cents,
      'shipping_cents', v_listing.shipping_cents, 'shipping_mode', v_listing.shipping_mode),
    'offer', case when v_offer.id is null then null else jsonb_build_object('id', v_offer.id, 'status', v_offer.status,
      'amount_cents', v_offer.amount_cents, 'counter_amount_cents', v_offer.counter_amount_cents,
      'round_count', v_offer.round_count, 'expires_at', v_offer.expires_at) end,
    'rounds', coalesce((select jsonb_agg(jsonb_build_object('round_no', r.round_no, 'actor_role', r.actor_role, 'kind', r.kind,
        'amount_cents', r.amount_cents, 'by_agent', r.actor_task_id is not null) order by r.round_no)
      from public.offer_rounds r where r.offer_id = v_offer.id), '[]'::jsonb),
    'buyer_amounts', coalesce((select jsonb_agg(r.amount_cents order by r.created_at)
      from public.offer_rounds r where r.listing_id = v_listing.id and r.buyer_id = v_buyer and r.actor_role = 'buyer'
        and r.kind in ('offer', 'counter', 'below_minimum')), '[]'::jsonb),
    'halted', public.agent_halt_reason(v_mandate.scope, v_owner, v_mandate.id, v_listing.id,
      case v_mandate.scope when 'seller' then v_offer.buyer_id else v_listing.seller_id end)
  );
end;
$function$;

-- A negotiation move for the owner, through offer_move_core.
create or replace function public.agent_offer_move(p_job uuid, p_lease uuid, p_offer uuid, p_kind text, p_amount integer, p_expected_round integer)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_peek public.agent_jobs;
  v_job public.agent_jobs;
  v_listing public.listings;
  v_offer public.offers;
  v_auth jsonb;
  v_owner uuid;
  v_key text;
  v_live integer;
  v_result jsonb;
begin
  select * into v_peek from public.agent_jobs where id = p_job;
  if not found then raise exception 'This job is not leased to you' using errcode = 'AG001'; end if;
  -- Lock order: listing → offer → job → mandate → task.
  select * into v_listing from public.listings where id = v_peek.listing_id for update;
  select * into v_offer from public.offers where id = v_peek.offer_id for update;
  v_job := public.agent_lock_job(p_job, p_lease, 'offer_move');
  if v_job.offer_id is distinct from p_offer or v_job.round_no is distinct from p_expected_round then
    raise exception 'This job is for another move' using errcode = 'AG002';
  end if;
  v_auth := public.agent_authority(v_job, v_listing, v_offer);
  v_owner := (v_auth->>'owner_id')::uuid;

  if v_auth->>'scope' = 'seller' then
    -- The seller's agent counters; it never accepts (AG-5; no auto-accept at launch).
    if p_kind not in ('counter', 'decline') then
      raise exception 'The seller''s agent can only counter or decline' using errcode = 'AG008';
    end if;
  else
    if p_kind not in ('counter', 'accept', 'withdraw') then
      raise exception 'The buyer''s agent can counter, accept or withdraw' using errcode = 'AG008';
    end if;
    v_live := case p_kind when 'counter' then p_amount when 'accept' then v_offer.counter_amount_cents end;
    -- "Total up to" counts the listing's shipping.
    v_live := v_live + (case when v_auth->>'ceiling_basis' = 'total' then v_listing.shipping_cents else 0 end);
    if v_live is not null and v_live > (v_auth->>'ceiling_cents')::integer then
      raise exception 'That is above the owner''s limit' using errcode = 'AG006';
    end if;
  end if;

  -- The task waits for the other side unless the move settles it (the outbox
  -- trigger runs inside the move and may finish or re-queue it).
  update public.agent_tasks set status = 'waiting_for_event'
  where id = v_job.task_id and status = 'working'
    and not exists (select 1 from public.agent_jobs j where j.task_id = v_job.task_id and j.id <> v_job.id
                    and j.status in ('pending', 'leased'));
  update public.agent_jobs set status = 'done', lease_id = null, lease_expires_at = null, finished_at = now()
  where id = v_job.id;

  v_key := p_kind || ':' || p_offer || ':r' || p_expected_round || ':' || coalesce(p_amount, 0);
  v_result := public.offer_move_core(v_owner, p_offer, p_kind, p_amount, v_key, p_expected_round,
    jsonb_build_object('task_id', v_job.task_id, 'job_id', v_job.id, 'mandate_version', (v_auth->>'mandate_version')::integer,
      'ceiling_cents', (v_auth->>'ceiling_cents')::integer));

  insert into public.agent_events(owner_id, task_id, job_id, mandate_id, mandate_version, kind, initiated_by, inputs, result, idempotency_key)
  values (v_owner, v_job.task_id, v_job.id, (v_auth->>'mandate_id')::uuid, (v_auth->>'mandate_version')::integer, 'move',
    'offer_round:' || p_offer || ':r' || p_expected_round,
    jsonb_build_object('kind', p_kind, 'amount_cents', p_amount),
    v_result - 'order_id', v_key);
  return v_result;
end;
$function$;

-- The buyer's agent's opening offer. The offer's id is the job's, so a
-- retried job replays the same offer.
create or replace function public.agent_offer_open(p_job uuid, p_lease uuid, p_listing uuid, p_amount integer)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_peek public.agent_jobs;
  v_job public.agent_jobs;
  v_listing public.listings;
  v_none public.offers;
  v_auth jsonb;
  v_owner uuid;
  v_result jsonb;
  v_live integer;
begin
  select * into v_peek from public.agent_jobs where id = p_job;
  if not found then raise exception 'This job is not leased to you' using errcode = 'AG001'; end if;
  select * into v_listing from public.listings where id = v_peek.listing_id for update;
  v_job := public.agent_lock_job(p_job, p_lease, 'offer_open');
  if v_job.listing_id is distinct from p_listing then
    raise exception 'This job is for another listing' using errcode = 'AG002';
  end if;
  v_auth := public.agent_authority(v_job, v_listing, v_none);
  v_owner := (v_auth->>'owner_id')::uuid;
  if v_auth->>'scope' <> 'buyer' then
    raise exception 'Only the buyer''s agent opens offers' using errcode = 'AG008';
  end if;
  v_live := p_amount + (case when v_auth->>'ceiling_basis' = 'total' then v_listing.shipping_cents else 0 end);
  if v_live is null or v_live > (v_auth->>'ceiling_cents')::integer then
    raise exception 'That is above the owner''s limit' using errcode = 'AG006';
  end if;

  update public.agent_tasks set status = 'waiting_for_event', offer_id = null
  where id = v_job.task_id and status = 'working';
  update public.agent_jobs set status = 'done', lease_id = null, lease_expires_at = null, finished_at = now()
  where id = v_job.id;

  v_result := public.offer_open_core(v_owner, v_job.id, p_listing, p_amount, null,
    jsonb_build_object('task_id', v_job.task_id, 'job_id', v_job.id, 'mandate_version', (v_auth->>'mandate_version')::integer,
      'ceiling_cents', (v_auth->>'ceiling_cents')::integer));
  update public.agent_tasks set offer_id = v_job.id where id = v_job.task_id and finished_at is null;

  insert into public.agent_events(owner_id, task_id, job_id, mandate_id, mandate_version, kind, initiated_by, inputs, result, idempotency_key)
  values (v_owner, v_job.task_id, v_job.id, (v_auth->>'mandate_id')::uuid, (v_auth->>'mandate_version')::integer, 'move',
    'task:' || v_job.task_id, jsonb_build_object('kind', 'offer', 'amount_cents', p_amount), v_result, 'open:' || v_job.id);
  return v_result;
end;
$function$;

-- Ask the owner: an offer the agent may not take itself (a seller's agent
-- never accepts; a buyer's agent asks before going over the ceiling).
create or replace function public.agent_request_approval(p_job uuid, p_lease uuid, p_offer uuid, p_expected_round integer, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_peek public.agent_jobs;
  v_job public.agent_jobs;
  v_listing public.listings;
  v_offer public.offers;
  v_auth jsonb;
  v_owner uuid;
  v_amount integer;
  v_id uuid;
begin
  select * into v_peek from public.agent_jobs where id = p_job;
  if not found then raise exception 'This job is not leased to you' using errcode = 'AG001'; end if;
  select * into v_listing from public.listings where id = v_peek.listing_id for update;
  select * into v_offer from public.offers where id = v_peek.offer_id for update;
  v_job := public.agent_lock_job(p_job, p_lease, 'offer_move');
  if v_job.offer_id is distinct from p_offer or v_job.round_no is distinct from p_expected_round
     or v_offer.round_count is distinct from p_expected_round then
    raise exception 'This job is for another move' using errcode = 'AG002';
  end if;
  v_auth := public.agent_authority(v_job, v_listing, v_offer);
  v_owner := (v_auth->>'owner_id')::uuid;
  if v_offer.status not in ('open', 'countered') then raise exception 'This offer is already settled' using errcode = 'OF005'; end if;
  if (v_auth->>'scope' = 'seller' and v_offer.status <> 'open') or (v_auth->>'scope' = 'buyer' and v_offer.status <> 'countered') then
    raise exception 'It''s not your turn' using errcode = 'OF002';
  end if;
  v_amount := case v_offer.status when 'open' then v_offer.amount_cents else v_offer.counter_amount_cents end;

  insert into public.agent_approvals(owner_id, task_id, kind, offer_id, round_no, amount_cents, reason)
  values (v_owner, v_job.task_id, 'accept_offer', p_offer, p_expected_round, v_amount, left(p_reason, 200))
  on conflict (task_id, offer_id, round_no) where status = 'pending' do nothing
  returning id into v_id;
  if v_id is null then
    select id into v_id from public.agent_approvals
    where task_id = v_job.task_id and offer_id = p_offer and round_no = p_expected_round and status = 'pending';
  end if;
  update public.agent_jobs set status = 'done', lease_id = null, lease_expires_at = null, finished_at = now() where id = v_job.id;
  update public.agent_tasks set status = 'needs_approval' where id = v_job.task_id and status <> 'needs_approval';
  insert into public.agent_events(owner_id, task_id, job_id, mandate_id, mandate_version, kind, initiated_by, inputs, result)
  values (v_owner, v_job.task_id, v_job.id, (v_auth->>'mandate_id')::uuid, (v_auth->>'mandate_version')::integer, 'approval',
    'offer_round:' || p_offer || ':r' || p_expected_round, jsonb_build_object('amount_cents', v_amount, 'reason', left(p_reason, 200)),
    jsonb_build_object('approval_id', v_id));
  return v_id;
end;
$function$;

-- A decision that makes no move (hold, wait for expiry), recorded and done.
-- It re-checks the owner's authority like any other worker write.
create or replace function public.agent_record_decision(p_job uuid, p_lease uuid, p_decision text, p_reason text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_peek public.agent_jobs;
  v_job public.agent_jobs;
  v_listing public.listings;
  v_offer public.offers;
  v_auth jsonb;
begin
  if p_decision is null or p_decision not in ('hold', 'at_limit', 'skip') then
    raise exception 'Invalid decision' using errcode = '22023';
  end if;
  select * into v_peek from public.agent_jobs where id = p_job;
  if not found then raise exception 'This job is not leased to you' using errcode = 'AG001'; end if;
  select * into v_listing from public.listings where id = v_peek.listing_id for update;
  select * into v_offer from public.offers where id = v_peek.offer_id for update;
  v_job := public.agent_lock_job(p_job, p_lease, null);
  v_auth := public.agent_authority(v_job, v_listing, v_offer);
  update public.agent_jobs set status = 'done', lease_id = null, lease_expires_at = null, finished_at = now() where id = v_job.id;
  update public.agent_tasks set status = 'waiting_for_event'
  where id = v_job.task_id and status = 'working'
    and not exists (select 1 from public.agent_jobs j where j.task_id = v_job.task_id and j.status in ('pending', 'leased'));
  insert into public.agent_events(owner_id, task_id, job_id, mandate_id, mandate_version, kind, initiated_by, inputs, result)
  values ((v_auth->>'owner_id')::uuid, v_job.task_id, v_job.id, (v_auth->>'mandate_id')::uuid, (v_auth->>'mandate_version')::integer, 'decision',
    coalesce('offer_round:' || v_job.offer_id || ':r' || v_job.round_no, 'task:' || v_job.task_id),
    '{}'::jsonb, jsonb_build_object('decision', p_decision, 'reason', left(public.agent_redact_cards(p_reason), 200)));
end;
$function$;

-- Hand a job back: retry later, or give up. A code is telemetry: AG*/42501
-- count as permission denials, model_* as model errors. p_end_task fails the
-- task (the listing is gone, the offer is settled).
create or replace function public.agent_finish_job(p_job uuid, p_lease uuid, p_outcome text, p_code text default null, p_end_task boolean default false)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_job public.agent_jobs;
  v_owner uuid;
begin
  if p_outcome is null or p_outcome not in ('retry', 'failed', 'cancelled') or (p_code is not null and length(p_code) > 40)
     or p_end_task is null then
    raise exception 'Invalid finish' using errcode = '22023';
  end if;
  select * into v_job from public.agent_jobs where id = p_job;
  if not found then return false; end if;
  -- Lock order: listing → offer → job → task.
  perform 1 from public.listings where id = v_job.listing_id for update;
  perform 1 from public.offers where id = v_job.offer_id for update;
  select * into v_job from public.agent_jobs where id = p_job for update;
  if v_job.status <> 'leased' or v_job.lease_id is distinct from p_lease then
    return false;
  end if;
  select t.owner_id into v_owner from public.agent_tasks t where t.id = v_job.task_id;
  if p_outcome = 'retry' and v_job.attempts < v_job.max_attempts then
    update public.agent_jobs set status = 'pending', lease_id = null, lease_expires_at = null, last_error = p_code,
      available_at = now() + make_interval(secs => least(30 * power(2, v_job.attempts), 1800))
    where id = v_job.id;
  else
    update public.agent_jobs set status = case p_outcome when 'cancelled' then 'cancelled' else 'failed' end,
      lease_id = null, lease_expires_at = null, finished_at = now(), last_error = p_code
    where id = v_job.id;
  end if;
  if p_code is not null then
    insert into public.agent_telemetry(kind, code, task_id, job_id, owner_id)
    values (case when p_code like 'AG%' or p_code = '42501' then 'permission_denied'
                 when p_code like 'model%' then 'model_error' else 'job_failed' end,
            p_code, v_job.task_id, v_job.id, v_owner);
  end if;
  if p_end_task and p_outcome <> 'retry' then
    update public.agent_tasks set status = 'failed', outcome = left(coalesce(p_code, 'failed'), 200)
    where id = v_job.task_id and finished_at is null
      and not exists (select 1 from public.agent_jobs j where j.task_id = v_job.task_id and j.status in ('pending', 'leased'));
  end if;
  return true;
end;
$function$;

-- ---------------------------------------------------------------------------
-- Member functions: set, pause, resume or turn off a mandate; answer an
-- approval; clear the chat. No screen calls these until A3a.
-- ---------------------------------------------------------------------------
create or replace function public.agent_mandate_set(p_scope text, p_listing uuid, p_minimum_cents integer default null,
  p_target_cents integer default null, p_ceiling_cents integer default null, p_ceiling_basis text default null,
  p_style text default 'balanced', p_expires_at timestamptz default null, p_acknowledge_binding boolean default false)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_actor uuid := auth.uid();
  v_listing public.listings;
  v_mandate public.agent_mandates;
  v_task uuid;
  v_floor integer;
begin
  if v_actor is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  if public.is_suspended(v_actor) then raise exception 'account is suspended' using errcode = '42501'; end if;
  if p_scope is null or p_scope not in ('seller', 'buyer') or p_style is null or p_style not in ('firm', 'balanced', 'flexible')
     or p_listing is null or p_acknowledge_binding is null or (p_expires_at is not null and p_expires_at <= now()) then
    raise exception 'Invalid agent limits' using errcode = '22023';
  end if;
  -- Lock order: the listing first, like every move on it.
  select * into v_listing from public.listings where id = p_listing for update;
  if not found or v_listing.status <> 'active' then raise exception 'Listing is not available' using errcode = 'OF007'; end if;
  if v_listing.shipping_mode = 'drvn' then raise exception 'Offers are unavailable with rated shipping' using errcode = 'OF007'; end if;

  if p_scope = 'seller' then
    if v_listing.seller_id <> v_actor then raise exception 'Not your listing' using errcode = '42501'; end if;
    if p_ceiling_cents is not null or p_ceiling_basis is not null then raise exception 'Invalid agent limits' using errcode = '22023'; end if;
    if p_minimum_cents is not null and (p_minimum_cents <= 0 or p_minimum_cents > v_listing.price_cents) then
      raise exception 'Your agent''s minimum must be between $0 and the asking price' using errcode = 'OF004';
    end if;
    if p_target_cents is not null and (p_target_cents > v_listing.price_cents
       or p_target_cents < coalesce(p_minimum_cents, 1)) then
      raise exception 'Your target must be between your minimum and the asking price' using errcode = 'OF004';
    end if;
    select greatest(t.offer_floor_cents, p_minimum_cents) into v_floor from public.listing_private_terms t where t.listing_id = p_listing;
    v_floor := coalesce(v_floor, p_minimum_cents);
    if v_floor is null then raise exception 'Set a minimum before your agent handles offers' using errcode = 'OF004'; end if;
  else
    if v_listing.seller_id = v_actor then raise exception 'You can''t offer on your own listing' using errcode = '42501'; end if;
    if p_minimum_cents is not null or p_ceiling_cents is null or p_ceiling_cents <= 0 or p_ceiling_cents > 100000000
       or p_ceiling_basis is null or p_ceiling_basis not in ('item', 'total') or (p_target_cents is not null and p_target_cents > p_ceiling_cents) then
      raise exception 'Invalid agent limits' using errcode = '22023';
    end if;
    -- "Total up to" only where the total is knowable.
    if p_ceiling_basis = 'total' and v_listing.shipping_mode <> 'flat' then
      raise exception 'A total ceiling needs a fixed shipping price' using errcode = '22023';
    end if;
  end if;

  select * into v_mandate from public.agent_mandates
  where owner_id = v_actor and scope = p_scope and listing_id = p_listing and status in ('active', 'paused') for update;
  if found then
    if p_scope = 'seller' and v_mandate.binding_acknowledged_at is null and not p_acknowledge_binding then
      raise exception 'Confirm that your agent''s counters are binding' using errcode = '22023';
    end if;
    update public.agent_mandates set version = version + 1, minimum_cents = p_minimum_cents, target_cents = p_target_cents,
      ceiling_cents = p_ceiling_cents, ceiling_basis = p_ceiling_basis, style = p_style, expires_at = p_expires_at,
      updated_at = now()
    where id = v_mandate.id;
  else
    if p_scope = 'seller' and not p_acknowledge_binding then
      raise exception 'Confirm that your agent''s counters are binding' using errcode = '22023';
    end if;
    insert into public.agent_mandates(owner_id, scope, listing_id, minimum_cents, target_cents, ceiling_cents, ceiling_basis,
      style, expires_at, binding_acknowledged_at)
    values (v_actor, p_scope, p_listing, p_minimum_cents, p_target_cents, p_ceiling_cents, p_ceiling_basis,
      p_style, p_expires_at, case when p_scope = 'seller' then now() end)
    returning * into v_mandate;
  end if;

  v_task := public.agent_open_task(v_mandate.id);
  insert into public.agent_events(owner_id, task_id, mandate_id, mandate_version, kind, initiated_by, result)
  select v_actor, v_task, m.id, m.version, 'status', 'mandate_set', jsonb_build_object('mandate_status', m.status)
  from public.agent_mandates m where m.id = v_mandate.id;
  if public.agent_enqueue_turns(v_task) > 0 then
    update public.agent_tasks set status = 'working' where id = v_task and status = 'waiting_for_event';
  end if;
  return v_mandate.id;
end;
$function$;

create or replace function public.agent_mandate_set_status(p_mandate uuid, p_status text)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_actor uuid := auth.uid();
  v_mandate public.agent_mandates;
  v_task uuid;
begin
  if v_actor is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  if p_mandate is null or p_status is null or p_status not in ('active', 'paused', 'revoked') then
    raise exception 'Invalid status' using errcode = '22023';
  end if;
  select * into v_mandate from public.agent_mandates where id = p_mandate and owner_id = v_actor;
  if not found then raise exception 'Not found' using errcode = 'P0002'; end if;
  -- Lock order: listing, then the mandate and its task.
  perform 1 from public.listings where id = v_mandate.listing_id for update;
  select * into v_mandate from public.agent_mandates where id = p_mandate for update;
  if v_mandate.status = p_status then return p_status; end if;
  if v_mandate.status in ('revoked', 'ended') then raise exception 'This mandate has ended' using errcode = '22023'; end if;
  if p_status = 'active' and public.is_suspended(v_actor) then raise exception 'account is suspended' using errcode = '42501'; end if;
  update public.agent_mandates set status = p_status, updated_at = now(),
    ended_at = case when p_status = 'revoked' then now() end
  where id = p_mandate;
  if p_status = 'active' then
    -- Resuming after the task ended (a failed offer while paused) opens a new one.
    v_task := public.agent_open_task(p_mandate);
    perform public.agent_enqueue_turns(v_task);
  else
    select id into v_task from public.agent_tasks where mandate_id = p_mandate and finished_at is null for update;
  end if;
  if v_task is not null then
    if p_status = 'revoked' then
      update public.agent_tasks set status = 'cancelled', outcome = 'turned off by owner' where id = v_task and finished_at is null;
      update public.agent_approvals set status = 'dismissed', decided_at = now() where task_id = v_task and status = 'pending';
    end if;
    insert into public.agent_events(owner_id, task_id, mandate_id, mandate_version, kind, initiated_by, result)
    values (v_actor, v_task, p_mandate, v_mandate.version, 'status', 'owner', jsonb_build_object('mandate_status', p_status));
  end if;
  return p_status;
end;
$function$;

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
begin
  if v_actor is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  if p_approval is null or p_choice is null or p_choice not in ('accept', 'dismiss') then
    raise exception 'Invalid choice' using errcode = '22023';
  end if;
  select * into v_approval from public.agent_approvals where id = p_approval and owner_id = v_actor;
  if not found then raise exception 'Not found' using errcode = 'P0002'; end if;
  if v_approval.status <> 'pending' then
    return jsonb_build_object('approval_id', p_approval, 'status', v_approval.status, 'replayed', true);
  end if;
  if p_choice = 'accept' then
    -- The owner accepts, as themself: the move is theirs, not the agent's.
    v_result := public.offer_move_core(v_actor, v_approval.offer_id, 'accept', null,
      'approval:' || p_approval, v_approval.round_no, null);
    update public.agent_approvals set status = 'approved', decided_at = coalesce(decided_at, now()) where id = p_approval;
  else
    -- Lock order: listing → offer → task → approval, as the outbox trigger takes them.
    perform 1 from public.listings l join public.offers o on o.listing_id = l.id where o.id = v_approval.offer_id for update of l;
    perform 1 from public.offers where id = v_approval.offer_id for update;
    perform 1 from public.agent_tasks where id = v_approval.task_id for update;
    update public.agent_approvals set status = 'dismissed', decided_at = now() where id = p_approval and status = 'pending';
    update public.agent_tasks set status = 'waiting_for_event'
    where id = v_approval.task_id and status = 'needs_approval'
      and not exists (select 1 from public.agent_approvals a where a.task_id = v_approval.task_id and a.status = 'pending');
  end if;
  insert into public.agent_events(owner_id, task_id, kind, initiated_by, result)
  values (v_actor, v_approval.task_id, 'approval', 'owner', jsonb_build_object('approval_id', p_approval, 'choice', p_choice));
  return coalesce(v_result, '{}'::jsonb) || jsonb_build_object('approval_id', p_approval, 'status',
    case p_choice when 'accept' then 'approved' else 'dismissed' end, 'replayed', false);
end;
$function$;

create or replace function public.agent_clear_conversation()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_n integer;
begin
  if auth.uid() is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  delete from public.agent_conversations where owner_id = auth.uid();
  get diagnostics v_n = row_count;
  return v_n;
end;
$function$;

-- ---------------------------------------------------------------------------
-- Admin kill switches: an admin with step-up, audited in the same transaction.
-- Existing offers and orders are never touched (docs/site/operations.md,
-- "Agent kill switches and reconciliation").
-- ---------------------------------------------------------------------------
create or replace function public.admin_set_agent_control(p_scope text, p_subject uuid, p_on boolean, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_actor uuid := auth.uid();
  v_id uuid;
  v_subject_type text;
begin
  if not public.is_admin() or public.admin_role() <> 'admin' or not exists(
    select 1 from jsonb_array_elements(coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb->'amr', '[]'::jsonb)) m
    where m->>'method' in ('totp', 'mfa/totp')
      and (m->>'timestamp')::numeric between extract(epoch from now()) - 900 and extract(epoch from now()) + 60
  ) then raise exception 'Admin step-up required' using errcode = '42501'; end if;
  if p_reason is null or length(btrim(p_reason)) not between 1 and 1000 then
    raise exception 'A reason of 1–1000 characters is required' using errcode = '22023';
  end if;
  if p_scope is null or p_scope not in ('all', 'buyer', 'seller', 'member', 'mandate', 'listing', 'account') or p_on is null
     or ((p_scope in ('all', 'buyer', 'seller')) <> (p_subject is null)) then
    raise exception 'Invalid kill switch' using errcode = '22023';
  end if;
  if (p_scope in ('member', 'account') and not exists (select 1 from public.profiles where id = p_subject))
     or (p_scope = 'mandate' and not exists (select 1 from public.agent_mandates where id = p_subject))
     or (p_scope = 'listing' and not exists (select 1 from public.listings where id = p_subject)) then
    raise exception 'Not found' using errcode = 'P0002';
  end if;
  -- Exclusive against the worker's shared lock: waits for agent writes in flight.
  perform pg_advisory_xact_lock(public.agent_controls_lock_key());
  select id into v_id from public.agent_controls
  where scope = p_scope and subject_id is not distinct from p_subject and cleared_at is null;
  if p_on and v_id is null then
    insert into public.agent_controls(scope, subject_id, reason, set_by) values (p_scope, p_subject, btrim(p_reason), v_actor)
    returning id into v_id;
  elsif not p_on and v_id is not null then
    update public.agent_controls set cleared_at = now(), cleared_by = v_actor where id = v_id;
  elsif v_id is null then
    -- Already off: still audited, nothing changes.
    v_id := coalesce(p_subject, gen_random_uuid());
  end if;
  v_subject_type := case p_scope when 'listing' then 'listing' when 'member' then 'user' when 'account' then 'user' else 'agent' end;
  insert into public.admin_audit_log(actor_id, action, subject_type, subject_id, reason, metadata)
  values (v_actor, case when p_on then 'agent.pause' else 'agent.resume' end, v_subject_type, coalesce(p_subject, v_id), btrim(p_reason),
    jsonb_build_object('scope', p_scope, 'control_id', v_id));
  return v_id;
end;
$function$;

-- ---------------------------------------------------------------------------
-- Service-role sweeps: outbox reconcile, health, retention, account purge.
-- ---------------------------------------------------------------------------
create or replace function public.agent_reconcile_outbox(p_limit integer default 200)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_released integer;
  v_cancelled integer;
  v_ended integer := 0;
  v_added integer := 0;
  v_skipped integer := 0;
  v_n integer;
  v_task record;
  v_why text;
  v_listing public.listings;
begin
  -- One listing at a time, in id order, each locked first like every move on
  -- it (listing → offer → job → mandate → task). A listing busy with a move
  -- is skipped this pass rather than waited for, so the sweep never holds up
  -- a member or deadlocks against one.
  for v_task in
    select t.id, t.owner_id, t.listing_id, t.mandate_id, m.status mandate_status, m.expires_at
    from public.agent_tasks t
    left join public.agent_mandates m on m.id = t.mandate_id
    where t.finished_at is null and t.scope in ('seller', 'buyer')
    order by t.listing_id nulls first, t.id
    limit greatest(coalesce(p_limit, 200), 1)
  loop
    v_listing := null;
    if v_task.listing_id is not null then
      select * into v_listing from public.listings where id = v_task.listing_id for update skip locked;
      if not found then
        if exists (select 1 from public.listings where id = v_task.listing_id) then
          v_skipped := v_skipped + 1;
          continue;
        end if;
      end if;
    end if;
    perform 1 from public.offers where listing_id = v_task.listing_id and status in ('open', 'countered') order by id for update;

    -- Tasks with nothing left to do end: the listing sold, went (archived,
    -- removed, deleted), the mandate expired or is gone.
    v_why := case
      when v_task.mandate_id is null then 'mandate gone'
      when v_listing.id is null then 'listing gone'
      when v_listing.status = 'sold' then 'sold'
      when v_listing.status in ('archived', 'removed') then 'listing unavailable'
      when v_task.expires_at is not null and v_task.expires_at <= now() then 'mandate expired'
    end;
    if v_why is not null then
      update public.agent_jobs set status = 'cancelled', lease_id = null, lease_expires_at = null, finished_at = now(),
        last_error = 'task ended'
      where task_id = v_task.id and status in ('pending', 'leased');
      update public.agent_mandates set status = 'ended', ended_at = now(), updated_at = now()
      where id = v_task.mandate_id and status in ('active', 'paused');
      update public.agent_tasks set status = case v_why when 'sold' then 'completed' else 'cancelled' end, outcome = v_why
      where id = v_task.id and finished_at is null;
      insert into public.agent_events(owner_id, task_id, mandate_id, kind, initiated_by, result)
      values (v_task.owner_id, v_task.id, v_task.mandate_id, 'status', 'reconcile', jsonb_build_object('outcome', v_why));
      v_ended := v_ended + 1;
      continue;
    end if;

    -- A live turn with no job means the outbox missed an event.
    if v_task.mandate_status = 'active' then
      v_n := public.agent_enqueue_turns(v_task.id);
      if v_n > 0 then
        v_added := v_added + v_n;
        insert into public.agent_telemetry(kind, code, task_id, owner_id) values ('outbox_reconciled', v_n::text, v_task.id, v_task.owner_id);
        update public.agent_tasks set status = 'working' where id = v_task.id and status = 'waiting_for_event';
      end if;
    end if;
  end loop;

  -- Leases that ran out go back to the queue (claim also re-leases them), and
  -- jobs whose task ended have nothing to do. Jobs only: no listing waits on these.
  update public.agent_jobs set status = 'pending', lease_id = null, lease_expires_at = null
  where status = 'leased' and lease_expires_at < now() - interval '1 minute' and attempts < max_attempts;
  get diagnostics v_released = row_count;
  update public.agent_jobs j set status = 'cancelled', lease_id = null, lease_expires_at = null, finished_at = now(),
    last_error = 'task ended'
  from public.agent_tasks t
  where t.id = j.task_id and t.finished_at is not null and j.status in ('pending', 'leased');
  get diagnostics v_cancelled = row_count;
  return jsonb_build_object('released', v_released, 'ended', v_ended, 'cancelled', v_cancelled, 'enqueued', v_added, 'skipped', v_skipped);
end;
$function$;

create or replace function public.agent_health()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $function$
  select jsonb_build_object(
    'stuck_tasks', (select count(*) from public.agent_tasks t
      where t.finished_at is null and t.status = 'working' and t.updated_at < now() - interval '15 minutes'
        and not exists (select 1 from public.agent_jobs j where j.task_id = t.id and j.status in ('pending', 'leased'))),
    'stale_jobs', (select count(*) from public.agent_jobs j
      where (j.status = 'pending' and j.available_at < now() - interval '10 minutes')
         or (j.status = 'leased' and j.lease_expires_at < now() - interval '5 minutes')),
    'repeated_decisions', (select count(*) from (
      select e.task_id from public.agent_events e
      where e.kind in ('decision', 'move', 'approval') and e.created_at > now() - interval '1 hour' and e.job_id is not null
      group by e.task_id, e.initiated_by having count(*) > 2) x),
    'permission_denied_1h', (select count(*) from public.agent_telemetry where kind = 'permission_denied' and created_at > now() - interval '1 hour'),
    'model_errors_1h', (select count(*) from public.agent_telemetry where kind = 'model_error' and created_at > now() - interval '1 hour'),
    'dead_jobs_24h', (select count(*) from public.agent_jobs where status = 'dead' and finished_at > now() - interval '24 hours'),
    'controls_on', (select coalesce(jsonb_agg(c.scope order by c.set_at), '[]'::jsonb) from public.agent_controls c where c.cleared_at is null)
  );
$function$;

create or replace function public.agent_retention_sweep()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_jobs integer; v_telemetry integer; v_events integer; v_tasks integer; v_mandates integer; v_conversations integer;
begin
  perform set_config('drvn.agent_purge', 'on', true);
  delete from public.agent_jobs where finished_at < now() - interval '30 days';
  get diagnostics v_jobs = row_count;
  delete from public.agent_telemetry where created_at < now() - interval '30 days';
  get diagnostics v_telemetry = row_count;
  delete from public.agent_events where created_at < now() - interval '12 months';
  get diagnostics v_events = row_count;
  delete from public.agent_tasks where finished_at < now() - interval '12 months';
  get diagnostics v_tasks = row_count;
  delete from public.agent_mandates m where m.ended_at < now() - interval '12 months'
    and not exists (select 1 from public.agent_tasks t where t.mandate_id = m.id and t.finished_at is null);
  get diagnostics v_mandates = row_count;
  delete from public.agent_conversations where last_message_at < now() - interval '12 months';
  get diagnostics v_conversations = row_count;
  perform set_config('drvn.agent_purge', '', true);
  return jsonb_build_object('jobs', v_jobs, 'telemetry', v_telemetry, 'events', v_events, 'tasks', v_tasks,
    'mandates', v_mandates, 'conversations', v_conversations);
end;
$function$;

-- Account deletion: every agent row the member owns. Offer rounds the agent
-- made stay with the offer (their task link clears).
create or replace function public.agent_purge_member(p_user uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_tasks integer; v_mandates integer; v_events integer;
begin
  if p_user is null then raise exception 'A member is required' using errcode = '22023'; end if;
  perform set_config('drvn.agent_purge', 'on', true);
  delete from public.agent_conversations where owner_id = p_user;
  delete from public.agent_approvals where owner_id = p_user;
  delete from public.agent_events where owner_id = p_user;
  get diagnostics v_events = row_count;
  delete from public.agent_tasks where owner_id = p_user;
  get diagnostics v_tasks = row_count;
  delete from public.agent_mandates where owner_id = p_user;
  get diagnostics v_mandates = row_count;
  update public.agent_telemetry set owner_id = null where owner_id = p_user;
  perform set_config('drvn.agent_purge', '', true);
  return jsonb_build_object('tasks', v_tasks, 'mandates', v_mandates, 'events', v_events);
end;
$function$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
revoke all on function public.agent_claim_jobs(integer, integer) from public, anon, authenticated, service_role;
revoke all on function public.agent_renew_lease(uuid, uuid, integer) from public, anon, authenticated, service_role;
revoke all on function public.agent_job_context(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function public.agent_offer_move(uuid, uuid, uuid, text, integer, integer) from public, anon, authenticated, service_role;
revoke all on function public.agent_offer_open(uuid, uuid, uuid, integer) from public, anon, authenticated, service_role;
revoke all on function public.agent_request_approval(uuid, uuid, uuid, integer, text) from public, anon, authenticated, service_role;
revoke all on function public.agent_record_decision(uuid, uuid, text, text) from public, anon, authenticated, service_role;
revoke all on function public.agent_finish_job(uuid, uuid, text, text, boolean) from public, anon, authenticated, service_role;
grant execute on function public.agent_claim_jobs(integer, integer) to agent_worker;
grant execute on function public.agent_renew_lease(uuid, uuid, integer) to agent_worker;
grant execute on function public.agent_job_context(uuid, uuid) to agent_worker;
grant execute on function public.agent_offer_move(uuid, uuid, uuid, text, integer, integer) to agent_worker;
grant execute on function public.agent_offer_open(uuid, uuid, uuid, integer) to agent_worker;
grant execute on function public.agent_request_approval(uuid, uuid, uuid, integer, text) to agent_worker;
grant execute on function public.agent_record_decision(uuid, uuid, text, text) to agent_worker;
grant execute on function public.agent_finish_job(uuid, uuid, text, text, boolean) to agent_worker;

revoke all on function public.agent_mandate_set(text, uuid, integer, integer, integer, text, text, timestamptz, boolean) from public, anon, service_role;
revoke all on function public.agent_mandate_set_status(uuid, text) from public, anon, service_role;
revoke all on function public.agent_approval_decide(uuid, text) from public, anon, service_role;
revoke all on function public.agent_clear_conversation() from public, anon, service_role;
revoke all on function public.admin_set_agent_control(text, uuid, boolean, text) from public, anon, service_role;
grant execute on function public.agent_mandate_set(text, uuid, integer, integer, integer, text, text, timestamptz, boolean) to authenticated;
grant execute on function public.agent_mandate_set_status(uuid, text) to authenticated;
grant execute on function public.agent_approval_decide(uuid, text) to authenticated;
grant execute on function public.agent_clear_conversation() to authenticated;
grant execute on function public.admin_set_agent_control(text, uuid, boolean, text) to authenticated;

revoke all on function public.agent_reconcile_outbox(integer) from public, anon, authenticated;
revoke all on function public.agent_health() from public, anon, authenticated;
revoke all on function public.agent_retention_sweep() from public, anon, authenticated;
revoke all on function public.agent_purge_member(uuid) from public, anon, authenticated;
grant execute on function public.agent_reconcile_outbox(integer) to service_role;
grant execute on function public.agent_health() to service_role;
grant execute on function public.agent_retention_sweep() to service_role;
grant execute on function public.agent_purge_member(uuid) to service_role;

revoke all on function public.agent_record_mandate_version() from public, anon, authenticated, service_role;
revoke all on function public.agent_redact_cards(text) from public, anon, authenticated, service_role;
revoke all on function public.agent_luhn(text) from public, anon, authenticated, service_role;

commit;
