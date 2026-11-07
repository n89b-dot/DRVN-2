-- R-agentmode (OS-R-agentmode, PRD AG-7): the member's agent setting is
-- enforced by the database, not only by the app. 20261107170000 added
-- profiles.agent_mode with an owner update grant, and the app refused to
-- start a mandate outside Act and then ended the live ones. Two gaps:
--   * a direct authenticated call to agent_mandate_set (or a resume through
--     agent_mandate_set_status) never read the mode;
--   * a tab that read Act could create a mandate after another tab saved
--     Off and ended the live ones, and the worker never read the mode.
--
-- Now:
--   1. agent_mode_set(p_mode) is the only way a member changes the mode
--      (the column update grant is revoked). It takes the member's lock
--      exclusively, writes the mode and, below Act, revokes every live
--      mandate, cancels its open task and dismisses its pending cards, in one
--      transaction.
--   2. agent_mandate_set and a resume (agent_mandate_set_status 'active')
--      refuse below Act with AG009, read under the member's lock, shared.
--   3. The worker: agent_claim_jobs cancels a job whose owner is below Act;
--      agent_authority, which every worker write passes through
--      (agent_offer_move, agent_offer_open, agent_request_approval,
--      agent_record_decision), refuses with AG003 under the same shared lock.
--
-- Lock order: listing → offer → job → member (agent_member_lock_key) →
-- mandate → task → approval. agent_mode_set takes no listing, offer or job
-- lock, so it sits after them; it waits for any agent write already holding
-- the member's lock and every later one sees the new mode.
--
-- Restated from their latest definitions, with only the lines marked AG-7
-- added: agent_mandate_set (20261026100000), agent_mandate_set_status,
-- agent_claim_jobs and agent_authority (20261021100100). CREATE OR REPLACE
-- keeps their grants. Guard: supabase/tests/agent_mode_enforcement_guard.sql.
-- Idempotent.

begin;

create or replace function public.agent_member_lock_key(p_owner uuid)
returns bigint
language sql
immutable
set search_path = public, pg_temp
as $function$
  select hashtextextended('drvn.agent_member:' || p_owner::text, 0);
$function$;

revoke all on function public.agent_member_lock_key(uuid) from public, anon, authenticated, service_role;

-- 2. Mandates start or resume only under Act.
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
  -- The step opens from /admin/agent (20261024100000); until it does, no
  -- member can set this side's limits, whatever client they use.
  if not exists (select 1 from public.agent_beta_steps s where s.step = p_scope and s.open) then
    raise exception 'That part of the agent isn''t open yet' using errcode = '42501';
  end if;
  -- Lock order: the listing first, like every move on it.
  select * into v_listing from public.listings where id = p_listing for update;
  if not found or v_listing.status <> 'active' then raise exception 'Listing is not available' using errcode = 'OF007'; end if;
  -- AG-7 (R-agentmode): a mandate starts or changes only under Act within
  -- my limits, read under the member's lock (after the listing), so a save
  -- to Off or Suggest in another tab either waits for this or is waited for.
  perform pg_advisory_xact_lock_shared(public.agent_member_lock_key(v_actor));
  if (select p.agent_mode from public.profiles p where p.id = v_actor) is distinct from 'act' then
    raise exception 'Your agent is set to Off or Suggest in Settings' using errcode = 'AG009';
  end if;
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
  -- Lock order: listing, then the member (AG-7), then the mandate and its task.
  perform 1 from public.listings where id = v_mandate.listing_id for update;
  perform pg_advisory_xact_lock_shared(public.agent_member_lock_key(v_actor));
  select * into v_mandate from public.agent_mandates where id = p_mandate for update;
  if v_mandate.status = p_status then return p_status; end if;
  if v_mandate.status in ('revoked', 'ended') then raise exception 'This mandate has ended' using errcode = '22023'; end if;
  if p_status = 'active' and public.is_suspended(v_actor) then raise exception 'account is suspended' using errcode = '42501'; end if;
  -- AG-7 (R-agentmode): resuming is starting again; only under Act.
  if p_status = 'active' and (select p.agent_mode from public.profiles p where p.id = v_actor) is distinct from 'act' then
    raise exception 'Your agent is set to Off or Suggest in Settings' using errcode = 'AG009';
  end if;
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


-- 3. The worker.
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
    -- AG-7 (R-agentmode): the owner's agent is set below Act. Saving that
    -- revoked their mandates; a job that outlived it has nothing to do.
    if (select p.agent_mode from public.profiles p where p.id = v_mandate.owner_id) is distinct from 'act' then
      update public.agent_jobs set status = 'cancelled', lease_id = null, lease_expires_at = null, finished_at = now(),
        last_error = 'agent set below act'
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
  -- AG-7 (R-agentmode): the owner's lock, shared, before the mandate. Saving
  -- Off or Suggest takes it exclusively, so it waits for a write already
  -- past this check, and a write after it sees the new mode.
  perform pg_advisory_xact_lock_shared(public.agent_member_lock_key(v_task.owner_id));
  if (select p.agent_mode from public.profiles p where p.id = v_task.owner_id) is distinct from 'act' then
    raise exception 'The owner set their agent below Act' using errcode = 'AG003';
  end if;
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


-- Settings → Agent. The member's own mode, and below Act the end of every
-- live mandate, atomically.
create or replace function public.agent_mode_set(p_mode text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_actor uuid := auth.uid();
  v_mandate record;
  v_task uuid;
  v_revoked integer := 0;
begin
  if v_actor is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  if p_mode is null or p_mode not in ('off', 'suggest', 'act') then raise exception 'Invalid agent mode' using errcode = '22023'; end if;
  -- Exclusive: waits for every agent write and mandate start holding the
  -- member's lock; none starts until this commits.
  perform pg_advisory_xact_lock(public.agent_member_lock_key(v_actor));
  update public.profiles set agent_mode = p_mode where id = v_actor;
  if not found then raise exception 'Not found' using errcode = 'P0002'; end if;
  if p_mode <> 'act' then
    -- After the member in the lock order: no listing lock here (see header).
    for v_mandate in
      select m.id, m.version from public.agent_mandates m
      where m.owner_id = v_actor and m.status in ('active', 'paused')
      order by m.id
      for update
    loop
      update public.agent_mandates set status = 'revoked', ended_at = now(), updated_at = now() where id = v_mandate.id;
      select id into v_task from public.agent_tasks where mandate_id = v_mandate.id and finished_at is null for update;
      if v_task is not null then
        update public.agent_tasks set status = 'cancelled', outcome = 'agent set to ' || p_mode || ' by owner'
        where id = v_task and finished_at is null;
        update public.agent_approvals set status = 'dismissed', decided_at = now() where task_id = v_task and status = 'pending';
        insert into public.agent_events(owner_id, task_id, mandate_id, mandate_version, kind, initiated_by, result)
        values (v_actor, v_task, v_mandate.id, v_mandate.version, 'status', 'owner',
          jsonb_build_object('mandate_status', 'revoked', 'agent_mode', p_mode));
      end if;
      v_revoked := v_revoked + 1;
    end loop;
  end if;
  return jsonb_build_object('mode', p_mode, 'revoked', v_revoked);
end;
$function$;

revoke all on function public.agent_mode_set(text) from public, anon, service_role;
grant execute on function public.agent_mode_set(text) to authenticated;

-- The column is written only through agent_mode_set, so Off always ends
-- what was running (20261107170000 granted a direct update).
revoke update (agent_mode) on public.profiles from authenticated;

commit;
