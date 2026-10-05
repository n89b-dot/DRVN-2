-- Who may read updates (migration 20261011121000). Transactional; disposable
-- local database only.
--
-- That migration changed how the update read rule asks about the update's
-- car (by key, not by hashing every public car). It must not change the
-- answer. This states the answer for each kind of reader and checks the
-- policy gives it. It passes against the old policy too.
begin;

do $$
declare
  v_author uuid := gen_random_uuid();
  v_suspended uuid := gen_random_uuid();
  v_viewer uuid := gen_random_uuid();
  v_car uuid := gen_random_uuid();
  v_private_car uuid := gen_random_uuid();
  v_suspended_car uuid := gen_random_uuid();
  u uuid[] := array(select gen_random_uuid() from generate_series(1, 6));
  v_seen uuid[];
  v_expected uuid[];
  v_reader record;
begin
  update public.beta_access_config set enforced = false where singleton;
  insert into auth.users(id, email) values
    (v_author, 'post-rules-author@drvn.test'), (v_suspended, 'post-rules-suspended@drvn.test'), (v_viewer, 'post-rules-viewer@drvn.test');
  insert into public.profiles(id, username) values
    (v_author, 'post_rules_author'), (v_suspended, 'post_rules_suspended'), (v_viewer, 'post_rules_viewer')
    on conflict (id) do update set username = excluded.username;
  insert into public.cars(id, owner_id, slug, name, is_public) values
    (v_car, v_author, 'post-rules-public', 'Post rules public', true),
    (v_private_car, v_author, 'post-rules-private', 'Post rules private', false),
    (v_suspended_car, v_suspended, 'post-rules-suspended', 'Post rules suspended', true);
  -- 1 public car, 2 private car, 3 no car, 4 an archived draft on the public
  -- car, 5 a suspended member's public car, 6 the suspended member's own
  -- update with no car.
  insert into public.activity_posts(id, car_id, author_id, title, body, published_at, draft_archived_at) values
    (u[1], v_car, v_author, 'Rules post public', '{"type":"doc","content":[]}', now(), null),
    (u[2], v_private_car, v_author, 'Rules post private', '{"type":"doc","content":[]}', now(), null),
    (u[3], null, v_author, 'Rules post carless', '{"type":"doc","content":[]}', now(), null),
    (u[4], v_car, v_author, 'Rules post draft', '{"type":"doc","content":[]}', null, now()),
    (u[5], v_suspended_car, v_suspended, 'Rules post suspended car', '{"type":"doc","content":[]}', now(), null),
    (u[6], null, v_suspended, 'Rules post suspended carless', '{"type":"doc","content":[]}', now(), null);
  update public.profiles set suspended_at = now(), suspended_reason = 'guard' where id = v_suspended;

  for v_reader in
    select * from (values
      ('anon', null::uuid, array[u[1], u[3], u[6]]),
      ('viewer', v_viewer, array[u[1], u[3], u[6]]),
      ('author', v_author, array[u[1], u[2], u[3], u[4], u[6]]),
      ('suspended', v_suspended, array[u[1], u[3], u[5], u[6]])) r(who, id, expected)
  loop
    perform set_config('role', case when v_reader.id is null then 'anon' else 'authenticated' end, true);
    perform set_config('request.jwt.claims', case when v_reader.id is null then '' else json_build_object('sub', v_reader.id, 'role', 'authenticated')::text end, true);
    select coalesce(array_agg(id order by id), '{}') into v_seen from public.activity_posts where id = any(u);
    select array_agg(x order by x) into v_expected from unnest(v_reader.expected) x;
    if v_seen <> v_expected then
      raise exception '% reads updates % but should read %', v_reader.who, v_seen, v_expected;
    end if;
    perform set_config('role', 'supabase_admin', true);
  end loop;

  raise notice 'all update read rule checks passed';
end $$;

rollback;
