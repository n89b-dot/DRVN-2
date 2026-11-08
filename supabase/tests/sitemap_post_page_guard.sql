-- The posts sitemap page (migration 20261107150000, OS-W26 N63).
-- Transactional; disposable local database only.
--
-- sitemap_post_page lists, for a signed-out visitor, exactly the published
-- updates a crawler may be sent to: none on a private or suspended member's
-- car, none still a draft, and none by a suspended member even without a
-- car. It must hold past 1,000 suspended members — the app-side version
-- read the suspended set over the Data API, which caps it at 1,000 rows and
-- let the rest through — and a page must never exceed 1,000 rows.
begin;

do $$
declare
  v_author uuid := gen_random_uuid();
  v_suspended uuid := gen_random_uuid();
  v_car uuid := gen_random_uuid();
  v_private_car uuid := gen_random_uuid();
  v_suspended_car uuid := gen_random_uuid();
  u uuid[] := array(select gen_random_uuid() from generate_series(1, 6));
  v_many uuid[] := array(select gen_random_uuid() from generate_series(1, 1001));
  v_page_rows int;
  v_start int := 0;
  v_seen uuid[] := '{}';
  v_many_seen int;
  v_slug text;
  v_carless_slug text;
begin
  insert into auth.users(id, email) values
    (v_author, 'sitemap-guard-author@drvn.test'), (v_suspended, 'sitemap-guard-suspended@drvn.test');
  insert into auth.users(id, email)
    select id, 'sitemap-guard-many-' || n || '@drvn.test' from unnest(v_many) with ordinality t(id, n);
  insert into public.profiles(id, username) values
    (v_author, 'sitemap_guard_author'), (v_suspended, 'sitemap_guard_suspended')
    on conflict (id) do update set username = excluded.username;
  insert into public.profiles(id, username)
    select id, 'sitemap_guard_many_' || n from unnest(v_many) with ordinality t(id, n)
    on conflict (id) do update set username = excluded.username;
  insert into public.cars(id, owner_id, slug, name, is_public) values
    (v_car, v_author, 'sitemap-guard-public', 'Sitemap guard public', true),
    (v_private_car, v_author, 'sitemap-guard-private', 'Sitemap guard private', false),
    (v_suspended_car, v_suspended, 'sitemap-guard-suspended', 'Sitemap guard suspended', true);
  -- 1 public car, 2 private car, 3 no car, 4 a draft on the public car,
  -- 5 a suspended member's public car, 6 a suspended member's carless update.
  insert into public.activity_posts(id, car_id, author_id, title, body, published_at, draft_archived_at) values
    (u[1], v_car, v_author, 'Sitemap post public', '{"type":"doc","content":[]}', now(), null),
    (u[2], v_private_car, v_author, 'Sitemap post private', '{"type":"doc","content":[]}', now(), null),
    (u[3], null, v_author, 'Sitemap post carless', '{"type":"doc","content":[]}', now(), null),
    (u[4], v_car, v_author, 'Sitemap post draft', '{"type":"doc","content":[]}', null, now()),
    (u[5], v_suspended_car, v_suspended, 'Sitemap post suspended car', '{"type":"doc","content":[]}', now(), null),
    (u[6], null, v_suspended, 'Sitemap post suspended carless', '{"type":"doc","content":[]}', now(), null);
  -- 1,001 more suspended members, each with a published carless update.
  insert into public.activity_posts(id, car_id, author_id, title, body, published_at)
    select gen_random_uuid(), null, id, 'Sitemap post many', '{"type":"doc","content":[]}', now() from unnest(v_many) t(id);
  update public.profiles set suspended_at = now(), suspended_reason = 'guard'
    where id = v_suspended or id = any(v_many);

  -- Who may call it: visitors and members, not the row-security-bypassing service role.
  if not has_function_privilege('anon', 'public.sitemap_post_page(integer, integer)', 'execute')
     or not has_function_privilege('authenticated', 'public.sitemap_post_page(integer, integer)', 'execute') then
    raise exception 'FAIL 1: sitemap_post_page must be callable by anon and authenticated';
  end if;
  if has_function_privilege('service_role', 'public.sitemap_post_page(integer, integer)', 'execute')
     or has_function_privilege('public', 'public.sitemap_post_page(integer, integer)', 'execute') then
    raise exception 'FAIL 1: sitemap_post_page must not be callable by service_role or public';
  end if;

  perform set_config('role', 'anon', true);
  perform set_config('request.jwt.claims', '', true);

  -- A page never exceeds 1,000 rows, whatever is asked for.
  select count(*) into v_page_rows from public.sitemap_post_page(0, 5000);
  if v_page_rows > 1000 then
    raise exception 'FAIL 2: a sitemap page returned % rows, more than 1,000', v_page_rows;
  end if;

  -- Walk every page, the way the sitemap index does.
  loop
    select count(*) into v_page_rows from public.sitemap_post_page(v_start, 1000);
    exit when v_page_rows = 0;
    v_seen := v_seen || array(select id from public.sitemap_post_page(v_start, 1000));
    v_slug := coalesce(v_slug, (select car_slug from public.sitemap_post_page(v_start, 1000) where id = u[1]));
    v_carless_slug := coalesce(v_carless_slug, (select coalesce(car_slug, '') from public.sitemap_post_page(v_start, 1000) where id = u[3]));
    v_start := v_start + 1000;
  end loop;

  if (select coalesce(array_agg(x order by x), '{}') from unnest(v_seen) x where x = any(u))
     <> (select array_agg(x order by x) from unnest(array[u[1], u[3]]) x) then
    raise exception 'FAIL 3: the sitemap lists updates % of the guard set, should list only % and %',
      (select array_agg(x) from unnest(v_seen) x where x = any(u)), u[1], u[3];
  end if;

  select count(*) into v_many_seen from unnest(v_seen) x
    join public.activity_posts p on p.id = x where p.author_id = any(v_many);
  if v_many_seen > 0 then
    raise exception 'FAIL 4: % carless updates by suspended members are in the sitemap (past 1,000 suspended members)', v_many_seen;
  end if;

  if (select count(*) from unnest(v_seen) x group by x having count(*) > 1 limit 1) is not null then
    raise exception 'FAIL 5: an update appears on two sitemap pages';
  end if;

  if v_slug is distinct from 'sitemap-guard-public' then
    raise exception 'FAIL 6: an update on a public car must carry its car slug (got %)', v_slug;
  end if;
  if v_carless_slug is distinct from '' then
    raise exception 'FAIL 6: a carless update must have no car slug (got %)', v_carless_slug;
  end if;

  perform set_config('role', 'supabase_admin', true);
  raise notice 'all sitemap post page checks passed';
end $$;

rollback;
