# Mobile design remediation — tracker

Working tracker for the mobile production remediation driven by the DRVN
Mobile Production Design Audit (performed 2026-08-16 against `5def0718`).

> **Provenance note:** `MOBILE_DESIGN_AUDIT.md` was not present in the
> repository or on `origin/main` when this pass began; the audit's full text
> was supplied directly in the remediation brief. Finding IDs (SYS-01…SYS-12)
> below reference that document. Local `main` at start of work == the audit
> SHA plus an uncommitted in-progress social/feed change-set, which was
> preserved untouched.

Statuses: `Not started` · `Confirmed` · `Implementing` · `Implemented` ·
`Browser verified` · `Blocked` · `Not applicable / already resolved`.
"Browser verified" requires a real check at the target viewport, not just
code review.

## Systemic findings

| ID | Finding | Status | Implementation |
|---|---|---|---|
| SYS-01 | Verification matrix narrower than product | Browser verified | `e2e/viewports.ts` profiles (320×568 / 390×844 / 430×932) + `e2e/mobile-matrix.spec.ts` behavioral contracts + transition probes; 16/16 green on both Stripe-mode dev and stub production servers. WebKit project deferred (see Deviations). |
| SYS-02 | Editorial pageheads on task surfaces | Browser verified | `.pagehead--task` (24px h1 floor, compact padding, standfirst retired ≤640 unless `.sub--keep`) + `.pagehead__row` action alignment. Applied to 20 heads: home, marketplace ×3, garage, listings, offers ×2, orders ×2, messages ×2, notifications, saved, settings, payouts, cart, checkout, sell, profile. Fixed a latent cascade bug: `--tight`/`--task` h1 rules tied with base `.pagehead h1` and lost on source order. |
| SYS-03 | Marketplace stacks chrome before inventory | Browser verified (390×844 guest) | Task head + compact `SellCta` in `pagehead__row`; search+submit share a row (`.finder .search` basis 180 + min-width 0); compact toolbar = Refine + Sort select (`sort-select.tsx`, submits form on change; replaces hidden sort field, still submits display:none ≥640); desktop sort chips `hidden sm:flex`. First card top ≈ 587px at 390×844. |
| SYS-04 | Garage presentation cards for management | Browser verified | `VehicleCard variant="manage"` + `flag` prop; `.vehicle--manage` (desktop = card anatomy; ≤640 = 112px 3:2 thumb row); `garage/vehicle-actions.tsx` — Manage always visible, secondary actions behind More → BottomSheet (inline ≥640). e2e updated. |
| SYS-05 | Fragmented breakpoint semantics | Implemented | Semantic roles (`compact`/`handheld`/`collapsed-shell`/`split-capable`) + documented route exceptions in `docs/site/material.md` §2. |
| SYS-06 | Sticky/safe-area strong, keyboard unproven | Implemented (partial) | `--bottom-surface-h` token drives buybar/savebar clearance; `.savebar` fixed variant + toast gain safe-area; composer joins the contract (SYS-08). Visual-viewport-reactive bars deliberately not added (see Deviations). |
| SYS-07 | Horizontal scroller affordance | Implemented | Scroll-driven edge fades (`@property --railfade-*` + `scroll(self inline)`, `@supports`-guarded, inert when no overflow) on familynav/sectionnav/filters--scroll/tabstrip; `ScrollActiveIntoView` (manual scrollLeft, no ancestor scroll) in familynav + settings sectionnav; SheetTabs scrolls active tab into view on mount. |
| SYS-08 | Thread composer not persistent | Browser verified (stub build) | `thread-view.tsx`: lands at newest message on live view; `.composer--pin` (sticky bottom, opaque tile plate, safe-area, ≤768px); history mode adds bottom "Back to latest to reply"; Result feedback moves with the composer. |
| SYS-09 | PDP rail order buries actions | Browser verified (390×844) | Rail tile reordered: state → price → shipping/total → condition·location → offer floor → Buy/Offer → Save → seller → ruled record block (watchers, part number, dispatch note, Report). Measured: Buy 708 < Save 906 < seller 970 < watchers 1085. Sticky buybar behavior unchanged. |
| SYS-10 | Home lacks attention hierarchy | Browser verified | `home/attention.tsx` "Needs you" stack (offers needing reply, sales to dispatch, deliveries to confirm, unread messages — four head-counts, renders nothing when all zero) inserted directly under the task head. |
| SYS-11 | Checkout repeats Change controls | Browser verified | Payment-step review consolidated: one "Delivery & contact" block (address + guest email, single Edit) + "Items" block (rows + Edit cart) + totals. Address-retention path untouched. |
| SYS-12 | Microlabel scope | Confirmed (audit of new work) | No new long-copy microlabels introduced; attention rows/hints use order__name/order__meta body styles. Full route sweep tracked under M4. |

## Milestone work not keyed to a SYS id

| Item | Status | Notes |
|---|---|---|
| Garage→Sell fast path (Flow B) | Already resolved | `/sell?car=` preselects the source car (ownership-validated); mod-line path also prefills identity/part number. Verified in source; browser check in final pass. |
| Sell mobile composition | Already resolved (structure) | No preview rail exists on any breakpoint; numbered `Section` steps + completeness strip + error summary = the staged system the audit asks to keep. Inputs are 16px `.ctl`; photo ordering + draft behavior untouched. |
| Orders rows lead with next action | Implemented | `.ordernext` moved above the item list in `OrderRow`. |
| Offer thread "who acts next" | Implemented | Decision cluster (Accept/Counter/Pass, Accept counter, Withdraw) moved above the message history; composer stays at the bottom. |
| Messages thread context on compact | Implemented | Thread head keeps order link + status via `.sub--keep`. |

## Deviations from the audit

1. **WebKit Playwright project not added in this pass.** The suite runs
   serially against a live Supabase dev stack; doubling it under WebKit
   needs CI budget decisions. The matrix file isolates viewport profiles so
   adding a WebKit project later is one config entry. (SYS-01 acceptance
   "where CI allows" — flagged, not silently skipped.)
2. **No `visualViewport` JS for bottom bars.** The buybar never coexists
   with a text input on the routes it mounts on; the pinned composer is
   `position: sticky` in-flow, so browsers keep the focused input visible
   natively. Encapsulating a VV hook was judged more surface than benefit
   for now. If a real device pass shows iOS Safari covering the composer,
   add it inside `.composer--pin` only.
3. **Marketplace categories stay a horizontal scroller** rather than moving
   into a Category sheet: DRVN has ~10 categories with icons (a "small
   category set" per the audit's own component guidance), and with the head
   compacted the first listing already lands inside one viewport.
4. **`.pagehead--task` is a CSS variant, not a new `PageHeadTask`
   component.** The pagehead is a CSS recipe across ~30 call sites; a class
   variant is the smallest systemic change and keeps markup per-route.

## Verification log

- 2026-08-16 — typecheck, lint: PASS after each systemic change (SYS-02/03/04/08/09/10/11 batches).
- 2026-08-16 — Browser (Chromium pane, 390×844): marketplace guest — search/submit one row, Refine+Sort one row, category rail one line, first listing card top ≈587px, no horizontal overflow; PDP guest — purchase order verified (see SYS-09), buybar mounts hidden while actions in view; desktop 1440 marketplace — sort chips visible, refine inline, sub visible, h1 34px, no overflow.
- 2026-08-16 — `npm run test` (vitest): 114/114 PASS. `npm run typecheck`, `npm run lint`, `npm run build`: PASS.
- 2026-08-16 — `e2e/mobile-matrix.spec.ts` vs dev :3005 (Stripe test mode): **16/16 PASS** — incl. task-head 45% budget on 10 task routes, garage two-rows contract, attention stack, offer decision above thread, checkout single-Edit + full field retention (Stripe payment-step path).
- 2026-08-16 — `e2e/mobile-matrix.spec.ts` vs stub production build :3006: **16/16 PASS** — the stub path exercises the completed order: `.ordernext` leads the row, `.composer--pin` sticky with 16px input, send round-trip, history mode shows "Back to latest to reply" with no composer.
- 2026-08-16 — Full behavioral suite vs stub build :3006 (a11y, golden-path, guest-checkout, marketplace-family, feature-regression, garage-sell-lifecycle, mobile-layout, mobile-remediation, mobile-matrix): **75/76 PASS**. The one failure (`garage-sell-lifecycle` "publish gated until payouts enable") asserts the Stripe-mode payouts gate, which by design cannot trigger on a stub server; the same test passed against the Stripe-mode dev server in the same session. Environment-conditional, not a regression.
- 2026-08-16 — `e2e/responsive.spec.ts` vs dev :3005: 30/30 PASS. Only the 5 `/marketplace` baselines changed; each diff inspected (compact task head, header Sell action, one-row search/submit, Refine+Sort toolbar) and intentionally re-baselined. All other routes byte-identical.
- 2026-08-16 — Evidence captures in `screenshots/mobile-remediation/` (marketplace 390 + 320×568, PDP 390, garage 390 with 3 cars, home 390) via `e2e/evidence.spec.ts` (runs only with `EVIDENCE=1`).

### Spec updates made alongside

- `e2e/viewports.ts` — named matrix profiles + transition probe list.
- `e2e/mobile-layout.spec.ts` — garage assertion updated from presentation-card (img ≥300) to management-row contract (img 104–140, 44px Manage, sheeted More with focus restore).
- `e2e/guest-checkout.spec.ts` — payment-step marker updated to the consolidated review ("Delivery & contact"), made payments-mode-agnostic (`|order placed`).

## Remaining production risks / follow-ups

1. **WebKit/iOS Safari engine coverage** — still Chromium-only (see Deviations); a real-device pass on the pinned composer + keyboard remains the highest-value manual check.
2. **Seller KPI block on quiet accounts** — compacted (smaller plates/figures ≤640) but still four stacked tiles before the garage; a one-line scrollable metric row is the next density win if wanted.
3. **`.finder` submit at 320px** — the Search button wraps to its own row below ~360px (text button + 16px mono can't fit beside a usable query field); accepted, documented in CSS.
4. **Scroll-driven rail fades** — inert in Firefox (no scroll-timeline support); gutter-bleed cut-off remains the baseline affordance there.
5. **`spec-note`/`field__hint` at 12px mono** — sentence-case, wraps, no clipping at 200% zoom, but below the audit's 13–14px preference for operational metadata; changing it is a system-wide type decision deliberately not taken unilaterally.
