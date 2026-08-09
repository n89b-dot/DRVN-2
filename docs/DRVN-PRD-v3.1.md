# DRVN Product Requirements Document v3.1 (As-Built Revision)

> **Status (2026-08-09):** This PRD records product intent as of July 2026 and is retained as design rationale. The build has moved past it — Stripe payments, admin console, offers/messages, fitment, 28 migrations and a full test/CI suite have shipped. Current state lives in README.md, CHANGELOG.md and docs/remediation-status.md.

## Marketplace-First Platform for Modified Cars — Sell Your Parts, Show Your Build

**Product Name:** DRVN
**Version:** 3.1 (supersedes v3.0 — see `DRVN-PRD-v3.md`, retained as archive)
**Prepared for:** Neil Barrow
**Product Type:** Build-aware parts marketplace with car profiles and contextual social layer
**Primary Stack:** Next.js 16.2 (App Router), TypeScript, Tailwind CSS v4, Supabase (Postgres, Auth, Storage, RLS)

> **How this document was produced.** v3.0 was the pre-build spec, distilled from a page-by-page interview about the prototype. v3.1 is the **as-built revision**: v3.0 diffed against the actual implemented codebase (routes, migrations 0001–0005, feature code) as of July 2026. Durable sections carry forward unchanged; everywhere the build made a decision v3.0 didn't anticipate, the spec now records reality. Milestones are stamped with actual status.

---

# 0. What Changed Since v3.0 (Read This First)

These are decisions made **during the build** that v3.0 doesn't know about. None change the product thesis; they change how it's realized and what's genuinely done.

| Area | v3.0 said | v3.1 (as built) |
| --- | --- | --- |
| Payments | Stripe Connect at MVP | **Swappable `PaymentProvider` interface with a `StubPaymentProvider`** (instant success, no real money). The **10% platform fee (`PLATFORM_FEE_BPS = 1000`) is live** in order math from day one. Stripe Connect is the swap-in, deferred to the payments milestone. |
| Mod parsing | Paste → AI parse → confirm | **Heuristic regex `parsePaste`** stands in for the AI parse; user-confirm flow works as specced. `mod_items.confidence` column exists but is unused. AI (Stunspots-aided) parse remains the upgrade path. No AI SDK in the project yet. |
| Cart | Unspecified mechanics | **Cookie-based cart** (no cart table). Checkout creates **one order per seller**, marks listings sold, applies the platform fee. |
| Messaging | Marketplace messaging at M3 | **Schema shipped (`messages` table + RLS), no UI built.** Listing Q&A covers buyer↔seller communication for now. |
| Content editing | read.cv-style editor **modals** | **Inline sub-forms** in Garage edit (car-details, gallery-manager, mods-editor, danger-zone). Works well; modal pattern no longer a requirement. |
| Recommendations | P1 rule-based at M5 | **P1 shipped early**: platform match (make/model) → co-save → most-saved, computed via admin client, surfaced on logged-in Home. P2/P3 unchanged, deferred. |
| Schema | Suggested additions list | **Shipped as migrations 0001–0005**: full v3 schema + engagement-visibility policies (0002), activity reactions & comments (0003), profile headline + seed data (0004), notification prefs jsonb (0005). |
| Engagement | Reactions unspecified | **Emoji reactions + comments on activity posts** are built (`activity_reactions`, `activity_comments`). |
| Auth | Supabase auth | Fully wired: email/password + OAuth, `/callback` code exchange, onboarding writes username/display name, middleware (`proxy.ts`) gates product routes and no-ops gracefully without env vars, plus a layout-level second gate. |
| Mockups | Prototype as seed | The static prototypes live on at `/`, `/home-alt`, `/home-brutalist`, `/home-anthropic`, `/mockup`, `/design-system` (hardcoded `drvn-data.ts`, no Supabase). They are references, not product surfaces. The root `/` is still a mockup — a real marketing home is open work. |

---

# 1. Executive Summary *(unchanged from v3.0)*

DRVN is a **marketplace for modified cars and the used parts behind them**. Enthusiasts constantly pull parts off their cars — stock parts when they upgrade, old parts when they change direction, spares they never installed — and there is no clean, enthusiast-native place to sell them with real context.

DRVN's core promise:

> **The home for your modified car — show it off, and buy or sell the parts behind the build.**

The marketplace is the primary utility and the primary reason to join. Car profiles, build activity, and light social features exist to give listings **context and trust** ("this part came off this car") and a reason to return beyond a single transaction.

**Status:** the promise is now demonstrable end-to-end in the app — a user can sign up, add a car, document mods and activity, list a part, and another user can find it, ask a question, and check out (against the stub payment provider).

---

# 2. Positioning & Marketing Angle *(unchanged)*

Lead with **identity and car culture**; the marketplace is the utility underneath.

> The home for your modified car. Show your build, and buy & sell the parts behind it.

**What DRVN is:** a build-aware parts marketplace, a public profile for your car, a lightweight place to post your car's progress, and a way to discover parts with real fitment/source context.

**What DRVN is not:** a generic social feed, an Instagram/TikTok clone, a Craigslist/Facebook-Marketplace clone, a forum, or a generic e-commerce store.

---

# 3. Core Product Thesis *(clarified 07.2026)*

**A marketplace for parts from modified cars.** That is the product: enthusiasts buying and selling the parts behind their builds, easily and confidently. Everything else exists to make that marketplace work well.

The car profile's trust-and-context layer is a **supporting feature — a differentiator, not the mission.** Where it appears (and it should appear in most of the places it does today), a DRVN listing can answer: what car did this part come off, who is the seller and are they credible, is it likely to fit my car, and how was it used. That context makes listings better than ordinary classifieds — but DRVN is not "a provenance platform," and product or design decisions should not treat documentation/provenance as the headline. The headline is the marketplace itself: selection, ease of listing, ease of buying, and the enthusiast identity around it.

---

# 4. Product Principles *(unchanged)*

1. **Marketplace-first.**
2. **Cars are first-class context objects.**
3. **Never trust user-asserted fitment** (§7.1).
4. **Clean by default, rich where it earns it** — imagery-forward only on Home + marketing.
5. **Token-driven and swappable.**
6. **Adapt, don't rebuild.**

The build has honored all six; #5 and #6 are visibly reflected in the token-driven components and the reuse of prototype patterns.

---

# 5. Target Users *(unchanged)*

Modifier/builder (primary), parts buyer, car-scene browser, shop/business (post-MVP — `profiles.profile_type` column already supports it; no UI).

---

# 6. Information Architecture & Navigation — AS BUILT

**Product shell:** left collapsing sidebar (`AppSidebar`), built as specced.
**Primary nav:** Home, Explore, Marketplace, Garage, Profile. **Utility:** Notifications, Saved, Settings. **Sell and Cart are reached contextually**, not from the sidebar — a build decision that has held up.

**Route groups (all live against Supabase unless noted):**

- **`(auth)`** — `/login`, `/signup`, `/onboarding`, `/callback` — live.
- **`(discover)`** — public: `/explore`, `/marketplace` (+ `[category]`, `[category]/[subcategory]`), `/listings/[id]` (with purchase actions + Q&A), `/cars/[slug]` (+ `/activity/[postId]`), `/u/[username]` — live.
- **`(product)`** — auth-gated: `/home`, `/garage` (+ `[id]/edit`, `[id]/update/new`), `/sell`, `/cart`, `/orders`, `/profile`, `/settings`, `/notifications`, `/saved` — live.
- **Static prototypes (not product):** `/` (root), `/home-alt`, `/home-brutalist`, `/home-anthropic`, `/mockup`, `/design-system`. The design-system page remains the living component reference (§7.8).

There is **no Build nav item** (§8.7 of v3.0 stands).

---

# 7. Cross-Cutting Concepts — status stamped

## 7.1 Fitment Integrity — Never Trust User-Asserted Fitment *(unchanged; enforced)*
As built: listings carry freeform `compatibility_notes` only. The "fits your car" hint is derived from car metadata (make/model) — there is no structured seller fitment picker anywhere. The authoritative fitment engine remains a separate, later system.

## 7.2 Three Discovery Surfaces, Kept Distinct *(built)*
Marketplace (intent, filters), Explore (mixed feed + Trending/Cars/Parts tabs; Parts logged-in-only as specced), logged-in Home (dashboard header → feed, with rule-based recommendations).

## 7.3 Mods Are Structured, Linkable Items *(built, with a stand-in parser)*
`mod_items` (category, brand, product, part number, raw_text, `linked_listing_id`, confidence) shipped in 0001. Entry is paste → **heuristic regex parse** → confirm/edit. The AI parse (cheap, on-save, cached; optionally Stunspots-aided) is the recorded upgrade path — the UX will not change when it lands.

## 7.4 Commerce Model — In-App Checkout *(built on a stub processor)*
Cart (cookie-based), Make an offer, Purchase now — all functional. Checkout produces one order per seller, applies the **10% platform fee**, marks listings sold. Buyer/seller reviews (order-linked) and listing Q&A are live. **No real money moves**: `StubPaymentProvider` returns success instantly behind the `PaymentProvider` interface; Stripe Connect (or equivalent) is the swap-in. Marketplace messaging: schema only, no UI (Q&A carries the load).

## 7.5 Content-Management / Editing Layer *(built, as inline forms)*
The prototype's "no way to input data" gap is closed: garage CRUD, gallery manager, mods editor, activity composer, sell form, profile/settings editing. Built as **inline sectioned forms rather than modals** — the modal pattern is dropped as a requirement.

## 7.6 Recommendation Engine — Phased *(P1 shipped)*
P1 rule-based is live (platform match → co-save → most-saved; computed server-side with the admin client). P2 (build-goal archetypes) and P3 (AI build-plan) unchanged and deferred; build-goal input itself still deferred.

## 7.7 AI Reasoning Layer (Stunspots corpus) *(unchanged; deferred)*
Still a candidate RAG grounding corpus for mod-parsing/enrichment and later build-plan reasoning. No AI dependency exists in the project yet.

## 7.8 Design-System Swappability *(built)*
Tokens are CSS variables + Tailwind v4 theme; accent standardized on `#3B71FE` as required. `/design-system` remains the live component library. Component groups as built: `components/ui` (button, category-icon, listing-card, feed-card/MasonryFeed, feed-list, icons, patterns, primitives), `components/profile`, feature modules under `src/features` (commerce, social, activity).

## 7.9 Build Approach — Adapt This Repo *(honored)*
The product was built inside the prototype repo; mockup routes retained as reference.

---

# 8. Page-Level Requirements — status stamped

v3.0 §8 remains the design authority for each page. Per-page status:

| Page | Status | Notes vs v3.0 |
| --- | --- | --- |
| 8.1 Home (logged-in) | **Shipped** | Dashboard header → feed + P1 recommendations. |
| 8.1 Home (logged-out marketing) | **Open** | Root `/` is still a static mockup; three landing concepts exist (`home-alt` Velocity, `home-brutalist` Paddock, `home-anthropic` Clay) awaiting a pick. Composition finalized last, per spec. |
| 8.2 Explore | **Shipped** | Mixed feed + tabs; Parts tab logged-in-only. |
| 8.3 Marketplace | **Shipped** | Search/filters (keyword, category, condition, price, fit), 6-category icon taxonomy, category + subcategory pages, garage-fit hint via metadata. |
| 8.4 Sell | **Shipped** | Single sectioned form; source-car optional; freeform compatibility notes. |
| 8.5 Garage | **Shipped** | Private back-office; per-car edit (details, gallery, mods, danger zone), activity composer. |
| 8.6 User Profile | **Shipped** | Lightweight identity hub, headline field (0004), follows. Multiple-layout evaluation never happened — the built layout was accepted. |
| 8.7 Car Profile | **Shipped** | Identity → chips → About/Activity tabs → gallery → structured mods → active listings; reactions + comments on activity (0003). No standalone Build page, as specced. |
| 8.8 Listing Detail | **Shipped** | Purchase card (cart/offer/buy), public Q&A, source-car badge, seller rating. "More from seller" per spec; "similar items" later. |
| 8.9 Saved | **Shipped** | Parts, cars, sellers; grouped by type. |
| 8.10 Notifications | **Shipped** | Split sections; per-user prefs stored as `profiles.notification_prefs` jsonb (0005), enabled by owner-visibility policies (0002). |
| 8.11 Settings | **Shipped** | Account/profile config + notification prefs. Billing/payout is scaffolding-only pending real payments. |
| 8.12 Activity Detail | **Shipped** | Focused post page with reactions + comments. |
| Orders / Cart | **Shipped** (new surfaces v3.0 didn't enumerate) | `/cart` with checkout, `/orders` with post-sale review form. |
| Messaging inbox | **Not built** | Schema only. |

---

# 9. Design System *(unchanged in intent; tokens live)*

Dark, premium, disciplined: imagery-forward only on Home + marketing; product surfaces on the clean read.cv baseline. Tokens per v3.0 §9.2, accent `#3B71FE` standardized. Fonts: DM Sans (display), Inter (dense UI). Radii: 24px cards, 90px pills. All tokens centralized (CSS variables + Tailwind theme).

---

# 10. Technical Architecture — AS BUILT

- **Frontend:** Next.js **16.2.9** (App Router; **read `node_modules/next/dist/docs/` before writing routing code** — this version has breaking changes), React 19.2.4, TypeScript 5, Tailwind CSS 4.
- **Backend:** Supabase (`@supabase/ssr`, `@supabase/supabase-js`) — Postgres, Auth, Storage, RLS. Clients: `lib/supabase/{server,client,admin,proxy}.ts`.
- **Middleware:** `src/proxy.ts` → `updateSession`: session refresh, product-route gating, redirect of authed users off `/login`/`/signup`/`/`, graceful no-op without env vars.
- **Payments:** `lib/payments/provider.ts` — `PaymentProvider` interface, `StubPaymentProvider` implementation, `fee.ts` with `PLATFORM_FEE_BPS = 1000`. Stripe Connect is the intended swap-in; no Stripe code exists.
- **Cart:** cookie-based (`lib/cart.ts`); no cart table.
- **Server actions:** `features/commerce/actions.ts` (cart, purchase, offers, Q&A, reviews), `features/social/actions.ts` (saves, follows), `features/activity/actions.ts` (posts, reactions, comments).
- **Storage buckets:** `avatars`, `car-images`, `activity-images`, `listing-images` — public read, per-user-folder write.
- **Schema (migrations 0001–0005):** `profiles` (incl. `profile_type`, `headline`, `notification_prefs`), `cars`, `car_images`, `activity_posts`, `activity_images`, `activity_reactions`, `activity_comments`, `listings`, `listing_images`, `mod_items`, `saves`, `follows`, `orders`, `order_items`, `offers`, `reviews`, `listing_questions`, `messages`. RLS on every table; `handle_new_user()` trigger; owner-visibility policies for engagement notifications.
- **No test framework** is installed.
- Note: migration 0004 contains seed data with `__NEIL__`/`__MBASE__` placeholders (a seed-script template) — seed data should move out of migrations before any shared/production environment.

---

# 11. Monetization *(unchanged; fee already live)*

Platform transaction fee (**10%, implemented in order math from day one** — no bait-and-switch); featured listings and affiliate links early; shop/business profiles, promoted sellers/builds/events later.

---

# 12. Milestones — status

- **M0 — Foundation: ✅ SHIPPED.** Schema + RLS + storage, token system, sidebar shell, auth end-to-end, design-system page retained.
- **M1 — Cars & Profiles: ✅ SHIPPED.** Garage CRUD, car profiles with structured mods (paste→parse→confirm, heuristic parser), lightweight user profile, public car URLs.
- **M2 — Marketplace Core: ✅ SHIPPED.** Search + icon category browse + category/subcategory pages, listings, Sell flow, metadata-based fit hint.
- **M3 — Commerce: 🟡 PARTIAL.** Cart/offer/purchase, platform fee, reviews, Q&A all live — **but on the stub payment provider, and messaging has schema only.** Remaining: Stripe Connect + payouts, messaging UI (or an explicit decision that Q&A suffices for launch).
- **M4 — Discovery & Engagement: ✅ SHIPPED.** Explore feed + tabs, saves, follows, reactions/comments, notifications with prefs, "more from seller."
- **M5 — Recommendations: 🟡 PARTIAL.** P1 rule-based shipped (early). P2 build-goal archetypes and P3 AI build-plan open; build-goal input still deferred.
- **Marketing home: 🔲 OPEN** (not in the original milestone list, now the visible gap): pick/build the logged-out landing from the three concepts; root `/` currently serves a mockup.

---

# 13. What Remains (re-scoped roadmap)

Ordered by launch-criticality:

1. **Real payments** — implement Stripe Connect (or chosen processor) behind the existing `PaymentProvider` interface: onboarding/KYC for sellers, payment intents, payouts, fee capture, refunds/disputes. Settings billing/payout section gets wired here. This is the single blocker between "demo" and "marketplace."
2. **Logged-out marketing Home** — choose among the three built concepts (or synthesize), replace the mockup at `/`, add the "how DRVN works" loop + proof rails.
3. **Production hygiene** — move seed data out of migrations, decide hosting/env strategy, add at least smoke-level tests around commerce actions (currently zero tests), update the boilerplate README.
4. **AI mod parsing** — swap `parsePaste` heuristics for a cheap cached LLM parse (optionally Stunspots-grounded); start populating `mod_items.confidence`.
5. **Messaging UI** — inbox/threads over the existing `messages` schema, or explicitly cut for launch and let Q&A + offers carry it.
6. **Fitment engine (P-later)** — authoritative "fits your car" from car metadata + category (+ eventual AI reasoning); today's make/model hint is the placeholder.
7. **Recommendations P2/P3** — build-goal classification and archetype maps, then AI build-plans.
8. **Shop/business profiles** — UI over the existing `profile_type` column.
9. **Later (unchanged):** similar items, saved searches, general DM inbox (if ever), events, promoted placements.

---

# 14. Open Questions

Resolved since v3.0: ~~where listings are managed~~ (Sell + Orders surfaces), ~~content-editing Settings vs Garage split~~ (inline forms in Garage; config in Settings), ~~mod entry UX~~ (paste→confirm shipped), ~~profile layout options~~ (built layout accepted).

Still open:

1. **Payment processor** — Stripe Connect assumed; confirm and implement.
2. **Marketing home direction** — Velocity vs Paddock vs Clay vs a synthesis.
3. **Messaging at launch** — build the inbox or ship with Q&A + offers only?
4. **Build-goal design** — how it's set and how deeply it drives recommendations (P2 gate).
5. Final **tagline / hero copy** (with #2).
6. **Engagement-notifications section name** — "Profile" vs "Activity" (cosmetic; decide in copy pass).

---

# 15. Final Definition *(unchanged)*

DRVN is a **marketplace-first platform for modified cars**: the easiest place to sell the parts you pull off your build and to find parts that fit yours — made trustworthy by real car profiles, structured builds, seller ratings, and source-car context.

> **Show your build. Sell your parts. Find what fits.**
