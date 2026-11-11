-- OS-W11 follow-up: account deletion checks financial holds before it bans
-- sign-in, and a hold found at any point gives sign-in back.
--
-- The deletion worker banned the member's sign-in and scrubbed the profile
-- first, and only rechecked financial holds after the cleanup. A hold found
-- then (an order, a return, a refund or a payout still open) paused the job
-- with the member banned: they could not sign in to settle the very thing
-- holding their deletion.
--
-- 1. The worker asks account_deletion_hold_gate before the ban and straight
--    after it, and finishes through account_deletion_finalise, which checks
--    and records the outcome in one transaction. A hold lifts the ban (in
--    the worker) and pauses the job, recording which order to settle.
-- 2. Coordination (Codex on #157). The gate and finalise take the deletion
--    lock exclusively. Every write that can create a hold (orders, returns,
--    refund operations, payment recoveries, payouts, checkouts in progress)
--    takes it shared at commit, through a deferred trigger, for each member
--    it involves who has a deletion request. So a hold either commits before
--    the check reads (and is seen), or commits after the outcome is recorded,
--    and then puts the case back in the queue: the worker's next pass finds
--    the hold, lifts the ban and pauses. Shared locks don't conflict with
--    each other, so ordinary trading never waits on another trade.
-- 3. While a case is held, the member can write again: the statement guard
--    block_deleted_account_writes refused every write while a deletion job
--    existed, so a held member could not settle anything even when signed in.
--
-- The hold rule itself is unchanged: account_deletion_blockers
-- (20260905185725) still decides it. Money rules are untouched.
--
-- Redefined here from their latest definitions, with only the changes above:
-- pause_account_deletion_hold (20260905185725) and
-- block_deleted_account_writes (20260905130250). New:
-- account_deletion_requests.hold_order_id, private.account_deletion_lock_key,
-- private.account_deletion_hold_order, private.requeue_account_deletion_for_hold,
-- private.account_deletion_hold_appeared (+ six constraint triggers),
-- public.account_deletion_hold_gate, public.account_deletion_finalise. This
-- migration owns all of them.

begin;

alter table public.account_deletion_requests
  add column if not exists hold_order_id uuid references public.orders(id) on delete set null;

create index if not exists account_deletion_requests_hold_order_idx
  on public.account_deletion_requests (hold_order_id)
  where hold_order_id is not null;

-- The deletion lock, apart from the member lock checkout already takes
-- (hashtextextended(uid::text, 0)), so taking it can never deadlock a
-- checkout.
create or replace function private.account_deletion_lock_key(p_user uuid)
returns bigint
language sql
immutable
set search_path = public, pg_temp
as $$
  select hashtextextended('account-deletion:' || p_user::text, 0);
$$;

revoke all on function private.account_deletion_lock_key(uuid) from public, anon, authenticated;

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

-- Shared by the lease checks below.
create or replace function private.account_deletion_lease_held(p_job uuid, p_lease uuid, p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.remediation_jobs
     where id = p_job and kind = 'delete_account' and status = 'processing'
       and lease_id = p_lease and locked_until > now()
       and payload->>'user_id' = p_user::text
  );
$$;

revoke all on function private.account_deletion_lease_held(uuid, uuid, uuid) from public, anon, authenticated;

-- Asked before the ban and straight after it, under the deletion lock and the
-- job's lease. Held: says so, with the order to settle, and changes nothing
-- (the worker lifts the ban, then pauses). Clear: a case paused on an earlier
-- hold reads as cleaning up again.
create or replace function public.account_deletion_hold_gate(p_job uuid, p_lease uuid, p_user uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_blockers jsonb;
begin
  perform pg_advisory_xact_lock(private.account_deletion_lock_key(p_user));
  if not private.account_deletion_lease_held(p_job, p_lease, p_user) then
    raise exception 'Deletion lease lost';
  end if;

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

-- The last check after cleanup, and the outcome with it, in one transaction
-- under the deletion lock: no hold can commit between them. Held: as the
-- gate. Retained identity: records p_retained (the worker's wording) as
-- operator_attention and finishes the job here. Otherwise the account can be
-- deleted outright; the worker does that (Stripe and Auth calls) and finishes
-- the job itself. Such an account has no orders, so no hold can name it.
create or replace function public.account_deletion_finalise(p_job uuid, p_lease uuid, p_user uuid, p_retained jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_blockers jsonb;
begin
  perform pg_advisory_xact_lock(private.account_deletion_lock_key(p_user));
  if not private.account_deletion_lease_held(p_job, p_lease, p_user) then
    raise exception 'Deletion lease lost';
  end if;

  v_blockers := public.account_deletion_blockers(p_user);
  if coalesce((v_blockers->>'financial_hold')::boolean, true) then
    return v_blockers || jsonb_build_object('held', true, 'hold_order_id', private.account_deletion_hold_order(p_user));
  end if;

  if coalesce((v_blockers->>'retained_identity')::boolean, true) then
    if p_retained is null or jsonb_typeof(p_retained) <> 'object' or coalesce(p_retained->>'next_action', '') = '' then
      raise exception 'The retained-identity record is required' using errcode = '22023';
    end if;
    update public.account_deletion_requests
       set outcome = 'operator_attention',
           blocker_code = p_retained->>'blocker_code',
           affected_data_classes = array(select jsonb_array_elements_text(coalesce(p_retained->'affected_data_classes', '[]'::jsonb))),
           next_action = p_retained->>'next_action',
           responsible_owner = p_retained->>'responsible_owner',
           review_at = null,
           policy_decisions_pending = array(select jsonb_array_elements_text(coalesce(p_retained->'policy_decisions_pending', '[]'::jsonb))),
           hold_order_id = null,
           updated_at = now()
     where user_id = p_user;
    if not found then raise exception 'Deletion request record is missing'; end if;
    perform public.finish_remediation_job(p_job, p_lease, null);
    return v_blockers || jsonb_build_object('held', false, 'outcome', 'operator_attention');
  end if;

  return v_blockers || jsonb_build_object('held', false, 'outcome', 'hard_delete_eligible');
end $$;

revoke all on function public.account_deletion_finalise(uuid, uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.account_deletion_finalise(uuid, uuid, uuid, jsonb) to service_role;

-- A hold that appeared after the worker finished (or gave up on) a member's
-- case puts it back in the queue, paused on the hold: the worker's next pass
-- lifts the ban. Cases still in the queue meet the hold at their next check.
-- A case whose account is gone ('completed') has nothing to restore.
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
     set outcome = 'temporary_financial_hold', blocker_code = 'active_financial_obligations',
         affected_data_classes = array['orders', 'returns', 'refunds', 'payouts'],
         hold_order_id = v_order,
         next_action = case
           when v_order is not null then
             'Settle order ' || upper(left(v_order::text, 8)) || ' first. The privacy worker carries on by itself once it settles.'
           else 'Finish the checkout in progress first. The privacy worker carries on by itself once it settles.'
         end,
         responsible_owner = 'account owner', completed_at = null, updated_at = now()
   where user_id = p_user and outcome <> 'completed';
end $$;

revoke all on function private.requeue_account_deletion_for_hold(uuid) from public, anon, authenticated;

-- Deferred to commit: for each member the new hold involves who has a
-- deletion request, wait for any deletion check in progress (the shared side
-- of the deletion lock), then requeue a finished case. Members are visited in
-- id order, so two such commits can never wait on each other.
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

-- Each fires only for a row whose new state is a hold, with the same
-- predicates as account_deletion_blockers.
drop trigger if exists account_deletion_hold_watch on public.orders;
create constraint trigger account_deletion_hold_watch
  after insert or update of status, buyer_id, seller_id on public.orders
  deferrable initially deferred
  for each row
  when (new.status not in ('completed', 'cancelled', 'payment_failed', 'refunded'))
  execute function private.account_deletion_hold_appeared();

drop trigger if exists account_deletion_hold_watch on public.returns;
create constraint trigger account_deletion_hold_watch
  after insert or update of status on public.returns
  deferrable initially deferred
  for each row
  when (new.status not in ('completed', 'rejected', 'expired', 'cancelled'))
  execute function private.account_deletion_hold_appeared();

drop trigger if exists account_deletion_hold_watch on public.refund_operations;
create constraint trigger account_deletion_hold_watch
  after insert or update of status on public.refund_operations
  deferrable initially deferred
  for each row
  when (new.status <> 'completed')
  execute function private.account_deletion_hold_appeared();

drop trigger if exists account_deletion_hold_watch on public.payment_recoveries;
create constraint trigger account_deletion_hold_watch
  after insert or update of status on public.payment_recoveries
  deferrable initially deferred
  for each row
  when (new.status = 'open')
  execute function private.account_deletion_hold_appeared();

drop trigger if exists account_deletion_hold_watch on public.transfer_intents;
create constraint trigger account_deletion_hold_watch
  after insert or update of status on public.transfer_intents
  deferrable initially deferred
  for each row
  when (new.status not in ('transferred', 'cancelled'))
  execute function private.account_deletion_hold_appeared();

drop trigger if exists account_deletion_hold_watch on public.payment_requests;
create constraint trigger account_deletion_hold_watch
  after insert on public.payment_requests
  deferrable initially deferred
  for each row
  when (new.provider_reference is null)
  execute function private.account_deletion_hold_appeared();

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

-- From 20260905130250. A member whose deletion is paused on a hold has
-- sign-in back to settle it, so their writes go through again; while cleanup
-- runs (or after) they are still refused.
create or replace function public.block_deleted_account_writes() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if auth.uid() is not null
    and exists(select 1 from public.remediation_jobs where dedup_key='delete:'||auth.uid())
    and not exists(select 1 from public.account_deletion_requests where user_id=auth.uid() and outcome='temporary_financial_hold') then
 raise exception 'Account deletion is pending' using errcode='42501'; end if;
 return null;
end $$;
revoke all on function public.block_deleted_account_writes() from public,anon,authenticated;

notify pgrst, 'reload schema';
commit;
