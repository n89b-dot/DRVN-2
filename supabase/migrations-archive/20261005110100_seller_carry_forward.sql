-- 20261005110100 — seller charges a payout couldn't cover carry forward.
--
-- Label costs DRVN pays on a seller's behalf (seller_adjustments, negative)
-- were only ever collected by netting them out of that same order's transfer.
-- Two cases slipped through, and the ledger then showed sellers less than
-- they had received:
--   - an order fully refunded before its payout: settle_refund_operation
--     cancels the transfer intent, so nothing is netted (and a partial refund
--     plus labels larger than what's left cancels it the same way);
--   - a charge recorded after the order's transfer (a seller-paid return
--     label): the transfer had already gone.
--
-- What's added:
--
-- 1. seller_carry_entries — an append-only, per-seller ledger of charges an
--    order's own payout didn't settle and of their collection. Negative is
--    owed by the seller, positive is collected or credited back. Every row
--    has a unique entry_key, so each fact is recorded exactly once however
--    often its trigger or function runs. The seller's outstanding balance is
--    -(sum), when positive. Written only by the functions below.
--      uncollected          a cancelled payout's shortfall: the seller's
--                           share left after refunds plus the order's live
--                           adjustments, when below zero
--      late_adjustment      an adjustment recorded after its order's payout
--                           was final (transferred or cancelled), either sign
--      adjustment_void      the reversal of an adjustment voided after then
--      uncollected_reversed a cancelled payout that went through after all
--                           (complete_transfer_intent's in-flight case)
--      collected            the amount a later transfer kept back
--      reversal_shortfall   what a capped reversal couldn't take back (see 4)
--
-- 2. Collection. The transfer worker asks freeze_transfer_carry how much of
--    the outstanding balance to keep back from the transfer it is about to
--    make: at most the balance less what other unfinished transfers have
--    already reserved, and always leaving at least 1¢ so the payout is still
--    a transfer through the one transfer path. The amount is frozen on the
--    intent (dispatch_carry_cents) before the dispatch and never changes once
--    a provider call may have happened. The `collected` entry is written in
--    the transaction that marks the intent transferred; until then the
--    reservation stops a concurrent transfer from collecting the same money.
--    Reservations, entries and freezes for one seller serialise on one
--    advisory lock, so no amount is collected twice. complete_transfer_intent
--    allows for the frozen amount when it checks the payable amount.
--    A credit (a label refunded after the payout) only offsets what is owed;
--    nothing here pays a positive balance out.
--
-- 3. Recording. Triggers on transfer_intents (status) and seller_adjustments
--    (insert, void) record the entries in 1. They take a per-order advisory
--    lock, so an adjustment racing a cancellation is counted by exactly one
--    of them. An adjustment inserted while a transfer is mid-dispatch is not
--    carried: complete_transfer_intent already opens a recovery for that
--    difference.
--
-- 4. Reversals. settle_refund_operation reversed the seller's proportional
--    share of a refund even when the transfer had sent less (labels and,
--    now, carried charges come off it); Stripe refuses a reversal larger than
--    the transfer, and the refund sat in recovery. The reversal is now capped
--    at the amount sent (dispatch_amount_cents), and what the cap leaves is
--    recorded as a reversal_shortfall: exactly the charges that transfer had
--    collected, now owed again. Transfers sent before dispatch amounts were
--    recorded keep the old, uncapped rule.
--
-- Not done here: no backfill of payouts that closed before this migration
-- (pre-launch there are no live sellers to collect from), and no paying out
-- of a positive balance.
--
-- complete_transfer_intent and settle_refund_operation are their latest
-- definitions (20260905173052 and 20260905011618) with only the lines marked
-- "20261005110100" added. Idempotent: if-not-exists, create or replace,
-- drop-then-create for triggers and policies.

begin;

-- ---------------------------------------------------------------------------
-- 1. The carry-forward ledger
-- ---------------------------------------------------------------------------

create table if not exists public.seller_carry_entries (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid references public.profiles(id) on delete set null,
  currency text not null default 'USD' check (currency = 'USD'),
  kind text not null check (kind in (
    'uncollected', 'late_adjustment', 'adjustment_void',
    'uncollected_reversed', 'collected', 'reversal_shortfall'
  )),
  amount_cents int not null check (amount_cents <> 0),
  -- The order whose charge this is (for `collected`, the order whose
  -- transfer kept it back).
  order_id uuid references public.orders(id) on delete set null,
  adjustment_id uuid references public.seller_adjustments(id) on delete set null,
  entry_key text not null unique,
  created_at timestamptz not null default now(),
  constraint seller_carry_entries_sign check (
    (kind in ('uncollected', 'reversal_shortfall') and amount_cents < 0)
    or (kind = 'collected' and amount_cents > 0)
    or kind in ('late_adjustment', 'adjustment_void', 'uncollected_reversed')
  )
);

create index if not exists seller_carry_entries_seller_idx
  on public.seller_carry_entries (seller_id, created_at);
create index if not exists seller_carry_entries_order_idx
  on public.seller_carry_entries (order_id);

alter table public.seller_carry_entries enable row level security;
drop policy if exists "seller reads own carry entries" on public.seller_carry_entries;
create policy "seller reads own carry entries" on public.seller_carry_entries
  for select using (seller_id = auth.uid() or public.is_admin());
revoke all on public.seller_carry_entries from public, anon, authenticated;
grant select on public.seller_carry_entries to authenticated;
grant all on public.seller_carry_entries to service_role;

create or replace function public.guard_seller_carry_entry_immutable()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  -- Account deletion may clear the references (on delete set null); the
  -- money columns and the key never change, and rows are never removed.
  if tg_op = 'DELETE' then
    raise exception 'seller_carry_entries rows are append-only' using errcode = '42501';
  end if;
  if new.id is distinct from old.id
     or new.kind is distinct from old.kind
     or new.amount_cents is distinct from old.amount_cents
     or new.currency is distinct from old.currency
     or new.entry_key is distinct from old.entry_key
     or new.created_at is distinct from old.created_at
     or (new.seller_id is distinct from old.seller_id and new.seller_id is not null)
     or (new.order_id is distinct from old.order_id and new.order_id is not null)
     or (new.adjustment_id is distinct from old.adjustment_id and new.adjustment_id is not null) then
    raise exception 'seller_carry_entries rows are append-only' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists seller_carry_entries_immutable on public.seller_carry_entries;
create trigger seller_carry_entries_immutable
  before update or delete on public.seller_carry_entries
  for each row execute function public.guard_seller_carry_entry_immutable();

-- The one writer. Serialises on the seller so a freeze never reads a balance
-- another transaction is about to change.
create or replace function public.record_seller_carry(
  p_seller uuid,
  p_kind text,
  p_amount int,
  p_order uuid,
  p_adjustment uuid,
  p_key text
) returns void
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if p_seller is null or p_amount is null or p_amount = 0 then
    return;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('seller-carry:' || p_seller::text, 0));
  insert into public.seller_carry_entries (seller_id, kind, amount_cents, order_id, adjustment_id, entry_key)
  values (p_seller, p_kind, p_amount, p_order, p_adjustment, p_key)
  on conflict (entry_key) do nothing;
end;
$$;

revoke all on function public.record_seller_carry(uuid, text, int, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.record_seller_carry(uuid, text, int, uuid, uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- 2. Collection
-- ---------------------------------------------------------------------------

alter table public.transfer_intents
  add column if not exists dispatch_carry_cents int;
alter table public.transfer_intents
  drop constraint if exists transfer_intents_dispatch_carry_check;
alter table public.transfer_intents
  add constraint transfer_intents_dispatch_carry_check
  check (dispatch_carry_cents is null or dispatch_carry_cents >= 0);

-- What the seller owes and no unfinished transfer has reserved. A cancelled
-- intent whose provider call may have happened keeps its reservation: its
-- transfer can still complete (complete_transfer_intent's in-flight case).
create or replace function public.seller_carry_available_cents(p_seller uuid, p_except_order uuid)
returns int
language sql
stable
set search_path = public, pg_temp
as $$
  select greatest(0,
    -coalesce((select sum(e.amount_cents) from public.seller_carry_entries e where e.seller_id = p_seller), 0)
    - coalesce((
        select sum(ti.dispatch_carry_cents) from public.transfer_intents ti
         where ti.seller_id = p_seller
           and ti.order_id is distinct from p_except_order
           and ti.dispatch_carry_cents > 0
           and (ti.status not in ('transferred', 'cancelled')
                or (ti.status = 'cancelled' and ti.provider_call_may_have_occurred))
      ), 0)
  )::int;
$$;

revoke all on function public.seller_carry_available_cents(uuid, uuid) from public, anon, authenticated;
grant execute on function public.seller_carry_available_cents(uuid, uuid) to service_role;

-- Decides, under the worker's live lease, how much to keep back from this
-- transfer. Before a provider call it can be re-decided freely (nothing has
-- left DRVN); after, it returns the frozen amount. Null = lease lost.
create or replace function public.freeze_transfer_carry(
  p_order uuid,
  p_worker text,
  p_payable_cents int
) returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_intent public.transfer_intents;
  v_collect int := 0;
begin
  if p_order is null or p_worker is null or p_payable_cents is null then
    raise exception 'Invalid carry-forward freeze';
  end if;
  select * into v_intent from public.transfer_intents where order_id = p_order for update;
  if not found
     or v_intent.status <> 'processing'
     or v_intent.locked_by is distinct from p_worker
     or v_intent.lease_expires_at is null
     or v_intent.lease_expires_at <= now() then
    return null;
  end if;
  if v_intent.provider_call_may_have_occurred or v_intent.operation_key is not null then
    return coalesce(v_intent.dispatch_carry_cents, 0);
  end if;
  if v_intent.seller_id is not null and p_payable_cents > 1 then
    perform pg_advisory_xact_lock(hashtextextended('seller-carry:' || v_intent.seller_id::text, 0));
    v_collect := least(public.seller_carry_available_cents(v_intent.seller_id, p_order), p_payable_cents - 1);
  end if;
  update public.transfer_intents
     set dispatch_carry_cents = v_collect, updated_at = now()
   where order_id = p_order;
  return v_collect;
end;
$$;

revoke all on function public.freeze_transfer_carry(uuid, text, int) from public, anon, authenticated;
grant execute on function public.freeze_transfer_carry(uuid, text, int) to service_role;

-- ---------------------------------------------------------------------------
-- 3. Recording
-- ---------------------------------------------------------------------------

create or replace function public.carry_on_transfer_intent_status()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_order record;
  v_adjustments int;
  v_net int;
  v_previous int;
  v_seller uuid;
begin
  if new.status is not distinct from old.status then
    return null;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('seller-carry-order:' || new.order_id::text, 0));
  select seller_id, total_cents, refunded_cents into v_order from public.orders where id = new.order_id;
  v_seller := coalesce(new.seller_id, v_order.seller_id);

  if new.status = 'cancelled' and v_order.total_cents is not null then
    -- The same payable arithmetic as the transfer worker and
    -- complete_transfer_intent: share less the refund's share, plus labels.
    select coalesce(sum(amount_cents), 0)::int into v_adjustments
      from public.seller_adjustments
     where order_id = new.order_id and voided_at is null;
    v_net := new.amount_cents
      - case
          when v_order.total_cents <= 0 or new.amount_cents <= 0 then 0
          else least(new.amount_cents,
            round((v_order.refunded_cents::numeric * new.amount_cents) / v_order.total_cents)::int)
        end
      + v_adjustments;
    if v_net < 0 then
      perform public.record_seller_carry(v_seller, 'uncollected', v_net, new.order_id, null,
        'uncollected:' || new.order_id::text);
    end if;
  elsif old.status = 'cancelled' then
    select amount_cents into v_previous
      from public.seller_carry_entries where entry_key = 'uncollected:' || new.order_id::text;
    if found then
      perform public.record_seller_carry(v_seller, 'uncollected_reversed', -v_previous, new.order_id, null,
        'uncollected-reversed:' || new.order_id::text);
    end if;
  end if;

  if new.status = 'transferred' and coalesce(new.dispatch_carry_cents, 0) > 0 then
    perform public.record_seller_carry(v_seller, 'collected', new.dispatch_carry_cents, new.order_id, null,
      'collected:' || new.order_id::text);
  end if;
  return null;
end;
$$;

drop trigger if exists transfer_intents_seller_carry on public.transfer_intents;
-- Only the transitions that close or reopen a payout; claims and releases
-- don't take the locks.
create trigger transfer_intents_seller_carry
  after update of status on public.transfer_intents
  for each row
  when (new.status is distinct from old.status
        and (new.status in ('cancelled', 'transferred') or old.status = 'cancelled'))
  execute function public.carry_on_transfer_intent_status();

create or replace function public.carry_on_seller_adjustment()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_status text;
begin
  if new.order_id is null or new.seller_id is null then
    return null;
  end if;
  if tg_op = 'UPDATE' and not (old.voided_at is null and new.voided_at is not null) then
    return null;
  end if;
  if tg_op = 'INSERT' and new.voided_at is not null then
    return null;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('seller-carry-order:' || new.order_id::text, 0));
  select status into v_status from public.transfer_intents where order_id = new.order_id;
  if v_status is null or v_status not in ('transferred', 'cancelled') then
    return null;
  end if;
  if tg_op = 'INSERT' then
    perform public.record_seller_carry(new.seller_id, 'late_adjustment', new.amount_cents, new.order_id, new.id,
      'late:' || new.id::text);
  else
    perform public.record_seller_carry(new.seller_id, 'adjustment_void', -old.amount_cents, new.order_id, new.id,
      'void:' || new.id::text);
  end if;
  return null;
end;
$$;

drop trigger if exists seller_adjustments_carry on public.seller_adjustments;
create trigger seller_adjustments_carry
  after insert or update of voided_at on public.seller_adjustments
  for each row execute function public.carry_on_seller_adjustment();

-- ---------------------------------------------------------------------------
-- 4. Transfer completion and refund reversal
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.complete_transfer_intent(p_order uuid, p_worker text, p_operation_key text, p_transfer_reference text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_order record;
  v_intent public.transfer_intents;
  v_dispatch_amount int;
  v_operation_key text;
  v_adjustments int;
  v_current_payable int;
begin
  if p_order is null
     or p_worker is null
     or p_transfer_reference is null
     or length(p_transfer_reference) = 0 then
    raise exception 'Invalid transfer reference';
  end if;

  -- Match settle_refund_operation's order -> transfer_intent lock order. The
  -- order row lock also serializes FK-checked seller-adjustment inserts, so
  -- the payable amount below reflects every adjustment committed before this
  -- completion and cannot change until this transaction commits.
  select id, status, total_cents, platform_fee_cents, refunded_cents, transfer_reference
  into v_order
  from public.orders
  where id = p_order
  for update;
  if not found then return 'lost'; end if;

  select * into v_intent
  from public.transfer_intents
  where order_id = p_order
  for update;
  if not found then return 'lost'; end if;

  v_dispatch_amount := v_intent.dispatch_amount_cents;
  v_operation_key := v_intent.operation_key;

  if (
    v_intent.status = 'processing'
    and v_intent.locked_by = p_worker
    and v_intent.lease_expires_at > now()
    and v_intent.operation_key is not distinct from p_operation_key
  ) is not true then
    -- A full refund can cancel the intent while its owner is inside Stripe.
    -- The returned transfer is definitive evidence of the external effect, so
    -- preserve its reference and open the adjustment instead of dropping it.
    -- A processing row owned by anybody else remains untouched.
    if v_intent.status = 'cancelled'
       and v_intent.provider_call_may_have_occurred
       and v_intent.operation_key = p_operation_key
       and v_intent.transfer_reference is null then
      if v_order.transfer_reference is not null
         and v_order.transfer_reference <> p_transfer_reference then
        update public.transfer_intents
        set status = 'failed',
            attempts = greatest(attempts, 8),
            next_attempt_at = null,
            last_error = 'Order has a different transfer reference',
            locked_at = null,
            locked_by = null,
            lease_expires_at = null,
            updated_at = now()
        where order_id = p_order;

        insert into public.payment_recoveries (
          order_id, kind, recovery_key, amount_cents, detail
        ) values (
          p_order,
          'transfer_unresolved',
          'transfer-unresolved:' || p_order::text,
          coalesce(v_dispatch_amount, v_intent.amount_cents),
          'Stripe transfer ' || p_transfer_reference ||
            ' conflicts with order transfer ' || v_order.transfer_reference
        )
        on conflict (recovery_key) do update
        set last_seen_at = now(), detail = excluded.detail, status = 'open',
            resolved_by = null, resolved_at = null, resolution_note = null;
        return 'recovery';
      end if;

      update public.orders
      set transfer_reference = p_transfer_reference,
          transferred_at = coalesce(transferred_at, now())
      where id = p_order;
      update public.transfer_intents
      set status = 'transferred',
          transfer_reference = p_transfer_reference,
          last_error = null,
          next_attempt_at = null,
          locked_at = null,
          locked_by = null,
          lease_expires_at = null,
          updated_at = now()
      where order_id = p_order;
      insert into public.payment_recoveries (
        order_id, kind, recovery_key, amount_cents, detail
      ) values (
        p_order,
        'transfer_after_refund',
        'transfer-adjustment:' || v_operation_key || ':' || p_transfer_reference,
        v_dispatch_amount,
        'The order became non-payable while Stripe transfer ' ||
          p_transfer_reference || ' was in flight; reconcile the seller balance.'
      )
      on conflict (recovery_key) do update
      set last_seen_at = now(), detail = excluded.detail,
          amount_cents = excluded.amount_cents, status = 'open',
          resolved_by = null, resolved_at = null, resolution_note = null;
      return 'recovery';
    end if;
    return 'lost';
  end if;

  select coalesce(sum(amount_cents), 0)::int
  into v_adjustments
  from public.seller_adjustments
  where order_id = p_order and voided_at is null;

  v_current_payable := v_intent.amount_cents
    - case
        when v_order.total_cents <= 0 or v_intent.amount_cents <= 0 then 0
        else least(
          v_intent.amount_cents,
          round((v_order.refunded_cents::numeric * v_intent.amount_cents) /
            v_order.total_cents)::int
        )
      end
    + v_adjustments
    -- 20261005110100: the dispatch already took the frozen carry-forward
    -- collection off; compare like with like.
    - coalesce(v_intent.dispatch_carry_cents, 0);

  if v_order.transfer_reference is not null
     and v_order.transfer_reference <> p_transfer_reference then
    update public.transfer_intents
    set status = 'failed',
        attempts = greatest(attempts, 8),
        next_attempt_at = null,
        last_error = 'Order has a different transfer reference',
        locked_at = null,
        locked_by = null,
        lease_expires_at = null,
        updated_at = now()
    where order_id = p_order;

    insert into public.payment_recoveries (
      order_id, kind, recovery_key, amount_cents, detail
    ) values (
      p_order,
      'transfer_unresolved',
      'transfer-unresolved:' || p_order::text,
      coalesce(v_dispatch_amount, v_intent.amount_cents),
      'Stripe transfer ' || p_transfer_reference ||
        ' conflicts with order transfer ' || v_order.transfer_reference
    )
    on conflict (recovery_key) do update
    set last_seen_at = now(), detail = excluded.detail, status = 'open',
        resolved_by = null, resolved_at = null, resolution_note = null;
    return 'recovery';
  end if;

  update public.orders
  set transfer_reference = p_transfer_reference,
      transferred_at = coalesce(transferred_at, now())
  where id = p_order;

  update public.transfer_intents
  set status = 'transferred',
      transfer_reference = p_transfer_reference,
      last_error = null,
      next_attempt_at = null,
      locked_at = null,
      locked_by = null,
      lease_expires_at = null,
      updated_at = now()
  where order_id = p_order;

  if (v_order.status in ('delivered', 'completed')) is not true
     or (v_intent.available_at is not null and v_intent.available_at > now()) then
    insert into public.payment_recoveries (
      order_id, kind, recovery_key, amount_cents, detail
    ) values (
      p_order,
      'transfer_unresolved',
      'transfer-unresolved:' || p_order::text,
      coalesce(v_dispatch_amount, v_intent.amount_cents),
      'Stripe transfer ' || p_transfer_reference ||
        ' completed while the order was ' || v_order.status ||
        case
          when v_intent.available_at is not null and v_intent.available_at > now()
            then ' and its clearing time was still in the future'
          else ''
        end
    )
    on conflict (recovery_key) do update
    set last_seen_at = now(), detail = excluded.detail,
        amount_cents = excluded.amount_cents, status = 'open',
        resolved_by = null, resolved_at = null, resolution_note = null;
    return 'recovery';
  end if;

  if v_dispatch_amount is not null and v_current_payable <> v_dispatch_amount then
    insert into public.payment_recoveries (
      order_id, kind, recovery_key, amount_cents, detail
    ) values (
      p_order,
      'transfer_after_refund',
      'transfer-adjustment:' || v_operation_key || ':' || p_transfer_reference,
      abs(v_dispatch_amount - v_current_payable),
      'Recovered the frozen transfer amount ' || v_dispatch_amount::text ||
        ' cents while the current payable amount is ' || v_current_payable::text ||
        ' cents; reconcile the difference separately.'
    )
    on conflict (recovery_key) do update
    set last_seen_at = now(),
        detail = excluded.detail,
        amount_cents = excluded.amount_cents,
        status = 'open',
        resolved_by = null,
        resolved_at = null,
        resolution_note = null;
  end if;

  return 'completed';
end;
$function$;

CREATE OR REPLACE FUNCTION public.settle_refund_operation(p_operation_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_op        public.refund_operations;
  v_order     record;
  v_payment   record;
  v_before    int;
  v_after     int;
  v_fully     boolean;
  v_transfer  int;   -- seller share of the order (total − fee)
  v_rev_due   int;
  v_fee_after int;
  v_next      text;
  -- 20261005110100
  v_sent      int;
  v_seller    uuid;
  v_cap       int;
  v_shortfall int := 0;
begin
  select * into v_op from public.refund_operations
    where id = p_operation_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'Operation not found.');
  end if;
  if v_op.status not in ('provider_succeeded', 'effects_pending') then
    return jsonb_build_object('ok', true, 'already', true, 'status', v_op.status,
      'reversal_due_cents', coalesce(v_op.reversal_due_cents, 0),
      'fee_refunded_delta', 0);
  end if;

  select id, status, total_cents, platform_fee_cents, refunded_cents,
         platform_fee_refunded_cents, transfer_reference, pre_dispute_status,
         currency
    into v_order
    from public.orders where id = v_op.order_id
    for update;

  v_before := v_order.refunded_cents;
  v_after  := least(v_before + v_op.amount_cents, v_order.total_cents);
  v_fully  := v_after >= v_order.total_cents;

  -- Seller reversal owed, cumulative-deterministic (matches
  -- reversalShareCents in lib/payments/refunds.ts).
  v_transfer := v_order.total_cents - v_order.platform_fee_cents;
  -- 20261005110100: a transfer can't be reversed by more than was sent. Label
  -- costs and carried-forward charges came off the transfer, so the share can
  -- exceed it; Stripe refused that reversal and it sat in recovery. The
  -- reversal is now capped at the amount sent, and what the cap leaves
  -- unreversed is exactly the charges that transfer had collected — they go
  -- back on the seller's carry-forward balance (seller_carry_entries).
  -- Transfers sent before dispatch amounts were recorded keep the old rule.
  select ti.dispatch_amount_cents, ti.seller_id into v_sent, v_seller
    from public.transfer_intents ti
   where ti.order_id = v_op.order_id
     and ti.status = 'transferred'
     and ti.transfer_reference is not distinct from v_order.transfer_reference;
  v_cap := least(v_transfer, coalesce(v_sent, v_transfer));
  if v_order.transfer_reference is not null and v_transfer > 0 and v_order.total_cents > 0 then
    v_rev_due := least(v_cap, round((v_after::numeric * v_transfer) / v_order.total_cents))
               - least(v_cap, round((v_before::numeric * v_transfer) / v_order.total_cents));
    v_shortfall := (least(v_transfer, round((v_after::numeric * v_transfer) / v_order.total_cents))
                    - least(v_cap, round((v_after::numeric * v_transfer) / v_order.total_cents)))
                 - (least(v_transfer, round((v_before::numeric * v_transfer) / v_order.total_cents))
                    - least(v_cap, round((v_before::numeric * v_transfer) / v_order.total_cents)));
  else
    v_rev_due := 0;
  end if;

  v_fee_after := least(v_order.platform_fee_cents,
    round((v_after::numeric * v_order.platform_fee_cents) / greatest(v_order.total_cents, 1)));

  update public.orders o
  set refunded_cents = v_after,
      platform_fee_refunded_cents = v_fee_after,
      refunded_at = now(),
      status = case when v_op.purpose = 'late_capture' then o.status when v_fully then 'refunded'
                    when v_op.resolve_dispute and o.status = 'disputed'
                      then coalesce(v_order.pre_dispute_status, 'delivered')
                    else o.status end,
      cancelled_at = case when v_fully then now() else o.cancelled_at end,
      cancel_reason = case when v_fully then left(v_op.reason, 500) else o.cancel_reason end,
      dispute_resolved_at = case when v_op.resolve_dispute and o.status = 'disputed'
                                 then now() else o.dispute_resolved_at end,
      refund_offer_cents = case when v_op.resolve_dispute and o.status = 'disputed'
                                then null else o.refund_offer_cents end,
      refund_offered_at = case when v_op.resolve_dispute and o.status = 'disputed'
                               then null else o.refund_offered_at end,
      dispute_outcome = case when v_op.resolve_dispute and o.status = 'disputed'
                             then v_op.dispute_outcome else o.dispute_outcome end
  where o.id = v_op.order_id;

  select id, amount_cents, refunded_cents into v_payment
    from public.payments where order_id = v_op.order_id
    limit 1;
  if found then
    update public.payments
    set refunded_cents = coalesce(v_payment.refunded_cents, 0) + v_op.amount_cents,
        status = case when coalesce(v_payment.refunded_cents, 0) + v_op.amount_cents
                           >= v_payment.amount_cents
                      then 'refunded' else 'partially_refunded' end
    where id = v_payment.id;
  end if;

  if v_fully then
    update public.transfer_intents
    set status = 'cancelled', last_error = 'order fully refunded', updated_at = now()
    where order_id = v_op.order_id
      and status in ('holding', 'ready', 'blocked_unpayable', 'failed', 'processing');
  end if;

  -- 20261005110100
  if v_shortfall > 0 then
    perform public.record_seller_carry(
      v_seller, 'reversal_shortfall', -v_shortfall, v_op.order_id, null,
      'reversal-shortfall:' || p_operation_id::text);
  end if;

  v_next := case when v_rev_due > 0 then 'reversal_pending' else 'completed' end;

  update public.refund_operations
  set status = v_next,
      reversal_due_cents = v_rev_due,
      effects_completed_at = now(),
      reversal_completed_at = case when v_rev_due > 0 then null else now() end,
      updated_at = now()
  where id = p_operation_id;

  return jsonb_build_object('ok', true, 'already', false, 'status', v_next,
    'reversal_due_cents', v_rev_due,
    'transfer_reference', v_order.transfer_reference,
    'fully_refunded', v_fully,
    'refunded_after_cents', v_after,
    'fee_refunded_delta', v_fee_after - v_order.platform_fee_refunded_cents);
end;
$function$;

revoke all on function public.complete_transfer_intent(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.complete_transfer_intent(uuid, text, text, text) to service_role;
revoke all on function public.settle_refund_operation(uuid) from public, anon, authenticated;
grant execute on function public.settle_refund_operation(uuid) to service_role;

notify pgrst, 'reload schema';

commit;
