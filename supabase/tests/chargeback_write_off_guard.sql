-- 20261110180000 (report five #108, OS id N944): a chargeback held for review
-- is written off under the rule, never paying the seller.
--   L  refused unless Stripe has closed the dispute as lost
--   D  refused before 90 days; allowed at exactly 90 (the database's clock);
--      the dry run changes nothing
--   W  the write-off cancels the order's unpaid payout, closes the orders as
--      refunded by the bank, records the platform's loss, closes the case and
--      the journal as written off; the seller's other order is untouched;
--      deletion unfreezes
--   X  after it, the payout is never claimed or dispatched, and a later
--      Stripe event on the entry changes nothing
--   P  only a full admin; service role only
-- Every failed check is collected and reported together at the end.
begin;

set constraints all immediate;

do $$
declare
  seller uuid := gen_random_uuid();
  buyer uuid := gen_random_uuid();
  admin_actor uuid := gen_random_uuid();
  sale uuid := gen_random_uuid();
  other uuid := gen_random_uuid();
  r jsonb;
  t text;
  msg text;
  refused boolean;
  fails text[] := '{}';
begin
  insert into public.job_config (key, value) values ('payments_mode', 'stub')
    on conflict (key) do update set value = excluded.value;
  insert into auth.users (id, email, raw_user_meta_data) values
    (seller, 'n944w-seller@drvn.test', '{}'), (buyer, 'n944w-buyer@drvn.test', '{}'), (admin_actor, 'n944w-admin@drvn.test', '{}');
  insert into public.admin_users (user_id, role, note) values (admin_actor, 'admin', 'guard');
  insert into public.orders (id, buyer_id, seller_id, status, subtotal_cents, shipping_cents, platform_fee_cents, total_cents, currency, completed_at) values
    (sale, buyer, seller, 'completed', 5000, 0, 500, 5000, 'USD', now() - interval '100 days'),
    (other, buyer, seller, 'completed', 3000, 0, 300, 3000, 'USD', now() - interval '100 days');
  -- A short payment record: the chargeback doesn't match and is held.
  insert into public.payments (order_id, provider, provider_reference, status, amount_cents, currency)
  values (sale, 'stripe', 'pi_n944w', 'succeeded', 4000, 'USD');
  insert into public.transfer_intents (order_id, seller_id, amount_cents, currency, status) values
    (sale, seller, 4500, 'USD', 'holding'), (other, seller, 2700, 'USD', 'holding');
  insert into public.webhook_events (id, type, payload) values
    ('evt_n944w_a', 'charge.dispute.created', '{"id": "evt_n944w_a", "type": "charge.dispute.created", "data": {"object": {"status": "needs_response"}}}'),
    ('evt_n944w_b', 'charge.dispute.closed', '{"id": "evt_n944w_b", "type": "charge.dispute.closed", "data": {"object": {"status": "lost"}}}');
  t := public.apply_stripe_dispute_event('dp_n944w', 'pi_n944w', 5000, 'usd', 'needs_response', false, 'evt_n944w_a', 100, gen_random_uuid());
  if (select state from public.stripe_dispute_journal where dispute_id = 'dp_n944w') <> 'recovery' then
    raise exception 'Fixture: the chargeback was not held (%) (N944)', t;
  end if;
  update public.payment_recoveries set created_at = now() - interval '91 days' where recovery_key = 'stripe:dispute:dp_n944w';

  -- ---------- L ----------
  begin
    perform public.admin_write_off_dispute_recovery('dp_n944w', admin_actor, 'too soon', false);
    fails := fails || 'FAIL L1: a chargeback Stripe hasn''t closed as lost was written off (N944)'::text;
  exception when others then
    get stacked diagnostics msg = message_text;
    if msg not like '%closed this dispute as lost%' then fails := fails || format('FAIL L2: the refusal said "%s" (N944)', msg); end if;
  end;
  -- Stripe closes it as lost while it is held.
  t := public.apply_stripe_dispute_event('dp_n944w', 'pi_n944w', 5000, 'usd', 'lost', true, 'evt_n944w_b', 200, gen_random_uuid());

  -- ---------- D ----------
  update public.payment_recoveries set created_at = now() - interval '89 days 23 hours' where recovery_key = 'stripe:dispute:dp_n944w';
  begin
    perform public.admin_write_off_dispute_recovery('dp_n944w', admin_actor, 'too soon', false);
    fails := fails || 'FAIL D1: a chargeback was written off before 90 days (N944)'::text;
  exception when others then
    get stacked diagnostics msg = message_text;
    if msg not like '%90 days%' then fails := fails || format('FAIL D2: the early refusal said "%s" (N944)', msg); end if;
  end;
  update public.payment_recoveries set created_at = now() - interval '90 days' where recovery_key = 'stripe:dispute:dp_n944w';
  r := public.admin_write_off_dispute_recovery('dp_n944w', admin_actor, 'Recovery from the seller failed for 90 days', true);
  if (r->>'written_off')::boolean or (r->'before'->>'withheld_from_seller_cents')::int <> 4500
     or (select state from public.stripe_dispute_journal where dispute_id = 'dp_n944w') <> 'recovery'
     or (select status from public.transfer_intents where order_id = sale) <> 'holding' then
    fails := fails || format('FAIL D3: the dry run at exactly 90 days changed something or misread it (%s) (N944)', r);
  end if;

  -- ---------- P ----------
  begin
    perform public.admin_write_off_dispute_recovery('dp_n944w', seller, 'I am the seller', false);
    fails := fails || 'FAIL P1: a member wrote a chargeback off (N944)'::text;
  exception when others then null;
  end;

  -- ---------- W ----------
  r := public.admin_write_off_dispute_recovery('dp_n944w', admin_actor, 'Recovery from the seller failed for 90 days', false);
  if (select state from public.stripe_dispute_journal where dispute_id = 'dp_n944w') <> 'written_off'
     or (select status from public.payment_recoveries where recovery_key = 'stripe:dispute:dp_n944w') <> 'written_off' then
    fails := fails || format('FAIL W1: the journal or the case was not closed as written off (%s) (N944)', r);
  end if;
  if (select status from public.transfer_intents where order_id = sale) <> 'cancelled'
     or (select status from public.orders where id = sale) <> 'refunded'
     or (select refunded_cents from public.orders where id = sale) <> 5000 then
    fails := fails || 'FAIL W2: the written-off order''s payout was not cancelled, or the order not closed as refunded by the bank (N944)'::text;
  end if;
  if not exists (select 1 from public.platform_chargeback_losses where dispute_id = 'dp_n944w' and amount_cents = 5000 and withheld_from_seller_cents = 4500 and recorded_by = admin_actor) then
    fails := fails || 'FAIL W3: the platform''s loss was not recorded (N944)'::text;
  end if;
  if (select status from public.transfer_intents where order_id = other) <> 'holding'
     or (select status from public.orders where id = other) <> 'completed' then
    fails := fails || 'FAIL W4: the seller''s other order was touched (N944)'::text;
  end if;
  if private.order_has_unresolved_chargeback(sale)
     or exists (select 1 from public.stripe_dispute_journal j join public.orders o on o.id = any(j.order_ids)
                 where o.seller_id = seller and not (j.state = any(private.dispute_terminal_states()))) then
    fails := fails || 'FAIL W5: a written-off chargeback still counts as unresolved (N944)'::text;
  end if;

  -- ---------- X ----------
  update public.transfer_intents set updated_at = now() - interval '1 year' where order_id = sale;
  if exists (select 1 from public.claim_transfer_intents('n944w-probe', 200, 300, 8) c where c.order_id = sale) then
    fails := fails || 'FAIL X1: a written-off order''s payout was claimed (N944)'::text;
  end if;
  update public.transfer_intents set status = 'processing', locked_by = 'n944w-worker', locked_at = now(), lease_expires_at = now() + interval '5 minutes'
   where order_id = sale;
  begin
    refused := not public.prepare_transfer_dispatch(sale, 'n944w-worker', 'transfer:' || sale::text, 4500, 'usd', 'acct_n944w', 'ch_n944w', 'pi_n944w');
  exception when others then
    refused := true;
  end;
  if not refused then
    fails := fails || 'FAIL X2: a written-off order''s payout could still be dispatched, even forced to processing (N944)'::text;
  end if;
  t := public.apply_stripe_dispute_event('dp_n944w', 'pi_n944w', 5000, 'usd', 'won', true, 'evt_n944w_c', 300, gen_random_uuid());
  if t <> 'committed'
     or (select state from public.stripe_dispute_journal where dispute_id = 'dp_n944w') <> 'written_off'
     or (select status from public.orders where id = sale) <> 'refunded' then
    fails := fails || format('FAIL X3: a later Stripe event moved a written-off chargeback (%s) (N944)', t);
  end if;

  -- ---------- P ----------
  if has_function_privilege('authenticated', 'public.admin_write_off_dispute_recovery(text, uuid, text, boolean)', 'execute')
     or has_function_privilege('anon', 'public.admin_write_off_dispute_recovery(text, uuid, text, boolean)', 'execute')
     or has_table_privilege('authenticated', 'public.platform_chargeback_losses', 'select') then
    fails := fails || 'FAIL P2: a member can reach the chargeback write-off (N944)'::text;
  end if;

  if cardinality(fails) > 0 then
    raise exception '%', array_to_string(fails, E'\n');
  end if;
  raise notice 'all chargeback write-off checks passed';
end $$;

rollback;
