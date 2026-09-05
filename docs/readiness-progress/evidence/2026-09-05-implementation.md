# Implementation evidence — 5 September 2026

Scope: the first implementation batch of the controlled invited-beta completion
plan. Local verification does not satisfy hosted staging or production acceptance.
Baseline: `d6f3be6b5baa11de4b556def2fa3f877aac0bf04`.

## Completed focused checks

| Area | Evidence | Limit |
| --- | --- | --- |
| Release reporting | 8 reporter tests; required retries/skips/empty results fail the gate | Hosted candidate runs and branch enforcement remain open |
| Search fixture reliability | 8 Chromium search tests; 20 targeted repetitions passed first attempt, zero retries | Local Chromium evidence |
| Transfer recovery | 27 worker tests; full transfer guard including atomic alert and dedup assertions | No hosted Connect acceptance |
| Shipping durability | Provider identity, terminal conflicts and partial-write replay verified; 8 provider-aware admin replay tests | No live EasyPost callback delivery |
| Fixture isolation | 15 approved-target tests | Hosted disposable-project allowlist remains empty |
| Progress artifact | Desktop/mobile and file-mode checks; zero automated WCAG A/AA violations after contrast correction | No manual assistive-technology claim |

Search repetition log SHA-256:
`098f88bf49e475e34708736a477919e73e1d23fbfdade09e8933f22461c4271c`.
Local run log: `/tmp/drvn-r04-explore-seed-repeat-20.log` (ephemeral).

## Environment decisions

The user selected `n89b-dot’s Org` for `drvn-staging`. The Supabase connector quoted
$0/month under the current Free plan. Both free active project slots are already
occupied by DRVN and Distill, so this is not evidence that another project can be
created. No existing project was paused, no plan was upgraded, and no hosted
project received test fixtures. See Supabase's [billing guide](https://supabase.com/docs/guides/platform/billing-on-supabase)
for the free-project allowance.

Destructive local checks use the dedicated DRVN stack on ports 54321/54322.
A separate disposable Postgres 15 container on loopback port 55440 checks fresh
migration application. Distill's local stack and hosted projects are excluded.

## Acceptance still required

Refund state, callback ordering, identity verification and late-failure bookkeeping are implemented. Final browser verification passed after correcting the dispatch UI defect. Reversal
recovery beyond the provider idempotency window, provider-specific dispute event
ordering, hosted payment journeys, invitation enforcement, privacy packages,
operations drills, device review, and genuine invited-commerce acceptance remain
tracked in the completion plan and progress data. No 10/10 readiness claim is made.

## Final integration checks

- 468/468 unit tests across 67 files passed in the final run.
- 10/10 real Stripe test-mode API tests passed.
- All final migrations applied from an empty Postgres 15 schema; all 17 SQL guard
  suites passed, and generated TypeScript matched that schema.
- Typecheck passed; full ESLint reported zero errors and five existing warnings.
- Production build passed, including the final browser runner build.

An earlier unit run timed out in one importer test while the browser build and
Stripe suite ran concurrently. The complete subsequent unit run passed in 8.21s.
The first transaction browser run passed pickup/shipping, then failed to observe
its dispatch update before reaching the refund step. That observation is retained
as a separate UI-convergence check, not erased by the later financial checks.

## Deployment requirements and remaining operator work

Apply both new migrations before deploying this app version. Preserve existing
Stripe event subscriptions and add `refund.created`, `refund.updated`, and
`refund.failed`. These changes have only been applied to disposable local databases.

A refund that fails after settlement restores the exact refund/fee counters once
and creates an append-only adjustment and recovery case. Seller re-credit and
order workflow restoration still require operator reconciliation. A null seller
re-credit amount means an earlier reversal's provider outcome is unknown; it is
not permission to issue another reversal or credit. The operation remains held.

Transfer recovery alerts are inserted in the same database transaction as the
recovery, including preexisting-case backfill. They remain pending until the
configured alert worker delivers them; local queue evidence is not proof of
external notification delivery.

The no-refresh follow-up reproduced the dispatch UI stall. The app's successful
`markShipped` action now uses the documented Server Action redirect after cache
revalidation, instead of relying solely on the current page's action-state
refresh. The browser test submits once, verifies complete persistence, and
requires the updated UI without a test-triggered reload. Final verification of
this correction passed: all four Chromium transaction journeys (pickup, signed
shipping delivery, partial refund, and return-for-refund) passed in 2.4 minutes,
with no forced dispatch reload and zero Playwright retries.

## Reproduction

From the repository with the isolated local test configuration:

```sh
npm test
npm run test:stripe
npm run typecheck
npm run lint
npx playwright test e2e/transaction-completion.spec.ts --project=chromium
node scripts/readiness-progress.mjs
```

The SQL proof used a separate empty `supabase/postgres:15.14.1.158` container on
loopback port 55440, applied `supabase/tests/ci_shim.sql`, then every migration in
filename order, then `scripts/test-sql-guards.sh`. Schema parity used
`DRVN_TYPES_DATABASE_URL=postgresql://supabase_admin:postgres@127.0.0.1:55440/postgres`
with `npm run db:types:check`. This is a disposable local password, not a hosted
credential. No commands inferred a linked hosted Supabase project.
