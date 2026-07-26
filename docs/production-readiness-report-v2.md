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

## 9. Revised roadmap

| Phase | Contents | Effort |
|---|---|---|
| **0 — Credentials** | Rotate the service-role key **and** the DB password; move both to the deploy platform's secret store | 1h |
| **1 — Make the data layer safe** | One migration `0006`: `WITH CHECK` on profiles/cars/listings/activity/offers UPDATE policies; drop the client `orders` INSERT policy (checkout runs service-role, so nothing needs it) — this kills the fake-review chain outright; constrain `reviews.reviewee_id`; fix the `orders` FK so deletion is possible. Plus: `source_car_id` ownership check, fail-closed middleware, the `//` redirect fix, bucket MIME/size limits, rate limiting | ~1 week |
| **2 — Make checkout honest** | Move the purchase path into a single Postgres function with a conditional sold-guard — this resolves the race, atomicity, partial-checkout and idempotency findings together, since they're all facets of one missing transaction boundary. Add a payments table + provider refs. Surface per-item results. Fix currency | ~1 week |
| **3 — Close the journeys** | Order lifecycle (`/orders/[id]`, fulfilment columns, mark-shipped/received, post-sale messaging); listing edit; activity edit/delete; account basics + password reset; onboarding enforcement; seller profile = listings + reviews; cart in nav; logged-out shell | ~2 weeks |
| **4 — Ship the shell** | Fix the landing page's mobile nav (**first** — it's one file); loading/error/not-found boundaries using the skeleton CSS already written; `generateMetadata` + OG + sitemap + robots on the six dynamic routes; image optimization + security headers; delete the dead routes/CSS/components; the five red-discipline edits; dialog semantics for the three sheets; Terms/Privacy; Sentry | ~1.5 weeks |
| **5 — Car sheet + Werkbank ports** | `SheetTabs` + Activity tab + "release a part from this car" (§6); then the recommended Werkbank ports by value: listings console, order pipeline + dispatch, payout plate, offers inbox, toasts | ~2 weeks |
| **6 — Real payments** | Stripe Connect: schema, intents + Elements, webhook finalization, `reserved` listing state, seller onboarding, refunds/disputes — plus the commerce test suite alongside | 2–3 weeks |
| **7 — Launch surface** | Marketing home on real data; counter-offer (or cut the copy); notification coverage + unread state; accessibility pass; marketplace pagination/sort/search; golden-path E2E tests | ~1 week |

**Total: 8–12 weeks** to public launch. Phases 1–2 are small in code and large in consequence — they're where the actual risk lives. Phase 3 is the biggest *new* body of work and the reason the estimate grew.

Still true from v1 and still unaddressed: **zero tests, zero error tracking, no CI, missing indexes on every hot path** (`orders.buyer_id/seller_id`, `reviews.reviewee_id` — queried on every listing view, `listings.created_at` — the default marketplace sort), and **no Terms, Privacy, or cookie disclosure**.

---

## 10. Bottom line

The Livesheet port was a real upgrade and the product now looks like itself. But it was a **skin**, and the v1 report's core finding is unchanged underneath it: the database is not yet the security boundary the app assumes it is, and checkout is not atomic or honest about failure. Those are ~2 weeks of unglamorous work that nothing else should precede.

The genuinely new finding is that **DRVN can take someone's money and then has nothing to say to them.** No order page, no tracking, no seller contact, no cancellation. For a marketplace, the post-purchase experience isn't a phase-two nicety — it's most of what "trustworthy" means in practice, and it's the one stretch of the journey that doesn't exist in either the UI or the schema. Building it is the difference between a demo that transacts and a marketplace people come back to.

Everything above has a file and line behind it.
