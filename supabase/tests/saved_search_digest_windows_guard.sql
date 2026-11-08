-- Saved-search digest windows (OS-W35 follow-up; migration 20261107200350).
-- Transactional; disposable local database only.
--   A. In-flight publications: a part's publication carries its transaction
--      id, kept through a pause and not writable on its own; a publication
--      that has not committed is outside any window that closes while it is
--      in flight (its id is at or above the snapshot xmin), although its
--      published_at is inside the old time window.
--   B. Windows are cut on transaction ids: admission records both ends and
--      moves the cursor's id, refuses a window that closes on unfinished
--      transactions, and refuses one whose end is before its start.
--   C. Carried windows: a digest not sent on its day rewinds its search's
--      window to its start ('carried'); while it is unsent the search is not
--      due and admission is 'blocked'; the next admission covers both days.
--   D. A retry is never terminal within the day: hourly at most.
--   E. Alert restarts: turning an alert off skips its unsent digests, so off
--      and on again before the next claim cannot send the old window.
--   F. A carried window reaches back at most 7 days: the floor is London
--      midnight seven days before today, the due list hands it to the worker,
--      and a ten-day carry rewinds to it, not past it.
--   G. Activation: a pinned xmin can start a window below a part published
--      while the alert was off, so the window floor is never before the alert
--      was (last) turned on, and an admission doesn't move that.
begin;

do $$
declare
  v_seller uuid := gen_random_uuid();
  v_user uuid := gen_random_uuid();
  v_car uuid := gen_random_uuid();
  v_make bigint; v_model bigint;
  v_live uuid; v_draft uuid;
  v_search uuid; v_restart uuid; v_far uuid; v_pinned uuid;
  v_floor timestamptz;
  v_today date := private.saved_search_digest_day(now());
  v_items jsonb := jsonb_build_array(jsonb_build_object('id', gen_random_uuid(), 'title', 'Zzwindow part', 'price_cents', 1000));
  v_old timestamptz := now() - interval '2 days';
  v_xmin bigint;
  v_xact bigint;
  v_digest uuid; v_next uuid;
  v_out text;
  v_code text;
  v_row record;
begin
  update public.beta_access_config set enforced = false where singleton;
  insert into auth.users(id, email, confirmed_at) values
    (v_seller, 'window-seller@drvn.test', now()), (v_user, 'window-member@drvn.test', now());
  insert into public.profiles(id, username, payouts_enabled) values (v_seller, 'window_seller', true), (v_user, 'window_member', false)
    on conflict (id) do update set username = excluded.username, payouts_enabled = excluded.payouts_enabled;
  insert into public.catalog_makes(name) values ('Zzwinmake') returning id into v_make;
  insert into public.catalog_models(make_id, name) values (v_make, 'Zzwinmodel') returning id into v_model;
  insert into public.cars(id, owner_id, slug, name, make, model, year, is_public) values
    (v_car, v_seller, 'window-car', 'Window car', 'Zzwinmake', 'Zzwinmodel', 2004, true);

  -- A. The publishing transaction's id.
  v_xact := pg_current_xact_id()::text::bigint;
  insert into public.listings(seller_id, source_car_id, title, category, price_cents, currency, status, brand)
  values (v_seller, v_car, 'Zzwindow draft', 'engine', 1000, 'USD', 'draft', 'Zzwinbrand') returning id into v_draft;
  if (select published_xact from public.listings where id = v_draft) is not null then
    raise exception 'FAIL A1: a draft has a publishing transaction';
  end if;
  begin
    insert into public.listings(seller_id, source_car_id, title, category, price_cents, currency, status, brand)
    values (v_seller, v_car, 'Zzwindow live', 'engine', 1000, 'USD', 'active', 'Zzwinbrand') returning id into v_live;
  exception when others then
    -- A live part needs a photo at commit and payouts set up; neither
    -- matters to the stamp, so publish the draft instead if the insert is refused.
    v_live := null;
  end;
  update public.listings set status = 'active' where id = v_draft;
  if (select published_xact from public.listings where id = v_draft) is distinct from v_xact
     or (v_live is not null and (select published_xact from public.listings where id = v_live) is distinct from v_xact) then
    raise exception 'FAIL A2: a publication does not carry its transaction id';
  end if;
  update public.listings set status = 'paused' where id = v_draft;
  update public.listings set status = 'active' where id = v_draft;
  update public.listings set published_xact = 1 where id = v_draft;
  if (select published_xact from public.listings where id = v_draft) is distinct from v_xact then
    raise exception 'FAIL A3: a pause or a direct write moved the publishing transaction';
  end if;
  -- This transaction has not committed: its publication is at or above any
  -- xmin a window could close on now, so no window contains it yet, though
  -- its published_at (this transaction's start) is inside (v_old, now()].
  v_xmin := private.snapshot_xmin();
  if not (v_xact >= v_xmin) or (select published_at from public.listings where id = v_draft) > now() then
    raise exception 'FAIL A4: an uncommitted publication would fall inside a closing window';
  end if;
  raise notice 'PASS A: publications carry their transaction, in flight ones are in no closed window';

  -- B. Transaction-id windows.
  insert into public.saved_searches(user_id, name, params, alert) values (v_user, 'Zz window', '{"_version":"2","q":"zzwindow"}', true)
    returning id into v_search;
  if (select checked_xact from public.saved_search_email_cursors where saved_search_id = v_search) is distinct from v_xmin then
    raise exception 'FAIL B1: turning the alert on did not cut the window at the snapshot xmin';
  end if;
  update public.saved_search_email_cursors set checked_through = v_old, checked_xact = v_xmin - 1 where saved_search_id = v_search;
  if not exists (select 1 from public.saved_search_digests_due(500) d where d.saved_search_id = v_search
                   and d.checked_xact = v_xmin - 1 and d.window_xact = private.snapshot_xmin())
     and extract(hour from now() at time zone 'Europe/London') >= 8 then
    raise exception 'FAIL B2: the due window does not close on the snapshot xmin';
  end if;
  begin
    perform public.admit_saved_search_digest(v_search, now(), v_xact + 1000000, 1, v_items, '/marketplace?q=zzwindow', v_old);
    v_code := 'ok';
  exception when others then v_code := sqlstate;
  end;
  if v_code <> '22023' then raise exception 'FAIL B3: a window closed on unfinished transactions'; end if;
  v_out := public.admit_saved_search_digest(v_search, now(), v_xmin - 2, 1, v_items, '/marketplace?q=zzwindow', v_old);
  if v_out <> 'stale' then raise exception 'FAIL B4: a window ending before its start gave %', v_out; end if;
  v_out := public.admit_saved_search_digest(v_search, now(), v_xmin, 1, v_items, '/marketplace?q=zzwindow', v_old);
  select id into v_digest from public.saved_search_email_digests where saved_search_id = v_search;
  if v_out <> 'admitted'
     or not exists (select 1 from public.saved_search_email_digests where id = v_digest and window_start_xact = v_xmin - 1 and window_end_xact = v_xmin)
     or (select checked_xact from public.saved_search_email_cursors where saved_search_id = v_search) <> v_xmin then
    raise exception 'FAIL B5: admission did not record and move the transaction window (got %)', v_out;
  end if;
  raise notice 'PASS B: windows are cut on transaction ids';

  -- C. Carry an unsent digest into the next day's window.
  update public.saved_search_email_digests set digest_day = v_today - 1, window_start = v_old - interval '1 day', window_end = v_old where id = v_digest;
  update public.saved_search_email_cursors set checked_through = v_old where saved_search_id = v_search;
  if exists (select 1 from public.saved_search_digests_due(500) d where d.saved_search_id = v_search) then
    raise exception 'FAIL C1: a search with an unsent digest from an earlier day is due';
  end if;
  v_out := public.admit_saved_search_digest(v_search, now(), private.snapshot_xmin(), 1, v_items, '/marketplace?q=zzwindow', v_old);
  if v_out <> 'blocked' then raise exception 'FAIL C2: admission moved past an unsent digest (got %)', v_out; end if;
  perform public.saved_search_digest_sweep();
  select * into v_row from public.saved_search_email_digests where id = v_digest;
  if v_row.status <> 'skipped' or v_row.skip_reason <> 'carried' then
    raise exception 'FAIL C3: the unsent digest was % / %, not carried', v_row.status, v_row.skip_reason;
  end if;
  if not exists (select 1 from public.saved_search_email_cursors where saved_search_id = v_search
                   and checked_through = v_old - interval '1 day' and checked_xact = v_xmin - 1) then
    raise exception 'FAIL C4: the window was not rewound to the unsent digest''s start';
  end if;
  v_out := public.admit_saved_search_digest(v_search, now(), private.snapshot_xmin(), 2, v_items, '/marketplace?q=zzwindow', v_old - interval '1 day');
  select id into v_next from public.saved_search_email_digests where saved_search_id = v_search and digest_day = v_today;
  if v_out <> 'admitted' or not exists (select 1 from public.saved_search_email_digests where id = v_next
                                          and window_start = v_old - interval '1 day' and window_start_xact = v_xmin - 1) then
    raise exception 'FAIL C5: the next admission does not cover the carried window (got %)', v_out;
  end if;
  raise notice 'PASS C: an unsent window is carried, never dropped';

  -- D. Retries last the day.
  perform 1 from public.claim_saved_search_digests(200, 300) c where c.digest_id = v_next;
  update public.saved_search_email_digests set attempts = 9 where id = v_next;
  v_out := public.complete_saved_search_digest(v_next, 9, 'retry', null, 'provider down');
  if v_out <> 'pending' or (select next_attempt_at from public.saved_search_email_digests where id = v_next) <> now() + interval '60 minutes' then
    raise exception 'FAIL D: a ninth retry was % or not hourly', v_out;
  end if;
  raise notice 'PASS D: a retry is never terminal, and hourly at most';

  -- E. Off and on again before the next claim.
  update public.saved_search_email_digests set next_attempt_at = now() where id = v_next;
  update public.saved_searches set alert = false where id = v_search;
  if (select skip_reason from public.saved_search_email_digests where id = v_next) is distinct from 'alert_off' then
    raise exception 'FAIL E1: turning the alert off left its digest sendable';
  end if;
  update public.saved_searches set alert = true where id = v_search;
  if exists (select 1 from public.claim_saved_search_digests(200, 300) c where c.digest_id = v_next) then
    raise exception 'FAIL E2: off and on again sent the old window';
  end if;
  -- A digest leased when the alert goes off can't record a send afterwards.
  insert into public.saved_searches(user_id, name, params, alert) values (v_user, 'Zz restart', '{"_version":"2","q":"zzrestart"}', true)
    returning id into v_restart;
  insert into public.saved_search_email_digests(saved_search_id, digest_day, window_start, window_end, search_name, href, match_count, items)
  values (v_restart, v_today, v_old, now(), 'Zz restart', '/marketplace?q=zzrestart', 1, v_items) returning id into v_digest;
  perform 1 from public.claim_saved_search_digests(200, 300) c where c.digest_id = v_digest;
  update public.saved_searches set alert = false where id = v_restart;
  update public.saved_searches set alert = true where id = v_restart;
  v_out := public.complete_saved_search_digest(v_digest, 1, 'retry', null, 'late');
  if v_out <> 'stale' or (select status from public.saved_search_email_digests where id = v_digest) <> 'skipped' then
    raise exception 'FAIL E3: a digest leased before the alert went off came back (got %)', v_out;
  end if;
  raise notice 'PASS E: an alert restart cannot send the old window';

  -- F. The 7-day floor.
  v_floor := private.saved_search_digest_floor();
  if v_floor <> ((v_today - 7)::timestamp at time zone 'Europe/London') then
    raise exception 'FAIL F1: the floor is % not London midnight seven days before today', v_floor;
  end if;
  insert into public.saved_searches(user_id, name, params, alert) values (v_user, 'Zz far', '{"_version":"2","q":"zzfar"}', true)
    returning id into v_far;
  if exists (select 1 from public.saved_search_digests_due(500) d
             join public.saved_search_email_cursors c on c.saved_search_id = d.saved_search_id
             where d.window_floor <> greatest(v_floor, c.activated_at)) then
    raise exception 'FAIL F2: the due list does not carry the floor';
  end if;
  -- Ten days of carried windows: the digest from yesterday started ten days ago.
  insert into public.saved_search_email_digests(saved_search_id, digest_day, window_start, window_end, window_start_xact, window_end_xact,
                                                search_name, href, match_count, items)
  values (v_far, v_today - 1, now() - interval '10 days', now() - interval '1 day', v_xmin - 1, v_xmin,
          'Zz far', '/marketplace?q=zzfar', 1, v_items) returning id into v_digest;
  update public.saved_search_email_cursors set checked_through = now() - interval '1 day', checked_xact = v_xmin where saved_search_id = v_far;
  perform public.saved_search_digest_sweep();
  if (select skip_reason from public.saved_search_email_digests where id = v_digest) is distinct from 'carried'
     or (select checked_through from public.saved_search_email_cursors where saved_search_id = v_far) <> v_floor then
    raise exception 'FAIL F3: a ten-day carry rewound past the 7-day floor';
  end if;
  v_out := public.admit_saved_search_digest(v_far, now(), private.snapshot_xmin(), 1, v_items, '/marketplace?q=zzfar', v_floor);
  if v_out <> 'admitted' or (select window_start from public.saved_search_email_digests
                             where saved_search_id = v_far and digest_day = v_today) <> v_floor then
    raise exception 'FAIL F4: the carried digest does not start at the floor (got %)', v_out;
  end if;
  raise notice 'PASS F: a carried window reaches back at most 7 days';

  -- G. Activation.
  insert into public.saved_searches(user_id, name, params, alert) values (v_user, 'Zz pinned', '{"_version":"2","q":"zzpinned"}', false)
    returning id into v_pinned;
  update public.saved_searches set alert = true where id = v_pinned;
  if (select activated_at from public.saved_search_email_cursors where saved_search_id = v_pinned) is distinct from now() then
    raise exception 'FAIL G1: turning the alert on did not record when';
  end if;
  update public.saved_search_email_cursors set activated_at = now() - interval '1 hour' where saved_search_id = v_pinned;
  update public.saved_searches set alert = false where id = v_pinned;
  update public.saved_searches set alert = true where id = v_pinned;
  if (select activated_at from public.saved_search_email_cursors where saved_search_id = v_pinned) is distinct from now() then
    raise exception 'FAIL G2: turning the alert back on did not move its activation';
  end if;
  -- A window start pinned far below (checked_xact 1, as a long transaction
  -- leaves it) and an activation after the 7-day floor: the floor the worker
  -- filters published_at on is the activation, so a part published while the
  -- alert was off stays out however low the id window starts.
  update public.saved_search_email_cursors
     set checked_through = now() - interval '2 days', checked_xact = 1, activated_at = now() - interval '3 days'
   where saved_search_id = v_pinned;
  select d.window_floor into v_floor from public.saved_search_digests_due(500) d where d.saved_search_id = v_pinned;
  if v_floor is not null and v_floor <> now() - interval '3 days' then
    raise exception 'FAIL G3: the window floor % is not the activation', v_floor;
  end if;
  v_out := public.admit_saved_search_digest(v_pinned, now(), private.snapshot_xmin(), 0, '[]'::jsonb, '/marketplace?q=zzpinned', now() - interval '2 days');
  if v_out <> 'empty' or (select activated_at from public.saved_search_email_cursors where saved_search_id = v_pinned) <> now() - interval '3 days' then
    raise exception 'FAIL G4: admission moved the activation (got %)', v_out;
  end if;
  raise notice 'PASS G: the window floor is never before the alert was turned on';

  raise notice 'all saved-search digest window checks passed';
end;
$$;

rollback;
