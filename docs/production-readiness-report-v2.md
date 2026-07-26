# DRVN — Production Readiness Assessment v2

**Date:** 26 July 2026
**Supersedes:** `production-readiness-report.md` (v1)
**Scope:** Full re-review of `DRVN 2` after the Livesheet design port — every v1 finding re-verified against current code, plus a journey-based completeness audit, a Werkbank feature-gap inventory, and an implementation spec for the car-sheet Activity tab.
**Method:** Four parallel deep reviews (security/commerce re-audit, feature completeness by journey, Livesheet frontend, Werkbank comparison). Build, typecheck and lint were actually run — all three pass clean.
**Contains:** findings (§1–§8) and a full **remediation plan** (§9) with task-level acceptance criteria, a coverage account of every finding, the product decisions the plan needs from you, and a launch gate checklist.

---

## 1. Headline

**The front end moved a long way. The back end did not move at all.**

`git diff 9d83510..HEAD` covers 59 files: pages, components, CSS, and one migration fix. It touches **zero server actions, zero auth logic, and zero RLS policies**. So:

- **Frontend:** genuinely improved. 5 of 10 v1 findings fixed outright — real product metadata, a tokenized feed card with working comments (the fake "reply" chrome is now a real form), global focus-visible styles, fixed contrast, a real mobile nav in the app shell, and most dead duplication cleared.
- **Security & commerce:** **15 of 16 v1 findings are unchanged, byte-for-byte, at the same line numbers.** The service-role key was never rotated — the token's own issue date proves it — and a Postgres superuser password has since been added beside it.
- **Newly visible:** now that the journeys were traced end to end, the largest gap in the product isn't a defect at all. **The buyer journey is complete up to the moment money changes hands, and then it stops.**

The revised estimate to public launch is **8–12 weeks**, up from v1's 6–9. The increase is not slippage — it's scope that v1's file-level review didn't surface: order fulfilment, listing editing, activity editing, and account basics are all missing in *both* UI and schema.

---

## 2. Your specific questions answered

### "Is the buyer's side completed?"

**No. It is complete up to payment and absent after it.**

Orders only ever transition `pending → paid` (or `cancelled` on payment failure). Nothing anywhere in the codebase writes `shipped`, `completed`, or `refunded` — those statuses are declared in the schema and unreachable. Concretely, after a buyer pays:

| Buyer needs | Status |
|---|---|
| Order detail page | **Does not exist** — `/orders` is a flat list, there is no `/orders/[id]` |
| Shipping status / tracking | **No UI and no schema** — no `shipped_at`, `delivered_at`, tracking number, or carrier |
| Shipping address | **Never collected** — no column, no checkout step |
| Contact the seller after buying | **No channel** — `messages` are keyed to `offer_id`, so a buy-now or cart order has none |
| Cancel / refund / return / dispute | **Absent from UI and schema** |
| Mark received | Does not exist |
| Leave a review | Works — but fires at `paid`, so a buyer can review before receiving anything |

There are further buyer dead ends before payment: `/cart` **appears nowhere in the navigation** (one inbound link app-wide, in the `/orders` footer); a logged-out visitor sees no way to ask a question and no login prompt; an offer thread **freezes the instant it's declined**; and accepting an offer charges the buyer immediately with no confirmation step.

### "A flow to update information or post an update to activity"

You were right that this is missing.

- **Activity posts are create-only.** There is no `updateActivityPost` and no `deleteActivityPost` anywhere. Two create paths exist (quick composer and the rich block composer at `/garage/[id]/update/new`), but a filed post can never be edited, deleted, or have images added or removed. On the public post page there are no owner controls at all; in the composer, existing posts render as plain text spans — not even links. A typo in a title is permanent.
- **Listings are also create-only.** No `/listings/[id]/edit`, no `updateListing` action. Title, price, description, photos, category, condition and location are **immutable after publishing**. The only mutable field is status. A mistyped price can only be fixed by marking it sold and re-listing from scratch.
- **Profile editing is narrow and duplicated.** The same seven-field form ships twice (a modal on `/profile`, a section in `/settings`). **Avatar upload does not exist** — not even a stub — despite the `avatars` bucket being created in migration 0001 and three working uploaders elsewhere in the app to copy from.
- **Account basics are absent:** no change email, no change password, **no forgot-password/reset at all**, no delete account.

### "Make the activity section work as a tab"

Confirmed and specced — see §6. The port replaced real tabs with anchor jump-links. Your clarification (that "too blocky" was about corner radius, not the control) resolves it cleanly: build a genuine tab strip reusing the **`.filters` / `.fbtn` segmented control that already ships** on `/explore` and the marketplace, at the existing 6px radius step — never a 999px capsule. I've corrected the mis-recorded taste note in `design-mockups/LEDGER.md`, which had generalized your radius objection into "prefer jump-links over segmented controls" and caused the removal in the first place.

---

## 3. Status of every v1 finding

### Security & commerce — 15 of 16 unchanged

| v1 # | Finding | Status |
|---|---|---|
| C1 | `orders` INSERT forgeable → fake reviews on any user | **Still present.** Worse than reported: `orders` has no UPDATE *or* DELETE policy, so a victim can't remove forged orders naming them |
| C2 | `profiles` UPDATE has no `WITH CHECK` → self-escalate to `shop`, rewrite username | **Still present** |
| C3 | Live service-role key in `.env.local` | **Still present, never rotated** (token `iat` unchanged since project creation). A `SUPABASE_DB_PASSWORD` has since been added alongside it |
| H1 | No owner-update policy has `WITH CHECK` → reassign ownership of listings/cars/posts | **Still present.** Extends further: the `offers` UPDATE policy is also unchecked, so a buyer can rewrite their own offer's amount or reopen a declined one |
| M1 | Middleware fail-open on missing env / network error | **Still present** |
| M2 | Open redirect — `//evil.com` passes the `next` check | **Still present** |
| M3 | Upload type/size validated client-side only; public buckets, no MIME/size limits | **Still present** |
| H3 | Zero rate limiting on signup, offers, Q&A, comments | **Still present** |
| 9 | Double-purchase race (check-then-act, no lock) | **Still present** |
| 10 | No atomicity; `order_items` insert error discarded entirely | **Still present** |
| 11 | `payment.reference` never persisted; no payments table | **Still present** |
| 12 | Silent partial checkout; whole cart cleared | **Still present** |
| 13 | Currency hard-coded `"USD"`, never checked | **Still present** |
| 14 | Validation gaps (Q&A `parent_id`, no max lengths, unbounded offers, void error returns, sold→active) | **Still present** |
| 15 | No checkout idempotency | **Still present** |
| 16 | `user!` assertions relying on middleware | **Partially fixed** — the `(product)` layout now does its own `getUser()` + redirect, so this is defense-in-depth debt rather than a crash |

**New issues found this round:**

- **HIGH — provenance forgery.** `sell/actions.ts` inserts `source_car_id` from the form with **no ownership check**, and listings RLS validates only `seller_id`. Any seller can attach *any* car as the source of their part — falsely claiming a part came off someone else's well-known build. The correct pattern already exists three files away in `createRichActivityPost`; it just wasn't applied here. This directly attacks the trust layer the product is built on.
- **MEDIUM — arbitrary image URLs** stored unvalidated (`addCarImage` takes a raw client string with no scheme check, unlike the adjacent `video_url` guard) — enables hotlinking, tracking beacons, and `data:` payloads on public pages.
- **MEDIUM — activity comments/reactions bypass post visibility.** Their RLS is `using (true)` and the actions never check the parent post, so anyone can read and write comments on unpublished or private-car posts.
- **LOW —** client-controlled `revalidatePath` (cache-thrashing lever); cart cookie not `httpOnly`/`secure`; unbounded `emoji` text column.

### Frontend — 5 of 10 fixed

| v1 # | Finding | Status |
|---|---|---|
| 4 | Root metadata said "frontend-only mockup" | **Fixed** — real product title and description |
| 5 | Feed card on Figma hex + fake reply chrome | **Fixed** — pure Livesheet classes, zero hex, and the reply input is now a real working comment form |
| 7 | No focus-visible; poor contrast | **Partially fixed** — global focus ring added, `--dim` darkened to pass AA. Lightbox dialog semantics, tab semantics and `aria-live` on errors still missing |
| 9 | Two button systems, dead duplicated components | **Mostly fixed** — product code uses `.btn` throughout; the legacy shim is now fully dead code (see §7) |
| 1 | No mobile nav | **Fixed in the app shell** — real compact mode with an index sheet, Esc, scroll lock, reduced-motion path. **But a new gap replaces it:** see below |
| 2 | Zero loading/error/not-found boundaries | **Still present** — still zero, across 22 routes. The skeleton CSS written for this (`.ghostrow`, `.gbar`, `.gbox`) is defined and never used |
| 3 | No `generateMetadata`, OG, sitemap, robots | **Still present** — zero on all six dynamic public routes |
| 6 | `unoptimized` images, empty `next.config.ts` | **Still present**, and now three surfaces bypass `next/image` entirely with raw `<img>` |
| 8 | Errors swallowed in save/follow and server pages | **Still present** |
| 10 | Mockup/concept routes ship publicly | **Still present, and worse** — `/design-system` is now *stale* (it documents the deleted dark system) and is **linked from live Settings** |

**Highest-impact new frontend bug:** the marketing landing at `/` hand-rolls its own nav bar instead of using `LivesheetBar`, and those links are `display:none` at ≤980px with no index button to replace them. **On every phone and tablet, the landing page's navigation is completely invisible** — Explore, Market and Sign in all vanish. One file, one fix, and it's currently the first thing a mobile visitor sees.

---

## 4. Missing pages and routes

| Route | Purpose | Launch blocker? | Effort / schema |
|---|---|---|---|
| `/orders/[id]` | Order detail: items, address, status timeline, counterparty, contact, actions | **Yes** | L — needs `shipped_at`, `delivered_at`, tracking, carrier, address, and an `orders` UPDATE policy |
| `/listings/[id]/edit` | Edit a published listing | **Yes** | M — no schema change |
| Activity post edit/delete | Edit or remove a filed update, manage its images | **Yes** | M — schema already supports it |
| Account settings section | Change email, change password, delete account | **Yes** (legal + basic) | M — plus the FK fix below |
| `/login/forgot` + `/login/reset` | Password reset | **Yes** | S |
| Checkout step | Shipping address, per-seller breakdown, confirm | **Yes** for physical goods | M + address schema |
| Seller dashboard (`/listings`) | My listings, offers, unanswered questions in one place | Near-blocker — today it's five lines at the bottom of `/sell` | M |
| `/u/[username]` listings + reviews | Seller credibility | **Yes for a marketplace** — see below | M, no new route |
| `/messages` inbox | Non-offer buyer↔seller comms | Blocker unless order detail carries a channel | M |
| Followers / following lists | Make follows visible at all | Post-launch | S |
| `/orders/[id]/confirmation` | Real receipt | Nice-to-have | S |
| Payouts / earnings | Balance, history, Stripe onboarding | Bundled with real payments | — |

**Two that deserve singling out:**

**Seller profiles show no listings and no reviews.** `loadProfileView` returns vehicles and activity only. A buyer who clicks through from a listing lands on a page that cannot answer "what else are they selling?" or "are they credible?" — the exact two questions the PRD says the whole trust layer exists to answer. Both tables exist and are already publicly readable.

**Account deletion would fail even if you built it.** `orders.buyer_id` and `orders.seller_id` are the only FKs in the schema with **no `on delete` clause**. Deleting an auth user cascades to `profiles` and then dies on a foreign-key violation for anyone who has ever transacted. That's a GDPR/CCPA erasure blocker currently hidden by the fact that deletion was never built.

---

## 5. Missing flows inside existing pages

Ranked by how broken they feel:

1. **Counter-offer does not exist** — `respondToOffer` accepts only accept/decline, and the `offers` table has no counter fields. **Two live surfaces promise it in copy** ("accept, counter once, or let it lapse"; "accept, counter in the thread, or pass") and the design system specs a Counter button. Either build it or cut the copy today.
2. **Declined offer threads freeze** — the message composer only renders while status is `open`, so the conversation vanishes exactly when it's needed.
3. **Offer expiry is copy-only** — "a window that counts down" with no `expires_at` column and nothing that expires.
4. **No fulfilment controls** — no mark-shipped, no mark-received.
5. **Cart is not in the navigation** — one inbound link in the entire app.
6. **Logged-out visitors get the authed nav** — seven links that all bounce to `/login`, and no Log in / Sign up button anywhere.
7. **`/sell` promises drafts and preview** ("Nothing reaches the market until you publish it") — `createListing` always inserts `status: "active"`. The copy is false today.
8. **Sellers never learn a question was asked** — no notification, no unanswered-questions surface. In practice Q&A will go unanswered.
9. **Notifications cover 4 of ~12 specced events** — all derived at read time from follows/saves. No offers, sales, questions, comments, reviews, or price drops; no unread state, no badge; the "offers and sales land here too" empty state is false, and the `offers_sales` preference checkbox controls nothing.
10. **Onboarding is skipped on email/password login** — the callback route redirects OAuth users to onboarding when username is null, but `login()` goes straight to `/home`. Those users keep `username = NULL` forever and every profile link in the app renders `/u/null`. **Silent launch blocker.**
11. **`/saved` is partly dead** — "Keepers you follow" reads profile *saves*, but `SaveButton` is never rendered for profiles anywhere, so that section can never populate. Actual follows appear nowhere. No unsave control.
12. **`mod_items.linked_listing_id` is never read or written** — the PRD calls it "the connective tissue between a build and the marketplace," and it is dead in code.
13. Also: no marketplace pagination/sort/location filter, keyword search hits title only, listing gallery thumbnails are inert, no quantity control, no avatar upload, no car cover-image chooser, comments can't be deleted (the RLS policy for it exists and is unused).

---

## 6. The car sheet: Activity tab + "release a part from this car"

### 6.1 The tab

Build a reusable `SheetTabs` component (`src/components/ui/sheet-tabs.tsx`) with:

- **Real semantics** — `role="tablist"/"tab"/"tabpanel"`, `aria-controls`/`aria-labelledby`, roving `tabIndex`, arrow-key/Home/End navigation, and the `hidden` attribute (not a display class) so inactive panels are inert for screen readers and in-page find.
- **Livesheet styling via the control that already exists** — reuse `.filters`/`.fbtn` from `/explore` and the marketplace: mono 11px uppercase, `--paper-deep` ground, active state inverts to ink, radius at the existing 6px step. No new visual vocabulary, no capsule radius.
- **URL-backed state** — `?view=build|activity|forsale|gallery`, default omitted. The server reads and validates it so deep links render correctly on first paint; **all panels ship in the SSR HTML** so crawlers get the whole sheet from the bare URL; client switching uses `window.history.replaceState` (instant, no server round trip — note `router.replace` would round-trip on every click since the App Router has no shallow routing). Legacy `#about`/`#build` hashes map to their tab on mount.

Recommended tabs, marketplace-first: **THE BUILD** (default) · **FOR SALE** · **ACTIVITY** · **GALLERY**.

`ProfileBody` should migrate onto the same component, gaining ARIA, deep-linkability, and the Listings/Reviews tabs it needs.

### 6.2 "Release a part from this car" — the bigger find

**The car page never queries `listings` at all.** There is no "parts from this car" module, no link from a car or the garage to `/sell`, and `/sell` accepts no pre-fill. The `/garage` page's own copy promises "Release parts straight off its build lines" and then offers no way to do it.

The database is already ready: `listings.source_car_id` exists, and `mod_items.linked_listing_id` exists but is never used. This is missing product surface, not missing schema.

What it takes:

1. `/sell?car=<id>&mod=<id>` pre-fill — ownership-checked mod fetch, seeded title/category/car select (~3h).
2. Persist `linked_listing_id` on create, closing the mod→listing loop (~45min).
3. Owner `[ RELEASE ]` action per build line — **`.bline--own` and `.relbtn` already exist in `globals.css` and are unused**, so zero new CSS (~1.5h).
4. Public "For sale from this car" panel — active listings live, sold ones desaturated, plus a listed/sold KPI pair (~2h) + an index on `source_car_id`.
5. Garage per-car "Release a part" action (~1.5h).

**Suggested slices:** the tab work is ~7h; the release-a-part thesis work is ~9h; Werkbank-grade density (keeper plate, KPI deck, "also in this workshop", hero callouts) is a further ~8h.

---

## 7. Werkbank features not in the live app

Werkbank's own brief states its thesis as *"the car profile is the trust layer"* — which is **not** DRVN's thesis. Several of its most elaborate modules optimize for the wrong headline and are marked SKIP on that basis, not on quality. It was also a static prototype: many of its best numbers (watch counts, on-time %, dispute counts, sparklines) have no backing data, and porting them would mean shipping invented figures.

**Effort: S ≤ 4h · M 4–12h · L 12h+**

### Recommended

| Feature (Werkbank page) | What it does | Live equivalent | Effort |
|---|---|---|---|
| **Listings management console** (`listings.html`) | Status-filtered table of your listings with **Edit / Pause / End** per row | `/sell` has a bare list with only Mark sold / Relist — **no edit at all** | L |
| **Offers inbox with inline Accept/Counter/Decline** (`index.html`) | Open offers on the seller dashboard with actions in place | Buried at `/orders`, a route away from where sellers land | M |
| **Order pipeline** (`orders.html`) | Offer accepted → Paid → Dispatch due → Delivered as a 4-node pipe | A single status chip. `.pipe` is already a contracted Livesheet component | M |
| **Dispatch form with tracking** (`orders.html`) | Tracking required; "Mark dispatched" advances the pipeline | None — without it, `shipped` is unreachable | M + columns |
| **Post-sale buyer↔seller messaging** (`orders.html`) | Message the counterparty from the job card | Messaging exists but **only on open offers** — it disappears on acceptance. `messages` already carries `listing_id` | M |
| **Payout breakdown plate** (`orders.html`) | Sale − fee − shipping = payout as ruled money lines | One inline meta string. Sellers read this number more than any other | S |
| **Profile Listings + Reviews tabs** (`profile.html`) | Overview / Listings / Reviews / Activity | About / Activity only — a seller profile with no shopfront | M |
| **Seller rating + sales count** (`profile.html`) | Credibility at a glance | None on `/u/[username]` (skip on-time % and disputes — no backing data) | S |
| **Buyable-callout hero** (`home-v2.html`) | Annotated teardown photo where each callout is a purchasable lot | `/` hero doesn't sell | M |
| **"From the same car" cross-sell** (`part.html`) | Other parts released from this part's source car | Cross-sell is by seller only. One query; the thesis compounding on itself | S |
| **Provenance: the four trust facts** (`part.html`) | What car, when fitted, when removed, what it was paired with | Source-car link only. *(Skip the `PLATFORM-VERIFIED` badge — no verification system behind it)* | M + columns |
| **Offer floor validation** (`part.html`) | Rejects lowballs below a seller-set floor | None. Kills the top seller annoyance for one column | S |
| **Thumbnail-swap photo strip** (`part.html`) | Click a thumb to swap the main photo | Thumbs are inert — on a page whose job is inspecting a used part | S |
| **Filter tabs with live counts** (`explore.html`) | `Cars 4 · Build logs 3 · Parts 3` | Filters without counts | S |
| **Price sort** (`market.html`) | Price ↑ / ↓ | Hard-ordered by date *(skip "most watched" — no counter exists)* | S |
| **Default garage car for fitment** (`settings.html`) | Choose which car "FITS" means | Matches against *any* garage car, so the hint is vague | S |
| **Fee schedule in settings** (`settings.html`) | What DRVN takes, plainly | Not shown. Fee opacity is a trust cost | S |
| **Account closure flow** (`settings.html`) | Destructive confirm defaulting to cancel | None — and it's a compliance obligation | M |
| **Toast confirmations** (throughout) | Transient confirmation that an action fired | **None in the app** — `.toast` is specced and unbuilt; server actions currently succeed silently | S |
| **Real panel tabs** (`car.html`, `profile.html`) | Deep-linkable tab switching | Jump-links / client state — see §6 | — |

### Deferred

**Three-step purchase sheet** (right UX, should land *with* real payments) · **mod fitted/removed dates** (small migration; unlocks the provenance line) · **email column on the notification matrix** (until email sending exists) · **count-up numbers** (once there are real KPIs).

### Skipped, with reasons

- **Documents / provenance file with per-doc access requests** (`garage.html`, `car.html`) — needs a table, a bucket and an access-request protocol, and it gives provenance its own top-level tab. That is precisely the inversion where documentation becomes the headline. If receipts matter later, hang them off a *listing*, where they close a sale.
- **`PLATFORM-VERIFIED` / `SELLER-STATED` verification tiers** — a green "verified" chip DRVN cannot stand behind is fake-verification chrome and a liability.
- **Condition report with measured-vs-minimum gauges** — a per-category measurement schema plus seller measurement discipline, for one category of wear parts.
- **Sparkline KPI charts**, **watch counts**, **on-time %**, **dispute counts** — no backing data; porting them means inventing numbers.
- **Numbered sheet refs / `PLATE 01…08` / `REGISTRY NO.`** — density theatre. It makes a prototype look rigorous and a product look like it's talking to itself. Livesheet's `microlabel` does the job with real words.
- **"Total invested" on the mod sheet** — needs a purchase price per mod that nobody will enter. *(The "currently for sale" half is worth building and is in the recommended list.)*
- **90-day order archive** — windowing without volume.

### Schema impact

- **Buildable today, no migration:** offers inbox, per-listing offer history, listing edit/pause, same-car cross-sell, price sort, payout breakdown, post-sale messaging, profile listings/reviews tabs, rating + sales counts, fee schedule, toasts, thumb-swap, filter counts.
- **Small migrations:** `mod_items.fitted_at/removed_at/status`; `orders.tracking_number/carrier/shipped_at`; `listings.offer_floor_cents` + `paused` status; `profiles.default_car_id`; `listings_source_car_idx`.
- **New subsystems (all SKIP/DEFER above):** documents + access requests, watch/view counters, disputes, shipping-performance stats, timeseries.

---

## 8. Design-system health

The Livesheet port is **high quality where it landed**. The entire component layer of `globals.css` contains zero hardcoded hex — everything resolves through custom properties, with night mode as a pure remap. Product routes carry no legacy utility classes.

Three systemic issues:

1. **Signal-red discipline is broken in five places** — red is being spent on identity and selection rather than "happening now": every build-section heading on the car page, every notification-group heading in settings, all five sell-form step numerals, the "Here" chip in the nav index, and the active tab in `TabNav`. Five one-line edits.
2. **The signature device is unbuilt.** `.callout` / `.callout__leader` — the drafting leader lines that name the whole concept — exist in CSS and appear on **no route**. So do `.pipe`, `.capsule`, `.guide`, `.deck--kpi`, the entire `.ghostrow` loading language, and the `Countdown` component (exported, never imported). 44 defined-but-unused classes in total. **Nothing in the shipped app actually ticks** — the "live dimension" thesis is currently decoration. Either wire up the car-sheet hero callouts and one real countdown, or cut the CSS so the system stops describing something the product doesn't do.
3. **~5,700 LOC of dead weight** ships to production: `/mockup` (1,137), `/design-system` (1,672, now stale and still linked from live Settings), three concept routes (1,462), ~420 lines of pre-Livesheet concept CSS on every page, plus five fully dead component files. The `Button` component survives only for `/design-system` and — because `--color-accent` now aliases `--color-live` — renders as a **red pill**, a component the design system explicitly bans.

Also: the landing page renders `drvn-data.ts` seed content as live "Sheets being drawn" and "Parts off a live sheet", against the system's own "no fake data" rule. The stat band beside it handles this honestly (`1`, `0`, `48h`) and shows the right instinct.

---

## 9. Remediation plan

### 9.0 How to read this

Eight phases, ordered so that each one is safe to stop at. Effort is in **dev-days for one person working with AI assistance** — 1d ≈ a focused day, not an 8-hour estimate for a team. Every task carries a *Done when* line so completion is testable rather than felt.

Two ordering rules drove the sequence:

1. **Nothing ships before the data layer is trustworthy.** The database — not the server actions — is the real security boundary, because anyone with the anon key can query PostgREST directly. R1 is small in code and the largest single risk reduction in the plan.
2. **Fix the transaction boundary before building on top of it.** Four separate commerce findings (race, atomicity, partial checkout, idempotency) are facets of one missing transaction. Fixing them together in R2 is cheaper than fixing them individually, and R3/R6 both sit on that foundation.

Phase totals: **R0** 0.25d · **R1** 4d · **R2** 4d · **R3** 10d · **R4** 8d · **R5** 8d · **R6** 13d · **R7** 5d, plus ~3d of continuous work → **~55 dev-days (8–12 calendar weeks)**.

---

### R0 — Contain the credential exposure · 0.25d · do today

**R0.1 Rotate both secrets.** Rotate the service-role key and the Postgres password in the Supabase dashboard. The key's `iat` proves it survived the v1 audit unrotated, and a DB superuser password has since joined it in the same file.
*Files:* Supabase dashboard, `.env.local`
*Done when:* the old key returns 401 against the REST API, and neither value exists anywhere outside the deploy platform's secret store and your local `.env.local`.

**R0.2 Fail fast on missing env.** `src/lib/supabase/admin.ts` builds a client from `undefined!` and fails confusingly at query time — mid-checkout — rather than at boot.
*Files:* `src/lib/supabase/admin.ts`, new `src/lib/env.ts`
*Done when:* the app throws a named error at startup listing any missing required variable.

---

### R1 — Make the data layer trustworthy · 4d

Almost all of this is one migration. Assume an attacker holds the anon key and a valid user JWT, and test with raw REST calls, not through the UI.

**R1.1 Migration `0006` — lock down UPDATE policies.** Add `WITH CHECK` to every owner-update policy so ownership columns are immutable: `profiles` (pin `profile_type`, control `username` through an action), `cars.owner_id`, `listings.seller_id`, `activity_posts`, and `offers` (pin `amount_cents`, `buyer_id`, and forbid reopening a closed offer). ~6 lines each.
*Fixes:* profile_type self-escalation to `shop`; ownership reassignment of listings/cars/posts; buyers rewriting their own offer amounts or reopening declined offers.
*Done when:* for each table, a raw REST `PATCH` attempting to change the ownership/role/amount column is rejected, and a legitimate edit through the UI still succeeds.

**R1.2 Migration `0006` — kill the forged-order chain.** Drop the client `orders` INSERT policy entirely (checkout runs through the service-role client, so no client ever needs it) and add the missing UPDATE/DELETE policies. Constrain `reviews.reviewee_id` to the counterparty of a real order, block self-review, and add author UPDATE/DELETE policies so reviews are moderatable.
*Fixes:* the single worst finding — forging `paid` orders naming any victim as seller, then posting unlimited fake reviews on them, with no way for the victim to remove them.
*Done when:* a raw `POST /orders` is rejected; a review insert referencing a fabricated order is rejected; a self-review is rejected; a legitimate post-purchase review still works.

**R1.3 Migration `0006` — fix comment/reaction visibility.** Replace `using (true)` on `activity_comments` and `activity_reactions` with policies that inherit the parent post's visibility (`published_at is not null and car.is_public`), and add the parent-post visibility check to `addComment`/`toggleReaction`.
*Fixes:* anyone can read and write comments on unpublished or private-car posts.
*Done when:* commenting on an unpublished post fails from both the API and the action, and its existing comments are not readable.

**R1.4 Migration `0006` — enable erasure.** Give `orders.buyer_id`/`seller_id` an explicit `on delete` behaviour (recommend `set null` plus a denormalized counterparty label snapshot, so order history survives account deletion). Add `on delete` to `order_items.listing_id` reasoning explicitly about whether sold listings may ever be hard-deleted.
*Fixes:* account deletion would fail on a foreign-key violation for any user who has ever transacted — a GDPR/CCPA erasure blocker.
*Done when:* deleting a test user who has both bought and sold succeeds, and their orders remain readable by the counterparty.

**R1.5 Ownership check on `source_car_id`.** `sell/actions.ts` inserts the form value with no verification. Copy the pattern already in `createRichActivityPost`.
*Fixes:* any seller attaching any car as their part's source — provenance forgery against the exact trust layer the product is built on.
*Done when:* submitting another user's car UUID is rejected server-side.

**R1.6 Validate stored URLs.** Scheme-check every client-supplied URL before insert: `addCarImage`, the `sell` `image_urls` array, activity image URLs. The adjacent `video_url` guard is the model.
*Fixes:* off-site hotlinking, tracking beacons, and `data:` payloads rendered on public pages.
*Done when:* a non-`https://` URL, and an `https` URL outside the Supabase storage host, are both rejected.

**R1.7 Fail closed in the proxy.** `src/lib/supabase/proxy.ts` returns `next()` with no gating when env is missing/malformed or Supabase errors. In production, redirect product routes to `/login` and log an error instead.
*Done when:* with env vars removed, requesting `/garage` in a production build redirects rather than rendering.

**R1.8 Close the open redirect.** `next.startsWith("/") && !next.startsWith("//")` and reject values containing `:`.
*Done when:* `/login?next=//evil.com` lands on `/home`.

**R1.9 Storage limits.** Set `allowed_mime_types` and `file_size_limit` on `avatars`, `car-images`, `activity-images`, `listing-images`. Client-side checks are advisory only.
*Done when:* uploading an `.html` file or a 50MB image via the storage API fails.

**R1.10 Rate limiting.** Supabase auth rate limits on signup, plus per-user cooldowns on `makeOffer`, `askQuestion`, `addComment`, and `toggleReaction`.
*Done when:* a scripted 100-request burst against each is throttled.

**R1.11 Input bounds.** Max lengths on every free-text column and its action (`title`, `description`, `body`, `compatibility_notes`, comments, offer messages, review bodies); cap offer amounts below `int4` overflow; bound `activity_reactions.emoji`; validate Q&A `parent_id` belongs to the same listing.
*Fixes:* raw Postgres errors surfaced to users, storage abuse, cross-listing thread corruption.
*Done when:* each field rejects over-length input with a readable message, and a 10-digit offer is refused rather than erroring.

**R1.12 Cookie and revalidation hygiene.** Make the cart cookie `httpOnly` + `secure`; replace client-supplied `revalidatePath` arguments with a server-side allow-list.
*Done when:* the cart cookie is unreadable from `document.cookie`, and passing an arbitrary path to a social action revalidates nothing.

---

### R2 — Make checkout atomic and honest · 4d

**R2.1 Move the purchase path into one Postgres function.** A single `rpc` running in one transaction: verify listing availability with a conditional update (`... where id = any($1) and status = 'active'`, checking affected rows **before** charging), insert the order and its items, and return a per-item result set. Call it from `purchaseListings` and the accept branch of `respondToOffer`.
*Fixes together:* the double-purchase race (two buyers both getting `paid` orders for one part); non-atomic five-call sequences that can leave paid orders with zero items or sold listings with open offers; the discarded `order_items` insert error; and the missing idempotency (the conditional update *is* the idempotency guard).
*Done when:* two concurrent buy-now requests for the same listing produce exactly one paid order and one clear rejection, verified by a test that fires both in parallel.

**R2.2 Add a `payments` table and provider references.** Persist `payment.reference` against the order, with provider, status, amount, and currency.
*Fixes:* the payment reference is currently thrown away, making reconciliation, refunds, and webhooks impossible later.
*Done when:* every paid order has a joinable payment row, and a payment can be looked up by provider reference.

**R2.3 Surface partial checkout truthfully.** Return per-item outcomes; tell the buyer exactly what was and wasn't bought; clear only purchased IDs from the cart cookie; never report failure after a seller has been charged.
*Fixes:* items silently vanishing, the whole cart being cleared regardless, and "Payment failed" shown when half the cart actually succeeded.
*Done when:* checking out a cart whose second item just sold shows a specific message naming it, leaves it out of the order, and leaves the cart holding nothing already purchased.

**R2.4 Fix currency handling.** Thread `listing.currency` through order math; refuse mixed-currency baskets per seller; stop hard-coding `"USD"` in two places.
*Done when:* a non-USD listing produces an order in its own currency, and a mixed basket is refused with a clear message.

**R2.5 Stop swallowing failures.** `respondToOffer`, `sendOfferMessage`, `setListingStatus`, `removeFromCart`, and the save/follow toggles all currently return `void` or discard `{ error }`. Give every mutation a typed result and a rendered outcome. Guard the sold→active flip (a listing with a paid order must not return to sale).
*Done when:* every mutation path shows either success or a specific error, and no server action discards an error result.

**R2.6 Timestamps and transitions.** Add `updated_at` triggers and status-transition timestamps on `orders`, `offers`, `listings`.
*Done when:* every status change is timestamped without application code setting it.

**R2.7 First tests — the money path.** Install Vitest and cover: the concurrent-purchase guard, fee math, cart dedupe/cap, multi-seller partial failure, and offer-accept authorization.
*Fixes:* zero tests on the one surface where a logic slip is a privilege escalation, since it runs on the service-role client.
*Done when:* `npm test` runs in CI and fails if the sold-guard regresses.

---

### R3 — Close the journeys · 10d

The biggest new body of work, and the reason the estimate grew. Nothing here is a nicety: this is the difference between taking money and running a marketplace.

**R3.1 Order lifecycle schema.** Add `shipped_at`, `delivered_at`, `tracking_number`, `carrier`, a shipping address (snapshotted onto the order, not read live from the profile), an `orders` UPDATE policy, and the `disputed` status. 1d.
*Done when:* an order can legally move `paid → shipped → delivered → completed` at the database level, and both parties can read but only the right party can write each transition.

**R3.2 `/orders/[id]` — order detail.** Items, prices, fee/payout, shipping address, counterparty, a status timeline (using the `.pipe` component already specced in the design system), and the actions appropriate to each side. 2d.
*Fixes:* the deepest dead end in the product — after paying, a buyer currently has no page to go to.
*Done when:* both buyer and seller can open an order, see its full state, and act on it.

**R3.3 Fulfilment actions.** Seller "Mark dispatched" with tracking (required); buyer "Mark received"; automatic `completed` transition. Gate reviews on `delivered`/`completed` rather than `paid`. 1d.
*Fixes:* `shipped` and `completed` are currently unreachable strings in the schema, and buyers can review before receiving anything.
*Done when:* a full lifecycle can be driven end to end from the UI by two test accounts, and a review cannot be left before delivery.

**R3.4 Post-sale messaging.** `messages` already carries `listing_id`; thread on the order, not the offer, so cart and buy-now purchases have a channel. Unfreeze declined-offer threads. Add the missing `messages.read_at` UPDATE policy. 1.5d.
*Fixes:* no way to contact a seller after buying; conversations vanishing the moment an offer is declined; `read_at` being permanently unwritable.
*Done when:* a buy-now purchaser can message their seller and vice versa, and a declined offer's history stays readable and continuable.

**R3.5 `/listings/[id]/edit`.** Edit title, price, description, category, condition, location, compatibility notes, and add/remove photos. Expose archive and delete. Snapshot price history so price-drop notifications become possible later. 1.5d.
*Fixes:* listings are immutable after publishing — a mistyped price can only be fixed by marking sold and re-listing.
*Done when:* a seller can correct any field of a live listing, and the change is reflected on the public page.

**R3.6 Activity post edit/delete.** `updateActivityPost` and `deleteActivityPost`, an edit route, owner controls on the public post page, and image add/remove on an existing post. Also fix `saveModItems`, which deletes and re-inserts every row and would destroy `linked_listing_id`. 1.5d.
*Fixes:* your flagged gap — posts are create-only, so a typo in a title is permanent.
*Done when:* an owner can edit and delete their own post and manage its images, and mod edits preserve listing links.

**R3.7 Account basics.** Change email, change password, forgot/reset password (`/login/forgot`, `/login/reset`), and delete account with a confirm step that defaults to cancel. 1.5d.
*Fixes:* no password reset at all — a locked-out user is locked out permanently — and no erasure path.
*Done when:* a user can reset a forgotten password by email and delete their account, with data removed or anonymized per R1.4.

**R3.8 Fix onboarding enforcement.** `login()` redirects to `/home` unconditionally, so email/password users never see onboarding and keep `username = NULL` forever, making every profile link render `/u/null`. Gate on username like the OAuth callback already does. 0.25d.
*Done when:* a fresh email/password signup cannot reach `/home` without a username.

**R3.9 Seller profile = shopfront.** Extend `loadProfileView` to return listings, rating, review list, and follower count; add Listings and Reviews tabs. 1d.
*Fixes:* a buyer clicking the seller from a listing lands on a page that cannot answer "what else are they selling?" or "are they credible?" — the two questions the trust layer exists to answer. Reviews are currently written and displayed nowhere but a single average number.
*Done when:* a seller's public profile shows their live listings and their reviews with text.

**R3.10 Checkout step.** Shipping address collection, per-seller breakdown (make the one-order-per-seller split visible *before* paying), quantity control, and an explicit review step. Add buyer confirmation before an accepted offer charges them. 1.5d
*Fixes:* no address is ever collected for physical goods; a mixed cart silently becomes N orders; accepting an offer charges the buyer instantly with no confirmation.
*Done when:* a buyer sees exactly what they're paying, to whom, and where it ships, before money moves.

**R3.11 Navigation and logged-out shell.** Cart in the nav with an item badge; `/sell` in the persistent nav; hide gated links from logged-out visitors and add Log in / Sign up; add a login CTA to Q&A; add the auth redirect on `/` so logged-in users skip the pitch. 0.75d.
*Fixes:* `/cart` has exactly one inbound link app-wide; logged-out visitors get seven links that all bounce to `/login` and no way to sign in.
*Done when:* a logged-out visitor can navigate the public app and sign in from anywhere, and a logged-in user never sees the marketing page.

---

### R4 — Ship the shell · 8d

**R4.1 Fix the landing page's mobile nav — do this first.** `src/app/page.tsx` hand-rolls its own bar whose links are `display:none` at ≤980px with no index button. Replace with a public variant of `LivesheetBar`. 0.25d.
*Fixes:* on every phone and tablet, the marketing page has no visible navigation at all. One file; highest impact per line in the whole plan.
*Done when:* at 375px, Explore / Market / Sign in are reachable from `/`.

**R4.2 Lifecycle boundaries.** `loading.tsx` (using the `.ghostrow`/`.gbar`/`.gbox` skeletons already written and unused), `error.tsx`, `not-found.tsx` per route group, and `global-error.tsx`. Wrap the tail queries on `/listings/[id]` and `/orders` in `Suspense`. 1.5d.
*Fixes:* zero boundaries across 22 routes; every navigation blocks with no feedback and every error hits Next's unstyled default page.
*Done when:* every route group has all three files, and a thrown error renders branded.

**R4.3 Stop hiding query failures.** Keep `error` from every server-page destructure and render an error state. Build the `.toast` component (specced in the design system, never implemented) and wire it to mutation outcomes from R2.5. 1d.
*Fixes:* a failed query is currently indistinguishable from an empty state, and successful actions confirm nothing.
*Done when:* a forced query failure shows an error tile, not "nothing here yet."

**R4.4 SEO pass.** `metadataBase` + `openGraph`/`twitter` on the root; `generateMetadata` on all six dynamic public routes; a dynamic OG image route for listings and cars; `sitemap.ts`; `robots.ts` disallowing the mockup and concept routes. 1.5d.
*Fixes:* the PRD names SEO an acquisition channel and it is currently zero — every car and listing share unfurls as the site-wide tagline.
*Done when:* a listing URL previews with its own title, description, and image, and `/sitemap.xml` lists live entities.

**R4.5 Image pipeline and headers.** Remove `unoptimized`, add Supabase `remotePatterns`, route the three raw `<img>` sites through `Media`, and add security headers (CSP, HSTS, X-Frame-Options) in `next.config.ts` — currently empty. 0.75d.
*Done when:* marketplace images serve resized/AVIF, and headers show up in a response.

**R4.6 Delete the dead weight.** Remove `/mockup`, `/home-alt`, `/home-brutalist`, `/home-anthropic`, ~420 lines of pre-Livesheet concept CSS, `components/drvn/ui.tsx`, `ui/sidebar.tsx`, `(product)/placeholder.tsx`, `ui/button.tsx`, `CountUp.tsx`, `Reveal.tsx`, and the Settings links to internal pages. Either re-port `/design-system` to Livesheet or delete it — it currently documents the deleted dark system and renders a red pill for a component the system bans. ~5,700 LOC out. 1d.
*Done when:* the production build contains no route the product doesn't use, and `git grep` finds no importers of the removed files.

**R4.7 Accessibility pass.** One `<Sheet>` primitive with `role="dialog"`, `aria-modal`, Esc, focus trap, and focus restore — applied to the gallery lightbox, offer sheet, and add-car sheet, and closing the trap/restore gap in the nav index. `role="alert"` + `aria-invalid` + `aria-describedby` on form errors, and change `.field__err` to render on presence instead of needing an inline `display` hack at nine sites. Announce async state on save/follow/processing. Fix heading order (`h1 → h3/h4` skips) and the two unlabelled glyphs. 1.5d.
*Done when:* every modal traps focus and closes on Esc, and a submitted invalid form announces its error.

**R4.8 Responsive cleanup.** Drop `!grid-cols-3` in `add-car-form`; replace bare `grid-cols-2` in `sell-form` with `.field--row`; add a 2-column step to `.mkt`/`.deck--two` for the 641–980px band (currently 3 → 1 with nothing between); add `max-w-none` to the three uncapped `.ctl` textareas. 0.5d.
*Done when:* every form and grid is usable at 375px and at 800px.

**R4.9 Red discipline.** Five one-line edits so signal red means "happening now" rather than identity or selection: build-section headings, notification-group headings, sell-form step numerals, the nav "Here" chip, and `TabNav`'s active tab. Also remove the hardcoded `chip--ok "Fitted"` stamped on every mod row regardless of state. 0.25d.
*Done when:* no static label renders in `--live`.

**R4.10 Observability and CI.** Sentry (or equivalent) with server-action instrumentation; structured logging on the commerce path; GitHub Actions running typecheck + lint + build + tests on push. 0.75d.
*Fixes:* a failed `order_items` insert currently leaves no trace anywhere.
*Done when:* a deliberately thrown server-action error appears in the dashboard with request context, and CI blocks a failing push.

**R4.11 Database performance.** Indexes on `orders.buyer_id`, `orders.seller_id`, `order_items.order_id`, `reviews.reviewee_id` (queried on **every** listing view), `reviews.order_id`, `listings.created_at` (the default marketplace sort), `listings.source_car_id`, `activity_posts.author_id`/`published_at`, `messages.recipient_id`, and `saves`/`follows` on `(target_type, target_id)`. Replace the seller-rating query that fetches every review row with an aggregate. Bound the unbounded `/orders` queries. 0.75d.
*Done when:* `EXPLAIN` shows index scans on the listing-detail and orders queries.

**R4.12 Legal and policy pages.** Terms of Service, Privacy Policy (OAuth providers require one), cookie disclosure, fee schedule, prohibited items, and a dispute/refund policy. Storage cleanup on car deletion — images currently orphan forever. 1d.
*Done when:* all pages are reachable from the footer and referenced at signup, and deleting a car removes its stored images.

---

### R5 — Car sheet, activity tab, and Werkbank ports · 8d

Full spec in §6 and §7.

**R5.1 `SheetTabs` component.** Real `role="tablist"` semantics, roving `tabIndex`, arrow/Home/End keys, `hidden` panels, URL-backed `?view=` state synced with `history.replaceState`, legacy hash mapping. Styled with the existing `.filters`/`.fbtn` control at the 6px radius step. 1d.
*Done when:* a car's activity is deep-linkable, keyboard-navigable, and present in the server HTML.

**R5.2 Car sheet tabs.** Rewire `car-tabs.tsx` onto `SheetTabs` with four panels (Build / For sale / Activity / Gallery); add `generateMetadata` with a canonical URL. Migrate `ProfileBody` onto the same component, absorbing R3.9's Listings and Reviews tabs. 1.5d.

**R5.3 "Release a part from this car."** `/sell?car=&mod=` pre-fill with an ownership-checked mod fetch; persist `mod_items.linked_listing_id` (currently dead in code despite the PRD calling it "the connective tissue between a build and the marketplace"); `[ RELEASE ]` per build line using the unused `.bline--own`/`.relbtn` CSS; garage per-car action. 2d.
*Done when:* an owner can list a part directly off a build line, and the resulting listing shows on that line.

**R5.4 "For sale from this car" panel + KPIs.** Query listings by `source_car_id` (the car page currently never queries listings at all); active live, sold desaturated; listed/sold KPI pair. 1d.

**R5.5 Werkbank ports, highest value first.** Listings management console (absorbing R3.5's edit route and per-listing offer history); order pipeline + dispatch form (absorbing R3.3); payout breakdown plate; offers inbox on the dashboard; same-car cross-sell on part pages; thumbnail-swap gallery; filter counts; price sort; offer floor; default garage car for fitment. 2.5d.

---

### R6 — Real payments · 13d

The `PaymentProvider` interface is a naming placeholder, not a working boundary: it assumes a synchronous inline charge. The checkout pages and actions **will** change.

**R6.1 Confirm the processor.** Stripe Connect is assumed throughout; confirm before building. 0.25d.
**R6.2 Schema and Connect model.** `profiles.stripe_account_id`, payout/transfer tracking, expanded order states (`requires_action`, `payment_failed`, `disputed`), and a **`reserved` listing state with expiry** — mandatory once confirmation takes minutes rather than milliseconds, or R2.1's race window reopens for the whole 3DS duration. 2d.
**R6.3 Decide the multi-seller strategy.** N payment intents per checkout, or separate charges and transfers (which needs an order-group concept the schema lacks). Decide before writing code. 0.5d.
**R6.4 Flow rewrite.** Create-intent server action → client confirmation UI (Elements, 3DS/SCA) → **webhook route with signature verification as the single place** that marks orders paid and listings sold. 4d.
**R6.5 Seller onboarding.** Connect onboarding/KYC, payout schedule, and the Settings billing section wired to real balances. 2.5d.
**R6.6 Refunds and disputes.** `refund()`, `getStatus()`, and dispute hooks on the interface; buyer-facing cancel/refund request; seller and admin handling. 2.5d.
**R6.7 Idempotency keys** on every provider call. 0.25d.
*Phase done when:* a real card charge moves real money to a connected test seller, the webhook is the only thing that marks it paid, a refund works end to end, and a 3DS challenge resolves correctly.

---

### R7 — Launch surface · 5d

**R7.1 Counter-offer — or cut the copy.** Two live surfaces promise "accept, counter once, or let it lapse" and the design system specs a Counter button, but `respondToOffer` accepts only accept/decline and the `offers` table has no counter fields or seller-side insert path. Either build it (needs `counter_amount_cents`, `last_actor_id`, a seller insert policy) or remove the promise today. 1.5d if built.
**R7.2 Offer expiry and withdraw.** `expires_at` plus a scheduled expiry job; wire the unused `withdrawn` status to a UI action. The copy already promises a countdown that doesn't exist. 0.75d.
**R7.3 Notification coverage.** Move from four read-time-derived events to a real `notifications` table covering offers, sales, questions, comments, reactions, reviews, and order status; add unread state, read-marking, and a bell badge; fix links that point at `/profile` instead of the actor and at `/cars/` when a car is missing; make the `offers_sales` preference actually control something. 1.5d.
*Fixes:* sellers are never told a question was asked, so Q&A will go unanswered in practice.
**R7.4 Marketing home on real data.** Replace `drvn-data.ts` seed content currently presented as live "Sheets being drawn," or label it honestly as the stat band already does. 0.5d.
**R7.5 Marketplace completeness.** Pagination or cursor (currently a hard 48 with no offset, and the fit filter applied *after* the limit so filtered pages can be wrongly empty), sort control, location filter, and search across description/brand/compatibility rather than title only. Add `pg_trgm` or FTS to replace the unindexable `ilike`. 1d.
**R7.6 `/saved` fixes.** Wire save-a-seller (the section can never populate today because `SaveButton` is never rendered for profiles), surface actual follows, add unsave. 0.5d.
**R7.7 Golden-path E2E.** Playwright over signup → add car → list part → buy → fulfil → review. 1d.

---

### Continuous · ~3d spread across phases

**C.1 Docs in step.** Update `CHANGELOG.md` per change; refresh PRD §6 and §9, which still describe the deleted sidebar and the pre-Livesheet tokens; keep `docs/livesheet-inventory.md` accurate as components land.
**C.2 Generate `database.types.ts`** from the schema instead of hand-maintaining it — it will drift on the next migration.
**C.3 Test as you go.** Every R3–R7 task gets at least a smoke test; commerce paths get real cases.

---

### 9.1 Coverage account

Every finding in §1–§8 maps to a task above. The ones **deliberately not** in the launch plan, with reasons:

| Deferred item | Reason |
|---|---|
| AI mod parsing | Heuristic parser works and the UX won't change when AI lands. Post-launch. |
| Fitment engine (authoritative) | The make/model hint is honest as a hint. Needs a real fitment dataset — a separate project. Fix only the narrow bugs: it never appears on listing detail, and it requires `source_car_id` to be set. |
| Recommendations P2/P3 | P1 works; build-goal input doesn't exist yet. |
| Shop/business profiles | `profile_type` column only. No launch dependency once R1.1 stops users self-granting it. |
| General DM inbox | R3.4's order-scoped messaging covers the real need. Revisit on demand. |
| Documents/provenance vault | §7 — would make documentation the headline, against the product thesis. |
| Verification badges, condition gauges, sparklines, watch counts, on-time %, disputes-count stats | §7 — no backing data; shipping them means inventing numbers. |
| Price-drop notifications | Needs the price history R3.5 starts capturing. Post-launch, then cheap. |
| Follower lists, comment threading, comment edit | Low value pre-audience. Comment *delete* is in R4.7's sweep (its RLS policy already exists, unused). |
| Live-dimension callouts, countdowns, KPI decks | §8 — decide in R5: wire the car-sheet callouts and one real countdown, or cut ~44 unused classes so the system stops describing what the product doesn't do. |
| Car cover-image chooser, image reordering, alt text | Real gaps, no launch dependency. Post-launch polish. |
| `.rv` opacity-until-hydration | Content is invisible with JS off. Worth fixing in R4.7 if cheap; otherwise accepted risk. |
| The 40 `!important` sites | Symptom, not defect. Clean opportunistically. |

### 9.2 Decisions needed from you

These change what gets built, and three of them block their phase:

1. **Counter-offer: build or cut?** (blocks R7.1) — the copy promises it in two places today.
2. **Drafts on `/sell`: build or cut?** — `/sell` says "Nothing reaches the market until you publish it" and publishes immediately. Cutting the sentence is 5 minutes; building drafts is half a day.
3. **Payment processor: confirm Stripe Connect?** (blocks R6)
4. **Multi-seller checkout: N intents or separate charges and transfers?** (blocks R6.4)
5. **Shipping: flat rate, seller-set, or buyer-arranged?** (blocks R3.10 — no shipping cost is modelled anywhere)
6. **Account deletion: anonymize or restrict?** (shapes R1.4)
7. **Which Werkbank ports, and in what order?** (shapes R5.5 — my ranking is in §7)
8. **`/design-system`: re-port or delete?** (R4.6)

### 9.3 Launch gate

Do not go public until all of these are true:

- [ ] Both credentials rotated; no secret outside the deploy platform's store (R0)
- [ ] Raw-REST attempts to forge an order, self-escalate to `shop`, or reassign ownership all fail (R1)
- [ ] Concurrent purchase of one listing yields exactly one paid order, proven by test (R2.1)
- [ ] Every paid order has a payment record with a provider reference (R2.2)
- [ ] A buyer can see order status, track shipment, contact the seller, and request a refund (R3.2–R3.4, R6.6)
- [ ] A seller can edit a live listing and mark it dispatched (R3.5, R3.3)
- [ ] A user can reset a forgotten password and delete their account (R3.7)
- [ ] No route can render without loading and error boundaries (R4.2)
- [ ] Terms, Privacy, cookie disclosure, and fee schedule are live (R4.12)
- [ ] Error tracking receives a test exception; CI blocks a failing build (R4.10)
- [ ] Real money reaches a connected seller account, finalized by webhook (R6)
- [ ] Golden-path E2E passes (R7.7)
- [ ] No UI copy promises a feature that doesn't exist (R7.1, R7.2, R4.6)

---

## 10. Bottom line

The Livesheet port was a real upgrade and the product now looks like itself. But it was a **skin**, and the v1 report's core finding is unchanged underneath it: the database is not yet the security boundary the app assumes it is, and checkout is not atomic or honest about failure. Those are ~2 weeks of unglamorous work that nothing else should precede.

The genuinely new finding is that **DRVN can take someone's money and then has nothing to say to them.** No order page, no tracking, no seller contact, no cancellation. For a marketplace, the post-purchase experience isn't a phase-two nicety — it's most of what "trustworthy" means in practice, and it's the one stretch of the journey that doesn't exist in either the UI or the schema. Building it is the difference between a demo that transacts and a marketplace people come back to.

Everything above has a file and line behind it, and §9 turns all of it into ordered, testable work. The plan is sequenced so you can stop after any phase and be in a defensible state: after **R2** the app is safe to expose to invited users on stub payments; after **R4** it's a credible public beta; after **R6** it's a marketplace.
