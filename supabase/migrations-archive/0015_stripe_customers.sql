-- ============================================================================
-- 0015 — Stripe customer linkage (P22: saved payment methods)
--
-- One column: which Stripe Customer this profile maps to. Created lazily the
-- first time a user saves a card (checkout "save this card" or Settings →
-- Payment methods → Add a card). Card data itself never touches this
-- database — Stripe holds the payment methods; we hold only the pointer.
--
-- No RLS change: the column rides profiles' existing policies, and all
-- Stripe API calls happen server-side with the secret key.
--
-- Idempotent: safe to re-run.
-- ============================================================================

begin;

alter table public.profiles
  add column if not exists stripe_customer_id text;

create unique index if not exists profiles_stripe_customer_idx
  on public.profiles (stripe_customer_id)
  where stripe_customer_id is not null;

commit;
