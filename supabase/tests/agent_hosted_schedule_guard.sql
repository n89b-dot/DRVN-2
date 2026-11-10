-- 20261026100000: the agent on a hosted project, and the hardenings beside it.
--   1. invoke_remediation_worker accepts the 'agent' family (and still refuses an unknown one).
--   2. drvn-agent-worker is scheduled every five minutes where pg_cron exists.
--   3. worker_health_snapshot reports an 'agent' family, stale until a run succeeds.
--   4. agent_mandate_set refuses while the side's beta step is closed, and works once it is open.
--   5. A paused mandate can still be turned off while the step is closed.
--   6. admin_open_agent_chat refuses a viewer even with step-up.
--   7. offer_accept_begin's search path includes pg_temp.
--   8. prune_listing_edit_requests removes week-old rows and keeps fresh ones.
begin;

create function pg_temp.act(p_member uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true), set_config('request.jwt.claims', jsonb_build_object('sub', p_member, 'role', 'authenticated')::text, true);
$$;
create function pg_temp.step_up(p_member uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true), set_config('request.jwt.claims', jsonb_build_object('sub', p_member, 'role', 'authenticated',
    'amr', jsonb_build_array(jsonb_build_object('method', 'totp', 'timestamp', extract(epoch from now())::bigint)))::text, true);
$$;
create function pg_temp.reset() returns void language sql as $$
  select set_config('role', 'none', true), set_config('request.jwt.claims', '', true);
$$;
create function pg_temp.code(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return 'ok';
exception when others then
  return sqlstate;
end $$;

-- This guard's own helpers are called while acting as other roles. A new
-- function is closed by default (20261110170000), so they are opened here.
grant execute on all routines in schema pg_temp to public;

do $$
declare
  seller uuid := gen_random_uuid();
  buyer uuid := gen_random_uuid();
  viewer uuid := gen_random_uuid();
  part uuid := gen_random_uuid();
  mandate uuid;
  c text;
  n integer;
begin
  delete from public.job_config where key in ('transfer_worker_url', 'transfer_worker_secret');
  insert into auth.users(id, email) values
    (seller, 'schedule-seller@drvn.test'), (buyer, 'schedule-buyer@drvn.test'), (viewer, 'schedule-viewer@drvn.test');
  -- A confirmed authenticator (20261107200500), so the refusal below is the role's.
  insert into auth.mfa_factors(id, user_id, friendly_name, factor_type, status, created_at, updated_at) values (gen_random_uuid(), viewer, 'guard', 'totp', 'verified', now(), now());
  insert into public.admin_users(user_id, role, mfa_factor_id) select viewer, 'viewer', id from auth.mfa_factors where user_id = viewer;
  insert into public.listings(id, seller_id, title, category, price_cents, shipping_cents, status)
  values (part, seller, 'Schedule guard turbo', 'performance', 100000, 2000, 'active');
  insert into public.listing_private_terms(listing_id, seller_id, offer_floor_cents) values (part, seller, 60000)
  on conflict (listing_id) do update set offer_floor_cents = excluded.offer_floor_cents;

  -- 1. The family list.
  c := pg_temp.code('select public.invoke_remediation_worker(''agent'')');
  if c <> 'ok' then raise exception 'FAIL 1: the agent family is refused (%)', c; end if;
  c := pg_temp.code('select public.invoke_remediation_worker(''anything-else'')');
  if c = 'ok' then raise exception 'FAIL 2: an unknown family is accepted'; end if;

  -- 2. The schedule.
  if exists (select 1 from pg_extension where extname = 'pg_cron')
     and not exists (select 1 from cron.job where jobname = 'drvn-agent-worker' and schedule = '*/5 * * * *'
                       and command like '%invoke_remediation_worker(''agent'')%') then
    raise exception 'FAIL 3: drvn-agent-worker is not scheduled every five minutes';
  end if;

  -- 3. The health family.
  if not (select (f->>'stale')::boolean from jsonb_array_elements(public.worker_health_snapshot()->'families') f where f->>'family' = 'agent') then
    raise exception 'FAIL 4: the agent family reads healthy before it has ever run';
  end if;
  insert into public.worker_runs(id, family, status, started_at, finished_at)
  values (gen_random_uuid(), 'agent', 'succeeded', now() - interval '2 minutes', now() - interval '1 minute');
  if (select (f->>'stale')::boolean from jsonb_array_elements(public.worker_health_snapshot()->'families') f where f->>'family' = 'agent') then
    raise exception 'FAIL 5: a fresh successful agent run reads stale';
  end if;

  -- 4. The beta step in the database.
  update public.agent_beta_steps set open = false where step in ('seller', 'buyer');
  perform pg_temp.act(seller);
  c := pg_temp.code(format('select public.agent_mandate_set(''seller'', %L, 70000, null, null, null, ''balanced'', null, true)', part));
  if c <> '42501' then raise exception 'FAIL 6: a seller mandate was set while the seller step is closed (%)', c; end if;
  perform pg_temp.act(buyer);
  c := pg_temp.code(format('select public.agent_mandate_set(''buyer'', %L, null, null, 90000, ''item'')', part));
  if c <> '42501' then raise exception 'FAIL 7: a buyer mandate was set while the buyer step is closed (%)', c; end if;
  perform pg_temp.reset();
  update public.agent_beta_steps set open = true where step = 'seller';
  perform pg_temp.act(seller);
  mandate := public.agent_mandate_set('seller', part, 70000, null, null, null, 'balanced', null, true);
  if mandate is null then raise exception 'FAIL 8: an open step refused a mandate'; end if;

  -- 5. Closing the step keeps the mandate, and the owner can still turn it off.
  perform pg_temp.reset();
  update public.agent_beta_steps set open = false where step = 'seller';
  perform pg_temp.act(seller);
  c := pg_temp.code(format('select public.agent_mandate_set_status(%L, ''paused'')', mandate));
  if c <> 'ok' then raise exception 'FAIL 9: the owner could not pause after the step closed (%)', c; end if;
  c := pg_temp.code(format('select public.agent_mandate_set(''seller'', %L, 75000, null, null, null, ''balanced'', null, true)', part));
  if c <> '42501' then raise exception 'FAIL 10: limits changed while the step is closed (%)', c; end if;
  perform pg_temp.reset();

  -- 6. A viewer with step-up still can't open a chat.
  perform pg_temp.step_up(viewer);
  c := pg_temp.code(format('select * from public.admin_open_agent_chat(%L, ''report'', %L, ''guard'')', seller, gen_random_uuid()));
  if c <> '42501' then raise exception 'FAIL 11: a viewer opened a member chat (%)', c; end if;
  perform pg_temp.reset();

  -- 7. Search path.
  if (select p.proconfig::text from pg_proc p where p.oid = 'public.offer_accept_begin(uuid, uuid, interval)'::regprocedure) not like '%pg_temp%' then
    raise exception 'FAIL 12: offer_accept_begin search path lacks pg_temp';
  end if;

  -- 8. The edit-request sweep.
  insert into private.listing_edit_requests(seller_id, request_id, listing_id, expected_updated_at, payload_hash, result, created_at)
  values (seller, gen_random_uuid(), part, now(), repeat('a', 64), '{}'::jsonb, now() - interval '8 days'),
         (seller, gen_random_uuid(), part, now(), repeat('b', 64), '{}'::jsonb, now() - interval '1 hour');
  n := public.prune_listing_edit_requests();
  if n <> 1 then raise exception 'FAIL 13: the sweep removed % row(s), expected 1', n; end if;
  if (select count(*) from private.listing_edit_requests where seller_id = seller) <> 1 then
    raise exception 'FAIL 14: the fresh row did not survive the sweep';
  end if;
  if has_function_privilege('authenticated', 'public.prune_listing_edit_requests()', 'execute') then
    raise exception 'FAIL 15: the sweep is client-callable';
  end if;

  raise notice 'all 15 hosted-schedule checks passed';
end $$;
rollback;
