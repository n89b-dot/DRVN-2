-- A refund whose effects are already on the order is not also counted as in
-- flight (20261007100200): while it waits for its transfer reversal, the
-- rest of the order can still be refunded in full, by us or at Stripe.
begin;

do $$
declare
  seller uuid := gen_random_uuid();
  buyer uuid := gen_random_uuid();
  o uuid; o2 uuid;
  r jsonb;
begin
  insert into auth.users(id, email) values
    (seller, 'inflight-seller@example.test'), (buyer, 'inflight-buyer@example.test');

  insert into public.orders(buyer_id, seller_id, status, subtotal_cents, platform_fee_cents, total_cents, currency, transfer_reference)
  values (buyer, seller, 'delivered', 10000, 1000, 10000, 'USD', 'tr_inflight') returning id into o;
  insert into public.orders(buyer_id, seller_id, status, subtotal_cents, platform_fee_cents, total_cents, currency, transfer_reference)
  values (buyer, seller, 'delivered', 10000, 1000, 10000, 'USD', 'tr_inflight2') returning id into o2;
  insert into public.payments(order_id, provider, status, amount_cents, currency, provider_reference)
  values (o, 'stripe', 'succeeded', 10000, 'USD', 'pi_inflight'), (o2, 'stripe', 'succeeded', 10000, 'USD', 'pi_inflight2');
  insert into public.transfer_intents(order_id, seller_id, amount_cents, currency, status, transfer_reference,
    operation_key, dispatch_amount_cents, dispatch_currency, dispatch_destination, dispatch_source_transaction,
    dispatch_transfer_group)
  values (o, seller, 9000, 'USD', 'transferred', 'tr_inflight', 'transfer:' || o::text, 9000, 'usd', 'acct_inflight', 'ch_inflight', 'pi_inflight'),
         (o2, seller, 9000, 'USD', 'transferred', 'tr_inflight2', 'transfer:' || o2::text, 9000, 'usd', 'acct_inflight', 'ch_inflight2', 'pi_inflight2');

  -- A quarter refunded and settled on both orders; each waits for its reversal.
  r := public.begin_refund_operation(
    p_order_id => o, p_amount_cents => 2500, p_reason => 'inflight guard: first',
    p_requested_by => 'stripe:webhook', p_actor_role => 'system', p_resolve_dispute => false,
    p_dispute_outcome => null, p_payment_reference => 'pi_inflight', p_external => true);
  r := public.settle_refund_operation((r->>'operation_id')::uuid);
  r := public.begin_refund_operation(
    p_order_id => o2, p_amount_cents => 2500, p_reason => 'inflight guard: first',
    p_requested_by => 'stripe:webhook', p_actor_role => 'system', p_resolve_dispute => false,
    p_dispute_outcome => null, p_payment_reference => 'pi_inflight2', p_external => true);
  r := public.settle_refund_operation((r->>'operation_id')::uuid);
  if (select count(*) from public.refund_operations where order_id in (o, o2) and status = 'reversal_pending') <> 2
     or (select refunded_cents from public.orders where id = o) <> 2500 then
    raise exception 'Fixture: the first refunds did not settle into reversal_pending';
  end if;

  -- 1. The remaining $75 arrives as a Stripe-side refund and is booked whole.
  --    (It was booked as $50: 10000 − 2500 settled − 2500 "in flight".)
  r := public.begin_refund_operation(
    p_order_id => o, p_amount_cents => 7500, p_reason => 'inflight guard: the rest',
    p_requested_by => 'stripe:webhook', p_actor_role => 'system', p_resolve_dispute => false,
    p_dispute_outcome => null, p_payment_reference => 'pi_inflight', p_external => true);
  if (r->>'ok')::boolean is not true
     or (select amount_cents from public.refund_operations where id = (r->>'operation_id')::uuid) <> 7500 then
    raise exception 'FAIL 1: an external refund was booked short while another awaited its reversal: %',
      (select amount_cents from public.refund_operations where id = (r->>'operation_id')::uuid);
  end if;
  raise notice 'PASS 1: a refund awaiting its reversal is counted once';

  -- 2. A refund that has not settled yet still reserves its amount.
  r := public.begin_refund_operation(
    p_order_id => o, p_amount_cents => 100, p_reason => 'inflight guard: over',
    p_requested_by => 'admin:guard', p_actor_role => 'admin', p_resolve_dispute => false,
    p_dispute_outcome => null, p_payment_reference => 'pi_inflight', p_external => false);
  if (r->>'ok')::boolean is not false then
    raise exception 'FAIL 2: a refund beyond the order total was started: %', r;
  end if;
  raise notice 'PASS 2: unsettled refunds still reserve what they will take';

  -- 3. The webhook path: a succeeded Stripe refund for the remaining $75 on
  --    the second order becomes an operation, not an amount-mismatch recovery.
  r := public.record_refund_provider_event(
    p_event_id => 'evt_inflight_guard', p_refund_reference => 're_inflight_guard', p_operation_id => null,
    p_order_id => o2, p_payment_reference => 'pi_inflight2', p_amount_cents => 7500, p_currency => 'usd',
    p_provider_status => 'succeeded', p_provider_created_at => now());
  if r->>'reason' is not null
     or not exists (select 1 from public.refund_operations where refund_reference = 're_inflight_guard' and amount_cents = 7500) then
    raise exception 'FAIL 3: a Stripe refund for what was left went to recovery: %', r;
  end if;
  raise notice 'PASS 3: the webhook books a refund for everything actually left';

  raise notice 'all refund in-flight checks passed';
end $$;

rollback;
