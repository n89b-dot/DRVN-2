-- The agent's admin controls and measures (20261024100000). Disposable local DB only.
--   1. Beta steps: seeded closed, readable by anyone, writable only through
--      the admin function, which refuses a member.
--   2. Usage and caps: members can't read usage or call the cap check; the
--      cap blocks once a member's day passes it.
--   3. Daily measures: computed from the records, no member ids, and any
--      value from fewer than five cases stored as null.
--   4. A member's agent chat: refused to a member; the admin path needs a case.
begin;

create function pg_temp.act(p_member uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true), set_config('request.jwt.claims', jsonb_build_object('sub', p_member, 'role', 'authenticated')::text, true);
$$;
create function pg_temp.reset() returns void language sql as $$
  select set_config('role', 'none', true), set_config('request.jwt.claims', '', true);
$$;
create function pg_temp.code(p_sql text) returns text language plpgsql as $$
begin execute p_sql; return 'ok'; exception when others then return sqlstate; end $$;

do $$
declare
  seller uuid := gen_random_uuid();
  buyer uuid := gen_random_uuid();
  part uuid := gen_random_uuid();
  mandate uuid := gen_random_uuid();
  task uuid := gen_random_uuid();
  o uuid;
  i integer;
  c text;
  r jsonb;
begin
  update public.beta_access_config set enforced = false where singleton = true;
  insert into auth.users(id, email) values (seller, 'admin-measure-seller@drvn.test'), (buyer, 'admin-measure-buyer@drvn.test');

  -- 1. Beta steps.
  if (select count(*) from public.agent_beta_steps where not open) <> 4 then raise exception 'FAIL 1: the steps are not seeded closed'; end if;
  perform pg_temp.act(seller);
  if (select count(*) from public.agent_beta_steps) <> 4 then raise exception 'FAIL 1b: a member cannot read the steps'; end if;
  c := pg_temp.code('update public.agent_beta_steps set open = true');
  if c = 'ok' and exists (select 1 from public.agent_beta_steps where open) then raise exception 'FAIL 1c: a member opened a step'; end if;
  c := pg_temp.code($q$select public.admin_set_agent_beta_step('seller', true, 'guard')$q$);
  if c <> '42501' then raise exception 'FAIL 1d: a member reached the admin step function (%)', c; end if;

  -- 2. Usage and caps.
  c := pg_temp.code('select count(*) from public.agent_usage');
  if c <> '42501' then raise exception 'FAIL 2: a member can read model usage (%)', c; end if;
  c := pg_temp.code(format('select public.agent_spend_allowed(%L)', seller));
  if c <> '42501' then raise exception 'FAIL 2b: a member can call the cap check (%)', c; end if;
  c := pg_temp.code('select count(*) from public.agent_metrics_daily');
  if c <> '42501' then raise exception 'FAIL 2c: a member can read the measures (%)', c; end if;
  c := pg_temp.code(format('select * from public.admin_open_agent_chat(%L, %L, %L, %L)', buyer, 'report', gen_random_uuid(), 'guard'));
  if c <> '42501' then raise exception 'FAIL 4: a member reached the chat gate (%)', c; end if;
  perform pg_temp.reset();

  r := public.agent_spend_allowed(seller);
  if not (r->>'allowed')::boolean then raise exception 'FAIL 2d: a fresh day is over the cap'; end if;
  insert into public.agent_usage(owner_id, feature, model, input_tokens, output_tokens, cost_usd)
  values (seller, 'agent_chat', 'claude-sonnet-5-5', 1000, 1000, 2.50);
  r := public.agent_spend_allowed(seller);
  if (r->>'allowed')::boolean then raise exception 'FAIL 2e: the member cap did not block (%)', r; end if;
  if not (public.agent_spend_allowed(buyer)->>'allowed')::boolean then raise exception 'FAIL 2f: one member''s spend blocked another'; end if;

  -- 3. Measures: four agent-handled offers (suppressed), then a fifth.
  insert into public.listings(id, seller_id, title, category, price_cents, shipping_cents, status)
  values (part, seller, 'Measure guard intake', 'performance', 25000, 0, 'active');
  insert into public.listing_private_terms(listing_id, seller_id, offer_floor_cents) values (part, seller, 20000)
  on conflict (listing_id) do update set offer_floor_cents = excluded.offer_floor_cents;
  insert into public.agent_mandates(id, owner_id, scope, listing_id, minimum_cents, target_cents, style, binding_acknowledged_at, created_at)
  values (mandate, seller, 'seller', part, 23000, 24500, 'balanced', now(), now() - interval '1 hour');
  for i in 1..4 loop
    insert into auth.users(id, email) values (gen_random_uuid(), format('admin-measure-b%s@drvn.test', i)) returning id into o;
    insert into public.offers(listing_id, buyer_id, amount_cents) values (part, o, 21000 + i);
  end loop;
  perform public.agent_compute_metrics(current_date);
  if (select value from public.agent_metrics_daily where day = current_date and scope = 'seller' and measure = 'offers_handled') is not null then
    raise exception 'FAIL 3: four cases were not suppressed';
  end if;
  if (select sample from public.agent_metrics_daily where day = current_date and scope = 'seller' and measure = 'offers_handled') <> 4 then
    raise exception 'FAIL 3b: the sample was not recorded';
  end if;
  insert into auth.users(id, email) values (gen_random_uuid(), 'admin-measure-b5@drvn.test') returning id into o;
  insert into public.offers(listing_id, buyer_id, amount_cents) values (part, o, 21500);
  perform public.agent_compute_metrics(current_date);
  if (select value from public.agent_metrics_daily where day = current_date and scope = 'seller' and measure = 'offers_handled') <> 5 then
    raise exception 'FAIL 3c: five cases were not counted';
  end if;
  if (select value from public.agent_metrics_daily where day = current_date and scope = 'seller' and measure = 'share_without_seller_action') <> 1 then
    raise exception 'FAIL 3d: offers with no seller step-in were not all counted';
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'agent_metrics_daily'
             and column_name in ('owner_id', 'member_id', 'user_id', 'buyer_id', 'seller_id')) then
    raise exception 'FAIL 3e: the measures table can hold a member id';
  end if;
  -- Re-running a day replaces it.
  perform public.agent_compute_metrics(current_date);
  if (select count(*) from public.agent_metrics_daily where day = current_date and scope = 'seller' and measure = 'offers_handled') <> 1 then
    raise exception 'FAIL 3f: a re-run duplicated a measure';
  end if;

  raise notice 'all agent admin and measure checks passed';
end $$;

rollback;
