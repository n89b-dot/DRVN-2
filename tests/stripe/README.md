# Stripe test-mode integration suite

`npm run test:stripe` (config: `vitest.stripe.config.ts`).

Proves DRVN's payment layer against the **real Stripe test API**: intent
creation with DRVN metadata (order/buyer/seller/correlation ids), confirmation
with test cards, decline surfaces, partial/full refunds, refund metadata
attribution, and the per-order idempotency contract (same key → same object,
never a second charge).

## Requirements

- `STRIPE_SECRET_KEY` = an `sk_test_…` key. Read from the environment, falling
  back to `.env.local`. The suite **throws** on any non-test key and
  **self-skips with a loud warning** when no key is configured — a skip is
  reported, never faked as coverage.
- No database and no other services are needed.

## In CI

The `stripe-integration` job runs this suite when the repository secret
`STRIPE_TEST_SECRET_KEY` is configured, and posts a `::notice::` + summary row
saying it was skipped otherwise.

## Explicitly not covered here

Multi-seller settlement, transfers to connected accounts, dispute flows and
recovery paths run through the database + webhook stack; the stub-mode
golden-path E2E exercises that logic. Full Stripe-backed E2E (webhook delivery
into a disposable Supabase project) remains documented future coverage — the
CI summary says so on every build.
