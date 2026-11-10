-- ============================================================================
-- 20261110180000 — write off a chargeback held for review, after 90 days
-- (report five #108, part B; the reviewer's rule on #207, 10 Nov 2026)
--
-- The rule (the plan's default, built to it and on Needs Neil to confirm):
-- DRVN funds a chargeback up front, recovers it from the seller, and writes it
-- off after 90 days of failed recovery, logged. A write-off is DRVN absorbing
-- a loss the bank already took:
--   * Stripe's dispute must be closed as lost: the newest event seen while
--     the chargeback was held is a charge.dispute.closed whose status is
--     'lost'. Anything else is refused.
--   * 90 days after the recovery case opened, by the database's clock
--     (exactly 90 days is allowed).
--   * The order's payout is never released: every transfer intent not yet
--     paid is cancelled, a worker's claimed-but-unsent one included; one
--     that may already be at Stripe must be reconciled first (refused). A payout already made before the chargeback stays made; DRVN
--     absorbs it. The orders end as a lost chargeback's do: refunded in full
--     (the bank returned the buyer's money), the dispute resolved.
--   * The loss is a ledger row against the platform
--     (public.platform_chargeback_losses): the amount the bank took, and how
--     much of it was withheld from the seller.
--   * The recovery case closes as written off; the journal entry becomes
--     'written_off'. Only then does account deletion unfreeze. The seller's
--     other orders are untouched.
-- 'written_off' is terminal everywhere: one list, private.dispute_terminal_states(),
-- used by the SQL below and mirrored by src/lib/payments/dispute-terminal.ts
-- (a test checks they agree), and in apply_stripe_dispute_event a later event
-- on a written-off entry changes nothing.
--
-- worker_health_snapshot is not restated: it reads transfer intents, and a
-- written-off order's unpaid intents are cancelled, so none is left to look
-- overdue or to shelve.
--
-- Restated with only the terminal list replaced by
-- private.dispute_terminal_states():
--   private.order_has_unresolved_chargeback   from 20261107130000_chargeback_freezes_payout.sql
--   public.account_deletion_blockers          from 20261108140000_chargeback_holds_deletion.sql
--   private.account_deletion_hold_order       from 20261108140000_chargeback_holds_deletion.sql
--   the account_deletion_hold_watch trigger   from 20261108140000_chargeback_holds_deletion.sql
-- and, from 20261110170000, public.apply_stripe_dispute_event with only the
-- written-off line added and public.release_refused_dispute_retry with the
-- write-off added to its actions. Idempotent.
-- ============================================================================

begin;

alter table public.stripe_dispute_journal drop constraint if exists stripe_dispute_journal_state_check;
alter table public.stripe_dispute_journal add constraint stripe_dispute_journal_state_check
  check (state in ('open', 'won', 'warning_closed', 'loss_pending', 'lost', 'recovery', 'written_off'));

-- The settled states. src/lib/payments/dispute-terminal.ts mirrors this list.
create or replace function private.dispute_terminal_states()
returns text[]
language sql
immutable
set search_path = pg_catalog, pg_temp
as $$
  select array['won', 'warning_closed', 'lost', 'written_off']::text[];
$$;
revoke all on function private.dispute_terminal_states() from public, anon, authenticated;

create or replace function private.order_has_unresolved_chargeback(p_order uuid)
returns boolean
language sql
stable
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.stripe_dispute_journal j
    where j.order_ids @> array[p_order]
      and not (j.state = any(private.dispute_terminal_states()))
  );
$$;

revoke all on function private.order_has_unresolved_chargeback(uuid) from public, anon, authenticated;

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
      or exists(select 1 from public.stripe_dispute_journal j join public.orders o on o.id=any(j.order_ids) where not (j.state = any(private.dispute_terminal_states())) and (o.buyer_id=p_user or o.seller_id=p_user)),
    'retained_identity',
      exists(select 1 from public.orders where buyer_id=p_user or seller_id=p_user)
      or exists(select 1 from public.admin_audit_log where actor_id=p_user)
      or exists(select 1 from public.reports where reporter_id=p_user or resolved_by=p_user)
      or exists(select 1 from public.refund_operations where requested_by=p_user::text)
  );
$$;
revoke all on function public.account_deletion_blockers(uuid) from public,anon,authenticated;
grant execute on function public.account_deletion_blockers(uuid) to service_role;

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
       where not (j.state = any(private.dispute_terminal_states()))
         and (o.buyer_id = p_user or o.seller_id = p_user)
    ) h
   order by h.created_at, h.order_id
   limit 1;
$$;

revoke all on function private.account_deletion_hold_order(uuid) from public, anon, authenticated;

drop trigger if exists account_deletion_hold_watch on public.stripe_dispute_journal;
create constraint trigger account_deletion_hold_watch
  after insert or update of state, order_ids on public.stripe_dispute_journal
  deferrable initially deferred
  for each row
  when (not (new.state = any(private.dispute_terminal_states())))
  execute function private.account_deletion_hold_appeared();


create or replace function public.apply_stripe_dispute_event(
 p_dispute text,p_intent text,p_amount integer,p_currency text,p_status text,
 p_closed boolean,p_event text,p_created bigint,p_lease uuid
) returns text language plpgsql security definer set search_path=public,pg_temp as $$
declare entry public.stripe_dispute_journal%rowtype; ids uuid[]; total bigint;
 valid boolean; order_row public.orders%rowtype; prior_exists boolean;
begin
 if p_closed is null then raise exception 'Missing dispute event phase'; end if;
 if p_closed and (p_status in ('won','warning_closed','lost')) is distinct from true then return 'retry'; end if;
 if p_dispute is null or p_intent is null or p_event is null or p_lease is null or p_created is null or p_amount<=0 or p_currency!~'^[a-z]{3}$' then raise exception 'Invalid dispute event'; end if;
 perform pg_advisory_xact_lock(hashtextextended('stripe-dispute:'||p_intent,0));
 select * into entry from public.stripe_dispute_journal where dispute_id=p_dispute for update;
 prior_exists:=found;
 if prior_exists then
  -- 20261110180000: written off is terminal. Any later event, matching or
  -- not, changes nothing: no hold, no re-dispute, no booking.
  if entry.state='written_off' then return 'committed'; end if;
  if entry.payment_reference<>p_intent or entry.amount_cents<>p_amount or entry.currency<>p_currency then return public.hold_stripe_dispute(p_dispute,p_event,p_created,'Provider dispute identity, amount or currency changed. Reconcile against the original journal.'); end if;
  -- 20261110170000: a later event while held is remembered, so Retry
  -- replays the newest Stripe knows.
  if entry.state='recovery' then perform private.note_held_dispute_event(p_dispute,p_event,p_created); return 'recovery_recorded'; end if;
  if not p_closed and entry.state<>'open' then return 'committed'; end if;
  if p_closed and entry.state in ('won','warning_closed','lost') then
   if entry.state=p_status then return 'committed'; end if;
   return public.hold_stripe_dispute(p_dispute,p_event,p_created,'Conflicting terminal provider dispute outcomes require review.');
  end if;
  if entry.state='loss_pending' and p_closed and p_status<>'lost' then return public.hold_stripe_dispute(p_dispute,p_event,p_created,'Conflicting terminal outcome during chargeback booking.'); end if;
  if entry.state='loss_pending' and entry.lease_expires_at>now() then return 'retry'; end if;
  if not p_closed and p_created<=entry.last_event_created then return 'committed'; end if;
 end if;
 select array_agg(distinct p.order_id order by p.order_id),sum(p.amount_cents),
 bool_and(lower(p.currency)=p_currency and p.status in ('succeeded','partially_refunded','refunded'))
 into ids,total,valid from public.payments p where p.provider='stripe' and p.provider_reference=p_intent;
 if ids is null then return 'retry'; end if;
 -- 20261107130000: the basket's orders are locked before any journal write
 -- below (the insert, or hold_stripe_dispute), in the order dispatch uses.
 perform 1 from public.orders where id=any(ids) order by id for update;
 if not prior_exists then
  insert into public.stripe_dispute_journal(dispute_id,payment_reference,amount_cents,currency,state,last_event_id,last_event_created,order_ids)
  values(p_dispute,p_intent,p_amount,p_currency,'open',p_event,p_created,ids)
  returning * into entry;
 end if;
 if cardinality(ids)>50 then return public.hold_stripe_dispute(p_dispute,p_event,p_created,'Dispute basket exceeds the bounded automatic-processing limit.'); end if;
 if ids is distinct from entry.order_ids or total<>p_amount or valid is distinct from true then
  return public.hold_stripe_dispute(p_dispute,p_event,p_created,'The dispute does not exactly match the frozen payment basket and currency. Allocate the provider amount before booking any refund.');
 end if;
 perform id from public.orders where id=any(ids) order by id for update;
 if (select sum(total_cents) from public.orders where id=any(ids))<>p_amount or exists(select 1 from public.orders o where o.id=any(ids) and lower(o.currency)<>p_currency) then
  return public.hold_stripe_dispute(p_dispute,p_event,p_created,'Order and provider dispute currencies differ.');
 end if;
 if p_closed and p_status not in ('won','warning_closed','lost') then return 'retry'; end if;
 -- Won/closed-before-created is journaled without inventing a prior hold.
 if p_closed and p_status in ('won','warning_closed') then
  if exists(select 1 from public.orders o where o.id=any(ids) and o.status='disputed' and o.stripe_dispute_id=p_dispute and o.dispute_reason not like '% — '||p_dispute) then
   return public.hold_stripe_dispute(p_dispute,p_event,p_created,'A newer in-app dispute owns an order; provider closure cannot resolve it.');
  end if;
  update public.orders set status=coalesce(pre_dispute_status,'paid'),dispute_resolved_at=now()
   where id=any(ids) and status='disputed' and stripe_dispute_id=p_dispute
   and dispute_reason like '% — '||p_dispute;
  update public.stripe_dispute_journal set state=p_status,last_event_id=p_event,last_event_created=p_created,updated_at=now() where dispute_id=p_dispute;
  return 'committed';
 end if;
 if exists(select 1 from public.orders o where o.id=any(ids) and (
  (o.status='disputed' and o.stripe_dispute_id is distinct from p_dispute)
  or (o.status not in ('paid','shipped','delivered','completed','disputed') and entry.state<>'loss_pending')
  or (p_status='lost' and p_closed and o.refunded_cents>0 and entry.state<>'loss_pending')
 )) then return public.hold_stripe_dispute(p_dispute,p_event,p_created,'Existing order/dispute/refund state prevents safe automatic chargeback allocation.'); end if;
 for order_row in select * from public.orders where id=any(ids) loop
  if order_row.status<>'disputed' and entry.state<>'loss_pending' then
   update public.orders set status='disputed',pre_dispute_status=order_row.status,
    disputed_at=now(),dispute_resolved_at=null,dispute_outcome=null,dispute_category='other',
    dispute_reason='Card dispute via Stripe — '||p_dispute,stripe_dispute_id=p_dispute
   where id=order_row.id;
  end if;
 end loop;
 update public.stripe_dispute_journal set state=case when p_closed then 'loss_pending' else 'open' end,
 last_event_id=p_event,last_event_created=p_created,
 lease_id=case when p_closed then p_lease else null end,
 lease_expires_at=case when p_closed then now()+interval '5 minutes' else null end,updated_at=now()
 where dispute_id=p_dispute;
 return case when p_closed then 'apply_loss' else 'committed' end;
end $$;
revoke all on function public.apply_stripe_dispute_event(text, text, integer, text, text, boolean, text, bigint, uuid) from public, anon, authenticated;
grant execute on function public.apply_stripe_dispute_event(text, text, integer, text, text, boolean, text, bigint, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- The platform's loss
-- ---------------------------------------------------------------------------
create table if not exists public.platform_chargeback_losses (
  dispute_id text primary key references public.stripe_dispute_journal (dispute_id),
  order_ids uuid[] not null,
  amount_cents integer not null check (amount_cents > 0),
  currency text not null,
  -- Of the amount, what the seller was never paid (cancelled payouts).
  withheld_from_seller_cents integer not null check (withheld_from_seller_cents >= 0),
  recovery_id uuid,
  recorded_by uuid not null,
  note text not null,
  created_at timestamptz not null default now()
);
alter table public.platform_chargeback_losses enable row level security;
revoke all on table public.platform_chargeback_losses from public, anon, authenticated;
grant select, insert on table public.platform_chargeback_losses to service_role;
comment on table public.platform_chargeback_losses is
  'Chargebacks DRVN wrote off and absorbed (20261110180000, #108): one row per dispute. Service role only.';

-- ---------------------------------------------------------------------------
-- Write off (service role; the console calls it through auditedAction)
-- ---------------------------------------------------------------------------
create or replace function public.admin_write_off_dispute_recovery(p_dispute text, p_actor uuid, p_note text, p_dry_run boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_entry public.stripe_dispute_journal%rowtype;
  v_case public.payment_recoveries%rowtype;
  v_event jsonb;
  v_withheld integer;
  v_cancelled integer;
  v_orders integer;
begin
  perform public.assert_admin_actor(p_actor);
  if p_note is null or length(btrim(p_note)) < 1 then raise exception 'A note is required' using errcode = '22023'; end if;
  select * into v_entry from public.stripe_dispute_journal where dispute_id = p_dispute for update;
  if not found then raise exception 'No such chargeback' using errcode = 'P0002'; end if;
  if v_entry.state <> 'recovery' then
    raise exception 'This chargeback isn''t held for review (it is %)', v_entry.state using errcode = '22023';
  end if;
  select w.payload into v_event from public.webhook_events w where w.id = v_entry.held_event_id;
  if v_event is null or v_event ->> 'type' is distinct from 'charge.dispute.closed' or v_event #>> '{data,object,status}' is distinct from 'lost' then
    raise exception 'Stripe hasn''t closed this dispute as lost, so there is no loss to write off. Retry it, or wait for Stripe''s decision'
      using errcode = '22023';
  end if;
  perform 1 from public.orders where id = any(v_entry.order_ids) order by id for update;
  select * into v_case from public.payment_recoveries where recovery_key = 'stripe:dispute:' || p_dispute for update;
  if not found then raise exception 'This chargeback has no recovery case' using errcode = 'P0002'; end if;
  if v_case.created_at + interval '90 days' > now() then
    raise exception 'A chargeback can be written off 90 days after its recovery case opened (on %)', (v_case.created_at + interval '90 days')::date
      using errcode = '22023';
  end if;
  -- A payout that may already be at Stripe is reconciled first: writing off
  -- under it could pay the seller for money the bank took.
  if exists (select 1 from public.transfer_intents t
              where t.order_id = any(v_entry.order_ids) and t.provider_call_may_have_occurred
                and t.status not in ('transferred', 'cancelled')) then
    raise exception 'A payout for this order may already be at Stripe. Reconcile it (Admin → Payments, stuck payouts) before writing the chargeback off'
      using errcode = '22023';
  end if;
  -- Every payout not yet made, including one a worker has claimed but not
  -- sent (processing, no provider call): none of it is ever paid.
  select coalesce(sum(t.amount_cents), 0)::integer into v_withheld
    from public.transfer_intents t
   where t.order_id = any(v_entry.order_ids) and t.status not in ('transferred', 'cancelled');

  if coalesce(p_dry_run, false) then
    return jsonb_build_object('dispute_id', p_dispute, 'written_off', false,
      'before', jsonb_build_object('state', v_entry.state, 'amount_cents', v_entry.amount_cents, 'currency', v_entry.currency,
        'order_ids', to_jsonb(v_entry.order_ids), 'case_id', v_case.id, 'case_opened', v_case.created_at,
        'withheld_from_seller_cents', v_withheld, 'held_event_id', v_entry.held_event_id));
  end if;

  -- The seller is never paid for these orders.
  update public.transfer_intents
     set status = 'cancelled', last_error = 'Chargeback written off: the bank took this payment, so it is not paid out', updated_at = now()
   where order_id = any(v_entry.order_ids) and status not in ('transferred', 'cancelled');
  get diagnostics v_cancelled = row_count;
  -- As a lost chargeback ends: refunded in full by the bank, dispute resolved.
  update public.orders
     set status = 'refunded', refunded_cents = total_cents, dispute_outcome = 'admin_resolved', dispute_resolved_at = now()
   where id = any(v_entry.order_ids) and status = 'disputed' and stripe_dispute_id = p_dispute;
  get diagnostics v_orders = row_count;
  insert into public.platform_chargeback_losses (dispute_id, order_ids, amount_cents, currency, withheld_from_seller_cents, recovery_id, recorded_by, note)
  values (p_dispute, v_entry.order_ids, v_entry.amount_cents, v_entry.currency, v_withheld, v_case.id, p_actor, left(p_note, 2000));
  update public.stripe_dispute_journal set state = 'written_off', lease_id = null, lease_expires_at = null, updated_at = now()
   where dispute_id = p_dispute;
  update public.payment_recoveries
     set status = 'written_off', resolved_by = p_actor, resolved_at = now(), resolution_note = left(p_note, 2000)
   where id = v_case.id and status = 'open';
  return jsonb_build_object('dispute_id', p_dispute, 'written_off', true, 'payouts_cancelled', v_cancelled,
    'orders_closed', v_orders, 'withheld_from_seller_cents', v_withheld, 'amount_cents', v_entry.amount_cents);
end;
$$;
revoke all on function public.admin_write_off_dispute_recovery(text, uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.admin_write_off_dispute_recovery(text, uuid, text, boolean) to service_role;

-- A refused write-off is released the same way as a refused retry, while
-- the chargeback is still held. From 20261110170000, with only the action
-- list widened.
create or replace function public.release_refused_dispute_retry(p_actor uuid, p_operation uuid, p_detail text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_req public.admin_audit_log;
  v_state text;
begin
  perform public.assert_admin_actor(p_actor);
  select * into v_req from public.admin_audit_log a
   where a.metadata->>'operationId' = p_operation::text
     and a.metadata->>'phase' = 'requested'
     and a.action in ('recovery.retry_dispute', 'recovery.write_off_dispute')
     and a.actor_id = p_actor
   order by a.id limit 1;
  if not found then raise exception 'No such retry or write-off from this admin' using errcode = 'P0002'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_req.action || ':' || v_req.subject_id::text, 0));
  if exists (select 1 from public.admin_audit_log a
              where a.metadata->>'operationId' = p_operation::text
                and a.metadata->>'phase' in ('completed', 'reconciled')) then
    return jsonb_build_object('released', false, 'status', 'already_resolved');
  end if;
  select j.state into v_state from public.stripe_dispute_journal j where j.dispute_id = v_req.metadata->>'disputeId';
  if v_state is distinct from 'recovery' then
    return jsonb_build_object('released', false, 'status', 'not_held', 'state', v_state);
  end if;
  insert into public.admin_audit_log(actor_id, action, subject_type, subject_id, order_id, reason, metadata)
  values (p_actor, 'operation.reconcile', v_req.subject_type, v_req.subject_id, v_req.order_id,
    left(coalesce(nullif(trim(p_detail), ''), 'Retry refused'), 4000),
    jsonb_build_object('operationId', p_operation::text, 'phase', 'reconciled', 'outcome', 'not_applied',
      'reconciles', v_req.action,
      'evidence', jsonb_build_object('source', 'refusal', 'detail', left(coalesce(p_detail, ''), 1000), 'journalState', v_state, 'observedAt', now())));
  return jsonb_build_object('released', true, 'status', 'resolved');
end;
$$;
revoke all on function public.release_refused_dispute_retry(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.release_refused_dispute_retry(uuid, uuid, text) to service_role;

do $$
begin
  if has_function_privilege('authenticated', 'public.admin_write_off_dispute_recovery(text, uuid, text, boolean)', 'execute')
     or has_table_privilege('authenticated', 'public.platform_chargeback_losses', 'select') then
    raise exception '20261110180000: a member can reach the chargeback write-off';
  end if;
  raise notice 'PASS: 20261110180000 self-checks';
end $$;

notify pgrst, 'reload schema';
commit;
