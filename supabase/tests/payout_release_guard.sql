-- Payout release and dispatch risk controls (20261009100000): a plausible
-- receipt releases the payout at once, an early one waits like a carrier
-- scan, and claim_window mode ignores early releases. Dispatch has no amount
-- rule since 20261107200100 (N110): an order of $1,000 or more dispatches
-- with seller-entered tracking like any other.
begin;

do $$
declare
  seller uuid := gen_random_uuid();
  buyer uuid := gen_random_uuid();
  listing uuid;
  early uuid;
  late uuid;
  scanned uuid;
  carrier_only uuid;
  windowed uuid;
  big_bare uuid;
  big_tracked uuid;
  big_label uuid;
  small uuid;
  label_shipment uuid;
  result jsonb;
  rejected boolean;
begin
  -- 1. The deployed decision, and the bounds on the new settings.
  if (select (payout_hold_mode, payout_hold_days, receipt_release_after_days,
              tracking_required_from_cents, card_verification_from_cents)
        from public.settlement_settings where id)
     is distinct from ('fixed'::text, 2, 3, null::bigint, 50000::bigint) then
    raise exception 'FAIL 1: the deployed release settings are not fixed 2 days, 3-day receipt, no tracking threshold, $500 verification';
  end if;
  foreach result in array array['{"receipt":31}', '{"receipt":-1}', '{"tracking":0}', '{"card":0}']::jsonb[] loop
    rejected := false;
    begin
      if result ? 'receipt' then
        update public.settlement_settings set receipt_release_after_days = (result->>'receipt')::integer where id;
      elsif result ? 'tracking' then
        update public.settlement_settings set tracking_required_from_cents = (result->>'tracking')::bigint where id;
      else
        update public.settlement_settings set card_verification_from_cents = (result->>'card')::bigint where id;
      end if;
    exception when check_violation then
      rejected := true;
    end;
    if not rejected then raise exception 'FAIL 1: settlement_settings accepted %', result; end if;
  end loop;
  if has_function_privilege('authenticated', 'public.payout_release_at(uuid,timestamptz,boolean)', 'execute') then
    raise exception 'FAIL 1: payout_release_at is client-callable';
  end if;
  raise notice 'PASS 1: deployed release settings, bounded, no client access';

  insert into auth.users(id, email) values (seller, 'release-seller@example.test'), (buyer, 'release-buyer@example.test');
  insert into public.listings(seller_id, title, category, price_cents, shipping_cents, currency, status)
  values (seller, 'Release fixture', 'engine', 5000, 0, 'USD', 'sold') returning id into listing;

  insert into public.orders(buyer_id, seller_id, status, shipped_at, subtotal_cents, platform_fee_cents, total_cents, currency)
  values (buyer, seller, 'shipped', now() - interval '1 day', 5000, 500, 5000, 'USD') returning id into early;
  insert into public.orders(buyer_id, seller_id, status, shipped_at, subtotal_cents, platform_fee_cents, total_cents, currency)
  values (buyer, seller, 'shipped', now() - interval '4 days', 5000, 500, 5000, 'USD') returning id into late;
  insert into public.orders(buyer_id, seller_id, status, shipped_at, subtotal_cents, platform_fee_cents, total_cents, currency)
  values (buyer, seller, 'shipped', now() - interval '1 hour', 5000, 500, 5000, 'USD') returning id into scanned;
  insert into public.orders(buyer_id, seller_id, status, shipped_at, subtotal_cents, platform_fee_cents, total_cents, currency)
  values (buyer, seller, 'shipped', now() - interval '1 day', 5000, 500, 5000, 'USD') returning id into carrier_only;
  insert into public.orders(buyer_id, seller_id, status, shipped_at, subtotal_cents, platform_fee_cents, total_cents, currency)
  values (buyer, seller, 'shipped', now() - interval '10 days', 5000, 500, 5000, 'USD') returning id into windowed;
  insert into public.shipments(order_id, direction, fulfillment_type, carrier, status, tracking_code, shipped_at, provider, provider_tracker_id)
  values (scanned, 'outbound', 'seller_arranged', 'UPS', 'delivered', '1ZSCAN', now() - interval '1 hour', 'easypost', 'trk_scan');
  insert into public.transfer_intents(order_id, seller_id, amount_cents, currency, status, available_at)
  select id, seller, 4500, 'USD', 'holding', null from public.orders where id in (early, late, scanned, carrier_only, windowed);

  -- 2. A receipt a day after dispatch, with no delivery scan, waits 2 days.
  result := public.mark_order_received(early, buyer);
  if (result->>'ok')::boolean is not true
     or (select available_at from public.transfer_intents where order_id = early)
        is distinct from (select delivered_at from public.orders where id = early) + interval '2 days' then
    raise exception 'FAIL 2: an early receipt released the payout: %', result;
  end if;
  raise notice 'PASS 2: a receipt before the parcel could plausibly arrive waits 2 days';

  -- 3. A receipt 4 days after dispatch, or after a carrier delivery scan,
  --    releases the payout at once — and the flag doesn't leak out.
  perform public.mark_order_received(late, buyer);
  perform public.mark_order_received(scanned, buyer);
  if (select available_at from public.transfer_intents where order_id = late)
       is distinct from (select delivered_at from public.orders where id = late)
     or (select available_at from public.transfer_intents where order_id = scanned)
       is distinct from (select delivered_at from public.orders where id = scanned) then
    raise exception 'FAIL 3: a plausible receipt did not release the payout';
  end if;
  if coalesce(current_setting('drvn.release_on_delivery', true), '') <> '' then
    raise exception 'FAIL 3: the release flag outlived the receipt';
  end if;
  raise notice 'PASS 3: a plausible receipt releases the payout at once';

  -- 4. A carrier scan (no receipt) waits 2 days.
  update public.orders set status = 'delivered', delivered_at = now() where id = carrier_only;
  if (select available_at from public.transfer_intents where order_id = carrier_only) is distinct from now() + interval '2 days' then
    raise exception 'FAIL 4: a carrier scan did not start a 2-day clock';
  end if;
  raise notice 'PASS 4: a carrier scan releases 2 days after delivery';

  -- 5. claim_window mode ignores the early release.
  update public.settlement_settings set payout_hold_mode = 'claim_window' where id;
  perform public.mark_order_received(windowed, buyer);
  if (select available_at from public.transfer_intents where order_id = windowed)
     is distinct from (select delivered_at from public.orders where id = windowed) + interval '30 days' then
    raise exception 'FAIL 5: claim_window mode released early';
  end if;
  update public.settlement_settings set payout_hold_mode = 'fixed' where id;
  raise notice 'PASS 5: claim_window mode still waits for its windows';

  -- 6. Dispatch: no amount rule (N110). $1,000 or more dispatches with
  --    seller-entered tracking, with a tracker, or on a DRVN label alike.
  insert into public.orders(buyer_id, seller_id, status, subtotal_cents, platform_fee_cents, total_cents, currency)
  values (buyer, seller, 'paid', 120000, 12000, 120000, 'USD') returning id into big_bare;
  insert into public.orders(buyer_id, seller_id, status, subtotal_cents, platform_fee_cents, total_cents, currency)
  values (buyer, seller, 'paid', 100000, 10000, 100000, 'USD') returning id into big_tracked;
  insert into public.orders(buyer_id, seller_id, status, subtotal_cents, platform_fee_cents, total_cents, currency)
  values (buyer, seller, 'paid', 150000, 15000, 150000, 'USD') returning id into big_label;
  insert into public.orders(buyer_id, seller_id, status, subtotal_cents, platform_fee_cents, total_cents, currency)
  values (buyer, seller, 'paid', 99999, 10000, 99999, 'USD') returning id into small;
  insert into public.order_items(order_id, listing_id, title, price_cents, shipping_cents)
  select id, listing, 'Release fixture', total_cents, 0 from public.orders where id in (big_bare, big_tracked, big_label, small);
  insert into public.shipments(order_id, direction, fulfillment_type, carrier, status, tracking_code, provider, provider_tracker_id)
  values (big_label, 'outbound', 'drvn_shipping', 'USPS', 'label_purchased', '9400LABEL', 'easypost', 'trk_label')
  returning id into label_shipment;

  result := public.mark_order_dispatched(big_bare, seller, 'UPS', '1ZBARE');
  if (result->>'ok')::boolean is not true
     or (select status from public.orders where id = big_bare) <> 'shipped'
     or (select provider_tracker_id from public.shipments where order_id = big_bare) is not null then
    raise exception 'FAIL 6: a $1,200 order with seller-entered tracking was refused: %', result;
  end if;

  result := public.mark_order_dispatched(big_tracked, seller, 'UPS', '1ZTRACK', 'easypost', 'trk_seller');
  if (result->>'ok')::boolean is not true
     or (select status from public.orders where id = big_tracked) <> 'shipped'
     or (select (provider, provider_tracker_id) from public.shipments where order_id = big_tracked)
        is distinct from ('easypost'::text, 'trk_seller'::text) then
    raise exception 'FAIL 6: a $1,000 order with a registered tracker was refused or lost it: %', result;
  end if;

  result := public.mark_order_dispatched(big_label, seller, 'USPS', '9400LABEL');
  if (result->>'ok')::boolean is not true
     or (select status from public.shipments where id = label_shipment) <> 'in_transit' then
    raise exception 'FAIL 6: a DRVN label dispatch was refused: %', result;
  end if;

  result := public.mark_order_dispatched(small, seller, 'UPS', '1ZSMALL');
  if (result->>'ok')::boolean is not true then
    raise exception 'FAIL 6: an order under $1,000 was refused: %', result;
  end if;

  rejected := false;
  begin
    perform public.mark_order_dispatched(small, seller, 'UPS', '1ZSMALL', 'easypost', null);
  exception when others then rejected := true;
  end;
  if not rejected then raise exception 'FAIL 6: a tracker provider without an id was accepted'; end if;
  raise notice 'PASS 6: dispatch has no amount rule; trackers and DRVN labels still carry through';

  raise notice 'all payout release checks passed';
end $$;

rollback;
