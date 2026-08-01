-- ============================================================================
-- 0016 — Stripe Connect accounts + transfer tracking (Rev D R1: close the
-- money loop)
--
-- Two things:
--
--   1. profiles.stripe_account_id / payouts_enabled — which connected Stripe
--      account a seller's proceeds transfer to, and whether Stripe has
--      cleared that account to receive payouts (synced from account-link
--      returns and `account.updated` webhooks). `payouts_enabled` gates
--      publishing: a seller who can't be paid can't list.
--
--   2. orders.transfer_reference / transferred_at — the Stripe Transfer that
--      moved this order's net proceeds to the seller. Written by the webhook
--      on payment_intent.succeeded; the seller ledger promotes a line to
--      `paid_out` when these are set.
--
-- No RLS change: both ride the tables' existing policies. payouts_enabled is
-- written only server-side (service role) from Stripe's own account state;
-- the profiles self-update policy already restricts column-level writes at
-- the application layer, and a seller forging their own flag gains nothing —
-- transfers still require a real stripe_account_id that Stripe will pay.
--
-- Idempotent: safe to re-run.
-- ============================================================================

begin;

alter table public.profiles
  add column if not exists stripe_account_id text;

alter table public.profiles
  add column if not exists payouts_enabled boolean not null default false;

create unique index if not exists profiles_stripe_account_idx
  on public.profiles (stripe_account_id)
  where stripe_account_id is not null;

alter table public.orders
  add column if not exists transfer_reference text;

alter table public.orders
  add column if not exists transferred_at timestamptz;

commit;
