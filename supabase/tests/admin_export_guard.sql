-- N133 (20261107200520, 20261107200550): console exports and member filters
-- read every row they say they do. 1,205 orders page through
-- admin_export_orders in keyset pages with nothing lost or repeated, names
-- and titles joined; the Sellers / Sellers w/o payouts filters count 1,050
-- sellers exactly; the audit actor filter pages 1,050 matching actors in the
-- database. Only the service role may call these reads.
begin;

do $$
declare
  buyer uuid := gen_random_uuid();
  seller uuid := gen_random_uuid();
  other_buyer uuid := gen_random_uuid();
  actor uuid := gen_random_uuid();
  multi uuid;
  page_rows int;
  seen int := 0;
  distinct_seen int;
  last_at timestamptz;
  last_id uuid;
  r record;
  page jsonb;
begin
  insert into auth.users(id, email, raw_user_meta_data) values
    (buyer, 'export-buyer@example.test', '{"full_name": "Exportguard Buyer"}'),
    (seller, 'export-seller@example.test', '{"full_name": "Exportguard Seller"}'),
    (other_buyer, 'export-other@example.test', '{"full_name": "Exportguard Other"}'),
    (actor, 'export-actor@example.test', '{"full_name": "Exportguard Auditor"}');

  create temp table export_seen(id uuid) on commit drop;

  -- 1,205 orders: 1,200 from one buyer, 5 from another, a few seconds apart
  -- (and 100 sharing one timestamp, so the id tiebreak is exercised).
  insert into public.orders(buyer_id, seller_id, status, subtotal_cents, shipping_cents, platform_fee_cents, total_cents, currency, created_at)
  select case when g <= 1200 then buyer else other_buyer end, seller, 'paid', 1000 + g, 0, 100, 1000 + g, 'USD',
         case when g <= 100 then timestamptz '2026-10-01 12:00:00+00' else timestamptz '2026-10-01 12:00:00+00' + make_interval(secs => g) end
  from generate_series(1, 1205) g;
  select id into multi from public.orders where seller_id = seller order by created_at desc, id desc limit 1;
  insert into public.order_items(order_id, title, price_cents, quantity, shipping_cents, commercial_snapshot)
  values (multi, 'Exportguard turbo', 600, 1, 0, '{}'::jsonb), (multi, 'Exportguard manifold', 500, 1, 0, '{}'::jsonb);

  -- 1. Every order, in keyset pages of 500, nothing lost or repeated.
  loop
    page_rows := 0;
    for r in select * from public.admin_export_orders('orders', null, null, null, null, null, null, null, last_at, last_id, 500) loop
      if r.seller_id = seller then
        insert into export_seen values (r.id);
        if r.seller_display_name is distinct from 'Exportguard Seller' then
          raise exception 'FAIL 1: the seller''s name was not joined (%)', r.seller_display_name;
        end if;
        if r.id = multi and r.title is distinct from 'Exportguard turbo +1 more' and r.title is distinct from 'Exportguard manifold +1 more' then
          raise exception 'FAIL 2: a two-item order''s title is %', r.title;
        end if;
      end if;
      page_rows := page_rows + 1;
      last_at := r.sort_at; last_id := r.id;
    end loop;
    exit when page_rows < 500;
  end loop;
  select count(*), count(distinct id) into seen, distinct_seen from export_seen;
  if seen <> 1205 or distinct_seen <> 1205 then
    raise exception 'FAIL 3: the export read % rows (% distinct) of 1,205', seen, distinct_seen;
  end if;

  -- 2. A name filter is complete too: all 1,200 of one buyer's orders.
  truncate export_seen; last_at := null; last_id := null;
  loop
    page_rows := 0;
    for r in select * from public.admin_export_orders('orders', 'Exportguard Buyer', null, null, null, null, null, null, last_at, last_id, 500) loop
      insert into export_seen values (r.id);
      page_rows := page_rows + 1;
      last_at := r.sort_at; last_id := r.id;
    end loop;
    exit when page_rows < 500;
  end loop;
  if (select count(distinct id) from export_seen) <> 1200 then
    raise exception 'FAIL 4: the buyer filter exported % of 1,200', (select count(distinct id) from export_seen);
  end if;
  if exists (select 1 from export_seen s join public.orders o on o.id = s.id where o.buyer_id <> buyer) then
    raise exception 'FAIL 5: the buyer filter exported someone else''s order';
  end if;

  -- 3. Disputes views follow their own order and filters.
  insert into public.orders(buyer_id, seller_id, status, subtotal_cents, shipping_cents, platform_fee_cents, total_cents, currency, disputed_at, dispute_category, dispute_reason)
  select other_buyer, seller, 'disputed', 2000, 0, 200, 2000, 'USD', now() - make_interval(days => g), 'item_not_received', 'Exportguard dispute'
  from generate_series(1, 3) g;
  select count(*) into page_rows from public.admin_export_orders('disputes_open', 'Exportguard Other', null, 'item_not_received');
  if page_rows <> 3 then raise exception 'FAIL 6: open disputes export found % of 3', page_rows; end if;
  select count(*) into page_rows from public.admin_export_orders('disputes_open', 'Exportguard Other', null, 'wrong_item');
  if page_rows <> 0 then raise exception 'FAIL 7: the category filter was ignored'; end if;

  -- 4. Sellers: 1,050 accounts with a listing, 50 of them with payouts on.
  insert into auth.users(id, email, raw_user_meta_data)
  select gen_random_uuid(), 'export-seller-' || g || '@example.test', jsonb_build_object('full_name', 'Exportguard Lister ' || g)
  from generate_series(1, 1050) g;
  insert into public.listings(seller_id, title, category, price_cents, shipping_cents, status, currency)
  select p.id, 'Exportguard part', 'engine', 1000, 0, 'active', 'USD'
  from public.profiles p where p.display_name like 'Exportguard Lister %';
  update public.profiles set payouts_enabled = true
  where id in (select id from public.profiles where display_name like 'Exportguard Lister %' order by id limit 50);

  page := public.admin_users_page('Exportguard Lister', 'sellers', 0, 50);
  if (page->>'total')::int <> 1050 then raise exception 'FAIL 8: the Sellers filter counted % of 1,050', page->>'total'; end if;
  page := public.admin_users_page('Exportguard Lister', 'no_payouts', 1000, 200);
  if (page->>'total')::int <> 1000 then raise exception 'FAIL 9: Sellers w/o payouts counted % of 1,000', page->>'total'; end if;
  if jsonb_array_length(page->'rows') <> 0 then raise exception 'FAIL 10: a page past the end returned rows'; end if;
  page := public.admin_users_page('Exportguard Lister', 'no_payouts', 950, 200);
  if jsonb_array_length(page->'rows') <> 50 then raise exception 'FAIL 11: the last page held % of 50', jsonb_array_length(page->'rows'); end if;
  if (page->'rows'->0->>'listing_count')::int <> 1 or (page->'rows'->0->>'payouts_enabled')::boolean then
    raise exception 'FAIL 12: a row''s counts or payout state are wrong: %', page->'rows'->0;
  end if;
  page := public.admin_users_page('Exportguard Seller', 'sellers', 0, 50);
  -- 1,205 paid orders and the 3 disputed ones are all sales.
  if (page->>'total')::int <> 1 or (page->'rows'->0->>'sale_count')::int <> 1208 then
    raise exception 'FAIL 13: an order-only seller or their sale count is wrong: %', page;
  end if;
  page := public.admin_users_page('Exportguard Buyer', 'sellers', 0, 50);
  if (page->>'total')::int <> 0 then raise exception 'FAIL 14: a buyer counted as a seller'; end if;

  -- 5. The audit log filtered by actor name in the database (20261107200550):
  --    1,050 historical actors match one search, far past any URL's id list.
  insert into public.admin_users(user_id, role, note)
  select p.id, 'admin', 'export guard actor' from public.profiles p where p.display_name like 'Exportguard Lister %';
  insert into public.admin_audit_log(actor_id, action, subject_type, subject_id, reason)
  select p.id, 'note.internal', 'order', multi, 'export guard'
  from public.profiles p where p.display_name like 'Exportguard Lister %';
  insert into public.admin_users(user_id, role, note) values (actor, 'admin', 'export guard');
  insert into public.admin_audit_log(actor_id, action, subject_type, subject_id, reason)
  values (actor, 'note.internal', 'order', multi, 'export guard');

  truncate export_seen; seen := 0;
  declare
    before_at timestamptz;
    before_id bigint;
    a public.admin_audit_log;
  begin
    loop
      page_rows := 0;
      for a in select * from public.admin_audit_page(null, 'exportguard lister', null, null, null, before_at, before_id, 0, 500) loop
        insert into export_seen values (a.actor_id);
        page_rows := page_rows + 1;
        before_at := a.created_at; before_id := a.id;
      end loop;
      exit when page_rows < 500;
    end loop;
  end;
  if (select count(*) from export_seen) <> 1050 or (select count(distinct id) from export_seen) <> 1050 then
    raise exception 'FAIL 15: the actor filter paged % rows (% actors) of 1,050', (select count(*) from export_seen), (select count(distinct id) from export_seen);
  end if;
  if exists (select 1 from export_seen s join public.profiles p on p.id = s.id where p.display_name not like 'Exportguard Lister %') then
    raise exception 'FAIL 16: the actor filter matched someone else';
  end if;
  -- The screen's offset pages: the 21st page of 50 holds the last 50.
  select count(*) into page_rows from public.admin_audit_page(null, 'Exportguard Lister', null, null, null, null, null, 1000, 51);
  if page_rows <> 50 then raise exception 'FAIL 17: the last screen page held % of 50', page_rows; end if;
  select count(*) into page_rows from public.admin_audit_page('note.', 'Exportguard Auditor', 'order');
  if page_rows <> 1 then raise exception 'FAIL 17a: action, actor and subject filters together found %', page_rows; end if;
  select count(*) into page_rows from public.admin_audit_page('note.', 'Exportguard Seller');
  if page_rows <> 0 then raise exception 'FAIL 17b: a member who never acted matched as an audit actor'; end if;
  select count(*) into page_rows from public.admin_audit_page(null, 'Export_uard');
  if page_rows <> 0 then raise exception 'FAIL 17c: search text was read as a wildcard'; end if;
  select count(*) into page_rows from public.admin_audit_page('note%');
  if page_rows <> 0 then raise exception 'FAIL 17d: an action search was read as a wildcard'; end if;
  if to_regprocedure('public.admin_audit_actor_ids(text)') is not null then
    raise exception 'FAIL 17e: the id-list actor lookup is still installed';
  end if;

  -- 6. Service role only.
  if has_function_privilege('authenticated', 'public.admin_export_orders(text,text,text,text,timestamp with time zone,timestamp with time zone,integer,integer,timestamp with time zone,uuid,integer)', 'execute')
     or has_function_privilege('anon', 'public.admin_users_page(text,text,integer,integer)', 'execute')
     or has_function_privilege('authenticated', 'public.admin_users_page(text,text,integer,integer)', 'execute')
     or has_function_privilege('authenticated', 'public.admin_audit_page(text,text,text,timestamp with time zone,timestamp with time zone,timestamp with time zone,bigint,integer,integer)', 'execute')
     or has_function_privilege('anon', 'public.admin_audit_page(text,text,text,timestamp with time zone,timestamp with time zone,timestamp with time zone,bigint,integer,integer)', 'execute') then
    raise exception 'FAIL 18: a client role can call a console read';
  end if;

  raise notice 'all admin export checks passed';
end $$;

rollback;
