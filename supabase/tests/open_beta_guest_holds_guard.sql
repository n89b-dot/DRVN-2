-- OS-W31 (20261107220800): the invite-only beta is gone, and guest holds are
-- capped atomically (N89): 2 live per device and per network, 1 per listing.
-- 20261108130000: admissions belong to one checkout request, purchase_begin
-- binds them in its own transaction, and one request never releases
-- another's; paid and released holds each stop counting.
begin;

do $$
declare
  newcomer uuid := gen_random_uuid();
  seller uuid := gen_random_uuid();
  guest uuid := gen_random_uuid();
  parts uuid[];
  holds uuid[];
  again uuid[];
  tab_b uuid[];
  refused text;
  begun jsonb;
  order_a uuid;
  order_c uuid;
  device_a text := repeat('a', 64);
  device_b text := repeat('b', 64);
  network_1 text := repeat('1', 64);
  network_2 text := repeat('2', 64);
  req_a text := 'w31-request-a-0000000000';
  req_b text := 'w31-request-b-0000000000';
  req_c text := 'w31-request-c-0000000000';
  req_d text := 'w31-request-d-0000000000';
  req_e text := 'w31-request-e-0000000000';
  req_x text := 'w31-request-x-0000000000';
begin
  -- No payments_mode row: the production default. The fixture seller is
  -- payout-ready, so purchase_begin reserves its parts.
  delete from public.job_config where key = 'payments_mode';

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
  update public.profiles set payouts_enabled = true where id = seller;
  insert into public.listings(seller_id, title, category, price_cents, status)
    select seller, 'W31 part ' || g, 'performance', 1000, 'active' from generate_series(1, 8) g;
  select array_agg(id order by title) into parts from public.listings where seller_id = seller;
  insert into public.offers(listing_id, buyer_id, amount_cents) values (parts[8], newcomer, 900);

  -- ---------- N89: guest holds ----------
  if has_function_privilege('anon', 'public.guest_hold_admit(text,text,uuid[],uuid,text)', 'execute')
     or has_function_privilege('authenticated', 'public.guest_hold_admit(text,text,uuid[],uuid,text)', 'execute')
     or has_function_privilege('anon', 'public.guest_hold_release(text)', 'execute')
     or has_function_privilege('authenticated', 'public.guest_hold_release(text)', 'execute')
     or has_function_privilege('authenticated', 'private.guest_holds_settle(text,jsonb)', 'execute')
     or has_table_privilege('authenticated', 'public.guest_holds', 'select') then
    raise exception 'FAIL 5: clients can reach guest holds';
  end if;
  if to_regprocedure('public.guest_hold_bind(uuid[],uuid)') is not null
     or to_regprocedure('public.guest_hold_release(uuid[])') is not null
     or to_regprocedure('public.guest_hold_admit(text,text,uuid[],uuid)') is not null then
    raise exception 'FAIL 5b: an admission can still be bound or released outside its own request';
  end if;

  holds := public.guest_hold_admit(device_a, network_1, array[parts[1], parts[2]], guest, req_a);
  if cardinality(holds) <> 2 then raise exception 'FAIL 6: two guest holds were not admitted'; end if;
  -- The same request again reuses its holds rather than counting twice.
  again := public.guest_hold_admit(device_a, network_1, array[parts[2], parts[1]], guest, req_a);
  if (select array_agg(x order by x) from unnest(again) x) <> (select array_agg(x order by x) from unnest(holds) x) then
    raise exception 'FAIL 7: a replayed guest checkout took new holds';
  end if;
  -- A third live hold on the same device is refused…
  refused := null;
  begin perform public.guest_hold_admit(device_a, network_2, array[parts[3]], guest, req_x);
  exception when sqlstate 'GH429' then refused := 'yes'; end;
  if refused is null then raise exception 'FAIL 8: a device held a third part'; end if;
  -- …and so is a third on the same network from another device.
  refused := null;
  begin perform public.guest_hold_admit(device_b, network_1, array[parts[3]], guest, req_x);
  exception when sqlstate 'GH429' then refused := 'yes'; end;
  if refused is null then raise exception 'FAIL 9: a network held a third part'; end if;
  -- Another guest can't hold a part a guest already holds.
  refused := null;
  begin perform public.guest_hold_admit(device_b, network_2, array[parts[1]], guest, req_x);
  exception when sqlstate 'GH409' then refused := 'yes'; end;
  if refused is null then raise exception 'FAIL 10: two guests held the same part'; end if;

  -- purchase_begin binds this request's admissions in its own transaction:
  -- the reserved part's to its order, the unreserved part's given back.
  begun := public.purchase_begin(guest, array[parts[1]], req_a, interval '15 minutes');
  order_a := (begun -> 'orders' -> 0 ->> 'order_id')::uuid;
  if order_a is null then raise exception 'FAIL 11: the guest checkout reserved no order: %', begun; end if;
  if (select order_id from public.guest_holds where request_key = req_a and listing_id = parts[1] and released_at is null)
     is distinct from order_a then
    raise exception 'FAIL 11b: purchase_begin did not bind its own admission to its order';
  end if;
  if exists (select 1 from public.guest_holds where request_key = req_a and listing_id = parts[2] and released_at is null) then
    raise exception 'FAIL 12: an admission for a part purchase_begin did not reserve stayed open';
  end if;

  -- Codex P1: a second tab (another request) on the same device and part
  -- gets its own admission, reserves nothing, and gives back only its own.
  tab_b := public.guest_hold_admit(device_a, network_1, array[parts[1]], guest, req_b);
  if tab_b && (select array_agg(id) from public.guest_holds where request_key = req_a) then
    raise exception 'FAIL 13: another request reused this request''s admission';
  end if;
  begun := public.purchase_begin(guest, array[parts[1]], req_b, interval '15 minutes');
  if jsonb_array_length(begun -> 'orders') <> 0 then
    raise exception 'FAIL 13b: a part already reserved was reserved again: %', begun;
  end if;
  if public.guest_hold_release(req_b) <> 0 or public.guest_hold_release(req_a) <> 0 then
    raise exception 'FAIL 13c: a release reached an admission it should not';
  end if;
  if (select count(*) from public.guest_holds where request_key = req_a and order_id = order_a and released_at is null) <> 1 then
    raise exception 'FAIL 13d: the other tab released the pending order''s admission';
  end if;
  if exists (select 1 from public.guest_holds where request_key = req_b and released_at is null) then
    raise exception 'FAIL 13e: the tab that reserved nothing kept its admission';
  end if;
  -- The pending order still counts: two more parts are refused.
  refused := null;
  begin perform public.guest_hold_admit(device_a, network_1, array[parts[3], parts[4]], guest, req_c);
  exception when sqlstate 'GH429' then refused := 'yes'; end;
  if refused is null then raise exception 'FAIL 14: two more holds were admitted beside a pending guest order'; end if;

  -- Paid: two holds bound to pending orders fill the device; once paid both
  -- slots are free again, and both can be filled.
  perform public.guest_hold_admit(device_a, network_1, array[parts[3]], guest, req_c);
  begun := public.purchase_begin(guest, array[parts[3]], req_c, interval '15 minutes');
  order_c := (begun -> 'orders' -> 0 ->> 'order_id')::uuid;
  if order_c is null then raise exception 'FAIL 15: the second guest checkout reserved no order: %', begun; end if;
  refused := null;
  begin perform public.guest_hold_admit(device_a, network_1, array[parts[5]], guest, req_x);
  exception when sqlstate 'GH429' then refused := 'yes'; end;
  if refused is null then raise exception 'FAIL 15b: a third hold was admitted beside two pending orders'; end if;
  update public.orders set status = 'paid' where id in (order_a, order_c);
  holds := public.guest_hold_admit(device_a, network_1, array[parts[5], parts[6]], guest, req_d);
  if cardinality(holds) <> 2 then raise exception 'FAIL 16: paid holds still counted against the guest'; end if;

  -- Released: the two open admissions given back (their purchase_begin never
  -- committed) free both slots again, and both can be filled.
  if public.guest_hold_release(req_d) <> 2 then raise exception 'FAIL 17: the request''s own admissions were not released'; end if;
  holds := public.guest_hold_admit(device_a, network_1, array[parts[7], parts[8]], guest, req_e);
  if cardinality(holds) <> 2 then raise exception 'FAIL 18: released holds still counted against the guest'; end if;

  -- An admission that never became an order lapses after 15 minutes.
  update public.guest_holds set admitted_until = now() - interval '1 minute' where id = any (holds);
  if exists (select 1 from public.guest_holds h where h.id = any (holds) and private.guest_hold_live(h)) then
    raise exception 'FAIL 19: an abandoned admission stayed live';
  end if;

  raise notice 'all open beta and guest hold checks passed';
end $$;

rollback;
