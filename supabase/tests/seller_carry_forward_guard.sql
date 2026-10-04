-- Seller charges a payout couldn't cover are recorded once, kept back from
-- the seller's next transfer, never collected twice, and a reversal never
-- asks for more than the transfer sent (20261005110100). Rolls back.
begin;

do $$
declare
  seller uuid := gen_random_uuid();
  other_seller uuid := gen_random_uuid();
  buyer uuid := gen_random_uuid();
  refunded_order uuid; payer uuid; second uuid; small uuid; inflight uuid; partial uuid;
  late_label uuid;
  r jsonb; v int; v_text text; rejected boolean;
begin
  insert into auth.users(id, email) values
    (seller, 'carry-seller@example.test'), (other_seller, 'carry-other@example.test'),
    (buyer, 'carry-buyer@example.test');

  -- 1. A fully refunded order's label cost is recorded as owed when its
  --    payout is cancelled.
  insert into public.orders(buyer_id, seller_id, status, subtotal_cents, platform_fee_cents, total_cents, currency)
  values (buyer, seller, 'delivered', 10000, 1000, 10000, 'USD') returning id into refunded_order;
  insert into public.payments(order_id, provider, status, amount_cents, currency)
  values (refunded_order, 'stub', 'succeeded', 10000, 'USD');
  insert into public.transfer_intents(order_id, seller_id, amount_cents, currency, status)
  values (refunded_order, seller, 9000, 'USD', 'holding');
  insert into public.seller_adjustments(seller_id, order_id, kind, amount_cents, currency, external_reference)
  values (seller, refunded_order, 'outbound_label', -800, 'USD', 'carry-guard:label-1');
  -- While the payout is open, nothing is carried: the transfer nets it.
  if exists (select 1 from public.seller_carry_entries where seller_id = seller) then
    raise exception 'A label on an open payout was carried forward';
  end if;
  r := public.begin_refund_operation(
    p_order_id => refunded_order, p_amount_cents => 10000, p_reason => 'carry guard full refund',
    p_requested_by => 'stripe:webhook', p_actor_role => 'system', p_resolve_dispute => false,
    p_dispute_outcome => null, p_payment_reference => null, p_external => true);
  perform public.settle_refund_operation((r->>'operation_id')::uuid);
  if (select status from public.transfer_intents where order_id = refunded_order) <> 'cancelled' then
    raise exception 'Fixture: the full refund did not cancel the payout';
  end if;
  if (select array_agg(kind || ':' || amount_cents) from public.seller_carry_entries where seller_id = seller)
     <> array['uncollected:-800'] then
    raise exception 'A fully refunded order''s label was not recorded as owed: %',
      (select array_agg(kind || ':' || amount_cents) from public.seller_carry_entries where seller_id = seller);
  end if;
  -- Settling again records nothing new.
  perform public.settle_refund_operation((r->>'operation_id')::uuid);
  update public.transfer_intents set updated_at = now() where order_id = refunded_order;
  if (select count(*) from public.seller_carry_entries where seller_id = seller) <> 1 then
    raise exception 'The shortfall was recorded twice';
  end if;

  -- 2. A charge recorded after the payout closed is carried; voiding it
  --    takes it back off.
  insert into public.seller_adjustments(seller_id, order_id, kind, amount_cents, currency, external_reference)
  values (seller, refunded_order, 'return_label', -300, 'USD', 'carry-guard:return-1') returning id into late_label;
  update public.seller_adjustments set voided_at = now() where id = late_label;
  if (select sum(amount_cents) from public.seller_carry_entries where seller_id = seller) <> -800
     or (select count(*) from public.seller_carry_entries where seller_id = seller) <> 3 then
    raise exception 'A late label and its void did not net to nothing';
  end if;

  -- 3. The next transfer keeps the balance back, once.
  insert into public.orders(buyer_id, seller_id, status, subtotal_cents, platform_fee_cents, total_cents, currency)
  values (buyer, seller, 'delivered', 10000, 1000, 10000, 'USD') returning id into payer;
  insert into public.transfer_intents(order_id, seller_id, amount_cents, currency, status)
  values (payer, seller, 9000, 'USD', 'ready');
  insert into public.orders(buyer_id, seller_id, status, subtotal_cents, platform_fee_cents, total_cents, currency)
  values (buyer, seller, 'delivered', 10000, 1000, 10000, 'USD') returning id into second;
  insert into public.transfer_intents(order_id, seller_id, amount_cents, currency, status)
  values (second, seller, 9000, 'USD', 'ready');
  perform public.claim_transfer_intents('carry-worker', 10, 300, 8);

  if public.freeze_transfer_carry(payer, 'someone-else', 9000) is not null then
    raise exception 'A worker without the lease froze a collection';
  end if;
  v := public.freeze_transfer_carry(payer, 'carry-worker', 9000);
  if v <> 800 then raise exception 'The next transfer did not keep back the 800 owed: %', v; end if;
  -- A concurrent transfer for the same seller sees the reservation.
  v := public.freeze_transfer_carry(second, 'carry-worker', 9000);
  if v <> 0 then raise exception 'The same debt was reserved by two transfers: %', v; end if;
  -- Re-deciding before any provider call gives the same answer.
  if public.freeze_transfer_carry(payer, 'carry-worker', 9000) <> 800 then
    raise exception 'Re-deciding a collection changed it';
  end if;

  if not public.prepare_transfer_dispatch(payer, 'carry-worker', 'transfer:' || payer::text, 8200, 'usd',
       'acct_carry', 'ch_carry', 'pi_carry') then
    raise exception 'Fixture: the carry-reduced dispatch was refused';
  end if;
  -- Frozen once the provider may have been called, whatever the balance does.
  insert into public.seller_adjustments(seller_id, order_id, kind, amount_cents, currency, external_reference)
  values (seller, refunded_order, 'insurance', -100, 'USD', 'carry-guard:late-2');
  if public.freeze_transfer_carry(payer, 'carry-worker', 9000) <> 800 then
    raise exception 'A collection changed after its dispatch was frozen';
  end if;

  v_text := public.complete_transfer_intent(payer, 'carry-worker', 'transfer:' || payer::text, 'tr_carry_payer');
  if v_text <> 'completed' then raise exception 'Fixture: completion returned %', v_text; end if;
  if exists (select 1 from public.payment_recoveries where order_id = payer) then
    raise exception 'A carry-reduced transfer was flagged as a payable mismatch';
  end if;
  if (select amount_cents from public.seller_carry_entries where entry_key = 'collected:' || payer::text) <> 800 then
    raise exception 'The collection was not recorded with the transfer';
  end if;
  -- 800 collected; the insurance charge recorded after the freeze is still owed.
  if public.seller_carry_available_cents(seller, null) <> 100 then
    raise exception 'Outstanding balance after collection is %, expected 100',
      public.seller_carry_available_cents(seller, null);
  end if;
  update public.transfer_intents set status = 'transferred' where order_id = payer;
  if (select count(*) from public.seller_carry_entries where kind = 'collected') <> 1 then
    raise exception 'A collection was recorded twice';
  end if;

  -- 4. A collection always leaves the transfer at least 1 cent.
  v := public.freeze_transfer_carry(second, 'carry-worker', 60);
  if v <> 59 then raise exception 'A 60c payout kept back %, expected 59 (100 owed)', v; end if;
  v := public.freeze_transfer_carry(second, 'carry-worker', 1);
  if v <> 0 then raise exception 'A 1c payout kept something back: %', v; end if;
  update public.transfer_intents set status = 'holding', locked_by = null, lease_expires_at = null
   where order_id = second;

  -- 5. A full refund after a carry-reduced transfer reverses only what was
  --    sent; what it had collected is owed again.
  insert into public.payments(order_id, provider, status, amount_cents, currency, provider_reference)
  values (payer, 'stub', 'succeeded', 10000, 'USD', 'pi_carry');
  r := public.begin_refund_operation(
    p_order_id => payer, p_amount_cents => 10000, p_reason => 'carry guard refund after transfer',
    p_requested_by => 'stripe:webhook', p_actor_role => 'system', p_resolve_dispute => false,
    p_dispute_outcome => null, p_payment_reference => null, p_external => true);
  r := public.settle_refund_operation((r->>'operation_id')::uuid);
  if (r->>'reversal_due_cents')::int <> 8200 then
    raise exception 'A reversal asked for more than the transfer sent: %', r;
  end if;
  if (select amount_cents from public.seller_carry_entries where seller_id = seller and kind = 'reversal_shortfall') <> -800 then
    raise exception 'The unreversed collection was not owed again';
  end if;
  if public.seller_carry_available_cents(seller, null) <> 900 then
    raise exception 'Outstanding balance after the capped reversal is %, expected 900',
      public.seller_carry_available_cents(seller, null);
  end if;

  -- 6. A partial refund within what was sent reverses the plain share.
  insert into public.orders(buyer_id, seller_id, status, subtotal_cents, platform_fee_cents, total_cents, currency, transfer_reference)
  values (buyer, other_seller, 'delivered', 10000, 1000, 10000, 'USD', 'tr_partial') returning id into partial;
  insert into public.payments(order_id, provider, status, amount_cents, currency, provider_reference)
  values (partial, 'stub', 'succeeded', 10000, 'USD', 'pi_partial');
  insert into public.transfer_intents(order_id, seller_id, amount_cents, currency, status, transfer_reference,
    operation_key, dispatch_amount_cents, dispatch_currency, dispatch_destination, dispatch_source_transaction,
    dispatch_transfer_group)
  values (partial, other_seller, 9000, 'USD', 'transferred', 'tr_partial', 'transfer:' || partial::text, 8700,
    'usd', 'acct_partial', 'ch_partial', 'pi_partial');
  r := public.begin_refund_operation(
    p_order_id => partial, p_amount_cents => 5000, p_reason => 'carry guard partial',
    p_requested_by => 'stripe:webhook', p_actor_role => 'system', p_resolve_dispute => false,
    p_dispute_outcome => null, p_payment_reference => null, p_external => true);
  r := public.settle_refund_operation((r->>'operation_id')::uuid);
  if (r->>'reversal_due_cents')::int <> 4500
     or exists (select 1 from public.seller_carry_entries where seller_id = other_seller) then
    raise exception 'A partial refund within the transfer changed: %', r;
  end if;

  -- 7. A payout cancelled mid-dispatch that then went through takes its
  --    shortfall back off.
  insert into public.orders(buyer_id, seller_id, status, subtotal_cents, platform_fee_cents, total_cents, currency)
  values (buyer, other_seller, 'delivered', 10000, 1000, 10000, 'USD') returning id into inflight;
  insert into public.payments(order_id, provider, status, amount_cents, currency)
  values (inflight, 'stub', 'succeeded', 10000, 'USD');
  insert into public.transfer_intents(order_id, seller_id, amount_cents, currency, status)
  values (inflight, other_seller, 9000, 'USD', 'ready');
  insert into public.seller_adjustments(seller_id, order_id, kind, amount_cents, currency, external_reference)
  values (other_seller, inflight, 'outbound_label', -500, 'USD', 'carry-guard:inflight');
  perform public.claim_transfer_intents('inflight-worker', 10, 300, 8);
  perform public.prepare_transfer_dispatch(inflight, 'inflight-worker', 'transfer:' || inflight::text, 8500, 'usd',
    'acct_inflight', 'ch_inflight', 'pi_inflight');
  r := public.begin_refund_operation(
    p_order_id => inflight, p_amount_cents => 10000, p_reason => 'carry guard inflight',
    p_requested_by => 'stripe:webhook', p_actor_role => 'system', p_resolve_dispute => false,
    p_dispute_outcome => null, p_payment_reference => null, p_external => true);
  perform public.settle_refund_operation((r->>'operation_id')::uuid);
  if (select amount_cents from public.seller_carry_entries where entry_key = 'uncollected:' || inflight::text) <> -500 then
    raise exception 'Fixture: the in-flight cancellation recorded no shortfall';
  end if;
  v_text := public.complete_transfer_intent(inflight, 'inflight-worker', 'transfer:' || inflight::text, 'tr_inflight');
  if (select sum(amount_cents) from public.seller_carry_entries where order_id = inflight) <> 0 then
    raise exception 'A transfer that went through after its cancellation left its labels owed twice';
  end if;

  -- 8. The ledger is append-only.
  rejected := false;
  begin update public.seller_carry_entries set amount_cents = -1 where seller_id = seller;
  exception when insufficient_privilege then rejected := true; end;
  if not rejected then raise exception 'A carry-forward amount was rewritten'; end if;
  rejected := false;
  begin delete from public.seller_carry_entries where seller_id = seller;
  exception when insufficient_privilege then rejected := true; end;
  if not rejected then raise exception 'A carry-forward entry was deleted'; end if;
end $$;

-- 9. Clients read only their own entries and can't write or freeze.
do $$
declare
  v_count int;
  v_seller uuid := (select seller_id from public.seller_carry_entries where kind = 'collected' limit 1);
  v_other uuid := (select seller_id from public.seller_carry_entries where kind = 'uncollected_reversed' limit 1);
  rejected boolean := false;
begin
  if has_function_privilege('authenticated', 'public.freeze_transfer_carry(uuid,text,int)', 'execute')
     or has_function_privilege('anon', 'public.freeze_transfer_carry(uuid,text,int)', 'execute')
     or has_function_privilege('authenticated', 'public.record_seller_carry(uuid,text,int,uuid,uuid,text)', 'execute')
     or has_function_privilege('authenticated', 'public.seller_carry_available_cents(uuid,uuid)', 'execute') then
    raise exception 'A client role can run a carry-forward function';
  end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_seller, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_count from public.seller_carry_entries where seller_id = v_other;
  if v_count <> 0 then raise exception 'A seller read another seller''s carry-forward entries'; end if;
  select count(*) into v_count from public.seller_carry_entries;
  if v_count = 0 then raise exception 'A seller could not read their own carry-forward entries'; end if;
  begin
    insert into public.seller_carry_entries(seller_id, kind, amount_cents, entry_key)
    values (v_seller, 'collected', 1, 'client-forged');
  exception when insufficient_privilege then rejected := true; end;
  reset role;
  if not rejected then raise exception 'A client wrote a carry-forward entry'; end if;
  raise notice 'all seller carry-forward checks passed';
end $$;

rollback;
