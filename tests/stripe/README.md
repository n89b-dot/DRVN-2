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
- An explicitly isolated test Supabase database is required for multi-seller settlement and late-capture compensation coverage. CI provisions its own disposable local stack.

## In CI

The `stripe-integration` job runs this suite on every change that is not a
documents-only pull request, when the repository secret
`STRIPE_TEST_SECRET_KEY` (the key of the Stripe sandbox kept for CI, so its
49 test events a run reach no other deployment) is configured, and posts a `::notice::` + summary row
saying it was skipped otherwise.

## Explicitly not covered here

Multi-seller capture and late-capture compensation are covered by the Stripe test API suite. HTTPS Payment Element/3DS browser journeys, connected-account payouts, post-transfer refunds, and provider-originated disputes still require hosted integration evidence. The browser regression suite uses explicit payment stubs; the CI summary distinguishes that coverage.
