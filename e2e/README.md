# End-to-end tests

The golden path: **sign up → add a car → list a part → buy it → dispatch → confirm receipt → review.**

These are the only tests that exercise the whole system together — RLS, the
purchase RPC, the fulfilment state machine and the UI in one pass. Unit tests
can't reach any of that.

## The acceptance journeys

`direction-journeys.spec.ts` holds the six journeys from
`docs/plans/2026-09-direction-build-plan.md`. Each workstream has its own
tests; these are the ones that only pass if several workstreams agree — the
seams nobody owns, which is where a change lands that is individually correct
and collectively wrong.

1. Replace a part and list the old one — the old part keeps its id.
2. That listing reaches followers once — following the seller *and* the car
   still gives one card.
3. A stranger finds it signed out — Explore, search, suggestions, item page,
   with a private source car named but never linked.
4. It sells and the store shows it — under Sold and All, never Active, and
   `?status=draft` on somebody else's store shows nothing.
5. Quick post without losing a long draft — release-blocking.
6. The buyer finishes the loop — a delivered order becomes a build line, once.

They run only against the isolated local stack
(`E2E_TEST_PROJECT_REF=local-drvn-remediation`), serially, and they clean up
their own accounts. Journeys 2, 3, 4 and 6 reach past the UI with the service
role for setup the journey is not testing — an order in a delivered state, a
car flipped private — never for the assertion itself.

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

## Transaction-completion flows (`transaction-completion.spec.ts`)

The §44 golden paths — DRVN Shipping rates→label→webhook delivery (A), local
pickup with the Pickup Pass (C), partial refund (D), and return-for-refund
(E); manual shipping (B) is the original golden path. They need BOTH stub
providers plus the shipping flag, so run them against a stub `next start`
(the dev directory's one-dev-server rule blocks Playwright's own `next dev`
while the launchd server is running):

```bash
NEXT_DIST_DIR=.next-check npm run build
NEXT_DIST_DIR=.next-check PAYMENTS_MODE=stub PAYMENTS_ALLOW_STUB_IN_PRODUCTION=true \
  FLAG_INTEGRATED_SHIPPING_V1=true SHIPPING_MODE=stub SHIPPING_ALLOW_STUB_IN_PRODUCTION=true \
  EASYPOST_WEBHOOK_SECRET=e2e-webhook-secret npx next start -p 3006 &
E2E_BASE_URL=http://localhost:3006 npx playwright test e2e/transaction-completion.spec.ts
```

Flow A drives the order to `delivered` by POSTing a tracker event to
`/api/shipping/easypost` signed with `EASYPOST_WEBHOOK_SECRET` — the same
HMAC door EasyPost uses, so the webhook path is exercised too.
