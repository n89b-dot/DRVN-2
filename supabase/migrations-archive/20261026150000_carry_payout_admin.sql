-- 20261026150000 — an operator can retry or cancel a stuck seller credit payout.
--
-- seller_carry_payouts (20261008100100) rows that exhaust their attempts, or
-- that the worker sets aside ("no destination on record", a Stripe lookup it
-- could not trust), end as status 'failed' with next_attempt_at null. The
-- claim query never picks them up again; one admin alert is raised and that
-- was the whole console (readiness report two, item 21). These two functions
-- are the console's controls, called by the admin actions on the service
-- role after assert_admin_actor and journalled in admin_audit_log:
--
--   admin_retry_seller_carry_payout(id)
--     Puts the row back in the queue: status 'pending', attempts 0, no next
--     attempt time, no lease. Everything else is kept — in particular
--     provider_call_may_have_occurred and the frozen destination, so the
--     worker's next pass looks Stripe up by transfer group before it creates
--     anything (exactly-once is unchanged). Allowed on 'pending' and 'failed'
--     rows and on a 'processing' row whose lease has run out (its worker is
--     gone); refused on 'paid', 'cancelled' and a live lease.
--
--   admin_cancel_seller_carry_payout(id)
--     Ends the payout and puts the credit back on the seller's balance with a
--     'paid_out_reversed' entry (the same entry release_seller_carry_payout
--     writes when the worker cancels), so the money is owed to the seller
--     again and the next payout run or transfer collects it. Refused once
--     Stripe may have been called: that payout can only be completed or
--     reconciled against Stripe, never written off here. Same status rules
--     as retry. When the seller's account is gone there is no balance to
--     restore; the row is simply closed.
--
-- Both are SECURITY DEFINER for the service role only (the table has no
-- client write grant), take the row FOR UPDATE and the seller's carry lock,
-- and return the row's new status.
--
-- Idempotent: create or replace; grants restated.

begin;

create or replace function public.admin_retry_seller_carry_payout(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_payout public.seller_carry_payouts;
begin
  if p_id is null then
    raise exception 'A payout is required' using errcode = '22023';
  end if;
  select * into v_payout from public.seller_carry_payouts where id = p_id for update;
  if not found then
    raise exception 'That payout no longer exists' using errcode = 'P0002';
  end if;
  if v_payout.status in ('paid', 'cancelled') then
    raise exception 'This payout is already %', v_payout.status using errcode = '22023';
  end if;
  if v_payout.status = 'processing' and v_payout.lease_expires_at is not null and v_payout.lease_expires_at > now() then
    raise exception 'A worker holds this payout right now; try again in a few minutes' using errcode = '55P03';
  end if;
  update public.seller_carry_payouts
     set status = 'pending',
         attempts = 0,
         next_attempt_at = null,
         locked_by = null,
         lease_expires_at = null,
         updated_at = now()
   where id = p_id;
  return jsonb_build_object('id', p_id, 'status', 'pending', 'previous_status', v_payout.status,
                            'provider_call_may_have_occurred', v_payout.provider_call_may_have_occurred);
end;
$$;

create or replace function public.admin_cancel_seller_carry_payout(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_payout public.seller_carry_payouts;
  v_restored boolean := false;
begin
  if p_id is null then
    raise exception 'A payout is required' using errcode = '22023';
  end if;
  select * into v_payout from public.seller_carry_payouts where id = p_id for update;
  if not found then
    raise exception 'That payout no longer exists' using errcode = 'P0002';
  end if;
  if v_payout.status in ('paid', 'cancelled') then
    raise exception 'This payout is already %', v_payout.status using errcode = '22023';
  end if;
  if v_payout.status = 'processing' and v_payout.lease_expires_at is not null and v_payout.lease_expires_at > now() then
    raise exception 'A worker holds this payout right now; try again in a few minutes' using errcode = '55P03';
  end if;
  if v_payout.provider_call_may_have_occurred then
    raise exception 'Stripe may have been called for this payout, so it cannot be cancelled: find the transfer in Stripe (group carry-payout:%), then retry so the worker completes it', v_payout.id
      using errcode = '22023';
  end if;
  if v_payout.seller_id is not null then
    -- The lock every carry writer takes; the balance can't move under us.
    perform pg_advisory_xact_lock(hashtextextended('seller-carry:' || v_payout.seller_id::text, 0));
    perform public.record_seller_carry(
      v_payout.seller_id, 'paid_out_reversed', v_payout.amount_cents, null, null,
      'paid-out-reversed:' || v_payout.id::text);
    v_restored := true;
  end if;
  update public.seller_carry_payouts
     set status = 'cancelled',
         next_attempt_at = null,
         locked_by = null,
         lease_expires_at = null,
         updated_at = now()
   where id = p_id;
  return jsonb_build_object('id', p_id, 'status', 'cancelled', 'previous_status', v_payout.status,
                            'credit_restored_cents', case when v_restored then v_payout.amount_cents else 0 end);
end;
$$;

revoke all on function public.admin_retry_seller_carry_payout(uuid) from public, anon, authenticated;
revoke all on function public.admin_cancel_seller_carry_payout(uuid) from public, anon, authenticated;
grant execute on function public.admin_retry_seller_carry_payout(uuid) to service_role;
grant execute on function public.admin_cancel_seller_carry_payout(uuid) to service_role;

notify pgrst, 'reload schema';

commit;
