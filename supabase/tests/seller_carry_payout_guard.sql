-- A seller's carry-forward credit is paid out once: the payout takes the
-- whole balance off the ledger when it opens, only the leaseholder can move
-- it, it can't be cancelled once Stripe may have been called, and a
-- cancelled one puts the credit back (20261008100100). Rolls back.
begin;

do $$
declare
  seller uuid := gen_random_uuid();
  second_seller uuid := gen_random_uuid();
  debtor uuid := gen_random_uuid();
  buyer uuid := gen_random_uuid();
  o uuid; payout uuid; other_payout uuid;
  v int; v_text text; rejected boolean;
  claimed int;
begin
  insert into auth.users(id, email) values
    (seller, 'payout-seller@example.test'), (second_seller, 'payout-second@example.test'),
    (debtor, 'payout-debtor@example.test'), (buyer, 'payout-buyer@example.test');

  -- A label refunded after its order's payout went: a credit of 300.
  insert into public.orders(buyer_id, seller_id, status, subtotal_cents, platform_fee_cents, total_cents, currency)
  values (buyer, seller, 'delivered', 10000, 1000, 10000, 'USD') returning id into o;
  insert into public.transfer_intents(order_id, seller_id, amount_cents, currency, status, transfer_reference)
  values (o, seller, 9000, 'USD', 'transferred', 'tr_payout_guard_1');
  insert into public.seller_adjustments(seller_id, order_id, kind, amount_cents, currency, external_reference)
  values (seller, o, 'label_refund', 300, 'USD', 'payout-guard:refund-1');
  if (select sum(amount_cents) from public.seller_carry_entries where seller_id = seller) <> 300 then
    raise exception 'Fixture: the late label refund was not recorded as a credit';
  end if;

  -- A seller who owes is never paid.
  insert into public.orders(buyer_id, seller_id, status, subtotal_cents, platform_fee_cents, total_cents, currency)
  values (buyer, debtor, 'delivered', 10000, 1000, 10000, 'USD') returning id into o;
  insert into public.transfer_intents(order_id, seller_id, amount_cents, currency, status, transfer_reference)
  values (o, debtor, 9000, 'USD', 'transferred', 'tr_payout_guard_2');
  insert into public.seller_adjustments(seller_id, order_id, kind, amount_cents, currency, external_reference)
  values (debtor, o, 'return_label', -400, 'USD', 'payout-guard:return-1');

  -- 1. A credit newer than the quiet period waits.
  if public.open_seller_carry_payouts() <> 0 then
    raise exception 'A credit recorded a moment ago was paid out without waiting';
  end if;

  -- 2. Opening takes the whole balance off the ledger, once.
  v := public.open_seller_carry_payouts(0);
  if v <> 1 then raise exception 'Expected one payout to open, got %', v; end if;
  select id into strict payout from public.seller_carry_payouts where seller_id = seller;
  if (select amount_cents from public.seller_carry_payouts where id = payout) <> 300 then
    raise exception 'The payout is not for the whole credit';
  end if;
  if (select sum(amount_cents) from public.seller_carry_entries where seller_id = seller) <> 0
     or not exists (select 1 from public.seller_carry_entries
                     where seller_id = seller and kind = 'paid_out' and amount_cents = -300) then
    raise exception 'Opening a payout did not take the credit off the balance';
  end if;
  if public.open_seller_carry_payouts(0) <> 0 then
    raise exception 'The same credit opened a second payout';
  end if;
  if exists (select 1 from public.seller_carry_payouts where seller_id = debtor) then
    raise exception 'A seller who owes was paid';
  end if;
  -- The debt of the other seller is untouched and this one owes nothing.
  if public.seller_carry_available_cents(seller, null) <> 0
     or public.seller_carry_available_cents(debtor, null) <> 400 then
    raise exception 'Opening a payout changed what a transfer would collect';
  end if;

  -- 3. Only the leaseholder moves it, and only in order.
  select count(*) into claimed from public.claim_seller_carry_payouts('payout-worker', 10, 300, 8);
  if claimed <> 1 then raise exception 'Expected to claim one payout, got %', claimed; end if;
  select count(*) into claimed from public.claim_seller_carry_payouts('second-worker', 10, 300, 8);
  if claimed <> 0 then raise exception 'A leased payout was claimed twice'; end if;
  if public.prepare_seller_carry_payout(payout, 'second-worker', 'acct_x') is not null then
    raise exception 'A worker without the lease prepared a payout';
  end if;
  if public.complete_seller_carry_payout(payout, 'payout-worker', 'tr_credit_1') <> 'lost' then
    raise exception 'A payout completed without being prepared';
  end if;
  if public.prepare_seller_carry_payout(payout, 'payout-worker', 'acct_first') <> 'acct_first' then
    raise exception 'Prepare did not freeze the destination';
  end if;
  if public.prepare_seller_carry_payout(payout, 'payout-worker', 'acct_changed') <> 'acct_first' then
    raise exception 'A second prepare changed the frozen destination';
  end if;

  -- 4. After Stripe may have been called it cannot be cancelled.
  rejected := false;
  begin
    perform public.release_seller_carry_payout(payout, 'payout-worker', 'cancelled', 'x', null, null);
  exception when others then rejected := true; end;
  if not rejected then raise exception 'A payout that may have reached Stripe was cancelled'; end if;
  if public.complete_seller_carry_payout(payout, 'second-worker', 'tr_credit_1') <> 'lost' then
    raise exception 'A worker without the lease completed a payout';
  end if;
  if public.complete_seller_carry_payout(payout, 'payout-worker', 'tr_credit_1') <> 'completed'
     or public.complete_seller_carry_payout(payout, 'payout-worker', 'tr_credit_1') <> 'completed' then
    raise exception 'Completing a payout (and replaying it) did not answer completed';
  end if;
  if public.complete_seller_carry_payout(payout, 'payout-worker', 'tr_other') <> 'lost' then
    raise exception 'A paid payout accepted a different transfer';
  end if;
  select status || ':' || transfer_reference into v_text from public.seller_carry_payouts where id = payout;
  if v_text <> 'paid:tr_credit_1' then raise exception 'Payout not recorded as paid: %', v_text; end if;
  if (select sum(amount_cents) from public.seller_carry_entries where seller_id = seller) <> 0 then
    raise exception 'Paying a payout changed the balance again';
  end if;

  -- 5. A payout cancelled before any Stripe call puts the credit back, and
  --    the credit can then be paid by a new payout.
  insert into public.orders(buyer_id, seller_id, status, subtotal_cents, platform_fee_cents, total_cents, currency)
  values (buyer, second_seller, 'delivered', 10000, 1000, 10000, 'USD') returning id into o;
  insert into public.transfer_intents(order_id, seller_id, amount_cents, currency, status, transfer_reference)
  values (o, second_seller, 9000, 'USD', 'transferred', 'tr_payout_guard_3');
  insert into public.seller_adjustments(seller_id, order_id, kind, amount_cents, currency, external_reference)
  values (second_seller, o, 'label_refund', 500, 'USD', 'payout-guard:refund-2');
  perform public.open_seller_carry_payouts(0);
  select id into strict other_payout from public.seller_carry_payouts where seller_id = second_seller;
  perform public.claim_seller_carry_payouts('payout-worker', 10, 300, 8);
  if not public.release_seller_carry_payout(other_payout, 'payout-worker', 'cancelled', 'seller account deleted', null, null) then
    raise exception 'The leaseholder could not cancel an unsent payout';
  end if;
  if (select sum(amount_cents) from public.seller_carry_entries where seller_id = second_seller) <> 500 then
    raise exception 'Cancelling an unsent payout did not put the credit back';
  end if;
  -- Releasing twice does nothing more.
  if public.release_seller_carry_payout(other_payout, 'payout-worker', 'cancelled', 'again', null, null) then
    raise exception 'A released payout was released again';
  end if;
  if public.open_seller_carry_payouts(0) <> 1 then
    raise exception 'A credit put back by a cancelled payout was not picked up again';
  end if;

  -- 6. One unfinished payout per seller: a failed one holds the next back.
  select id into strict other_payout from public.seller_carry_payouts
   where seller_id = second_seller and status = 'pending';
  perform public.claim_seller_carry_payouts('payout-worker', 10, 300, 8);
  perform public.release_seller_carry_payout(other_payout, 'payout-worker', 'failed', 'balance_insufficient', 8, null);
  insert into public.seller_adjustments(seller_id, order_id, kind, amount_cents, currency, external_reference)
  values (second_seller, o, 'label_refund', 100, 'USD', 'payout-guard:refund-3');
  if public.open_seller_carry_payouts(0) <> 0 then
    raise exception 'A second payout opened while the first was unresolved';
  end if;
  -- Attempts exhausted: it is no longer claimed.
  select count(*) into claimed from public.claim_seller_carry_payouts('payout-worker', 10, 300, 8);
  if claimed <> 0 then raise exception 'An exhausted payout was claimed again'; end if;

  -- 7. The entries stay append-only, with the new kinds signed.
  rejected := false;
  begin
    insert into public.seller_carry_entries(seller_id, kind, amount_cents, entry_key)
    values (seller, 'paid_out', 5, 'payout-guard:wrong-sign');
  exception when check_violation then rejected := true; end;
  if not rejected then raise exception 'A positive paid_out entry was accepted'; end if;
end $$;

-- Access: service role only for the functions; a seller reads their own
-- payouts but not where they went, and writes nothing.
do $$
declare
  v_seller uuid := (select seller_id from public.seller_carry_payouts where status = 'paid' limit 1);
  v_count int;
  rejected boolean := false;
  fn text;
begin
  foreach fn in array array[
    'public.open_seller_carry_payouts(int,int)',
    'public.claim_seller_carry_payouts(text,int,int,int)',
    'public.prepare_seller_carry_payout(uuid,text,text)',
    'public.complete_seller_carry_payout(uuid,text,text)',
    'public.release_seller_carry_payout(uuid,text,text,text,int,timestamptz)'
  ] loop
    if has_function_privilege('authenticated', fn, 'execute') or has_function_privilege('anon', fn, 'execute') then
      raise exception 'A client role can run %', fn;
    end if;
  end loop;
  perform set_config('request.jwt.claims', json_build_object('sub', v_seller, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_count from (select id, amount_cents, status from public.seller_carry_payouts) p;
  if v_count <> 1 then raise exception 'A seller read % payouts, expected only their own one', v_count; end if;
  begin
    perform destination from public.seller_carry_payouts;
  exception when insufficient_privilege then rejected := true; end;
  if not rejected then reset role; raise exception 'A seller read a payout''s Stripe destination'; end if;
  rejected := false;
  begin
    insert into public.seller_carry_payouts(seller_id, amount_cents) values (v_seller, 100000);
  exception when insufficient_privilege then rejected := true; end;
  reset role;
  if not rejected then raise exception 'A client opened a payout'; end if;
  raise notice 'all seller carry payout checks passed';
end $$;

rollback;
