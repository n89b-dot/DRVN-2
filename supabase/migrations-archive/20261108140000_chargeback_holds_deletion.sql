-- An open bank chargeback holds account deletion, for both parties to the
-- order, even when the order itself is completed (ruled by Neil, 8 Nov 2026).
--
-- What was wrong: the financial hold (account_deletion_blockers,
-- 20260905185725) looked at orders, payouts, refunds, checkouts, recoveries
-- and returns. A chargeback on a completed order touches none of them: the
-- order stays 'completed' and the payout is frozen without changing state
-- (20261107130000 keeps it 'holding' or 'transferred'). So a buyer or seller
-- could have their account deleted while the bank's case was still running.
--
-- The truth is the provider dispute journal, as for the payout freeze
-- (20261107130000): a chargeback is unresolved unless its journal entry
-- reached won, warning_closed or lost. 'open', 'loss_pending', 'recovery' and
-- any state added later hold. Both the buyer and the seller of every order the
-- chargeback covers are held.
--
-- Changed, each from its latest definition with only the chargeback added:
--   account_deletion_blockers            (20260905185725) one more hold
--   private.account_deletion_hold_order  (20261108130400) names its order
--   private.account_deletion_hold_appeared (20261108130400) maps a journal row
--     to the order's parties
--   private.requeue_account_deletion_for_hold, pause_account_deletion_hold
--     (20261108130400) take their wording from one new helper, which says
--     plainly when the order is waiting on the bank
-- New: private.account_deletion_hold_note and private.account_deletion_hold_code
-- (blocker_code 'open_chargeback' when the named order waits on the bank),
-- and a constraint trigger on
-- stripe_dispute_journal, so a chargeback opened after a case finished puts
-- it back in the queue, like every other hold.
--
-- Money rules are untouched. Idempotent: create or replace, drop if exists.

begin;

-- ---------------------------------------------------------------------------
-- 1. The hold rule. From 20260905185725, with the last line added.
-- ---------------------------------------------------------------------------
create or replace function public.account_deletion_blockers(p_user uuid) returns jsonb
language sql stable security definer set search_path=public,pg_temp as $$
  select jsonb_build_object(
    'financial_hold',
      exists(select 1 from public.orders where (buyer_id=p_user or seller_id=p_user) and status not in ('completed','cancelled','payment_failed','refunded'))
      or exists(select 1 from public.transfer_intents where seller_id=p_user and status not in ('transferred','cancelled'))
      or exists(select 1 from public.refund_operations r join public.orders o on o.id=r.order_id where (o.buyer_id=p_user or o.seller_id=p_user) and r.status<>'completed')
      or exists(select 1 from public.payment_requests p where p.request->>'buyerId'=p_user::text and p.provider_reference is null)
      or exists(select 1 from public.payment_recoveries r join public.orders o on o.id=r.order_id where r.status='open' and (o.buyer_id=p_user or o.seller_id=p_user))
      or exists(select 1 from public.returns r join public.orders o on o.id=r.order_id where (o.buyer_id=p_user or o.seller_id=p_user) and r.status not in ('completed','rejected','expired','cancelled'))
      -- Same "unresolved" as private.order_has_unresolved_chargeback (20261107130000).
      or exists(select 1 from public.stripe_dispute_journal j join public.orders o on o.id=any(j.order_ids) where j.state not in ('won','warning_closed','lost') and (o.buyer_id=p_user or o.seller_id=p_user)),
    'retained_identity',
      exists(select 1 from public.orders where buyer_id=p_user or seller_id=p_user)
      or exists(select 1 from public.admin_audit_log where actor_id=p_user)
      or exists(select 1 from public.reports where reporter_id=p_user or resolved_by=p_user)
      or exists(select 1 from public.refund_operations where requested_by=p_user::text)
  );
$$;
revoke all on function public.account_deletion_blockers(uuid) from public,anon,authenticated;
grant execute on function public.account_deletion_blockers(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 2. The order to name. From 20261108130400, with the chargeback branch.
-- ---------------------------------------------------------------------------
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
      union all
      select o.id, o.created_at
        from public.stripe_dispute_journal j
        join public.orders o on o.id = any(j.order_ids)
       where j.state not in ('won', 'warning_closed', 'lost')
         and (o.buyer_id = p_user or o.seller_id = p_user)
    ) h
   order by h.created_at, h.order_id
   limit 1;
$$;

revoke all on function private.account_deletion_hold_order(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. What the member is told. One place for the wording both writers use.
--    A chargeback is the bank's to decide, not the member's to settle.
-- ---------------------------------------------------------------------------
create or replace function private.account_deletion_hold_note(p_order uuid)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case
    when p_order is null then
      'Finish the checkout in progress first. The privacy worker carries on by itself once it settles.'
    when private.order_has_unresolved_chargeback(p_order) then
      'Order ' || upper(left(p_order::text, 8)) || ' has an open bank chargeback. The privacy worker carries on by itself once the bank decides it.'
    else
      'Settle order ' || upper(left(p_order::text, 8)) || ' first. The privacy worker carries on by itself once it settles.'
  end;
$$;

revoke all on function private.account_deletion_hold_note(uuid) from public, anon, authenticated;

-- The case's blocker code: 'open_chargeback' when the order named is waiting
-- on the bank, so the status pages can say so; otherwise as before.
create or replace function private.account_deletion_hold_code(p_order uuid)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case
    when p_order is not null and private.order_has_unresolved_chargeback(p_order) then 'open_chargeback'
    else 'active_financial_obligations'
  end;
$$;

revoke all on function private.account_deletion_hold_code(uuid) from public, anon, authenticated;

-- From 20261108130400: wording from the helper, chargebacks in the classes.
create or replace function private.requeue_account_deletion_for_hold(p_user uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_order uuid;
begin
  if not exists (
    select 1 from public.remediation_jobs
     where dedup_key = 'delete:' || p_user::text and kind = 'delete_account'
       and status not in ('pending', 'processing')
  ) then
    return;
  end if;
  if not exists (select 1 from public.account_deletion_requests where user_id = p_user and outcome <> 'completed') then
    return;
  end if;
  if not coalesce((public.account_deletion_blockers(p_user)->>'financial_hold')::boolean, false) then
    return;
  end if;

  v_order := private.account_deletion_hold_order(p_user);
  update public.remediation_jobs
     set status = 'pending', next_attempt_at = now(), locked_until = null, lease_id = null,
         attempts = 0, last_error = null, completed_at = null
   where dedup_key = 'delete:' || p_user::text and kind = 'delete_account'
     and status not in ('pending', 'processing');
  update public.account_deletion_requests
     set outcome = 'temporary_financial_hold', blocker_code = private.account_deletion_hold_code(v_order),
         affected_data_classes = array['orders', 'returns', 'refunds', 'payouts', 'chargebacks'],
         hold_order_id = v_order,
         next_action = private.account_deletion_hold_note(v_order),
         responsible_owner = 'account owner', completed_at = null, updated_at = now()
   where user_id = p_user and outcome <> 'completed';
end $$;

revoke all on function private.requeue_account_deletion_for_hold(uuid) from public, anon, authenticated;

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
     set outcome = 'temporary_financial_hold', blocker_code = private.account_deletion_hold_code(v_order),
         affected_data_classes = array['orders', 'returns', 'refunds', 'payouts', 'chargebacks'],
         hold_order_id = v_order,
         next_action = private.account_deletion_hold_note(v_order),
         responsible_owner = 'account owner', updated_at = now()
   where user_id = p_user;
end $$;

revoke all on function public.pause_account_deletion_hold(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.pause_account_deletion_hold(uuid, uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 4. A chargeback opened (or linked to its orders) after a case finished puts
--    it back in the queue. From 20261108130400, with the journal branch.
-- ---------------------------------------------------------------------------
create or replace function private.account_deletion_hold_appeared()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row jsonb := to_jsonb(new);
  v_members uuid[];
  v_member uuid;
begin
  if tg_table_name = 'orders' then
    v_members := array[(v_row->>'buyer_id')::uuid, (v_row->>'seller_id')::uuid];
  elsif tg_table_name = 'transfer_intents' then
    v_members := array[(v_row->>'seller_id')::uuid];
  elsif tg_table_name = 'payment_requests' then
    v_members := case
      when (v_row->'request'->>'buyerId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        then array[(v_row->'request'->>'buyerId')::uuid]
      else array[]::uuid[]
    end;
  elsif tg_table_name = 'stripe_dispute_journal' then
    -- Every party to every order the chargeback covers.
    select coalesce(array_agg(m), array[]::uuid[]) into v_members
      from public.orders o
      cross join lateral unnest(array[o.buyer_id, o.seller_id]) m
     where o.id = any(new.order_ids);
  else
    -- returns, refund_operations, payment_recoveries: the order's two parties.
    select array[o.buyer_id, o.seller_id] into v_members
      from public.orders o where o.id = (v_row->>'order_id')::uuid;
  end if;

  for v_member in
    select distinct m from unnest(coalesce(v_members, array[]::uuid[])) m where m is not null order by m
  loop
    if exists (select 1 from public.account_deletion_requests where user_id = v_member and outcome <> 'completed') then
      perform pg_advisory_xact_lock_shared(private.account_deletion_lock_key(v_member));
      perform private.requeue_account_deletion_for_hold(v_member);
    end if;
  end loop;
  return null;
end $$;

revoke all on function private.account_deletion_hold_appeared() from public, anon, authenticated;

-- Fires only for an unresolved entry, with the predicate above.
drop trigger if exists account_deletion_hold_watch on public.stripe_dispute_journal;
create constraint trigger account_deletion_hold_watch
  after insert or update of state, order_ids on public.stripe_dispute_journal
  deferrable initially deferred
  for each row
  when (new.state not in ('won', 'warning_closed', 'lost'))
  execute function private.account_deletion_hold_appeared();

notify pgrst, 'reload schema';
commit;
