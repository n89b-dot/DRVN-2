-- Disputes and delivery proof, eBay-style (20261107210300; OS-W29 N6, N91,
-- N92, N95, OS-R-disputecats). Every transition and clock the rulings set:
--   1. business days are Monday to Friday, UTC, no holidays;
--   2. delivery deadlines freeze when an order is paid, and never move;
--   3. "item never arrived" opens from the latest delivery date for 30 days,
--      undispatched orders included; other problems need a dispatch;
--   4. an open case's reason and clocks are fixed (a new offer moves nothing);
--   5. refund offers expire after 48 hours, at acceptance and escalation,
--      before any cleanup; the cleanup clears only expired offers;
--   6. either party escalates between 3 and 21 business days; the buyer
--      waits out a live offer;
--   7. dispatch stays possible during a case (disputed -> paid on
--      resolution), never during an unresolved chargeback;
--   8. DRVN refunds a not-received case only with no valid tracking;
--   9. a resolved in-app case is final; a bank chargeback still opens; the
--      history is append-only; only the audited admin reopen reopens it;
--  10. delivery proof: verified only on the carrier's date, a matching
--      destination, an in-time scan and a $750+ signature; else review;
--  11. counterfeit and doesn't-fit take the not-as-described path;
--  12. the daily cron waits for the seller's 3 business days;
--  13. nothing here is client-callable.
begin;

do $$
declare
  seller uuid := gen_random_uuid();
  buyer uuid := gen_random_uuid();
  stranger uuid := gen_random_uuid();
  admin_actor uuid := gen_random_uuid();
  listing uuid;
  o uuid;
  o2 uuid;
  coll uuid;
  ship uuid;
  r jsonb;
  t timestamptz;
  rejected boolean;
  fn text;
begin
  insert into auth.users(id, email) values
    (seller, 'w29-seller@example.test'), (buyer, 'w29-buyer@example.test'),
    (stranger, 'w29-stranger@example.test'), (admin_actor, 'w29-admin@example.test');
  -- An admin counts only with an operator-confirmed TOTP factor (20261107200500).
  insert into auth.mfa_factors(id, user_id, friendly_name, factor_type, status, created_at, updated_at)
  values (gen_random_uuid(), admin_actor, 'guard', 'totp', 'verified', now(), now());
  insert into public.admin_users(user_id, mfa_factor_id) select admin_actor, id from auth.mfa_factors where user_id = admin_actor;
  insert into public.listings(seller_id, title, category, price_cents, shipping_cents, currency, status)
  values (seller, 'Dispute recourse fixture', 'engine', 10000, 0, 'USD', 'sold') returning id into listing;

  -- ------------------------------------------------------------------
  -- 1. Business days
  -- ------------------------------------------------------------------
  if private.add_business_days('2026-11-05 10:00+00', 3) <> '2026-11-10 10:00+00'::timestamptz -- Thu -> Tue
     or private.add_business_days('2026-11-06 16:30+00', 1) <> '2026-11-09 16:30+00'::timestamptz -- Fri -> Mon
     or private.add_business_days('2026-11-07 10:00+00', 1) <> '2026-11-09 10:00+00'::timestamptz -- Sat -> Mon
     or private.add_business_days('2026-11-06 09:00+00', 21) <> '2026-12-07 09:00+00'::timestamptz
     or private.add_business_days('2026-11-25 12:00+00', 1) <> '2026-11-26 12:00+00'::timestamptz -- no holidays
     or private.add_business_days('2026-11-07 10:00+00', 0) <> '2026-11-07 10:00+00'::timestamptz then
    raise exception 'FAIL 1: business days are not Monday to Friday';
  end if;
  raise notice 'PASS 1: business days are Monday to Friday, UTC, with no holiday calendar';

  -- ------------------------------------------------------------------
  -- 2. Deadlines freeze at purchase
  -- ------------------------------------------------------------------
  insert into public.orders(buyer_id, seller_id, status, subtotal_cents, platform_fee_cents, total_cents, currency, ship_country, ship_postcode, ship_city)
  values (buyer, seller, 'pending', 10000, 1000, 10000, 'USD', 'US', '89501', 'Reno') returning id into o;
  if (select dispatch_by from public.orders where id = o) is not null then
    raise exception 'FAIL 2: an unpaid order has deadlines';
  end if;
  update public.orders set status = 'paid' where id = o;
  if (select (dispatch_by, deliver_by, delivery_estimate_source) from public.orders where id = o)
     is distinct from (private.add_business_days(now(), 3), private.add_business_days(private.add_business_days(now(), 3), 5), 'fallback'::text) then
    raise exception 'FAIL 2: no-profile fallback is not 3 handling + 5 transit business days: %',
      (select row(dispatch_by, deliver_by, delivery_estimate_source) from public.orders where id = o);
  end if;
  rejected := false;
  begin
    update public.orders set deliver_by = now() + interval '90 days' where id = o;
  exception when insufficient_privilege then rejected := true;
  end;
  if not rejected then raise exception 'FAIL 2: a frozen deadline moved'; end if;
  -- Leaving and re-entering paid never re-freezes.
  select deliver_by into t from public.orders where id = o;
  update public.orders set status = 'disputed', pre_dispute_status = 'paid', disputed_at = now() - interval '9 days' where id = o;
  update public.orders set status = 'paid', dispute_resolved_at = now() where id = o;
  if (select deliver_by from public.orders where id = o) <> t then
    raise exception 'FAIL 2: re-entering paid re-froze the deadlines';
  end if;

  -- The seller's own handling time and the rated quote's transit.
  insert into public.seller_fulfillment_profiles(seller_id, ship_from_name, street1, city, postal_code, country, default_handling_days)
  values (seller, 'Fixture', '1 Main St', 'Reno', '89501', 'US', 2);
  insert into public.orders(buyer_id, seller_id, status, subtotal_cents, platform_fee_cents, total_cents, currency, ship_country, shipping_quote)
  values (buyer, seller, 'paid', 10000, 1000, 10000, 'USD', 'US',
          '[{"est_delivery_days": 2}, {"est_delivery_days": 4}, {"est_delivery_days": null}]'::jsonb) returning id into o2;
  if (select (dispatch_by, deliver_by, delivery_estimate_source) from public.orders where id = o2)
     is distinct from (private.add_business_days(now(), 2), private.add_business_days(private.add_business_days(now(), 2), 4), 'quote'::text) then
    raise exception 'FAIL 2: seller handling or quoted transit not used';
  end if;
  -- International fallback: 15 business days.
  insert into public.orders(buyer_id, seller_id, status, subtotal_cents, platform_fee_cents, total_cents, currency, ship_country)
  values (buyer, seller, 'paid', 10000, 1000, 10000, 'USD', 'GB') returning id into o2;
  if (select deliver_by from public.orders where id = o2) <> private.add_business_days(private.add_business_days(now(), 2), 15) then
    raise exception 'FAIL 2: international fallback is not 15 business days';
  end if;
  -- Collection: an availability deadline only.
  insert into public.orders(buyer_id, seller_id, status, is_collection, subtotal_cents, platform_fee_cents, total_cents, currency)
  values (buyer, seller, 'paid', true, 10000, 1000, 10000, 'USD') returning id into coll;
  if (select (available_by, dispatch_by, deliver_by, delivery_estimate_source) from public.orders where id = coll)
     is distinct from (private.add_business_days(now(), 2), null::timestamptz, null::timestamptz, 'collection'::text) then
    raise exception 'FAIL 2: collection has no separate availability deadline';
  end if;
  raise notice 'PASS 2: deadlines freeze at purchase from the seller''s handling and the quote or the fallback, and never move';

  -- ------------------------------------------------------------------
  -- 3. Opening "item never arrived"
  -- ------------------------------------------------------------------
  insert into public.orders(buyer_id, seller_id, status, subtotal_cents, platform_fee_cents, total_cents, currency, ship_country, ship_postcode, ship_city)
  values (buyer, seller, 'paid', 10000, 1000, 10000, 'USD', 'US', '89501', 'Reno') returning id into o;
  insert into public.order_items(order_id, listing_id, title, price_cents, shipping_cents) values (o, listing, 'Fixture', 10000, 0);
  r := public.open_order_dispute(o, buyer, 'item_not_received', 'Nothing yet');
  if r->>'reason' is distinct from 'too_early' or (r->>'opens_at')::timestamptz <> (select deliver_by from public.orders where id = o) then
    raise exception 'FAIL 3: not-received opened before the latest delivery date: %', r;
  end if;
  r := public.open_order_dispute(o, buyer, 'item_not_as_described', null);
  if r->>'reason' is distinct from 'wrong_stage' then raise exception 'FAIL 3: not-as-described opened before dispatch: %', r; end if;
  r := public.open_order_dispute(o, stranger, 'item_not_received', null);
  if r->>'reason' is distinct from 'not_your_order' then raise exception 'FAIL 3: a stranger opened a case: %', r; end if;

  -- Paid 14 days ago: past the latest delivery date (3 + 5 business days).
  insert into public.orders(buyer_id, seller_id, status, subtotal_cents, platform_fee_cents, total_cents, currency, ship_country, ship_postcode, ship_city, created_at)
  values (buyer, stranger, 'paid', 10000, 1000, 10000, 'USD', 'US', '89501', 'Reno', now() - interval '14 days') returning id into o;
  insert into public.order_items(order_id, listing_id, title, price_cents, shipping_cents) values (o, listing, 'Fixture', 10000, 0);
  r := public.open_order_dispute(o, buyer, 'item_not_received', '  Never came  ');
  if (r->>'ok')::boolean is not true then raise exception 'FAIL 3: not-received refused past the latest delivery date: %', r; end if;
  if (select (status, pre_dispute_status, dispute_category, dispute_reason, disputed_by) from public.orders where id = o)
       is distinct from ('disputed'::text, 'paid'::text, 'item_not_received'::text, 'Never came'::text, buyer)
     or (select dispute_respond_by from public.orders where id = o) <> private.add_business_days((select disputed_at from public.orders where id = o), 3)
     or (select dispute_escalate_until from public.orders where id = o) <> private.add_business_days((select disputed_at from public.orders where id = o), 21) then
    raise exception 'FAIL 3: the case did not freeze its 3- and 21-business-day clocks';
  end if;
  r := public.open_order_dispute(o, buyer, 'item_not_received', null);
  if r->>'reason' is distinct from 'already_open' then raise exception 'FAIL 3: a second case opened: %', r; end if;

  -- Paid 70 days ago: more than 30 days after the latest delivery date.
  insert into public.orders(buyer_id, seller_id, status, subtotal_cents, platform_fee_cents, total_cents, currency, ship_country, created_at)
  values (buyer, stranger, 'paid', 10000, 1000, 10000, 'USD', 'US', now() - interval '70 days') returning id into o2;
  r := public.open_order_dispute(o2, buyer, 'item_not_received', null);
  if r->>'reason' is distinct from 'window_closed' then raise exception 'FAIL 3: not-received opened after 30 days: %', r; end if;
  raise notice 'PASS 3: not-received opens from the latest delivery date for 30 days, undispatched included, and freezes the clocks';

  -- ------------------------------------------------------------------
  -- 4. An open case's reason and clocks are fixed
  -- ------------------------------------------------------------------
  select dispute_respond_by into t from public.orders where id = o;
  foreach fn in array array['disputed_at', 'dispute_reason', 'dispute_category', 'dispute_respond_by', 'dispute_escalate_until'] loop
    rejected := false;
    begin
      execute format('update public.orders set %I = %s where id = %L', fn,
        case fn when 'dispute_reason' then quote_literal('rewritten')
                when 'dispute_category' then quote_literal('other')
                else 'now() + interval ''90 days''' end, o);
    exception when insufficient_privilege then rejected := true;
    end;
    if not rejected then raise exception 'FAIL 4: % changed on an open case', fn; end if;
  end loop;
  update public.orders set refund_offer_cents = 100, refund_offered_at = now() where id = o;
  if (select dispute_respond_by from public.orders where id = o) <> t then
    raise exception 'FAIL 4: a new offer moved the case clock';
  end if;
  raise notice 'PASS 4: an open case''s reason, opener and clocks cannot change; a new offer moves nothing';

  -- ------------------------------------------------------------------
  -- 5. Offers expire after 48 hours
  -- ------------------------------------------------------------------
  if (select refund_offer_expires_at - refund_offered_at from public.orders where id = o) <> interval '48 hours' then
    raise exception 'FAIL 5: the offer expiry is not 48 hours from the offer';
  end if;
  update public.orders set refund_offer_expires_at = now() + interval '30 days' where id = o;
  if (select refund_offer_expires_at - refund_offered_at from public.orders where id = o) <> interval '48 hours' then
    raise exception 'FAIL 5: the offer expiry could be moved';
  end if;
  -- A live offer can be claimed (acceptRefund's compare-and-set).
  update public.orders set refund_offered_at = null where id = o and refund_offered_at is not null;
  if (select refund_offered_at from public.orders where id = o) is not null then raise exception 'FAIL 5: a live offer could not be claimed'; end if;
  -- An expired one cannot, even before cleanup.
  update public.orders set refund_offer_cents = 100, refund_offered_at = now() - interval '49 hours' where id = o;
  rejected := false;
  begin
    update public.orders set refund_offered_at = null where id = o;
  exception when insufficient_privilege then rejected := true;
  end;
  if not rejected then raise exception 'FAIL 5: an expired offer was claimed'; end if;
  -- Cleanup clears expired offers only, and leaves the case's clocks.
  insert into public.orders(buyer_id, seller_id, status, pre_dispute_status, dispute_category, disputed_at,
    refund_offer_cents, refund_offered_at, subtotal_cents, platform_fee_cents, total_cents, currency)
  values (buyer, seller, 'disputed', 'shipped', 'wrong_item', now(), 200, now() - interval '47 hours', 10000, 1000, 10000, 'USD')
  returning id into o2;
  if public.expire_refund_offers(200) < 1 then raise exception 'FAIL 5: cleanup cleared nothing'; end if;
  if (select (refund_offer_cents, refund_offered_at) from public.orders where id = o2) is distinct from (200, now() - interval '47 hours')
     or (select (refund_offer_cents, refund_offered_at) from public.orders where id = o) is distinct from (null::int, null::timestamptz)
     or (select dispute_respond_by from public.orders where id = o) <> t
     or not exists (select 1 from public.notifications where user_id = buyer and kind = 'refund_offer_expired' and href = '/orders/' || o) then
    raise exception 'FAIL 5: cleanup did not clear the expired offer alone';
  end if;
  raise notice 'PASS 5: offers expire 48 hours after they are made, enforced at acceptance before any cleanup';

  -- ------------------------------------------------------------------
  -- 6. Escalation: either party, 3 to 21 business days
  -- ------------------------------------------------------------------
  r := public.escalate_order_dispute(o, buyer);
  if r->>'reason' is distinct from 'too_early' then raise exception 'FAIL 6: escalation opened inside the seller''s 3 business days: %', r; end if;
  r := public.escalate_order_dispute(o, gen_random_uuid());
  if r->>'reason' is distinct from 'not_party' then raise exception 'FAIL 6: a stranger escalated: %', r; end if;
  -- A case reported 8 days ago, with a live offer: the buyer waits it out.
  insert into public.orders(buyer_id, seller_id, status, pre_dispute_status, dispute_category, disputed_at, disputed_by,
    dispute_respond_by, dispute_escalate_until, refund_offer_cents, refund_offered_at, subtotal_cents, platform_fee_cents, total_cents, currency)
  values (buyer, seller, 'disputed', 'shipped', 'wrong_item', now() - interval '8 days', buyer,
    private.add_business_days(now() - interval '8 days', 3), private.add_business_days(now() - interval '8 days', 21),
    100, now() - interval '1 hour', 10000, 1000, 10000, 'USD') returning id into o2;
  r := public.escalate_order_dispute(o2, buyer);
  if r->>'reason' is distinct from 'offer_pending' then raise exception 'FAIL 6: a live offer did not hold the buyer: %', r; end if;
  -- Expired, not yet cleaned up: no longer blocks.
  update public.orders set refund_offer_cents = 100, refund_offered_at = now() - interval '49 hours' where id = o2;
  r := public.escalate_order_dispute(o2, buyer);
  if (r->>'ok')::boolean is not true or (select dispute_escalated_by from public.orders where id = o2) <> buyer then
    raise exception 'FAIL 6: an expired offer blocked escalation: %', r;
  end if;
  r := public.escalate_order_dispute(o2, seller);
  if r->>'reason' is distinct from 'already_escalated' then raise exception 'FAIL 6: escalated twice: %', r; end if;
  -- The seller can escalate too.
  insert into public.orders(buyer_id, seller_id, status, pre_dispute_status, dispute_category, disputed_at, disputed_by,
    refund_offer_cents, refund_offered_at, subtotal_cents, platform_fee_cents, total_cents, currency)
  values (buyer, seller, 'disputed', 'delivered', 'counterfeit', now() - interval '8 days', buyer,
    100, now(), 10000, 1000, 10000, 'USD') returning id into o2;
  r := public.escalate_order_dispute(o2, seller);
  if (r->>'ok')::boolean is not true then raise exception 'FAIL 6: the seller could not escalate (legacy clock from disputed_at): %', r; end if;
  -- Past 21 business days: closed.
  insert into public.orders(buyer_id, seller_id, status, pre_dispute_status, dispute_category, disputed_at, disputed_by,
    subtotal_cents, platform_fee_cents, total_cents, currency)
  values (buyer, seller, 'disputed', 'delivered', 'other', now() - interval '40 days', buyer, 10000, 1000, 10000, 'USD') returning id into o2;
  r := public.escalate_order_dispute(o2, buyer);
  if r->>'reason' is distinct from 'window_closed' then raise exception 'FAIL 6: escalation after 21 business days: %', r; end if;
  raise notice 'PASS 6: either party escalates between 3 and 21 business days; only a live offer holds the buyer';

  -- ------------------------------------------------------------------
  -- 7. Dispatch during a case; never during a chargeback
  -- ------------------------------------------------------------------
  r := public.mark_order_dispatched(o, stranger, 'UPS', '1ZW29CASE');
  if (r->>'ok')::boolean is not true or r->>'status' <> 'disputed'
     or (select (status, pre_dispute_status, tracking_number) from public.orders where id = o)
        is distinct from ('disputed'::text, 'shipped'::text, '1ZW29CASE'::text)
     or not exists (select 1 from public.shipments where order_id = o and direction = 'outbound' and tracking_code = '1ZW29CASE') then
    raise exception 'FAIL 7: dispatch during a not-received case was refused or closed it: %', r;
  end if;
  r := public.mark_order_dispatched(o, stranger, 'UPS', '1ZW29CASE');
  if (r->>'replayed')::boolean is not true then raise exception 'FAIL 7: a dispatch replay during a case was not a replay: %', r; end if;
  -- A case on an undispatched order with an unresolved chargeback: refused.
  insert into public.orders(buyer_id, seller_id, status, pre_dispute_status, dispute_category, disputed_at, subtotal_cents, platform_fee_cents, total_cents, currency)
  values (buyer, seller, 'disputed', 'paid', 'item_not_received', now(), 10000, 1000, 10000, 'USD') returning id into o2;
  insert into public.order_items(order_id, listing_id, title, price_cents, shipping_cents) values (o2, listing, 'Fixture', 10000, 0);
  insert into public.stripe_dispute_journal(dispute_id, payment_reference, amount_cents, currency, state, last_event_id, last_event_created, order_ids)
  values ('dp_w29_open', 'pi_w29', 10000, 'usd', 'open', 'evt_w29', 1, array[o2]);
  r := public.mark_order_dispatched(o2, seller, 'UPS', '1ZW29CB');
  if (r->>'ok')::boolean is not false or exists (select 1 from public.shipments where order_id = o2) then
    raise exception 'FAIL 7: dispatched during an unresolved chargeback: %', r;
  end if;
  -- Resolving a case on an undispatched order restores paid.
  update public.stripe_dispute_journal set state = 'won' where dispute_id = 'dp_w29_open';
  update public.orders set status = coalesce(pre_dispute_status, 'delivered'), dispute_resolved_at = now(), dispute_outcome = 'closed_by_buyer' where id = o2;
  if (select status from public.orders where id = o2) <> 'paid' then raise exception 'FAIL 7: disputed -> paid did not restore'; end if;
  raise notice 'PASS 7: dispatch stays possible during a case, resolves back to paid, and never during a chargeback';

  -- ------------------------------------------------------------------
  -- 8. Not received: refunded only without valid tracking
  -- ------------------------------------------------------------------
  insert into public.orders(buyer_id, seller_id, status, pre_dispute_status, dispute_category, disputed_at, disputed_by,
    dispute_respond_by, dispute_escalate_until, dispute_escalated_at, subtotal_cents, platform_fee_cents, total_cents, currency,
    ship_postcode, ship_city, ship_country, created_at)
  values (buyer, seller, 'disputed', 'paid', 'item_not_received', now() - interval '8 days', buyer,
    now() - interval '1 day', now() + interval '10 days', now() - interval '1 hour', 80000, 8000, 80000, 'USD',
    '89501', 'Reno', 'US', now() - interval '20 days') returning id into o2;
  insert into public.order_items(order_id, listing_id, title, price_cents, shipping_cents) values (o2, listing, 'Fixture', 80000, 0);
  if not public.not_received_refund_due(o2)
     or not exists (select 1 from public.not_received_refunds_due(50) d where d.order_id = o2) then
    raise exception 'FAIL 8: an escalated not-received case with no tracking is not due';
  end if;
  -- Tracking in transit is not valid tracking: still due.
  r := public.mark_order_dispatched(o2, seller, 'UPS', '1ZW29LATE');
  select id into ship from public.shipments where order_id = o2 and direction = 'outbound';
  if not public.not_received_refund_due(o2) then raise exception 'FAIL 8: in-transit tracking stopped the refund'; end if;
  -- A delivered parcel with proof in review: support decides, no refund.
  update public.shipments set status = 'delivered', delivered_at = now() where id = ship;
  r := public.record_delivery_proof(ship, 'postcode', 'review', array['signature_missing'], now() - interval '1 hour', '89501', 'Reno', now() - interval '3 days', null);
  if public.not_received_refund_due(o2) or not public.order_has_valid_tracking(o2) then
    raise exception 'FAIL 8: a delivery under review was refunded';
  end if;
  -- Not before the seller's 3 business days, nor unescalated.
  insert into public.orders(buyer_id, seller_id, status, pre_dispute_status, dispute_category, disputed_at,
    dispute_respond_by, dispute_escalated_at, subtotal_cents, platform_fee_cents, total_cents, currency)
  values (buyer, seller, 'disputed', 'paid', 'item_not_received', now(), now() + interval '2 days', now(), 10000, 1000, 10000, 'USD') returning id into o2;
  if public.not_received_refund_due(o2) then raise exception 'FAIL 8: refunded inside the seller''s 3 business days'; end if;
  insert into public.orders(buyer_id, seller_id, status, pre_dispute_status, dispute_category, disputed_at,
    dispute_respond_by, subtotal_cents, platform_fee_cents, total_cents, currency)
  values (buyer, seller, 'disputed', 'paid', 'item_not_received', now() - interval '8 days', now() - interval '1 day', 10000, 1000, 10000, 'USD') returning id into o2;
  if public.not_received_refund_due(o2) then raise exception 'FAIL 8: refunded without escalation'; end if;
  -- Collection: made available is not refunded automatically.
  update public.orders set status = 'disputed', pre_dispute_status = 'paid', dispute_category = 'item_not_received',
    disputed_at = now() - interval '8 days', dispute_escalated_at = now() where id = coll;
  if not public.not_received_refund_due(coll) then raise exception 'FAIL 8: an unavailable collection is not due'; end if;
  update public.orders set pickup_ready_at = now() where id = coll;
  if public.not_received_refund_due(coll) then raise exception 'FAIL 8: a collection made available was due'; end if;
  -- Other categories never qualify.
  insert into public.orders(buyer_id, seller_id, status, pre_dispute_status, dispute_category, disputed_at,
    dispute_respond_by, dispute_escalated_at, subtotal_cents, platform_fee_cents, total_cents, currency)
  values (buyer, seller, 'disputed', 'shipped', 'wrong_item', now() - interval '8 days', now() - interval '1 day', now(), 10000, 1000, 10000, 'USD') returning id into o2;
  if public.not_received_refund_due(o2) then raise exception 'FAIL 8: a wrong-item case qualified'; end if;
  raise notice 'PASS 8: DRVN refunds an escalated not-received case past 3 business days only without valid tracking';

  -- ------------------------------------------------------------------
  -- 9. Finality, chargebacks, history, the audited reopen
  -- ------------------------------------------------------------------
  insert into public.orders(buyer_id, seller_id, status, subtotal_cents, platform_fee_cents, total_cents, currency, shipped_at, delivered_at)
  values (buyer, seller, 'delivered', 10000, 1000, 10000, 'USD', now() - interval '3 days', now() - interval '1 day') returning id into o2;
  r := public.open_order_dispute(o2, buyer, 'does_not_fit', 'Wrong bolt pattern');
  if (r->>'ok')::boolean is not true then raise exception 'FAIL 9: setup open failed: %', r; end if;
  update public.orders set status = coalesce(pre_dispute_status, 'delivered'), dispute_resolved_at = now(),
    dispute_outcome = 'closed_by_buyer', refund_offer_cents = null, refund_offered_at = null where id = o2;
  if (select count(*) from public.order_dispute_history
       where order_id = o2 and event = 'resolved' and kind = 'in_app' and category = 'does_not_fit'
         and reason = 'Wrong bolt pattern' and outcome = 'closed_by_buyer' and resolved_to_status = 'delivered'
         and respond_by is not null) <> 1 then
    raise exception 'FAIL 9: the closed case was not kept';
  end if;
  r := public.open_order_dispute(o2, buyer, 'item_not_as_described', 'Again');
  if r->>'reason' is distinct from 'resolved_final' then raise exception 'FAIL 9: a resolved case reopened: %', r; end if;
  rejected := false;
  begin
    update public.orders set status = 'disputed', pre_dispute_status = 'delivered', disputed_at = now(),
      dispute_category = 'other', dispute_resolved_at = null, dispute_outcome = null where id = o2;
  exception when insufficient_privilege then rejected := true;
  end;
  if not rejected then raise exception 'FAIL 9: a direct write reopened a final case'; end if;
  rejected := false;
  begin
    update public.order_dispute_history set outcome = 'admin_refunded' where order_id = o2;
  exception when insufficient_privilege then rejected := true;
  end;
  if not rejected then raise exception 'FAIL 9: dispute history was rewritten'; end if;
  rejected := false;
  begin
    delete from public.order_dispute_history where order_id = o2;
  exception when insufficient_privilege then rejected := true;
  end;
  if not rejected then raise exception 'FAIL 9: dispute history was deleted'; end if;

  -- The audited reopen: admins with step-up only.
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', admin_actor, 'role', 'authenticated',
    'aal', 'aal2', 'amr', json_build_array(json_build_object('method', 'totp',
    'timestamp', extract(epoch from now())::bigint)))::text, true);
  r := public.execute_admin_command('dispute.reopen', o2, 'New photos from the buyer', jsonb_build_object('orderId', o2));
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
  if (select (status, pre_dispute_status, dispute_category, dispute_reason, dispute_escalated_by) from public.orders where id = o2)
       is distinct from ('disputed'::text, 'delivered'::text, 'does_not_fit'::text, 'Wrong bolt pattern'::text, admin_actor)
     or (select count(*) from public.order_dispute_history where order_id = o2 and event = 'resolved' and outcome = 'closed_by_buyer') <> 1
     or not exists (select 1 from public.order_dispute_history where order_id = o2 and event = 'reopened' and actor_id = admin_actor
                     and note = 'New photos from the buyer' and reopened_from is not null)
     or not exists (select 1 from public.admin_audit_log where action = 'dispute.reopen' and subject_id = o2 and actor_id = admin_actor) then
    raise exception 'FAIL 9: the audited reopen did not keep the history or the audit: %', r;
  end if;
  if coalesce(current_setting('drvn.dispute_reopen', true), '') <> '' then
    raise exception 'FAIL 9: the reopen left its bypass set';
  end if;
  -- Members can't reach the reopen.
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', buyer, 'role', 'authenticated')::text, true);
  rejected := false;
  begin
    perform public.execute_admin_command('dispute.reopen', o, 'me', '{}'::jsonb);
  exception when insufficient_privilege then rejected := true;
  end;
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
  if not rejected then raise exception 'FAIL 9: a member reached the reopen'; end if;

  -- A bank chargeback still opens after an in-app resolution.
  update public.orders set status = 'delivered', dispute_resolved_at = now(), dispute_outcome = 'admin_resolved' where id = o2;
  insert into public.payments(order_id, provider, provider_reference, status, amount_cents, currency)
  values (o2, 'stripe', 'pi_w29_final', 'succeeded', 10000, 'USD');
  fn := public.apply_stripe_dispute_event('dp_w29_after', 'pi_w29_final', 10000, 'usd', 'needs_response', false, 'evt_w29_after', 10, gen_random_uuid());
  if fn <> 'committed'
     or (select (status, stripe_dispute_id) from public.orders where id = o2) is distinct from ('disputed'::text, 'dp_w29_after'::text) then
    raise exception 'FAIL 9: a bank chargeback could not open after an in-app resolution';
  end if;
  raise notice 'PASS 9: a resolved in-app case is final; chargebacks still open; history is append-only; only the audited admin reopen reopens';

  -- ------------------------------------------------------------------
  -- 10. Delivery proof
  -- ------------------------------------------------------------------
  insert into public.orders(buyer_id, seller_id, status, subtotal_cents, platform_fee_cents, total_cents, currency,
    ship_postcode, ship_city, ship_country, created_at)
  values (buyer, seller, 'paid', 10000, 1000, 10000, 'USD', '89501-1234', 'Reno', 'US', now() - interval '6 days') returning id into o2;
  insert into public.order_items(order_id, listing_id, title, price_cents, shipping_cents) values (o2, listing, 'Fixture', 10000, 0);
  perform public.mark_order_dispatched(o2, seller, 'USPS', '9400W29PROOF');
  select id into ship from public.shipments where order_id = o2 and direction = 'outbound';
  r := public.record_delivery_proof(ship, 'postcode', 'verified', '{}', now() - interval '1 day', '89501', 'Reno', now() - interval '5 days', null);
  if r->>'reason' is distinct from 'not_delivered' or exists (select 1 from public.delivery_proofs where shipment_id = ship) then
    raise exception 'FAIL 10: proof recorded for a parcel not delivered: %', r;
  end if;
  update public.shipments set status = 'delivered', delivered_at = now() where id = ship;
  r := public.record_delivery_proof(ship, 'postcode', 'verified', '{}', now() - interval '1 day', '89501', 'Reno', now() - interval '5 days', null);
  if r->>'verdict' is distinct from 'verified'
     or (select (order_postcode, signature_required, deliver_by) from public.delivery_proofs where shipment_id = ship)
        is distinct from ('89501-1234'::text, false, (select deliver_by from public.orders where id = o2)) then
    raise exception 'FAIL 10: a valid proof was not verified against the order''s own facts: %', r;
  end if;
  -- The app can't verify what the order's facts contradict: another postcode,
  -- no carrier date ("now" is never used), a scan before the sale.
  r := public.record_delivery_proof(ship, 'postcode', 'verified', '{}', now() - interval '1 day', '10001', 'Reno', now() - interval '5 days', null);
  if r->>'verdict' is distinct from 'review' or (select reasons from public.delivery_proofs where shipment_id = ship) <> array['evidence_check_failed'] then
    raise exception 'FAIL 10: a mismatched destination was verified: %', r;
  end if;
  r := public.record_delivery_proof(ship, 'postcode', 'verified', '{}', null, '89501', 'Reno', now() - interval '5 days', null);
  if r->>'verdict' is distinct from 'review' then raise exception 'FAIL 10: a proof with no carrier date was verified'; end if;
  r := public.record_delivery_proof(ship, 'postcode', 'verified', '{}', now() - interval '1 day', '89501', 'Reno', now() - interval '30 days', null);
  if r->>'verdict' is distinct from 'review' then raise exception 'FAIL 10: a scan before the sale was verified'; end if;
  -- City only when the carrier gave no postcode.
  r := public.record_delivery_proof(ship, 'city', 'verified', '{}', now() - interval '1 day', null, ' reno ', now() - interval '5 days', null);
  if r->>'verdict' is distinct from 'verified' then raise exception 'FAIL 10: a city match without a postcode was refused: %', r; end if;
  r := public.record_delivery_proof(ship, 'city', 'verified', '{}', now() - interval '1 day', '89502', 'Reno', now() - interval '5 days', null);
  if r->>'verdict' is distinct from 'review' then raise exception 'FAIL 10: a city match overrode a different postcode'; end if;
  -- $750+: a signature is required to verify.
  insert into public.orders(buyer_id, seller_id, status, subtotal_cents, platform_fee_cents, total_cents, currency,
    ship_postcode, ship_city, ship_country, created_at)
  values (buyer, seller, 'paid', 75000, 7500, 75000, 'USD', '89501', 'Reno', 'US', now() - interval '6 days') returning id into o2;
  insert into public.order_items(order_id, listing_id, title, price_cents, shipping_cents) values (o2, listing, 'Fixture', 75000, 0);
  perform public.mark_order_dispatched(o2, seller, 'USPS', '9400W29SIG');
  select id into ship from public.shipments where order_id = o2 and direction = 'outbound';
  update public.shipments set status = 'delivered', delivered_at = now() where id = ship;
  r := public.record_delivery_proof(ship, 'postcode', 'verified', '{}', now() - interval '1 day', '89501', 'Reno', now() - interval '5 days', null);
  if r->>'verdict' is distinct from 'review' then raise exception 'FAIL 10: a $750 delivery without a signature was verified'; end if;
  r := public.record_delivery_proof(ship, 'postcode', 'verified', '{}', now() - interval '1 day', '89501', 'Reno', now() - interval '5 days', 'J SMITH');
  if r->>'verdict' is distinct from 'verified' then raise exception 'FAIL 10: a signed $750 delivery was refused: %', r; end if;
  -- And no direct write can store an unsupported 'verified'.
  rejected := false;
  begin
    update public.delivery_proofs set carrier_delivered_at = null where shipment_id = ship;
  exception when check_violation then rejected := true;
  end;
  if not rejected then raise exception 'FAIL 10: a verified proof lost its carrier date'; end if;
  raise notice 'PASS 10: proof is verified only on the carrier''s date, a matching postcode (else city), an in-time scan and a $750+ signature';

  -- ------------------------------------------------------------------
  -- 11. Counterfeit and doesn't-fit: the not-as-described path
  -- ------------------------------------------------------------------
  insert into public.orders(buyer_id, seller_id, status, subtotal_cents, platform_fee_cents, total_cents, currency, shipped_at)
  values (buyer, seller, 'shipped', 10000, 1000, 10000, 'USD', now()) returning id into o2;
  r := public.open_order_dispute(o2, buyer, 'counterfeit', 'Fake logo');
  if (r->>'ok')::boolean is not true then raise exception 'FAIL 11: counterfeit refused on a shipped order: %', r; end if;
  insert into public.orders(buyer_id, seller_id, status, subtotal_cents, platform_fee_cents, total_cents, currency, delivered_at)
  values (buyer, seller, 'delivered', 10000, 1000, 10000, 'USD', now() - interval '31 days') returning id into o2;
  r := public.open_order_dispute(o2, buyer, 'does_not_fit', null);
  if r->>'reason' is distinct from 'window_closed' then raise exception 'FAIL 11: does_not_fit opened after 30 days from delivery: %', r; end if;
  rejected := false;
  begin
    update public.orders set dispute_category = 'changed_my_mind' where id = o2;
  exception when check_violation then rejected := true;
  end;
  if not rejected then raise exception 'FAIL 11: the category CHECK accepted an unknown category'; end if;
  raise notice 'PASS 11: counterfeit and doesn''t-fit open like not-as-described';

  -- ------------------------------------------------------------------
  -- 12. The daily cron waits for the frozen seller deadline
  -- ------------------------------------------------------------------
  insert into public.orders(buyer_id, seller_id, status, pre_dispute_status, dispute_category, disputed_at, dispute_respond_by,
    subtotal_cents, platform_fee_cents, total_cents, currency)
  values (buyer, seller, 'disputed', 'shipped', 'wrong_item', now() - interval '5 days', now() + interval '1 day', 10000, 1000, 10000, 'USD') returning id into o2;
  perform public.escalate_stale_disputes();
  if (select dispute_escalated_at from public.orders where id = o2) is not null then
    raise exception 'FAIL 12: the cron escalated inside the seller''s 3 business days';
  end if;
  insert into public.orders(buyer_id, seller_id, status, pre_dispute_status, dispute_category, disputed_at, dispute_respond_by,
    subtotal_cents, platform_fee_cents, total_cents, currency)
  values (buyer, seller, 'disputed', 'shipped', 'wrong_item', now() - interval '7 days', now() - interval '2 days', 10000, 1000, 10000, 'USD') returning id into o2;
  perform public.escalate_stale_disputes();
  if (select dispute_escalated_at from public.orders where id = o2) is null then
    raise exception 'FAIL 12: the cron missed a case a day past the seller deadline';
  end if;
  raise notice 'PASS 12: the daily cron escalates a day after the frozen seller deadline';

  -- ------------------------------------------------------------------
  -- 13. Nothing here is client-callable
  -- ------------------------------------------------------------------
  foreach fn in array array[
    'public.open_order_dispute(uuid,uuid,text,text)',
    'public.escalate_order_dispute(uuid,uuid)',
    'public.not_received_refund_due(uuid)',
    'public.not_received_refunds_due(integer)',
    'public.order_has_valid_tracking(uuid)',
    'public.expire_refund_offers(integer)',
    'public.record_delivery_proof(uuid,text,text,text[],timestamp with time zone,text,text,timestamp with time zone,text)',
    'public.mark_order_dispatched(uuid,uuid,text,text,text,text)',
    'public.escalate_stale_disputes()',
    'private.add_business_days(timestamp with time zone,integer)'
  ] loop
    if has_function_privilege('anon', fn, 'execute') or has_function_privilege('authenticated', fn, 'execute') then
      raise exception 'FAIL 13: % is client-callable', fn;
    end if;
  end loop;
  if has_table_privilege('authenticated', 'public.order_dispute_history', 'select')
     or has_table_privilege('authenticated', 'public.delivery_proofs', 'select')
     or has_table_privilege('anon', 'public.delivery_proofs', 'select') then
    raise exception 'FAIL 13: dispute history or delivery proof is client-readable';
  end if;
  raise notice 'PASS 13: the commands and records are server-only';

  raise notice 'all dispute recourse checks passed';
end $$;

rollback;
