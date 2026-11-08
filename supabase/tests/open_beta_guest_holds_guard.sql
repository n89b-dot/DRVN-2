-- OS-W31 (20261107220800): the invite-only beta is gone, and guest holds are
-- capped atomically (N89): 2 live per device and per network, 1 per listing.
begin;

do $$
declare
  newcomer uuid := gen_random_uuid();
  seller uuid := gen_random_uuid();
  guest uuid := gen_random_uuid();
  parts uuid[];
  holds uuid[];
  again uuid[];
  refused text;
  device_a text := repeat('a', 64);
  device_b text := repeat('b', 64);
  network_1 text := repeat('1', 64);
  network_2 text := repeat('2', 64);
  the_order uuid := gen_random_uuid();
begin
  -- The beta machinery is gone; the agent's own rollout switches stay.
  if to_regclass('public.beta_access_config') is not null or to_regclass('private.beta_signup_claims') is not null
     or to_regprocedure('public.beta_access_status(uuid,text)') is not null
     or to_regprocedure('public.prepare_beta_signup(text,text)') is not null
     or exists (select 1 from pg_trigger where tgname like '%beta_commerce_guard%') then
    raise exception 'FAIL 1: invite-only beta machinery is still installed';
  end if;
  if to_regclass('public.agent_beta_steps') is null then
    raise exception 'FAIL 2: the agent rollout switches went with the beta';
  end if;
  if has_table_privilege('authenticated', 'public.beta_invitations', 'insert')
     or has_table_privilege('authenticated', 'public.beta_memberships', 'update') then
    raise exception 'FAIL 3: members can write the beta history';
  end if;

  -- Every new account gets a profile, invited or not.
  insert into auth.users(id, email, raw_user_meta_data) values
    (newcomer, 'w31-newcomer@drvn.test', '{"full_name":"New Comer"}'),
    (seller, 'w31-seller@drvn.test', '{}'), (guest, 'w31-guest@drvn.test', '{}');
  if (select display_name from public.profiles where id = newcomer) is distinct from 'New Comer' then
    raise exception 'FAIL 4: an account without an invitation got no profile';
  end if;

  -- Listings and offers no longer need a membership.
  insert into public.listings(seller_id, title, category, price_cents, status)
    select seller, 'W31 part ' || g, 'performance', 1000, 'active' from generate_series(1, 4) g;
  select array_agg(id order by title) into parts from public.listings where seller_id = seller;
  insert into public.offers(listing_id, buyer_id, amount_cents) values (parts[4], newcomer, 900);

  -- ---------- N89: guest holds ----------
  if has_function_privilege('anon', 'public.guest_hold_admit(text,text,uuid[],uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.guest_hold_admit(text,text,uuid[],uuid)', 'execute')
     or has_table_privilege('authenticated', 'public.guest_holds', 'select') then
    raise exception 'FAIL 5: clients can reach guest holds';
  end if;

  holds := public.guest_hold_admit(device_a, network_1, array[parts[1], parts[2]], guest);
  if cardinality(holds) <> 2 then raise exception 'FAIL 6: two guest holds were not admitted'; end if;
  -- The same checkout again reuses its holds rather than counting twice.
  again := public.guest_hold_admit(device_a, network_1, array[parts[2], parts[1]], guest);
  if (select array_agg(x order by x) from unnest(again) x) <> (select array_agg(x order by x) from unnest(holds) x) then
    raise exception 'FAIL 7: a replayed guest checkout took new holds';
  end if;
  -- A third live hold on the same device is refused…
  refused := null;
  begin perform public.guest_hold_admit(device_a, network_2, array[parts[3]], guest);
  exception when sqlstate 'GH429' then refused := 'yes'; end;
  if refused is null then raise exception 'FAIL 8: a device held a third part'; end if;
  -- …and so is a third on the same network from another device.
  refused := null;
  begin perform public.guest_hold_admit(device_b, network_1, array[parts[3]], guest);
  exception when sqlstate 'GH429' then refused := 'yes'; end;
  if refused is null then raise exception 'FAIL 9: a network held a third part'; end if;
  -- Another guest can't hold a part a guest already holds.
  refused := null;
  begin perform public.guest_hold_admit(device_b, network_2, array[parts[1]], guest);
  exception when sqlstate 'GH409' then refused := 'yes'; end;
  if refused is null then raise exception 'FAIL 10: two guests held the same part'; end if;

  -- Bound to an order awaiting payment, a hold stays live; once paid it
  -- isn't a hold any more.
  insert into public.orders(id, buyer_id, seller_id, status, subtotal_cents, total_cents)
    values (the_order, guest, seller, 'pending', 1000, 1000);
  insert into public.order_items(order_id, listing_id, title, price_cents, quantity)
    values (the_order, parts[1], 'W31 part 1', 1000, 1);
  if public.guest_hold_bind(holds, guest) <> 2 then raise exception 'FAIL 11: guest holds were not bound'; end if;
  if (select order_id from public.guest_holds where listing_id = parts[1] and released_at is null) is distinct from the_order then
    raise exception 'FAIL 12: a hold was bound to the wrong order';
  end if;
  update public.orders set status = 'paid' where id = the_order;
  -- parts[2]'s hold had no order, so release it as a failed checkout would.
  perform public.guest_hold_release(holds);
  holds := public.guest_hold_admit(device_a, network_1, array[parts[3]], guest);
  if cardinality(holds) <> 1 then raise exception 'FAIL 13: finished holds still counted against the guest'; end if;

  -- An admission that never became an order lapses after 15 minutes.
  update public.guest_holds set admitted_until = now() - interval '1 minute' where id = any (holds);
  if exists (select 1 from public.guest_holds h where h.id = any (holds) and private.guest_hold_live(h)) then
    raise exception 'FAIL 14: an abandoned admission stayed live';
  end if;

  raise notice 'all open beta and guest hold checks passed';
end $$;

rollback;
