-- ============================================================================
-- 20261110170000 — Retry a chargeback held for review, done right (report
-- five #108, the chargeback half; the reviewer's review of #207, part A)
--
-- A chargeback that doesn't exactly match its payment basket is held
-- (hold_stripe_dispute: journal 'recovery', orders disputed, a recovery case
-- opened). This adds the one console control that can safely move it, Retry,
-- and fixes what made a naive retry wrong:
--
--   * The event that caused the hold is recorded (held_event_id,
--     held_event_created), and so is any later event that arrives while the
--     entry is held, so Retry replays what Stripe last said, not the last
--     event that was applied (hold_stripe_dispute never moved last_event_id).
--     No event, or no stored payload: Retry refuses, saying so.
--   * The state before the hold is recorded (held_from_state). An entry that
--     was already settled (won, warning closed, lost) when a conflicting
--     event held it can't be retried: Retry must never turn a booked loss
--     into a win. Nor can one held mid-booking (loss_pending). Those stay
--     for the owner (Needs Neil).
--   * The recovery case closes by itself when the journal reaches a settled
--     outcome from an unsettled one (a replay that now matches, or the next
--     Stripe event): before, a retried chargeback that resolved left its case
--     open, holding deletion, with no console control to close it.
--   * admin_retry_dispute_recovery asserts the actor is a full admin, has a
--     dry run (the console asks first, so a refusal journals nothing), and
--     returns the state before for the audit row;
--     release_refused_dispute_retry closes a refused retry's journal entry
--     when the chargeback is still held, so the next try isn't blocked.
--
-- No new journal state. Lock order: journal, then orders, then case (as
-- hold_stripe_dispute and dispatch take them).
--
-- Restated: public.apply_stripe_dispute_event from
-- 20261107130000_chargeback_freezes_payout.sql, with only each
-- hold_stripe_dispute call given the event (8 calls) and the held
-- branch remembering a later event. New: the three journal columns, the
-- held-state trigger, private.note_held_dispute_event, the four-argument
-- public.hold_stripe_dispute, the case-closing trigger,
-- public.admin_retry_dispute_recovery, public.release_refused_dispute_retry.
-- Idempotent.
-- ============================================================================

begin;

alter table public.stripe_dispute_journal
  add column if not exists held_event_id text,
  add column if not exists held_event_created bigint,
  add column if not exists held_from_state text;

comment on column public.stripe_dispute_journal.held_event_id is
  'The newest Stripe event seen since the entry was held for review (20261110170000): what Retry replays.';
comment on column public.stripe_dispute_journal.held_from_state is
  'The state the entry was in when it was held (20261110170000). A settled one is never retried.';

-- Entering 'recovery': remember where from, and start the held event afresh.
create or replace function private.dispute_journal_held_state()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.state = 'recovery' and old.state is distinct from 'recovery' then
    new.held_from_state := old.state;
    new.held_event_id := null;
    new.held_event_created := null;
  end if;
  return new;
end;
$$;
revoke all on function private.dispute_journal_held_state() from public, anon, authenticated;

drop trigger if exists stripe_dispute_journal_held_state on public.stripe_dispute_journal;
create trigger stripe_dispute_journal_held_state
  before update of state on public.stripe_dispute_journal
  for each row execute function private.dispute_journal_held_state();

-- The newest event seen while held.
create or replace function private.note_held_dispute_event(p_dispute text, p_event text, p_created bigint)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  update public.stripe_dispute_journal
     set held_event_id = p_event, held_event_created = p_created
   where dispute_id = p_dispute and state = 'recovery' and p_event is not null
     and (held_event_created is null or p_created >= held_event_created);
$$;
revoke all on function private.note_held_dispute_event(text, text, bigint) from public, anon, authenticated;

create or replace function public.hold_stripe_dispute(p_dispute text, p_event text, p_created bigint, p_detail text)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_result text;
begin
  v_result := public.hold_stripe_dispute(p_dispute, p_detail);
  perform private.note_held_dispute_event(p_dispute, p_event, p_created);
  return v_result;
end;
$$;
revoke all on function public.hold_stripe_dispute(text, text, bigint, text) from public, anon, authenticated;
grant execute on function public.hold_stripe_dispute(text, text, bigint, text) to service_role;

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

-- A held chargeback that reaches a settled outcome closes its case.
create or replace function private.dispute_journal_close_case()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.state in ('won', 'warning_closed', 'lost') and old.state not in ('won', 'warning_closed', 'lost') then
    update public.payment_recoveries
       set status = 'recovered', resolved_at = now(),
           resolution_note = left('Closed automatically: Stripe''s outcome (' || new.state || ') was applied after the review.', 2000)
     where recovery_key = 'stripe:dispute:' || new.dispute_id and status = 'open';
  end if;
  return null;
end;
$$;
revoke all on function private.dispute_journal_close_case() from public, anon, authenticated;

drop trigger if exists stripe_dispute_journal_close_case on public.stripe_dispute_journal;
create trigger stripe_dispute_journal_close_case
  after update of state on public.stripe_dispute_journal
  for each row execute function private.dispute_journal_close_case();

-- ---------------------------------------------------------------------------
-- Retry (service role; the console calls it through auditedAction)
-- ---------------------------------------------------------------------------
create or replace function public.admin_retry_dispute_recovery(p_dispute text, p_actor uuid, p_dry_run boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_entry public.stripe_dispute_journal%rowtype;
  v_case public.payment_recoveries%rowtype;
begin
  perform public.assert_admin_actor(p_actor);
  select * into v_entry from public.stripe_dispute_journal where dispute_id = p_dispute for update;
  if not found then raise exception 'No such chargeback' using errcode = 'P0002'; end if;
  if v_entry.state <> 'recovery' then
    raise exception 'This chargeback isn''t held for review (it is %)', v_entry.state using errcode = '22023';
  end if;
  if v_entry.held_from_state in ('won', 'warning_closed', 'lost') then
    raise exception 'This chargeback was already settled as % before a conflicting Stripe event held it. Retry can''t change a settled outcome: check the dispute in Stripe and leave the case for the owner', v_entry.held_from_state
      using errcode = '22023';
  end if;
  if v_entry.held_from_state = 'loss_pending' then
    raise exception 'A loss was being booked when this chargeback was held. Retry can''t finish a booking: leave the case for the owner'
      using errcode = '22023';
  end if;
  if v_entry.held_event_id is null then
    raise exception 'No Stripe event is recorded for this hold, so there is nothing to replay. Check the dispute in Stripe; its next event is handled normally'
      using errcode = '22023';
  end if;
  if not exists (select 1 from public.webhook_events w where w.id = v_entry.held_event_id and w.payload is not null) then
    raise exception 'The Stripe event that caused this hold (%) isn''t stored, so it can''t be replayed', v_entry.held_event_id
      using errcode = '22023';
  end if;
  perform 1 from public.orders where id = any(v_entry.order_ids) order by id for update;
  select * into v_case from public.payment_recoveries where recovery_key = 'stripe:dispute:' || p_dispute for update;
  if not coalesce(p_dry_run, false) then
    update public.stripe_dispute_journal set state = 'open', lease_id = null, lease_expires_at = null, updated_at = now()
     where dispute_id = p_dispute;
  end if;
  return jsonb_build_object(
    'dispute_id', p_dispute,
    'event_id', v_entry.held_event_id,
    'reopened', not coalesce(p_dry_run, false),
    'before', jsonb_build_object(
      'state', v_entry.state, 'held_from_state', v_entry.held_from_state,
      'amount_cents', v_entry.amount_cents, 'currency', v_entry.currency, 'order_ids', to_jsonb(v_entry.order_ids),
      'last_event_id', v_entry.last_event_id, 'held_event_id', v_entry.held_event_id,
      'case_id', v_case.id, 'case_status', v_case.status));
end;
$$;
revoke all on function public.admin_retry_dispute_recovery(text, uuid, boolean) from public, anon, authenticated;
grant execute on function public.admin_retry_dispute_recovery(text, uuid, boolean) to service_role;

-- A refused retry leaves nothing to reconcile when the chargeback is still
-- held: close its journal entry so the next try isn't blocked.
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
     and a.action = 'recovery.retry_dispute'
     and a.actor_id = p_actor
   order by a.id limit 1;
  if not found then raise exception 'No such retry from this admin' using errcode = 'P0002'; end if;
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
  if has_function_privilege('authenticated', 'public.admin_retry_dispute_recovery(text, uuid, boolean)', 'execute')
     or has_function_privilege('anon', 'public.admin_retry_dispute_recovery(text, uuid, boolean)', 'execute')
     or has_function_privilege('authenticated', 'public.release_refused_dispute_retry(uuid, uuid, text)', 'execute')
     or has_function_privilege('authenticated', 'public.hold_stripe_dispute(text, text, bigint, text)', 'execute') then
    raise exception '20261110170000: a member can reach the chargeback retry';
  end if;
  raise notice 'PASS: 20261110170000 self-checks';
end $$;

notify pgrst, 'reload schema';
commit;
