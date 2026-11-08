-- OS-W11 follow-up: account deletion checks financial holds before it bans
-- sign-in.
--
-- The deletion worker banned the member's sign-in and scrubbed the profile
-- first, and only rechecked financial holds after the cleanup. A hold found
-- then (an order, a return, a refund or a payout still open) paused the job
-- with the member banned: they could not sign in to settle the very thing
-- holding their deletion.
--
-- Now the worker asks account_deletion_hold_gate before the ban, again
-- straight after it, and again after cleanup. The gate takes the same
-- per-member lock as request_account_deletion and checkout
-- (hashtextextended(uid::text, 0)), so it sees every order committed before
-- it, and the deletion suspension that request set already refuses new
-- purchases. Re-asking after the ban closes the gap between the first check
-- and the ban. A hold found at any point lifts the ban (in the worker) and
-- pauses the job, recording which order to settle.
--
-- The hold rule itself is unchanged: account_deletion_blockers
-- (20260905185725) still decides it. Money rules are untouched.
--
-- Redefined here from its latest definition (20260905185725), with only the
-- hold order and its wording added: pause_account_deletion_hold. New:
-- account_deletion_requests.hold_order_id, private.account_deletion_hold_order,
-- public.account_deletion_hold_gate. This migration owns all three.

begin;

alter table public.account_deletion_requests
  add column if not exists hold_order_id uuid references public.orders(id) on delete set null;

create index if not exists account_deletion_requests_hold_order_idx
  on public.account_deletion_requests (hold_order_id)
  where hold_order_id is not null;

-- The oldest order behind a financial hold, over exactly the order-linked
-- parts of account_deletion_blockers' financial_hold. A checkout still
-- waiting on the payment provider (payment_requests) holds with no order yet:
-- null.
create or replace function private.account_deletion_hold_order(p_user uuid)
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select h.order_id
    from (
      select o.id as order_id, o.created_at
        from public.orders o
       where (o.buyer_id = p_user or o.seller_id = p_user)
         and o.status not in ('completed', 'cancelled', 'payment_failed', 'refunded')
      union all
      select o.id, o.created_at
        from public.transfer_intents t
        join public.orders o on o.id = t.order_id
       where t.seller_id = p_user and t.status not in ('transferred', 'cancelled')
      union all
      select o.id, o.created_at
        from public.refund_operations r
        join public.orders o on o.id = r.order_id
       where (o.buyer_id = p_user or o.seller_id = p_user) and r.status <> 'completed'
      union all
      select o.id, o.created_at
        from public.payment_recoveries r
        join public.orders o on o.id = r.order_id
       where r.status = 'open' and (o.buyer_id = p_user or o.seller_id = p_user)
      union all
      select o.id, o.created_at
        from public.returns r
        join public.orders o on o.id = r.order_id
       where (o.buyer_id = p_user or o.seller_id = p_user)
         and r.status not in ('completed', 'rejected', 'expired', 'cancelled')
    ) h
   order by h.created_at, h.order_id
   limit 1;
$$;

revoke all on function private.account_deletion_hold_order(uuid) from public, anon, authenticated;

-- Asked before any ban or destructive step, under the member's lock and the
-- job's lease. Held: says so, with the order to settle, and changes nothing
-- (the worker lifts the ban, then pauses). Clear: a case paused on an
-- earlier hold reads as cleaning up again.
create or replace function public.account_deletion_hold_gate(p_job uuid, p_lease uuid, p_user uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_blockers jsonb;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user::text, 0));
  perform 1 from public.remediation_jobs
   where id = p_job and kind = 'delete_account' and status = 'processing'
     and lease_id = p_lease and locked_until > now()
     and payload->>'user_id' = p_user::text;
  if not found then raise exception 'Deletion lease lost'; end if;

  v_blockers := public.account_deletion_blockers(p_user);
  -- An unreadable answer holds: never ban or delete on a guess.
  if coalesce((v_blockers->>'financial_hold')::boolean, true) then
    return v_blockers || jsonb_build_object('held', true, 'hold_order_id', private.account_deletion_hold_order(p_user));
  end if;

  update public.account_deletion_requests
     set outcome = 'cleanup_pending', blocker_code = null, hold_order_id = null,
         affected_data_classes = array['profile', 'owned content', 'uploads', 'provider customer'],
         next_action = 'Automated cleanup is in progress.', responsible_owner = 'privacy worker',
         updated_at = now()
   where user_id = p_user and outcome = 'temporary_financial_hold';
  return v_blockers || jsonb_build_object('held', false, 'hold_order_id', null);
end $$;

revoke all on function public.account_deletion_hold_gate(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.account_deletion_hold_gate(uuid, uuid, uuid) to service_role;

-- From 20260905185725, with the order to settle recorded and named.
create or replace function public.pause_account_deletion_hold(p_job uuid, p_lease uuid, p_user uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_order uuid;
begin
  update public.remediation_jobs
     set status = 'pending', next_attempt_at = now() + interval '1 hour', locked_until = null, lease_id = null,
         attempts = greatest(attempts - 1, 0), last_error = null
   where id = p_job and kind = 'delete_account' and status = 'processing' and lease_id = p_lease and locked_until > now();
  if not found then raise exception 'Deletion lease lost'; end if;
  v_order := private.account_deletion_hold_order(p_user);
  update public.account_deletion_requests
     set outcome = 'temporary_financial_hold', blocker_code = 'active_financial_obligations',
         affected_data_classes = array['orders', 'returns', 'refunds', 'payouts'],
         hold_order_id = v_order,
         next_action = case
           when v_order is not null then
             'Settle order ' || upper(left(v_order::text, 8)) || ' first. The privacy worker carries on by itself once it settles.'
           else 'Finish the checkout in progress first. The privacy worker carries on by itself once it settles.'
         end,
         responsible_owner = 'account owner', updated_at = now()
   where user_id = p_user;
end $$;

revoke all on function public.pause_account_deletion_hold(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.pause_account_deletion_hold(uuid, uuid, uuid) to service_role;

notify pgrst, 'reload schema';
commit;
