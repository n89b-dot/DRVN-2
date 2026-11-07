-- OS-W22 (20261107180000, 20261107180100): social reads are complete past
-- every cap they used to stop at, and what pointed at a deleted thing goes
-- with it.
--
--   N30  counts past 1,000 rows: likes, questions, reviews, reactions
--   N31  the Following feed for a member following 1,100 people; Saved's
--        sections and totals without an id list
--   N56  1,120 replies paged completely, each with its author's name
--   N60  a build with 63 updates, three on one timestamp, paged completely
--   N61  saves, follows, likes and notifications of deleted things go
--   N68  130 saved builds, each Saved section paged on its own
begin;

do $$
declare
  v_owner uuid := gen_random_uuid();
  viewer uuid := gen_random_uuid();
  stranger uuid := gen_random_uuid();
  car uuid := gen_random_uuid();
  hidden_car uuid := gen_random_uuid();
  part uuid := gen_random_uuid();
  draft_part uuid := gen_random_uuid();
  busy_post uuid := gen_random_uuid();
  hidden_post uuid := gen_random_uuid();
  fans uuid[];
  saved_cars uuid[];
  saved_parts uuid[];
  seen uuid[];
  page_ids uuid[];
  r record;
  n integer;
  v_total integer;
  pages integer;
  v_at timestamptz;
  last_id uuid;
  tie timestamptz := '2026-06-01 12:00:00.123456+00';
  avg_expected numeric;
begin
  update public.beta_access_config set enforced = false where singleton = true;

  -- ── Fixtures ────────────────────────────────────────────────────────────
  insert into auth.users(id, email, raw_user_meta_data) values
    (v_owner, 'swr-owner@drvn.test', '{}'), (viewer, 'swr-viewer@drvn.test', '{}'),
    (stranger, 'swr-stranger@drvn.test', '{}');
  insert into auth.users(id, email, raw_user_meta_data)
    select gen_random_uuid(), 'swr-fan-' || g || '@drvn.test', '{}' from generate_series(1, 1200) g;
  select array_agg(u.id order by u.email) into fans from auth.users u where u.email like 'swr-fan-%@drvn.test';
  if cardinality(fans) <> 1200 then raise exception 'fixture: % fans', cardinality(fans); end if;
  update public.profiles set username = 'swr_owner', display_name = 'Owner Person' where id = v_owner;
  update public.profiles p set display_name = 'Fan ' || f.n
    from unnest(fans) with ordinality f(id, n) where p.id = f.id;

  insert into public.cars(id, owner_id, slug, name, is_public) values
    (car, v_owner, 'swr-build', 'SWR build', true),
    (hidden_car, v_owner, 'swr-hidden', 'SWR hidden', false);
  insert into public.cars(owner_id, slug, name, is_public, created_at)
    select v_owner, 'swr-saved-' || g, 'Saved build ' || g, true, now() - make_interval(mins => g)
    from generate_series(1, 130) g;
  select array_agg(c.id order by c.slug) into saved_cars from public.cars c where c.slug like 'swr-saved-%';

  insert into public.listings(id, seller_id, title, category, price_cents, status, source_car_id) values
    (part, v_owner, 'SWR busy part', 'performance', 5000, 'active', car),
    (draft_part, v_owner, 'SWR draft part', 'performance', 5000, 'draft', null);
  insert into public.listings(seller_id, title, category, price_cents, status, created_at)
    select v_owner, 'SWR saved part ' || g, 'performance', 1000 + (g % 7) * 100, 'active', now() - make_interval(mins => g)
    from generate_series(1, 110) g;
  select array_agg(l.id) into saved_parts from public.listings l where l.title like 'SWR saved part %';

  insert into public.activity_posts(id, car_id, author_id, title, body, published_at) values
    (busy_post, car, v_owner, 'SWR busy update', '{"type":"doc","content":[]}', now() - interval '1 day'),
    (hidden_post, hidden_car, v_owner, 'SWR hidden update', '{"type":"doc","content":[]}', now());
  -- 60 more updates on the build, three of them sharing one timestamp.
  insert into public.activity_posts(car_id, author_id, title, body, published_at)
    select car, v_owner, 'SWR update ' || g, '{"type":"doc","content":[]}',
           case when g <= 3 then tie else now() - make_interval(days => 2, hours => g) end
    from generate_series(1, 60) g;

  -- Engagement rows in bulk, past 1,000 each. Replica mode skips the
  -- notification triggers for these (they're not what is tested here) and
  -- lets reviews stand without orders behind them.
  perform set_config('session_replication_role', 'replica', true);
  insert into public.likes(user_id, target_type, target_id) select f, 'listing', part from unnest(fans) f;
  insert into public.listing_questions(listing_id, author_id, body)
    select part, f, 'Does it fit?' from unnest(fans[1:1100]) f;
  insert into public.reviews(order_id, reviewer_id, reviewee_id, rating, body)
    select gen_random_uuid(), f.id, v_owner, 1 + (f.n % 5), null from unnest(fans[1:1050]) with ordinality f(id, n);
  insert into public.activity_reactions(post_id, user_id, emoji) select busy_post, f, '🔥' from unnest(fans[1:1150]) f;
  insert into public.activity_reactions(post_id, user_id, emoji) select busy_post, f, '🤙' from unnest(fans[1:30]) f;
  insert into public.activity_comments(post_id, author_id, body, created_at)
    select busy_post, f.id, 'Reply ' || f.n, case when f.n <= 4 then tie else now() - make_interval(secs => f.n::integer) end
    from unnest(fans[1:1120]) with ordinality f(id, n);
  -- The viewer follows 1,100 people with nothing to show, then the owner and
  -- the build: the old read stopped at 1,000 follows.
  insert into public.follows(follower_id, target_type, target_id, created_at)
    select viewer, 'profile', f, now() - interval '1 year' from unnest(fans[1:1100]) f;
  insert into public.saves(user_id, target_type, target_id, created_at)
    select viewer, 'car', c.id, now() - make_interval(mins => c.n::integer) from unnest(saved_cars) with ordinality c(id, n);
  insert into public.follows(follower_id, target_type, target_id, created_at)
    select viewer, 'car', c.id, now() - make_interval(mins => c.n::integer) from unnest(saved_cars) with ordinality c(id, n);
  insert into public.saves(user_id, target_type, target_id)
    select viewer, 'listing', l from unnest(saved_parts) l;
  insert into public.saves(user_id, target_type, target_id) values
    (viewer, 'listing', draft_part), (viewer, 'post', busy_post), (viewer, 'post', hidden_post);
  perform set_config('session_replication_role', 'origin', true);
  insert into public.follows(follower_id, target_type, target_id) values
    (viewer, 'profile', v_owner), (viewer, 'car', car);

  -- ── Shape and rights ────────────────────────────────────────────────────
  select count(*) into n from pg_proc
   where pronamespace = 'public'::regnamespace and prosecdef
     and proname in ('listing_engagement_counts', 'seller_review_summaries', 'post_reaction_counts',
                     'post_comment_page', 'car_update_page', 'followed_feed_rows', 'saved_counts',
                     'saved_listing_page', 'saved_page');
  if n <> 0 then raise exception 'Retrieval functions must run with the caller''s rights'; end if;
  if has_function_privilege('anon', 'public.followed_feed_rows(integer,integer,timestamptz,uuid)', 'execute')
     or has_function_privilege('anon', 'public.saved_counts()', 'execute')
     or has_function_privilege('anon', 'public.saved_page(text,integer,timestamptz,uuid)', 'execute')
     or has_function_privilege('anon', 'public.saved_listing_page(text,text,integer,integer)', 'execute') then
    raise exception 'A signed-out caller can read a member''s follows or saves';
  end if;
  if has_function_privilege('anon', 'public.notification_href_target(text)', 'execute')
     or has_function_privilege('authenticated', 'public.notification_href_target(text)', 'execute') then
    raise exception 'notification_href_target is callable by a client';
  end if;

  -- ── N30: counts past 1,000 ──────────────────────────────────────────────
  perform set_config('role', 'anon', true);
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  select * into r from public.listing_engagement_counts(array[part, draft_part]) where listing_id = part;
  if r.likes is distinct from 1200 or r.questions is distinct from 1100 then
    raise exception 'N30: part counts % likes, % questions; expected 1200 and 1100', r.likes, r.questions;
  end if;
  select avg(1 + (g % 5))::numeric into avg_expected from generate_series(1, 1050) g;
  select * into r from public.seller_review_summaries(array[v_owner, stranger]);
  if r.seller_id is distinct from v_owner or r.review_count is distinct from 1050 or r.rating_avg <> avg_expected then
    raise exception 'N30: seller summary %, expected 1050 reviews averaging %', row_to_json(r), avg_expected;
  end if;
  select count(*) into n from public.seller_review_summaries(array[v_owner, stranger]);
  if n <> 1 then raise exception 'N30: a seller with no reviews got a summary row'; end if;
  begin
    perform public.listing_engagement_counts(array(select gen_random_uuid() from generate_series(1, 201)));
    raise exception 'N30: listing_engagement_counts took 201 ids';
  exception when invalid_parameter_value then null;
  end;

  -- ── N56: reactions and every reply ──────────────────────────────────────
  select x.total into n from public.post_reaction_counts(busy_post) x where x.emoji = '🔥';
  if n is distinct from 1150 then raise exception 'N56: % fire reactions, expected 1150', n; end if;
  if exists (select 1 from public.post_reaction_counts(busy_post) x where x.reacted) then
    raise exception 'N56: a guest is marked as having reacted';
  end if;
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', fans[10], 'role', 'authenticated')::text, true);
  if not (select x.reacted from public.post_reaction_counts(busy_post) x where x.emoji = '🤙') then
    raise exception 'N56: the viewer''s own reaction is not marked';
  end if;
  perform set_config('role', 'anon', true);
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);

  seen := '{}'; v_at := null; last_id := null; pages := 0;
  loop
    select array_agg(c.id order by c.created_at desc, c.id desc), count(*) filter (where c.author_display_name is null)
      into page_ids, n
      from public.post_comment_page(busy_post, 100, v_at, last_id) c;
    exit when page_ids is null;
    if n > 0 then raise exception 'N56: % replies on a page came without their author''s name', n; end if;
    pages := pages + 1;
    seen := seen || page_ids;
    select c.created_at, c.id into v_at, last_id
      from public.post_comment_page(busy_post, 100, v_at, last_id) c
      order by c.created_at, c.id limit 1;
    exit when pages > 20;
  end loop;
  if cardinality(seen) <> 1120 or (select count(distinct x) from unnest(seen) x) <> 1120 or pages <> 12 then
    raise exception 'N56: paging read % replies (% distinct) in % pages; expected 1120 in 12',
      cardinality(seen), (select count(distinct x) from unnest(seen) x), pages;
  end if;
  if (select count(*) from public.post_comment_page(busy_post, 5000)) <> 101 then
    raise exception 'N56: a reply page is not bounded';
  end if;

  -- ── N60: every update on a long build ───────────────────────────────────
  seen := '{}'; v_at := null; last_id := null; pages := 0;
  loop
    select array_agg(p.id order by p.published_at desc, p.id desc) into page_ids
      from public.car_update_page(car, 50, v_at, last_id) p;
    exit when page_ids is null;
    pages := pages + 1;
    seen := seen || page_ids;
    select p.published_at, p.id into v_at, last_id
      from public.car_update_page(car, 50, v_at, last_id) p
      order by p.published_at, p.id limit 1;
    exit when pages > 5;
  end loop;
  if cardinality(seen) <> 61 or (select count(distinct x) from unnest(seen) x) <> 61 or pages <> 2 then
    raise exception 'N60: paging read % updates in % pages; expected 61 in 2', cardinality(seen), pages;
  end if;
  if exists (select 1 from public.car_update_page(hidden_car, 50)) then
    raise exception 'N60: a guest read a private build''s updates';
  end if;

  -- ── N31: the Following feed, 1,100 follows deep ─────────────────────────
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', viewer, 'role', 'authenticated')::text, true);
  -- Expected: the owner's 61 published updates on public builds (the hidden
  -- build's is not visible), the owner's 131 public cars, and 111 active
  -- parts — the busy part reached by seller and by car, once.
  seen := '{}'; v_at := null; last_id := null; pages := 0;
  loop
    select array_agg(f.id order by f.happened_at desc, f.id desc) into page_ids
      from public.followed_feed_rows(20, 0, v_at, last_id) f;
    exit when page_ids is null;
    pages := pages + 1;
    seen := seen || page_ids;
    select f.happened_at, f.id into v_at, last_id
      from public.followed_feed_rows(20, 0, v_at, last_id) f
      order by f.happened_at, f.id limit 1;
    exit when pages > 40;
  end loop;
  if cardinality(seen) <> 303 or (select count(distinct x) from unnest(seen) x) <> 303 then
    raise exception 'N31: the Following feed read % rows (% distinct); expected 303',
      cardinality(seen), (select count(distinct x) from unnest(seen) x);
  end if;
  if not (part = any(seen)) or hidden_post = any(seen) then
    raise exception 'N31: the Following feed lost the busy part or showed a private build''s update';
  end if;
  -- Offset paging gives the same rows as the cursor walk.
  select array_agg(f.id order by f.happened_at desc, f.id desc) into page_ids from public.followed_feed_rows(20, 20) f;
  if page_ids is distinct from seen[21:40] then raise exception 'N31: offset page 2 differs from the cursor walk'; end if;
  -- Only the caller's own follows: a stranger follows nothing.
  perform set_config('request.jwt.claims', jsonb_build_object('sub', stranger, 'role', 'authenticated')::text, true);
  if exists (select 1 from public.followed_feed_rows(20)) then
    raise exception 'N31: the Following feed read someone else''s follows';
  end if;

  -- ── N31 / N61 / N68: Saved ──────────────────────────────────────────────
  perform set_config('request.jwt.claims', jsonb_build_object('sub', viewer, 'role', 'authenticated')::text, true);
  select * into r from public.saved_counts();
  if r.parts <> 110 or r.unavailable_parts <> 1 or r.builds <> 130 or r.posts <> 1
     or r.followed_builds <> 131 or r.followed_sellers <> 1101 then
    raise exception 'Saved counts %', row_to_json(r);
  end if;

  select count(*), max(p.total) into n, v_total from public.saved_listing_page(null, 'newest', 24, 96) p;
  if n <> 14 or v_total <> 110 then raise exception 'Saved parts page 5: % rows of %', n, v_total; end if;
  select max(p.total) into v_total from public.saved_listing_page('part 10', 'price', 24, 0) p;
  -- "part 10" is in parts 10 and 100 to 109.
  if v_total <> 11 then raise exception 'Saved parts search found % (expected 11)', v_total; end if;
  select array_agg(p.listing_id) into page_ids from public.saved_listing_page(null, 'price', 100, 0) p;
  select array_agg(x) into seen from (select listing_id x from public.saved_listing_page(null, 'price', 100, 100)) q;
  if cardinality(page_ids) + cardinality(seen) <> 110 or exists (select 1 from unnest(seen) x where x = any(page_ids)) then
    raise exception 'Saved parts price pages overlap or skip';
  end if;

  for r in select * from (values ('build', 130), ('followed_build', 131), ('followed_seller', 1101),
                                 ('post', 1), ('unavailable_part', 1)) v(collection, expected)
  loop
    seen := '{}'; v_at := null; last_id := null; pages := 0;
    loop
      select array_agg(s.target_id order by s.saved_at desc, s.target_id desc) into page_ids
        from public.saved_page(r.collection, 24, v_at, last_id) s;
      exit when page_ids is null;
      pages := pages + 1;
      seen := seen || page_ids;
      select s.saved_at, s.target_id into v_at, last_id
        from public.saved_page(r.collection, 24, v_at, last_id) s
        order by s.saved_at, s.target_id limit 1;
      exit when pages > 60;
    end loop;
    if cardinality(seen) <> r.expected or (select count(distinct x) from unnest(seen) x) <> r.expected then
      raise exception 'Saved %: paged % (expected %)', r.collection, cardinality(seen), r.expected;
    end if;
  end loop;
  if (select array_agg(s.target_id) from public.saved_page('unavailable_part', 24) s) <> array[draft_part] then
    raise exception 'Saved: the hidden part is not the unavailable one';
  end if;
  begin
    perform public.saved_page('everything', 24);
    raise exception 'saved_page took an unknown collection';
  exception when invalid_parameter_value then null;
  end;
  perform set_config('role', 'supabase_admin', true);

  -- ── N61: deleting a thing forgets what pointed at it ────────────────────
  -- Notifications name their subject from their link.
  if public.notification_href_target('/posts/' || busy_post) is distinct from busy_post
     or public.notification_href_target('/cars/swr-build/activity/' || busy_post || '?r=1') is distinct from busy_post
     or public.notification_href_target('/listings/' || part || '#questions') is distinct from part
     or public.notification_href_target('/cars/swr-build') is distinct from car
     or public.notification_href_target('/cars/swr-hidden/') is distinct from hidden_car
     or public.notification_href_target('/u/swr_owner') is distinct from v_owner
     or public.notification_href_target('/orders/' || part) is not null
     or public.notification_href_target('/cars/no-such-build') is not null
     or public.notification_href_target(null) is not null then
    raise exception 'N61: notification_href_target misread a link';
  end if;

  -- Real events, through the real triggers: the stranger saves and follows.
  insert into public.saves(user_id, target_type, target_id) values
    (stranger, 'post', busy_post), (stranger, 'listing', part), (stranger, 'car', car);
  insert into public.follows(follower_id, target_type, target_id) values (stranger, 'car', car);
  insert into public.likes(user_id, target_type, target_id) values (stranger, 'car', car);
  select count(*) into n from public.notifications where user_id = v_owner and actor_id = stranger and target_id is not null;
  if n < 4 then raise exception 'N61: the stranger''s saves and follow raised % targeted notifications', n; end if;

  delete from public.activity_posts where id = busy_post;
  if exists (select 1 from public.saves where target_type = 'post' and target_id = busy_post)
     or exists (select 1 from public.notifications where target_id = busy_post) then
    raise exception 'N61: a deleted update left saves or notifications behind';
  end if;
  delete from public.listings where id = part;
  if exists (select 1 from public.saves where target_type = 'listing' and target_id = part)
     or exists (select 1 from public.likes where target_type = 'listing' and target_id = part)
     or exists (select 1 from public.notifications where target_id = part) then
    raise exception 'N61: a deleted part left saves, likes or notifications behind';
  end if;
  delete from public.cars where id = car;
  if exists (select 1 from public.saves where target_type = 'car' and target_id = car)
     or exists (select 1 from public.follows where target_type = 'car' and target_id = car)
     or exists (select 1 from public.likes where target_type = 'car' and target_id = car)
     or exists (select 1 from public.notifications where target_id = car) then
    raise exception 'N61: a deleted build left saves, follows, likes or notifications behind';
  end if;
  -- What is left for the viewer is what still exists.
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', viewer, 'role', 'authenticated')::text, true);
  select * into r from public.saved_counts();
  if r.posts <> 0 or r.followed_builds <> 130 then
    raise exception 'N61: Saved still counts deleted things: %', row_to_json(r);
  end if;
  perform set_config('role', 'supabase_admin', true);

  raise notice 'all social retrieval checks passed';
end $$;

rollback;
