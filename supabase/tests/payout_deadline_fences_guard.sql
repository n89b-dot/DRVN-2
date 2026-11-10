-- Payout deadline: fences, fair retries, complete refunds and safe
-- restoration (20261108110000, N244 follow-up to 20261108100000; the rule is
-- Neil's of 8 Nov 2026, docs/decisions/seller-payout-setup.md, unchanged).
-- Each part fails on 20261108100000 alone:
--   1. A claimed order can't be handed over whatever its dispute status: in
--      a not-received case mark_order_dispatched and pickup_redeem refuse it
--      (they used to move only pre_dispute_status, which the status-only
--      trigger never saw), no pass is minted, and a direct write of the
--      fulfilment fields is refused. An unclaimed case still dispatches.
--   2. Retries rotate: claims the worker was just handed go to the back, so
--      five stuck claims can't starve a sixth.
--   3. The full refund waits for another refund in flight (nothing
--      reserved), then reserves the whole remainder; a deadline refund that
--      completed short is topped up under the next key, not adopted again.
--   4. A sync that reports payouts enabled restores a pause left behind and
--      clears a leftover restriction, not only the false-to-true change.
--   5. Only a listing that meets the publish rules (a photo) goes back on
--      sale, at payouts enabled or at settlement; the rest stay paused.
-- Disposable database only; everything rolls back.
begin;

create function pg_temp.as_member(p_member uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_member, 'role', 'authenticated')::text, true);
end $$;

create function pg_temp.as_server() returns void language plpgsql as $$
begin
  perform set_config('role', 'supabase_admin', true);
  perform set_config('request.jwt.claims', '', true);
end $$;

-- A captured sale of one part: order, item, payment and the payout the
-- capture wrote, dated p_age ago.
create function pg_temp.sale(p_buyer uuid, p_seller uuid, p_listing uuid, p_age interval)
returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into public.orders(buyer_id, seller_id, status, subtotal_cents, platform_fee_cents, total_cents, currency)
  values (p_buyer, p_seller, 'paid', 10000, 1000, 10000, 'USD')
  returning id into v;
  insert into public.order_items(order_id, listing_id, title, price_cents, shipping_cents)
  values (v, p_listing, 'Sold part', 10000, 0);
  insert into public.payments(order_id, provider, provider_reference, status, amount_cents, currency)
  values (v, 'stripe', 'pi_' || replace(v::text, '-', ''), 'succeeded', 10000, 'USD');
  insert into public.transfer_intents(order_id, seller_id, amount_cents, currency, status, created_at)
  values (v, p_seller, 9000, 'USD', 'holding', now() - p_age);
  return v;
end $$;

create function pg_temp.sold_listing(p_seller uuid, p_title text) returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into public.listings(seller_id, title, category, price_cents, shipping_cents, status)
  values (p_seller, p_title, 'performance', 10000, 0, 'sold') returning id into v;
  return v;
end $$;

create function pg_temp.claim(p_order uuid) returns void language plpgsql as $$
begin
  insert into private.payout_deadline_cancellations(order_id, seller_id)
  select id, seller_id from public.orders where id = p_order;
end $$;

-- This guard's own helpers are called while acting as other roles. A new
-- function is closed by default (20261110170000), so they are opened here.
grant execute on all routines in schema pg_temp to public;

do $$
declare
  seller uuid := gen_random_uuid();
  rotator uuid := gen_random_uuid();
  refunder uuid := gen_random_uuid();
  synced uuid := gen_random_uuid();
  photos uuid := gen_random_uuid();
  buyer uuid := gen_random_uuid();
  origin text := 'https://proj.supabase.co/storage/v1/object/public/listing-images/';
  o uuid;
  o_coll uuid;
  o_free uuid;
  o_field uuid;
  rot uuid[] := '{}';
  l uuid;
  l_kept uuid;
  l_bare uuid;
  pass1 jsonb;
  pass2 jsonb;
  pass3 jsonb;
  r jsonb;
  op uuid;
  first_op uuid;
  pi_ref text;
  rejected boolean;
  i integer;
begin
  insert into public.job_config(key, value) values ('media_storage_origin', 'https://proj.supabase.co')
    on conflict (key) do update set value = excluded.value;
  -- No payments_mode row: the production default, the rule enforced.
  delete from public.job_config where key = 'payments_mode';

  insert into auth.users(id, email) values
    (seller, 'fence-seller@drvn.test'), (rotator, 'fence-rotator@drvn.test'),
    (refunder, 'fence-refunder@drvn.test'), (synced, 'fence-synced@drvn.test'),
    (photos, 'fence-photos@drvn.test'), (buyer, 'fence-buyer@drvn.test');
  -- Stripe's sync: details submitted, payouts not enabled yet.
  update public.profiles set stripe_account_id = 'acct_' || left(replace(id::text, '-', ''), 12), payout_details_submitted = true
  where id in (seller, rotator, refunder, synced, photos);

  -- ==========================================================
  -- 2. Retries rotate (first, while no other claim is open)
  -- ==========================================================
  for i in 1..6 loop
    l := pg_temp.sold_listing(rotator, 'Rotating part ' || i);
    rot := rot || pg_temp.sale(buyer, rotator, l, make_interval(days => 21 - i));
  end loop;
  pass1 := public.claim_payout_deadline_cancellations(5);
  if (pass1->>'claimed')::int <> 5 or jsonb_array_length(pass1->'orders') <> 5
     or exists (select 1 from private.payout_deadline_cancellations where order_id = rot[6]) then
    raise exception 'FAIL 2a: the first pass did not claim and hand out the five oldest: %', pass1;
  end if;
  -- Those five were claimed earlier and keep failing (a stuck provider).
  update private.payout_deadline_cancellations set claimed_at = now() - interval '1 hour'
  where order_id = any(rot[1:5]);
  pass2 := public.claim_payout_deadline_cancellations(5);
  if not exists (select 1 from jsonb_array_elements(pass2->'orders') e where (e->>'order_id')::uuid = rot[6]) then
    raise exception 'FAIL 2b: five stuck claims starved a later one: %', pass2;
  end if;
  if exists (select 1 from jsonb_array_elements(pass2->'orders') e where (e->>'order_id')::uuid = any(rot[1:5])) then
    raise exception 'FAIL 2b: a claim just handed out was handed out again before its backoff: %', pass2;
  end if;
  if exists (select 1 from private.payout_deadline_cancellations
             where order_id = any(rot[1:5]) and (attempts <> 1 or next_attempt_at <= now())) then
    raise exception 'FAIL 2c: a handed-out claim was not scheduled for later';
  end if;
  -- Due again: handed out once more, with a longer backoff.
  update private.payout_deadline_cancellations set next_attempt_at = now() where order_id = rot[1];
  pass3 := public.claim_payout_deadline_cancellations(5);
  if jsonb_array_length(pass3->'orders') <> 1 or (pass3->'orders'->0->>'order_id')::uuid <> rot[1]
     or (select (attempts, next_attempt_at) from private.payout_deadline_cancellations where order_id = rot[1])
        is distinct from (2, now() + interval '10 minutes') then
    raise exception 'FAIL 2d: a due claim was not handed out with a doubled backoff: %', pass3;
  end if;
  raise notice 'PASS 2: handed-out claims go to the back with a doubling backoff, so stuck ones can''t starve the rest';

  -- ==========================================================
  -- 1. The dispatch fence holds on the claim, in a case or not
  -- ==========================================================
  l := pg_temp.sold_listing(seller, 'Claimed, then a case');
  o := pg_temp.sale(buyer, seller, l, interval '15 days');
  perform pg_temp.claim(o);
  -- The buyer opens a not-received case on the undispatched order.
  update public.orders set status = 'disputed', pre_dispute_status = 'paid', disputed_at = now() where id = o;
  rejected := false;
  begin
    perform public.mark_order_dispatched(o, seller, 'UPS', '1ZN244FENCE');
  exception when sqlstate 'LS002' then rejected := true;
  end;
  if not rejected then raise exception 'FAIL 1a: a claimed order in a not-received case was dispatched'; end if;
  if (select (status, pre_dispute_status, shipped_at) from public.orders where id = o)
     is distinct from ('disputed'::text, 'paid'::text, null::timestamptz)
     or exists (select 1 from public.shipments where order_id = o) then
    raise exception 'FAIL 1a: the refused dispatch left a shipment or a dispatch mark';
  end if;
  -- Any path writing the fulfilment fields directly.
  rejected := false;
  begin
    update public.orders set pre_dispute_status = 'shipped', shipped_at = now() where id = o;
  exception when sqlstate 'LS002' then rejected := true;
  end;
  if not rejected then raise exception 'FAIL 1b: a claimed order in a case was marked shipped directly'; end if;
  l := pg_temp.sold_listing(seller, 'Claimed, field write');
  o_field := pg_temp.sale(buyer, seller, l, interval '15 days');
  perform pg_temp.claim(o_field);
  rejected := false;
  begin
    update public.orders set shipped_at = now() where id = o_field;
  exception when sqlstate 'LS002' then rejected := true;
  end;
  if not rejected then raise exception 'FAIL 1b: a claimed order got a shipped_at without a status change'; end if;

  -- A collection in a case: no pass for it, and the seller's handoff refused.
  insert into public.orders(buyer_id, seller_id, status, pre_dispute_status, is_collection, dispute_category, disputed_at,
    pickup_ready_at, subtotal_cents, platform_fee_cents, total_cents, currency)
  values (buyer, seller, 'disputed', 'paid', true, 'item_not_received', now(), now(), 10000, 1000, 10000, 'USD')
  returning id into o_coll;
  r := public.pickup_mint_pass(o_coll, buyer, 'n244-tok', 'n244-code', now() + interval '1 hour');
  if (r->>'ok')::boolean is not true then raise exception 'FAIL 1c: fixture pass not minted: %', r; end if;
  perform pg_temp.claim(o_coll);
  r := public.pickup_redeem(o_coll, seller, 'n244-tok');
  if r->>'reason' is distinct from 'payout_deadline'
     or (select redeemed_at from public.pickup_confirmations where order_id = o_coll) is not null
     or (select (pre_dispute_status, delivered_at) from public.orders where id = o_coll)
        is distinct from ('paid'::text, null::timestamptz) then
    raise exception 'FAIL 1c: a claimed collection in a case was handed over: %', r;
  end if;
  r := public.pickup_mint_pass(o_coll, buyer, 'n244-tok2', 'n244-code2', now() + interval '1 hour');
  if r->>'reason' is distinct from 'payout_deadline' then
    raise exception 'FAIL 1c: a pass was minted for a claimed order: %', r;
  end if;
  rejected := false;
  begin
    update public.orders set pre_dispute_status = 'delivered', delivered_at = now(), completed_at = now() where id = o_coll;
  exception when sqlstate 'LS002' then rejected := true;
  end;
  if not rejected then raise exception 'FAIL 1c: a claimed collection was marked delivered directly'; end if;

  -- Not overbroad: an unclaimed order in a case still dispatches.
  l := pg_temp.sold_listing(seller, 'Unclaimed, in a case');
  o_free := pg_temp.sale(buyer, seller, l, interval '2 days');
  update public.orders set status = 'disputed', pre_dispute_status = 'paid', disputed_at = now() where id = o_free;
  r := public.mark_order_dispatched(o_free, seller, 'UPS', '1ZN244FREE');
  if (r->>'ok')::boolean is not true
     or (select pre_dispute_status from public.orders where id = o_free) <> 'shipped' then
    raise exception 'FAIL 1d: an unclaimed order in a case could not be dispatched: %', r;
  end if;
  raise notice 'PASS 1: a claimed order can''t be dispatched, collected or marked shipped by any path, in a case or not';

  -- ==========================================================
  -- 3. The full refund waits, then reserves the whole remainder
  -- ==========================================================
  l := pg_temp.sold_listing(refunder, 'Partial in flight');
  o := pg_temp.sale(buyer, refunder, l, interval '15 days');
  pi_ref := (select provider_reference from public.payments where order_id = o);
  perform pg_temp.claim(o);
  -- A $20 refund already in flight on the $100 order.
  r := public.begin_refund_operation(o, 2000, 'Partial', 'admin:fixture', 'admin', false, null, pi_ref);
  op := (r->>'operation_id')::uuid;
  r := public.begin_payout_deadline_refund(o, 'Deadline', 'scheduler:payout_deadline', 'system', 'admin_refunded', pi_ref);
  if coalesce((r->>'waiting')::boolean, false) is not true or coalesce((r->>'ok')::boolean, true)
     or (select count(*) from public.refund_operations where order_id = o) <> 1 then
    raise exception 'FAIL 3a: the full refund reserved around a refund in flight: %', r;
  end if;
  -- The $20 fails: now the whole $100 is reserved, under the request key.
  update public.refund_operations set status = 'failed' where id = op;
  r := public.begin_payout_deadline_refund(o, 'Deadline', 'scheduler:payout_deadline', 'system', 'admin_refunded', pi_ref);
  first_op := (r->>'operation_id')::uuid;
  if (r->>'ok')::boolean is not true or coalesce((r->>'adopted')::boolean, false)
     or (select (amount_cents, request_key) from public.refund_operations where id = first_op)
        is distinct from (10000, 'payout_deadline:' || o) then
    raise exception 'FAIL 3b: the full refund was not the whole order: %', r;
  end if;
  -- A retry adopts it while it is in flight.
  r := public.begin_payout_deadline_refund(o, 'Deadline', 'scheduler:payout_deadline', 'system', 'admin_refunded', pi_ref);
  if (r->>'adopted')::boolean is not true or (r->>'operation_id')::uuid <> first_op then
    raise exception 'FAIL 3c: a retry started a second deadline refund: %', r;
  end if;

  -- Recovery: a deadline refund made the old way (the rest around a $20 in
  -- flight) completed at $80, then the $20 failed.
  l := pg_temp.sold_listing(refunder, 'Completed short');
  o := pg_temp.sale(buyer, refunder, l, interval '15 days');
  pi_ref := (select provider_reference from public.payments where order_id = o);
  perform pg_temp.claim(o);
  r := public.begin_refund_operation(o, 2000, 'Partial', 'admin:fixture', 'admin', false, null, pi_ref);
  op := (r->>'operation_id')::uuid;
  r := public.begin_request_refund_operation('payout_deadline:' || o, o, null, 'Deadline', 'scheduler:payout_deadline',
    'system', false, 'admin_refunded', pi_ref);
  first_op := (r->>'operation_id')::uuid;
  if (select amount_cents from public.refund_operations where id = first_op) <> 8000 then
    raise exception 'FAIL 3d: fixture: the old-style reservation was not $80';
  end if;
  update public.refund_operations set status = 'completed', effects_completed_at = now() where id = first_op;
  update public.orders set refunded_cents = 8000, refunded_at = now() where id = o;
  update public.payments set refunded_cents = 8000, status = 'partially_refunded' where order_id = o;
  update public.refund_operations set status = 'failed' where id = op;
  r := public.begin_payout_deadline_refund(o, 'Deadline', 'scheduler:payout_deadline', 'system', 'admin_refunded', pi_ref);
  if (r->>'ok')::boolean is not true or coalesce((r->>'adopted')::boolean, false)
     or (r->>'operation_id')::uuid = first_op
     or (select (amount_cents, request_key) from public.refund_operations where id = (r->>'operation_id')::uuid)
        is distinct from (2000, 'payout_deadline:' || o || ':1') then
    raise exception 'FAIL 3d: a deadline refund that completed short was adopted instead of topped up: %', r;
  end if;
  op := (r->>'operation_id')::uuid;
  r := public.begin_payout_deadline_refund(o, 'Deadline', 'scheduler:payout_deadline', 'system', 'admin_refunded', pi_ref);
  if (r->>'adopted')::boolean is not true or (r->>'operation_id')::uuid <> op then
    raise exception 'FAIL 3e: a retry of the top-up started another refund: %', r;
  end if;
  r := public.settle_payout_deadline_cancellation(o);
  if coalesce((r->>'complete')::boolean, false) then
    raise exception 'FAIL 3f: settled with $20 still unrefunded: %', r;
  end if;
  -- The refund engine completes the top-up (settle_refund_operation).
  update public.refund_operations set status = 'completed', effects_completed_at = now() where id = op;
  update public.orders set status = 'refunded', refunded_cents = 10000, cancelled_at = now() where id = o;
  r := public.settle_payout_deadline_cancellation(o);
  if not coalesce((r->>'complete')::boolean, false) then
    raise exception 'FAIL 3f: the topped-up order did not settle: %', r;
  end if;
  r := public.begin_payout_deadline_refund(o, 'Deadline', 'scheduler:payout_deadline', 'system', 'admin_refunded', pi_ref);
  if coalesce((r->>'ineligible')::boolean, false) is not true then
    raise exception 'FAIL 3g: a settled claim could still reserve a refund: %', r;
  end if;
  if has_function_privilege('authenticated', 'public.begin_payout_deadline_refund(uuid,text,text,text,text,text)', 'execute')
     or has_function_privilege('anon', 'public.begin_payout_deadline_refund(uuid,text,text,text,text,text)', 'execute') then
    raise exception 'FAIL 3h: the deadline refund is client-callable';
  end if;
  raise notice 'PASS 3: the full refund waits for refunds in flight, reserves the whole remainder, and tops up a short one';

  -- ==========================================================
  -- 4. Every payouts-enabled sync restores what the rule left paused
  -- ==========================================================
  update public.profiles set payouts_enabled = true where id = synced;
  -- What a settlement racing that enablement used to leave: a part paused
  -- and recorded, and the restriction, after the restore had already run.
  insert into public.listings(seller_id, title, category, price_cents, shipping_cents, status)
  values (synced, 'Left paused by a race', 'performance', 5000, 0, 'paused') returning id into l;
  insert into public.listing_images(listing_id, url, position) values (l, origin || synced || '/race.webp', 0);
  insert into private.payout_deadline_paused_listings(listing_id, seller_id) values (l, synced);
  update public.profiles set payout_restricted_at = now() where id = synced;
  -- Stripe's next account.updated: enabled, as before.
  update public.profiles set payouts_enabled = true where id = synced;
  if (select status from public.listings where id = l) <> 'active'
     or exists (select 1 from private.payout_deadline_paused_listings where seller_id = synced)
     or (select payout_restricted_at from public.profiles where id = synced) is not null then
    raise exception 'FAIL 4a: an enabled-to-enabled sync left the rule''s pause or restriction in place';
  end if;
  -- Settling for a payable seller puts the part straight back on sale.
  l := pg_temp.sold_listing(synced, 'Settled while payable');
  insert into public.listing_images(listing_id, url, position) values (l, origin || synced || '/settled.webp', 0);
  l_bare := pg_temp.sold_listing(synced, 'Settled, no photo');
  o := pg_temp.sale(buyer, synced, l, interval '15 days');
  insert into public.order_items(order_id, listing_id, title, price_cents, shipping_cents) values (o, l_bare, 'Second part', 0, 0);
  perform pg_temp.claim(o);
  update public.orders set status = 'refunded', refunded_cents = total_cents, refunded_at = now(), cancelled_at = now() where id = o;
  r := public.settle_payout_deadline_cancellation(o);
  if not coalesce((r->>'complete')::boolean, false)
     or (select status from public.listings where id = l) <> 'active' then
    raise exception 'FAIL 4b: settling for a payable seller did not put the part back on sale: %', r;
  end if;
  -- 5 (settlement). A part with no photo is not put on sale by DRVN.
  if (select status from public.listings where id = l_bare) <> 'paused'
     or exists (select 1 from private.payout_deadline_paused_listings where listing_id = l_bare) then
    raise exception 'FAIL 5a: settlement put a part with no photo back on sale';
  end if;
  raise notice 'PASS 4: any payouts-enabled sync restores the rule''s pauses and clears its restriction';

  -- ==========================================================
  -- 5. Restoration keeps the publish rules
  -- ==========================================================
  insert into public.listings(seller_id, title, category, price_cents, shipping_cents, status) values
    (photos, 'Kept its photo', 'performance', 5000, 0, 'active'),
    (photos, 'Photos removed while paused', 'performance', 5000, 0, 'active');
  select id into l_kept from public.listings where seller_id = photos and title = 'Kept its photo';
  select id into l_bare from public.listings where seller_id = photos and title = 'Photos removed while paused';
  insert into public.listing_images(listing_id, url, position) values
    (l_kept, origin || photos || '/kept.webp', 0), (l_bare, origin || photos || '/bare.webp', 0);
  -- The rule restricts the seller and takes both off sale.
  update public.profiles set payout_restricted_at = now() where id = photos;
  insert into private.payout_deadline_paused_listings(listing_id, seller_id) values (l_kept, photos), (l_bare, photos);
  update public.listings set status = 'paused' where id in (l_kept, l_bare);
  -- While it is paused, the seller deletes every photo of one.
  perform pg_temp.as_member(photos);
  delete from public.listing_images where listing_id = l_bare;
  set constraints all immediate;
  set constraints all deferred;
  perform pg_temp.as_server();
  if exists (select 1 from public.listing_images where listing_id = l_bare) then
    raise exception 'FAIL 5b: fixture: the seller could not remove the paused listing''s photos';
  end if;
  update public.profiles set payouts_enabled = true where id = photos;
  if (select status from public.listings where id = l_kept) <> 'active' then
    raise exception 'FAIL 5b: a complete listing the rule paused did not come back';
  end if;
  if (select status from public.listings where id = l_bare) <> 'paused' then
    raise exception 'FAIL 5b: payouts enabled put a listing with no photo back on sale';
  end if;
  if exists (select 1 from private.payout_deadline_paused_listings where seller_id = photos) then
    raise exception 'FAIL 5b: the rule still holds a pause after payouts were enabled';
  end if;
  raise notice 'PASS 5: only listings that meet the publish rules go back on sale; the rest stay paused';

  raise notice 'all payout deadline fences checks passed';
end $$;

rollback;
