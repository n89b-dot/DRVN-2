-- Negotiation v2 (20261017160000): offer_open and offer_move enforce turns,
-- bounds, the 3-offers-per-listing limit across threads, below-minimum
-- attempts as declined rounds, stale rounds, exact replay, per-move expiry,
-- the binding snapshot on acceptance, and cancellation only before checkout.
-- After the contract (20261019120000) they are the only way a member writes
-- an offer, and the expiry sweep still records its rounds.
begin;

create function pg_temp.act(p_member uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true), set_config('request.jwt.claims', jsonb_build_object('sub', p_member, 'role', 'authenticated')::text, true);
$$;

create function pg_temp.code(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return 'ok';
exception when others then
  return sqlstate;
end $$;

-- This guard's own helpers are called while acting as other roles. A new
-- function is closed by default (architecture plan 2, item A3), so they are opened here.
grant execute on all routines in schema pg_temp to public;

do $$
declare
  seller uuid := gen_random_uuid();
  buyer uuid := gen_random_uuid();
  other uuid := gen_random_uuid();
  part uuid := gen_random_uuid();
  part2 uuid := gen_random_uuid();
  o1 uuid := gen_random_uuid();
  o2 uuid := gen_random_uuid();
  o3 uuid := gen_random_uuid();
  o4 uuid := gen_random_uuid();
  o5 uuid := gen_random_uuid();
  o6 uuid := gen_random_uuid();
  r jsonb;
  order_id uuid;
  first_expiry timestamptz;
  c text;
begin
  insert into auth.users(id, email) values
    (seller, 'move-seller@drvn.test'), (buyer, 'move-buyer@drvn.test'), (other, 'move-other@drvn.test');
  insert into public.listings(id, seller_id, title, category, price_cents, shipping_cents, status)
  values (part, seller, 'Move guard turbo', 'performance', 100000, 0, 'active'),
         (part2, seller, 'Move guard intercooler', 'performance', 50000, 0, 'active');
  perform pg_temp.act(seller);
  perform public.set_listing_offer_floor(part, 60000);

  -- 1. Opening offer; the seller can't move out of turn twice; stale rounds refused.
  perform pg_temp.act(buyer);
  r := public.offer_open(o1, part, 70000, 'Fair price?');
  if r->>'outcome' <> 'sent' then raise exception 'FAIL 1: opening offer not sent: %', r; end if;
  if (select round_count from public.offers where id = o1) <> 1 then raise exception 'FAIL 2: round_count not 1'; end if;
  select expires_at into first_expiry from public.offers where id = o1;
  c := pg_temp.code(format('select public.offer_move(%L, ''counter'', 90000, ''buyer-out-of-turn-1'', 1)', o1));
  if c <> 'OF002' then raise exception 'FAIL 3: the buyer moved out of turn (%)', c; end if;
  perform pg_temp.act(seller);
  c := pg_temp.code(format('select public.offer_move(%L, ''counter'', 90000, ''seller-stale-0001'', 0)', o1));
  if c <> 'OF003' then raise exception 'FAIL 4: a stale round was accepted (%)', c; end if;

  -- 2. Seller counter bounds: above the offer, at most asking, at least the minimum.
  if pg_temp.code(format('select public.offer_move(%L, ''counter'', 100001, ''seller-over-ask1'', 1)', o1)) <> 'OF004'
     or pg_temp.code(format('select public.offer_move(%L, ''counter'', 70000, ''seller-at-offer1'', 1)', o1)) <> 'OF004' then
    raise exception 'FAIL 5: a seller counter out of bounds was accepted';
  end if;
  -- Time passes on the buyer's turn: the counter must start a fresh 72 hours.
  perform set_config('role', 'none', true);
  update public.offers set expires_at = now() + interval '1 hour' where id = o1;
  select expires_at into first_expiry from public.offers where id = o1;
  perform pg_temp.act(seller);
  r := public.offer_move(o1, 'counter', 90000, 'seller-counter-001', 1);
  if (select status || ':' || counter_amount_cents || ':' || round_count from public.offers where id = o1) <> 'countered:90000:2' then
    raise exception 'FAIL 6: the seller counter did not land';
  end if;
  if (select expires_at from public.offers where id = o1) is distinct from now() + interval '72 hours' then
    raise exception 'FAIL 7: the counter did not get a fresh 72 hours';
  end if;
  -- An exact retry replays; a different offer with the same key is refused.
  r := public.offer_move(o1, 'counter', 90000, 'seller-counter-001', 1);
  if not (r->>'replayed')::boolean or (select round_count from public.offers where id = o1) <> 2 then
    raise exception 'FAIL 8: a retried move did not replay';
  end if;

  -- 3. Buyer counter-back: above their last, below the counter; it's the seller's turn after.
  perform pg_temp.act(buyer);
  if pg_temp.code(format('select public.offer_move(%L, ''counter'', 90000, ''buyer-at-counter1'', 2)', o1)) <> 'OF004' then
    raise exception 'FAIL 9: a counter-back at the seller''s counter was accepted';
  end if;
  r := public.offer_move(o1, 'counter', 80000, 'buyer-counter-0001', 2);
  if (select status || ':' || amount_cents || ':' || coalesce(counter_amount_cents::text, '-') from public.offers where id = o1) <> 'open:80000:-' then
    raise exception 'FAIL 10: the buyer counter-back did not land';
  end if;
  perform set_config('role', 'none', true);
  if not exists (select 1 from public.notifications where user_id = seller and kind = 'offer_countered_back') then
    raise exception 'FAIL 11: the seller was not told about the counter-back';
  end if;

  -- 4. Seller counters again; then raises the minimum and the price. The buyer accepts the
  --    standing counter at its own terms (the binding snapshot).
  perform pg_temp.act(seller);
  r := public.offer_move(o1, 'counter', 85000, 'seller-counter-002', 3);
  update public.listings set price_cents = 120000 where id = part;
  perform public.set_listing_offer_floor(part, 88000);
  perform pg_temp.act(buyer);
  r := public.offer_move(o1, 'accept', null, 'buyer-accept-00001', 4);
  order_id := (r->>'order_id')::uuid;
  perform set_config('role', 'none', true);
  if order_id is null or (select subtotal_cents from public.orders where id = order_id) <> 85000 then
    raise exception 'FAIL 12: acceptance did not honour the counter as offered (%)', r;
  end if;
  if (select string_agg(kind || ':' || actor_role, ' ' order by round_no) from public.offer_rounds where offer_id = o1)
     <> 'offer:buyer counter:seller counter:buyer counter:seller accept:buyer' then
    raise exception 'FAIL 13: the rounds don''t read as the negotiation went';
  end if;

  -- 5. Cancel only before checkout: once the buyer freezes delivery, the seller can't cancel.
  update public.orders set accepted_checkout_shipping = '{"mode":"collection"}'::jsonb where id = order_id;
  r := public.settle_seller_cancellation(order_id, seller, 'changed my mind');
  if (r->>'ok')::boolean or (select status from public.orders where id = order_id) <> 'pending' then
    raise exception 'FAIL 14: the seller cancelled after checkout began (%)', r;
  end if;

  -- 6. Three offers per listing, across threads; a below-minimum attempt uses one.
  perform pg_temp.act(buyer);
  r := public.offer_open(o2, part2, 20000, null);
  perform pg_temp.act(seller);
  r := public.offer_move(o2, 'decline', null, 'seller-decline-01', 1);
  perform public.set_listing_offer_floor(part2, 30000);
  perform pg_temp.act(buyer);
  r := public.offer_open(o3, part2, 25000, 'Is this OK?');
  if r->>'outcome' <> 'below_minimum' then raise exception 'FAIL 15: a below-minimum offer was not recorded as such: %', r; end if;
  perform set_config('role', 'none', true);
  if (select status from public.offers where id = o3) <> 'declined'
     or exists (select 1 from public.messages where id = o3)
     or exists (select 1 from public.notifications where user_id = seller and kind = 'offer_new' and href = '/offers/' || o3) then
    raise exception 'FAIL 16: a below-minimum attempt opened a thread, kept its message or announced itself';
  end if;
  perform pg_temp.act(buyer);
  r := public.offer_open(o4, part2, 31000, null);
  perform pg_temp.act(seller);
  r := public.offer_move(o4, 'counter', 45000, 'seller-counter-003', 1);
  perform pg_temp.act(buyer);
  c := pg_temp.code(format('select public.offer_move(%L, ''counter'', 35000, ''buyer-fourth-0001'', 2)', o4));
  if c <> 'OF001' then raise exception 'FAIL 17: a fourth buyer offer on the part was allowed (%)', c; end if;
  r := public.offer_move(o4, 'withdraw', null, 'buyer-withdraw-01', 2);
  if pg_temp.code(format('select public.offer_open(%L, %L, 32000, null)', o5, part2)) <> 'OF001' then
    raise exception 'FAIL 18: a new thread got around the 3-offer limit';
  end if;

  -- 7. Strangers can't move; settled offers can't move; expiry is recorded and announced.
  perform pg_temp.act(other);
  if pg_temp.code(format('select public.offer_move(%L, ''decline'', null, ''stranger-move-01'', 2)', o4)) <> 'P0002' then
    raise exception 'FAIL 19: a stranger moved an offer';
  end if;
  perform pg_temp.act(seller);
  if pg_temp.code(format('select public.offer_move(%L, ''decline'', null, ''seller-settled-1'', 3)', o4)) <> 'OF005' then
    raise exception 'FAIL 20: a settled offer moved';
  end if;
  perform pg_temp.act(other);
  r := public.offer_open(o5, part2, 40000, null);
  perform set_config('role', 'none', true);
  update public.offers set expires_at = now() - interval '1 minute' where id = o5;
  perform pg_temp.act(seller);
  r := public.offer_move(o5, 'accept', null, 'seller-late-00001', 1);
  perform set_config('role', 'none', true);
  if r->>'outcome' <> 'expired' or (select status from public.offers where id = o5) <> 'expired'
     or (select kind from public.offer_rounds where offer_id = o5 and round_no = 2) <> 'expire'
     or (select count(*) from public.notifications where kind = 'offer_expired' and href = '/offers/' || o5) <> 2 then
    raise exception 'FAIL 21: a lapsed turn was not expired, recorded and announced to both (%)', r;
  end if;

  -- 8. The old ways in are gone: no opening function but offer_open, and no
  --    member insert, update or delete on offers.
  if to_regprocedure('public.create_offer_with_message(uuid,uuid,integer,text)') is not null then
    raise exception 'FAIL 22: create_offer_with_message is still installed';
  end if;
  if has_table_privilege('authenticated', 'public.offers', 'insert')
     or has_table_privilege('authenticated', 'public.offers', 'update')
     or has_table_privilege('authenticated', 'public.offers', 'delete')
     or has_table_privilege('anon', 'public.offers', 'insert')
     or has_table_privilege('anon', 'public.offers', 'update')
     or has_table_privilege('anon', 'public.offers', 'delete')
     or exists (select 1 from pg_policy where polrelid = 'public.offers'::regclass and polcmd <> 'r') then
    raise exception 'FAIL 23: a client role can still write offers';
  end if;
  perform pg_temp.act(other);
  if pg_temp.code(format('insert into public.offers(listing_id, buyer_id, amount_cents, status) values (%L, %L, 41000, ''open'')', part2, other)) <> '42501'
     or pg_temp.code(format('update public.offers set status = ''withdrawn'' where id = %L', o5)) <> '42501' then
    raise exception 'FAIL 24: a member wrote an offer around offer_open and offer_move';
  end if;

  -- 9. The expiry sweep still records the round it makes (record_offer_round).
  r := public.offer_open(o6, part2, 41000, null);
  perform set_config('role', 'none', true);
  update public.offers set expires_at = now() - interval '1 minute' where id = o6;
  perform public.release_expired_reservations();
  if (select status || ':' || round_count from public.offers where id = o6) <> 'expired:2'
     or (select kind || ':' || actor_role from public.offer_rounds where offer_id = o6 and round_no = 2) <> 'expire:system' then
    raise exception 'FAIL 25: the expiry sweep did not record its round';
  end if;

  -- 10. The round counter and the rounds agree for every offer.
  if exists (select 1 from public.offers o where o.round_count <> (select coalesce(max(round_no), 0) from public.offer_rounds r where r.offer_id = o.id)) then
    raise exception 'FAIL 26: an offer''s round_count disagrees with its rounds';
  end if;
  if has_function_privilege('anon', 'public.offer_move(uuid,text,integer,text,integer)', 'execute')
     or has_function_privilege('anon', 'public.offer_open(uuid,uuid,integer,text)', 'execute')
     or has_function_privilege('authenticated', 'public.offer_effective_floor(uuid)', 'execute') then
    raise exception 'FAIL 27: a move function is open to the wrong role';
  end if;

  raise notice 'all offer move checks passed';
end $$;

rollback;
