-- Payout setup: started to sell, enabled to be paid, 14 days to finish
-- (20261108100000, N244; Neil's ruling 8 Nov 2026, "go with the eBay
-- approach, 14 days"; docs/decisions/seller-payout-setup.md).
--
--   1. A seller whose Stripe setup has started (details submitted, payouts
--      not yet enabled) can publish, and be bought from: purchase_begin keeps
--      the part, a reservation is allowed, a new payment request is prepared.
--      Setup not started is still refused (LS001). Clients can't write the
--      setup columns.
--   2. Day 14 with payouts still off: the seller is restricted, live
--      listings are paused and recorded, the undispatched order is claimed
--      once (never twice), a dispatched one and a young one are not; the
--      restricted seller can't publish or be reserved from; the claimed
--      order can't be dispatched (LS002).
--   3. Settling after the refund puts the part back paused; replays are
--      no-ops; payouts enabled clears the restriction and restores only the
--      listings the rule paused.
--   4. Stub payments: no gate, no sweep.
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

-- A captured sale: order, its item, payment and the payout the capture wrote,
-- dated p_age ago.
create function pg_temp.sale(p_buyer uuid, p_seller uuid, p_listing uuid, p_status text, p_age interval)
returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into public.orders(buyer_id, seller_id, status, subtotal_cents, platform_fee_cents, total_cents, currency, shipped_at)
  values (p_buyer, p_seller, p_status, 10000, 1000, 10000, 'USD',
          case when p_status = 'paid' then null else now() - interval '1 day' end)
  returning id into v;
  insert into public.order_items(order_id, listing_id, title, price_cents, shipping_cents)
  values (v, p_listing, 'Sold part', 10000, 0);
  insert into public.payments(order_id, provider, provider_reference, status, amount_cents, currency)
  values (v, 'stripe', 'pi_' || replace(v::text, '-', ''), 'succeeded', 10000, 'USD');
  insert into public.transfer_intents(order_id, seller_id, amount_cents, currency, status, created_at)
  values (v, p_seller, 9000, 'USD', 'holding', now() - p_age);
  return v;
end $$;

do $$
declare
  started uuid := gen_random_uuid();
  unstarted uuid := gen_random_uuid();
  buyer uuid := gen_random_uuid();
  late uuid := gen_random_uuid();
  img text := 'https://proj.supabase.co/storage/v1/object/public/listing-images/' || started || '/';
  late_img text := 'https://proj.supabase.co/storage/v1/object/public/listing-images/' || late || '/';
  live uuid := gen_random_uuid();
  bought uuid := gen_random_uuid();
  late_live uuid := gen_random_uuid();
  late_own_paused uuid := gen_random_uuid();
  late_draft uuid := gen_random_uuid();
  sold_waiting uuid := gen_random_uuid();
  sold_shipped uuid := gen_random_uuid();
  sold_young uuid := gen_random_uuid();
  o_waiting uuid;
  o_shipped uuid;
  o_young uuid;
  result jsonb;
  claim jsonb;
  rejected boolean;
begin
  insert into public.job_config(key, value) values ('media_storage_origin', 'https://proj.supabase.co')
    on conflict (key) do update set value = excluded.value;
  -- No payments_mode row: the production default, the rule enforced.
  delete from public.job_config where key = 'payments_mode';

  insert into auth.users(id, email) values
    (started, 'setup-started@drvn.test'),
    (unstarted, 'setup-unstarted@drvn.test'),
    (buyer, 'setup-buyer@drvn.test'),
    (late, 'setup-late@drvn.test');
  -- Stripe's sync: details submitted, payouts not enabled yet.
  update public.profiles set stripe_account_id = 'acct_started', payout_details_submitted = true where id = started;
  update public.profiles set stripe_account_id = 'acct_late', payout_details_submitted = true where id = late;
  update public.profiles set stripe_account_id = 'acct_unstarted' where id = unstarted;

  -- ==========================================================
  -- 1. Setup started is enough to sell
  -- ==========================================================
  perform pg_temp.as_member(started);
  insert into public.listings(id, seller_id, title, category, price_cents, shipping_cents, status)
  values (live, started, 'Started live', 'performance', 5000, 0, 'active');
  insert into public.listing_images(listing_id, url, position) values (live, img || 'one.webp', 0);
  insert into public.listings(id, seller_id, title, category, price_cents, shipping_cents, status)
  values (bought, started, 'Started bought', 'performance', 6000, 0, 'draft');
  insert into public.listing_images(listing_id, url, position) values (bought, img || 'two.webp', 0);
  update public.listings set status = 'active' where id = bought;
  set constraints all immediate;
  set constraints all deferred;
  if (select status from public.listings where id = live) <> 'active'
     or (select status from public.listings where id = bought) <> 'active' then
    raise exception 'FAIL 1a: a seller whose setup has started could not publish';
  end if;

  -- Setup not started: still refused.
  perform pg_temp.as_member(unstarted);
  rejected := false;
  begin
    insert into public.listings(seller_id, title, category, price_cents, status)
    values (unstarted, 'Unstarted live', 'performance', 5000, 'active');
  exception when sqlstate 'LS001' then rejected := true;
  end;
  if not rejected then raise exception 'FAIL 1b: a seller who never started setup published'; end if;

  -- The setup columns are Stripe's, not the member's.
  perform pg_temp.as_member(unstarted);
  rejected := false;
  begin
    update public.profiles set payout_details_submitted = true where id = unstarted;
  exception when insufficient_privilege then rejected := true;
  end;
  if not rejected then raise exception 'FAIL 1c: a member marked their own payout setup as started'; end if;
  rejected := false;
  begin
    update public.profiles set payout_restricted_at = null where id = unstarted;
  exception when insufficient_privilege then rejected := true;
  end;
  if not rejected then raise exception 'FAIL 1c: a member wrote their own payout restriction'; end if;

  -- Bought from before payouts are enabled.
  perform pg_temp.as_server();
  result := public.purchase_begin(buyer, array[bought], 'setup:' || gen_random_uuid(), interval '15 minutes', null, null, null);
  if jsonb_array_length(result->'orders') <> 1 or jsonb_array_length(result->'skipped') <> 0
     or (select status from public.listings where id = bought) <> 'reserved' then
    raise exception 'FAIL 1d: checkout skipped a seller whose setup has started: %', result;
  end if;
  result := public.prepare_payment_request('setup:' || (result->'orders'->0->>'order_id'),
    jsonb_build_object('orderIds', jsonb_build_array(result->'orders'->0->>'order_id'), 'buyerId', buyer, 'totalCents', 6000));
  if result->>'correlation_id' is null then
    raise exception 'FAIL 1e: no payment request for a seller whose setup has started';
  end if;
  raise notice 'PASS 1: setup started publishes and sells; not started is refused; members can''t write setup state';

  -- ==========================================================
  -- 2. Day 14, payouts still off
  -- ==========================================================
  insert into public.listings(id, seller_id, title, category, price_cents, shipping_cents, status) values
    (late_live, late, 'Late live', 'performance', 5000, 0, 'active'),
    (late_own_paused, late, 'Late own pause', 'performance', 5000, 0, 'paused'),
    (late_draft, late, 'Late draft', 'performance', 5000, 0, 'draft'),
    (sold_waiting, late, 'Late sold, waiting', 'performance', 10000, 0, 'sold'),
    (sold_shipped, late, 'Late sold, shipped', 'performance', 10000, 0, 'sold'),
    (sold_young, late, 'Late sold, young', 'performance', 10000, 0, 'sold');
  insert into public.listing_images(listing_id, url, position) values
    (late_live, late_img || 'a.webp', 0), (late_own_paused, late_img || 'b.webp', 0), (late_draft, late_img || 'c.webp', 0);
  o_waiting := pg_temp.sale(buyer, late, sold_waiting, 'paid', interval '15 days');
  o_shipped := pg_temp.sale(buyer, late, sold_shipped, 'shipped', interval '15 days');
  o_young := pg_temp.sale(buyer, late, sold_young, 'paid', interval '3 days');

  -- Stub payments: nothing happens.
  insert into public.job_config(key, value) values ('payments_mode', 'stub');
  claim := public.claim_payout_deadline_cancellations(10);
  if (claim->>'claimed')::int <> 0 or (select payout_restricted_at from public.profiles where id = late) is not null
     or (select status from public.listings where id = late_live) <> 'active' then
    raise exception 'FAIL 4a: the payout deadline ran with stub payments: %', claim;
  end if;
  delete from public.job_config where key = 'payments_mode';

  claim := public.claim_payout_deadline_cancellations(10);
  if (select payout_restricted_at from public.profiles where id = late) is null then
    raise exception 'FAIL 2a: a seller 14 days past a sale without payouts was not restricted';
  end if;
  if (select payout_restricted_at from public.profiles where id = started) is not null then
    raise exception 'FAIL 2a: a seller with no overdue sale was restricted';
  end if;
  if (select status from public.listings where id = late_live) <> 'paused'
     or not exists (select 1 from private.payout_deadline_paused_listings where listing_id = late_live) then
    raise exception 'FAIL 2b: the restricted seller''s live listing stayed on sale';
  end if;
  if exists (select 1 from private.payout_deadline_paused_listings where listing_id in (late_own_paused, late_draft)) then
    raise exception 'FAIL 2b: a listing the seller had paused, or a draft, was recorded as paused by the rule';
  end if;
  if not exists (select 1 from private.payout_deadline_cancellations where order_id = o_waiting)
     or exists (select 1 from private.payout_deadline_cancellations where order_id in (o_shipped, o_young)) then
    raise exception 'FAIL 2c: wrong orders claimed (only the undispatched day-14 order should be)';
  end if;
  if not exists (select 1 from jsonb_array_elements(claim->'orders') e
                 where (e->>'order_id')::uuid = o_waiting and e->>'status' = 'paid') then
    raise exception 'FAIL 2c: the claimed order was not handed to the worker: %', claim;
  end if;
  if (select status from public.orders where id = o_shipped) <> 'shipped'
     or (select status from public.transfer_intents where order_id = o_shipped) <> 'holding' then
    raise exception 'FAIL 2c: the dispatched order or its payout was touched';
  end if;
  -- Again: nothing new, the same open claim.
  claim := public.claim_payout_deadline_cancellations(10);
  if (claim->>'claimed')::int <> 0 or (claim->>'restricted')::int <> 0
     or (select count(*) from private.payout_deadline_cancellations where order_id = o_waiting) <> 1 then
    raise exception 'FAIL 2d: a second pass claimed again: %', claim;
  end if;

  -- Restricted: no publish, no new sale.
  perform pg_temp.as_member(late);
  rejected := false;
  begin
    update public.listings set status = 'active' where id = late_draft;
  exception when sqlstate 'LS001' then rejected := true;
  end;
  if not rejected then raise exception 'FAIL 2e: a restricted seller published'; end if;
  perform pg_temp.as_server();
  rejected := false;
  begin
    update public.listings set status = 'reserved', reserved_until = now() + interval '15 minutes' where id = late_live;
  exception when sqlstate 'LS001' then rejected := true;
  end;
  if not rejected then raise exception 'FAIL 2e: a restricted seller''s part was reserved'; end if;

  -- The claimed order can't be dispatched; the unclaimed young one can.
  rejected := false;
  begin
    update public.orders set status = 'shipped', shipped_at = now() where id = o_waiting;
  exception when sqlstate 'LS002' then rejected := true;
  end;
  if not rejected then raise exception 'FAIL 2f: an order claimed for refund was dispatched'; end if;
  update public.orders set status = 'shipped', shipped_at = now() where id = o_young;
  update public.orders set status = 'paid', shipped_at = null where id = o_young;
  raise notice 'PASS 2: day 14 restricts, pauses live listings, claims the undispatched order once, and fences its dispatch';

  -- ==========================================================
  -- 3. Settling, and payouts enabled
  -- ==========================================================
  result := public.settle_payout_deadline_cancellation(o_waiting);
  if coalesce((result->>'ok')::boolean, true) or (select status from public.listings where id = sold_waiting) <> 'sold' then
    raise exception 'FAIL 3a: settled before the refund was complete: %', result;
  end if;
  -- The refund engine's full refund (settle_refund_operation) leaves this.
  update public.orders set status = 'refunded', refunded_cents = total_cents, refunded_at = now(), cancelled_at = now()
  where id = o_waiting;
  result := public.settle_payout_deadline_cancellation(o_waiting);
  if not coalesce((result->>'complete')::boolean, false)
     or (select status from public.listings where id = sold_waiting) <> 'paused'
     or not exists (select 1 from private.payout_deadline_paused_listings where listing_id = sold_waiting) then
    raise exception 'FAIL 3b: the refunded part did not come back paused: %', result;
  end if;
  result := public.settle_payout_deadline_cancellation(o_waiting);
  if not coalesce((result->>'replayed')::boolean, false) then
    raise exception 'FAIL 3c: settling twice was not a replay: %', result;
  end if;
  claim := public.claim_payout_deadline_cancellations(10);
  if exists (select 1 from jsonb_array_elements(claim->'orders') e where (e->>'order_id')::uuid = o_waiting) then
    raise exception 'FAIL 3c: a settled order was handed to the worker again';
  end if;
  rejected := false;
  begin
    perform public.settle_payout_deadline_cancellation(o_young);
  exception when others then rejected := true;
  end;
  if not rejected then raise exception 'FAIL 3d: settled an order the deadline never claimed'; end if;

  -- Stripe enables payouts: the restriction ends, the rule's pauses come back.
  update public.profiles set payouts_enabled = true where id = late;
  if (select payout_restricted_at from public.profiles where id = late) is not null then
    raise exception 'FAIL 3e: the restriction outlived payouts being enabled';
  end if;
  if (select status from public.listings where id = late_live) <> 'active'
     or (select status from public.listings where id = sold_waiting) <> 'active' then
    raise exception 'FAIL 3e: the listings the rule paused did not come back';
  end if;
  if (select status from public.listings where id = late_own_paused) <> 'paused'
     or (select status from public.listings where id = late_draft) <> 'draft' then
    raise exception 'FAIL 3e: a listing the rule never paused was put on sale';
  end if;
  if exists (select 1 from private.payout_deadline_paused_listings where seller_id = late) then
    raise exception 'FAIL 3e: paused records were left behind';
  end if;
  -- And a payable seller is never restricted by an old sale.
  claim := public.claim_payout_deadline_cancellations(10);
  if (select payout_restricted_at from public.profiles where id = late) is not null then
    raise exception 'FAIL 3f: a payable seller was restricted';
  end if;
  raise notice 'PASS 3: settling puts the part back once; payouts enabled lifts the restriction and restores only its pauses';

  -- ==========================================================
  -- 4. The sweep is server-only
  -- ==========================================================
  if has_function_privilege('authenticated', 'public.claim_payout_deadline_cancellations(integer)', 'execute')
     or has_function_privilege('authenticated', 'public.settle_payout_deadline_cancellation(uuid)', 'execute')
     or has_table_privilege('authenticated', 'private.payout_deadline_cancellations', 'select') then
    raise exception 'FAIL 4b: the payout deadline sweep is reachable by a client';
  end if;
  if not exists (select 1 from private.scheduled_job_inventory()
                 where job = 'drvn-transfer-worker' and 'payoutDeadlines' = any(families)) then
    raise exception 'FAIL 4c: the payout deadline family is not on the money worker''s job';
  end if;
  raise notice 'PASS 4: stub payments have no gate or sweep; the sweep is server-only and on the money worker';

  raise notice 'all payout setup started checks passed';
end $$;

rollback;
