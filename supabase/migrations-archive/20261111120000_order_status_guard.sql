-- Architecture remediation plan 2, item A2, second of two: the database
-- refuses any change to an order's status that is not in its transition
-- table, whoever makes it.
--
-- Until now the rules lived in each function that moves an order (and, until
-- 20261111110000, in the application's own updates). Nothing stopped a new
-- function, a script or a hand-written statement from moving an order
-- anywhere. This adds:
--
--   private.order_status_transitions   the legal moves, one row each, with the
--                                      functions that make them (the owners).
--                                      src/lib/domain/states.ts ORDER_TRANSITIONS
--                                      must equal it (tests/ci), and
--                                      docs/site/domain-states.md is generated
--                                      from that.
--   public.order_status_change_problem the judge: given the old and new
--                                      status and pre_dispute_status, why the
--                                      change is refused, or null.
--   public.guard_order_status          the trigger function, on every UPDATE of
--                                      public.orders that changes status or
--                                      pre_dispute_status, for every role.
--                                      INSERTs are not judged (an order is
--                                      created in its first state; guards and
--                                      fixtures insert in any state).
--   private.order_status_overrides     the audit of the one escape hatch.
--
-- The rules the judge applies:
--   1. A status moves only along a row of the table.
--   2. Entering disputed records where the order was: the new
--      pre_dispute_status must be the old status.
--   3. Leaving disputed goes back to pre_dispute_status, or to refunded. (When
--      no pre_dispute_status was recorded the functions fall back to paid,
--      apply_stripe_dispute_event, or delivered, the others; both are allowed
--      then.)
--   4. While an order stays disputed, its pre_dispute_status moves only along
--      a row of the table (tracking or a pickup during the case).
--
-- The escape hatch: `set local drvn.order_status_override = '<reason>'`.
-- Honoured only when BOTH current_user and session_user are postgres or
-- supabase_admin (a migration run by the runner, an operator's own session),
-- so the server key reaching a security-definer function that sets it is
-- refused (session_user authenticator). Scheduled jobs run with session_user
-- postgres and could reach it; no scheduled job sets it, and the guard
-- supabase/tests/order_status_guard_guard.sql checks that no job's command
-- does. Each change made under it is written to private.order_status_overrides
-- in the same transaction (old, new, reason, both roles, time).
-- docs/production-runbook.md says when to use it.
--
-- The trigger function is not security definer, on purpose: it must see the
-- role making the change. It reads the table through the judge, which is
-- security definer and granted to service_role (the application's server
-- key, which has no USAGE on schema private). Members never update orders
-- directly (orders has no UPDATE policy); their changes run inside
-- security-definer functions, as the function's owner.
--
-- Nothing existing changes and no row moves. Every transition the functions
-- make today is a row (measured over all SQL guards with a logging trigger,
-- and read from every function that sets orders.status).
--
-- Guard: supabase/tests/order_status_guard_guard.sql.

begin;

create table private.order_status_transitions (
  from_status text not null,
  to_status text not null,
  owners text not null,
  note text not null default '',
  primary key (from_status, to_status),
  constraint order_status_transitions_moves check (from_status <> to_status),
  constraint order_status_transitions_from check (from_status = any (array['pending', 'requires_action', 'payment_failed', 'paid', 'shipped', 'delivered', 'completed', 'cancelled', 'refunded', 'disputed'])),
  constraint order_status_transitions_to check (to_status = any (array['pending', 'requires_action', 'payment_failed', 'paid', 'shipped', 'delivered', 'completed', 'cancelled', 'refunded', 'disputed'])),
  constraint order_status_transitions_owned check (btrim(owners) <> '')
);

comment on table private.order_status_transitions is
  'The legal changes of orders.status (plan 2 A2). Enforced by public.guard_order_status on every update; src/lib/domain/states.ts ORDER_TRANSITIONS must equal it. owners: the functions that make the change.';

alter table private.order_status_transitions enable row level security;
revoke all on private.order_status_transitions from public, anon, authenticated, service_role;

insert into private.order_status_transitions (from_status, to_status, owners, note) values
  ('pending', 'paid', 'purchase_finalize', 'payment succeeded'),
  ('pending', 'payment_failed', 'purchase_finalize', 'payment failed, or the reservation expired'),
  ('pending', 'cancelled', 'settle_seller_cancellation', 'the seller cancelled before payment'),
  ('pending', 'refunded', 'settle_refund_operation', 'a full refund settled'),
  ('requires_action', 'paid', 'purchase_finalize', 'payment succeeded'),
  ('requires_action', 'payment_failed', 'purchase_finalize', 'payment failed'),
  ('requires_action', 'refunded', 'settle_refund_operation', 'a full refund settled'),
  ('payment_failed', 'refunded', 'settle_refund_operation', 'a full refund of a payment captured after the order failed'),
  ('cancelled', 'refunded', 'settle_refund_operation', 'a full refund of a payment captured after the order was cancelled'),
  ('paid', 'shipped', 'mark_order_dispatched, order_mark_shipped_from_tracking', 'dispatched'),
  ('paid', 'delivered', 'pickup_redeem', 'collected in person'),
  ('paid', 'disputed', 'open_order_dispute, hold_stripe_dispute, apply_stripe_dispute_event, execute_admin_command', 'a case or a card dispute opened'),
  ('paid', 'refunded', 'settle_refund_operation', 'a full refund settled'),
  ('shipped', 'delivered', 'mark_order_received, auto_confirm_delivery, order_mark_delivered_from_tracking', 'delivered'),
  ('shipped', 'disputed', 'open_order_dispute, hold_stripe_dispute, apply_stripe_dispute_event, execute_admin_command', 'a case or a card dispute opened'),
  ('shipped', 'refunded', 'settle_refund_operation', 'a full refund settled'),
  ('delivered', 'disputed', 'open_order_dispute, hold_stripe_dispute, apply_stripe_dispute_event, execute_admin_command', 'a case or a card dispute opened'),
  ('delivered', 'refunded', 'settle_refund_operation', 'a full refund settled'),
  ('completed', 'disputed', 'open_order_dispute, hold_stripe_dispute, apply_stripe_dispute_event, execute_admin_command', 'a case or a card dispute opened'),
  ('completed', 'refunded', 'settle_refund_operation', 'a full refund settled'),
  ('disputed', 'paid', 'apply_stripe_dispute_event, order_close_dispute, execute_admin_command, settle_refund_operation', 'only back to pre_dispute_status'),
  ('disputed', 'shipped', 'apply_stripe_dispute_event, order_close_dispute, execute_admin_command, settle_refund_operation', 'only back to pre_dispute_status'),
  ('disputed', 'delivered', 'apply_stripe_dispute_event, order_close_dispute, execute_admin_command, settle_refund_operation', 'only back to pre_dispute_status'),
  ('disputed', 'completed', 'apply_stripe_dispute_event, order_close_dispute, execute_admin_command, settle_refund_operation', 'only back to pre_dispute_status'),
  ('disputed', 'refunded', 'settle_refund_operation', 'a full refund settled');

create table private.order_status_overrides (
  id bigint generated always as identity primary key,
  order_id uuid not null,
  old_status text not null,
  new_status text not null,
  old_pre_dispute_status text,
  new_pre_dispute_status text,
  reason text not null,
  current_role_name text not null,
  session_role_name text not null,
  at timestamptz not null default now()
);

comment on table private.order_status_overrides is
  'Every change of orders.status or pre_dispute_status made under drvn.order_status_override (plan 2 A2). Written by public.guard_order_status in the same transaction.';

alter table private.order_status_overrides enable row level security;
revoke all on private.order_status_overrides from public, anon, authenticated, service_role;

create function public.order_status_change_problem(
  p_old text, p_new text, p_old_pre text, p_new_pre text
) returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  legal boolean;
begin
  if p_old is not distinct from p_new then
    -- Rule 4: an order in a case keeps its case; what it returns to may move
    -- only along the table.
    if p_old = 'disputed' and p_old_pre is distinct from p_new_pre then
      select exists (
        select 1 from private.order_status_transitions t
         where t.from_status = p_old_pre and t.to_status = p_new_pre
           and t.from_status <> 'disputed' and t.to_status not in ('disputed', 'refunded')
      ) into legal;
      if not coalesce(legal, false) then
        return format('an order in a case may not move from %s to %s underneath it', coalesce(p_old_pre, 'nothing'), coalesce(p_new_pre, 'nothing'));
      end if;
    end if;
    return null;
  end if;

  -- Rule 1.
  select exists (
    select 1 from private.order_status_transitions t
     where t.from_status = p_old and t.to_status = p_new
  ) into legal;
  if not legal then
    return format('an order''s status may not move from %s to %s', p_old, p_new);
  end if;

  -- Rule 3: leaving a case.
  if p_old = 'disputed' and p_new <> 'refunded' then
    if p_old_pre is null then
      if p_new not in ('paid', 'delivered') then
        return format('a case with no status recorded before it closes to paid or delivered, not %s', p_new);
      end if;
    elsif p_new <> p_old_pre then
      return format('a case closes back to %s, the status before it, not %s', p_old_pre, p_new);
    end if;
  end if;

  -- Rule 2: entering a case records where the order was.
  if p_new = 'disputed' and p_new_pre is distinct from p_old then
    return format('an order entering a case from %s must record %s as its status before the case, not %s', p_old, p_old, coalesce(p_new_pre, 'nothing'));
  end if;

  return null;
end;
$$;

comment on function public.order_status_change_problem(text, text, text, text) is
  'Plan 2 A2: why a change of an order''s status (and pre_dispute_status) is refused, or null when it is legal. Reads private.order_status_transitions. Called by public.guard_order_status.';

revoke all on function public.order_status_change_problem(text, text, text, text) from public, anon, authenticated;
grant execute on function public.order_status_change_problem(text, text, text, text) to service_role;

create function public.guard_order_status()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  reason text := current_setting('drvn.order_status_override', true);
  problem text;
begin
  if reason is not null and reason <> '' then
    if btrim(reason) = '' then
      raise exception 'drvn.order_status_override needs a reason (guard_order_status)'
        using errcode = '23514';
    end if;
    if current_user::text not in ('postgres', 'supabase_admin')
       or session_user::text not in ('postgres', 'supabase_admin') then
      raise exception 'drvn.order_status_override is refused for % in a session of % (guard_order_status)', current_user, session_user
        using errcode = '42501';
    end if;
    insert into private.order_status_overrides (
      order_id, old_status, new_status, old_pre_dispute_status, new_pre_dispute_status,
      reason, current_role_name, session_role_name
    ) values (
      new.id, old.status, new.status, old.pre_dispute_status, new.pre_dispute_status,
      reason, current_user::text, session_user::text
    );
    return new;
  end if;

  problem := public.order_status_change_problem(old.status, new.status, old.pre_dispute_status, new.pre_dispute_status);
  if problem is not null then
    raise exception '% (order %, guard_order_status)', problem, new.id
      using errcode = '23514';
  end if;
  return new;
end;
$$;

comment on function public.guard_order_status() is
  'Plan 2 A2: refuses a change of orders.status or pre_dispute_status that private.order_status_transitions does not allow, for every role. Not security definer: it must see current_user and session_user for drvn.order_status_override.';

revoke all on function public.guard_order_status() from public, anon, authenticated;

create trigger orders_status_transition_guard
  before update on public.orders
  for each row
  when (old.status is distinct from new.status or old.pre_dispute_status is distinct from new.pre_dispute_status)
  execute function public.guard_order_status();

commit;
