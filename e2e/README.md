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

## Money-completing specs and payments mode (Aug 2026)

`golden-path.spec.ts` completes a purchase, which in Stripe mode stops at the
Payment Element (the card iframe isn't drivable headlessly in this
environment). Run the money-completing specs against a **stub-mode** server,
where the address submit settles inline:

```bash
npm run build
PAYMENTS_MODE=stub PAYMENTS_ALLOW_STUB_IN_PRODUCTION=true npx next start -p 3006
E2E_BASE_URL=http://localhost:3006 npx playwright test e2e/golden-path.spec.ts
```

(`PAYMENTS_ALLOW_STUB_IN_PRODUCTION` is required because `next start` runs
with NODE_ENV=production, and stub payments are refused there by default —
that guard is doing its job.)

Everything else (navigation, gating, guest checkout up to the payment step,
a11y, responsive) runs against the ordinary Stripe-mode dev server on :3005.

## `mobile-remediation.spec.ts`

The regression floor for the mobile remediation pass, sitting beside
`responsive.spec.ts` (does it fit?) and `mobile-layout.spec.ts` (the phone
presentation of the buy funnel). This one asserts the *mechanism* each of
those layouts was rewritten for — a wrapped tab wall, a stranded checkout
action and a caption-less form row all "fit" perfectly well:

- **Car sheet tab strip** — `nowrap` + sideways scroll + one row + 44px tabs
  at 320/375/430, back to `wrap` at 1440.
- **Cart** — `.buybar--wide` visible with a 44px checkout action and matching
  body clearance at 375 (footer clears the bar with the page fully scrolled),
  `display: none` at 1440.
- **Mods editor** — `.modrow` becomes a labelled record (grid, one field per
  row, visible Brand/Product/Part number/Category captions, 44px Remove) at
  320/375 and returns to a ledger line (flex, no captions, shared rows) at
  1024; `.saverow` stacks with a full-width commit button at 375 and is one
  compact line at 1024.
- **Saved / Messages finders** — `.search` and the submit each own the full
  finder column at 375, compact again at 768.
- **Notifications** — the two filter groups each hold one row at phone
  widths, and the read-state/type axes still *combine* in the query
  (`?filter=unread&section=marketplace`) rather than replacing each other.
- **Checkout** — the `max-lg:hidden` aside is gone and `details.ordersum`
  carries the total at 375; the reverse at 1440.

No visual snapshots here on purpose: these are layout-behaviour contracts, and
a baseline would fail on unrelated data churn instead.

Seeding goes through the real UI (`signUp` → `addCar`, and for the cart
tests, browsing the marketplace and clicking **Add to cart**). Where the
needed data may not exist on a given machine — the seeded
`/cars/lancia-delta-hf-integrale`, or a marketplace with nothing buyable —
the test `skip()`s with a reason rather than failing.

```bash
E2E_BASE_URL=http://localhost:3005 npx playwright test e2e/mobile-remediation.spec.ts
```
