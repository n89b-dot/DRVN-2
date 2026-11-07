-- Saved-search email digests: at most one per saved search per day, honouring
-- preferences, with idempotent retries (N78, OS-W35; migration 20261107200300).
-- Transactional; disposable local database only.
--   A. Turning an alert on starts its email window; off and on again restarts it.
--   B. A search with no window gets a baseline, not a digest.
--   C. Admission writes one digest for the window and moves the window in the
--      same step; the digest is on today's London day.
--   D. Unique per search per day: a replay is 'stale', a second window the
--      same day is refused, even with the window forced back the unique key
--      refuses it, and a direct second insert is a unique violation.
--   E. An empty window, a muted member (either preference) and an alert
--      switched off move nothing into the outbox.
--   F. The due list: no window, or a window last moved on an earlier day
--      (from 08:00 London); never one moved today.
--   G. Claiming leases a digest once, with the confirmed address; outcomes are
--      fenced by attempt, a retry backs off, a sent digest is never claimed
--      again and a replayed outcome changes nothing.
--   H. Crash: a send whose lease ran out is claimed again as the next
--      attempt, and the earlier attempt can no longer record; after five
--      attempts it fails.
--   I. Claim re-checks: opted out since admission, no confirmed address,
--      account closing, alert off: skipped with the reason.
--   J. The sweep expires what was not sent on its day and prunes after 90 days.
--   K. The schedule is in the job inventory and in cron.job.
--   L. Members can neither call the functions nor read the tables.
begin;

do $$
declare
  v_user uuid := gen_random_uuid();
  v_other uuid := gen_random_uuid();
  v_search uuid; v_empty uuid; v_muted uuid; v_muted_kind uuid; v_off uuid; v_fresh uuid;
  v_today date := private.saved_search_digest_day(now());
  v_items jsonb := jsonb_build_array(jsonb_build_object('id', gen_random_uuid(), 'title', 'Zzdigest part', 'price_cents', 1000));
  v_old timestamptz := now() - interval '2 days';
  v_digest uuid; v_second uuid;
  v_out text;
  v_ids uuid[];
  v_row record;
  v_code text;
  n integer;
begin
  insert into auth.users(id, email, confirmed_at) values
    (v_user, 'digest-member@drvn.test', now()),
    (v_other, 'digest-other@drvn.test', now());
  insert into public.profiles(id, username) values (v_user, 'digest_member'), (v_other, 'digest_other')
    on conflict (id) do update set username = excluded.username;

  -- A. The window starts when the alert does.
  insert into public.saved_searches(user_id, name, params, alert) values (v_user, 'Zz quiet', '{"_version":"2","q":"zzquiet"}', false)
    returning id into v_search;
  if exists (select 1 from public.saved_search_email_cursors where saved_search_id = v_search) then
    raise exception 'FAIL A1: a search saved without an alert has an email window';
  end if;
  update public.saved_searches set alert = true where id = v_search;
  if (select checked_through from public.saved_search_email_cursors where saved_search_id = v_search) is distinct from now() then
    raise exception 'FAIL A2: turning the alert on did not start the window then';
  end if;
  update public.saved_search_email_cursors set checked_through = v_old where saved_search_id = v_search;
  update public.saved_searches set alert = true where id = v_search;
  if (select checked_through from public.saved_search_email_cursors where saved_search_id = v_search) <> v_old then
    raise exception 'FAIL A3: re-saving an alert that was already on moved its window';
  end if;
  update public.saved_searches set alert = false where id = v_search;
  update public.saved_searches set alert = true where id = v_search;
  if (select checked_through from public.saved_search_email_cursors where saved_search_id = v_search) is distinct from now() then
    raise exception 'FAIL A4: off and on again did not restart the window';
  end if;
  insert into public.saved_searches(user_id, name, params, alert) values (v_user, 'Zz fresh', '{"_version":"2","q":"zzfresh"}', true)
    returning id into v_fresh;
  if not exists (select 1 from public.saved_search_email_cursors where saved_search_id = v_fresh and checked_through = now()) then
    raise exception 'FAIL A5: a search saved with its alert on has no window';
  end if;
  raise notice 'PASS A: the alert starts the email window';

  -- B. Baseline.
  delete from public.saved_search_email_cursors where saved_search_id = v_search;
  v_out := public.admit_saved_search_digest(v_search, now(), 4, v_items, '/marketplace?q=zzquiet');
  if v_out <> 'baseline' or exists (select 1 from public.saved_search_email_digests where saved_search_id = v_search)
     or (select checked_through from public.saved_search_email_cursors where saved_search_id = v_search) <> now() then
    raise exception 'FAIL B: a search with no window got %, not a baseline', v_out;
  end if;
  raise notice 'PASS B: no window means a baseline';

  -- C. Admission.
  update public.saved_search_email_cursors set checked_through = v_old where saved_search_id = v_search;
  v_out := public.admit_saved_search_digest(v_search, now(), 3, v_items, '/marketplace?q=zzquiet', v_old);
  select id into v_digest from public.saved_search_email_digests where saved_search_id = v_search;
  if v_out <> 'admitted' or v_digest is null then raise exception 'FAIL C1: admission gave %', v_out; end if;
  if not exists (select 1 from public.saved_search_email_digests where id = v_digest and digest_day = v_today
                   and window_start = v_old and window_end = now() and match_count = 3 and items = v_items
                   and search_name = 'Zz quiet' and status = 'pending' and attempts = 0) then
    raise exception 'FAIL C2: the digest does not hold its window, day and content';
  end if;
  if (select checked_through from public.saved_search_email_cursors where saved_search_id = v_search) <> now() then
    raise exception 'FAIL C3: the window did not move with the admission';
  end if;
  raise notice 'PASS C: one admission, one digest, window moved';

  -- D. Once a day.
  v_out := public.admit_saved_search_digest(v_search, now(), 3, v_items, '/marketplace?q=zzquiet', v_old);
  if v_out <> 'stale' then raise exception 'FAIL D1: a replayed admission gave %', v_out; end if;
  if private.saved_search_digest_day(now() - interval '1 second') = v_today then
    update public.saved_search_email_cursors set checked_through = now() - interval '1 second' where saved_search_id = v_search;
    v_out := public.admit_saved_search_digest(v_search, now(), 5, v_items, '/marketplace?q=zzquiet', now() - interval '1 second');
    if v_out <> 'already_today' then raise exception 'FAIL D2: a second window the same day gave %', v_out; end if;
  end if;
  -- Even with the window forced back a day, the day's digest is not doubled
  -- and the window does not move past matches that were not written.
  update public.saved_search_email_cursors set checked_through = v_old where saved_search_id = v_search;
  v_out := public.admit_saved_search_digest(v_search, now(), 5, v_items, '/marketplace?q=zzquiet', v_old);
  if v_out <> 'already_today' or (select checked_through from public.saved_search_email_cursors where saved_search_id = v_search) <> v_old then
    raise exception 'FAIL D3: the unique key did not hold the day (got %)', v_out;
  end if;
  begin
    insert into public.saved_search_email_digests(saved_search_id, digest_day, window_start, window_end, search_name, href, match_count, items)
    values (v_search, v_today, v_old, now(), 'Zz quiet', '/marketplace', 1, v_items);
    v_code := 'ok';
  exception when unique_violation then v_code := '23505';
  end;
  if v_code <> '23505' then raise exception 'FAIL D4: a second digest for the same search and day was accepted'; end if;
  select count(*) into n from public.saved_search_email_digests where saved_search_id = v_search;
  if n <> 1 then raise exception 'FAIL D5: % digests for one search in one day', n; end if;
  update public.saved_search_email_cursors set checked_through = now() where saved_search_id = v_search;
  raise notice 'PASS D: unique admission per search per day';

  -- E. Nothing to send, or nobody who wants it.
  insert into public.saved_searches(user_id, name, params, alert) values
    (v_user, 'Zz empty', '{"_version":"2","q":"zzempty"}', true) returning id into v_empty;
  update public.saved_search_email_cursors set checked_through = v_old where saved_search_id = v_empty;
  v_out := public.admit_saved_search_digest(v_empty, now(), 0, '[]'::jsonb, '/marketplace?q=zzempty', v_old);
  if v_out <> 'empty' or exists (select 1 from public.saved_search_email_digests where saved_search_id = v_empty)
     or (select checked_through from public.saved_search_email_cursors where saved_search_id = v_empty) <> now() then
    raise exception 'FAIL E1: an empty window gave %', v_out;
  end if;

  update public.profiles set notification_prefs = '{"saved_search_emails": false}' where id = v_other;
  insert into public.saved_searches(user_id, name, params, alert) values
    (v_other, 'Zz muted', '{"_version":"2","q":"zzmuted"}', true) returning id into v_muted;
  update public.saved_search_email_cursors set checked_through = v_old where saved_search_id = v_muted;
  v_out := public.admit_saved_search_digest(v_muted, now(), 2, v_items, '/marketplace?q=zzmuted', v_old);
  if v_out <> 'muted' or exists (select 1 from public.saved_search_email_digests where saved_search_id = v_muted)
     or (select checked_through from public.saved_search_email_cursors where saved_search_id = v_muted) <> now() then
    raise exception 'FAIL E2: a member with saved-search emails off got %', v_out;
  end if;
  update public.profiles set notification_prefs = '{"saved_searches": false, "saved_search_emails": true}' where id = v_other;
  insert into public.saved_searches(user_id, name, params, alert) values
    (v_other, 'Zz muted kind', '{"_version":"2","q":"zzmutedkind"}', true) returning id into v_muted_kind;
  update public.saved_search_email_cursors set checked_through = v_old where saved_search_id = v_muted_kind;
  v_out := public.admit_saved_search_digest(v_muted_kind, now(), 2, v_items, '/marketplace?q=zzmutedkind', v_old);
  if v_out <> 'muted' or exists (select 1 from public.saved_search_email_digests where saved_search_id = v_muted_kind) then
    raise exception 'FAIL E3: a member with saved-search matches off got %', v_out;
  end if;
  update public.profiles set notification_prefs = '{}' where id = v_other;

  insert into public.saved_searches(user_id, name, params, alert) values
    (v_other, 'Zz off', '{"_version":"2","q":"zzoff"}', true) returning id into v_off;
  update public.saved_search_email_cursors set checked_through = v_old where saved_search_id = v_off;
  update public.saved_searches set alert = false where id = v_off;
  v_out := public.admit_saved_search_digest(v_off, now(), 2, v_items, '/marketplace?q=zzoff', v_old);
  if v_out <> 'alert_off' or exists (select 1 from public.saved_search_email_digests where saved_search_id = v_off)
     or (select checked_through from public.saved_search_email_cursors where saved_search_id = v_off) <> v_old then
    raise exception 'FAIL E4: a search with its alert off got %', v_out;
  end if;
  raise notice 'PASS E: empty, muted and switched-off windows write no digest';

  -- F. Due.
  update public.saved_searches set alert = true where id = v_off;  -- window restarts now
  update public.saved_search_email_cursors set checked_through = v_old where saved_search_id = v_off;
  delete from public.saved_search_email_cursors where saved_search_id = v_muted;
  select array_agg(d.saved_search_id) into v_ids from public.saved_search_digests_due(500) d
  where d.saved_search_id in (v_search, v_empty, v_off, v_muted, v_fresh);
  if v_search = any(coalesce(v_ids, '{}')) or v_empty = any(coalesce(v_ids, '{}')) or v_fresh = any(coalesce(v_ids, '{}')) then
    raise exception 'FAIL F1: a window moved today is due again';
  end if;
  if not v_muted = any(coalesce(v_ids, '{}')) then raise exception 'FAIL F2: a search with no window is not due'; end if;
  if (extract(hour from now() at time zone 'Europe/London') >= 8) <> (v_off = any(coalesce(v_ids, '{}'))) then
    raise exception 'FAIL F3: a window from two days ago is due only from 08:00 London';
  end if;
  if exists (select 1 from public.saved_search_digests_due(500) d where d.window_end <> now()) then
    raise exception 'FAIL F4: the due window does not end at the database clock';
  end if;
  raise notice 'PASS F: the due list';

  -- G. Claim, retry, send, replay.
  select array_agg(c.digest_id) into v_ids from public.claim_saved_search_digests(200, 300) c where c.digest_id = v_digest;
  select * into v_row from public.saved_search_email_digests where id = v_digest;
  if v_ids is distinct from array[v_digest] or v_row.status <> 'sending' or v_row.attempts <> 1
     or v_row.next_attempt_at <> now() + interval '300 seconds' then
    raise exception 'FAIL G1: the digest was not leased once';
  end if;
  if not exists (select 1 from public.saved_search_email_digests d where d.id = v_digest)
     or exists (select 1 from public.claim_saved_search_digests(200, 300) c where c.digest_id = v_digest) then
    raise exception 'FAIL G2: a leased digest was claimed twice';
  end if;
  update public.saved_search_email_digests set status = 'pending', attempts = 0, next_attempt_at = now() where id = v_digest;
  for v_row in select * from public.claim_saved_search_digests(200, 300) c where c.digest_id = v_digest loop
    if v_row.recipient <> 'digest-member@drvn.test' or v_row.attempt <> 1 or v_row.match_count <> 3
       or v_row.href <> '/marketplace?q=zzquiet' or v_row.items <> v_items or v_row.digest_day <> v_today then
      raise exception 'FAIL G3: the claim does not carry the recipient and frozen content';
    end if;
  end loop;
  if public.complete_saved_search_digest(v_digest, 2, 'sent', 'zz-message') <> 'stale' then
    raise exception 'FAIL G4: an attempt that does not hold the lease recorded an outcome';
  end if;
  -- Each outcome is recorded before it is checked: a query reading the table
  -- in the same statement as the call would not see the call's update.
  v_out := public.complete_saved_search_digest(v_digest, 1, 'retry', null, 'provider busy');
  if v_out <> 'pending'
     or (select next_attempt_at from public.saved_search_email_digests where id = v_digest) <> now() + interval '10 minutes'
     or (select last_error from public.saved_search_email_digests where id = v_digest) <> 'provider busy' then
    raise exception 'FAIL G5: a retry did not back off';
  end if;
  if exists (select 1 from public.claim_saved_search_digests(200, 300) c where c.digest_id = v_digest) then
    raise exception 'FAIL G6: a digest was claimed before its backoff';
  end if;
  update public.saved_search_email_digests set next_attempt_at = now() where id = v_digest;
  select c.attempt into n from public.claim_saved_search_digests(200, 300) c where c.digest_id = v_digest;
  if n is distinct from 2 then raise exception 'FAIL G7: the retry was not attempt two'; end if;
  v_out := public.complete_saved_search_digest(v_digest, 2, 'sent', 'zz-message');
  if v_out <> 'sent'
     or not exists (select 1 from public.saved_search_email_digests where id = v_digest and status = 'sent'
                      and sent_at = now() and provider_message_id = 'zz-message') then
    raise exception 'FAIL G8: the send was not recorded';
  end if;
  v_out := public.complete_saved_search_digest(v_digest, 2, 'sent', 'zz-again') || '/'
           || public.complete_saved_search_digest(v_digest, 2, 'retry', null, 'late');
  if v_out <> 'stale/stale'
     or (select provider_message_id from public.saved_search_email_digests where id = v_digest) <> 'zz-message' then
    raise exception 'FAIL G9: a replayed outcome changed a sent digest';
  end if;
  update public.saved_search_email_digests set next_attempt_at = now() - interval '1 hour' where id = v_digest;
  if exists (select 1 from public.claim_saved_search_digests(200, 300) c where c.digest_id = v_digest) then
    raise exception 'FAIL G10: a sent digest was claimed again';
  end if;
  begin
    perform public.complete_saved_search_digest(v_digest, 2, 'delivered');
    v_code := 'ok';
  exception when others then v_code := sqlstate;
  end;
  if v_code <> '22023' then raise exception 'FAIL G11: an unknown outcome was accepted'; end if;
  raise notice 'PASS G: leased once, fenced outcomes, backoff, never sent twice';

  -- H. Crash between lease and outcome.
  insert into public.saved_search_email_digests(saved_search_id, digest_day, window_start, window_end, search_name, href, match_count, items)
  values (v_empty, v_today, v_old, now(), 'Zz empty', '/marketplace?q=zzempty', 1, v_items) returning id into v_second;
  perform 1 from public.claim_saved_search_digests(200, 300) c where c.digest_id = v_second;
  update public.saved_search_email_digests set next_attempt_at = now() - interval '1 second' where id = v_second;  -- the lease ran out
  select c.attempt into n from public.claim_saved_search_digests(200, 300) c where c.digest_id = v_second;
  if n is distinct from 2 then raise exception 'FAIL H1: a send whose lease ran out was not claimed again'; end if;
  if public.complete_saved_search_digest(v_second, 1, 'sent', 'zz-late') <> 'stale' then
    raise exception 'FAIL H2: the crashed attempt recorded after its lease was taken over';
  end if;
  update public.saved_search_email_digests set attempts = 5, next_attempt_at = now() - interval '1 second' where id = v_second;
  select count(*) into n from public.claim_saved_search_digests(200, 300) c where c.digest_id = v_second;
  if n <> 0 or (select status from public.saved_search_email_digests where id = v_second) <> 'failed' then
    raise exception 'FAIL H3: a fifth lease that ran out was retried';
  end if;
  update public.saved_search_email_digests set status = 'sending', attempts = 5, next_attempt_at = now() + interval '1 minute' where id = v_second;
  if public.complete_saved_search_digest(v_second, 5, 'retry', null, 'still busy') <> 'failed' then
    raise exception 'FAIL H4: a fifth failed attempt was retried';
  end if;
  raise notice 'PASS H: crash recovery is fenced and bounded';

  -- I. Re-checked at claim.
  update public.saved_search_email_digests set status = 'pending', attempts = 0, next_attempt_at = now(), last_error = null where id = v_second;
  update public.profiles set notification_prefs = '{"saved_search_emails": false}' where id = v_user;
  perform 1 from public.claim_saved_search_digests(200, 300);
  if (select skip_reason from public.saved_search_email_digests where id = v_second) is distinct from 'opted_out' then
    raise exception 'FAIL I1: a member who opted out after admission was mailed';
  end if;
  update public.profiles set notification_prefs = '{}' where id = v_user;
  update public.saved_search_email_digests set status = 'pending', skip_reason = null where id = v_second;
  update auth.users set confirmed_at = null where id = v_user;
  perform 1 from public.claim_saved_search_digests(200, 300);
  if (select skip_reason from public.saved_search_email_digests where id = v_second) is distinct from 'no_address' then
    raise exception 'FAIL I2: an unconfirmed address was mailed';
  end if;
  update auth.users set confirmed_at = now() where id = v_user;
  update public.saved_search_email_digests set status = 'pending', skip_reason = null where id = v_second;
  insert into public.account_deletion_requests(user_id, outcome, next_action) values (v_user, 'cleanup_pending', 'zz guard');
  perform 1 from public.claim_saved_search_digests(200, 300);
  if (select skip_reason from public.saved_search_email_digests where id = v_second) is distinct from 'account_closed' then
    raise exception 'FAIL I3: an account being deleted was mailed';
  end if;
  delete from public.account_deletion_requests where user_id = v_user;
  update public.saved_search_email_digests set status = 'pending', skip_reason = null where id = v_second;
  update public.saved_searches set alert = false where id = v_empty;
  perform 1 from public.claim_saved_search_digests(200, 300);
  if (select skip_reason from public.saved_search_email_digests where id = v_second) is distinct from 'alert_off' then
    raise exception 'FAIL I4: a search whose alert was switched off was mailed';
  end if;
  raise notice 'PASS I: preferences, address, account and alert re-checked at send';

  -- J. Sweep.
  update public.saved_search_email_digests set status = 'pending', skip_reason = null, digest_day = v_today - 1 where id = v_second;
  perform public.saved_search_digest_sweep();
  if (select skip_reason from public.saved_search_email_digests where id = v_second) is distinct from 'expired' then
    raise exception 'FAIL J1: a digest not sent on its day was kept for later';
  end if;
  update public.saved_search_email_digests set created_at = now() - interval '91 days' where id = v_second;
  perform public.saved_search_digest_sweep();
  if exists (select 1 from public.saved_search_email_digests where id = v_second)
     or not exists (select 1 from public.saved_search_email_digests where id = v_digest) then
    raise exception 'FAIL J2: retention pruned the wrong digests';
  end if;
  raise notice 'PASS J: expiry and retention';

  -- K. Schedule.
  if not exists (select 1 from private.scheduled_job_inventory() i where i.job = 'drvn-saved-search-digests'
                   and i.schedule = '41 * * * *' and i.families = array['savedSearchDigests']) then
    raise exception 'FAIL K1: the digest job is not in the inventory';
  end if;
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if not exists (select 1 from cron.job j where j.jobname = 'drvn-saved-search-digests' and j.schedule = '41 * * * *'
                     and j.command like '%invoke_remediation_worker(''saved-search-digests'')%') then
      raise exception 'FAIL K2: the digest job is not scheduled';
    end if;
  end if;
  begin
    perform public.invoke_remediation_worker('saved-search-digests');
    v_code := 'ok';
  exception when others then v_code := sqlerrm;
  end;
  if v_code = 'Unknown worker family' then raise exception 'FAIL K3: the worker refuses the digest family'; end if;
  raise notice 'PASS K: scheduled and in the inventory';

  -- L. Members.
  if has_function_privilege('authenticated', 'public.admit_saved_search_digest(uuid, timestamptz, integer, jsonb, text, timestamptz)', 'execute')
     or has_function_privilege('anon', 'public.admit_saved_search_digest(uuid, timestamptz, integer, jsonb, text, timestamptz)', 'execute')
     or has_function_privilege('authenticated', 'public.claim_saved_search_digests(integer, integer)', 'execute')
     or has_function_privilege('anon', 'public.claim_saved_search_digests(integer, integer)', 'execute')
     or has_function_privilege('authenticated', 'public.complete_saved_search_digest(uuid, integer, text, text, text)', 'execute')
     or has_function_privilege('authenticated', 'public.saved_search_digests_due(integer)', 'execute')
     or has_function_privilege('authenticated', 'public.saved_search_digest_sweep()', 'execute')
     or has_table_privilege('authenticated', 'public.saved_search_email_digests', 'select')
     or has_table_privilege('anon', 'public.saved_search_email_digests', 'select')
     or has_table_privilege('authenticated', 'public.saved_search_email_cursors', 'select,update') then
    raise exception 'FAIL L: members can reach the digest outbox';
  end if;
  raise notice 'PASS L: service role only';

  raise notice 'all saved-search email digest checks passed';
end;
$$;

rollback;
