-- R2-09: anyone who can see a listing can see how many people watch it —
-- a number, never who — and nothing about listings they can't see.
begin;

do $$
declare
  seller uuid := gen_random_uuid();
  banned uuid := gen_random_uuid();
  buyer uuid := gen_random_uuid();
  watcher_a uuid := gen_random_uuid();
  watcher_b uuid := gen_random_uuid();
  watched uuid := gen_random_uuid();
  unwatched uuid := gen_random_uuid();
  held uuid := gen_random_uuid();
  draft uuid := gen_random_uuid();
  hidden uuid := gen_random_uuid();
  ids uuid[];
  n integer;
  rejected boolean := false;
  hydrated jsonb;
begin
  update public.beta_access_config set enforced = false where singleton = true;
  insert into auth.users(id, email, raw_user_meta_data) values
    (seller, 'watch-seller@drvn.test', '{}'), (banned, 'watch-banned@drvn.test', '{}'),
    (buyer, 'watch-buyer@drvn.test', '{}'), (watcher_a, 'watch-a@drvn.test', '{}'),
    (watcher_b, 'watch-b@drvn.test', '{}');
  insert into public.listings(id, seller_id, title, category, price_cents, status) values
    (watched, seller, 'Watched', 'performance', 1000, 'active'),
    (unwatched, seller, 'Nobody yet', 'performance', 1000, 'active'),
    (held, seller, 'In a checkout', 'performance', 1000, 'active'),
    (draft, seller, 'Draft', 'performance', 1000, 'draft'),
    (hidden, banned, 'Suspended seller', 'performance', 1000, 'active');
  update public.listings set status = 'reserved' where id = held;
  insert into public.saves(user_id, target_type, target_id) values
    (watcher_a, 'listing', watched), (watcher_b, 'listing', watched),
    (watcher_a, 'listing', held), (watcher_a, 'listing', draft), (watcher_a, 'listing', hidden);
  update public.profiles set suspended_at = now(), suspended_reason = 'guard' where id = banned;
  ids := array[watched, unwatched, held, draft, hidden];

  -- 1. A guest gets counts for what a guest can see: 2, a real 0, the held
  --    part's 1 — and nothing for the draft or the suspended seller's part.
  perform set_config('role', 'anon', true);
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  if (select watchers from public.listing_watch_counts(ids) where listing_id = watched) is distinct from 2
     or (select watchers from public.listing_watch_counts(ids) where listing_id = unwatched) is distinct from 0
     or (select watchers from public.listing_watch_counts(ids) where listing_id = held) is distinct from 1
     or exists (select 1 from public.listing_watch_counts(ids) where listing_id in (draft, hidden)) then
    raise exception 'Guest counts wrong: %', (select jsonb_agg(w) from public.listing_watch_counts(ids) w);
  end if;
  -- The savers themselves stay private.
  select count(*) into n from public.saves where target_id = watched;
  if n <> 0 then raise exception 'A guest can read who saved a listing'; end if;

  -- 2. A signed-in buyer: same answer, still no identities.
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', buyer, 'role', 'authenticated')::text, true);
  if (select watchers from public.listing_watch_counts(ids) where listing_id = watched) is distinct from 2
     or exists (select 1 from public.listing_watch_counts(ids) where listing_id in (draft, hidden)) then
    raise exception 'Buyer counts wrong';
  end if;
  select count(*) into n from public.saves where target_id = watched;
  if n <> 0 then raise exception 'A buyer can read who saved a listing'; end if;

  -- 3. The seller also sees their own draft's count.
  perform set_config('request.jwt.claims', jsonb_build_object('sub', seller, 'role', 'authenticated')::text, true);
  if (select watchers from public.listing_watch_counts(ids) where listing_id = draft) is distinct from 1 then
    raise exception 'Seller cannot count their own draft';
  end if;

  -- 4. Feed cards carry the same public count.
  perform set_config('role', 'anon', true);
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  hydrated := public.feed_hydration(null, null, array[watched, draft]);
  if (select (x->>'watch_count')::int from jsonb_array_elements(hydrated->'listings') x where x->>'id' = watched::text) is distinct from 2 then
    raise exception 'Feed hydration did not carry the watcher count: %', hydrated->'listings';
  end if;

  -- 5. Bounded.
  begin
    perform public.listing_watch_counts(array(select gen_random_uuid() from generate_series(1, 201)));
  exception when invalid_parameter_value then rejected := true; end;
  if not rejected then raise exception 'Unbounded watcher count call'; end if;

  perform set_config('role', 'none', true);
  if (select pg_get_function_result('public.listing_watch_counts(uuid[])'::regprocedure))
       <> 'TABLE(listing_id uuid, watchers integer)' then
    raise exception 'listing_watch_counts returns more than a count';
  end if;
  raise notice 'all listing watcher count checks passed';
end $$;

rollback;
