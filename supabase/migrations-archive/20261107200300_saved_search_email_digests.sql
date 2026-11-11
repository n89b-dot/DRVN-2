-- 20261107200300 — saved-search email digests: at most one a day per search.
--
-- Production-readiness review, 3 Nov 2026, N78 (OS-W35). Neil ruled on 7 Nov
-- that saved-search alerts get at most one email per saved search per day, as
-- a digest. There was no saved-search email at all: /api/jobs/saved-searches
-- raises in-app notifications only, and src/lib/notifications/deliver.ts has
-- that one channel. This adds the email channel as an outbox.
--
-- 1. saved_search_email_cursors: each alerting search's own email window,
--    independent of the half-hourly in-app cursor (saved_searches.
--    last_checked_at). Turning an alert on (or saving one with it on) starts
--    the window then, so nobody is mailed about inventory from before they
--    asked; existing alerting searches start now.
-- 2. saved_search_email_digests: the outbox. UNIQUE (saved_search_id,
--    digest_day) is the once-a-day rule, on the Europe/London calendar day.
--    A digest's content (search name, link, match count, up to five parts) is
--    frozen when it is admitted, so a retry sends the same email.
-- 3. admit_saved_search_digest moves the window and writes the digest in one
--    transaction, compare-and-set on the window's start: a crash before it
--    changes nothing (the next run redoes the same window), a replay after it
--    is a no-op ('stale'), and a second admission the same day is refused
--    ('already_today'), so matches are neither lost nor mailed twice. Muted
--    recipients (the 'saved_searches' or 'saved_search_emails' preference
--    off, read exactly as src/lib/notification-prefs.ts prefEnabled does) and
--    windows with no matches move the window without writing a digest.
-- 4. claim_saved_search_digests leases the day's pending digests with the
--    recipient's confirmed address read from auth.users at send time (never
--    stored), re-checking the preference, the alert and the account first;
--    complete_saved_search_digest records the outcome, fenced by the attempt
--    number, retrying with backoff up to five attempts.
--    saved_search_digest_sweep expires what was not sent on its day (so a
--    late retry never makes a second email that day) and prunes after 90 days.
-- 5. drvn-saved-search-digests runs /api/jobs/saved-search-digests hourly
--    (worker family savedSearchDigests). Windows are admitted from 08:00
--    London, once a day; the other runs retry sends. With no email provider
--    configured the route records digests and sends nothing (it says so in
--    its log and response).
--
-- Money rules are unchanged: nothing here touches money. Idempotent.

begin;

-- ---------------------------------------------------------------------------
-- The digest day
-- ---------------------------------------------------------------------------
create or replace function private.saved_search_digest_day(p_at timestamptz)
returns date
language sql
stable
set search_path = public, pg_temp
as $$ select (p_at at time zone 'Europe/London')::date $$;
revoke all on function private.saved_search_digest_day(timestamptz) from public, anon, authenticated;

-- Whether the member wants saved-search email: both the in-app kind's
-- preference and the email one, each on unless it is exactly false
-- (prefEnabled in src/lib/notification-prefs.ts). No profile, no email.
create or replace function private.saved_search_emails_enabled(p_user uuid)
returns boolean
language sql
stable
set search_path = public, pg_temp
as $$
  select coalesce((
    select (p.notification_prefs -> 'saved_searches') is distinct from 'false'::jsonb
       and (p.notification_prefs -> 'saved_search_emails') is distinct from 'false'::jsonb
    from public.profiles p where p.id = p_user), false)
$$;
revoke all on function private.saved_search_emails_enabled(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 1. Each search's email window
-- ---------------------------------------------------------------------------
create table if not exists public.saved_search_email_cursors (
  saved_search_id uuid primary key references public.saved_searches (id) on delete cascade,
  checked_through timestamptz not null,
  updated_at timestamptz not null default now()
);
alter table public.saved_search_email_cursors enable row level security;
revoke all on public.saved_search_email_cursors from public, anon, authenticated;
grant all on public.saved_search_email_cursors to service_role;

-- An alert switched on starts its email window at that moment.
create or replace function public.saved_search_email_window_start()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.alert and (tg_op = 'INSERT' or not old.alert) then
    insert into public.saved_search_email_cursors (saved_search_id, checked_through)
    values (new.id, now())
    on conflict (saved_search_id) do update set checked_through = excluded.checked_through, updated_at = now();
  end if;
  return null;
end;
$$;
revoke all on function public.saved_search_email_window_start() from public, anon, authenticated;

drop trigger if exists saved_search_email_window_start on public.saved_searches;
create trigger saved_search_email_window_start
  after insert or update of alert on public.saved_searches
  for each row execute function public.saved_search_email_window_start();

insert into public.saved_search_email_cursors (saved_search_id, checked_through)
select s.id, now() from public.saved_searches s where s.alert
on conflict (saved_search_id) do nothing;

-- ---------------------------------------------------------------------------
-- 2. The outbox
-- ---------------------------------------------------------------------------
create table if not exists public.saved_search_email_digests (
  id uuid primary key default gen_random_uuid(),
  saved_search_id uuid not null references public.saved_searches (id) on delete cascade,
  digest_day date not null,
  window_start timestamptz not null,
  window_end timestamptz not null,
  search_name text not null,
  href text not null,
  match_count integer not null,
  items jsonb not null default '[]'::jsonb,
  status text not null default 'pending',
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  skip_reason text,
  last_error text,
  provider_message_id text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint saved_search_email_digests_once_a_day unique (saved_search_id, digest_day),
  constraint saved_search_email_digests_window check (window_end > window_start),
  constraint saved_search_email_digests_matches check (match_count > 0),
  constraint saved_search_email_digests_items check (jsonb_typeof(items) = 'array' and jsonb_array_length(items) between 1 and 10),
  constraint saved_search_email_digests_href check (href ~ '^/marketplace([/?]|$)'),
  constraint saved_search_email_digests_status check (status in ('pending', 'sending', 'sent', 'skipped', 'failed')),
  constraint saved_search_email_digests_skip_reason check (
    (status = 'skipped') = (skip_reason is not null)
    and (skip_reason is null or skip_reason in ('opted_out', 'alert_off', 'no_address', 'account_closed', 'expired')))
);
alter table public.saved_search_email_digests enable row level security;
revoke all on public.saved_search_email_digests from public, anon, authenticated;
grant all on public.saved_search_email_digests to service_role;

create index if not exists saved_search_email_digests_due_idx
  on public.saved_search_email_digests (next_attempt_at) where status in ('pending', 'sending');
create index if not exists saved_search_email_digests_created_idx
  on public.saved_search_email_digests (created_at);

-- ---------------------------------------------------------------------------
-- 3. Admission
-- ---------------------------------------------------------------------------
-- Alerting searches whose email window is due: never started (a defensive
-- baseline; the trigger normally starts it), or last moved on an earlier
-- London day once it is 08:00 there. window_end is the database's clock,
-- the same clock that stamps listings.published_at; the worker queries
-- (checked_through, window_end] and admits that exact window.
create or replace function public.saved_search_digests_due(p_limit integer default 200)
returns table(saved_search_id uuid, user_id uuid, params jsonb, checked_through timestamptz, window_end timestamptz)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select s.id, s.user_id, s.params, c.checked_through, now()
  from public.saved_searches s
  left join public.saved_search_email_cursors c on c.saved_search_id = s.id
  where s.alert
    and (c.saved_search_id is null
         or (private.saved_search_digest_day(c.checked_through) < private.saved_search_digest_day(now())
             and extract(hour from now() at time zone 'Europe/London') >= 8))
  order by c.checked_through nulls first, s.id
  limit least(greatest(coalesce(p_limit, 200), 1), 500)
$$;
revoke all on function public.saved_search_digests_due(integer) from public, anon, authenticated;
grant execute on function public.saved_search_digests_due(integer) to service_role;

-- Outcomes: 'baseline' (window started, nothing mailed), 'admitted' (digest
-- written, window moved), 'empty' / 'muted' (window moved, no digest),
-- 'already_today' (the window already moved today), 'stale' (the window is
-- not where the caller read it: another run or a replay got there first),
-- 'alert_off', 'gone'. Only 'baseline', 'admitted', 'empty' and 'muted'
-- change anything.
-- p_expected_through is where the caller read the window starting, null
-- when it read none (a baseline).
create or replace function public.admit_saved_search_digest(
  p_saved_search_id uuid,
  p_window_end timestamptz,
  p_match_count integer,
  p_items jsonb,
  p_href text,
  p_expected_through timestamptz default null
) returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_search record;
  v_through timestamptz;
  v_today date := private.saved_search_digest_day(now());
  v_id uuid;
begin
  if p_window_end is null or p_window_end > now() then
    raise exception 'Invalid digest window' using errcode = '22023';
  end if;
  if p_match_count is null or p_match_count < 0 then
    raise exception 'Invalid match count' using errcode = '22023';
  end if;

  -- The search row serialises admissions for it.
  select s.id, s.user_id, s.name, s.alert into v_search
  from public.saved_searches s where s.id = p_saved_search_id for update;
  if not found then return 'gone'; end if;
  if not v_search.alert then return 'alert_off'; end if;

  select c.checked_through into v_through
  from public.saved_search_email_cursors c where c.saved_search_id = p_saved_search_id for update;
  if not found then
    if p_expected_through is not null then return 'stale'; end if;
    insert into public.saved_search_email_cursors (saved_search_id, checked_through)
    values (p_saved_search_id, p_window_end);
    return 'baseline';
  end if;

  if p_expected_through is null or v_through <> p_expected_through then return 'stale'; end if;
  if p_window_end <= v_through then return 'stale'; end if;
  if private.saved_search_digest_day(v_through) >= v_today then return 'already_today'; end if;

  if p_match_count > 0 and private.saved_search_emails_enabled(v_search.user_id) then
    insert into public.saved_search_email_digests
      (saved_search_id, digest_day, window_start, window_end, search_name, href, match_count, items)
    values
      (p_saved_search_id, v_today, v_through, p_window_end, v_search.name, p_href, p_match_count, p_items)
    on conflict (saved_search_id, digest_day) do nothing
    returning id into v_id;
    -- Unreachable while the window moves with every admission; kept so the
    -- window never moves past matches that were not written.
    if v_id is null then return 'already_today'; end if;
  end if;

  update public.saved_search_email_cursors
     set checked_through = p_window_end, updated_at = now()
   where saved_search_id = p_saved_search_id;

  return case when p_match_count = 0 then 'empty' when v_id is null then 'muted' else 'admitted' end;
end;
$$;
revoke all on function public.admit_saved_search_digest(uuid, timestamptz, integer, jsonb, text, timestamptz) from public, anon, authenticated;
grant execute on function public.admit_saved_search_digest(uuid, timestamptz, integer, jsonb, text, timestamptz) to service_role;

-- ---------------------------------------------------------------------------
-- 4. Sending
-- ---------------------------------------------------------------------------
-- Every run, provider or not: a digest not sent on its own day is skipped as
-- 'expired' (a retry tomorrow would be a second email that day), and records
-- older than 90 days go.
create or replace function public.saved_search_digest_sweep()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_expired integer;
  v_pruned integer;
begin
  update public.saved_search_email_digests d
     set status = 'skipped', skip_reason = 'expired', updated_at = now()
   where d.status in ('pending', 'sending')
     and d.next_attempt_at <= now()
     and d.digest_day < private.saved_search_digest_day(now());
  get diagnostics v_expired = row_count;
  delete from public.saved_search_email_digests d where d.created_at < now() - interval '90 days';
  get diagnostics v_pruned = row_count;
  return jsonb_build_object('expired', v_expired, 'pruned', v_pruned);
end;
$$;
revoke all on function public.saved_search_digest_sweep() from public, anon, authenticated;
grant execute on function public.saved_search_digest_sweep() to service_role;

-- Leases up to p_limit of today's due digests (pending, or a send whose lease
-- ran out after a crash) for p_lease_seconds. Each is re-checked first: the
-- alert still on, the preference still on, the account open, a confirmed
-- address. One that fails a check is skipped with the reason, not returned.
-- A digest whose fifth attempt's lease ran out is failed, not retried.
create or replace function public.claim_saved_search_digests(p_limit integer default 50, p_lease_seconds integer default 300)
returns table(digest_id uuid, attempt integer, recipient text, search_name text, href text, match_count integer, items jsonb, digest_day date)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_row record;
  v_reason text;
  v_email text;
  v_attempt integer;
  v_lease interval := make_interval(secs => least(greatest(coalesce(p_lease_seconds, 300), 30), 3600));
begin
  update public.saved_search_email_digests d
     set status = 'failed', last_error = coalesce(d.last_error, 'send lease expired'), updated_at = now()
   where d.status = 'sending' and d.next_attempt_at <= now() and d.attempts >= 5;

  for v_row in
    select d.id, d.search_name, d.href, d.match_count, d.items, d.digest_day,
           s.alert, s.user_id, p.suspended_at
    from public.saved_search_email_digests d
    join public.saved_searches s on s.id = d.saved_search_id
    left join public.profiles p on p.id = s.user_id
    where d.status in ('pending', 'sending')
      and d.next_attempt_at <= now()
      and d.digest_day = private.saved_search_digest_day(now())
    order by d.next_attempt_at, d.id
    limit least(greatest(coalesce(p_limit, 50), 1), 200)
    for update of d skip locked
  loop
    v_email := null;
    select u.email into v_email from auth.users u
    where u.id = v_row.user_id and u.confirmed_at is not null and nullif(btrim(u.email), '') is not null;

    v_reason := case
      when not v_row.alert then 'alert_off'
      when v_row.suspended_at is not null
        or exists (select 1 from public.account_deletion_requests r where r.user_id = v_row.user_id) then 'account_closed'
      when not private.saved_search_emails_enabled(v_row.user_id) then 'opted_out'
      when v_email is null then 'no_address'
    end;

    if v_reason is not null then
      update public.saved_search_email_digests
         set status = 'skipped', skip_reason = v_reason, updated_at = now()
       where id = v_row.id;
      continue;
    end if;

    update public.saved_search_email_digests
       set status = 'sending', attempts = attempts + 1, next_attempt_at = now() + v_lease, updated_at = now()
     where id = v_row.id
    returning attempts into v_attempt;

    digest_id := v_row.id;
    attempt := v_attempt;
    recipient := v_email;
    search_name := v_row.search_name;
    href := v_row.href;
    match_count := v_row.match_count;
    items := v_row.items;
    digest_day := v_row.digest_day;
    return next;
  end loop;
end;
$$;
revoke all on function public.claim_saved_search_digests(integer, integer) from public, anon, authenticated;
grant execute on function public.claim_saved_search_digests(integer, integer) to service_role;

-- Records one attempt's outcome: 'sent', 'retry' (back to pending after
-- 10, 20, 40, 80 minutes; failed after the fifth attempt) or 'rejected'
-- (failed). Only the attempt that holds the lease may record: anything else
-- (a replay, or an attempt whose lease ran out and was claimed again) gets
-- 'stale' and changes nothing. Returns the digest's new status.
create or replace function public.complete_saved_search_digest(
  p_id uuid,
  p_attempt integer,
  p_outcome text,
  p_provider_message_id text default null,
  p_error text default null
) returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_status text;
begin
  if p_outcome is null or p_outcome not in ('sent', 'retry', 'rejected') then
    raise exception 'Unknown digest outcome' using errcode = '22023';
  end if;
  update public.saved_search_email_digests d
     set status = case
                    when p_outcome = 'sent' then 'sent'
                    when p_outcome = 'retry' and d.attempts < 5 then 'pending'
                    else 'failed' end,
         sent_at = case when p_outcome = 'sent' then now() end,
         provider_message_id = case when p_outcome = 'sent' then left(nullif(btrim(p_provider_message_id), ''), 200) end,
         last_error = case when p_outcome = 'sent' then d.last_error else left(nullif(btrim(p_error), ''), 300) end,
         next_attempt_at = case
                             when p_outcome = 'retry' and d.attempts < 5
                               then now() + interval '10 minutes' * power(2, d.attempts - 1)
                             else now() end,
         updated_at = now()
   where d.id = p_id and d.status = 'sending' and d.attempts = p_attempt
  returning d.status into v_status;
  return coalesce(v_status, 'stale');
end;
$$;
revoke all on function public.complete_saved_search_digest(uuid, integer, text, text, text) from public, anon, authenticated;
grant execute on function public.complete_saved_search_digest(uuid, integer, text, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- 5. The schedule
-- ---------------------------------------------------------------------------
-- Latest: 20261026100000_agent_hosted_schedule.sql. Changed: the
-- 'saved-search-digests' family.
create or replace function public.invoke_remediation_worker(p_family text) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare base text; secret text;
begin
 if p_family not in ('search','account-deletions','media-gc','saved-searches','listing-imports','agent','saved-search-digests') then raise exception 'Unknown worker family'; end if;
 select value into base from public.job_config where key='transfer_worker_url';
 select value into secret from public.job_config where key='transfer_worker_secret';
 if base is null or secret is null then return; end if;
 if base !~ '/api/jobs/transfers$' then raise exception 'Invalid transfer worker URL'; end if;
 perform net.http_post(url:=regexp_replace(base,'/transfers$','/'||p_family),headers:=jsonb_build_object('Authorization','Bearer '||secret,'Content-Type','application/json'),body:='{}'::jsonb,timeout_milliseconds:=60000);
end $$;
revoke all on function public.invoke_remediation_worker(text) from public,anon,authenticated;
grant execute on function public.invoke_remediation_worker(text) to service_role;

-- Latest: 20261107191000_job_inventory_health.sql. Changed: the
-- drvn-saved-search-digests row.
create or replace function private.scheduled_job_inventory()
returns table(job text, schedule text, command text, families text[], budget interval)
language sql
immutable
set search_path = public, pg_temp
as $$
  values
    ('drvn-agent-worker', '*/5 * * * *', 'select public.invoke_remediation_worker(''agent'');', array['agent'], interval '30 minutes'),
    ('drvn-cron-history-prune', '27 4 * * *', 'select private.prune_cron_history();', array[]::text[], interval '26 hours'),
    ('drvn-deletion-worker', '*/5 * * * *', 'select public.invoke_remediation_worker(''account-deletions'');', array['deletions'], interval '30 minutes'),
    ('drvn-delivery-auto-confirm', '23 * * * *', 'select public.auto_confirm_untracked_deliveries();', array['deliveryAutoConfirm'], interval '3 hours'),
    ('drvn-dispute-sla', '5 8 * * *', 'select public.escalate_stale_disputes();', array[]::text[], interval '26 hours'),
    ('drvn-explore-builders', '*/10 * * * *', 'select public.refresh_explore_builders();', array[]::text[], interval '30 minutes'),
    ('drvn-explore-trending', '*/2 * * * *', 'select public.refresh_explore_trending();', array[]::text[], interval '30 minutes'),
    ('drvn-grow-products', '17 * * * *', 'select public.grow_products()', array[]::text[], interval '3 hours'),
    ('drvn-grow-products-full', '47 4 * * *', 'select public.grow_products(true)', array[]::text[], interval '26 hours'),
    ('drvn-listing-edit-sweep', '45 3 * * *', 'select public.prune_listing_edit_requests();', array[]::text[], interval '26 hours'),
    ('drvn-listing-import-sweep', '37 3 * * *', 'select public.invoke_remediation_worker(''listing-imports'');', array['listingImports'], interval '26 hours'),
    ('drvn-marketplace-counts', '30 seconds', 'select public.refresh_marketplace_facet_counts();', array[]::text[], interval '10 minutes'),
    ('drvn-media-gc', '17 3 * * *', 'select public.invoke_remediation_worker(''media-gc'');', array['media'], interval '26 hours'),
    ('drvn-prune-rate-limits', '15 3 * * *', 'select public.prune_rate_limits();', array[]::text[], interval '26 hours'),
    ('drvn-release-reservations', '*/5 * * * *', 'select public.release_expired_reservations();', array[]::text[], interval '30 minutes'),
    ('drvn-saved-search-digests', '41 * * * *', 'select public.invoke_remediation_worker(''saved-search-digests'');', array['savedSearchDigests'], interval '3 hours'),
    ('drvn-saved-search-worker', '*/30 * * * *', 'select public.invoke_remediation_worker(''saved-searches'');', array['savedSearches'], interval '90 minutes'),
    ('drvn-search-words', '23 * * * *', 'select public.refresh_search_words();', array[]::text[], interval '3 hours'),
    ('drvn-search-worker', '*/2 * * * *', 'select public.invoke_remediation_worker(''search'');', array['search'], interval '30 minutes'),
    ('drvn-transfer-worker', '*/10 * * * *', 'select public.mark_due_transfer_intents(); select public.invoke_transfer_worker();',
      array['expiries','captures','transfers','transferReconciliation','refunds','labelVoids','returns','disputes','alerts','receipts','analytics'],
      interval '30 minutes')
$$;
revoke all on function private.scheduled_job_inventory() from public, anon, authenticated;

do $$
declare
  j record;
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    for j in select jobid from cron.job where jobname = 'drvn-saved-search-digests' loop
      perform cron.unschedule(j.jobid);
    end loop;
    perform cron.schedule('drvn-saved-search-digests', '41 * * * *', $job$select public.invoke_remediation_worker('saved-search-digests');$job$);
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Self-check
-- ---------------------------------------------------------------------------
do $$
declare
  missing text;
begin
  if not exists (select 1 from pg_constraint where conname = 'saved_search_email_digests_once_a_day'
                   and conrelid = 'public.saved_search_email_digests'::regclass and contype = 'u') then
    raise exception 'SELF-CHECK FAILED: digests are not unique per search per day';
  end if;
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    select string_agg(i.job, ', ') into missing from private.scheduled_job_inventory() i
    where not exists (select 1 from cron.job j where j.jobname = i.job and j.schedule = i.schedule
                        and private.normalized_sql(j.command) = private.normalized_sql(i.command));
    if missing is not null then raise exception 'SELF-CHECK FAILED: inventory jobs not scheduled as listed: %', missing; end if;
    select string_agg(j.jobname, ', ') into missing from cron.job j
    where j.jobname like 'drvn-%' and not exists (select 1 from private.scheduled_job_inventory() i where i.job = j.jobname);
    if missing is not null then raise exception 'SELF-CHECK FAILED: scheduled jobs missing from the inventory: %', missing; end if;
  end if;
end $$;

notify pgrst, 'reload schema';
commit;
