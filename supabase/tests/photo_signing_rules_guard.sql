-- ============================================================================
-- Photo signing signs only what the database guards (N940, 20261110190000)
--
-- The app signs a member photo only at a place listed by
-- private.photo_signable_positions() (src/lib/photo-urls.ts holds the same
-- list; src/lib/photo-urls.test.ts compares them). This proves, on the
-- applied schema, that the list is exactly what the database guards:
--
--   1. every listed column and body has an owner-folder trigger that fires on
--      insert and on update of that column, and every such trigger is listed;
--   2. the member guards (20261107203000) cover the same columns;
--   3. every RPC path's source is a listed column or body, and the RPC still
--      copies it (its definition reads that source);
--   4. a post body's photos are the shape the signer walks (the body-cases
--      block below, which the vitest also runs through bodyPhotoUrls);
--   5. a write naming another member's object is refused for every writer;
--   6. rows that already broke the rule are moved aside, whole; a row whose
--      owner is unknown (a deleted seller) is counted and left alone, and
--      takes no new photo;
--   7. a real moved row comes back only where the rule now holds, into the
--      post's current body, and never over an edit made since;
--   8. moved rows last 90 days and go with either member's deletion scrub;
--   9. photo_signing_ready() says the guards are there.
--
-- Everything happens inside a transaction that is rolled back.
-- ============================================================================

begin;

do $$
declare
  missing text;
begin
  -- 1. Listed columns and bodies <-> owner-folder triggers, per (table, column).
  create temp table guarded on commit drop as
  select c.relname::text as relation,
         case when p.proname = 'guard_photo_owner_folder_body' then 'body'
              else (string_to_array(encode(t.tgargs, 'escape'), '\000'))[1] end as field,
         case when p.proname = 'guard_photo_owner_folder_body' then 'body' else 'column' end as kind,
         t.tgtype, t.tgattr, t.tgrelid
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
    join pg_proc p on p.oid = t.tgfoid
    join pg_namespace pn on pn.oid = p.pronamespace and pn.nspname = 'private'
   where not t.tgisinternal and t.tgenabled <> 'D'
     and p.proname in ('guard_photo_owner_folder', 'guard_photo_owner_folder_body');

  select string_agg(kind || ' ' || relation || '.' || field, ', ') into missing from (
    (select kind, relation, field from private.photo_signable_positions() where kind in ('column', 'body')
     except select kind, relation, field from guarded)
    union all
    (select kind, relation, field from guarded
     except select kind, relation, field from private.photo_signable_positions() where kind in ('column', 'body'))
  ) d;
  if missing is not null then
    raise exception 'FAIL 1: the signable columns and the owner-folder triggers differ: % (N940)', missing;
  end if;

  -- Each fires BEFORE, per ROW, on INSERT and on UPDATE of its column.
  select string_agg(g.relation || '.' || g.field, ', ') into missing
    from guarded g
   where g.tgtype & (1 | 2 | 4 | 16) <> (1 | 2 | 4 | 16)
      or (array_length(g.tgattr::int2[], 1) is not null
          and not ((select a.attnum from pg_attribute a where a.attrelid = g.tgrelid and a.attname = g.field) = any (g.tgattr::int2[])));
  if missing is not null then
    raise exception 'FAIL 1b: an owner-folder trigger does not fire on every write of its column: % (N940)', missing;
  end if;

  -- 2. The member guards cover the same columns (avatars are public, and a
  -- buyer's snapshot is written only by the server, which section 1 binds).
  select string_agg(d, ', ') into missing from (
    (select relation || '.' || field as d from private.photo_signable_positions()
      where kind = 'column' and relation <> 'order_item_snapshot_images'
     except
     select c.relname || '.' || (string_to_array(encode(t.tgargs, 'escape'), '\000'))[1]
       from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_proc p on p.oid = t.tgfoid
      where p.proname = 'guard_member_media_ref' and not t.tgisinternal and t.tgenabled <> 'D')
    union all
    (select c.relname || '.' || (string_to_array(encode(t.tgargs, 'escape'), '\000'))[1]
       from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_proc p on p.oid = t.tgfoid
      where p.proname = 'guard_member_media_ref' and not t.tgisinternal and t.tgenabled <> 'D'
        and c.relname <> 'profiles'
     except
     select relation || '.' || field from private.photo_signable_positions() where kind = 'column')
  ) x;
  if missing is not null then
    raise exception 'FAIL 2: the member photo guards and the signable columns differ: % (N940)', missing;
  end if;
  if not exists (select 1 from pg_trigger t join pg_proc p on p.oid = t.tgfoid
                  where t.tgrelid = 'public.activity_posts'::regclass and p.proname = 'guard_member_post_body_media' and t.tgenabled <> 'D') then
    raise exception 'FAIL 2b: a post body has no member photo guard (N940)';
  end if;

  -- 3. RPC paths: a listed source, and the RPC still reads it.
  select string_agg(r.relation || ' ' || r.field || ' <- ' || r.source, ', ') into missing
    from private.photo_signable_positions() r
   where r.kind = 'rpc'
     and not exists (select 1 from private.photo_signable_positions() s
                      where s.kind in ('column', 'body') and s.relation || '.' || s.field = r.source);
  if missing is not null then
    raise exception 'FAIL 3: an RPC path copies something that is not a guarded place: % (N940)', missing;
  end if;

  create temp table rpc_reads (relation text, field text, pattern text) on commit drop;
  insert into rpc_reads values
    ('feed_hydration', 'posts.cover_url', '''cover_url'', \(select i\.url from public\.activity_images i where i\.post_id = p\.id'),
    ('feed_hydration', 'posts.body', '''body'', p\.body'),
    ('feed_hydration', 'cars.cover_image_url', '''cover_image_url'', c\.cover_image_url, ''owner_id'''),
    ('feed_hydration', 'listings.cover_url', '''cover_url'', \(select i\.url from public\.listing_images i where i\.listing_id = l\.id'),
    ('feed_hydration', 'post_cars.cover_image_url', '''is_public'', c\.is_public, ''cover_image_url'', c\.cover_image_url'),
    ('garage_car_stats', 'latest_update.cover_url', '''cover_url'', \(\s*select ai\.url from public\.activity_images ai'),
    ('garage_car_stats', 'latest_update.body', '''body'', p\.body'),
    ('seller_listing_stats', 'cover_url', '\(select li\.url from listing_images li\s+where li\.listing_id = l\.id[\s\S]*?\) as cover_url'),
    ('car_update_page', 'body', 'select p\.id, p\.title, p\.intro, p\.body, p\.published_at\s+from public\.activity_posts p');

  select string_agg(r.relation || ' ' || r.field, ', ') into missing
    from private.photo_signable_positions() r
   where r.kind = 'rpc'
     and not exists (
       select 1 from rpc_reads x
         join pg_proc p on p.proname = x.relation
         join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public'
        where x.relation = r.relation and x.field = r.field and p.prosrc ~ x.pattern);
  if missing is not null then
    raise exception 'FAIL 3b: an RPC no longer reads the guarded source its path is listed with: % (N940)', missing;
  end if;

  raise notice 'PASS: the signable places are exactly the guarded ones';
end $$;

-- 4. A body's photos. src/lib/photo-urls.test.ts reads the lines between the
-- markers and runs each body through bodyPhotoUrls: both must give the
-- expected list (distinct, sorted).
create temp table body_cases (body text, expected text) on commit drop;
insert into body_cases (body, expected) values
-- body-cases:begin
  ($c$[{"type":"images","urls":["U1","U2"]}]$c$, $c$["U1","U2"]$c$),
  ($c$[{"type":"text","x":{"type":"images","urls":["V"]}}]$c$, $c$[]$c$),
  ($c$[{"type":"images","urls":"V"}]$c$, $c$[]$c$),
  ($c${"type":"images","urls":["V"]}$c$, $c$[]$c$),
  ($c$[{"type":"before_after","beforeUrl":"B","afterUrl":"A"}]$c$, $c$["A","B"]$c$),
  ($c$[{"type":"before_after","beforeUrl":{"u":"B"},"afterUrl":5}]$c$, $c$[]$c$),
  ($c$[{"type":"images","urls":["U",5,{"u":"V"},["W"],null,""]}]$c$, $c$["U"]$c$),
  ($c$[{"type":["images"],"urls":["U"]}]$c$, $c$[]$c$),
  ($c$[{"type":"embed","url":"U","urls":["V"]}]$c$, $c$[]$c$),
  ($c$[[{"type":"images","urls":["U"]}]]$c$, $c$[]$c$),
  ($c$[{"type":"images","urls":["U","U"]},{"type":"before_after","beforeUrl":"U"}]$c$, $c$["U"]$c$),
  ($c$[{"type":"images","url":"X","urls":["U"],"cover":"Y"}]$c$, $c$["U"]$c$),
  ($c$[{"type":"before_after","beforeUrl":"B","urls":["V"]},{"type":"images","beforeUrl":"W"}]$c$, $c$["B"]$c$),
  ($c$["U",{"type":"text","text":"U2"}]$c$, $c$[]$c$),
  ($c$null$c$, $c$[]$c$)
-- body-cases:end
;

do $$
declare
  r record;
  got text;
begin
  for r in select * from body_cases loop
    select coalesce(jsonb_agg(u order by u collate "C"), '[]'::jsonb)::text into got
      from unnest(private.activity_body_media(r.body::jsonb)) u;
    if got::jsonb is distinct from r.expected::jsonb then
      raise exception 'FAIL 4: activity_body_media(%) = %, expected % (N940)', r.body, got, r.expected;
    end if;
  end loop;
  raise notice 'PASS: a body''s photos are the shape the signer walks';
end $$;

-- 5 and 6. Writes, by every writer, and the one-time move.
do $$
declare
  seller uuid := gen_random_uuid();
  other uuid := gen_random_uuid();
  buyer uuid := gen_random_uuid();
  car uuid;
  other_car uuid;
  listing uuid;
  post uuid;
  item uuid;
  v_result jsonb;
  photo text;
  foreign_photo text;
  refused boolean;
  n integer;
  v_body jsonb;
  t text;
  post2 uuid;
  listing2 uuid;
  item2 uuid;
  order2 uuid;
  deletion uuid;
begin
  photo := 'https://proj.supabase.co/storage/v1/object/public/car-images/' || seller || '/mine.webp';
  foreign_photo := 'https://proj.supabase.co/storage/v1/object/public/car-images/' || other || '/private.webp';

  insert into auth.users (id, email) values
    (seller, 'photo-rules-seller@example.test'), (other, 'photo-rules-other@example.test'), (buyer, 'photo-rules-buyer@example.test');
  insert into public.cars (owner_id, slug, name, make, model, year)
    values (seller, 'photo-rules-' || left(seller::text, 8), 'Rules car', 'Audi', 'S4', 2000) returning id into car;
  insert into public.cars (owner_id, slug, name, make, model, year)
    values (other, 'photo-rules-' || left(other::text, 8), 'Other car', 'Audi', 'S4', 2000) returning id into other_car;
  insert into public.listings (seller_id, source_car_id, title, description, category, condition, price_cents, shipping_cents, allows_collection, status, currency)
    values (seller, car, 'Rules part', 'A part', 'performance', 'used', 10000, 0, true, 'active', 'USD') returning id into listing;
  insert into public.activity_posts (author_id, car_id, title, body, published_at)
    values (seller, car, 'Rules update', '[]'::jsonb, now()) returning id into post;
  insert into public.listings (seller_id, source_car_id, title, description, category, condition, price_cents, shipping_cents, allows_collection, status, currency)
    values (seller, car, 'Rules part two', 'A part', 'performance', 'used', 10000, 0, true, 'active', 'USD') returning id into listing2;
  insert into public.listing_images (listing_id, url, position)
    values (listing2, 'https://proj.supabase.co/storage/v1/object/public/listing-images/' || seller || '/two.webp', 0);

  -- The server, a seed or a script: not a member, so only this rule applies.
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);

  -- Own photos go in everywhere.
  update public.cars set cover_image_url = photo where id = car;
  insert into public.car_images (car_id, url, position) values (car, photo, 0);
  insert into public.car_hotspots (car_id, image_url, x, y, label) values (car, photo, 0.5, 0.5, 'pin');
  insert into public.mod_items (car_id, group_label, category, product, position, image_url) values (car, 'Other', 'other', 'Part', 0, photo);
  insert into public.listing_images (listing_id, url, position) values (listing, replace(photo, 'car-images', 'listing-images'), 0);
  insert into public.activity_images (post_id, url, position) values (post, replace(photo, 'car-images', 'activity-images'), 0);
  update public.activity_posts set body = jsonb_build_array(jsonb_build_object('type', 'images', 'urls', jsonb_build_array(photo))) where id = post;
  -- Another bucket, or something that names no object, is not this rule's business.
  update public.cars set cover_image_url = 'https://proj.supabase.co/storage/v1/object/public/avatars/' || other || '/a.webp' where id = car;
  update public.cars set cover_image_url = 'https://shop.example/part.jpg' where id = car;

  -- Someone else's object is refused at each place, in any spelling.
  foreach t in array array[
    'update public.cars set cover_image_url = $1 where id = $2',
    'insert into public.car_images (car_id, url, position) values ($2, $1, 1)',
    'insert into public.car_hotspots (car_id, image_url, x, y, label) values ($2, $1, 0.1, 0.1, ''x'')',
    'update public.mod_items set image_url = $1 where car_id = $2',
    'insert into public.listing_images (listing_id, url, position) values ($3, replace($1, ''car-images'', ''listing-images''), 1)',
    'insert into public.activity_images (post_id, url, position) values ($4, replace($1, ''car-images'', ''activity-images''), 1)',
    'update public.activity_posts set body = jsonb_build_array(jsonb_build_object(''type'', ''images'', ''urls'', jsonb_build_array($1))) where id = $4',
    'update public.activity_posts set body = jsonb_build_array(jsonb_build_object(''type'', ''before_after'', ''beforeUrl'', $1, ''afterUrl'', $1)) where id = $4',
    'update public.cars set cover_image_url = replace($1, ''/private.webp'', ''/%70rivate.webp'') where id = $2'
  ] loop
    refused := false;
    begin
      execute t using foreign_photo, car, listing, post;
    exception when insufficient_privilege then refused := true;
    end;
    if not refused then raise exception 'FAIL 5: a server write put another member''s photo in a guarded place: % (N940)', t; end if;
  end loop;
  -- Moving a photo row onto someone else's car is the same thing.
  refused := false;
  begin
    update public.car_images set car_id = other_car where car_id = car;
  exception when insufficient_privilege then refused := true;
  end;
  if not refused then raise exception 'FAIL 5b: a photo moved onto another member''s car (N940)'; end if;
  -- Handing a car to someone else with the old owner's cover is the same thing.
  update public.cars set cover_image_url = photo where id = car;
  refused := false;
  begin
    update public.cars set owner_id = other where id = car;
  exception when insufficient_privilege then refused := true;
  end;
  if not refused then raise exception 'FAIL 5e: a car changed owner keeping the old owner''s cover (N940)'; end if;

  -- A buyer's frozen copy belongs to the order's seller.
  perform set_config('request.jwt.claims', '', true);
  v_result := public.purchase_begin(buyer, array[listing], 'photo-rules-' || left(buyer::text, 8));
  select oi.id into item from public.order_items oi where oi.order_id = (v_result -> 'orders' -> 0 ->> 'order_id')::uuid;
  if item is null then raise exception 'FAIL 5c: no order item to test the snapshot with: % (N940)', v_result; end if;
  if not exists (select 1 from public.order_item_snapshot_images where order_item_id = item) then
    raise exception 'FAIL 5c: the seller''s own gallery was not frozen onto the order (N940)';
  end if;
  refused := false;
  begin
    insert into public.order_item_snapshot_images (order_item_id, url, alt, position)
      values (item, replace(foreign_photo, 'car-images', 'listing-images'), 'x', 9);
  exception when insufficient_privilege then refused := true;
  end;
  if not refused then raise exception 'FAIL 5d: a snapshot image named someone other than the seller (N940)'; end if;

  -- 6. Rows from before the rule are moved aside, whole, and nothing else is;
  --    a row whose owner is unknown is counted and left alone.
  v_result := public.purchase_begin(buyer, array[listing2], 'photo-rules-2-' || left(buyer::text, 8));
  select oi.id, oi.order_id into item2, order2 from public.order_items oi where oi.order_id = (v_result -> 'orders' -> 0 ->> 'order_id')::uuid;
  if item2 is null then raise exception 'FAIL 6h: no second order item: % (N940)', v_result; end if;
  -- Written with triggers off, as rows from before the rule were.
  perform set_config('session_replication_role', 'replica', true);
  insert into public.car_images (car_id, url, position) values (car, foreign_photo, 5);
  update public.cars set cover_image_url = foreign_photo where id = car;
  update public.activity_posts
     set body = jsonb_build_array(
       jsonb_build_object('type', 'images', 'urls', jsonb_build_array(photo, foreign_photo)),
       jsonb_build_object('type', 'before_after', 'beforeUrl', photo, 'afterUrl', foreign_photo),
       jsonb_build_object('type', 'images', 'urls', jsonb_build_array(foreign_photo)),
       jsonb_build_object('type', 'text', 'text', foreign_photo))
   where id = post;
  insert into public.order_item_snapshot_images (order_item_id, url, alt, position)
    values (item, replace(foreign_photo, 'car-images', 'listing-images'), 'x', 9);
  -- A second post, both of whose photos are someone else's (section 7 restores them).
  insert into public.activity_posts (author_id, car_id, title, body, published_at)
    values (seller, car, 'Two foreign', jsonb_build_array(
      jsonb_build_object('type', 'images', 'urls', jsonb_build_array(foreign_photo)),
      jsonb_build_object('type', 'text', 'text', 'between'),
      jsonb_build_object('type', 'before_after', 'beforeUrl', replace(foreign_photo, 'private', 'before'), 'afterUrl', replace(foreign_photo, 'private', 'after'))),
      now())
    returning id into post2;
  -- An order whose seller account is gone (orders.seller_id is set null on
  -- delete): its frozen gallery has no known owner.
  update public.orders set seller_id = null where id = order2;
  perform set_config('session_replication_role', 'origin', true);

  v_result := private.foreign_photo_ref_counts();
  -- car_images 1, cover 1, the first post's body 1, snapshot 1, the second post's body 3.
  if (select sum(value::integer) from jsonb_each_text(v_result) where key <> 'owner_unknown') <> 7
     or (v_result ->> 'car_images')::int <> 1 or (v_result ->> 'activity_posts.body')::int <> 4
     or (v_result ->> 'owner_unknown')::int <> (select count(*) from public.order_item_snapshot_images where order_item_id = item2) then
    raise exception 'FAIL 6f: the counts before the move were wrong: % (N940)', v_result;
  end if;
  n := private.quarantine_foreign_photo_refs();
  if n <> 7 then raise exception 'FAIL 6: expected 7 references moved aside, got % (N940)', n; end if;
  if exists (select 1 from public.car_images where url = foreign_photo)
     or (select cover_image_url from public.cars where id = car) is not null
     or exists (select 1 from public.order_item_snapshot_images where url like '%' || other || '%') then
    raise exception 'FAIL 6b: a foreign photo reference survived the move (N940)';
  end if;
  if not exists (select 1 from public.car_images where car_id = car and url = photo) then
    raise exception 'FAIL 6c: the move took an own photo too (N940)';
  end if;
  select body into v_body from public.activity_posts where id = post;
  if v_body is distinct from jsonb_build_array(
       jsonb_build_object('type', 'images', 'urls', jsonb_build_array(photo)),
       jsonb_build_object('type', 'text', 'text', foreign_photo)) then
    raise exception 'FAIL 6d: the body was not stripped of just the foreign photos: % (N940)', v_body;
  end if;
  if (select count(*) from private.photo_refs_quarantined where folder_owner = other::text and row_data ? 'id' and owner_id = seller
        and expires_at > now() + interval '89 days') <> 7 then
    raise exception 'FAIL 6e: the moved rows were not kept whole, with both members and a 90-day expiry (N940)';
  end if;
  if not exists (select 1 from public.order_item_snapshot_images where order_item_id = item2) then
    raise exception 'FAIL 6i: a snapshot whose seller is unknown was moved; an unknown owner is never foreign (N940)';
  end if;
  if private.foreign_photo_ref_counts() - 'owner_unknown' <> '{}'::jsonb then
    raise exception 'FAIL 6g: a second count found more to move: % (N940)', private.foreign_photo_ref_counts();
  end if;
  -- A new photo on a row with no known owner is refused, as any foreign one is.
  refused := false;
  begin
    insert into public.order_item_snapshot_images (order_item_id, url, alt, position)
      values (item2, replace(photo, 'car-images', 'listing-images'), 'x', 10);
  exception when insufficient_privilege then refused := true;
  end;
  if not refused then raise exception 'FAIL 6j: a photo went onto an order with no known seller (N940)'; end if;

  -- 7. Restore: a REAL moved row comes back only where the rule now holds.
  -- Still foreign: refused by the triggers.
  refused := false;
  begin
    perform private.restore_quarantined_photo_ref((select id from private.photo_refs_quarantined where relation = 'car_images'));
  exception when insufficient_privilege then refused := true;
  end;
  if not refused then raise exception 'FAIL 7b: restoring a foreign photo was not refused (N940)'; end if;
  -- The second post passes to the photos' owner (the rule now holds for it).
  update public.activity_posts set author_id = other where id = post2;
  -- An edit since the move: refused, nothing changes.
  perform set_config('drvn.activity_write', 'v1', true);
  update public.activity_posts set body = body || jsonb_build_array(jsonb_build_object('type', 'text', 'text', 'edited')) where id = post2;
  refused := false;
  begin
    perform private.restore_quarantined_photo_ref((select min(id) from private.photo_refs_quarantined where row_data ->> 'id' = post2::text));
  exception when object_not_in_prerequisite_state then refused := true;
  end;
  if not refused then raise exception 'FAIL 7c: a restore overwrote a post edited since the move (N940)'; end if;
  update public.activity_posts set body = body - (jsonb_array_length(body) - 1) where id = post2;
  -- One photo back: only it returns; the before/after pair stays out.
  t := private.restore_quarantined_photo_ref((select id from private.photo_refs_quarantined where row_data ->> 'id' = post2::text and value = foreign_photo));
  if (select body from public.activity_posts where id = post2) is distinct from jsonb_build_array(
       jsonb_build_object('type', 'images', 'urls', jsonb_build_array(foreign_photo)),
       jsonb_build_object('type', 'text', 'text', 'between')) then
    raise exception 'FAIL 7d: restoring one photo did not put back exactly that photo: % (N940)', (select body from public.activity_posts where id = post2);
  end if;
  -- One half of the pair back: the pair stays out until both are.
  t := private.restore_quarantined_photo_ref((select id from private.photo_refs_quarantined where row_data ->> 'id' = post2::text and value like '%/before.webp'));
  if jsonb_array_length((select body from public.activity_posts where id = post2)) <> 2 then
    raise exception 'FAIL 7e: half a before/after pair came back (N940)';
  end if;
  t := private.restore_quarantined_photo_ref((select id from private.photo_refs_quarantined where row_data ->> 'id' = post2::text));
  select body into v_body from public.activity_posts where id = post2;
  if v_body is distinct from jsonb_build_array(
       jsonb_build_object('type', 'images', 'urls', jsonb_build_array(foreign_photo)),
       jsonb_build_object('type', 'text', 'text', 'between'),
       jsonb_build_object('type', 'before_after', 'beforeUrl', replace(foreign_photo, 'private', 'before'), 'afterUrl', replace(foreign_photo, 'private', 'after'))) then
    raise exception 'FAIL 7f: the post did not come back exactly as it was: % (N940)', v_body;
  end if;
  if exists (select 1 from private.photo_refs_quarantined where row_data ->> 'id' = post2::text) then
    raise exception 'FAIL 7g: a restored reference stayed in quarantine (N940)';
  end if;
  -- A cleared cover comes back only while the column is still empty.
  update public.cars set cover_image_url = photo where id = car;
  refused := false;
  begin
    perform private.restore_quarantined_photo_ref((select id from private.photo_refs_quarantined where relation = 'cars'));
  exception when object_not_in_prerequisite_state then refused := true;
  end;
  if not refused then raise exception 'FAIL 7h: a restore overwrote a cover set since the move (N940)'; end if;

  -- 8. Retention: 90 days, and gone with either member's deletion scrub.
  update private.photo_refs_quarantined set expires_at = now() - interval '1 day' where relation = 'cars';
  perform private.prune_cron_history();
  if exists (select 1 from private.photo_refs_quarantined where relation = 'cars') then
    raise exception 'FAIL 8: an expired quarantined reference was not pruned (N940)';
  end if;
  insert into public.account_deletion_requests (user_id, outcome, next_action) values (other, 'cleanup_pending', 'x') returning id into deletion;
  update public.account_deletion_requests set scrubbed_at = now() where id = deletion;
  if exists (select 1 from private.photo_refs_quarantined where folder_owner = other::text or owner_id = other) then
    raise exception 'FAIL 8b: a scrubbed member''s quarantined references stayed (N940)';
  end if;
  if has_table_privilege('service_role', 'private.photo_refs_quarantined', 'select')
     or has_table_privilege('authenticated', 'private.photo_refs_quarantined', 'select') then
    raise exception 'FAIL 8c: the quarantine is readable outside the database owner (N940)';
  end if;
  if not public.photo_signing_ready() then
    raise exception 'FAIL 9: photo_signing_ready says the guards are missing (N940)';
  end if;

  raise notice 'PASS: photo_signing_rules_guard — all checks green (rolling back)';
end $$;

rollback;
