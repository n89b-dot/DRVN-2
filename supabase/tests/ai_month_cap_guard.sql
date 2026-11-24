-- 20261124200000_ai_monthly_spend_cap_and_import_sweep.sql. Disposable
-- database only; everything is rolled back.
--
--   1. The month's ceiling on model spend: a call that would pass it is
--      refused, last month's spend does not count, an open hold does, the
--      first refusal of a month queues one alert and the next queues none.
--   2. agent_spend_allowed reports the month for the console.
--   3. The import sweep: overdue imports expire in one statement, finished
--      ones and consumed ones are left, and copied text is cleared after
--      seven days.
begin;

do $$
declare
  member uuid := gen_random_uuid();
  other uuid := gen_random_uuid();
  r jsonb;
  n int;
  i_overdue uuid;
  i_fresh uuid;
  i_consumed uuid;
  i_old_failed uuid;
  i_new_failed uuid;
  v_listing uuid;
begin
  insert into auth.users(id, email) values
    (member, 'month-cap-member@example.test'), (other, 'month-cap-other@example.test');
  -- The seeded "Every agent" switch refuses every reservation; this guard is
  -- about the caps, so it is cleared here, inside the transaction.
  update public.agent_controls set cleared_at = now() where cleared_at is null;
  -- Daily caps out of the way; the month allows one dollar.
  update public.agent_spend_limits set per_member_daily_usd = 100, global_daily_usd = 100, global_monthly_usd = 1.00 where singleton;
  delete from public.agent_spend_holds;
  delete from public.agent_usage;

  if (select global_monthly_usd from public.agent_spend_limits where singleton) is distinct from 1.00 then
    raise exception 'FAIL 0: the monthly cap column is missing or did not take the value';
  end if;

  -- Last month's spend, however large, is not this month's.
  insert into public.agent_usage(owner_id, feature, model, input_tokens, output_tokens, cost_usd, created_at)
  values (other, 'listing_import', 'guard', 1, 1, 500, date_trunc('month', now() at time zone 'utc') at time zone 'utc' - interval '1 second');
  -- Eighty cents this month, by someone else: the cap is everyone's.
  insert into public.agent_usage(owner_id, feature, model, input_tokens, output_tokens, cost_usd, created_at)
  values (other, 'listing_import', 'guard', 1, 1, 0.80, date_trunc('month', now() at time zone 'utc') at time zone 'utc');

  r := public.agent_spend_reserve(member, 'listing_import', 0.10);
  if (r->>'allowed')::boolean is not true then
    raise exception 'FAIL 1a: a call inside the month''s cap was refused (%)', r;
  end if;
  -- 0.80 used + 0.10 held = 0.90; fifteen cents more would pass a dollar.
  r := public.agent_spend_reserve(member, 'listing_import', 0.15);
  if (r->>'allowed')::boolean is not false or r->>'reason' <> 'spend_cap' or r->>'period' <> 'month'
     or (r->>'month_cap')::numeric <> 1.00 or (r->>'month_usd')::numeric <> 0.90 then
    raise exception 'FAIL 1b: a call past the month''s cap was not refused as the month''s (%)', r;
  end if;
  select count(*) into n from public.admin_alert_outbox where kind = 'ai_month_cap_reached';
  if n <> 1 then raise exception 'FAIL 1c: the first refusal of the month queued % alerts, expected 1', n; end if;
  if not exists (select 1 from public.admin_alert_outbox where kind = 'ai_month_cap_reached'
                 and dedup_key = 'ai-month-cap:' || to_char(now() at time zone 'utc', 'YYYY-MM') and status = 'pending') then
    raise exception 'FAIL 1d: the alert is not keyed to this month';
  end if;
  r := public.agent_spend_reserve(other, 'agent_chat', 0.50);
  select count(*) into n from public.admin_alert_outbox where kind = 'ai_month_cap_reached';
  if (r->>'allowed')::boolean is not false or n <> 1 then
    raise exception 'FAIL 1e: a second refusal in the month was allowed or queued another alert (%; % alerts)', r, n;
  end if;
  -- Exactly to the cap is allowed: ten cents brings it to a dollar.
  r := public.agent_spend_reserve(member, 'listing_import', 0.10);
  if (r->>'allowed')::boolean is not true then
    raise exception 'FAIL 1f: a call that reaches the cap exactly was refused (%)', r;
  end if;
  -- Raised, the next call goes through.
  update public.agent_spend_limits set global_monthly_usd = 5.00 where singleton;
  r := public.agent_spend_reserve(member, 'listing_import', 0.15);
  if (r->>'allowed')::boolean is not true then
    raise exception 'FAIL 1g: a call was refused after the cap was raised (%)', r;
  end if;
  -- A daily refusal is still a daily one: it does not name the month.
  update public.agent_spend_limits set per_member_daily_usd = 0.01 where singleton;
  r := public.agent_spend_reserve(member, 'listing_import', 0.15);
  if (r->>'allowed')::boolean is not false or r ? 'period' then
    raise exception 'FAIL 1h: the daily cap no longer refuses first (%)', r;
  end if;
  raise notice 'PASS 1: the month''s cap refuses, counts holds, ignores last month, and alerts once';

  r := public.agent_spend_allowed(member);
  if not (r ? 'month_usd') or (r->>'month_cap')::numeric <> 5.00 or (r->>'month_usd')::numeric <> 0.80 then
    raise exception 'FAIL 2: agent_spend_allowed does not report the month (%)', r;
  end if;
  update public.agent_spend_limits set per_member_daily_usd = 100, global_monthly_usd = 0.50 where singleton;
  if (public.agent_spend_allowed(member)->>'allowed')::boolean is not false then
    raise exception 'FAIL 2b: agent_spend_allowed says yes with the month over its cap';
  end if;
  raise notice 'PASS 2: the console reads the month''s spend and cap';

  -- 3. The sweep.
  insert into public.listings(seller_id, title, category, price_cents, shipping_cents, status, currency)
  values (member, 'Month cap guard part', 'brakes-suspension', 1000, 0, 'draft', 'USD') returning id into v_listing;
  insert into public.listing_imports(user_id, source_mode, status, expires_at, normalized_source)
  values (member, 'paste', 'ready', now() - interval '1 hour', '{"text":"overdue"}') returning id into i_overdue;
  insert into public.listing_imports(user_id, source_mode, status, expires_at, normalized_source)
  values (member, 'paste', 'ready', now() + interval '1 day', '{"text":"fresh"}') returning id into i_fresh;
  insert into public.listing_imports(user_id, source_mode, status, expires_at, normalized_source, listing_id)
  values (member, 'paste', 'ready', now() - interval '1 hour', '{"text":"consumed"}', v_listing) returning id into i_consumed;
  update public.listing_imports set status = 'consumed' where id = i_consumed;
  insert into public.listing_imports(user_id, source_mode, status, expires_at, normalized_source)
  values (member, 'paste', 'pending', now() + interval '1 day', '{"text":"old"}') returning id into i_old_failed;
  insert into public.listing_imports(user_id, source_mode, status, expires_at, normalized_source)
  values (member, 'paste', 'pending', now() + interval '1 day', '{"text":"new"}') returning id into i_new_failed;
  update public.listing_imports set status = 'failed' where id in (i_old_failed, i_new_failed);
  -- The status guard stamps updated_at; age one row past the seven days.
  alter table public.listing_imports disable trigger user;
  update public.listing_imports set updated_at = now() - interval '8 days' where id = i_old_failed;
  alter table public.listing_imports enable trigger user;

  n := public.expire_stale_listing_imports();
  if n <> 1 or (select status from public.listing_imports where id = i_overdue) <> 'expired'
     or (select status from public.listing_imports where id = i_fresh) <> 'ready'
     or (select status from public.listing_imports where id = i_consumed) <> 'consumed' then
    raise exception 'FAIL 3a: the sweep expired % rows; only the overdue, unfinished one should move', n;
  end if;
  if public.expire_stale_listing_imports() <> 0 then raise exception 'FAIL 3b: a second sweep moved rows again'; end if;

  n := public.scrub_expired_listing_imports();
  if n <> 1 or (select normalized_source from public.listing_imports where id = i_old_failed) is not null
     or (select normalized_source from public.listing_imports where id = i_new_failed) is null
     or (select normalized_source from public.listing_imports where id = i_overdue) is null then
    raise exception 'FAIL 3c: the scrub cleared % rows; only the one finished over seven days ago should be', n;
  end if;
  if (select status from public.listing_imports where id = i_old_failed) <> 'failed' then
    raise exception 'FAIL 3d: the scrub changed a row''s status';
  end if;
  if has_function_privilege('authenticated', 'public.expire_stale_listing_imports(integer)', 'EXECUTE')
     or has_function_privilege('anon', 'public.scrub_expired_listing_imports(integer)', 'EXECUTE') then
    raise exception 'FAIL 3e: a member or a visitor can run the sweep';
  end if;
  raise notice 'PASS 3: the sweep expires overdue imports and clears old copied text, each in one statement';

  raise notice 'all AI month cap and import sweep checks passed';
end $$;

rollback;
