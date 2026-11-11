-- 20261004140000 — a delivered order starts its payout clock, however it
-- became delivered.
--
-- Only the buyer's receipt (confirm_order_receipt, 20260905223236) set a
-- transfer intent's available_at, and mark_due_transfer_intents releases only
-- intents that have one. An order a carrier scan marked delivered
-- (apply-tracking.ts) therefore paid the seller only if the buyer also
-- pressed "received" — and a buyer who never did left the seller unpaid for
-- good. (20261004120000 fixed the same gap for collection handoffs.)
--
-- The receipt already counted the clearing window from delivered_at, not from
-- the click, so the rule doesn't change: available CLEARING_HOLD_DAYS (7,
-- src/lib/payments/ledger.ts) after delivery. A dispute inside the window
-- still holds it — release requires the order to be delivered or completed.
-- A trigger covers every path to 'delivered'; existing stranded intents are
-- backfilled from their delivered_at. Untracked shipments that never get a
-- delivery scan still wait for the buyer (an owner decision, not made here).
-- Idempotent.

begin;

create or replace function public.start_payout_clock_on_delivery()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.status = 'delivered' and old.status is distinct from 'delivered' and new.delivered_at is not null then
    update public.transfer_intents
       set available_at = coalesce(available_at, new.delivered_at + interval '7 days'),
           updated_at = now()
     where order_id = new.id
       and status = 'holding'
       and available_at is null;
  end if;
  return new;
end;
$$;

revoke all on function public.start_payout_clock_on_delivery() from public, anon, authenticated;

drop trigger if exists orders_start_payout_clock on public.orders;
create trigger orders_start_payout_clock
  after update of status on public.orders
  for each row execute function public.start_payout_clock_on_delivery();

-- Orders already delivered whose seller is still waiting on a click.
update public.transfer_intents ti
   set available_at = o.delivered_at + interval '7 days',
       updated_at = now()
  from public.orders o
 where ti.order_id = o.id
   and ti.status = 'holding'
   and ti.available_at is null
   and o.delivered_at is not null
   and o.status in ('delivered', 'completed');

commit;
