-- Fulfilment integrity (20261107200100): a pickup pass is minted under the
-- redemption lock and never erases a handoff (N93); a stranger's dispatch is
-- refused before anything is written or queued (N94); a $1,000+ order
-- dispatches with seller-entered tracking and no tracker, and the tracker
-- registration is queued, not required (N110).
begin;

do $$
declare
  seller uuid := gen_random_uuid();
  buyer uuid := gen_random_uuid();
  stranger uuid := gen_random_uuid();
  listing uuid;
  pickup uuid;
  big uuid;
  tracked uuid;
  result jsonb;
  stamp timestamptz;
  rejected boolean;
  def text;
begin
  insert into auth.users(id, email) values
    (seller, 'fulfil-seller@example.test'),
    (buyer, 'fulfil-buyer@example.test'),
    (stranger, 'fulfil-stranger@example.test');
  insert into public.listings(seller_id, title, category, price_cents, shipping_cents, currency, status)
  values (seller, 'Fulfilment fixture', 'engine', 5000, 0, 'USD', 'sold') returning id into listing;

  -- 1. Minting takes the order row lock first, like pickup_redeem, and
  --    never writes the redemption.
  def := pg_get_functiondef('public.pickup_mint_pass(uuid,uuid,text,text,timestamptz)'::regprocedure);
  if position('for update' in def) = 0
     or position('from public.orders' in def) = 0
     or position('from public.orders' in def) > position('from public.pickup_confirmations' in def) then
    raise exception 'FAIL 1: pickup_mint_pass does not lock the order before the pass';
  end if;
  if def ~* 'redeemed_at\s*=' or def ~* 'redeemed_by\s*=' then
    raise exception 'FAIL 1: pickup_mint_pass writes the redemption';
  end if;
  if has_function_privilege('authenticated', 'public.pickup_mint_pass(uuid,uuid,text,text,timestamptz)', 'execute')
     or has_function_privilege('anon', 'public.pickup_mint_pass(uuid,uuid,text,text,timestamptz)', 'execute') then
    raise exception 'FAIL 1: pickup_mint_pass is client-callable';
  end if;
  raise notice 'PASS 1: minting locks order then pass, never writes the redemption, server-only';

  -- 2. Only the buyer of a ready collection order gets a pass; minting again
  --    rotates it and resets the attempt count.
  insert into public.orders(buyer_id, seller_id, status, is_collection, subtotal_cents, platform_fee_cents, total_cents, currency)
  values (buyer, seller, 'paid', true, 5000, 500, 5000, 'USD') returning id into pickup;
  result := public.pickup_mint_pass(pickup, buyer, 'tok-1', 'code-1', now() + interval '1 hour');
  if result->>'reason' is distinct from 'not_ready' or exists (select 1 from public.pickup_confirmations where order_id = pickup) then
    raise exception 'FAIL 2: a pass was minted before the seller marked the order ready: %', result;
  end if;
  update public.orders set pickup_ready_at = now() where id = pickup;
  result := public.pickup_mint_pass(pickup, stranger, 'tok-x', 'code-x', now() + interval '1 hour');
  if result->>'reason' is distinct from 'not_your_order' or exists (select 1 from public.pickup_confirmations where order_id = pickup) then
    raise exception 'FAIL 2: a stranger minted a pass: %', result;
  end if;
  result := public.pickup_mint_pass(pickup, buyer, 'tok-1', 'code-1', now() + interval '1 hour');
  if (result->>'ok')::boolean is not true then raise exception 'FAIL 2: the buyer could not mint: %', result; end if;
  perform public.pickup_redeem(pickup, seller, 'wrong');
  result := public.pickup_mint_pass(pickup, buyer, 'tok-2', 'code-2', now() + interval '1 hour');
  if (result->>'ok')::boolean is not true
     or (select (token_hash, code_hash, attempts) from public.pickup_confirmations where order_id = pickup)
        is distinct from ('tok-2'::text, 'code-2'::text, 0) then
    raise exception 'FAIL 2: re-minting did not rotate the pass: %', result;
  end if;
  raise notice 'PASS 2: buyer-only, ready-only, and re-minting rotates the pass';

  -- 3. After the handoff, a mint is refused and the proof stays.
  result := public.pickup_redeem(pickup, seller, 'tok-2');
  if (result->>'ok')::boolean is not true then raise exception 'FAIL 3: redemption failed: %', result; end if;
  select redeemed_at into stamp from public.pickup_confirmations where order_id = pickup;
  result := public.pickup_mint_pass(pickup, buyer, 'tok-3', 'code-3', now() + interval '1 hour');
  if result->>'reason' is distinct from 'already_redeemed'
     or (select (redeemed_at, redeemed_by, token_hash) from public.pickup_confirmations where order_id = pickup)
        is distinct from (stamp, seller, 'tok-2'::text) then
    raise exception 'FAIL 3: a mint after the handoff touched the proof: %', result;
  end if;
  -- Even a mint that saw a stale 'paid' order (the race N93 describes) can't
  -- reset a redeemed pass.
  update public.orders set status = 'paid' where id = pickup;
  result := public.pickup_mint_pass(pickup, buyer, 'tok-4', 'code-4', now() + interval '1 hour');
  if result->>'reason' is distinct from 'already_redeemed'
     or (select (redeemed_at, redeemed_by, token_hash) from public.pickup_confirmations where order_id = pickup)
        is distinct from (stamp, seller, 'tok-2'::text) then
    raise exception 'FAIL 3: a mint erased a completed handoff: %', result;
  end if;
  raise notice 'PASS 3: a completed handoff can never be reset by a mint';

  -- 4. A stranger's dispatch is refused before anything is written or queued.
  insert into public.orders(buyer_id, seller_id, status, subtotal_cents, platform_fee_cents, total_cents, currency)
  values (buyer, seller, 'paid', 150000, 15000, 150000, 'USD') returning id into big;
  insert into public.order_items(order_id, listing_id, title, price_cents, shipping_cents)
  values (big, listing, 'Fulfilment fixture', 150000, 0);
  rejected := false;
  begin
    perform public.mark_order_dispatched(big, stranger, 'UPS', '1ZSTRANGER');
  exception when insufficient_privilege then rejected := true;
  end;
  if not rejected
     or (select status from public.orders where id = big) <> 'paid'
     or exists (select 1 from public.shipments where order_id = big)
     or exists (select 1 from public.remediation_jobs where kind = 'tracker_registration' and payload->>'order_id' = big::text) then
    raise exception 'FAIL 4: a stranger''s dispatch was not refused cleanly';
  end if;
  raise notice 'PASS 4: a stranger''s dispatch is refused with nothing written or queued';

  -- 5. A $1,500 order dispatches with seller-entered tracking and no tracker;
  --    the registration is queued once, after the seller check.
  if (select tracking_required_from_cents from public.settlement_settings where id) is not null then
    raise exception 'FAIL 5: the amount threshold is still set';
  end if;
  -- Even with the old column set by hand, nothing reads it.
  update public.settlement_settings set tracking_required_from_cents = 100000 where id;
  result := public.mark_order_dispatched(big, seller, 'UPS', '1ZBIG');
  if (result->>'ok')::boolean is not true or (result->>'applied')::boolean is not true
     or (select status from public.orders where id = big) <> 'shipped'
     or (select provider_tracker_id from public.shipments where id = (result->>'shipment_id')::uuid) is not null then
    raise exception 'FAIL 5: a $1,500 order without a tracker was refused: %', result;
  end if;
  if (select count(*) from public.remediation_jobs
       where kind = 'tracker_registration' and dedup_key = 'tracker:' || (result->>'shipment_id')
         and status = 'pending' and payload->>'order_id' = big::text
         and next_attempt_at > now()) <> 1 then
    raise exception 'FAIL 5: the tracker registration was not queued once';
  end if;
  perform public.mark_order_dispatched(big, seller, 'UPS', '1ZBIG');
  if (select count(*) from public.remediation_jobs where kind = 'tracker_registration' and payload->>'order_id' = big::text) <> 1 then
    raise exception 'FAIL 5: a dispatch replay queued a second registration';
  end if;
  update public.settlement_settings set tracking_required_from_cents = null where id;

  -- A dispatch that already carries a tracker queues nothing.
  insert into public.orders(buyer_id, seller_id, status, subtotal_cents, platform_fee_cents, total_cents, currency)
  values (buyer, seller, 'paid', 5000, 500, 5000, 'USD') returning id into tracked;
  insert into public.order_items(order_id, listing_id, title, price_cents, shipping_cents)
  values (tracked, listing, 'Fulfilment fixture', 5000, 0);
  result := public.mark_order_dispatched(tracked, seller, 'UPS', '1ZTRACKED', 'easypost', 'trk_known');
  if (result->>'ok')::boolean is not true
     or exists (select 1 from public.remediation_jobs where kind = 'tracker_registration' and payload->>'order_id' = tracked::text) then
    raise exception 'FAIL 5: a dispatch with a tracker queued a registration: %', result;
  end if;
  raise notice 'PASS 5: $1,000+ dispatch needs no tracker; registration is queued once, after the seller check';

  raise notice 'all fulfilment integrity checks passed';
end $$;

rollback;
