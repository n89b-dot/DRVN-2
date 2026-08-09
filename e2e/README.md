# End-to-end tests

The golden path: **sign up → add a car → list a part → buy it → dispatch → confirm receipt → review.**

These are the only tests that exercise the whole system together — RLS, the
purchase RPC, the fulfilment state machine and the UI in one pass. Unit tests
can't reach any of that.

## Prerequisites

They talk to a real Supabase project, so they need one that is **not
production**, with migrations `0001`–`0009` applied.

```bash
npx playwright install chromium
```

Then create `.env.test.local`:

```
NEXT_PUBLIC_SUPABASE_URL=https://<test-project>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key>
SUPABASE_SERVICE_ROLE_KEY=<service role key>
NEXT_PUBLIC_SITE_URL=http://localhost:3000
E2E_BASE_URL=http://localhost:3000
```

Turn **off** email confirmation in the test project's auth settings, otherwise
signup can't complete without a mailbox.

## Running

```bash
npm run test:e2e
```

Playwright starts the dev server itself. Each run creates two throwaway accounts
(a buyer and a seller) with timestamped addresses and deletes them afterwards, so
runs don't collide.

## Why this isn't in CI yet

CI has no Supabase project to point at. Wiring it up means either a dedicated
test project with a reset step between runs, or `supabase start` in the workflow
plus applying the migrations. Worth doing — deliberately deferred rather than
faked with mocks, which would test nothing about RLS or the RPCs.

## Additions (Aug 2026)

- `SUPABASE_SECRET_KEY` is accepted as well as the legacy
  `SUPABASE_SERVICE_ROLE_KEY` for cleanup, matching `src/lib/env.ts`. If
  neither is set, cleanup is SKIPPED and says so loudly — test users are not
  removed.
- `e2e/a11y.spec.ts` — axe scans of the public pages (serious/critical
  violations fail; advisory ones print) plus a keyboard-only signup smoke.
  Needs no account.
- Golden-path locators track the current UI: structured country select,
  consequence-confirmation dialogs on dispatch / mark-received, and the
  explicit star rating on reviews.
- Local runs against an already-running dev server: set
  `E2E_BASE_URL=http://localhost:3005` (the launchd dev server) — Playwright
  reuses it instead of starting a second one.
