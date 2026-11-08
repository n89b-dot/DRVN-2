-- OS-W32 (20261107220600): blocks (N54), suspended members hidden (N59) and
-- Message seller (R-directcontact).
begin;

do $$
declare
  seller uuid := gen_random_uuid();   -- blocks pest
  pest uuid := gen_random_uuid();
  buyer uuid := gen_random_uuid();
  stranger uuid := gen_random_uuid();
  banned uuid := gen_random_uuid();   -- suspended
  part uuid := gen_random_uuid();
  pest_part uuid := gen_random_uuid();
  car uuid := gen_random_uuid();
  post uuid := gen_random_uuid();
  banned_post uuid := gen_random_uuid();
  shared_order uuid := gen_random_uuid();
  conv uuid;
  targets uuid[];
  target_parts uuid[];
  refused text;
  n int;
  i int;
begin
  insert into auth.users(id, email, raw_user_meta_data) values
    (seller, 'w32-seller@drvn.test', '{}'), (pest, 'w32-pest@drvn.test', '{}'),
    (buyer, 'w32-buyer@drvn.test', '{}'), (stranger, 'w32-stranger@drvn.test', '{}'),
    (banned, 'w32-banned@drvn.test', '{}');
  insert into public.listings(id, seller_id, title, category, price_cents, status) values
    (part, seller, 'W32 part', 'performance', 5000, 'active'),
    (pest_part, pest, 'W32 pest part', 'performance', 5000, 'active');
  insert into public.cars(id, owner_id, slug, name, is_public) values (car, seller, 'w32-car', 'W32 build', true);
  insert into public.activity_posts(id, car_id, author_id, title, body, published_at) values
    (post, car, seller, 'W32 update', '{"type":"doc","content":[]}', now()),
    (banned_post, null, banned, 'W32 banned update', '{"type":"doc","content":[]}', now());
  insert into public.activity_comments(post_id, author_id, body) values (post, banned, 'banned reply');
  insert into public.follows(follower_id, target_type, target_id) values
    (pest, 'profile', seller), (seller, 'profile', pest), (pest, 'car', car);
  insert into public.orders(id, buyer_id, seller_id, status, subtotal_cents, total_cents)
    values (shared_order, pest, seller, 'paid', 5000, 5000);

  -- AG-4: the agent worker can't write messages at all.
  if has_table_privilege('agent_worker', 'public.messages', 'insert') then
    raise exception 'FAIL 0: the agent worker can insert messages';
  end if;

  -- ---------- N54 ----------
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', seller, 'role', 'authenticated')::text, true);
  insert into public.member_blocks(blocker_id, blocked_id) values (seller, pest);
  refused := null;
  begin
    insert into public.member_blocks(blocker_id, blocked_id) values (pest, buyer);
  exception when insufficient_privilege then refused := 'yes';
  end;
  if refused is null then raise exception 'FAIL 1: a member blocked on someone else''s behalf'; end if;

  perform set_config('request.jwt.claims', json_build_object('sub', pest, 'role', 'authenticated')::text, true);
  if exists (select 1 from public.member_blocks) then raise exception 'FAIL 2: the blocked member can see the block'; end if;
  perform set_config('role', 'none', true);
  if exists (select 1 from public.follows where (follower_id = pest and target_id in (seller, car)) or (follower_id = seller and target_id = pest)) then
    raise exception 'FAIL 3: blocking left follows between them';
  end if;

  -- Every person-to-person write between them is refused, both ways — the
  -- trigger runs for every writer, the agent worker's offers included.
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', pest, 'role', 'authenticated')::text, true);
  refused := null;
  begin insert into public.messages(listing_id, sender_id, recipient_id, body) values (part, pest, seller, 'hi');
  exception when sqlstate 'BL403' then refused := 'yes'; end;
  if refused is null then raise exception 'FAIL 4: a blocked member messaged the blocker'; end if;
  refused := null;
  begin insert into public.listing_questions(listing_id, author_id, body) values (part, pest, 'still for sale?');
  exception when sqlstate 'BL403' then refused := 'yes'; end;
  if refused is null then raise exception 'FAIL 5: a blocked member asked a question'; end if;
  refused := null;
  begin insert into public.activity_comments(post_id, author_id, body) values (post, pest, 'nice');
  exception when sqlstate 'BL403' then refused := 'yes'; end;
  if refused is null then raise exception 'FAIL 6: a blocked member replied to the blocker''s post'; end if;
  refused := null;
  begin insert into public.follows(follower_id, target_type, target_id) values (pest, 'profile', seller);
  exception when sqlstate 'BL403' then refused := 'yes'; end;
  if refused is null then raise exception 'FAIL 7: a blocked member followed the blocker'; end if;
  -- The order exception: a message about the order they share still goes.
  insert into public.messages(order_id, sender_id, recipient_id, body) values (shared_order, pest, seller, 'tracking?');
  perform set_config('role', 'none', true);
  refused := null;
  begin insert into public.offers(listing_id, buyer_id, amount_cents) values (part, pest, 4000);
  exception when sqlstate 'BL403' then refused := 'yes'; end;
  if refused is null then raise exception 'FAIL 8: an offer went through a block (any writer)'; end if;
  -- …and the blocker can't reach the blocked member either.
  refused := null;
  begin insert into public.offers(listing_id, buyer_id, amount_cents) values (pest_part, seller, 4000);
  exception when sqlstate 'BL403' then refused := 'yes'; end;
  if refused is null then raise exception 'FAIL 9: the block isn''t symmetric'; end if;

  -- ---------- R-directcontact ----------
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', buyer, 'role', 'authenticated')::text, true);
  insert into public.messages(listing_id, sender_id, recipient_id, body) values (part, buyer, seller, 'Does it fit an EK9?');
  perform set_config('role', 'none', true);
  select conversation_id into conv from public.messages where sender_id = buyer and listing_id = part;
  if conv is null or not exists (select 1 from public.conversations c where c.id = conv and least(seller, buyer) = c.participant_a) then
    raise exception 'FAIL 10: a listing enquiry did not join the pair''s conversation';
  end if;
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', seller, 'role', 'authenticated')::text, true);
  insert into public.messages(listing_id, sender_id, recipient_id, body) values (part, seller, buyer, 'It does.');
  refused := null;
  begin insert into public.messages(listing_id, sender_id, recipient_id, body) values (part, seller, stranger, 'Want it?');
  exception when insufficient_privilege then refused := 'yes'; end;
  if refused is null then raise exception 'FAIL 11: a seller cold-messaged someone who never asked'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', buyer, 'role', 'authenticated')::text, true);
  refused := null;
  begin insert into public.messages(listing_id, sender_id, recipient_id, body) values (part, buyer, stranger, 'psst');
  exception when insufficient_privilege then refused := 'yes'; end;
  if refused is null then raise exception 'FAIL 12: a listing message went to someone other than its seller'; end if;

  -- New contacts are limited: 10 new people a day.
  perform set_config('role', 'none', true);
  insert into auth.users(id, email, raw_user_meta_data)
    select gen_random_uuid(), 'w32-s' || g || '@drvn.test', '{}' from generate_series(1, 11) g;
  insert into public.listings(seller_id, title, category, price_cents, status)
    select u.id, 'W32 limit part', 'performance', 1000, 'active' from auth.users u where u.email like 'w32-s%@drvn.test';
  select array_agg(l.seller_id order by u.email), array_agg(l.id order by u.email) into targets, target_parts
    from public.listings l join auth.users u on u.id = l.seller_id where u.email like 'w32-s%@drvn.test';
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', stranger, 'role', 'authenticated')::text, true);
  n := 0;
  refused := null;
  for i in 1..11 loop
    begin
      insert into public.messages(listing_id, sender_id, recipient_id, body) values (target_parts[i], stranger, targets[i], 'hello');
      n := n + 1;
    exception when sqlstate 'RL429' then refused := 'yes';
    end;
  end loop;
  if n <> 10 or refused is null then raise exception 'FAIL 13: % first contacts went through in a day, not 10', n; end if;
  perform set_config('role', 'none', true);

  -- ---------- N59 ----------
  update public.profiles set suspended_at = now(), suspended_reason = 'guard' where id = banned;
  perform set_config('role', 'anon', true);
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  if exists (select 1 from public.activity_posts where id = banned_post) then raise exception 'FAIL 14: a suspended member''s post is public'; end if;
  if exists (select 1 from public.activity_comments where author_id = banned) then raise exception 'FAIL 15: a suspended member''s reply is public'; end if;
  if exists (select 1 from public.profiles where id = banned) then raise exception 'FAIL 16: a suspended member''s profile is public'; end if;
  if not exists (select 1 from public.profiles where id = seller) then raise exception 'FAIL 17: an ordinary profile disappeared'; end if;
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', banned, 'role', 'authenticated')::text, true);
  if not exists (select 1 from public.activity_posts where id = banned_post)
     or not exists (select 1 from public.profiles where id = banned) then
    raise exception 'FAIL 18: a suspended member can''t see their own post or profile';
  end if;
  perform set_config('role', 'none', true);
  insert into public.orders(buyer_id, seller_id, status, subtotal_cents, total_cents) values (buyer, banned, 'paid', 5000, 5000);
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', buyer, 'role', 'authenticated')::text, true);
  if not exists (select 1 from public.profiles where id = banned) then
    raise exception 'FAIL 19: a buyer lost the name of a suspended seller on their own order';
  end if;
  perform set_config('request.jwt.claims', json_build_object('sub', stranger, 'role', 'authenticated')::text, true);
  if exists (select 1 from public.profiles where id = banned) then
    raise exception 'FAIL 20: a member with no deal sees a suspended profile';
  end if;
  perform set_config('role', 'none', true);

  raise notice 'all blocks and message seller checks passed';
end $$;

rollback;
