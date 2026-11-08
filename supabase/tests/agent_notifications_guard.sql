-- The seller agent's notifications (20261022100000). Disposable local DB only.
--   1. An approval the agent files tells the owner, once, and opens the offer.
--   2. Out of rounds tells the seller the gap to their own minimum, once.
--   3. A buyer accepting the agent's counter is "Deal reached", not
--      "Your counter was accepted"; a person's counter keeps the old notice.
--   4. The trigger functions aren't callable by members.
begin;

do $$
declare
  seller uuid := gen_random_uuid();
  buyer uuid := gen_random_uuid();
  part uuid := gen_random_uuid();
  part2 uuid := gen_random_uuid();
  o1 uuid := gen_random_uuid();
  o2 uuid := gen_random_uuid();
  mandate uuid := gen_random_uuid();
  task uuid := gen_random_uuid();
  n integer;
  v_body text;
begin
  insert into auth.users(id, email) values (seller, 'agent-notify-seller@drvn.test'), (buyer, 'agent-notify-buyer@drvn.test');
  insert into public.listings(id, seller_id, title, category, price_cents, shipping_cents, status)
  values (part, seller, 'Notify guard intake', 'performance', 25000, 0, 'active'),
         (part2, seller, 'Notify guard exhaust', 'performance', 50000, 0, 'active');
  insert into public.listing_private_terms(listing_id, seller_id, offer_floor_cents)
  values (part, seller, 20000), (part2, seller, 30000)
  on conflict (listing_id) do update set offer_floor_cents = excluded.offer_floor_cents;
  insert into public.agent_mandates(id, owner_id, scope, listing_id, minimum_cents, target_cents, style, binding_acknowledged_at)
  values (mandate, seller, 'seller', part, 23000, 24500, 'balanced', now());
  insert into public.offers(id, listing_id, buyer_id, amount_cents) values (o1, part, buyer, 22100);
  insert into public.agent_tasks(id, owner_id, mandate_id, scope, objective, status, listing_id, offer_id)
  values (task, seller, mandate, 'seller', 'Handle offers on Notify guard intake', 'needs_approval', part, o1);

  -- 1. Recommends accept.
  insert into public.agent_approvals(owner_id, task_id, kind, offer_id, round_no, amount_cents, reason)
  values (seller, task, 'accept_offer', o1, 3, 23900, 'final_offer_clears_minimum');
  select count(*) into n from public.notifications
  where public.notifications.user_id = seller and public.notifications.kind = 'offer_agent_recommends_accept' and public.notifications.href = '/offers/' || o1
    and public.notifications.title = 'Your agent recommends accepting $239.00' and public.notifications.body = 'Notify guard intake';
  if n <> 1 then raise exception 'FAIL 1: the approval did not notify the seller once (%)', n; end if;
  if exists (select 1 from public.notifications where user_id = buyer and kind like 'offer_agent%') then
    raise exception 'FAIL 1b: the buyer was told about the seller''s agent';
  end if;

  -- 2. Out of rounds, with the gap to the seller's own minimum, once.
  insert into public.agent_events(owner_id, task_id, mandate_id, kind, initiated_by, result)
  values (seller, task, mandate, 'decision', 'offer_round:' || o1 || ':r5', jsonb_build_object('decision', 'hold', 'reason', 'no_offers_left'));
  insert into public.agent_events(owner_id, task_id, mandate_id, kind, initiated_by, result)
  values (seller, task, mandate, 'decision', 'offer_round:' || o1 || ':r6', jsonb_build_object('decision', 'hold', 'reason', 'no_offers_left'));
  select count(*), max(n2.body) into n, v_body from public.notifications n2
  where n2.user_id = seller and n2.kind = 'offer_agent_out_of_rounds' and n2.href = '/offers/' || o1;
  if n <> 1 then raise exception 'FAIL 2: out of rounds notified % times', n; end if;
  if v_body <> 'Notify guard intake · $9.00 between the buyer''s $221.00 and your $230.00 minimum' then
    raise exception 'FAIL 2b: out-of-rounds body was %', v_body;
  end if;
  -- Any other hold says nothing.
  insert into public.agent_events(owner_id, task_id, mandate_id, kind, initiated_by, result)
  values (seller, task, mandate, 'decision', 'task:' || task, jsonb_build_object('decision', 'hold', 'reason', 'not_my_turn'));
  if (select count(*) from public.notifications where user_id = seller and kind like 'offer_agent%') <> 2 then
    raise exception 'FAIL 2c: an ordinary hold notified the seller';
  end if;

  -- 3. Deal reached: the buyer accepts a counter the seller's agent made.
  insert into public.offers(id, listing_id, buyer_id, amount_cents) values (o2, part2, buyer, 40000);
  update public.offers set status = 'countered', counter_amount_cents = 45000, countered_at = now() where id = o2;
  update public.offer_rounds set actor_task_id = task, mandate_version = 1 where offer_id = o2 and actor_role = 'seller' and kind = 'counter';
  update public.offers set status = 'accepted', responded_at = now() where id = o2;
  if (select count(*) from public.notifications where user_id = seller and kind = 'offer_agent_deal_reached' and href = '/offers/' || o2) <> 1 then
    raise exception 'FAIL 3: an accepted agent counter was not "Deal reached"';
  end if;
  if exists (select 1 from public.notifications where user_id = seller and kind = 'offer_counter_accepted' and href like '%' || o2 || '%') then
    raise exception 'FAIL 3b: the seller was told twice';
  end if;

  -- 5. The buyer's agent (20261022110000): out of rounds with the gap,
  --    and "Deal reached" from its own accept, sent with no actor.
  declare
    b_mandate uuid := gen_random_uuid();
    b_task uuid := gen_random_uuid();
    o3 uuid := gen_random_uuid();
    part3 uuid := gen_random_uuid();
  begin
    insert into public.listings(id, seller_id, title, category, price_cents, shipping_cents, status)
    values (part3, seller, 'Notify guard brakes', 'brakes-suspension', 150000, 0, 'active');
    insert into public.agent_mandates(id, owner_id, scope, listing_id, ceiling_cents, ceiling_basis, style)
    values (b_mandate, buyer, 'buyer', part3, 130000, 'item', 'balanced');
    insert into public.offers(id, listing_id, buyer_id, amount_cents) values (o3, part3, buyer, 120000);
    update public.offers set status = 'countered', counter_amount_cents = 146000, countered_at = now() where id = o3;
    insert into public.agent_tasks(id, owner_id, mandate_id, scope, objective, status, listing_id, offer_id)
    values (b_task, buyer, b_mandate, 'buyer', 'Buy Notify guard brakes', 'needs_approval', part3, o3);
    insert into public.agent_approvals(owner_id, task_id, kind, offer_id, round_no, amount_cents, reason)
    values (buyer, b_task, 'accept_offer', o3, 6, 146000, 'over_ceiling_no_offers_left');
    if (select count(*) from public.notifications where user_id = buyer and kind = 'offer_agent_out_of_rounds'
          and title = 'Out of rounds: the seller''s counter is $1,460.00' and body = 'Notify guard brakes · $160.00 over your max') <> 1 then
      raise exception 'FAIL 5: the buyer''s out-of-rounds notice is wrong';
    end if;
    insert into public.offer_rounds(offer_id, round_no, listing_id, buyer_id, actor_role, kind, actor_task_id, mandate_version)
    values (o3, 99, part3, buyer, 'buyer', 'accept', b_task, 1);
    if (select count(*) from public.notifications where user_id = buyer and kind = 'offer_agent_deal_reached'
          and title = 'Deal reached: your agent accepted $1,460.00 — pay within 24 hours') <> 1 then
      raise exception 'FAIL 5b: the buyer was not told their agent made the deal';
    end if;
  end;

  -- 4. Trigger functions stay out of members' reach.
  if has_function_privilege('authenticated', 'public.notify_on_agent_approval()', 'execute')
     or has_function_privilege('authenticated', 'public.notify_on_agent_out_of_rounds()', 'execute')
     or has_function_privilege('authenticated', 'public.notify_on_buyer_agent_accept()', 'execute') then
    raise exception 'FAIL 4: a member can call an agent notification trigger';
  end if;

  raise notice 'all agent notification checks passed';
end $$;

rollback;
