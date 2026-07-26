# DRVN — Production Readiness Report

**Date:** 22 July 2026
**Scope:** Full review of the `DRVN 2` codebase (routes, server actions, migrations 0001–0005, components, config) against the product's stated purpose in `DRVN-PRD-v3.1.md`: a marketplace-first platform for modified cars with real in-app checkout, where car profiles supply trust and context.
**Method:** Four parallel deep reviews — commerce/backend correctness, security & RLS, frontend design/UX, and production/ops hygiene — plus a docs-vs-code reconciliation. Build, typecheck, and lint were actually run (all pass clean).

---

## 1. Verdict

**DRVN is a genuinely impressive, feature-complete demo that is not yet safe to put real users or real money through.** The distance to production is not "more features" — the feature surface the PRD calls for is ~90% built and works end-to-end. The distance is **correctness, security, and operational hardening** of what exists, plus the one big planned item (real payments) whose current abstraction will not survive contact with Stripe.

Three findings change the shape of the roadmap more than anything in the PRD's §13:

1. **The repo is effectively unversioned.** Git contains a single create-next-app commit tracking 19 files. The entire product — `src/`, migrations, docs — is untracked working-tree content. This is the single largest operational risk in the project and costs nothing to fix today.
2. **The RLS layer has real holes.** Because the Supabase anon key + a user JWT lets anyone query PostgREST directly, RLS — not the server actions — is the actual security boundary. Today a user can forge `paid` orders naming any victim as seller and post fake reviews against them, self-promote to a `shop` profile, and reassign ownership of listings/cars, all via raw API calls the UI never makes.
3. **The `PaymentProvider` abstraction is a naming placeholder, not a working boundary.** Its synchronous "charge succeeds inline" model has no place for Stripe's async intents, 3DS, webhooks, refunds, or Connect onboarding — and the payment reference is currently thrown away entirely. The checkout pages and actions *will* change when real payments land; plan for it rather than around it.

**Rough effort to production, working solo with AI assistance: 6–9 focused weeks**, dominated by the payments milestone. A gated "beta with stub payments clearly labeled" could be live much sooner (~2 weeks) if the security and correctness fixes land first.

---

## 2. What is genuinely in good shape

Credit where due — these reviews were adversarial and the following held up:

- **Build health:** `next build`, `tsc --noEmit` (strict mode), and lint all pass with zero errors. 30 routes compile; the only lint warnings are in the untracked `design-mockups/` scratch folder.
- **Feature completeness vs. the PRD:** M0–M2 and M4 are truly shipped as claimed; the full loop (sign up → add car → document mods → list part → another user finds it, asks a question, checks out) works.
- **XSS posture:** clean. No `dangerouslySetInnerHTML` anywhere; activity blocks are whitelisted; YouTube embeds are regex-constrained to an 11-char ID on `youtube-nocookie.com`; React escaping covers the rest.
- **Cart price integrity:** the cookie stores only listing IDs; prices are always re-read from the DB at checkout. Cart tampering cannot change what you pay.
- **Fee math:** the 10% platform fee is computed correctly in integer cents and maps cleanly onto Stripe destination charges later.
- **Storage write scoping:** bucket policies correctly enforce per-user-folder writes (`foldername[1] = auth.uid()`).
- **Token architecture:** `globals.css` is disciplined — PRD tokens as CSS vars mapped through Tailwind v4 `@theme`, legacy aliases quarantined with comments, concept-page CSS scoped, global `prefers-reduced-motion` handling.
- **Empty states and forms:** every product surface has considered empty states; forms use `useActionState` with inline errors and pending states.
- **Client/server split:** ~35 client components, essentially all genuinely interactive. Dependency footprint is admirably small (Next + React + Supabase only).

---

## 3. Launch blockers (must fix before any public deploy — even stub-payments beta)

### 3.1 Version control and process (½ day)
- Commit the entire codebase. Only the CNA scaffold is tracked today.
- Add CI (typecheck + lint + build on push). No `.github/` exists.
- Verified: `.env*` is correctly gitignored and the service key has never entered git history — but see 3.2.

### 3.2 Security — RLS and auth hardening (2–4 days)
Ranked from the security audit:

| # | Issue | Evidence | Fix |
|---|---|---|---|
| C1 | **Forged orders → fake reviews.** `orders` INSERT policy checks only `buyer_id = auth.uid()` — no constraint on `seller_id`, amounts, or `status`, so a raw API call can create a `paid` order naming any victim as seller, then the review policy (which only checks order participation) allows unlimited 1-star reviews on them. | `0001_v3_schema.sql:351,362` | Remove client INSERT on `orders` entirely (all order creation already goes through the admin client) and lock reviews to admin-verified orders. |
| C2 | **`profile_type` self-escalation.** The profile UPDATE policy has no `WITH CHECK`; users can set themselves to `shop` and freely rewrite `username`. | `0001:285` | `WITH CHECK` pinning `profile_type` (and username changes via a controlled action). |
| C3 | **Live service-role key in `.env.local`** (not in git, but on disk, expiry 2098). | `.env.local:4` | Rotate before launch; store prod key only in the host's env manager. |
| H1 | **Systemic missing `WITH CHECK` on owner-update policies** — sellers/owners can reassign `seller_id`/`owner_id` on listings, cars, and activity posts to other users. | `0001:291,309,326` | Add `WITH CHECK (auth.uid() = owner column)` to every owner-update policy. |
| M1 | **Fail-open middleware.** With missing/malformed env vars (or a Supabase network error), `updateSession` silently skips all gating. The `(product)` layout is a real second gate, but this should fail closed in production. | `src/lib/supabase/proxy.ts:24,47` | Throw in prod when env is absent; log loudly on network-error pass-through. |
| M2 | **Open redirect:** `/login?next=//evil.com` passes the `startsWith("/")` check and bounces users offsite after login. | `(auth)/actions.ts:25` | Reject `next` starting with `//` or containing `:`. |
| M3 | **Uploads:** file type/size validated client-side only; public buckets will serve attacker-chosen content-types (HTML/SVG → stored-XSS-via-link, hosting abuse). | `sell-form.tsx:61`, `0001:379` | Set `allowed_mime_types` + `file_size_limit` on all four buckets. |
| H3 | **Zero rate limiting** on signup, offers, Q&A, comments, reactions. | — | Supabase auth rate limits + per-user cooldowns (or hCaptcha on signup) before launch. |

### 3.3 Commerce correctness (3–5 days)
From the backend review — these are live-fire defects even with the stub provider, and refund/dispute generators with a real one:

1. **Double-purchase race.** `purchaseListings` is check-then-act with no lock or conditional update: two buyers (or an offer-accept racing a buy-now) both read `active`, both get `paid` orders on one physical part (`commerce/actions.ts:43–102`, same pattern in `respondToOffer:199–233`). Minimum fix: `update … set status='sold' where id=… and status='active'` and verify affected rows *before* charging. Proper fix: see next item.
2. **No atomicity.** Order insert → items insert → payment → order update → listing update are five separate calls; the `order_items` insert error is discarded (paid order with zero items is possible), and a crash mid-sequence leaves paid-but-active listings or sold listings with open offers. Move the whole sequence into a single Postgres function (RPC) running in one transaction.
3. **Payment reference thrown away.** `payment.reference` is never persisted — no `payments` table, no column on `orders`. Unfixable-by-webhook later; add it now.
4. **Silent partial checkout.** If an item sells out mid-checkout it's dropped silently and the whole cart cookie is cleared; in multi-seller carts, a failure on seller #2 leaves seller #1 already charged while the buyer sees "Payment failed." Surface per-item results; only clear purchased IDs.
5. **Currency hard-coded to USD** and never checked across a seller's items despite a `currency` column. Enforce single-currency or thread it through.
6. **Missing validation:** Q&A `parent_id` can attach replies across listings; no max lengths on any free text; offers accept unbounded amounts (overflow → raw Postgres error); `respondToOffer`/`sendOfferMessage`/`setListingStatus` swallow all failures and return `void`; a seller can flip a sold listing back to `active`.
7. **Idempotency:** nothing prevents double-submitted checkouts. Add an idempotency key and a DB backstop (partial unique index on sold order items).

### 3.4 Deployment hygiene (1–2 days)
- **Migration 0004 will fail in any automated pipeline** — it's personal seed data with unsubstituted `__NEIL__`/`__MBASE__` placeholders (the `'__NEIL__'` uuid cast errors outright). Move to `supabase/seed.sql` or delete.
- **Mockup routes ship publicly:** `/mockup`, `/design-system`, `/home-alt`, `/home-brutalist`, `/home-anthropic` are all in the production build, indexable. Gate, delete, or `noindex`.
- **Root metadata says "A frontend-only DRVN product mockup…"** — this is what Google and every link unfurl will display (`src/app/layout.tsx:23`).
- `next.config.ts` is empty: no security headers (CSP, HSTS, X-Frame-Options), no image config.
- If deploying with stub payments for a beta: label checkout clearly as test-mode, or feature-flag purchasing off.

---

## 4. The payments milestone — what Stripe Connect really takes (2–3 weeks)

The PRD treats this as "swap the provider behind the interface." The review says otherwise — the interface is synchronous and the schema has no payments model. The real work list:

1. **Schema:** a `payments` table + provider references on `orders`; `stripe_account_id` on `profiles`; expanded order states (`requires_action`, `payment_failed`, `disputed`; make `shipped`/`completed` reachable — today nothing transitions past `paid`); a **`reserved` listing state with expiry** — mandatory once payment confirmation takes minutes instead of milliseconds, or the double-sell race widens to the whole window.
2. **Flow rewrite:** create-intent server action → client-side confirmation UI (Stripe Elements, 3DS/SCA) → **webhook route** (with signature verification) as the single place that marks orders paid and listings sold. The current "charge inside a server action, then redirect" shape cannot host this.
3. **Connect onboarding:** seller KYC/onboarding flow, payout tracking, and the Settings billing section wired up.
4. **Interface expansion:** `refund()`, `getStatus()`, dispute hooks, idempotency keys, line items. The 10%-fee math survives as-is via `application_fee_amount` on destination charges.
5. **Multi-seller carts:** one order per seller means either N PaymentIntents per checkout or the separate-charges-and-transfers pattern — which needs an order-group concept the schema doesn't have. Decide before building.
6. **Compliance riders:** refund/dispute policy, seller terms, fee disclosure page, tax handling (1099-K thresholds if US sellers).

Doing §3.3 first is not wasted work — the RPC-transaction, payments table, and reserved-state groundwork are exactly what the Stripe flow sits on.

---

## 5. Frontend: from demo-grade to production-grade (1–2 weeks)

The design system is healthy at the token layer; the gaps are app-shell and lifecycle, not aesthetics.

**Highest impact:**
1. **No mobile shell.** `AppSidebar` renders a fixed ~72px left rail at every viewport — no bottom tabs, no hamburger. On a 375px phone it eats ~20% of width, and it wraps *every* product and discover page. For a phone-first audience (the product overview explicitly designs the 540px column "phone-first"), this is the biggest UX blocker.
2. **Zero `loading.tsx` / `error.tsx` / `not-found.tsx` anywhere.** Every route does 3–8 sequential Supabase queries with no Suspense; navigation blocks with no skeleton, and any error hits Next's unstyled default page. `notFound()` is called correctly but renders off-brand.
3. **SEO is absent exactly where the PRD says it matters** ("SEO is an acquisition channel"): no `generateMetadata` on `cars/[slug]`, `listings/[id]`, `u/[username]`, or marketplace categories; no OpenGraph/Twitter cards, no sitemap, no robots, no dynamic OG images. Share previews — a car-culture product's primary organic loop — currently show the "frontend-only mockup" description.
4. **The flagship feed card is off-system.** `feed-card.tsx` is built from pasted Figma hex (`#333333`, `#E6E8EC`, 21px radius) rather than tokens, and renders **fake chrome** on real data: a non-functional "Reply directly…" pseudo-input, dead comment/repost icons. Tokenize it and remove or wire the fake affordances.
5. **Image pipeline:** the shared `Media` primitive uses `next/image` with `unoptimized` and `next.config.ts` has no `remotePatterns` for the Supabase storage host — full-size originals ship to an image-heavy masonry feed. Turn optimization on.

**Also on the list:**
- Accessibility: no `focus-visible` styles anywhere (keyboard focus is invisible or browser-default); the car-gallery lightbox is a click-away `div` with no dialog role, Esc, or focus trap; tab groups lack tab semantics; form errors lack `aria-live`; `#777E90` metadata text on the `#333333` card fill fails AA at 11px.
- Silent failures: Save/Follow buttons swallow server errors (no feedback at all); server pages destructure `{ data }` and drop `error`, so a failed query is indistinguishable from "no data."
- Craft debt: two button systems (the `Button` component vs. hand-rolled pill classes everywhere); duplicated sidebar markup in the legacy `drvn/ui.tsx` shim; `Avatar` defaults to the developer's initials ("NB"); root `/` and `/mockup` are two copies of the same 1,100-line mockup.

**Marketing home:** the three concepts are all monolithic `"use client"` files on hardcoded `drvn-data.ts` (including fake stats that can't ship). Velocity is the only one on-brand with the product's dark system; Paddock and Clay would each mean accepting a marketing/product visual split. Promotion involves: server-rendering the composition with client motion islands, live or honest-static content, real metadata + OG image, an auth redirect on `/` (none exists today — logged-in users see the mockup), and deleting/noindexing the losers.

---

## 6. Operational readiness (3–5 days, parallelizable)

- **Tests: zero.** No framework installed. Priority order: commerce actions (double-sell race, multi-seller partial failure, offer authorization — all admin-client code where one logic slip is privilege escalation), fee/cart math invariants, auth redirect logic. Smoke-level Playwright over the golden path (sign up → list → buy) would catch more than any unit suite initially.
- **Observability: none.** No error tracking, 4 `console.*` calls in all of `src/`, and server actions frequently swallow errors — a failed `order_items` insert today leaves no trace. Add Sentry (or similar) + structured logging in commerce actions before real users.
- **Database:** missing indexes on hot paths — `orders(buyer_id)`/`(seller_id)`, `listings(created_at)` (the default marketplace sort has no supporting index), `reviews(reviewee_id)`, `saves`/`follows` lookup columns, `activity_posts(created_at)`. Search is `ilike '%q%'` (unindexable — fine now, needs `pg_trgm`/FTS before real traffic). The seller-rating average fetches every review row instead of aggregating. The `/orders` page fetches all orders/offers/messages with no `limit()`. Marketplace pagination is a hard `limit(48)` with no cursor, and the "fits my car" filter is applied *after* the 48-row fetch, so filtered results can be wrongly empty.
- **Storage cleanup:** deleting a car deletes rows only — images orphan in buckets forever.
- **Legal/compliance: all absent.** No Terms, no Privacy Policy (OAuth providers will require one), no cookie disclosure, **no account deletion** — and note: account deletion will currently *fail on FK violation* once a user has orders (`orders.buyer_id/seller_id` have no cascade or `set null`; decide anonymize-vs-restrict). Marketplace-specific: fee disclosure, prohibited items, dispute policy — needed by the payments milestone at latest.

---

## 7. Suggested sequencing

| Phase | Contents | Effort | Exit state |
|---|---|---|---|
| **0. Stop the bleeding** | Commit repo; CI; rotate service key; quarantine migration 0004 | ½–1 day | Work is safe |
| **1. Harden** | RLS fixes (C1, C2, H1); fail-closed middleware; open-redirect fix; bucket MIME/size limits; rate limits; commerce atomicity RPC + sold-guard + payments table + partial-checkout UX; input validation | ~1.5 weeks | Existing app is safe to expose |
| **2. Ship the shell** | Mobile nav; loading/error/not-found boundaries; SEO metadata + OG + sitemap; image optimization; feed-card tokenization + fake-chrome removal; Terms/Privacy/account deletion; Sentry; DB indexes | ~1.5 weeks | **Gated beta on stub payments is credible here** |
| **3. Real payments** | Stripe Connect per §4: schema, intents + Elements, webhooks, reserved state, seller onboarding, refunds; commerce test suite alongside | 2–3 weeks | Money can move |
| **4. Launch surface** | Marketing home (promote/synthesize a concept); accessibility pass; marketplace pagination + search index; golden-path E2E tests | ~1 week | **Public launch** |
| Post-launch | AI mod parsing, messaging UI (or explicit cut), fitment engine, recommendations P2/P3, shop profiles | ongoing | Per PRD §13 |

Total to public launch: **6–9 weeks** solo-with-AI, with payments the long pole. Phases 1–2 are highly parallelizable with agent assistance since the findings above are file-and-line specific.

---

## 8. Bottom line

Judged against its purpose — *"the easiest place to sell the parts you pull off your build… made trustworthy by real car profiles"* — DRVN has the hard product thinking done and built: the loop works, the information architecture matches the thesis, the design system is real, and the schema models the domain well. What stands between this and production is unglamorous: the database must be the security boundary it's assumed to be, checkout must be atomic and honest about failure, the app needs a mobile shell and lifecycle states, money needs real rails, and the operation needs git history, tests, monitoring, and a privacy policy. None of it is speculative — every item above has a file and line attached.
