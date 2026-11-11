-- 0039 — orders.correlation_id: one identity across a transaction's lifetime.
--
-- Understanding a single purchase today means joining orders, payments,
-- webhook_events, transfer_intents and refund_operations by hand. Most of the
-- joins exist implicitly (payment intent references, order ids), but nothing
-- names the *transaction* — the one checkout that produced N orders in a
-- multi-seller basket. This column is that name.
--
-- It is written by the app at checkout time (purchaseListings /
-- completeReservedOrder stamp every order in the basket with one UUID and put
-- the same value into the Stripe PaymentIntent metadata as `correlation_id`),
-- so Stripe's dashboard, our webhook payload retention, and the admin
-- diagnostics timeline can all meet on one identifier. Deliberately NOT
-- threaded through the money RPCs: settlement, transfers and refunds continue
-- to key on order ids — this is an observability identity, never a lock.
--
-- Idempotent: guarded with IF NOT EXISTS throughout. Safe to re-run.

begin;

alter table public.orders
  add column if not exists correlation_id uuid;

comment on column public.orders.correlation_id is
  'Groups the orders of one checkout and matches the Stripe PaymentIntent metadata correlation_id. Observability only — never a money-path key.';

-- Basket lookup: every order sharing one checkout. Partial — historic rows
-- (pre-0039) stay null and cost nothing.
create index if not exists orders_correlation_id_idx
  on public.orders (correlation_id)
  where correlation_id is not null;

-- ============================================================
-- Self-checks
-- ============================================================
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'orders'
      and column_name = 'correlation_id'
  ) then
    raise exception '0039: orders.correlation_id missing';
  end if;

  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public' and indexname = 'orders_correlation_id_idx'
  ) then
    raise exception '0039: orders_correlation_id_idx missing';
  end if;

  raise notice 'PASS: 0039 self-checks';
end $$;

commit;
