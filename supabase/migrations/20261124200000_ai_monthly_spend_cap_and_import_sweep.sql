-- ============================================================================
-- 20261124200000 — a monthly ceiling on model spend, and the import sweep as
-- two statements
--
-- Listing import is on at launch (Neil, 24 November 2026), so the model key
-- is present and every import, and every mod added from a shop link, calls
-- the model. The caps so far were per day: $2 a member and $50 for everyone,
-- which allows $1,500 in a month. Neil's ruling: $50 a month for now, and
-- adjustable in the admin console.
--
--   * public.agent_spend_limits.global_monthly_usd (default 50.00): the most
--     every feature together may spend in a calendar month (UTC).
--   * public.agent_spend_reserve: refuses a call that would pass it, counted
--     as the daily caps are (used plus held), and queues one alert for the
--     month the first time it does. The daily checks are unchanged.
--   * public.agent_spend_allowed: also reports the month's spend and cap,
--     for the console.
--   * public.admin_set_agent_spend_limits: takes the monthly cap as a fourth,
--     optional argument (null leaves it as it is), so the app before this
--     change still saves the two daily caps. Same step-up and audit.
--   * public.expire_stale_listing_imports, public.scrub_expired_listing_imports:
--     the nightly import sweep as one statement each. The route read rows 200
--     at a time and updated them one request each, up to 10,000 requests a
--     run. Rows another transaction holds are skipped and taken next night.
--
-- No row is changed: the new column takes its default.
-- ============================================================================

alter table public.agent_spend_limits
  add column global_monthly_usd numeric(10,2) not null default 50.00;
alter table public.agent_spend_limits
  add constraint agent_spend_limits_global_monthly_usd_check check (global_monthly_usd >= 0);
comment on column public.agent_spend_limits.global_monthly_usd is 'The most every model feature together may spend in a calendar month (UTC), in dollars. Changed in the admin console (20261124200000).';

CREATE OR REPLACE FUNCTION public.agent_spend_reserve(p_owner uuid, p_feature text, p_amount_usd numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_limits public.agent_spend_limits;
  v_day timestamptz := date_trunc('day', now() at time zone 'utc') at time zone 'utc';
  v_member numeric;
  v_global numeric;
  v_hold uuid;
  -- 20261124200000
  v_month timestamptz := date_trunc('month', now() at time zone 'utc') at time zone 'utc';
  v_month_total numeric;
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

  -- 20261124200000: the month's ceiling, everyone's, over every feature that
  -- calls the model. Counted the same way as the day's: what was used since
  -- the first of the month (UTC) plus every hold still open. The first
  -- refusal of a month tells the operators, once, because from then until
  -- the cap is raised or the month ends no member's import or chat reaches
  -- the model.
  select
    coalesce((select sum(u.cost_usd) from public.agent_usage u where u.created_at >= v_month), 0)
      + coalesce((select sum(h.amount_usd) from public.agent_spend_holds h where h.created_at >= v_month), 0)
  into v_month_total;
  if v_month_total + p_amount_usd > v_limits.global_monthly_usd then
    insert into public.admin_alert_outbox(kind, title, detail, payload, dedup_key, status)
    values (
      'ai_month_cap_reached',
      'The month''s model spend limit has been reached',
      'Listing import and anything else that calls the model is refused until the limit is raised (Admin, Agent, Model spend) or the month ends. Spent or held this month: $'
        || to_char(v_month_total, 'FM999990.00') || ' of $' || to_char(v_limits.global_monthly_usd, 'FM999990.00') || '.',
      jsonb_build_object('month_usd', v_month_total, 'month_cap', v_limits.global_monthly_usd),
      'ai-month-cap:' || to_char(v_month, 'YYYY-MM'),
      'pending'
    ) on conflict (dedup_key) do nothing;
    return jsonb_build_object('allowed', false, 'reason', 'spend_cap', 'period', 'month',
      'month_usd', v_month_total, 'month_cap', v_limits.global_monthly_usd);
  end if;

  insert into public.agent_spend_holds(owner_id, feature, amount_usd)
  values (p_owner, p_feature, p_amount_usd)
  returning id into v_hold;
  return jsonb_build_object('allowed', true, 'hold', v_hold);
end;
$function$;

CREATE OR REPLACE FUNCTION public.agent_spend_allowed(p_owner uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  with lim as (select per_member_daily_usd, global_daily_usd, global_monthly_usd from public.agent_spend_limits where singleton),
  today as (
    select coalesce(sum(cost_usd) filter (where owner_id = p_owner), 0) as member_usd, coalesce(sum(cost_usd), 0) as global_usd
    from public.agent_usage where created_at >= date_trunc('day', now() at time zone 'utc') at time zone 'utc'
  ),
  -- 20261124200000
  month as (
    select coalesce(sum(cost_usd), 0) as month_usd
    from public.agent_usage where created_at >= date_trunc('month', now() at time zone 'utc') at time zone 'utc'
  )
  select jsonb_build_object(
    'allowed', today.member_usd < lim.per_member_daily_usd and today.global_usd < lim.global_daily_usd
               and month.month_usd < lim.global_monthly_usd,
    'member_usd', today.member_usd, 'global_usd', today.global_usd, 'month_usd', month.month_usd,
    'member_cap', lim.per_member_daily_usd, 'global_cap', lim.global_daily_usd, 'month_cap', lim.global_monthly_usd)
  from lim, today, month;
$function$;

drop function public.admin_set_agent_spend_limits(numeric, numeric, text);

CREATE FUNCTION public.admin_set_agent_spend_limits(p_member_usd numeric, p_global_usd numeric, p_reason text, p_monthly_usd numeric DEFAULT NULL::numeric)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
  -- 20261124200000: the month's cap. Null leaves it as it is.
  if p_monthly_usd is not null and (p_monthly_usd < 0 or p_monthly_usd > 100000) then
    raise exception 'The monthly cap must be zero or more' using errcode = '22023';
  end if;
  update public.agent_spend_limits set per_member_daily_usd = p_member_usd, global_daily_usd = p_global_usd,
    global_monthly_usd = coalesce(p_monthly_usd, global_monthly_usd),
    changed_by = v_actor, changed_at = now() where singleton;
  insert into public.admin_audit_log(actor_id, action, subject_type, subject_id, reason, metadata)
  values (v_actor, 'agent.spend_limits', 'agent', gen_random_uuid(), btrim(p_reason),
    jsonb_build_object('per_member_daily_usd', p_member_usd, 'global_daily_usd', p_global_usd,
      'global_monthly_usd', (select global_monthly_usd from public.agent_spend_limits where singleton)));
end;
$function$;

revoke all on function public.admin_set_agent_spend_limits(numeric, numeric, text, numeric) from public, anon;
grant execute on function public.admin_set_agent_spend_limits(numeric, numeric, text, numeric) to authenticated, service_role;

CREATE FUNCTION public.expire_stale_listing_imports(p_limit integer DEFAULT 5000)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_moved integer;
begin
  -- Every state but the two final ones may move to 'expired'
  -- (guard_listing_import_status), so one statement is always a legal one.
  -- A row whose step is running right now is locked and left for next time.
  with due as (
    select i.id from public.listing_imports i
    where i.status not in ('consumed', 'expired') and i.expires_at < now()
    order by i.expires_at
    limit greatest(least(coalesce(p_limit, 5000), 20000), 1)
    for update skip locked
  )
  update public.listing_imports i set status = 'expired', updated_at = now()
  from due where i.id = due.id;
  get diagnostics v_moved = row_count;
  return v_moved;
end;
$function$;

CREATE FUNCTION public.scrub_expired_listing_imports(p_limit integer DEFAULT 5000)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_cleared integer;
begin
  -- Imported text can carry a phone number, a handle, an address. Seven days
  -- after an import finished, failed or expired, what was copied is cleared;
  -- the row keeps where it came from, its status and its error code.
  with stale as (
    select i.id from public.listing_imports i
    where i.status in ('consumed', 'expired', 'failed')
      and i.updated_at < now() - interval '7 days'
      and i.normalized_source is not null
    limit greatest(least(coalesce(p_limit, 5000), 20000), 1)
    for update skip locked
  )
  update public.listing_imports i
  set normalized_source = null, extracted = null, imported_images = null, updated_at = now()
  from stale where i.id = stale.id;
  get diagnostics v_cleared = row_count;
  return v_cleared;
end;
$function$;

revoke all on function public.expire_stale_listing_imports(integer) from public, anon, authenticated;
revoke all on function public.scrub_expired_listing_imports(integer) from public, anon, authenticated;
grant execute on function public.expire_stale_listing_imports(integer) to service_role;
grant execute on function public.scrub_expired_listing_imports(integer) to service_role;
