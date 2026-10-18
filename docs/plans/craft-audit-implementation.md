# Craft Audit — Implementation Plan

Source: DRVN × read.cv craft audit (Aug 2026). Diagnosis artifact: https://claude.ai/code/artifact/1f65ca40-47dd-4fc7-a01c-c9972a0387df
Scope: every fix from the report, with the owner's amendments applied (card: title stays first, price under it; chips leave the card; chip tints get a legibility pass).

Ground rules for every task:
- Tokens only — no hardcoded hex/radius/duration. New values land in `globals.css` `@theme` / `:root` first.
- Verify both themes (day + night) and `prefers-reduced-motion` for anything that moves.
- Contrast: text ≥ 4.5:1 against its actual ground (for chips, the tinted ground, not paper).
- Update the `(docs)` specimen pages in the same PR as the CSS they document — the docs drifted once; don't let them drift again.

---

## Phase 0 — Token & hygiene fixes (all quick, ship as one PR)

- [x] **Unify the two light-mode reds.** `@theme` `--color-live: #f03a20` → `#c02c14` to match `:root --live` (the WCAG-audited value). Grep for `text-live` / `bg-accent` usages and confirm nothing depended on the brighter red. Dark mode already consistent (`#ff4530`).
- [x] **Define `.field__label`.** It's used in 8 files (checkout-steps, orders fulfilment/disputes/review-form, settings password/delete-account, login forgot/reset) but exists in no CSS. Define it as the microlabel recipe (mono 500 / 12px / uppercase / 0.14em / `--dim`) so the whole transactional form surface matches garage/admin labels.
- [x] **Delete `src/components/ui/button.tsx`.** Zero imports, pill radius, sans, `bg-accent`, hard-coded `text-white` — contradicts the live `.btn` and the no-pills rule. Already flagged in `docs/production-readiness-report-v2.md:427`.
- [x] **`font-weight: 620` → `600`** at `.console-main .pagehead h1` (620 is not a loaded Plex Sans cut).
- [x] **Toast can wrap.** `.toast`: remove `white-space: nowrap`, add `max-width: min(60ch, 92vw)`, `text-align: center`. Reconcile dwell: code is 3200ms, docs claim 2600ms — keep 3200, fix the docs.
- [x] **One dialog width.** `.sheet` 480 / `ActionDialog` 460 / `ConfirmDialog` 440 → a single token (`--sheet-w: min(480px, 92vw)`); remove the per-component `w-[min(92vw,…)]` overrides.
- [x] **Fix the dead dialog entrance.** `Dialog` returns `null` when closed, so `.sheet`'s 380ms spring rise never plays. Mount, then add `.is-open` on the next frame (or use `@starting-style`). Respect reduced motion.
- [x] **`.ctl` gets states.** Add `transition: border-color 160ms ease, background 160ms ease`; add `:hover` (border `--rule-mid`), `:disabled` (opacity .55, `cursor: not-allowed`), and keep validation via `.field.is-invalid` / `.is-ok`.
- [x] **Unify card gutters on 16px.** `.mkt`, `.feedcols`, `.vehicle` 14px → 16px to match `.deck` and `.pdp`. Update the docs "the one gap" row (it claims 14).
- [x] **Avatar size tokens.** Four named sizes — sm 40 / md 48 / lg 64 / xl 88 (sm was 44 until the October 2026 spacing system) — in CSS; kill `h-[88px]` and the ad-hoc React default.
- [x] **Chip tint legibility pass** (owner request). Today's ~10% washes are hard to read as color on warm paper. Raise tint opacity to 14–18% and deepen text hues one step. Starting values (light): ok `rgba(34,128,74,.16)` / text `#145c35`; live `rgba(203,49,24,.14)` / text `#a82410`; warn `rgba(196,140,20,.18)` / text `#6f4a00`; info `rgba(38,113,163,.15)` / text `#14527f`. Dark: raise tints to ~.18–.22, brighten text as needed. **Verify ≥4.5:1 against the tinted ground in both themes** and update `/docs/brand` swatches.
- [x] **Docs reconciliation.** Fix the stale numbers: brand hexes (pre-contrast values), "sans 650" → 600, tile padding 18 → 20, deck gap 14 → 16, narrow column 540 → 720, toast 2600 → 3200. Remove the `!gap-[14px]` specimen patch. Document `--info`; decide `--danger` (see Phase 2).

## Phase 1 — Marketplace card rework (`src/components/ui/listing-card.tsx` + `globals.css`)

Reference basis: Mobbin study of eBay / Grailed / Vinted / Etsy / Klarna / Depop grid cards. Universal title-first pattern: price is the single loudest element (weight + full ink, own line); condition is never a chip — always a quiet dot-separated text line; shipping docks to the price; seller sits in a divided footer. Budget: 3 sizes, 2 weights, 2 ink values per card.

- [x] **New stack, in order** (title stays first — owner decision):
  1. Title — `.mkt__name`, 16px/600 sans, 2-line clamp, full ink (unchanged).
  2. Price line — `.mkt__price` → 20px mono 500, full ink, `margin-top: 5px`, with shipping inlined as a 12px mono `--dim` annotation: `$450 + $40 ship` / `$450 · ships free`. Keep the "say nothing when shipping is unknown" rule. `tabular-nums`.
  3. Meta line — replace both chips with one 12px mono uppercase `--dim` line, dot-separated: `USED — GOOD · MANCHESTER`. Plain text, no backgrounds. Fitment note moves here too (`FITS E92 M3 ·` prefix) with the existing "seller-stated" caveat surfaced accessibly (visible text or `aria-describedby`, not `title=`).
  4. Seller footer — new: 22px monogram + name + `4.8 ★ · 23 sales`, 12px mono `--dim`, above a `--rule-soft` top border, `margin-top: 12px`.
- [x] **Badges that must survive go on the image**, not the text stack (SOLD / RESERVED as an ink corner flag on `.tile__img`), matching the reference pattern.
- [x] **Same card everywhere.** The "Similar in this category" / "More from this seller" rail queries must select the same fields (part_number, shipping_cents, watch_count, seller) so `ListingCard` renders one density on the whole page.
- [x] **Update `/docs/components` card specimen** to the new anatomy.
- [x] Verify: 3-col grid at 1200px, 2-col at 980, 1-col at 640; dark mode; a card with no photo (plate-undrawn) and no shipping.

## Phase 2 — Accent dosage

- [x] **PDP condition checklist** (`listings/[id]/page.tsx:452–469`): six per-row tinted chips → monochrome ✓/— marks per row + one summary chip (`chip--ok` "6-point check · passed"). One green maximum in the block.
- [x] **Explore red demotion** (`feed-card.tsx`): "For sale" fallback chip and "New update" microlabel drop from `--live` to ink/dim. The three-tone plate system already differentiates card types; red returns to meaning "live right now" only.
- [x] **Admin status chips through one map.** Extend `src/lib/admin/presentation.ts` to cover the transfer/refund/alert ternary ladders in `payments/page.tsx` and `users/page.tsx`. Route terminal negatives (failed, cancelled, disputed-lost) to `chip--danger` as the CSS intends; resolve the table-vs-detail inconsistency for nominal statuses (pick `.status-plain` in both).
- [x] **One `--live` CTA per surface** spot-check after the above: PDP, Explore viewport, admin pages.

## Phase 3 — Empty states & loading

- [x] **One empty-state rule: `.undrawn` + context copy + a named filling action wherever the viewer can act.** Convert: car page Build + Gallery panels (bare `<p>` today), listing Q&A empty, gallery-manager empty, and all ten admin empties (orders 263, users 188, audit 222, reports 39/72, payments ×5). Admin CTAs = clear-filters or the relevant create action; viewer-only empties get no CTA (read.cv rule).
- [x] **Category-page empty copy.** `/marketplace/[category]` and `[subcategory]` pass real `emptyTitle`/`emptyBody` naming the category ("No brakes listed for the E46 yet…"); fix the misleading "Clear the filters" CTA when no filters are set.
- [x] ~~Delete `feed-list.tsx`~~ **Superseded:** `FeedList` is now used by `/home` (wired in by work that landed after the audit), so it stays. Its empty state already uses `.undrawn`; its "For sale" chip was demoted to ink to match the Explore accent rule.
- [x] **Per-shape skeletons.** Replace the one-size `SkeletonPage` with three shapes matching their destinations: card-grid (marketplace, category), masonry (explore), PDP two-column (listings/[id]). Keep the existing shimmer/reduced-motion/sr-only mechanics.
- [x] **Admin loading.** Add `loading.tsx` under `(admin)` (ledger-shaped ghost rows) — every console page is `force-dynamic` and currently gives zero navigation feedback.

## Phase 4 — Feedback grammar ("the record is the receipt")

- [ ] **Pending labels on every async button.** Add-to-cart ("Adding…"), and audit all `.btn` form actions for a pending state. Keep the label-swap idiom; update the docs, which claim "pending resolves to a chip" (never true).
- [x] **Optimistic Q&A** (`qa-section.tsx`): `useOptimistic` insert on post/reply with rollback + inline error on failure. Kills the perceived-loss moment where the composer clears before the server responds.
- [x] **Optimistic reactions with rollback** (`features/activity/engagement.tsx`): migrate the manual useState to `useOptimistic`; on failure, revert and surface a quiet inline note.
- [x] **Toast policy.** Reserve `<Toast>` for cross-page results only (added to cart, saved payment method). In-place results (saves, posts, reactions) confirm via the content changing. Remove the string-equality chip hack in `mods-editor.tsx:325` in favor of the standard pattern.
- [x] **In-field validation marks** where async checks exist (VIN, offer amount): green ✓ inside the field via `.field.is-ok`, red note via `.field__err` — the mechanisms exist, they're just unused.

## Phase 5 — Structure & component unification

- [x] **Disambiguate `.fbtn`.** Done, with one deviation: Explore's tabs are server-filtered *links*, so `SheetTabs` (client panels) would force fetching all three feeds per view — they use the marketplace-sort link-filter idiom instead (`role=group` + `aria-current`), which is the same `.fbtn`-means-filter meaning. Nav link → `.relbtn`; category pages now `.filters--roomy`.
- [x] **44px touch floor everywhere.** `.fbtn` `min-height: 44px` at all widths (docs already promise it); `mods-editor` drops the `!py-2` overrides; `.thumb__x` controls ≥ 24px visual with a 44px hit area at all pointer types.
- [ ] **`.menu` primitive** — **deferred deliberately:** after the restructuring no surface has overflow actions to house (admin rows show 1–2 visible relbtn triggers, which beats hiding them). Building it now would recreate the exact "documented pattern, zero call sites" problem this audit flagged. Revisit when a real overflow consumer appears.
- [x] **Checkout uses the system.** Replace the hand-rolled stepper with the documented `.steps` recipe (zero call sites today); replace `max-w-[1060px] px-5` with `.wrap wrap--wide` on cart + checkout; fix the `.alert` missing-icon layout bug in `cart/page.tsx:167` (add `alert__ico`, and fix the same bug reproduced in the docs specimen).
- [x] **Theme the Stripe Payment Element.** Map `appearance.variables`/`rules` to tokens: `colorPrimary --live`, `colorBackground --paper-deep`, `colorText --ink`, `borderRadius 10px`, mono font for numeric fields, focus ring 2px `--live`. Both themes.
- [x] **One checkbox.** `input.sq` everywhere: checkout consent, payment-confirm, saved-card radios (radio variant of `.sq`), and the bare native checkboxes in `reports/open-reports-list.tsx`.
- [x] **Destructive tier.** Promote `.btn--destructive` (zero call sites) to the standard destructive trigger (garage danger zone, admin refund/suspend); typed-confirmation (`ConfirmDialog` gains an optional `confirmText` prop — type the car name / order id to enable) for the irreversible tier; replace gallery-manager's inline ✕→✓ with `ConfirmDialog`.
- [x] **One pagination.** Orders + audit adopt the shared `Pager`; delete the inline copies.
- [x] **Small strays:** (payload-viewer radius, alert icon, section heads done; `.microlabel !mb-0` occurrences left in place — harmless, and touching ~20 call sites for a no-op class is churn) `payload-viewer` `rounded-lg` → `rounded-ctl`; `activity-composer` `border-[color:var(--rule-soft)]` → the `.feed` rule; remove cargo-culted `.microlabel !mb-0`; section heads in cart/checkout wrapped in `.tile__head` so they get the 20px scale like garage.

## Phase 6 — Flow redesigns (largest, schedule last)

- [x] **Garage edit → section-panel lifecycle.** Each section (details, mods, gallery, activity) gets the empty → form → list lifecycle: `.undrawn` invitation → one form at a time → saved rows with quiet `Hide · Edit · Delete` text actions. Character counters on every length-limited field (label-row right slot, `12 of 48` style). Use the documented `.drop` dropzone for photo upload (currently a hidden file input). One label system (`.microlabel` via Phase 0's `.field__label`).
- [x] **Keyboard layer** (partial). `/` focuses marketplace + admin search (`SlashFocus`, verified live) with a `kbd` hint in the finder. Not done: focus management after filter navigation (needs a client wrapper around server-rendered results — small follow-up).
- [x] **Signup as a two-field gate.** (Owner decision: username+password auth kept; username + display name onboarding kept.) Email (magic link if feasible) → username + display name, in a `.sheet` over the live marketplace; "You can change this later" copy; everything else deferred to settings. Seller onboarding (Connect, payouts) becomes a checklist-gated publish flow (read.cv team-page pattern) rather than an upfront wizard.

---

## Verification checklist (run after each phase)

- [ ] Both themes, spot-check every touched surface (`--photo-filter` interactions in night mode included).
- [ ] `prefers-reduced-motion` on any new/repaired animation (dialog entrance, skeletons).
- [ ] Contrast on new chip tints and any recolored text — against the actual ground.
- [ ] Keyboard: tab order, focus visibility, Escape/trap on dialogs and menus.
- [ ] `(docs)` pages updated in the same PR as the CSS they describe.
- [ ] a11y E2E spec (`playwright`) still green; add cases for the new menu, typed confirm, and optimistic Q&A.
