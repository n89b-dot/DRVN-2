-- Who may read parts, cars and part photos (migration 20261010095900).
-- Transactional; disposable local database only.
--
-- That migration changed how the read policies ask "is this member
-- suspended?" — once per query, through suspended_profile_ids(), instead of
-- a function call per row. It must not change the answer. This states the
-- answer for each kind of reader and checks the policies give it.
begin;

do $$
declare
  v_seller uuid := gen_random_uuid();
  v_suspended uuid := gen_random_uuid();
  v_viewer uuid := gen_random_uuid();
  v_car uuid := gen_random_uuid();
  v_private_car uuid := gen_random_uuid();
  v_suspended_car uuid := gen_random_uuid();
  v_active uuid := gen_random_uuid();
  v_sold uuid := gen_random_uuid();
  v_draft uuid := gen_random_uuid();
  v_suspended_listing uuid := gen_random_uuid();
  v_mine uuid[] := array[v_car, v_private_car, v_suspended_car, v_active, v_sold, v_draft, v_suspended_listing];
  v_seen uuid[];
  v_expected uuid[];
  v_reader record;
  v_bad text;
begin

  insert into auth.users(id, email) values
    (v_seller, 'rules-seller@drvn.test'), (v_suspended, 'rules-suspended@drvn.test'), (v_viewer, 'rules-viewer@drvn.test');
  insert into public.profiles(id, username) values
    (v_seller, 'rules_seller'), (v_suspended, 'rules_suspended'), (v_viewer, 'rules_viewer')
    on conflict (id) do update set username = excluded.username;
  insert into public.cars(id, owner_id, slug, name, is_public) values
    (v_car, v_seller, 'rules-public', 'Rules public', true),
    (v_private_car, v_seller, 'rules-private', 'Rules private', false),
    (v_suspended_car, v_suspended, 'rules-suspended', 'Rules suspended', true);
  insert into public.listings(id, seller_id, title, category, price_cents, currency, status) values
    (v_active, v_seller, 'Rules active', 'engine', 1000, 'USD', 'active'),
    (v_sold, v_seller, 'Rules sold', 'engine', 1000, 'USD', 'sold'),
    (v_draft, v_seller, 'Rules draft', 'engine', 1000, 'USD', 'draft'),
    (v_suspended_listing, v_suspended, 'Rules suspended', 'engine', 1000, 'USD', 'active');
  insert into public.listing_images(listing_id, url, position)
    select id, 'https://example.test/' || id || '.jpg', 0
    from public.listings where id = any(v_mine);
  update public.profiles set suspended_at = now(), suspended_reason = 'guard' where id = v_suspended;

  -- The set the policies test against is exactly the suspended members.
  if (select array_agg(id) from rls_internal.suspended_profile_ids() id where id in (v_seller, v_suspended, v_viewer)) <> array[v_suspended] then
    raise exception 'suspended_profile_ids() does not match profiles.suspended_at';
  end if;

  -- reader, and which of the seven rows above they may read
  for v_reader in
    select * from (values
      ('a signed-out visitor', 'anon', null::uuid, array[v_car, v_active, v_sold]),
      ('another member', 'authenticated', v_viewer, array[v_car, v_active, v_sold]),
      ('the seller', 'authenticated', v_seller, array[v_car, v_private_car, v_active, v_sold, v_draft]),
      ('the suspended member', 'authenticated', v_suspended, array[v_car, v_suspended_car, v_active, v_sold, v_suspended_listing])
    ) r(label, role, uid, may_read)
  loop
    perform set_config('role', v_reader.role, true);
    perform set_config('request.jwt.claims',
      case when v_reader.uid is null then '' else json_build_object('sub', v_reader.uid, 'role', v_reader.role)::text end, true);

    select coalesce(array_agg(id order by id), '{}') into v_seen from (
      select id from public.cars where id = any(v_mine)
      union all select id from public.listings where id = any(v_mine)) s;
    select coalesce(array_agg(id order by id), '{}') into v_expected from unnest(v_reader.may_read) id;
    if v_seen <> v_expected then
      raise exception 'As %, the cars and parts readable are wrong: % (expected %)', v_reader.label, v_seen, v_expected;
    end if;

    -- A part's photos are readable exactly when the part is.
    select coalesce(array_agg(listing_id order by listing_id), '{}') into v_seen
      from public.listing_images where listing_id = any(v_mine);
    select coalesce(array_agg(id order by id), '{}') into v_expected
      from unnest(v_reader.may_read) id where id in (v_active, v_sold, v_draft, v_suspended_listing);
    if v_seen <> v_expected then
      raise exception 'As %, the part photos readable are wrong: % (expected %)', v_reader.label, v_seen, v_expected;
    end if;
  end loop;

  perform set_config('role', 'supabase_admin', true);

  -- Lifting the suspension brings the rows back: the set is read live.
  update public.profiles set suspended_at = null, suspended_reason = null where id = v_suspended;
  perform set_config('role', 'anon', true);
  perform set_config('request.jwt.claims', '', true);
  if not exists (select 1 from public.listings where id = v_suspended_listing)
     or not exists (select 1 from public.cars where id = v_suspended_car) then
    raise exception 'A member who is no longer suspended is still hidden';
  end if;
  perform set_config('role', 'supabase_admin', true);

  -- Shape: these policies no longer call a function per row. Putting
  -- is_suspended()/profile_is_visible() back would be correct and slow.
  select string_agg(polrelid::regclass || ': ' || polname, ', ') into v_bad
  from pg_policy
  where polrelid in ('public.listings'::regclass, 'public.cars'::regclass, 'public.listing_images'::regclass)
    and pg_get_expr(polqual, polrelid) ~ '(is_suspended|profile_is_visible)\(';
  if v_bad is not null then
    raise exception 'Read policies call a per-row visibility function again: %', v_bad;
  end if;
  if not exists (select 1 from pg_proc p where p.oid = 'rls_internal.suspended_profile_ids()'::regprocedure and p.prosecdef
                   and exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%')) then
    raise exception 'suspended_profile_ids() must be SECURITY DEFINER with a pinned search_path';
  end if;

  -- 20261124190000: the list is not something the API can be asked for. It
  -- lives in a schema the API does not serve, nothing by that name is left in
  -- the ones it does, and a visitor's policies can still run it.
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where p.proname = 'suspended_profile_ids' and n.nspname in ('public', 'graphql_public')) then
    raise exception 'suspended_profile_ids() is in a schema the API serves';
  end if;
  if not has_schema_privilege('anon', 'rls_internal', 'USAGE')
     or not has_function_privilege('anon', 'rls_internal.suspended_profile_ids()', 'EXECUTE')
     or not has_function_privilege('authenticated', 'rls_internal.suspended_profile_ids()', 'EXECUTE') then
    raise exception 'A read policy can no longer run suspended_profile_ids() for a visitor or a member';
  end if;
  -- Visitors and members hold none of the table privileges that row level
  -- security does not govern.
  select string_agg(distinct c.relname, ', ') into v_bad
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  cross join unnest(array['anon', 'authenticated']) r(role)
  cross join unnest(array['TRUNCATE', 'TRIGGER', 'REFERENCES', 'MAINTAIN']) p(priv)
  where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm')
    and has_table_privilege(r.role, c.oid, p.priv);
  if v_bad is not null then
    raise exception 'anon or authenticated holds TRUNCATE, TRIGGER, REFERENCES or MAINTAIN on: %', v_bad;
  end if;

  raise notice 'all read rule checks passed';
end $$;

rollback;
