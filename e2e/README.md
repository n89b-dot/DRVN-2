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
