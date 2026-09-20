-- Security repairs from the direction-build review (20260919201000).
-- Transactional; disposable local database only.
begin;

do $$
declare
  v_seller uuid := gen_random_uuid();
  v_car uuid := gen_random_uuid();
  v_mod uuid := gen_random_uuid();
  v_rejected boolean;
begin
  -- P-9: nobody but the owner reads a seller's lowest offer.
  if has_column_privilege('anon', 'public.profiles', 'default_offer_floor_pct', 'select')
     or has_column_privilege('authenticated', 'public.profiles', 'default_offer_floor_pct', 'select') then
    raise exception 'default_offer_floor_pct is readable by clients';
  end if;
  if not has_column_privilege('authenticated', 'public.profiles', 'default_offer_floor_pct', 'update') then
    raise exception 'a seller can no longer set their own offer floor';
  end if;
  if has_function_privilege('anon', 'public.my_default_offer_floor()', 'execute') then
    raise exception 'my_default_offer_floor is callable signed-out';
  end if;

  -- Execute grants that were lost when functions were re-created.
  if has_function_privilege('anon',
       'public.write_activity_post(text, uuid, uuid, text, jsonb, text[], text, text, uuid[])', 'execute') then
    raise exception 'write_activity_post is callable signed-out';
  end if;
  if has_function_privilege('anon', 'public.post_href(uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.post_href(uuid)', 'execute') then
    raise exception 'post_href names private car slugs to clients';
  end if;
  if has_function_privilege('anon', 'public.local_feed_rows(text, text)', 'execute') then
    raise exception 'local_feed_rows is callable signed-out';
  end if;

  -- Builders to follow must run for a client role (it used to read a column
  -- no client may read, and every call failed).
  update public.beta_access_config set enforced = false where singleton;
  insert into auth.users(id, email) values (v_seller, 'direction-security@drvn.test');
  insert into public.profiles(id, username) values (v_seller, 'direction_security')
    on conflict (id) do update set username = excluded.username;
  insert into public.cars(id, owner_id, slug, name)
    values (v_car, v_seller, 'direction-security-guard', 'Direction security guard');

  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_seller, 'role', 'authenticated')::text, true);

  perform * from public.suggested_builders(v_seller, 4);

  -- C-1: an order item that isn't the caller's delivered purchase can't be
  -- claimed onto their own mod.
  v_rejected := false;
  begin
    insert into public.mod_items(id, car_id, group_label, raw_text, position, source_order_item_id)
      values (v_mod, v_car, 'Other', 'Forged provenance', 0, gen_random_uuid());
  exception when insufficient_privilege or foreign_key_violation then
    v_rejected := true;
  end;
  if not v_rejected then
    raise exception 'a car owner claimed an order item that is not theirs';
  end if;

  -- L-1: what a pasted link may store.
  v_rejected := false;
  begin
    insert into public.mod_items(car_id, group_label, raw_text, position, product_url)
      values (v_car, 'Other', 'Bad link', 0, 'javascript:alert(1)');
  exception when check_violation then
    v_rejected := true;
  end;
  if not v_rejected then
    raise exception 'mod_items accepted a non-http product_url';
  end if;

  perform set_config('role', 'none', true);
  raise notice 'All direction security checks passed';
end;
$$;

rollback;
