-- Carry-forward stays right after a payout is cancelled (20261007100400): a
-- later refund adds what it uncovers, a payout that went through after all
-- takes every such entry back, and a carry amount left on a transfer that
-- never reached dispatch reserves nothing. Rolls back.
begin;

do $$
declare
  seller uuid := gen_random_uuid();
  buyer uuid := gen_random_uuid();
  o uuid; plain uuid; stalled uuid; other uuid;
  r jsonb; v int;
begin
  insert into auth.users(id, email) values
    (seller, 'cancelled-seller@example.test'), (buyer, 'cancelled-buyer@example.test');

  -- A $100 order, $10 fee, $12 of labels, $90 already refunded: 900 of the
  -- seller's share is left, the labels exceed it, and the worker cancels the
  -- payout.
  insert into public.orders(buyer_id, seller_id, status, subtotal_cents, platform_fee_cents, total_cents, currency,
    refunded_cents, platform_fee_refunded_cents)
  values (buyer, seller, 'delivered', 10000, 1000, 10000, 'USD', 9000, 900) returning id into o;
  insert into public.payments(order_id, provider, status, amount_cents, refunded_cents, currency, provider_reference)
  values (o, 'stripe', 'partially_refunded', 10000, 9000, 'USD', 'pi_cancelled_guard');
  insert into public.transfer_intents(order_id, seller_id, amount_cents, currency, status)
  values (o, seller, 9000, 'USD', 'holding');
  insert into public.seller_adjustments(seller_id, order_id, kind, amount_cents, currency, external_reference)
  values (seller, o, 'outbound_label', -1200, 'USD', 'cancelled-guard:label');
  update public.transfer_intents set status = 'cancelled', last_error = 'guard: consumed' where order_id = o;
  if (select sum(amount_cents) from public.seller_carry_entries where order_id = o) is distinct from -300 then
    raise exception 'Fixture: the cancelled payout did not record 300 owed';
  end if;

  -- 1. The last $10 is refunded: the rest of the share is gone, so all 1200
  --    of the labels is owed. (It stayed at 300.)
  r := public.begin_refund_operation(
    p_order_id => o, p_amount_cents => 1000, p_reason => 'cancelled guard: the rest',
    p_requested_by => 'stripe:webhook', p_actor_role => 'system', p_resolve_dispute => false,
    p_dispute_outcome => null, p_payment_reference => 'pi_cancelled_guard', p_external => true);
  r := public.settle_refund_operation((r->>'operation_id')::uuid);
  if (r->>'reversal_due_cents')::int <> 0 then raise exception 'FAIL 1: a reversal was asked of a transfer that never went'; end if;
  if (select sum(amount_cents) from public.seller_carry_entries where order_id = o) is distinct from -1200 then
    raise exception 'FAIL 1: after the further refund the seller owes %, expected 1200',
      -(select sum(amount_cents) from public.seller_carry_entries where order_id = o);
  end if;
  -- Settling again changes nothing.
  perform public.settle_refund_operation((r->>'operation_id')::uuid);
  if (select count(*) from public.seller_carry_entries where order_id = o) <> 2 then
    raise exception 'FAIL 1: the top-up was recorded more than once';
  end if;
  raise notice 'PASS 1: a refund after a cancelled payout adds what it uncovers, once';

  -- 2. If that payout turns out to have gone through after all, everything
  --    recorded as uncollected for the order is taken back, not only the
  --    first entry.
  update public.transfer_intents set status = 'processing' where order_id = o;
  if (select sum(amount_cents) from public.seller_carry_entries where order_id = o) is distinct from 0 then
    raise exception 'FAIL 2: reopening the payout left % on the order',
      (select sum(amount_cents) from public.seller_carry_entries where order_id = o);
  end if;
  raise notice 'PASS 2: a reopened payout takes back every uncollected entry';

  -- 3. A cancelled payout with no label costs: a refund owes nothing extra.
  insert into public.orders(buyer_id, seller_id, status, subtotal_cents, platform_fee_cents, total_cents, currency,
    refunded_cents, platform_fee_refunded_cents)
  values (buyer, seller, 'delivered', 10000, 1000, 10000, 'USD', 5000, 500) returning id into plain;
  insert into public.payments(order_id, provider, status, amount_cents, refunded_cents, currency, provider_reference)
  values (plain, 'stripe', 'partially_refunded', 10000, 5000, 'USD', 'pi_cancelled_plain');
  insert into public.transfer_intents(order_id, seller_id, amount_cents, currency, status)
  values (plain, seller, 9000, 'USD', 'cancelled');
  r := public.begin_refund_operation(
    p_order_id => plain, p_amount_cents => 2500, p_reason => 'cancelled guard: no labels',
    p_requested_by => 'stripe:webhook', p_actor_role => 'system', p_resolve_dispute => false,
    p_dispute_outcome => null, p_payment_reference => 'pi_cancelled_plain', p_external => true);
  perform public.settle_refund_operation((r->>'operation_id')::uuid);
  if exists (select 1 from public.seller_carry_entries where order_id = plain) then
    raise exception 'FAIL 3: a seller who was never paid was charged for a refund';
  end if;
  raise notice 'PASS 3: share the seller never received is not charged back';

  -- 4. Reservations. The seller owes 500. One transfer froze 500 of it and
  --    then fell back to holding before any dispatch was prepared; another
  --    transfer must still be able to collect it.
  delete from public.transfer_intents where order_id in (o, plain);
  insert into public.orders(buyer_id, seller_id, status, subtotal_cents, platform_fee_cents, total_cents, currency)
  values (buyer, seller, 'delivered', 10000, 1000, 10000, 'USD') returning id into stalled;
  insert into public.orders(buyer_id, seller_id, status, subtotal_cents, platform_fee_cents, total_cents, currency)
  values (buyer, seller, 'delivered', 10000, 1000, 10000, 'USD') returning id into other;
  perform public.record_seller_carry(seller, 'reversal_shortfall', -500, stalled, null, 'cancelled-guard:owed');
  insert into public.transfer_intents(order_id, seller_id, amount_cents, currency, status, dispatch_carry_cents)
  values (stalled, seller, 9000, 'USD', 'holding', 500);
  v := public.seller_carry_available_cents(seller, other);
  if v <> 500 then
    raise exception 'FAIL 4: a transfer that never reached dispatch still reserves the debt (% available, expected 500)', v;
  end if;
  update public.transfer_intents set status = 'failed' where order_id = stalled;
  if public.seller_carry_available_cents(seller, other) <> 500 then
    raise exception 'FAIL 4: a failed transfer with no dispatch still reserves the debt';
  end if;
  raise notice 'PASS 4: an amount frozen before any dispatch reserves nothing';

  -- 5. A worker between its freeze and its dispatch, and a prepared
  --    dispatch, still reserve: that transfer is keeping the money back.
  update public.transfer_intents set status = 'processing' where order_id = stalled;
  if public.seller_carry_available_cents(seller, other) <> 0 then
    raise exception 'FAIL 5: a transfer being processed no longer reserves its collection';
  end if;
  update public.transfer_intents
     set status = 'failed', operation_key = 'transfer:' || stalled::text, provider_call_may_have_occurred = true,
         dispatch_amount_cents = 8500, dispatch_currency = 'usd', dispatch_destination = 'acct_cancelled_guard',
         dispatch_source_transaction = 'ch_cancelled_guard', dispatch_transfer_group = 'pi_cancelled_guard'
   where order_id = stalled;
  if public.seller_carry_available_cents(seller, other) <> 0 then
    raise exception 'FAIL 5: a dispatch that may have reached the provider no longer reserves its collection';
  end if;
  raise notice 'PASS 5: live and prepared dispatches still reserve';

  raise notice 'all carry after cancelled payout checks passed';
end $$;

rollback;
