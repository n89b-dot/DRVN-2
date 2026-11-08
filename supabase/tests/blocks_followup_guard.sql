-- OS-W32 follow-up (20261107230000): DRVN's own offer moves aren't stopped by
-- a block, a member can't forge a lifecycle event past the block or the
-- first-contact limit, blocks and follows serialise on one pair lock, and
-- listing enquiries count in the Buying and Selling inbox filters.
begin;

do $$
declare
  seller uuid := gen_random_uuid();    -- blocks pest
  pest uuid := gen_random_uuid();      -- had offers in before the block
  buyer uuid := gen_random_uuid();     -- buys the part pest offered on
  stranger uuid := gen_random_uuid();
  asker uuid := gen_random_uuid();     -- Message seller, no offer or order
  shop uuid := gen_random_uuid();
  f1 uuid := gen_random_uuid();
  f2 uuid := gen_random_uuid();
  f3 uuid := gen_random_uuid();
  f4 uuid := gen_random_uuid();
  sold_part uuid := gen_random_uuid();
  stale_part uuid := gen_random_uuid();
  stranger_part uuid := gen_random_uuid();
  shop_part uuid := gen_random_uuid();
  sold_offer uuid := gen_random_uuid();
  stale_offer uuid := gen_random_uuid();
  checkout jsonb;
  v_order uuid;
  v_status text;
  v_round int;
  conv uuid;
  refused text;
  i int;
begin
  insert into auth.users(id, email, raw_user_meta_data) values
    (seller, 'w32f-seller@drvn.test', '{}'), (pest, 'w32f-pest@drvn.test', '{}'),
    (buyer, 'w32f-buyer@drvn.test', '{}'), (stranger, 'w32f-stranger@drvn.test', '{}'),
    (asker, 'w32f-asker@drvn.test', '{}'), (shop, 'w32f-shop@drvn.test', '{}'),
    (f1, 'w32f-f1@drvn.test', '{}'), (f2, 'w32f-f2@drvn.test', '{}'),
    (f3, 'w32f-f3@drvn.test', '{}'), (f4, 'w32f-f4@drvn.test', '{}');
  insert into public.listings(id, seller_id, title, category, price_cents, shipping_cents, status, currency) values
    (sold_part, seller, 'W32F coilovers', 'brakes-suspension', 50000, 1500, 'active', 'USD'),
    (stale_part, seller, 'W32F intake', 'performance', 5000, 0, 'active', 'USD'),
    (stranger_part, stranger, 'W32F stranger part', 'performance', 5000, 0, 'active', 'USD'),
    (shop_part, shop, 'W32F shop part', 'performance', 5000, 0, 'active', 'USD');

  -- pest's offers go in before the block; one has already lapsed.
  insert into public.offers(id, listing_id, buyer_id, amount_cents, status) values (sold_offer, sold_part, pest, 40000, 'open');
  insert into public.offers(id, listing_id, buyer_id, amount_cents, status, expires_at)
    values (stale_offer, stale_part, pest, 4000, 'open', now() - interval '1 hour');

  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', seller, 'role', 'authenticated')::text, true);
  insert into public.member_blocks(blocker_id, blocked_id) values (seller, pest);
  -- DRVN's side from here: no member token.
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);

  -- ---------- 1. DRVN's moves go through a block; members' don't ----------
  -- A member's (or the agent's) move is still refused.
  select coalesce(max(round_no), 0) + 1 into v_round from public.offer_rounds where offer_id = sold_offer;
  refused := null;
  begin
    insert into public.offer_rounds(offer_id, round_no, listing_id, buyer_id, actor_role, kind, amount_cents, actor_member_id)
    values (sold_offer, v_round, sold_part, pest, 'seller', 'counter', 45000, seller);
  exception when sqlstate 'BL403' then refused := 'yes';
  end;
  if refused is null then raise exception 'FAIL 1: a member''s offer move went through a block'; end if;

  -- The expiry cron expires the blocked member's lapsed offer.
  perform public.release_expired_reservations();
  select status into v_status from public.offers where id = stale_offer;
  if v_status is distinct from 'expired' then
    raise exception 'FAIL 2: the expiry cron left a blocked member''s lapsed offer %', v_status;
  end if;
  if not exists (select 1 from public.offer_rounds where offer_id = stale_offer and actor_role = 'system' and kind = 'expire') then
    raise exception 'FAIL 3: the cron''s expiry has no system round';
  end if;

  -- Someone else buys the part: finalising the paid order expires pest's
  -- offer, and the block mustn't roll the finalisation back.
  checkout := public.purchase_begin(buyer, array[sold_part], 'w32f-checkout');
  v_order := (checkout -> 'orders' -> 0 ->> 'order_id')::uuid;
  if v_order is null then raise exception 'FAIL 4: the fixture checkout claimed nothing: %', checkout; end if;
  perform public.purchase_finalize(v_order, true, 'stub', 'w32f-reference', null);
  select status into v_status from public.orders where id = v_order;
  if v_status is distinct from 'paid' then
    raise exception 'FAIL 5: a paid checkout didn''t finalise with a blocked member''s offer on the part (%)', v_status;
  end if;
  select status into v_status from public.offers where id = sold_offer;
  if v_status is distinct from 'expired' then
    raise exception 'FAIL 6: the rival offer of a blocked member wasn''t expired on sale (%)', v_status;
  end if;

  -- ---------- 2. a member can't write a lifecycle event ----------
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', pest, 'role', 'authenticated')::text, true);
  refused := null;
  begin
    insert into public.messages(listing_id, sender_id, recipient_id, body, kind) values (stale_part, pest, seller, 'still me', 'event');
  exception when insufficient_privilege then refused := 'yes';
  end;
  if refused is null then raise exception 'FAIL 7: a forged event got a message through a block'; end if;

  -- The first-contact limit: with today's 10 used, neither a message nor a
  -- forged event reaches an eleventh new person.
  perform set_config('role', 'none', true);
  for i in 1..10 loop
    perform public.consume_rate_limit('db-first-contact:' || pest::text, 10, interval '1 day');
  end loop;
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', pest, 'role', 'authenticated')::text, true);
  refused := null;
  begin
    insert into public.messages(listing_id, sender_id, recipient_id, body) values (stranger_part, pest, stranger, 'hello');
  exception when sqlstate 'RL429' then refused := 'yes';
  end;
  if refused is null then raise exception 'FAIL 8: the fixture didn''t use up the first-contact limit'; end if;
  refused := null;
  begin
    insert into public.messages(listing_id, sender_id, recipient_id, body, kind) values (stranger_part, pest, stranger, 'hello', 'event');
  exception when insufficient_privilege then refused := 'yes';
  end;
  if refused is null then raise exception 'FAIL 9: a forged event got past the first-contact limit'; end if;
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
  if exists (select 1 from public.messages where sender_id = pest) then
    raise exception 'FAIL 10: a refused message from the blocked member was stored';
  end if;

  -- DRVN still writes events (the service role / definer paths).
  insert into public.messages(listing_id, sender_id, recipient_id, body, kind) values (stale_part, seller, pest, 'Offer expired', 'event');
  if not exists (select 1 from public.messages where sender_id = seller and recipient_id = pest and kind = 'event') then
    raise exception 'FAIL 11: a trusted writer''s event was refused or rewritten';
  end if;

  -- ---------- 3. follows and blocks take the same pair lock ----------
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', f1, 'role', 'authenticated')::text, true);
  insert into public.follows(follower_id, target_type, target_id) values (f1, 'profile', f2);
  perform set_config('role', 'none', true);
  if not exists (
    select 1 from pg_locks l
     where l.locktype = 'advisory' and l.pid = pg_backend_pid() and l.objsubid = 1
       and ((l.classid::bigint << 32) | l.objid::bigint) = private.member_pair_lock_key(f2, f1)
  ) then
    raise exception 'FAIL 12: a follow didn''t take the member-pair lock';
  end if;
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', f3, 'role', 'authenticated')::text, true);
  insert into public.member_blocks(blocker_id, blocked_id) values (f3, f4);
  perform set_config('role', 'none', true);
  if not exists (
    select 1 from pg_locks l
     where l.locktype = 'advisory' and l.pid = pg_backend_pid() and l.objsubid = 1
       and ((l.classid::bigint << 32) | l.objid::bigint) = private.member_pair_lock_key(f3, f4)
  ) then
    raise exception 'FAIL 13: a block didn''t take the member-pair lock';
  end if;

  -- ---------- 4. enquiries count in Buying and Selling ----------
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', asker, 'role', 'authenticated')::text, true);
  insert into public.messages(listing_id, sender_id, recipient_id, body) values (shop_part, asker, shop, 'Does it fit an S2000?');
  select c.id into conv from public.conversations c where c.participant_a = least(asker, shop) and c.participant_b = greatest(asker, shop);
  if conv is null then raise exception 'FAIL 14: the fixture enquiry has no conversation'; end if;
  if not exists (select 1 from public.list_conversations('buying') x where x.id = conv) then
    raise exception 'FAIL 15: the asker''s enquiry is missing from Buying';
  end if;
  if exists (select 1 from public.list_conversations('selling') x where x.id = conv) then
    raise exception 'FAIL 16: the asker''s enquiry is listed under Selling';
  end if;
  perform set_config('request.jwt.claims', json_build_object('sub', shop, 'role', 'authenticated')::text, true);
  if not exists (select 1 from public.list_conversations('selling') x where x.id = conv) then
    raise exception 'FAIL 17: the seller''s enquiry is missing from Selling';
  end if;
  if exists (select 1 from public.list_conversations('buying') x where x.id = conv) then
    raise exception 'FAIL 18: the seller''s enquiry is listed under Buying';
  end if;
  perform set_config('role', 'none', true);

  raise notice 'all blocks follow-up checks passed';
end $$;

rollback;
