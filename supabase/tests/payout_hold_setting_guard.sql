-- The payout clearing hold is one owner-set value (20261006100000): every
-- path that starts a payout clock reads it, the default changes nothing,
-- and a date once set never moves.
begin;

do $$
declare
  seller uuid := gen_random_uuid();
  buyer uuid := gen_random_uuid();
  listing uuid;
  scanned uuid;
  received uuid;
  legacy uuid;
  collected uuid;
  plain uuid;
  shop uuid;
  malformed uuid;
  rejected boolean;
  stamp timestamptz := now() - interval '1 day';
  hash text := encode(sha256('guard-pass'::bytea), 'hex');
  result jsonb;
begin
  -- 1. Defaults: today's rule, readable by anyone, writable by no client.
  if (select (payout_hold_days, payout_hold_mode) from public.settlement_settings where id)
     is distinct from (7, 'fixed'::text) then
    raise exception 'FAIL 1: the default hold is not a fixed 7 days';
  end if;
  if not has_table_privilege('anon', 'public.settlement_settings', 'select')
     or has_table_privilege('authenticated', 'public.settlement_settings', 'update')
     or has_table_privilege('anon', 'public.settlement_settings', 'insert')
     or has_table_privilege('authenticated', 'public.settlement_settings', 'delete') then
    raise exception 'FAIL 1: settlement_settings privileges are wrong';
  end if;
  if has_function_privilege('anon', 'public.payout_available_at(uuid,timestamptz)', 'execute')
     or has_function_privilege('authenticated', 'public.payout_available_at(uuid,timestamptz)', 'execute') then
    raise exception 'FAIL 1: payout_available_at is client-callable';
  end if;
  raise notice 'PASS 1: fixed 7-day default, public read, no client writes';

  insert into auth.users(id, email) values (seller, 'hold-seller@example.test'), (buyer, 'hold-buyer@example.test');
  insert into public.listings(seller_id, title, category, price_cents, shipping_cents, currency, status)
  values (seller, 'Hold fixture', 'engine', 5000, 0, 'USD', 'sold') returning id into listing;

  insert into public.orders(buyer_id, seller_id, status, shipped_at, subtotal_cents, platform_fee_cents, total_cents, currency)
  values (buyer, seller, 'shipped', stamp, 5000, 500, 5000, 'USD') returning id into scanned;
  insert into public.orders(buyer_id, seller_id, status, shipped_at, subtotal_cents, platform_fee_cents, total_cents, currency)
  values (buyer, seller, 'shipped', stamp, 5000, 500, 5000, 'USD') returning id into received;
  insert into public.orders(buyer_id, seller_id, status, delivered_at, completed_at, subtotal_cents, platform_fee_cents, total_cents, currency)
  values (buyer, seller, 'delivered', stamp, stamp, 5000, 500, 5000, 'USD') returning id into legacy;
  insert into public.orders(buyer_id, seller_id, status, is_collection, subtotal_cents, platform_fee_cents, total_cents, currency)
  values (buyer, seller, 'paid', true, 5000, 500, 5000, 'USD') returning id into collected;
  insert into public.orders(buyer_id, seller_id, status, shipped_at, subtotal_cents, platform_fee_cents, total_cents, currency)
  values (buyer, seller, 'shipped', stamp, 5000, 500, 5000, 'USD') returning id into plain;
  insert into public.orders(buyer_id, seller_id, status, shipped_at, subtotal_cents, platform_fee_cents, total_cents, currency)
  values (buyer, seller, 'shipped', stamp, 5000, 500, 5000, 'USD') returning id into shop;
  insert into public.orders(buyer_id, seller_id, status, shipped_at, subtotal_cents, platform_fee_cents, total_cents, currency)
  values (buyer, seller, 'shipped', stamp, 5000, 500, 5000, 'USD') returning id into malformed;
  insert into public.order_items(order_id, listing_id, title, price_cents, shipping_cents, commercial_snapshot)
  values (shop, listing, 'Hold fixture', 5000, 0,
          '{"commercial":{"return_policy":{"returns_accepted":true,"window_days":60}}}'::jsonb),
         (malformed, listing, 'Hold fixture', 5000, 0,
          '{"commercial":{"return_policy":{"returns_accepted":true,"window_days":"sixty"}}}'::jsonb);
  insert into public.transfer_intents(order_id, seller_id, amount_cents, currency, status, available_at)
  select id, seller, 4500, 'USD', 'holding', null
    from public.orders where id in (scanned, received, legacy, collected, plain, shop, malformed);

  -- 2. Default: a carrier scan starts a 7-day clock, as before.
  update public.orders set status = 'delivered', delivered_at = stamp where id = scanned;
  if (select available_at from public.transfer_intents where order_id = scanned) is distinct from stamp + interval '7 days' then
    raise exception 'FAIL 2: the default hold changed behaviour';
  end if;
  raise notice 'PASS 2: default delivery clock is delivery + 7 days';

  -- 3. A 14-day hold reaches every clock-starting path.
  update public.settlement_settings set payout_hold_days = 14 where id;
  result := public.mark_order_received(received, buyer);
  if (select available_at from public.transfer_intents where order_id = received)
     is distinct from (select delivered_at from public.orders where id = received) + interval '14 days'
     or (result->>'ok')::boolean is not true then
    raise exception 'FAIL 3: the buyer''s receipt ignored the setting';
  end if;
  perform public.mark_order_received(legacy, buyer);
  if (select available_at from public.transfer_intents where order_id = legacy) is distinct from stamp + interval '14 days' then
    raise exception 'FAIL 3: the receipt replay repair ignored the setting';
  end if;
  insert into public.pickup_confirmations(order_id, token_hash, code_hash, expires_at)
  values (collected, hash, encode(sha256('000000'::bytea), 'hex'), now() + interval '1 hour');
  result := public.pickup_redeem(collected, seller, hash);
  if (result->>'ok')::boolean is not true
     or (select available_at from public.transfer_intents where order_id = collected) is distinct from now() + interval '14 days' then
    raise exception 'FAIL 3: the pickup handoff ignored the setting';
  end if;
  raise notice 'PASS 3: receipt, receipt repair and pickup all use the 14-day setting';

  -- 4. A date already set never moves when the setting changes.
  update public.settlement_settings set payout_hold_days = 3 where id;
  if (select available_at from public.transfer_intents where order_id = scanned) is distinct from stamp + interval '7 days'
     or (select available_at from public.transfer_intents where order_id = received)
        is distinct from (select delivered_at from public.orders where id = received) + interval '14 days' then
    raise exception 'FAIL 4: changing the setting moved an existing payout date';
  end if;
  raise notice 'PASS 4: existing payout dates are frozen';

  -- 5. Claim-window mode: the later of the hold, the 30-day problem window
  --    and the shop's return window; a malformed policy is ignored.
  update public.settlement_settings set payout_hold_days = 7, payout_hold_mode = 'claim_window' where id;
  update public.orders set status = 'delivered', delivered_at = stamp where id in (plain, shop, malformed);
  if (select available_at from public.transfer_intents where order_id = plain) is distinct from stamp + interval '30 days'
     or (select available_at from public.transfer_intents where order_id = shop) is distinct from stamp + interval '60 days'
     or (select available_at from public.transfer_intents where order_id = malformed) is distinct from stamp + interval '30 days' then
    raise exception 'FAIL 5: claim-window mode computed the wrong date';
  end if;
  raise notice 'PASS 5: claim-window mode holds to 30 days, or the 60-day shop window';

  -- 6. Bounds: the row is single and its values are checked.
  foreach result in array array['{"days":31}', '{"days":-1}', '{"mode":"weekly"}', '{"row":true}']::jsonb[] loop
    rejected := false;
    begin
      if result ? 'row' then
        insert into public.settlement_settings(id) values (false);
      elsif result ? 'days' then
        update public.settlement_settings set payout_hold_days = (result->>'days')::integer where id;
      else
        update public.settlement_settings set payout_hold_mode = result->>'mode' where id;
      end if;
    exception when check_violation then
      rejected := true;
    end;
    if not rejected then raise exception 'FAIL 6: settlement_settings accepted %', result; end if;
  end loop;
  raise notice 'PASS 6: out-of-range values and a second row are refused';

  -- 7. A missing row falls back to 7 days rather than stranding a payout.
  delete from public.settlement_settings;
  if public.payout_available_at(plain, stamp) is distinct from stamp + interval '7 days' then
    raise exception 'FAIL 7: a missing settings row did not fall back to 7 days';
  end if;
  raise notice 'PASS 7: missing settings fall back to the 7-day default';

  raise notice 'all payout hold setting checks passed';
end $$;

rollback;
