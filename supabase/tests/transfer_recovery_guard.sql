-- R03 transfer-dispatch durability guard. Run only against a disposable
-- database; all fixtures and state changes roll back.
begin;

do $$
declare
  v_seller uuid := gen_random_uuid();
  v_buyer uuid := gen_random_uuid();
  v_order uuid;
  v_legacy_order uuid;
  v_race_order uuid;
  v_dispute_order uuid;
  v_bad_lease_order uuid;
  v_conflict_order uuid;
  v_recovery uuid;
  v_claim record;
  v_ok boolean;
  v_completion text;
  v_count int;
begin
  insert into auth.users (id, email) values
    (v_seller, 'transfer-recovery-seller@example.test'),
    (v_buyer, 'transfer-recovery-buyer@example.test');
  update public.profiles
    set display_name = 'Transfer Recovery Seller', username = 'transfer_recovery_seller'
    where id = v_seller;
  update public.profiles
    set display_name = 'Transfer Recovery Buyer', username = 'transfer_recovery_buyer'
    where id = v_buyer;

  insert into public.orders (
    buyer_id, seller_id, status, subtotal_cents, platform_fee_cents,
    total_cents, currency
  ) values (
    v_buyer, v_seller, 'delivered', 5000, 500, 5000, 'USD'
  ) returning id into v_order;
  insert into public.transfer_intents (
    order_id, seller_id, amount_cents, currency, status
  ) values (v_order, v_seller, 4500, 'USD', 'ready');

  select * into v_claim
  from public.claim_transfer_intents('dispatch-owner', 1, 300, 8);
  if v_claim.order_id <> v_order
     or v_claim.provider_call_may_have_occurred then
    raise exception 'FAIL 1: a fresh claim must not be marked provider-uncertain';
  end if;
  raise notice 'PASS 1/17: fresh claim is provider-certain';

  v_ok := public.prepare_transfer_dispatch(
    v_order, 'stale-owner', 'transfer:' || v_order::text, 4500, 'usd',
    'acct_transfer_guard', 'ch_transfer_guard', 'pi_transfer_guard'
  );
  if v_ok then
    raise exception 'FAIL 2: non-owner froze a provider payload';
  end if;
  raise notice 'PASS 2/17: prepare rejects a non-owner';

  begin
    perform public.prepare_transfer_dispatch(
      v_order, 'dispatch-owner', 'transfer:' || v_order::text, null, 'usd',
      'acct_transfer_guard', 'ch_transfer_guard', 'pi_transfer_guard'
    );
    raise exception 'FAIL 3: prepare accepted a null required parameter';
  exception
    when others then
      if sqlerrm like 'FAIL 3:%' then raise; end if;
  end;
  raise notice 'PASS 3/17: prepare rejects null required parameters';

  v_ok := public.prepare_transfer_dispatch(
    v_order, 'dispatch-owner', 'transfer:' || v_order::text, 4500, 'usd',
    'acct_transfer_guard', 'ch_transfer_guard', 'pi_transfer_guard'
  );
  if not v_ok then
    raise exception 'FAIL 4: current owner could not freeze provider payload';
  end if;
  if not exists (
    select 1 from public.transfer_intents
    where order_id = v_order
      and provider_call_may_have_occurred
      and dispatch_amount_cents = 4500
      and dispatch_currency = 'usd'
      and dispatch_destination = 'acct_transfer_guard'
      and dispatch_source_transaction = 'ch_transfer_guard'
      and dispatch_transfer_group = 'pi_transfer_guard'
  ) then
    raise exception 'FAIL 4: immutable provider payload was not persisted';
  end if;
  raise notice 'PASS 4/17: provider payload is frozen before dispatch';

  v_ok := public.prepare_transfer_dispatch(
    v_order, 'dispatch-owner', 'transfer:' || v_order::text, 4400, 'usd',
    'acct_transfer_guard', 'ch_transfer_guard', 'pi_transfer_guard'
  );
  if v_ok then
    raise exception 'FAIL 5: a frozen amount was replaced';
  end if;
  raise notice 'PASS 5/17: frozen provider payload cannot change';

  update public.transfer_intents
  set lease_expires_at = now() - interval '1 second'
  where order_id = v_order;
  select * into v_claim
  from public.claim_transfer_intents('recovery-owner', 1, 300, 8);
  if v_claim.order_id <> v_order
     or not v_claim.provider_call_may_have_occurred
     or v_claim.dispatch_amount_cents <> 4500 then
    raise exception 'FAIL 6: stale claim did not preserve its uncertain frozen payload';
  end if;
  raise notice 'PASS 6/17: stale claim is uncertain and retains frozen payload';

  v_completion := public.complete_transfer_intent(
    v_order, 'dispatch-owner', 'transfer:' || v_order::text, 'tr_stale'
  );
  if v_completion <> 'lost' then
    raise exception 'FAIL 7: stale owner completion returned %', v_completion;
  end if;
  raise notice 'PASS 7/17: stale owner cannot complete';

  -- Simulate a partial refund and label cost committing while the provider
  -- call was in flight. Completion must recompute from these locked rows.
  update public.orders set refunded_cents = 1000 where id = v_order;
  insert into public.seller_adjustments (
    seller_id, order_id, kind, amount_cents, currency, external_reference
  ) values (
    v_seller, v_order, 'outbound_label', -100, 'USD', 'transfer-guard-label'
  );
  v_completion := public.complete_transfer_intent(
    v_order, 'recovery-owner', 'transfer:' || v_order::text, 'tr_recovered'
  );
  if v_completion <> 'completed' then
    raise exception 'FAIL 8: current owner completion returned %', v_completion;
  end if;
  raise notice 'PASS 8/17: current owner completes with the frozen operation identity';
  if not exists (
    select 1 from public.payment_recoveries
    where recovery_key = 'transfer-adjustment:transfer:' || v_order::text || ':tr_recovered'
      and kind = 'transfer_after_refund'
      and amount_cents = 1000
  ) then
    raise exception 'FAIL 9: completion missed the concurrent refund/adjustment delta';
  end if;
  if not exists (
    select 1 from public.orders o join public.transfer_intents t on t.order_id = o.id
    where o.id = v_order and o.transfer_reference = 'tr_recovered'
      and t.transfer_reference = 'tr_recovered' and t.status = 'transferred'
  ) then
    raise exception 'FAIL 9: completion did not atomically stamp both local records';
  end if;
  raise notice 'PASS 9/17: completion atomically recomputes and records the changed obligation';

  select count(*) into v_count
  from public.admin_alert_outbox
  where dedup_key = 'transfer-recovery:transfer-adjustment:transfer:' ||
    v_order::text || ':tr_recovered'
    and kind = 'transfer_stuck'
    and status = 'pending';
  if v_count <> 1 then
    raise exception 'FAIL 9 alert: partial-amount recovery has % durable alerts', v_count;
  end if;
  update public.payment_recoveries
  set last_seen_at = now()
  where recovery_key = 'transfer-adjustment:transfer:' || v_order::text || ':tr_recovered';
  select count(*) into v_count
  from public.admin_alert_outbox
  where dedup_key = 'transfer-recovery:transfer-adjustment:transfer:' ||
    v_order::text || ':tr_recovered';
  if v_count <> 1 then
    raise exception 'FAIL 9 alert: replay produced % durable alerts', v_count;
  end if;
  raise notice 'PASS 9 alert: recovery and one pending alert commit together under replay';

  insert into public.orders (
    buyer_id, seller_id, status, subtotal_cents, platform_fee_cents,
    total_cents, currency
  ) values (
    v_buyer, v_seller, 'delivered', 5000, 500, 5000, 'USD'
  ) returning id into v_legacy_order;
  insert into public.transfer_intents (
    order_id, seller_id, amount_cents, currency, status, locked_by,
    locked_at, lease_expires_at
  ) values (
    v_legacy_order, v_seller, 4500, 'USD', 'processing', 'legacy-owner',
    now() - interval '10 minutes', now() - interval '5 minutes'
  );
  select * into v_claim
  from public.claim_transfer_intents('legacy-recovery-owner', 1, 300, 8);
  if v_claim.order_id <> v_legacy_order
     or not v_claim.provider_call_may_have_occurred
     or v_claim.operation_key is not null then
    raise exception 'FAIL 10: legacy stale claim must be uncertain without invented parameters';
  end if;
  raise notice 'PASS 10/17: legacy stale claim is uncertain without invented parameters';

  v_recovery := public.record_transfer_recovery(
    v_legacy_order,
    'legacy-owner',
    'transfer-unresolved:' || v_legacy_order::text,
    'Stale owner must not write recovery',
    4500
  );
  if v_recovery is not null or exists (
    select 1 from public.payment_recoveries
    where recovery_key = 'transfer-unresolved:' || v_legacy_order::text
  ) or not exists (
    select 1 from public.transfer_intents
    where order_id = v_legacy_order and status = 'processing'
      and locked_by = 'legacy-recovery-owner'
  ) then
    raise exception 'FAIL 11: stale recovery owner changed current state or audit';
  end if;
  raise notice 'PASS 11/17: stale recovery owner changes neither state nor audit';

  v_recovery := public.record_transfer_recovery(
    v_legacy_order,
    'legacy-recovery-owner',
    'transfer-unresolved:' || v_legacy_order::text,
    'Legacy provider call has no frozen payload',
    4500
  );
  if v_recovery is null or not exists (
    select 1 from public.transfer_intents
    where order_id = v_legacy_order
      and status = 'failed'
      and attempts >= 8
      and locked_by is null
  ) then
    raise exception 'FAIL 12: durable recovery did not fence unsafe reissue';
  end if;
  raise notice 'PASS 12/17: durable operator recovery fences unsafe reissue';

  select count(*) into v_count
  from public.payment_recoveries
  where recovery_key = 'transfer-unresolved:' || v_legacy_order::text;
  if v_count <> 1 then
    raise exception 'FAIL 12: durable recovery count is %', v_count;
  end if;
  if not exists (
    select 1 from public.admin_alert_outbox
    where dedup_key = 'transfer-recovery:transfer-unresolved:' || v_legacy_order::text
      and kind = 'transfer_stuck'
      and status = 'pending'
  ) then
    raise exception 'FAIL 12 alert: record_transfer_recovery omitted its durable alert';
  end if;
  raise notice 'PASS 12 alert: record RPC recovery atomically owns a pending alert';

  -- A full refund can cancel the intent during the provider call. The returned
  -- transfer must still be stamped and surfaced as a recovery obligation.
  insert into public.orders (
    buyer_id, seller_id, status, subtotal_cents, platform_fee_cents,
    total_cents, currency
  ) values (
    v_buyer, v_seller, 'delivered', 5000, 500, 5000, 'USD'
  ) returning id into v_race_order;
  insert into public.transfer_intents (
    order_id, seller_id, amount_cents, currency, status
  ) values (v_race_order, v_seller, 4500, 'USD', 'ready');
  perform public.claim_transfer_intents('race-owner', 1, 300, 8);
  v_ok := public.prepare_transfer_dispatch(
    v_race_order, 'race-owner', 'transfer:' || v_race_order::text, 4500, 'usd',
    'acct_transfer_guard', 'ch_race', 'pi_race'
  );
  update public.orders
  set status = 'refunded', refunded_cents = total_cents
  where id = v_race_order;
  update public.transfer_intents
  set status = 'cancelled', last_error = 'order fully refunded'
  where order_id = v_race_order;
  v_completion := public.complete_transfer_intent(
    v_race_order, 'race-owner', 'transfer:' || v_race_order::text, 'tr_race'
  );
  if v_completion <> 'recovery' then
    raise exception 'FAIL 13: cancelled in-flight completion returned %', v_completion;
  end if;
  if not exists (
    select 1 from public.orders o join public.transfer_intents t on t.order_id = o.id
    where o.id = v_race_order and o.transfer_reference = 'tr_race'
      and t.transfer_reference = 'tr_race'
  ) or not exists (
    select 1 from public.payment_recoveries
    where recovery_key = 'transfer-adjustment:transfer:' || v_race_order::text || ':tr_race'
      and amount_cents = 4500
  ) then
    raise exception 'FAIL 13: cancelled in-flight provider effect was not recovered';
  end if;
  raise notice 'PASS 13/17: full-refund race preserves the provider effect and recovery';

  -- A dispute can open after the last pre-provider eligibility check. The
  -- provider effect is still recorded, but must create an operator obligation
  -- even when the monetary amount itself did not change.
  insert into public.orders (
    buyer_id, seller_id, status, subtotal_cents, platform_fee_cents,
    total_cents, currency
  ) values (
    v_buyer, v_seller, 'delivered', 5000, 500, 5000, 'USD'
  ) returning id into v_dispute_order;
  insert into public.transfer_intents (
    order_id, seller_id, amount_cents, currency, status
  ) values (v_dispute_order, v_seller, 4500, 'USD', 'ready');
  perform public.claim_transfer_intents('dispute-owner', 1, 300, 8);
  v_ok := public.prepare_transfer_dispatch(
    v_dispute_order, 'dispute-owner', 'transfer:' || v_dispute_order::text,
    4500, 'usd', 'acct_transfer_guard', 'ch_dispute', 'pi_dispute'
  );
  update public.orders set status = 'disputed' where id = v_dispute_order;
  v_completion := public.complete_transfer_intent(
    v_dispute_order, 'dispute-owner',
    'transfer:' || v_dispute_order::text, 'tr_dispute'
  );
  if v_completion <> 'recovery'
     or not exists (
       select 1 from public.orders o join public.transfer_intents t on t.order_id = o.id
       where o.id = v_dispute_order and o.transfer_reference = 'tr_dispute'
         and t.transfer_reference = 'tr_dispute' and t.status = 'transferred'
     )
     or not exists (
       select 1 from public.payment_recoveries
       where recovery_key = 'transfer-unresolved:' || v_dispute_order::text
         and kind = 'transfer_unresolved' and amount_cents = 4500
     ) then
    raise exception 'FAIL 14: disputed in-flight transfer lacked durable recovery';
  end if;
  raise notice 'PASS 14/17: disputed in-flight provider effect opens durable recovery';

  -- A malformed historical processing row with no owner or lease must not
  -- NULL-pass the live-lease predicate and accept a completion.
  insert into public.orders (
    buyer_id, seller_id, status, subtotal_cents, platform_fee_cents,
    total_cents, currency
  ) values (
    v_buyer, v_seller, 'delivered', 5000, 500, 5000, 'USD'
  ) returning id into v_bad_lease_order;
  insert into public.transfer_intents (
    order_id, seller_id, amount_cents, currency, status,
    operation_key, dispatch_amount_cents, dispatch_currency,
    dispatch_destination, dispatch_source_transaction,
    dispatch_transfer_group, provider_call_may_have_occurred
  ) values (
    v_bad_lease_order, v_seller, 4500, 'USD', 'processing',
    'transfer:' || v_bad_lease_order::text, 4500, 'usd',
    'acct_transfer_guard', 'ch_bad_lease', 'pi_bad_lease', true
  );
  v_completion := public.complete_transfer_intent(
    v_bad_lease_order, 'missing-owner',
    'transfer:' || v_bad_lease_order::text, 'tr_bad_lease'
  );
  if v_completion <> 'lost' or exists (
    select 1
    from public.orders o join public.transfer_intents t on t.order_id = o.id
    where o.id = v_bad_lease_order
      and (o.transfer_reference is not null or t.transfer_reference is not null)
  ) then
    raise exception 'FAIL 15: malformed processing lease accepted completion';
  end if;
  raise notice 'PASS 15/17: missing lease and owner cannot NULL-pass completion CAS';

  -- Cancellation may race with a provider result after another path already
  -- stamped a different reference. Preserve both facts for operator review.
  insert into public.orders (
    buyer_id, seller_id, status, subtotal_cents, platform_fee_cents,
    total_cents, currency, transfer_reference
  ) values (
    v_buyer, v_seller, 'refunded', 5000, 500, 5000, 'USD', 'tr_existing'
  ) returning id into v_conflict_order;
  insert into public.transfer_intents (
    order_id, seller_id, amount_cents, currency, status,
    operation_key, dispatch_amount_cents, dispatch_currency,
    dispatch_destination, dispatch_source_transaction,
    dispatch_transfer_group, provider_call_may_have_occurred
  ) values (
    v_conflict_order, v_seller, 4500, 'USD', 'cancelled',
    'transfer:' || v_conflict_order::text, 4500, 'usd',
    'acct_transfer_guard', 'ch_conflict', 'pi_conflict', true
  );
  v_completion := public.complete_transfer_intent(
    v_conflict_order, 'cancelled-owner',
    'transfer:' || v_conflict_order::text, 'tr_returned_after_cancel'
  );
  if v_completion <> 'recovery'
     or not exists (
       select 1 from public.orders
       where id = v_conflict_order and transfer_reference = 'tr_existing'
     )
     or not exists (
       select 1 from public.transfer_intents
       where order_id = v_conflict_order and status = 'failed'
         and transfer_reference is null and attempts >= 8
     )
     or not exists (
       select 1 from public.payment_recoveries
       where recovery_key = 'transfer-unresolved:' || v_conflict_order::text
         and kind = 'transfer_unresolved'
         and detail like '%tr_returned_after_cancel%tr_existing%'
     ) then
    raise exception 'FAIL 16: cancelled conflicting transfer reference was overwritten or lost';
  end if;
  raise notice 'PASS 16/17: cancelled conflicting reference is preserved for recovery';

  begin
    update public.transfer_intents
    set dispatch_currency = null
    where order_id = v_order;
    raise exception 'FAIL 17: partial frozen payload passed the table constraint';
  exception
    when check_violation then null;
  end;
  raise notice 'PASS 17/17: partial/null frozen payloads fail the table constraint';

  raise notice '--- all transfer-recovery checks passed ---';
end $$;

rollback;
