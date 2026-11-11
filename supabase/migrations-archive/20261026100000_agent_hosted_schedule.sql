-- 20261026100000 — the agent runs on a hosted project, and four hardenings.
--
-- Release readiness report two (24 Oct 2026), issues 62, 68, 70, 87 and 54:
--
-- 1. /api/jobs/agent had no hosted schedule, and invoke_remediation_worker
--    knew five families, so an operator could not even add one by hand. The
--    'agent' family joins the list and drvn-agent-worker calls it every five
--    minutes (production-runbook.md §13d). The route records each pass as the
--    'agent' worker family, so worker_health_snapshot and the independent
--    monitor see it like every other worker.
-- 2. The beta steps gated the UI only: agent_mandate_set now refuses a new or
--    changed mandate while its side's step is closed (agent_beta_steps). A
--    paused mandate may still be resumed or turned off, as the runbook says
--    ("mandates already set stay").
-- 3. admin_open_agent_chat required step-up but not the admin role; a viewer
--    with an authenticator could read a member's chat. It now needs
--    admin_role() = 'admin' like the other admin agent functions.
-- 4. offer_accept_begin was the one definer in the money path with
--    search_path = public alone; it gets pg_temp like the rest.
-- 5. private.listing_edit_requests rows were only pruned when the same
--    seller edited again; a daily sweep removes rows older than seven days.
--
-- Idempotent.

begin;

-- ---------------------------------------------------------------------------
-- 1. The agent's hosted schedule
-- ---------------------------------------------------------------------------
-- Latest: 20261004150000. Changed: the 'agent' family.
create or replace function public.invoke_remediation_worker(p_family text) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare base text; secret text;
begin
 if p_family not in ('search','account-deletions','media-gc','saved-searches','listing-imports','agent') then raise exception 'Unknown worker family'; end if;
 select value into base from public.job_config where key='transfer_worker_url';
 select value into secret from public.job_config where key='transfer_worker_secret';
 if base is null or secret is null then return; end if;
 if base !~ '/api/jobs/transfers$' then raise exception 'Invalid transfer worker URL'; end if;
 perform net.http_post(url:=regexp_replace(base,'/transfers$','/'||p_family),headers:=jsonb_build_object('Authorization','Bearer '||secret,'Content-Type','application/json'),body:='{}'::jsonb,timeout_milliseconds:=60000);
end $$;
revoke all on function public.invoke_remediation_worker(text) from public,anon,authenticated;
grant execute on function public.invoke_remediation_worker(text) to service_role;

do $$
declare
  j record;
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    for j in select jobid from cron.job where jobname = 'drvn-agent-worker' loop
      perform cron.unschedule(j.jobid);
    end loop;
    perform cron.schedule('drvn-agent-worker', '*/5 * * * *', $job$select public.invoke_remediation_worker('agent');$job$);
  end if;
end $$;

-- Latest: 20261006100100. Changed: the agent family, on a 30-minute budget
-- (it runs every five minutes).
create or replace function public.worker_health_snapshot() returns jsonb
language sql security definer set search_path=public,pg_temp as $$
 with families(family,budget) as (values
 ('expiries',interval '30 minutes'),('captures',interval '30 minutes'),
 ('transfers',interval '30 minutes'),('transferReconciliation',interval '30 minutes'),
 ('refunds',interval '30 minutes'),('labelVoids',interval '30 minutes'),
 ('returns',interval '30 minutes'),('disputes',interval '30 minutes'),
 ('alerts',interval '30 minutes'),('receipts',interval '30 minutes'),
 ('analytics',interval '30 minutes'),('search',interval '30 minutes'),
 ('deletions',interval '30 minutes'),('savedSearches',interval '90 minutes'),
 ('media',interval '26 hours'),('listingImports',interval '26 hours'),
 ('deliveryAutoConfirm',interval '3 hours'),('agent',interval '30 minutes')),
 runs as (
 select f.family,f.budget,
 max(r.finished_at) filter(where r.status='succeeded') last_success,
 max(r.finished_at) filter(where r.status='failed') last_failure,
 min(r.started_at) filter(where r.status='running') running_since
 from families f left join public.worker_runs r on r.family=f.family group by f.family,f.budget),
 runnable as (
 select kind,status,next_attempt_at due_at from public.remediation_jobs
 where status='failed' or (status='pending' and next_attempt_at<=now())
 union all select kind,'processing',locked_until from public.remediation_jobs
 where status='processing' and locked_until<=now()
 union all select 'alerts',status,next_attempt_at from public.admin_alert_outbox
 where status='failed' or (status='pending' and next_attempt_at<=now())
 union all select 'transfers',status,greatest(coalesce(available_at,created_at),coalesce(next_attempt_at,created_at))
 from public.transfer_intents where status in ('holding','ready','blocked_unpayable','failed')
 and greatest(coalesce(available_at,created_at),coalesce(next_attempt_at,created_at))<=now()
 union all select 'transfers','processing',lease_expires_at from public.transfer_intents
 where status='processing' and lease_expires_at<=now()
 union all select 'refunds',status,coalesce(next_attempt_at,created_at) from public.refund_operations
 where status in ('requested','provider_pending','provider_succeeded','effects_pending','reversal_pending','failed','recovery_required')
 and coalesce(next_attempt_at,created_at)<=now()
 and coalesce(provider_status,'unknown') not in ('pending','requires_action')
 union all select 'labelVoids',status,
   case when provider_state='submitted' then updated_at+interval '6 hours'
        when status='requested' then updated_at+interval '1 minute'
        else updated_at+interval '15 minutes' end
 from public.outbound_label_void_requests
 where status in ('requested','provider_pending') and
   case when provider_state='submitted' then updated_at+interval '6 hours'
        when status='requested' then updated_at+interval '1 minute'
        else updated_at+interval '15 minutes' end <=now()
 union all select 'financial_recovery','open',created_at from public.payment_recoveries where status='open'
 ), queues as (
 select kind,status,count(*) count,min(due_at) oldest,
 (status in ('failed','recovery_required') or kind='financial_recovery'
   or min(due_at)<now()-interval '30 minutes') overdue
 from runnable group by kind,status)
 select jsonb_build_object('families',(select jsonb_agg(jsonb_build_object(
 'family',family,'last_success',last_success,'last_failure',last_failure,
 'running_since',running_since,'budget_seconds',extract(epoch from budget),
 'stale',coalesce(last_success<now()-budget,true)
   or coalesce(last_failure>last_success,false)
   or coalesce(running_since<now()-interval '6 minutes',false))) from runs),
 'queues',(select coalesce(jsonb_agg(queues),'[]'::jsonb) from queues));
$$;
revoke all on function public.worker_health_snapshot() from public,anon,authenticated;
grant execute on function public.worker_health_snapshot() to service_role;

-- ---------------------------------------------------------------------------
-- 2. The beta step, checked in the database
-- ---------------------------------------------------------------------------
-- Latest: 20261021100100. Changed: the agent_beta_steps check after the
-- suspension check. Everything else is as it was.
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

-- ---------------------------------------------------------------------------
-- 3. Opening a member's chat needs the admin role, not just step-up
-- ---------------------------------------------------------------------------
-- Latest: 20261024100000. Changed: `or public.admin_role() <> 'admin'`.
create or replace function public.admin_open_agent_chat(p_member uuid, p_case_kind text, p_case uuid, p_reason text)
returns table(id uuid, role text, body text, created_at timestamptz)
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

-- ---------------------------------------------------------------------------
-- 4. The accepted-offer checkout function's search path
-- ---------------------------------------------------------------------------
alter function public.offer_accept_begin(uuid, uuid, interval) set search_path = public, pg_temp;

-- ---------------------------------------------------------------------------
-- 5. Listing-edit replay records older than a week are swept daily
-- ---------------------------------------------------------------------------
create or replace function public.prune_listing_edit_requests()
returns integer
language sql
security definer
set search_path = public, pg_temp
as $function$
  with gone as (delete from private.listing_edit_requests where created_at < now() - interval '7 days' returning 1)
  select count(*)::integer from gone;
$function$;

revoke all on function public.prune_listing_edit_requests() from public, anon, authenticated;
grant execute on function public.prune_listing_edit_requests() to service_role;

do $$
declare
  j record;
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    for j in select jobid from cron.job where jobname = 'drvn-listing-edit-sweep' loop
      perform cron.unschedule(j.jobid);
    end loop;
    perform cron.schedule('drvn-listing-edit-sweep', '45 3 * * *', $job$select public.prune_listing_edit_requests();$job$);
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Self-check
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from jsonb_array_elements(public.worker_health_snapshot()->'families') f where f->>'family' = 'agent') then
    raise exception 'SELF-CHECK FAILED: agent missing from worker health';
  end if;
  if exists (select 1 from pg_extension where extname = 'pg_cron')
     and not exists (select 1 from cron.job where jobname = 'drvn-agent-worker' and schedule = '*/5 * * * *') then
    raise exception 'SELF-CHECK FAILED: the agent worker is not scheduled';
  end if;
  if (select p.proconfig::text from pg_proc p where p.oid = 'public.offer_accept_begin(uuid, uuid, interval)'::regprocedure) not like '%pg_temp%' then
    raise exception 'SELF-CHECK FAILED: offer_accept_begin search path';
  end if;
end $$;

notify pgrst, 'reload schema';
commit;
