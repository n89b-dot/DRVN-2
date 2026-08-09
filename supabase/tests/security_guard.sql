-- ============================================================================
-- Security-regression guard (P0)
--
-- Regression-tests the DB-level guards that have no other coverage:
-- payout self-modification (0017, a confirmed live exploit), offer forgery
-- and immutability (0006 + 0012), the offer-accept/expiry defences (0007/0012),
-- review and message retargeting (0006), the client write-lockout on orders
-- and the money tables (0006, 0019), dispute_evidence RLS (0024), self-purchase
-- (0007) and listing status manipulation (0012).
--
-- Same contract as purchase_guard.sql / admin_guard.sql: run against a
-- NON-PRODUCTION database; everything happens inside a transaction that is
-- rolled back at the end; impersonation uses transaction-local
-- set_config('role', …) + request.jwt.claims — the real PostgREST mechanism,
-- not a SECURITY DEFINER shortcut; raises on failure, NOTICEs on success.
-- ============================================================================

begin;

-- plpgsql has no nested procedures, so the impersonation helpers live in
-- pg_temp; the rollback removes them with everything else.
create function pg_temp.impersonate(uid uuid) returns void
language sql as $$
  select set_config('role', 'authenticated', true);
  select set_config(
    'request.jwt.claims',
    json_build_object('sub', uid::text, 'role', 'authenticated')::text,
    true
  );
$$;

-- 'none' = SET ROLE NONE: back to the session user (supabase_admin in CI,
-- postgres against a live project) — both trusted writers, and the only
-- callers `offer_accept_begin` / `purchase_begin` / `purchase_finalize` grant
-- execute to (0007/0012 revoke them from public/anon/authenticated).
create function pg_temp.back_to_admin() returns void
language sql as $$
  select set_config('role', 'none', true);
  select set_config('request.jwt.claims', '', true);
$$;

do $$
declare
  v_seller   uuid := gen_random_uuid();
  v_buyer    uuid := gen_random_uuid();
  v_buyer2   uuid := gen_random_uuid();
  v_other    uuid := gen_random_uuid(); -- unrelated third party, no relationship to any fixture

  v_listing        uuid; -- active, has an offer floor, used for offer tests
  v_listing_status uuid; -- separate listing, reserved mid-test for the status-manipulation check

  v_order_delivered uuid; -- seller/buyer, status 'delivered' — the review/message fixture
  v_order_other      uuid; -- seller/other, unrelated to v_buyer — cross-user isolation fixture

  v_offer      uuid; -- a legitimate open offer, reused for the retarget check
  v_result     jsonb;
  v_status     text;
  v_count      int;
  v_expired_offer uuid;
  v_message    uuid;
  v_body       text;
begin
  -- ---------- fixtures ----------
  insert into auth.users (id, email) values
    (v_seller, 'sec-guard-seller@example.test'),
    (v_buyer,  'sec-guard-buyer@example.test'),
    (v_buyer2, 'sec-guard-buyer2@example.test'),
    (v_other,  'sec-guard-other@example.test');

  update public.profiles set display_name = 'Sec Guard Seller', username = 'sec_guard_seller' where id = v_seller;
  update public.profiles set display_name = 'Sec Guard Buyer',  username = 'sec_guard_buyer'  where id = v_buyer;
  update public.profiles set display_name = 'Sec Guard Buyer2', username = 'sec_guard_buyer2' where id = v_buyer2;
  update public.profiles set display_name = 'Sec Guard Other',  username = 'sec_guard_other'  where id = v_other;

  insert into public.listings
    (seller_id, title, category, price_cents, shipping_cents, status, currency, offer_floor_cents)
  values
    (v_seller, 'Sec guard turbo manifold', 'engine', 50000, 1500, 'active', 'USD', 20000)
  returning id into v_listing;

  insert into public.listings
    (seller_id, title, category, price_cents, shipping_cents, status, currency)
  values
    (v_seller, 'Sec guard status-check part', 'suspension', 30000, 1000, 'active', 'USD')
  returning id into v_listing_status;

  -- A settled order (buyer/seller) to hang review + message assertions off.
  insert into public.orders
    (buyer_id, seller_id, status, subtotal_cents, platform_fee_cents, shipping_cents, total_cents, currency, delivered_at)
  values
    (v_buyer, v_seller, 'delivered', 50000, 5000, 1500, 56500, 'USD', now())
  returning id into v_order_delivered;

  -- An unrelated order (seller/other) that v_buyer must never be able to see
  -- or write into.
  insert into public.orders
    (buyer_id, seller_id, status, subtotal_cents, platform_fee_cents, shipping_cents, total_cents, currency)
  values
    (v_other, v_seller, 'paid', 30000, 3000, 1000, 34000, 'USD')
  returning id into v_order_other;

  raise notice '--- fixtures ready ---';

  -- ================================================================
  -- 1. Payout-eligibility self-modification (0017) — confirmed live exploit
  -- ================================================================
  perform pg_temp.impersonate(v_buyer);

  begin
    update public.profiles set payouts_enabled = true where id = v_buyer;
    raise exception 'FAIL 1a: buyer self-enabled payouts_enabled';
  exception when insufficient_privilege then
    raise notice 'PASS 1a: payouts_enabled is not client-writable (0017 column grant)';
  end;

  begin
    update public.profiles set stripe_account_id = 'acct_attacker' where id = v_buyer;
    raise exception 'FAIL 1b: buyer self-set stripe_account_id';
  exception when insufficient_privilege then
    raise notice 'PASS 1b: stripe_account_id is not client-writable (0017 column grant)';
  end;

  -- ================================================================
  -- 2. Forged counteroffer (guard_offer_insert, 0012)
  -- ================================================================
  perform pg_temp.impersonate(v_buyer);

  begin
    insert into public.offers (listing_id, buyer_id, amount_cents, status, counter_amount_cents)
    values (v_listing, v_buyer, 30000, 'open', 1);
    raise exception 'FAIL 2a: buyer self-set counter_amount_cents on insert';
  exception when insufficient_privilege then
    raise notice 'PASS 2a: counter_amount_cents cannot be set at insert time';
  end;

  begin
    insert into public.offers (listing_id, buyer_id, amount_cents, status, responded_at)
    values (v_listing, v_buyer, 30000, 'open', now());
    raise exception 'FAIL 2b: buyer self-set responded_at on insert';
  exception when insufficient_privilege then
    raise notice 'PASS 2b: responded_at cannot be set at insert time';
  end;

  begin
    insert into public.offers (listing_id, buyer_id, amount_cents, status)
    values (v_listing, v_buyer, 30000, 'accepted');
    raise exception 'FAIL 2c: buyer inserted an offer already accepted';
  exception when insufficient_privilege then
    raise notice 'PASS 2c: a new offer must start as open';
  end;

  -- ================================================================
  -- 3. Self-offer (guard_offer_insert, 0012)
  -- ================================================================
  perform pg_temp.impersonate(v_seller);
  begin
    insert into public.offers (listing_id, buyer_id, amount_cents, status)
    values (v_listing, v_seller, 30000, 'open');
    raise exception 'FAIL 3: seller offered on their own listing';
  exception when insufficient_privilege then
    raise notice 'PASS 3: a seller cannot offer on their own listing';
  end;

  -- ================================================================
  -- 4. Offer above ask / below floor (guard_offer_insert, 0012)
  -- listing: price_cents 50000, offer_floor_cents 20000
  -- ================================================================
  perform pg_temp.impersonate(v_buyer);
  begin
    insert into public.offers (listing_id, buyer_id, amount_cents, status)
    values (v_listing, v_buyer, 50001, 'open');
    raise exception 'FAIL 4a: offer above the asking price was accepted';
  exception when insufficient_privilege then
    raise notice 'PASS 4a: an offer cannot exceed the asking price';
  end;

  begin
    insert into public.offers (listing_id, buyer_id, amount_cents, status)
    values (v_listing, v_buyer, 19999, 'open');
    raise exception 'FAIL 4b: offer below the seller floor was accepted';
  exception when insufficient_privilege then
    raise notice 'PASS 4b: an offer below the seller''s minimum is rejected';
  end;

  -- A legitimate offer, kept live for the retarget check (5) and the
  -- accept-as-wrong-seller check (6).
  insert into public.offers (listing_id, buyer_id, amount_cents, status)
  values (v_listing, v_buyer, 30000, 'open')
  returning id into v_offer;
  raise notice 'PASS 4c: an in-bounds offer is accepted';

  -- ================================================================
  -- 5. Offer retarget — buyer rewrites their own offer's listing/amount
  -- (offers_guard_columns trigger, 0006/0012)
  -- ================================================================
  perform pg_temp.impersonate(v_buyer);
  begin
    update public.offers set listing_id = v_listing_status where id = v_offer;
    raise exception 'FAIL 5a: buyer retargeted their offer to another listing';
  exception when insufficient_privilege then
    raise notice 'PASS 5a: offer listing_id is immutable';
  end;

  begin
    update public.offers set amount_cents = 1 where id = v_offer;
    raise exception 'FAIL 5b: buyer rewrote their offer amount';
  exception when insufficient_privilege then
    raise notice 'PASS 5b: offer amount_cents is immutable';
  end;

  -- ================================================================
  -- 6. offer_accept_begin as the wrong seller — no reservation, no order
  -- ================================================================
  -- Only a trusted writer may call this (revoked from public/anon/authenticated
  -- in 0007/0012), so this exercises the function's own defence, not RLS.
  perform pg_temp.back_to_admin();

  v_result := public.offer_accept_begin(v_offer, v_other, interval '24 hours');
  if v_result is not null then
    raise exception 'FAIL 6a: offer_accept_begin returned an order for the wrong seller: %', v_result;
  end if;

  select status into v_status from public.listings where id = v_listing;
  if v_status <> 'active' then
    raise exception 'FAIL 6b: listing was reserved by an accept call from the wrong seller, got %', v_status;
  end if;

  select count(*) into v_count from public.orders where seller_id = v_other and buyer_id = v_buyer;
  if v_count <> 0 then
    raise exception 'FAIL 6c: an order was created for the wrong seller';
  end if;
  raise notice 'PASS 6: offer_accept_begin refuses a non-owning seller — no reservation, no order';

  -- ================================================================
  -- 7. Expired offer — offer_accept_begin refuses and marks it expired
  -- ================================================================
  -- guard_offer_insert always overrides expires_at for client inserts, so an
  -- already-expired offer can only be seeded by a trusted writer (still
  -- already impersonating admin from step 6).
  insert into public.offers (listing_id, buyer_id, amount_cents, status, expires_at)
  values (v_listing, v_buyer2, 25000, 'open', now() - interval '1 hour')
  returning id into v_expired_offer;

  v_result := public.offer_accept_begin(v_expired_offer, v_seller, interval '24 hours');
  if v_result is not null then
    raise exception 'FAIL 7a: offer_accept_begin accepted an expired offer: %', v_result;
  end if;

  select status into v_status from public.offers where id = v_expired_offer;
  if v_status <> 'expired' then
    raise exception 'FAIL 7b: expired offer was not marked expired, got %', v_status;
  end if;
  raise notice 'PASS 7: an expired offer is refused and marked expired, not accepted';

  -- ================================================================
  -- 8. Review retargeting (guard_review_columns / reviews insert policy, 0006)
  -- ================================================================
  perform pg_temp.impersonate(v_buyer);

  -- Reviewee must be the counterparty of an order the reviewer is actually on.
  begin
    insert into public.reviews (order_id, reviewer_id, reviewee_id, rating, body)
    values (v_order_delivered, v_buyer, v_other, 1, 'forged review of an uninvolved user');
    raise exception 'FAIL 8a: review inserted against a non-counterparty reviewee';
  exception when insufficient_privilege then
    raise notice 'PASS 8a: reviewee must be the order counterparty';
  end;

  -- Reviewer must actually be a party to the named order.
  perform pg_temp.impersonate(v_other);
  begin
    insert into public.reviews (order_id, reviewer_id, reviewee_id, rating, body)
    values (v_order_delivered, v_other, v_seller, 1, 'forged review, not on this order');
    raise exception 'FAIL 8b: review inserted by a non-party to the order';
  exception when insufficient_privilege then
    raise notice 'PASS 8b: reviewer must be a party to the named order';
  end;

  -- A genuine review, then a duplicate on the same order — the schema's
  -- unique (order_id, reviewer_id) constraint (0001) backstops this.
  perform pg_temp.impersonate(v_buyer);
  insert into public.reviews (order_id, reviewer_id, reviewee_id, rating, body)
  values (v_order_delivered, v_buyer, v_seller, 5, 'legit review');
  raise notice 'PASS 8c: a genuine review from the actual buyer is accepted';

  begin
    insert into public.reviews (order_id, reviewer_id, reviewee_id, rating, body)
    values (v_order_delivered, v_buyer, v_seller, 1, 'duplicate review, same order');
    raise exception 'FAIL 8d: a second review on the same order by the same reviewer was accepted';
  exception when unique_violation then
    raise notice 'PASS 8d: duplicate review on the same order is rejected (unique order_id, reviewer_id)';
  end;

  -- ================================================================
  -- 9. Message-thread injection + cross-user read isolation (0006)
  -- ================================================================
  perform pg_temp.impersonate(v_other);
  begin
    insert into public.messages (order_id, listing_id, sender_id, recipient_id, body)
    values (v_order_delivered, v_listing, v_other, v_buyer, 'hi, pay me here instead');
    raise exception 'FAIL 9a: a non-party injected a message into another order''s thread';
  exception when insufficient_privilege then
    raise notice 'PASS 9a: message insert requires the sender to be party to the order';
  end;

  -- A legitimate message on the order the buyer/seller actually share.
  perform pg_temp.impersonate(v_seller);
  insert into public.messages (order_id, listing_id, sender_id, recipient_id, body)
  values (v_order_delivered, v_listing, v_seller, v_buyer, 'shipped it today')
  returning id into v_message;

  -- v_other is not a party to v_order_delivered — must see zero rows on it.
  perform pg_temp.impersonate(v_other);
  select count(*) into v_count from public.messages where order_id = v_order_delivered;
  if v_count <> 0 then
    raise exception 'FAIL 9b: a non-party read % rows from another user''s order thread', v_count;
  end if;
  raise notice 'PASS 9b: a non-party sees zero rows on another user''s order thread';

  -- Same isolation one level up: v_buyer is not a party to v_order_other
  -- (buyer there is v_other) — the order itself must not be readable either.
  perform pg_temp.impersonate(v_buyer);
  select count(*) into v_count from public.orders where id = v_order_other;
  if v_count <> 0 then
    raise exception 'FAIL 9c: a non-party read another user''s order row (id %)', v_order_other;
  end if;
  raise notice 'PASS 9c: a non-party sees zero rows for an order they are not on';

  -- ================================================================
  -- 10. Message read_at — recipient may set it; nobody may rewrite history
  -- (0006 ~:294-322: "recipients update own messages" is USING/WITH CHECK on
  -- recipient_id, so the sender has no UPDATE row-visibility on their own
  -- sent message at all — an update from the sender simply touches zero rows,
  -- it does not raise. The trigger's job is the harder case: blocking the
  -- recipient, who *does* have UPDATE access, from smuggling a body/
  -- recipient_id change in alongside read_at.)
  -- ================================================================
  perform pg_temp.impersonate(v_buyer);
  update public.messages set read_at = now() where id = v_message;

  select count(*) into v_count from public.messages
  where id = v_message and recipient_id = v_buyer and read_at is not null;
  if v_count <> 1 then
    raise exception 'FAIL 10a: recipient could not set read_at on their own message';
  end if;
  raise notice 'PASS 10a: recipient can mark a message read';

  -- The sender has no row-level UPDATE access to a message they don't
  -- receive: the USING clause matches nothing, so this silently updates zero
  -- rows rather than raising. Assert it as a no-op, not an exception.
  perform pg_temp.impersonate(v_seller);
  update public.messages set body = 'edited after the fact' where id = v_message;

  select body into v_body from public.messages where id = v_message;
  if v_body <> 'shipped it today' then
    raise exception 'FAIL 10b: sender rewrote the message body despite owning no UPDATE row, got %', v_body;
  end if;
  raise notice 'PASS 10b: sender has no UPDATE access to a message they sent (RLS USING filters it out)';

  -- The recipient DOES have UPDATE access — the trigger must still block a
  -- body change riding along with the read_at update.
  perform pg_temp.impersonate(v_buyer);
  begin
    update public.messages set body = 'rewritten by recipient', read_at = now() where id = v_message;
    raise exception 'FAIL 10c: recipient rewrote a message body via their own UPDATE access';
  exception when insufficient_privilege then
    raise notice 'PASS 10c: message body is immutable even for the recipient''s own UPDATE';
  end;

  -- Same for re-addressing: WITH CHECK pins recipient_id = auth.uid(), and the
  -- trigger backstops it regardless.
  begin
    update public.messages set recipient_id = v_other where id = v_message;
    raise exception 'FAIL 10d: recipient re-addressed the message to another user';
  exception when insufficient_privilege then
    raise notice 'PASS 10d: message recipient_id is immutable';
  end;

  -- ================================================================
  -- 11. Orders — no client writes at all (0006 drops the insert policy;
  -- no update/delete policy has ever existed)
  -- ================================================================
  -- INSERT has to satisfy a WITH CHECK on the new row; with zero INSERT
  -- policies the implicit check is "false" for every row, so this raises.
  perform pg_temp.impersonate(v_buyer);
  begin
    insert into public.orders (buyer_id, seller_id, status, subtotal_cents, total_cents, currency)
    values (v_buyer, v_other, 'paid', 1, 1, 'USD');
    raise exception 'FAIL 11a: authenticated client inserted an order directly';
  exception when insufficient_privilege then
    raise notice 'PASS 11a: orders reject a direct client INSERT';
  end;

  -- UPDATE/DELETE are different: with zero policies for that command, no row
  -- is a *candidate* for the operation (there is no USING clause to pass), so
  -- the statement matches zero rows and returns successfully — it does not
  -- raise. Assert the no-op by checking nothing changed, not by catching an
  -- exception (a naive "expect insufficient_privilege" here would silently
  -- pass even if a stray policy someday made 0-row updates the norm).
  update public.orders set status = 'refunded' where id = v_order_delivered;
  select status into v_status from public.orders where id = v_order_delivered;
  if v_status <> 'delivered' then
    raise exception 'FAIL 11b: authenticated client updated an order directly, status is now %', v_status;
  end if;
  raise notice 'PASS 11b: orders reject a direct client UPDATE (zero rows are ever a candidate)';

  delete from public.orders where id = v_order_delivered;
  -- Still impersonating v_buyer, a genuine participant of v_order_delivered,
  -- so the existing "participants read orders" SELECT policy covers this read.
  select count(*) into v_count from public.orders where id = v_order_delivered;
  if v_count <> 1 then
    raise exception 'FAIL 11c: authenticated client deleted an order directly';
  end if;
  raise notice 'PASS 11c: orders reject a direct client DELETE (zero rows are ever a candidate)';

  -- ================================================================
  -- 12. Money tables — client roles are read-only at the grant level (0019)
  -- ================================================================
  begin
    insert into public.webhook_events (id, type) values ('evt_forged', 'payment_intent.succeeded');
    raise exception 'FAIL 12a: authenticated client inserted a webhook_events row';
  exception when insufficient_privilege then
    raise notice 'PASS 12a: webhook_events is not client-writable';
  end;

  begin
    insert into public.transfer_intents (order_id, seller_id, amount_cents, currency)
    values (v_order_delivered, v_buyer, 1000000, 'USD');
    raise exception 'FAIL 12b: authenticated client inserted a transfer_intents row';
  exception when insufficient_privilege then
    raise notice 'PASS 12b: transfer_intents is not client-writable';
  end;

  begin
    update public.transfer_intents set status = 'transferred' where order_id = v_order_delivered;
    raise exception 'FAIL 12c: authenticated client updated a transfer_intents row';
  exception when insufficient_privilege then
    raise notice 'PASS 12c: transfer_intents rejects client UPDATE';
  end;

  begin
    insert into public.payment_recoveries (order_id, kind, amount_cents)
    values (v_order_delivered, 'negative_balance', 1000000);
    raise exception 'FAIL 12d: authenticated client inserted a payment_recoveries row';
  exception when insufficient_privilege then
    raise notice 'PASS 12d: payment_recoveries is not client-writable';
  end;

  -- ================================================================
  -- 13. dispute_evidence — participants read own order; third party gets
  -- zero rows; no client insert path (0024, service-role only)
  -- ================================================================
  perform pg_temp.back_to_admin();
  insert into public.dispute_evidence (order_id, uploader_id, url, note)
  values (v_order_delivered, v_buyer, 'https://example.test/evidence.jpg', 'guard fixture');

  perform pg_temp.impersonate(v_buyer);
  select count(*) into v_count from public.dispute_evidence where order_id = v_order_delivered;
  if v_count <> 1 then
    raise exception 'FAIL 13a: order participant could not read dispute_evidence, got % rows', v_count;
  end if;
  raise notice 'PASS 13a: an order participant reads their own dispute evidence';

  perform pg_temp.impersonate(v_other);
  select count(*) into v_count from public.dispute_evidence where order_id = v_order_delivered;
  if v_count <> 0 then
    raise exception 'FAIL 13b: a non-participant read % dispute_evidence rows', v_count;
  end if;
  raise notice 'PASS 13b: a non-participant sees zero dispute_evidence rows';

  perform pg_temp.impersonate(v_buyer);
  begin
    insert into public.dispute_evidence (order_id, uploader_id, url)
    values (v_order_delivered, v_buyer, 'https://example.test/client-insert.jpg');
    raise exception 'FAIL 13c: a client inserted dispute_evidence directly';
  exception when insufficient_privilege then
    raise notice 'PASS 13c: dispute_evidence has no client-facing INSERT policy';
  end;

  -- ================================================================
  -- 14. Self-purchase — buyer_id = seller_id on their own listing
  -- ================================================================
  -- purchase_begin is also revoked from client roles (0007/0012); run as the
  -- trusted writer and confirm the seller cannot claim their own listing.
  perform pg_temp.back_to_admin();
  v_result := public.purchase_begin(v_seller, array[v_listing_status], 'sec-guard-self-purchase');

  if jsonb_array_length(v_result -> 'orders') <> 0 then
    raise exception 'FAIL 14a: a seller bought their own listing: %', v_result;
  end if;
  if jsonb_array_length(v_result -> 'skipped') <> 1 then
    raise exception 'FAIL 14b: self-purchase attempt did not report the listing as skipped: %', v_result;
  end if;

  select status into v_status from public.listings where id = v_listing_status;
  if v_status <> 'active' then
    raise exception 'FAIL 14c: self-purchase attempt changed listing status, got %', v_status;
  end if;
  raise notice 'PASS 14: a seller cannot purchase their own listing';

  -- ================================================================
  -- 15. Listing status manipulation (guard_listing_status, 0012)
  -- ================================================================
  -- Put v_listing_status into 'reserved' the only legitimate way: a real
  -- checkout claim (still impersonating the trusted writer).
  v_result := public.purchase_begin(v_buyer2, array[v_listing_status], 'sec-guard-status-claim');
  if jsonb_array_length(v_result -> 'orders') <> 1 then
    raise exception 'FAIL 15 setup: could not reserve the listing for the status check: %', v_result;
  end if;

  select status into v_status from public.listings where id = v_listing_status;
  if v_status <> 'reserved' then
    raise exception 'FAIL 15 setup: listing not reserved ahead of the status check, got %', v_status;
  end if;

  -- The seller now tries to PATCH it straight back to active mid-checkout.
  perform pg_temp.impersonate(v_seller);
  begin
    update public.listings set status = 'active' where id = v_listing_status;
    raise exception 'FAIL 15a: seller flipped a reserved listing back to active directly';
  exception when insufficient_privilege then
    raise notice 'PASS 15a: seller cannot clear a reservation by direct PATCH';
  end;

  -- Also cannot self-declare 'sold' on an otherwise-active listing.
  begin
    update public.listings set status = 'sold' where id = v_listing;
    raise exception 'FAIL 15b: seller marked an active listing sold directly';
  exception when insufficient_privilege then
    raise notice 'PASS 15b: seller cannot set status=sold directly — that is checkout''s job';
  end;

  perform pg_temp.back_to_admin();
  raise notice '--- all security-guard checks passed ---';
end $$;

-- Nothing is kept.
rollback;
