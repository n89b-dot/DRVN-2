-- 20261006100300 — a seller can read the payout date the database set.
--
-- payout_available_at() stamps transfer_intents.available_at at delivery, and
-- a date once set never moves (20261006100000). The seller's ledger didn't
-- read that date: it worked the date out again from the *current* setting.
-- The two agree only until the setting changes — and 20261006100200 changes
-- it (fixed 7 days → claim_window), so an order delivered under the old rule
-- would be shown clearing for 30 days while the database pays it after 7.
--
-- transfer_intents is admin-read only, and most of its columns (leases,
-- errors, dispatch details) are not a seller's to see. This exposes just the
-- one fact the ledger states — when each of the caller's own orders becomes
-- payable — for the orders asked about. Orders with no date yet (not
-- delivered, or no transfer intent) are simply absent.
--
-- Idempotent. Additive: nothing existing changes.

begin;

create or replace function public.seller_payout_dates(p_orders uuid[])
returns table (order_id uuid, available_at timestamptz)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select t.order_id, t.available_at
    from public.transfer_intents t
    join public.orders o on o.id = t.order_id
   where t.order_id = any (p_orders)
     and o.seller_id = (select auth.uid())
     and t.available_at is not null;
$$;

revoke all on function public.seller_payout_dates(uuid[]) from public, anon, authenticated;
grant execute on function public.seller_payout_dates(uuid[]) to authenticated, service_role;

do $$
begin
  if has_function_privilege('anon', 'public.seller_payout_dates(uuid[])', 'execute') then
    raise exception 'SELF-CHECK FAILED: seller_payout_dates is callable signed out';
  end if;
  if not has_function_privilege('authenticated', 'public.seller_payout_dates(uuid[])', 'execute') then
    raise exception 'SELF-CHECK FAILED: a signed-in seller cannot call seller_payout_dates';
  end if;
end $$;

notify pgrst, 'reload schema';

commit;
