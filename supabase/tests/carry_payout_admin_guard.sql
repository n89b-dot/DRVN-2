-- An operator's retry and cancel of a stuck seller credit payout
-- (20261026150000): retry puts the row back where the worker claims it and
-- keeps the Stripe facts; cancel restores the credit and is refused once
-- Stripe may have been called; neither touches a paid or cancelled payout or
-- one a live worker holds. Rolls back.
begin;

do $$
declare
  seller uuid := gen_random_uuid();
  stuck uuid; reached uuid; paid uuid; orphan uuid;
  r jsonb;
  claimed int;
  failed_msg text;
begin
  insert into auth.users(id, email) values (seller, 'carry-admin-seller@example.test');

  -- A $25 credit that a payout was opened for and that then exhausted its
  -- attempts: the balance is 0 while the payout is open.
  perform public.record_seller_carry(seller, 'late_adjustment', 2500, null, null, 'carry-admin:credit');
  insert into public.seller_carry_payouts(seller_id, amount_cents, status, attempts, next_attempt_at, last_error)
  values (seller, 2500, 'failed', 8, null, 'guard: exhausted') returning id into stuck;
  perform public.record_seller_carry(seller, 'paid_out', -2500, null, null, 'paid-out:' || stuck::text);
  if (select coalesce(sum(amount_cents), 0) from public.seller_carry_entries where seller_id = seller) <> 0 then
    raise exception 'Fixture: the open payout should leave a zero balance';
  end if;

  -- 1. Retry: back in the queue, and the claim picks it up.
  r := public.admin_retry_seller_carry_payout(stuck);
  if r->>'status' <> 'pending' or r->>'previous_status' <> 'failed' then
    raise exception 'FAIL 1: retry answered %', r;
  end if;
  if not exists (select 1 from public.seller_carry_payouts where id = stuck and status = 'pending' and attempts = 0
                   and next_attempt_at is null and locked_by is null and lease_expires_at is null) then
    raise exception 'FAIL 1: the row was not reset for the worker';
  end if;
  select count(*) into claimed from public.claim_seller_carry_payouts('guard-worker', 10, 300, 8) p where p.id = stuck;
  if claimed <> 1 then
    raise exception 'FAIL 1: the worker did not claim the retried payout';
  end if;
  raise notice 'PASS 1: retry returns a stuck payout to the queue';

  -- 2. While a worker holds the lease, neither control may touch it.
  begin
    perform public.admin_retry_seller_carry_payout(stuck);
    raise exception 'FAIL 2: retry was allowed under a live lease';
  exception when sqlstate '55P03' then null;
  end;
  begin
    perform public.admin_cancel_seller_carry_payout(stuck);
    raise exception 'FAIL 2: cancel was allowed under a live lease';
  exception when sqlstate '55P03' then null;
  end;
  raise notice 'PASS 2: a live lease refuses both controls';

  -- 3. The worker gives up again; cancel closes the payout and restores the credit.
  if not public.release_seller_carry_payout(stuck, 'guard-worker', 'failed', 'guard: exhausted again', 8, null) then
    raise exception 'Fixture: could not release the claimed payout';
  end if;
  r := public.admin_cancel_seller_carry_payout(stuck);
  if r->>'status' <> 'cancelled' or (r->>'credit_restored_cents')::int <> 2500 then
    raise exception 'FAIL 3: cancel answered %', r;
  end if;
  if not exists (select 1 from public.seller_carry_payouts where id = stuck and status = 'cancelled' and next_attempt_at is null) then
    raise exception 'FAIL 3: the payout was not cancelled';
  end if;
  if not exists (select 1 from public.seller_carry_entries
                  where seller_id = seller and kind = 'paid_out_reversed' and amount_cents = 2500) then
    raise exception 'FAIL 3: no paid_out_reversed entry was written';
  end if;
  if (select sum(amount_cents) from public.seller_carry_entries where seller_id = seller) <> 2500 then
    raise exception 'FAIL 3: the seller''s balance is %, expected 2500',
      (select sum(amount_cents) from public.seller_carry_entries where seller_id = seller);
  end if;
  raise notice 'PASS 3: cancel restores the credit to the seller''s balance';

  -- 4. A cancelled payout is final for both controls.
  begin
    perform public.admin_cancel_seller_carry_payout(stuck);
    raise exception 'FAIL 4: a cancelled payout was cancelled again';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform public.admin_retry_seller_carry_payout(stuck);
    raise exception 'FAIL 4: a cancelled payout was retried';
  exception when sqlstate '22023' then null;
  end;
  if (select count(*) from public.seller_carry_entries where seller_id = seller and kind = 'paid_out_reversed') <> 1 then
    raise exception 'FAIL 4: the credit was restored more than once';
  end if;
  raise notice 'PASS 4: a cancelled payout stays cancelled, the credit restored once';

  -- 5. Once Stripe may have been called, cancel is refused and retry keeps
  --    that fact (and the frozen destination) for the worker's lookup.
  insert into public.seller_carry_payouts(seller_id, amount_cents, status, attempts, next_attempt_at, last_error,
                                          destination, provider_call_may_have_occurred)
  values (seller, 2500, 'failed', 8, null, 'no destination on record', 'acct_guard', true) returning id into reached;
  begin
    perform public.admin_cancel_seller_carry_payout(reached);
    raise exception 'FAIL 5: a payout that may have reached Stripe was cancelled';
  exception when sqlstate '22023' then
    get stacked diagnostics failed_msg = message_text;
    if position('carry-payout:' || reached::text in failed_msg) = 0 then
      raise exception 'FAIL 5: the refusal does not name the transfer group: %', failed_msg;
    end if;
  end;
  r := public.admin_retry_seller_carry_payout(reached);
  if (r->>'provider_call_may_have_occurred')::boolean is not true
     or not exists (select 1 from public.seller_carry_payouts where id = reached and status = 'pending'
                      and provider_call_may_have_occurred and destination = 'acct_guard') then
    raise exception 'FAIL 5: retry lost the Stripe facts: %', r;
  end if;
  raise notice 'PASS 5: a payout that may have reached Stripe can be retried, never cancelled';

  -- 6. A paid payout is out of reach.
  insert into public.seller_carry_payouts(seller_id, amount_cents, status, paid_at, transfer_reference)
  values (seller, 100, 'paid', now(), 'tr_guard_paid') returning id into paid;
  begin
    perform public.admin_retry_seller_carry_payout(paid);
    raise exception 'FAIL 6: a paid payout was retried';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform public.admin_cancel_seller_carry_payout(paid);
    raise exception 'FAIL 6: a paid payout was cancelled';
  exception when sqlstate '22023' then null;
  end;
  raise notice 'PASS 6: a paid payout is untouched';

  -- 7. A seller whose account is gone: cancel closes the row, nothing to restore.
  insert into public.seller_carry_payouts(seller_id, amount_cents, status, attempts, next_attempt_at, last_error)
  values (null, 700, 'failed', 8, null, 'seller account deleted') returning id into orphan;
  r := public.admin_cancel_seller_carry_payout(orphan);
  if r->>'status' <> 'cancelled' or (r->>'credit_restored_cents')::int <> 0 then
    raise exception 'FAIL 7: the ownerless payout answered %', r;
  end if;
  raise notice 'PASS 7: an ownerless payout closes without a credit';

  -- 8. Clients can't call either.
  if has_function_privilege('authenticated', 'public.admin_retry_seller_carry_payout(uuid)', 'execute')
     or has_function_privilege('anon', 'public.admin_retry_seller_carry_payout(uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.admin_cancel_seller_carry_payout(uuid)', 'execute')
     or has_function_privilege('anon', 'public.admin_cancel_seller_carry_payout(uuid)', 'execute') then
    raise exception 'FAIL 8: a client role can call a carry payout control';
  end if;
  raise notice 'PASS 8: the controls are the service role''s';

  raise notice 'all carry payout admin checks passed';
end $$;

rollback;
