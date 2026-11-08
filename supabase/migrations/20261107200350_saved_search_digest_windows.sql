-- 20261107200350 — saved-search digest windows: in-flight publications,
-- carried windows and alert restarts (OS-W35 follow-up to 20261107200300).
--
-- Post-merge review of #84 found three ways an admitted window could lose or
-- resend matches. Each is fixed at the database:
--
-- 1. In-flight publications. A window was (checked_through, now()] over
--    listings.published_at, but published_at is the publishing transaction's
--    now(): its START, not its commit. A publication that started at 08:40:59
--    and committed after the 08:41 match query was invisible to that query,
--    and the next window began at 08:41, so it was never mailed. No time
--    margin is provably long enough (a transaction can start, idle, then
--    publish), so windows are now cut on transaction ids instead:
--      * listings.published_xact is the publishing transaction's id
--        (pg_current_xact_id(), as bigint), stamped beside published_at by
--        stamp_listing_published_at and kept with it.
--      * A window is [checked_xact, window_xact) where window_xact is the
--        snapshot xmin when the window closes: every transaction id below it
--        has finished, so any of those publications that committed is
--        visible to the match query that runs after; anything at or above it
--        (in flight, or not yet started) falls into the next window. Each
--        publication is in exactly one window. A long-open transaction
--        holds xmin back, which delays matches to a later window but never
--        drops them.
--      Existing cursors start at this migration's xmin. Listings published
--      before it have no published_xact and are in no window: on hosted
--      projects 20261107200300 and this run in one deploy; on shared dev at
--      most the hours between the two are not mailed (no provider sends
--      there).
-- 2. Carried windows. The sweep expired a digest not sent on its day after
--    its window had moved on, so its matches were lost (with a provider,
--    more due digests than one run could send left the rest to expire). Now
--    the worker drains batches until done or out of time, a retry is never
--    terminal within the day (backoff tops out at an hour; a provider outage
--    of a few hours used to fail the digest at its fifth attempt), and the sweep
--    carries an unsent digest's window into the next one: it rewinds the
--    search's window to the digest's start (skip_reason 'carried'), so the
--    next admission covers both days. Admission waits ('blocked', and not in
--    the due list) while a search has an unsent digest from an earlier day,
--    so a window never moves past matches that were not sent.
--    A carried window reaches back at most 7 days: no match published
--    before midnight (London) seven days before the current day is ever
--    mailed. The due list returns that floor (window_floor) and the worker
--    filters published_at on it; admission and the sweep record a window
--    start no earlier than it. So the first email after a long outage, or
--    after a provider is first configured, covers at most the last 7 days of
--    still-active matches, and older ones drop silently.
--    The floor is also never before the alert was turned on
--    (saved_search_email_cursors.activated_at): an unrelated transaction
--    that stays open pins xmin, so the window turning on can start at an id
--    below a part published, and committed, while the alert was off. The
--    published_at floor keeps that part out.
-- 3. Alert restarts. Turning an alert off now skips its unsent digests in the
--    same statement (skip_reason 'alert_off'), so off and on again before the
--    next claim cannot send the old window.
--
-- Restates, from 20261107200300: saved_search_email_window_start,
-- saved_search_digests_due (new columns: dropped and recreated),
-- admit_saved_search_digest (new argument: dropped and recreated) and
-- saved_search_digest_sweep, claim_saved_search_digests and
-- complete_saved_search_digest. From 20261107153200:
-- stamp_listing_published_at and the listings_published_at trigger.
-- Money rules are unchanged. Idempotent.

begin;

-- The oldest transaction id still running, as of this statement's snapshot.
create or replace function private.snapshot_xmin()
returns bigint
language sql
stable
set search_path = public, pg_temp
as $$ select pg_snapshot_xmin(pg_current_snapshot())::text::bigint $$;
revoke all on function private.snapshot_xmin() from public, anon, authenticated;

-- The oldest publication any window may still mail: midnight in London,
-- seven days before the current London day.
create or replace function private.saved_search_digest_floor()
returns timestamptz
language sql
stable
set search_path = public, pg_temp
as $$ select ((private.saved_search_digest_day(now()) - 7)::timestamp at time zone 'Europe/London') $$;
revoke all on function private.saved_search_digest_floor() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 1. Which transaction published a part
-- ---------------------------------------------------------------------------
alter table public.listings add column if not exists published_xact bigint;

-- Latest: 20261107153200_listing_published_at.sql. Changed: published_xact
-- is stamped and kept exactly where published_at is.
create or replace function public.stamp_listing_published_at()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
begin
  if tg_op = 'INSERT' then
    new.published_at := case when new.status = 'draft' then null else least(new.created_at, now()) end;
    new.published_xact := case when new.status = 'draft' then null else pg_current_xact_id()::text::bigint end;
  elsif old.published_at is not null then
    new.published_at := old.published_at;
    new.published_xact := old.published_xact;
  elsif new.status = 'active' then
    new.published_at := now();
    new.published_xact := pg_current_xact_id()::text::bigint;
  else
    new.published_at := null;
    new.published_xact := null;
  end if;
  return new;
end;
$function$;
revoke all on function public.stamp_listing_published_at() from public, anon, authenticated;

-- Latest: 20261107153200. Changed: a write to published_xact is stamped too.
drop trigger if exists listings_published_at on public.listings;
create trigger listings_published_at
  before insert or update of status, published_at, published_xact on public.listings
  for each row execute function public.stamp_listing_published_at();

alter table public.saved_search_email_cursors add column if not exists checked_xact bigint;
update public.saved_search_email_cursors set checked_xact = private.snapshot_xmin() where checked_xact is null;
alter table public.saved_search_email_cursors alter column checked_xact set not null;
-- When the alert was last turned on. Existing windows: their start, which no
-- part with a publishing transaction id (all published after this) precedes.
alter table public.saved_search_email_cursors add column if not exists activated_at timestamptz;
update public.saved_search_email_cursors set activated_at = checked_through where activated_at is null;
alter table public.saved_search_email_cursors alter column activated_at set not null;

alter table public.saved_search_email_digests
  add column if not exists window_start_xact bigint,
  add column if not exists window_end_xact bigint;

alter table public.saved_search_email_digests drop constraint if exists saved_search_email_digests_skip_reason;
alter table public.saved_search_email_digests add constraint saved_search_email_digests_skip_reason check (
  (status = 'skipped') = (skip_reason is not null)
  and (skip_reason is null or skip_reason in ('opted_out', 'alert_off', 'no_address', 'account_closed', 'expired', 'carried')));

-- ---------------------------------------------------------------------------
-- 3. The alert's own trigger: on starts the window, off skips unsent digests
-- ---------------------------------------------------------------------------
-- Latest: 20261107200300. Changed: checked_xact, activated_at, and the 'off' branch.
create or replace function public.saved_search_email_window_start()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.alert and (tg_op = 'INSERT' or not old.alert) then
    insert into public.saved_search_email_cursors (saved_search_id, checked_through, checked_xact, activated_at)
    values (new.id, now(), private.snapshot_xmin(), now())
    on conflict (saved_search_id) do update
      set checked_through = excluded.checked_through, checked_xact = excluded.checked_xact,
          activated_at = excluded.activated_at, updated_at = now();
  elsif tg_op = 'UPDATE' and old.alert and not new.alert then
    update public.saved_search_email_digests
       set status = 'skipped', skip_reason = 'alert_off', updated_at = now()
     where saved_search_id = new.id and status in ('pending', 'sending');
  end if;
  return null;
end;
$$;
revoke all on function public.saved_search_email_window_start() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Admission
-- ---------------------------------------------------------------------------
-- Latest: 20261107200300. Changed: checked_xact and window_xact; a search
-- with an unsent digest from an earlier day waits for the sweep to carry it.
drop function if exists public.saved_search_digests_due(integer);
create function public.saved_search_digests_due(p_limit integer default 200)
returns table(saved_search_id uuid, user_id uuid, params jsonb, checked_through timestamptz, checked_xact bigint,
              window_end timestamptz, window_xact bigint, window_floor timestamptz)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select s.id, s.user_id, s.params, c.checked_through, c.checked_xact, now(), private.snapshot_xmin(),
         greatest(private.saved_search_digest_floor(), c.activated_at)
  from public.saved_searches s
  left join public.saved_search_email_cursors c on c.saved_search_id = s.id
  where s.alert
    and (c.saved_search_id is null
         or (private.saved_search_digest_day(c.checked_through) < private.saved_search_digest_day(now())
             and extract(hour from now() at time zone 'Europe/London') >= 8))
    and not exists (
      select 1 from public.saved_search_email_digests d
      where d.saved_search_id = s.id and d.status in ('pending', 'sending')
        and d.digest_day < private.saved_search_digest_day(now()))
  order by c.checked_through nulls first, s.id
  limit least(greatest(coalesce(p_limit, 200), 1), 500)
$$;
revoke all on function public.saved_search_digests_due(integer) from public, anon, authenticated;
grant execute on function public.saved_search_digests_due(integer) to service_role;

-- Latest: 20261107200300. Changed: p_window_xact (the window is
-- [checked_xact, p_window_xact) over listings.published_xact), and
-- 'blocked' while an earlier day's digest is unsent. Outcomes otherwise as
-- before: 'baseline', 'admitted', 'empty', 'muted' change something;
-- 'already_today', 'stale', 'blocked', 'alert_off', 'gone' do not.
drop function if exists public.admit_saved_search_digest(uuid, timestamptz, integer, jsonb, text, timestamptz);
create or replace function public.admit_saved_search_digest(
  p_saved_search_id uuid,
  p_window_end timestamptz,
  p_window_xact bigint,
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
  v_cursor record;
  v_today date := private.saved_search_digest_day(now());
  v_id uuid;
begin
  if p_window_end is null or p_window_end > now() then
    raise exception 'Invalid digest window' using errcode = '22023';
  end if;
  -- A window can't close on transactions that haven't finished yet.
  if p_window_xact is null or p_window_xact > private.snapshot_xmin() then
    raise exception 'Invalid digest window' using errcode = '22023';
  end if;
  if p_match_count is null or p_match_count < 0 then
    raise exception 'Invalid match count' using errcode = '22023';
  end if;

  -- The search row serialises admissions, the sweep and the alert trigger.
  select s.id, s.user_id, s.name, s.alert into v_search
  from public.saved_searches s where s.id = p_saved_search_id for update;
  if not found then return 'gone'; end if;
  if not v_search.alert then return 'alert_off'; end if;

  select c.checked_through, c.checked_xact into v_cursor
  from public.saved_search_email_cursors c where c.saved_search_id = p_saved_search_id for update;
  if not found then
    if p_expected_through is not null then return 'stale'; end if;
    insert into public.saved_search_email_cursors (saved_search_id, checked_through, checked_xact, activated_at)
    values (p_saved_search_id, p_window_end, p_window_xact, now());
    return 'baseline';
  end if;

  if p_expected_through is null or v_cursor.checked_through <> p_expected_through then return 'stale'; end if;
  if p_window_end <= v_cursor.checked_through or p_window_xact < v_cursor.checked_xact then return 'stale'; end if;
  if private.saved_search_digest_day(v_cursor.checked_through) >= v_today then return 'already_today'; end if;
  if exists (select 1 from public.saved_search_email_digests d
             where d.saved_search_id = p_saved_search_id and d.status in ('pending', 'sending') and d.digest_day < v_today) then
    return 'blocked';
  end if;

  if p_match_count > 0 and private.saved_search_emails_enabled(v_search.user_id) then
    insert into public.saved_search_email_digests
      (saved_search_id, digest_day, window_start, window_end, window_start_xact, window_end_xact,
       search_name, href, match_count, items)
    values
      (p_saved_search_id, v_today, greatest(v_cursor.checked_through, private.saved_search_digest_floor()), p_window_end,
       v_cursor.checked_xact, p_window_xact,
       v_search.name, p_href, p_match_count, p_items)
    on conflict (saved_search_id, digest_day) do nothing
    returning id into v_id;
    if v_id is null then return 'already_today'; end if;
  end if;

  update public.saved_search_email_cursors
     set checked_through = p_window_end, checked_xact = p_window_xact, updated_at = now()
   where saved_search_id = p_saved_search_id;

  return case when p_match_count = 0 then 'empty' when v_id is null then 'muted' else 'admitted' end;
end;
$$;
revoke all on function public.admit_saved_search_digest(uuid, timestamptz, bigint, integer, jsonb, text, timestamptz) from public, anon, authenticated;
grant execute on function public.admit_saved_search_digest(uuid, timestamptz, bigint, integer, jsonb, text, timestamptz) to service_role;

-- ---------------------------------------------------------------------------
-- 2. The sweep carries what was not sent
-- ---------------------------------------------------------------------------
-- Latest: 20261107200300. Changed: an unsent digest from an earlier day
-- rewinds its search's window to the digest's start ('carried'), so the next
-- admission mails those matches with the new ones (back to the 7-day
-- floor at most: the recorded start is never earlier); only a digest whose
-- window can't be restored (the window has moved since, or a digest from
-- before this migration with no transaction ids) is 'expired'. The search
-- row is locked before the digest, the same order as admission and the
-- alert trigger.
create or replace function public.saved_search_digest_sweep()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_candidate record;
  v_digest record;
  v_carried integer := 0;
  v_expired integer := 0;
  v_pruned integer;
begin
  for v_candidate in
    select d.id, d.saved_search_id from public.saved_search_email_digests d
    where d.status in ('pending', 'sending') and d.next_attempt_at <= now()
      and d.digest_day < private.saved_search_digest_day(now())
    order by d.digest_day, d.id
  loop
    perform 1 from public.saved_searches s where s.id = v_candidate.saved_search_id for update;
    select d.* into v_digest from public.saved_search_email_digests d
    where d.id = v_candidate.id and d.status in ('pending', 'sending') and d.next_attempt_at <= now()
    for update;
    if not found then continue; end if;

    update public.saved_search_email_cursors c
       set checked_through = greatest(v_digest.window_start, private.saved_search_digest_floor()),
           checked_xact = v_digest.window_start_xact, updated_at = now()
     where c.saved_search_id = v_digest.saved_search_id
       and c.checked_through = v_digest.window_end
       and v_digest.window_start_xact is not null;
    if found then
      update public.saved_search_email_digests
         set status = 'skipped', skip_reason = 'carried', updated_at = now() where id = v_digest.id;
      v_carried := v_carried + 1;
    else
      update public.saved_search_email_digests
         set status = 'skipped', skip_reason = 'expired', updated_at = now() where id = v_digest.id;
      v_expired := v_expired + 1;
    end if;
  end loop;
  delete from public.saved_search_email_digests d where d.created_at < now() - interval '90 days';
  get diagnostics v_pruned = row_count;
  return jsonb_build_object('carried', v_carried, 'expired', v_expired, 'pruned', v_pruned);
end;
$$;
revoke all on function public.saved_search_digest_sweep() from public, anon, authenticated;
grant execute on function public.saved_search_digest_sweep() to service_role;

-- ---------------------------------------------------------------------------
-- 2. Retries last the day
-- ---------------------------------------------------------------------------
-- Leases up to p_limit of today's due digests (pending, or a send whose lease
-- ran out after a crash) for p_lease_seconds. Each is re-checked first: the
-- alert still on, the preference still on, the account open, a confirmed
-- address. One that fails a check is skipped with the reason, not returned.
-- A digest whose lease ran out after 25 attempts (a sender that keeps
-- crashing on it, since retries alone back off to hourly) is failed.
--
-- Latest: 20261107200300. Changed: 25 attempts, not 5, now that a retry
-- is never terminal within the day.
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
   where d.status = 'sending' and d.next_attempt_at <= now() and d.attempts >= 25;

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
-- 10, 20, 40 minutes, then hourly, for the rest of the day: a provider
-- outage must not end the day's digest, and the sweep carries one still
-- unsent at the end of its day) or 'rejected' (failed: the provider refused
-- it for good). Only the attempt that holds the lease may record: anything
-- else (a replay, or an attempt whose lease ran out and was claimed again)
-- gets 'stale' and changes nothing. Returns the digest's new status.
--
-- Latest: 20261107200300. Changed: a retry is never terminal.
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
                    when p_outcome = 'retry' then 'pending'
                    else 'failed' end,
         sent_at = case when p_outcome = 'sent' then now() end,
         provider_message_id = case when p_outcome = 'sent' then left(nullif(btrim(p_provider_message_id), ''), 200) end,
         last_error = case when p_outcome = 'sent' then d.last_error else left(nullif(btrim(p_error), ''), 300) end,
         next_attempt_at = case
                             when p_outcome = 'retry'
                               then now() + least(interval '10 minutes' * power(2, least(d.attempts, 10) - 1), interval '60 minutes')
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
-- Self-check
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from public.saved_search_email_cursors where checked_xact is null) then
    raise exception 'SELF-CHECK FAILED: an email window has no transaction cut';
  end if;
  if not exists (select 1 from pg_attribute where attrelid = 'public.listings'::regclass and attname = 'published_xact' and not attisdropped) then
    raise exception 'SELF-CHECK FAILED: listings.published_xact missing';
  end if;
end $$;

notify pgrst, 'reload schema';
commit;
