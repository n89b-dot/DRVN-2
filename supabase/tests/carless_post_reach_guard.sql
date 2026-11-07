-- A post with no car still reaches people (PRD 2026-09 W-5; migrations
-- 197000, 198000, 199000). Transactional; disposable local database only.
--
-- Dropping `activity_posts.car_id`'s NOT NULL is the easy half. The half
-- that actually decides whether the feature exists is every reader that
-- joined `cars` INNER — each of which would drop the post silently, which
-- looks to the member exactly like posting into nothing.
begin;

do $$
declare
  v_author uuid := gen_random_uuid();
  v_fan uuid := gen_random_uuid();
  v_car uuid := gen_random_uuid();
  v_listing uuid := gen_random_uuid();
  v_op uuid := gen_random_uuid();
  v_op_nopart uuid := gen_random_uuid();
  v_op_withcar uuid := gen_random_uuid();
  v_post uuid;
  v_carful_post uuid;
  v_outcome text;
  v_href text;
  v_owner uuid;
  v_rejected boolean;
  v_count int;
begin
  -- Member photo writes need the storage origin recorded (20261107203000).
  insert into public.job_config(key, value) values ('media_storage_origin', 'https://proj.supabase.co')
    on conflict (key) do update set value = excluded.value;
  update public.beta_access_config set enforced = false where singleton;

  insert into auth.users(id, email) values
    (v_author, 'carless-author@drvn.test'),
    (v_fan, 'carless-fan@drvn.test');
  insert into public.profiles(id, username, country, region) values
    (v_author, 'carless_author', 'GB', 'Yorkshire'),
    (v_fan, 'carless_fan', 'GB', 'Yorkshire')
    on conflict (id) do update set username = excluded.username,
                                   country = excluded.country,
                                   region = excluded.region;
  insert into public.cars(id, owner_id, slug, name, is_public)
    values (v_car, v_author, 'carless-guard-car', 'Carless guard car', true);
  insert into public.listings(id, seller_id, title, category, subcategory, price_cents, currency, status)
    values (v_listing, v_author, 'Spare turbo manifold', 'performance', 'turbo', 20000, 'USD', 'active');

  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_author, 'role', 'authenticated')::text, true);

  -- A post about a part, with no car at all.
  select post_id, outcome into v_post, v_outcome
    from public.write_activity_post(
      'quick', v_op, null, null,
      '[{"type":"text","style":"normal","text":"Sold the car, this manifold is spare."}]'::jsonb,
      array['https://proj.supabase.co/storage/v1/object/public/activity-images/' || v_author || '/manifold.jpg'],
      null, null, array[v_listing]
    );
  if v_outcome <> 'published' then
    raise exception 'A carless post did not publish (got %)', v_outcome;
  end if;

  -- ...and one WITH a car, so every assertion below can tell them apart.
  select post_id into v_carful_post
    from public.write_activity_post(
      'quick', v_op_withcar, v_car, null,
      '[{"type":"text","style":"normal","text":"Still here."}]'::jsonb,
      array['https://proj.supabase.co/storage/v1/object/public/activity-images/' || v_author || '/car.jpg']
    );

  -- W-5 boundary: neither a car nor a part is not a post.
  v_rejected := false;
  begin
    perform public.write_activity_post(
      'quick', v_op_nopart, null, null,
      '[{"type":"text","style":"normal","text":"About nothing."}]'::jsonb,
      array['https://proj.supabase.co/storage/v1/object/public/activity-images/' || v_author || '/nothing.jpg']
    );
  exception when others then
    v_rejected := true;
  end;
  if not v_rejected then
    raise exception 'A post about neither a car nor a part was accepted';
  end if;

  perform set_config('role', 'none', true);

  -- 1. The Explore timeline carries it, and says whose it is (H-2 needs the
  --    owner; before 198000 the view had no such column).
  if not exists (
    select 1 from public.feed_events
     where kind = 'update' and id = v_post and owner_id = v_author
  ) then
    raise exception 'A carless post is missing from feed_events';
  end if;

  -- 2. Search finds it. `search_update_ids` inner-joined cars until 198000.
  if not exists (select 1 from public.search_update_ids('manifold') as s(id) where s.id = v_post) then
    raise exception 'A carless post is unfindable by search';
  end if;

  -- 3. Local finds it, and only for the author's own patch.
  if not exists (
    select 1 from public.local_feed_rows('GB', 'Yorkshire') r where r.id = v_post
  ) then
    raise exception 'A carless post is missing from Local';
  end if;
  if exists (
    select 1 from public.local_feed_rows('GB', 'Devon') r where r.id = v_post
  ) then
    raise exception 'A carless post leaked into the wrong region';
  end if;

  -- 4. Its URL. A carless post gets /posts/<id>; a post with a car keeps the
  --    address every link already in the world points at.
  if public.post_href(v_post) <> '/posts/' || v_post then
    raise exception 'post_href gave % for a carless post', public.post_href(v_post);
  end if;
  if public.post_href(v_carful_post) <> '/cars/carless-guard-car/activity/' || v_carful_post then
    raise exception 'post_href changed the address of a post WITH a car: %',
      public.post_href(v_carful_post);
  end if;

  -- 5. Somebody saves it and the author hears about it. This is the one that
  --    used to fail silently: notify_on_save's inner join found no row, so
  --    v_owner stayed null and the branch that sends the notification never
  --    ran — the save worked, the author was never told.
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_fan, 'role', 'authenticated')::text, true);
  insert into public.saves(user_id, target_type, target_id) values (v_fan, 'post', v_post);
  perform set_config('role', 'none', true);

  select n.user_id, n.href into v_owner, v_href
    from public.notifications n
   where n.kind = 'save' and n.href = '/posts/' || v_post
   order by n.created_at desc limit 1;
  if v_owner is distinct from v_author then
    raise exception 'The author was not notified of a save on a carless post';
  end if;

  -- 6. A comment and a reaction link to the same place.
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_fan, 'role', 'authenticated')::text, true);
  insert into public.activity_comments(post_id, author_id, body)
    values (v_post, v_fan, 'Is the manifold still available?');
  insert into public.activity_reactions(post_id, user_id, emoji)
    values (v_post, v_fan, '🔥');
  perform set_config('role', 'none', true);

  select count(*) into v_count
    from public.notifications n
   where n.href = '/posts/' || v_post and n.kind in ('comment', 'reaction');
  if v_count <> 2 then
    raise exception 'Expected a comment and a reaction notification; found %', v_count;
  end if;
  if exists (select 1 from public.notifications where href like '/cars//activity/%') then
    raise exception 'A notification built a broken carless href';
  end if;

  raise notice 'all carless-post checks passed';
end;
$$;

rollback;
