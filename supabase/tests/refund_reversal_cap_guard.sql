-- A refund after the payout reverses what the transfer can still give back
-- (20261007100000): a refund made before the transfer doesn't use up the
-- cap, a run of refunds never reverses more than was sent, and only charges
-- the transfer had collected are owed again. Rolls back.
begin;

do $$
declare
  seller uuid := gen_random_uuid();
  buyer uuid := gen_random_uuid();
  early uuid; early_labels uuid; steps uuid; steps_labels uuid;
  r jsonb;
begin
  -- Four $100 orders with a $10 fee whose transfers have gone. Two had $50
  -- refunded before the transfer (the order and payment already show it).
  insert into auth.users(id, email) values
    (seller, 'cap-seller@example.test'), (buyer, 'cap-buyer@example.test');

  create temporary table cap_fixture(name text primary key, order_id uuid) on commit drop;
  with made as (
    insert into public.orders(buyer_id, seller_id, status, subtotal_cents, platform_fee_cents, total_cents,
      currency, refunded_cents, platform_fee_refunded_cents, transfer_reference)
    values
      (buyer, seller, 'delivered', 10000, 1000, 10000, 'USD', 5000, 500, 'tr_cap_early'),
      (buyer, seller, 'delivered', 10000, 1000, 10000, 'USD', 5000, 500, 'tr_cap_early_labels'),
      (buyer, seller, 'delivered', 10000, 1000, 10000, 'USD', 0, 0, 'tr_cap_steps'),
      (buyer, seller, 'delivered', 10000, 1000, 10000, 'USD', 0, 0, 'tr_cap_steps_labels')
    returning id, transfer_reference
  )
  insert into cap_fixture select substr(transfer_reference, 8), id from made;
  select order_id into early from cap_fixture where name = 'early';
  select order_id into early_labels from cap_fixture where name = 'early_labels';
  select order_id into steps from cap_fixture where name = 'steps';
  select order_id into steps_labels from cap_fixture where name = 'steps_labels';

  insert into public.payments(order_id, provider, status, amount_cents, refunded_cents, currency, provider_reference)
  select f.order_id, 'stub', case when o.refunded_cents > 0 then 'partially_refunded' else 'succeeded' end,
         10000, o.refunded_cents, 'USD', 'pi_cap_' || f.name
    from cap_fixture f join public.orders o on o.id = f.order_id;

  -- What each transfer sent: the seller's 9000 share, less the share of any
  -- refund made first (4500), less 300 of labels where there were labels.
  insert into public.transfer_intents(order_id, seller_id, amount_cents, currency, status, transfer_reference,
    operation_key, dispatch_amount_cents, dispatch_currency, dispatch_destination, dispatch_source_transaction,
    dispatch_transfer_group)
  select f.order_id, seller, 9000, 'USD', 'transferred', 'tr_cap_' || f.name, 'transfer:' || f.order_id::text,
         case f.name when 'early' then 4500 when 'early_labels' then 4200 when 'steps' then 9000 else 8700 end,
         'usd', 'acct_cap', 'ch_cap_' || f.name, 'pi_cap_' || f.name
    from cap_fixture f;

  -- 1. Half refunded before the payout, the rest after: the whole transfer
  --    comes back and nothing is left owed. (This reversed 0 and booked 4500
  --    as a debt.)
  r := public.begin_refund_operation(
    p_order_id => early, p_amount_cents => 5000, p_reason => 'cap guard: rest after payout',
    p_requested_by => 'stripe:webhook', p_actor_role => 'system', p_resolve_dispute => false,
    p_dispute_outcome => null, p_payment_reference => null, p_external => true);
  r := public.settle_refund_operation((r->>'operation_id')::uuid);
  if (r->>'reversal_due_cents')::int <> 4500 then
    raise exception 'FAIL 1: a refund after an earlier, pre-payout refund reversed %, expected 4500', r->>'reversal_due_cents';
  end if;
  if exists (select 1 from public.seller_carry_entries where order_id = early) then
    raise exception 'FAIL 1: a fully reversible refund was booked as owed';
  end if;
  raise notice 'PASS 1: a pre-payout refund does not use up the reversal cap';

  -- 2. The same, where the transfer had also paid for 300 of labels: all
  --    4200 sent comes back and only the 300 is owed again.
  r := public.begin_refund_operation(
    p_order_id => early_labels, p_amount_cents => 5000, p_reason => 'cap guard: rest after payout, labels',
    p_requested_by => 'stripe:webhook', p_actor_role => 'system', p_resolve_dispute => false,
    p_dispute_outcome => null, p_payment_reference => null, p_external => true);
  r := public.settle_refund_operation((r->>'operation_id')::uuid);
  if (r->>'reversal_due_cents')::int <> 4200 then
    raise exception 'FAIL 2: reversed %, expected the 4200 sent', r->>'reversal_due_cents';
  end if;
  if (select sum(amount_cents) from public.seller_carry_entries
       where order_id = early_labels and kind = 'reversal_shortfall') is distinct from -300 then
    raise exception 'FAIL 2: the labels the transfer had collected were not owed again as 300';
  end if;
  raise notice 'PASS 2: only the collected charges are owed again';

  -- 3. Two refunds after a full payout each reverse their own share.
  r := public.begin_refund_operation(
    p_order_id => steps, p_amount_cents => 2500, p_reason => 'cap guard: first quarter',
    p_requested_by => 'stripe:webhook', p_actor_role => 'system', p_resolve_dispute => false,
    p_dispute_outcome => null, p_payment_reference => null, p_external => true);
  r := public.settle_refund_operation((r->>'operation_id')::uuid);
  if (r->>'reversal_due_cents')::int <> 2250 then raise exception 'FAIL 3: first step reversed %', r->>'reversal_due_cents'; end if;
  -- The reversal goes through at the provider before the next refund
  -- (a refund still awaiting its reversal counts as in flight).
  update public.refund_operations set status = 'completed', reversal_completed_at = now()
   where order_id = steps and status = 'reversal_pending';
  r := public.begin_refund_operation(
    p_order_id => steps, p_amount_cents => 7500, p_reason => 'cap guard: the rest',
    p_requested_by => 'stripe:webhook', p_actor_role => 'system', p_resolve_dispute => false,
    p_dispute_outcome => null, p_payment_reference => null, p_external => true);
  r := public.settle_refund_operation((r->>'operation_id')::uuid);
  if (r->>'reversal_due_cents')::int <> 6750
     or exists (select 1 from public.seller_carry_entries where order_id = steps) then
    raise exception 'FAIL 3: second step reversed %, or something was owed', r->>'reversal_due_cents';
  end if;
  raise notice 'PASS 3: successive refunds reverse their own shares';

  -- 4. Across several refunds the reversals never exceed what was sent
  --    (8700): 2250, then the 6450 that is left, and the 300 short is owed.
  r := public.begin_refund_operation(
    p_order_id => steps_labels, p_amount_cents => 2500, p_reason => 'cap guard: labels, first quarter',
    p_requested_by => 'stripe:webhook', p_actor_role => 'system', p_resolve_dispute => false,
    p_dispute_outcome => null, p_payment_reference => null, p_external => true);
  r := public.settle_refund_operation((r->>'operation_id')::uuid);
  if (r->>'reversal_due_cents')::int <> 2250 then raise exception 'FAIL 4: first step reversed %', r->>'reversal_due_cents'; end if;
  -- The reversal goes through at the provider before the next refund
  -- (a refund still awaiting its reversal counts as in flight).
  update public.refund_operations set status = 'completed', reversal_completed_at = now()
   where order_id = steps_labels and status = 'reversal_pending';
  r := public.begin_refund_operation(
    p_order_id => steps_labels, p_amount_cents => 7500, p_reason => 'cap guard: labels, the rest',
    p_requested_by => 'stripe:webhook', p_actor_role => 'system', p_resolve_dispute => false,
    p_dispute_outcome => null, p_payment_reference => null, p_external => true);
  r := public.settle_refund_operation((r->>'operation_id')::uuid);
  if (r->>'reversal_due_cents')::int <> 6450 then
    raise exception 'FAIL 4: second step reversed %, expected the 6450 left of the transfer', r->>'reversal_due_cents';
  end if;
  if (select sum(reversal_due_cents) from public.refund_operations where order_id = steps_labels) <> 8700
     or (select sum(amount_cents) from public.seller_carry_entries
          where order_id = steps_labels and kind = 'reversal_shortfall') is distinct from -300 then
    raise exception 'FAIL 4: reversals did not total the 8700 sent with 300 owed';
  end if;
  raise notice 'PASS 4: reversals total what was sent, never more';

  raise notice 'all refund reversal cap checks passed';
end $$;

rollback;
