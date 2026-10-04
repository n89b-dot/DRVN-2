# Release unblock plan — CI run 36569901271

1 October 2026 · candidate `4e01df5` (main, unchanged since the failing run)

The release gate on main is red: `sql-guard` failed, `e2e` failed (45 failures), so
`stripe-integration` was skipped and `release-gate` failed. `verify` passed. This plan
was made from Emma's diagnosis, and each claim was checked against the source and the
CI log at `4e01df5`.

## What was verified

| Area | Emma's claim | Verdict | Evidence |
|---|---|---|---|
| SQL | `security_guard.sql` 15b expects the seller's mark-sold to be refused. That's now intended, and its failure stops the later checks from running | **Confirmed** | CI log `FAIL 15b` at 12:43:12. Test at `supabase/tests/security_guard.sql:525-531`; the trigger allows active/paused → sold (`20260929100000_seller_marks_sold.sql:30`). Saved-search and main-car checks (:533-591) never ran |
| Fixture A | `publishListing` never attaches a photo, and the server refuses to publish without one | **Confirmed** | `e2e/helpers.ts:70-94` has no upload; `sell/actions.ts:229-232` returns `PHOTO_REQUIRED`. `transaction-completion.spec.ts:43-63` repeats the same helper |
| Fixture A | On phones, `/publish/i` matches two buttons | **Confirmed** | One `commitButton` is rendered twice: the footer at `sell-form.tsx:1154` and `MobileActionBar` at :1173. `.buybar` is only hidden at ≥981px |
| Fixture B | Golden path has its own signup helper that doesn't know "just browsing" | **Confirmed** | `golden-path.spec.ts:45` vs `helpers.ts:40` (fixed in 35fc4a4, but the duplicate wasn't) |
| C — product bug | The link from a listing to its source build drops the return context | **Confirmed — real regression** | Before 3daf293 the listing linked `/cars/${slug}?fromListing=${id}&from=${returnTo}`. Now `VehicleCard` hard-codes `/cars/${slug}` (`vehicle-card.tsx:38`). The build page still reads `fromListing`/`from` (`cars/[slug]/page.tsx:91-93,312`) |
| D1–D11 | 22 tests/UI mismatches | **21 confirmed, 1 partly** | Details below. D9 depends on viewport width; the fix is the same |
| E — visuals | 11 snapshot diffs come from structural redesigns, not raster noise | **Confirmed (likely intended)** | Linux baselines were last re-recorded on 2026-09-19 (`9e93a07`). Front door/design commits after that (`d425316` WS1, `3daf293`, `5af8cb2`) explain the drift. You still need to look at them |
| CI wiring | Stripe is skipped because `needs: [e2e]`; the gate needs all four jobs to succeed and run | **Confirmed** | `ci.yml:206,256-273`. `STRIPE_TEST_SECRET_KEY` exists as a repo secret (name only; whether the value is valid is unknown) |
| Schema parity | Never ran | **Was also failing (found 1 Oct)** | `bcc7bd5` hand-edited `trending_models`' `catalog_make_id`/`catalog_model_id` to `number \| null`; the pinned generator emits `number`. Regenerated; the only consumer (`explore/page.tsx:108`) already checks both ids before using them |

Nothing in the review points to a security regression. The only real product defect is C.

## Guardrails (from Emma's report — I agree with all of them)

- Don't disable gates, add to skip allowlists, raise `maxDiffPixelRatio`, apply broad timeout increases, or use unexplained `.first()`.
- Don't bypass photo validation, MFA or RLS, and don't seed public image URLs to get around the uploader.
- Don't bring back old product copy just to satisfy an old selector. Fix the test to match the product, unless the product is what's wrong (C).
- Every recovery test must still reach its persistence or idempotency assertion. Getting past a locator isn't enough.
- SQL and browser runs go against a **disposable local stack only**, never the shared dev project. (Memory: dev has hand-applied migrations — don't replay the chain there.)

## Progress (1 Oct)

- **Phase 0 done.** Artifacts saved in `~/drvn-ci-evidence/36569901271/` (88 MB, all 11 screenshot sets).
- **Phase 1 done.** §15 now has 15b (reserved → sold refused) and 15c (owner active/paused → sold persists and touches 1 row; stranger, draft and sold → active refused; no order created; sales count unchanged). All 49 guard files pass on a fresh CI-equivalent Postgres (`supabase/postgres:15.14.1.158` on :55440). Types regenerated, so the parity check passes.
- **Phase 2 done (code).** `attachSellPhoto` and `sellCommitButton` were added to `e2e/helpers.ts`. `publishListing` attaches a photo and scopes to `.saverow`, and gained the `drvn`/`pickup` options. `transaction-completion` and `golden-path` dropped their duplicate helpers. New test: publishing without a photo is refused and a draft saves. D5 was pulled forward (same serial file).
- **Phase 3 done (code).** `VehicleCard` got an `href` prop (registry and docs updated). The listing page passes `fromListing` plus the sanitised `from` again.
- Phase 2–3 local run: the fixtures and the source-build return work (`marketplace-shopping:67` passes **unchanged**; publishing works in all 3 engines). This exposed 7 more stale tests that were previously hidden behind skips, all intentional product changes:
  - Selling nav is hidden on purpose at ≥1081px (`3daf293`) → those tests now run at 768px.
  - The inbox filter row needs a conversation (`33dd259`) → the test now seeds one and checks that Selling/Buying actually filter.
  - `/garage` opens on the main car (`3daf293`) → tests use "View the build page" or `?car=all`.
  - The add-to-cart toast was removed (`3daf293`) → tests check for the "In cart ✓ — view cart" link instead.
  - Checkout's default country is now the US, which requires a State (`11713ff`) → the guest address uses US/NV.
- **Phase 4 done (code).** D1–D11 applied as in the table below, with one exception: **D8**. Seeding a watcher can't work, because `saves` RLS only lets the *seller* read listing saves. Guests and buyers always get a count of 0, so "N watching" is never shown to them. The test now checks order against the dispatch note, which always renders, and against "Watching" only when it's drawn. **Product follow-up:** if buyers are meant to see watchers, add a definer count function like `profile_sales_count`.
- Phase 4 local run: 49 passed. The 7 remaining failures were further along in the same tests, again from intentional changes:
  - The invitation form only shows while the beta gate is enforced (`a75180c`) → the test now enforces the gate before creating an invitation.
  - The composer's status shows "Add a photo to publish" before the save state → journey 5 polls the database for the draft instead.
  - Publishing a draft from the ledger also needs a photo (`sell/actions.ts:532`). Emma's report said that fixture had one; it doesn't → the photo is now attached when the draft is created.
  - The Explore sheet's button is "Reset" → locator fixed.
  - The mobile mod editor's header row → excluded.
  - The details form shows "Unsaved changes" after a new edit → the test checks that the stale confirmation is replaced.
  - `mobile-matrix` garage → had only failed because the file was loaded before its fix.
- Full-suite local runs (all specs, 3 engines) surfaced the last tests that were hidden behind skips. All were fixed:
  - **Product regression, fixed: `staleTimes: { dynamic: 30 }`** (perf commit `a164315`) served a stale client copy after a server action plus `router.refresh()`. A just-created beta invitation was missing from "Recent invitations" until a manual reload. To prove it, beta-invitations was run with the setting removed and passed first time. The setting is removed (`next.config.ts`), with a note explaining why. `router.refresh()` is used in 15 places, so this was not invitation-specific. Client reuse can come back later with a fix that keeps action results fresh.
  - **Product fix: filter-chip counts were 2.58:1 contrast.** `.fbtn .n { opacity: 0.6 }` dimmed every chip count, e.g. the admin console's "Disputes 4". The count now uses the chip's own `--dim` colour, which reads 5.97:1. CI didn't catch this because its fresh database had no disputes when the admin a11y scan ran.
  - **Product fix: onboarding bounce.** A `/home` prefetched while the account was still mid-onboarding was reused after "Skip — just browsing", which sent the member back to `/onboarding` for a moment. This showed up as golden-path flakes in Firefox and WebKit. Completing onboarding now calls `revalidatePath("/", "layout")`, which clears the client cache.
  - **Product fix: garage sheet tap targets.** `3daf293` made two of the three rail tools quiet text links at 21px tall on phones. They now keep a 44px tap height (`.gsheet__rail .jumplink`, phone-only, no visual change).
  - The a11y garage-dialog scan was measuring mid fade-in (`--dim` at about 87% opacity reads 4.37:1). The test now waits for the dialog to finish appearing; at rest the labels are above 5:1.
  - Stale tests from intentional changes:
    - Explore suggestions gained a "Search for “…”" row (excluded from the locator; this matters for the private-car check).
    - Ordered items already on a car show "On <car> →" (the repeat add is now done from a stale second tab).
    - `/saved` and notifications hide filters when empty (the tests seed one save or notification).
    - The inbox needs an offer-linked thread.
    - The return form gives way to the return panel.
    - Zero-valued garage dimensions are hidden.
    - The offer page links to Messages instead of embedding a composer.
    - Sign-in links have bracketed names; Selling nav runs at 768px.
- **Phase 5 done.** Neil approved all 11 current renders (review page: https://claude.ai/artifact/MZu9H8erLyRaSLj43aYwNJ). The new `*-chromium-linux.png` files are CI's own `-actual` renders from run 36569901271. Its `-expected` files matched the committed baselines byte for byte (11/11), so these are exactly what the CI environment draws. The threshold (2%) and masks are unchanged.
- Local test stack: reset to all 146 migrations. Backup is at `~/drvn-db-backups/local-test-stack-pre-reset-2026-10-01.dump`.

## Phases

### Phase 0 — Keep the evidence (today)
The `failure-details` artifact (traces/screenshots) **expires 2 Oct 13:20 UTC**. Download it
into `~/drvn-ci-evidence/36569901271/` (not the repo, because the traces contain synthetic session tokens).
`gh run download 36569901271 -n <failure-details artifact name>`.

### Phase 1 — SQL guard (small, unblocks schema parity)
1. In `security_guard.sql` §15, replace 15b with positive checks: the owner can mark **active → sold** and
   **paused → sold**, each on its own fixture listing, with the stored `status` read back.
2. Keep 15a, and add negative checks: reserved → sold, draft/archived → sold, sold → active,
   and a non-owner mark-sold leaves the row unchanged (RLS can affect 0 rows without an error, so check by reading the row back).
   Also check that mark-sold creates no order and doesn't change `profile_sales_count`.
3. Run it on a disposable local Supabase stack with the full migration chain:
   `psql … -f supabase/tests/security_guard.sql`, then `scripts/test-sql-guards.sh` (all 49),
   then `npm run db:types:check`. If the types have drifted, regenerate them as a separate, reviewed commit.

### Phase 2 — Shared fixtures (clears 11 failures and about 88 skipped dependents)
1. `publishListing` in `e2e/helpers.ts`: attach a 1×1 PNG through `#sell-photos input[type=file]` and
   wait for "Add more photos". This pattern already works at `listing-import.spec.ts:203-212`, so turn it into an
   `attachSellPhoto(page)` helper. Point the click at the **in-form footer** commit button (scope to the
   form's footer container, with a comment saying the bar copy is the mobile duplicate).
2. `transaction-completion.spec.ts`: remove its local `publishListing` and use the shared one (it needs the
   `drvn`/`pickup` options added).
3. `golden-path.spec.ts`: remove its local `signUp`/`signIn` and import from `helpers.ts`. Check that its own
   later listing step attaches a photo too.
4. Keep (or add) one test where publishing without a photo is refused and saving a draft without one works.

### Phase 3 — Product fix: source-build return context (C)
1. Give `VehicleCard` an optional `href?: string` (default `/cars/${slug}`). Update its `registry.ts`
   entry and run `npm run docs:components`.
2. On `listings/[id]/page.tsx` ~:507, pass
   `` href={`/cars/${slug}?fromListing=${id}${returnTo ? `&from=${encodeURIComponent(returnTo)}` : ""}`} ``
   (`returnTo` is already the sanitised value from `shoppingReturn(from)` at :110).
3. The original `marketplace-shopping.spec.ts:67` must pass **without changes**. Also check by hand: opening a build directly
   shows no back link, a private source car still gets no card, and a crafted `from=https://evil` is dropped.

### Phase 4 — The 22 test/UI mismatches
Change only the locators and steps. Every assertion after them stays.

| # | Spec | Change |
|---|---|---|
| D1 | admin-mutation-recovery :67, beta-invitations :79 | Expect the page the test started from (`/admin/users/<id>`, `/admin/invitations`), then continue |
| D2 | direction-journeys :81, mod-sheet-recovery :50 | Exclude the header: `.modrow:not(.modrow--cols):not(.modrow--off)` |
| D3 | gallery-recovery :25, gallery-upload-response-loss :57 | Scope by the `Photos` TileHead / "Drag (or ↑↓) to reorder" hint |
| D4 | activity-recovery :62 | Check the restored draft via reload/data, then attach the photo, then expect "Saved". (Side note for product: saved status and why you can't publish yet share one slot) |
| D5 | garage-sell-lifecycle :136 | Use the `Publish` name, scoped like Phase 2; keep the stub-vs-payout check |
| D6 | listing-recovery :88-119 | Open the row's disclosure, act inside `#offers-<id>`, and find it again after reload |
| D7 | marketplace-browsing :62, :99; mobile-matrix :107 ×3 | Cancel with Escape (check focus comes back and the URL hasn't changed); use the `Ships from` label |
| D8 | mobile-matrix :158 ×3 | Seed one watcher in the fixture so ordering is checked against a real element. Add a separate test that zero watchers hides the line |
| D9 | mobile-remediation :120 | Check for one row, `nowrap`, 44px targets and no clipping, instead of requiring overflow |
| D10 | offer-action-recovery :68, :120/122 | `getByLabel("Your counter")`; `Accept $<amount>` |
| D11 | marketplace-shopping :131, :211 | Find the saved search by its href or a name substring; `name: /Sign in/` (the brackets come from `.btn--live` CSS and are part of the accessible name) |

### Phase 5 — Visual baselines (needs your review)
1. I put the 11 expected/actual pairs (from the Phase 0 download) side by side and you approve or reject each.
2. Regenerate **only the approved** `*-chromium-linux.png` files on Linux with the pinned Playwright version
   (the `mcr.microsoft.com/playwright` image matching `package-lock`, or a `workflow_dispatch` run).
   Keep the 2% threshold and the darwin baselines.

### Phase 6 — Full run on one commit
Focused local runs (`--reporter=list`, `E2E_DIAGNOSTIC_RETRIES=0`) per phase, then push and read the CI run:
`verify`, `sql-guard` (with parity), `e2e` (236 expected, 2 named importer exclusions, 0 flaky) and
`stripe-integration` all green on the same SHA, then `release-gate` passes. Any new failures that show up
once the serial dependents actually run get recorded here, not skipped.

## Order and size

| Phase | Clears | Effort |
|---|---|---|
| 0 | — | minutes, before 2 Oct 13:20 UTC |
| 1 | sql-guard, schema parity | ~1 h |
| 2 | 11 failures plus most of the 88 skipped | ~1–2 h |
| 3 | 1 failure, a real bug | ~1 h |
| 4 | 22 failures | ~3–4 h |
| 5 | 11 failures | your review, then ~30 min |
| 6 | release gate | one or more CI cycles |

Phases 1, 2 and 3 are independent and can run in parallel. Phase 4 should come after Phase 2, because several D tests depend on the
publishing fixture. Expect new failures in Phase 6: about 88 tests that never ran will now run.

## Follow-up (3 Oct): the "aborted server action" flakes

Two PR runs failed with a server action POST marked `net::ERR_ABORTED` and the UI waiting forever:
`feedback-settings-recovery:143` stuck on "Saving…" (run 36925773472) and golden-path "seller dispatches
with tracking" (run 36917505731). Both runs used **Next 16.2.12**; main has been on 16.3.8 since `41d21e0`.

- **`ERR_ABORTED` is not the cause.** Next cancels the rest of an action or RSC body once it has what it
  needs, so a successful save reports the same error locally. The real symptom is that the router never
  commits the post-action page. In CI, the re-prefetches after the save went out without `next-url`.
- **Cause of both hangs: Next 16.2's client router.** After an action that revalidates (or redirects and
  revalidates), 16.2.12 sometimes never commits the new page, and no follow-up request goes out. It
  reproduced locally on 16.2.12 for both flows:
  - Profile save: 4 of 37 runs, only with Realtime unavailable. CI ran without Realtime before `fff72f2`.
    The prefetch hashes matched CI exactly, and no app code dispatches anything in that flow.
  - Golden-path dispatch: 4 of 5 runs.

  On 16.3.8 none of them hung: profile 60/60 with Realtime down, golden path 10/10, and a full local suite.
  The 16.3.0 action-queue rewrite (vercel/next.js#95391, which also closed the deadlock in #84299) is the
  likely fix. I didn't isolate the exact 16.2 code path. Main has required `^16.3.8` since `41d21e0`, so
  the gate is already off 16.2. **Fix: stay on ≥16.3.** No retries or timeouts.
- **Our bug that made it worse: redirects escaping to `window`.** Forms ran the action from a plain submit
  handler and `unstable_rethrow`'d its redirect into a dropped promise. The router has already followed
  that redirect. Next's window `unhandledrejection` handler ignores the `handled` flag and `router.push`es
  it a second time, which discards the action mid-navigation. Every successful dispatch logged
  `NEXT_REDIRECT;push;/orders/…`, on 16.3.8 too. Removing the duplicate cut golden-path on 16.2.12 from 4/5
  failures to 2/5; the rest is the 16.2 stall above. On 16.3.8 it's a redundant navigation per redirecting
  action.
  **Fix:** every client call site that rethrows now calls the action inside `useTransition`'s
  `startTransition`, so the error lands in Next's RedirectBoundary, which skips handled redirects. The
  pending/disabled state stays an urgent update outside the transition, so a second click is still
  blocked. That covers `useRecoverableAction` (dispatch, receive, cancel, review, returns, disputes,
  offers) plus 11 one-off forms. The golden-path test now asserts no redirect escapes
  (`watchEscapedRedirects`) and no longer `unroute`s before the retry (that only hid the problem).
- **Found on the way:**
  - `direction-journeys` never closed its `freshPage` contexts, so 9 pages kept running through every later
    spec. That's why the profile failure's screenshot showed a "Journey two manifold" listing. Now closed
    `afterEach`, and the same for `realtime-delivery`.
  - `AddToCar` checked `addedTo` before `done`, so the refreshed order row could replace "Added to your
    build" before it was seen. Journey 6 failed 3 of 6 locally on 16.3.8 because of it.
- **Not done here:**
  - `sell-form`'s `onSubmit` had the same rethrow pattern, and `createListing` redirects on every success.
    It's fixed in PR #4 (fix/release-r2), which had already rewritten that handler for R2-01.
  - `cart/payment-confirm`, `settings/payment-methods` and two `sell/import` callbacks called actions with
    no catch at all. They're fixed in PR #6 (checkout) and PR #7 (settings and import).
  - On a member route (`/settings`, `/orders`, `/garage`, `/sell`, …), a session that has ended never
    reached the action's `redirect("/login")`. The proxy answered the action's POST itself with a 307,
    fetch followed it by re-posting to `/login`, and the page saw a failed call instead of a sign-in. The
    proxy fix answers a signed-out Server Action the way Next's `redirect()` does
    (`x-action-redirect`), so it lands on `/login?next=<page>`.

## After the gate is green (not part of this plan)
`scripts/release-candidate.mjs` still needs current evidence for its 15 gates (hosted provider, restore/rollback,
staging soak and others). The readiness tracker is dated 6 Sep. The README, e2e README and runbook §8 still say e2e isn't in CI.
