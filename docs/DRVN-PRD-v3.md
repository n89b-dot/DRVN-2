> **SUPERSEDED (July 2026):** this is the pre-build v3.0 spec, retained as archive. The canonical PRD is now [DRVN-PRD-v3.1.md](DRVN-PRD-v3.1.md), the as-built revision.

# DRVN Product Requirements Document v3

## Marketplace-First Platform for Modified Cars — Sell Your Parts, Show Your Build

**Product Name:** DRVN
**Version:** 3.0 (supersedes v2.1)
**Prepared for:** Neil Barrow
**Product Type:** Build-aware parts marketplace with car profiles and contextual social layer
**Primary Stack:** Next.js, TypeScript, Tailwind CSS, Supabase
**Primary Shift from v2.1:** DRVN is now explicitly **marketplace-first**. The marketplace is the reason people come; car profiles, builds, and activity are the supporting context and identity layer.

> **How this document was produced.** v3 is the output of a structured, page-by-page interview about the working prototype running on `localhost:3002`. Decisions, corrections, and rationale were captured in a living "Working Understanding" canvas and consolidated here. Where v3 intentionally overrides v2.1, it is called out inline.

---

# 0. What Changed Since v2.1 (Read This First)

| Area | v2.1 | v3 (this doc) |
| --- | --- | --- |
| Positioning | Car profile + marketplace + social, roughly co-equal | **Marketplace-first**, wrapped in modified-car identity |
| Commerce | Contact/inquiry at launch; checkout deferred to "M6" | **In-app checkout at MVP**: cart + make-offer + purchase, small platform fee, seller/buyer reviews |
| Build page | A dedicated Build page/module | **No standalone Build page.** "Build" = per-car Activity (updates) + a deferred build-goal concept |
| Messaging | Direct messaging deferred | **Marketplace messaging only** (listing Q&A + offer negotiation). No general DM inbox at MVP |
| Fitment/compatibility | Seller-entered structured compatibility | **Freeform seller notes only** (non-authoritative). Platform fitment is a separate, later, integrity-protected system |
| Modifications | Free text / mod list | **Structured, linkable mod-items** (paste → AI parse → confirm), each optionally linked to a listing |
| User profile | Rich profile with activity/reputation | **Lightweight identity hub** ("link-in-bio for your car life"); minimal; reputation post-MVP (except seller ratings, now MVP for checkout) |
| Nav shell | Top horizontal nav | **Left collapsing sidebar** for product (as built); top nav reserved for marketing pages |
| Design ambition | Premium/image-heavy across the product | **Blend + imagery rule**: imagery-heavy only on Home + marketing/explainer pages; everything else uses the clean read.cv-style baseline |
| Recommendations | "Advanced recommendation engine" (deferred) | **Phased engine** (rule-based → build-goal archetypes → AI build-plan); build-goal input itself is deferred |
| Design system | Tokens defined | **Token-driven architecture is a hard requirement** so a future design system swaps in cleanly; existing components are the reusable seed |
| Build approach | New app structure | **Adapt the existing repo** and reuse its components/mockups to minimize re-coding |

---

# 1. Executive Summary

DRVN is a **marketplace for modified cars and the used parts behind them**. Enthusiasts constantly pull parts off their cars — stock parts when they upgrade, old parts when they change direction, spares they never installed — and there is no clean, enthusiast-native place to sell them with real context.

DRVN's core promise:

> **The home for your modified car — show it off, and buy or sell the parts behind the build.**

The marketplace is the primary utility and the primary reason to join. Car profiles, build activity, and light social features exist to give listings **context and trust** ("this part came off this car") and to give the platform a reason to return to beyond a single transaction.

The product should feel **dark, premium, and enthusiast-native**, but with a deliberate design discipline: imagery-forward treatment is reserved for Home and marketing pages; the product surfaces stay clean, structured, and read.cv-inspired.

---

# 2. Positioning & Marketing Angle

**Do not market DRVN as "a marketplace for the parts you pull off your car."** That is the mechanic, not the hook. Lead with **identity and car culture**, and let the marketplace be the utility underneath.

**Working positioning:**

> The home for your modified car. Show your build, and buy & sell the parts behind it.

**Tagline candidates (to finalize during design):**

- "Your modified car has a home."
- "Show your build. Sell your parts. Find what fits." (carried from v2.1 — still strong)
- "For people who are never really *done* with their car."

**What DRVN is:** a build-aware parts marketplace, a public profile for your car, a lightweight place to post your car's progress, and a way to discover parts with real fitment/source context.

**What DRVN is not:** a generic social feed, an Instagram/TikTok clone, a Craigslist/Facebook-Marketplace clone, a forum, or a generic e-commerce store.

---

# 3. Core Product Thesis

**A build-aware marketplace where the car profile is the trust and context layer.**

A DRVN listing should be able to answer:

- What car did this part come off? (source-car context)
- Who is the seller, and are they credible? (profile + ratings)
- Is it likely to fit my car? (fitment — see the integrity rule in §7.1)
- What was it paired with / how was it used? (seller's freeform notes)

This is the reason to exist beyond "post your car here too."

---

# 4. Product Principles

1. **Marketplace-first.** Every design decision optimizes for buying and selling parts with context. Identity/social features serve the marketplace, not the other way around.
2. **Cars are first-class context objects.** A car has its own public page, gallery, structured mods, activity, and listings — but the car page exists largely to give the marketplace trust and richness.
3. **Never trust user-asserted fitment.** Seller compatibility notes are informational only and must never drive the platform's authoritative fitment signal (see §7.1).
4. **Clean by default, rich where it earns it.** Imagery-heavy treatment only on Home + marketing; product pages stay minimal, structured, scannable.
5. **Token-driven and swappable.** Build against centralized design tokens so a future design system drops in without rewriting pages.
6. **Adapt, don't rebuild.** Reuse the existing prototype's components and patterns wherever possible.

---

# 5. Target Users

- **Modifier / builder (primary):** always has parts coming off the car; wants an easy way to sell them with context and to buy parts that fit.
- **Parts buyer:** wants to find parts that fit their car, trust the seller, and check out easily.
- **Car-scene browser:** wants to browse cool cars/builds for inspiration (Explore) and discover parts along the way.
- **Shop / business (post-MVP):** not built for MVP, but the data model must allow a shop/business profile type later.

---

# 6. Information Architecture & Navigation

**Product shell:** a **left collapsing sidebar** (as built), ~72–96px, dark surface, icon nav with active state. This resolves the v2.1 top-nav spec in favor of the built sidebar, which Neil prefers.

**Marketing pages:** use a **top horizontal nav** (and a slim mirror sidebar) — distinct from the product shell.

**Primary product nav:** Home, Explore, Marketplace, Garage, Profile.
**Utility nav:** Notifications, Saved, Settings.
**Marketplace sub-surfaces:** Category landing, Category/subcategory listings, Listing detail, Sell.
**Car object sub-surfaces:** Car profile (About / Activity), Activity detail.

There is **no Build nav item** (see §8.7).

---

# 7. Cross-Cutting Concepts (apply across many pages)

These recurred throughout the interview and shape multiple pages. They are first-class requirements.

## 7.1 Fitment Integrity — Never Trust User-Asserted Fitment

- **Seller compatibility = freeform notes only.** Visible on the listing, informational, explicitly framed as "notes from the seller," never a guarantee.
- **Do not give users a structured exact-fitment picker they can assert as truth.** Bad or dishonest data would poison the platform's fitment signal.
- The platform's **authoritative fitment** (filters, "fits your car" badge) is a **separate, later system** derived from car metadata + category + (eventually) AI reasoning — not from seller claims.

## 7.2 Three Discovery Surfaces, Kept Distinct

- **Marketplace** = intent-driven part search (filters, category browse, sorted/toggled by your car).
- **Explore** = lean-back inspiration feed (builds-first; mixed feed + tabs).
- **Logged-in Home** = a light dashboard header that flows into the Explore feed (not pure endless scroll).

## 7.3 Mods Are Structured, Linkable Items — GREENLIT

- Each modification is a discrete item: category, brand, product, optional part number.
- Some items link out to a listing/product ("this part is for sale / view it").
- **Entry pattern:** user pastes a freeform list → a cheap AI parse (once, on save, optionally Stunspots-aided) extracts candidate items → **user confirms/edits** → store structured `mod_items` **plus** the raw text.
- Cost is negligible when run on save + cached. Start with plain text if needed; this is the upgrade path and the connective tissue between builds and the marketplace.

## 7.4 Commerce Model — In-App Checkout at MVP (Overrides v2.1)

- **Checkout ships at launch:** Add to cart, **Make an offer**, and Purchase now.
- **Small platform fee from day one**, so a fee later is not a bait-and-switch.
- Implies **Stripe Connect** (or equivalent — processor TBD), seller payouts, order/fee handling.
- **Buyer + seller reviews/ratings are MVP** (tied to completed sales) — needed for checkout trust.
- **Marketplace messaging only** (listing Q&A + offer negotiation). **No general DM inbox at MVP** (spam/moderation cost; DMs push deals off-platform). If ever added, it is a separate surface.
- Accept some off-platform leakage; do not deliberately cripple messaging, but make on-platform purchase the default.

## 7.5 Content-Management / Editing Layer (Currently Missing)

The prototype has **no way for users to input data.** DRVN needs read.cv-style settings/editor panels (modals) to create/edit: profile fields + links, cars + galleries, mod lists, activity/build updates, and listings. This is a first-class part of the build, not an afterthought.

## 7.6 Recommendation Engine — Phased (build-goal input deferred)

- **P1 (MVP, no LLM):** rule-based — match garage car ↔ listing category/fitment, "popular parts for your platform," saves-based "others with this car also…".
- **P2:** a per-car **build-goal** classification (street/drift/drag + optional power target) → curated "build archetype → part category" maps.
- **P3 (AI-assisted):** generate a cached **build plan** via Stunspots + retrieval, with explicit uncertainty.
- **Rule:** compute on events + cache; never per page view; cheap models + retrieval.
- **Build-goal input is deferred** (Neil is rethinking how it works); the phasing above is the eventual plan.

## 7.7 AI Reasoning Layer (Stunspots corpus) — Deferred, Optional

[Stunspot's Guide to Automotive Systems](https://github.com/Stunspot/stunspots-guide-to-automotive-systems) (CC BY 4.0, attribution required) is a candidate RAG grounding corpus — **not a fitment database.** Useful for: the mod-parser (part normalization/identification, vocabulary), the recommendation engine's reasoning, and an eventual AI build/compatibility assistant that reasons *with explicit uncertainty*. May be introduced **earlier** for scoped parsing/enrichment (on-save + cached) if cheap and beneficial.

## 7.8 Design-System Swappability + Component Architecture

- Build against **centralized design tokens** (color/space/radius/type as CSS variables + Tailwind theme). Restyling = change tokens, not rewrite pages.
- The existing `/design-system` page inventories **~50 components across 7 groups** + tokens — treat it as the **reusable seed** of the real component library.
- **Retain an in-app design-system / component reference page (via Settings)**, at least during testing, so the current direction + inventory stay visible.
- **Resolve token inconsistency:** accent blue is `#007AFF` on `/design-system` but `#3B71FE` in the app/PRD → **standardize on `#3B71FE`.**

## 7.9 Build Approach — Adapt This Repo

Use the existing project folder as the starting point. Reuse the prototype's components and mockups; refactor them to be token-driven. The goal is to minimize re-coding, not to rebuild from scratch.

---

# 8. Page-Level Requirements

Each page below reflects the interview outcome. "Baseline" = the clean read.cv-style treatment; "imagery-forward" pages are explicitly noted.

## 8.1 Home

**Two experiences by auth state.**

- **Logged-out (marketing / imagery-forward):** an editorial hero that leads with the **marketplace utility wrapped in modified-car identity**, a short "how DRVN works" loop (post your car → document the build → buy/sell parts with context), and proof rails (featured listings + featured cars) with a dual CTA (*Add your car* / *Browse parts*).
- **Logged-in (dashboard → feed):** a light dashboard header (compact "your garage" strip, quick actions like Sell / Add car, saved + notification highlights) that **flows into the Explore feed**. Marketplace must be one tap away.

**Notes:** Home is an aggregator — **finalize its composition last**, after the object pages are defined. This is one of the few imagery-forward pages.

## 8.2 Explore

**Purpose:** lean-back inspiration and discovery — primarily **cool cars and builds (and their updates)**, not parts-first.

- **Default = a single mixed feed** of updated builds, cars, and build updates.
- **Secondary tabs** alongside/below the feed: **Cars + Builds** (combined, incl. updates) and **Parts** (listings of interest). **Sellers is rejected** as a tab; "Listings" collapses into "Parts." **Events** is a future tab (and can surface in the mixed feed as "of interest").
- **Personalization (logged-in):** drifts toward what you follow (Instagram-like) and surfaces parts tied to your car/interests.
- **Parts in Explore are logged-in only** (logged-out users shouldn't see parts here — confusing).
- **Design:** read.cv feed baseline; strong content-type labels so cars/builds/parts/updates never blur; not "generic Pinterest."

## 8.3 Marketplace

**Purpose:** a focused, intent-driven parts marketplace. Buyer goal: "I have a Golf R, find an exhaust" should be effortless.

- **Top:** a prominent search + filter bar (keyword, car, category, condition, price, location).
- **Below:** a **browse-by-category** section using a condensed ~6 top-level taxonomy — **Performance, Engine, Exterior & Body, Interior & Lighting, Brakes & Suspension, Wheels & Tires** — each with subcategories. (USP Motorsports is the taxonomy reference; DRVN condenses it to avoid a "wall of dense lists.")
- **Category landing + subcategory drill-down are in scope for launch.**
- **Category tiles use custom icons** (downpipe, engine, transmission…), not photos — cleaner and faster to scan. Exact desktop layout to be explored.
- **Garage-fitment TOGGLE (not a hard scope):** "show parts that fit cars in my garage." Remembers your last selection; optional default-on. Listings that fit a garage car get a **"fits your [car]" indicator** (driven by platform fitment, not seller notes — see §7.1).
- **Non-logged-in users** can enter their car in the filters to find fitting parts.
- Search/filter styling is inspired by an Airbnb/stays-style module (Neil's Figma experiment) — structure, not a literal copy.

## 8.4 Sell

**Purpose:** fast, trustworthy listing creation — "list a part in under 3 minutes."

- **A single, well-sectioned form** (not a wizard) that still covers everything a multi-step flow would: basics → photos → came-from car (optional) → compatibility notes → price/location → review. Optional **sticky preview**.
- **Linking to a garage car is fully optional** (people sell parts for cars they've sold, or never-installed buys). Reframe the "Source car" label to something like "Which car is this from?" / "Came off."
- **Compatibility = freeform seller notes**, visible in the listing, clearly non-authoritative (see §7.1). No structured exact-fitment picker.
- Dark surface cards; large media upload area.

## 8.5 Garage

**Purpose:** a **private back-office dashboard** for managing your cars and their content. (The *public* "here are my cars" view lives on the user profile.)

- Lists your cars first; **"Add a car" is an elegant, compact action** — the current giant top-of-page form is wrong.
- **Per-car action menu:** edit car, list a part from it, edit mod list, view public car page, **add activity/build updates**.
- Keep minimal but make it feel nice to use.
- **Build-goal setup is deferred** (not placed here until it's rethought).

## 8.6 User Profile

**Purpose:** a **lightweight identity hub** — "link-in-bio for your car life." Points to the user's cars + listings and links out (YouTube, Instagram, website). The quick gateway people use to jump into someone's car(s).

- **Followers = MVP.** Activity feed + seller reputation = post-MVP (except seller ratings on listings, which are MVP for checkout trust).
- **Single flexible profile for MVP** (a normal user who also sells). **Architect the data model for a shop/business profile type later.**
- **Design:** lean minimal (read.cv baseline), refined, scannable. **No cover image at MVP** (maybe later); a large-enough avatar is enough. The profile's **Activity tab is a quick top-few summary** of the person's activity (not a full log).
- **Open problem (design phase):** differentiate the Vehicles vs Activity blocks so they don't blend. Neil wants to **see multiple HTML layout options** here before committing.

## 8.7 Car Profile (the centerpiece object)

**Purpose:** where people land and linger. A quick "profile read" of what the car is and what it's about, showcasing imagery + the modifications.

- **Module hierarchy** (per Neil's Golf R design): identity block → meta chips (year, color, location + tags like "20th Anniversary," "Bagged," "FBO," "Fully Built") → About / Activity tabs → about text → **Gallery** → **Modifications** → **Wheels & Tires**.
- **Per-car Activity tab** = that car's build updates/story (distinct from the person-level profile summary). Same activity component, different scope.
- **Modifications** are a vertical, grouped, structured list (Exterior / Interior / Performance / Suspension). Each mod is an **isolatable, linkable item** (see §7.3); some link to a listing for sale.
- **"Active listings from this car"** module.
- **Follow / save / like** actions on the car.
- **Design:** image-forward (this page earns it) but **not bogged down by photos** — the **gallery opens/expands into a modal** to keep the page clean.

### On "Build" — there is no standalone Build page

The car's build lives in two places, neither of which is a separate destination:

1. **Build updates/story** = the car page's **Activity tab**.
2. **Build as a goal/classification** (street/drift/drag + optional power target) = a **deferred, per-car data concept** that will feed the recommendation engine (§7.6) — not a page.

The prototype's separate Build page is **deprecated/folded**.

## 8.8 Listing Detail

**Purpose:** help a buyer evaluate a used part and transact with confidence. Neil's clean design is the layout reference: gallery grid + right-side purchase card + discovery rows.

- **In-app checkout (MVP):** Add to cart, **Make an offer**, Purchase now. (See §7.4.)
- **Purchase card:** price, seller (with rating), location, quantity.
- **Public Q&A/comments on the listing** — buyers ask, seller replies on the page, integrated cohesively.
- **Source-car shown as a highlight/badge** ("came off this car"), not its own big section.
- **Seller ratings/reviews** build trust (MVP).
- **"More from seller"** at MVP (hidden if none). **"Similar items" is later.**
- **Compatibility** shown as the seller's freeform notes (non-authoritative).

## 8.9 Saved

**Purpose:** a simple, utility-focused bookmarks page — "stuff I saved, grouped by type." A key input to the recommendation engine.

- **Saveable at MVP:** parts/listings, cars, and sellers (user accounts).
- **No saved searches** at MVP. **No build saves** (builds are a deferred concept).
- **Optional:** saving an activity post to revisit — only if low-complexity, else skip.
- Grouped by type; clean bookmarks, **not** a workspace yet (may evolve into build-planning/wishlist later).

## 8.10 Notifications

**Purpose:** keep users engaged beyond just selling; split so it never feels like it's only about offloading parts.

- **Two separate sections (never one combined list):**
  - **Profile** (engagement) **first** — listing interest on your stuff, car follows, saves on your car, build/activity comments. (Avoid the word "Social"; "Profile" or "Activity.")
  - **Marketplace** second — sold, new offer, offer accepted/declined, question on your listing, saved-item price drop.
- No generic/internal noise — keep it meaningful.

## 8.11 Settings

**Purpose:** account/profile configuration + notification prefs + billing/payout, and the practical home for some content-editing panels.

- Account/profile config: username, avatar, links, notification preferences.
- **Billing & payout settings** (Stripe likely) — scaffolding now; not wired up (processor choice open).
- **Purchase/sales history** surfaced (with checkout).
- **Car/mods editing lives in the Garage**; other editing panels go wherever practical.
- **Retain the in-app design-system reference page here** during testing (§7.8).
- Uses the read.cv-style settings/editor modal pattern (the content-management layer, §7.5).

## 8.12 Activity Detail

Tapping an activity entry (from a car's Activity tab or a profile summary) opens a focused post: back link, post header, long-form body sections, image gallery, optional embedded video, and reactions + a reply input. Stays in the clean baseline column.

---

# 9. Design System

## 9.1 Intent & Discipline

Dark, premium, modern, enthusiast-native — but disciplined: **imagery-forward only on Home + marketing/explainer pages.** All other product surfaces use the clean, structured **read.cv-style baseline**. Neil will supply read.cv reference imagery for those pages.

## 9.2 Tokens (standardize)

| Token | Value | Usage |
| --- | --- | --- |
| `bg-app` | `#1A1D1F` | Primary product background |
| `bg-surface` | `#1E2124` | Content surface / cards |
| `bg-raised` | `#272B30` | Raised/selected states |
| `text-primary` | `#EEEEEE` | Main text |
| `text-secondary` | `#BBBBBB` | Secondary text |
| `text-muted` | `#888888` | Metadata/labels |
| `accent-primary` | **`#3B71FE`** | Primary CTA blue (standardized — not `#007AFF`) |
| `accent-success` | `#34C759` | Active/new/success |

- **Radius:** cards/surfaces 24px; buttons/pills full/90px; small utility 7–16px.
- **Buttons:** primary = blue fill, white text, ~48px, pill; secondary/ghost per the built system.
- **Layout:** product/profile pages use a focused ~540px column (phone-first, low-scroll brief); Explore, Marketplace, and marketing are wider, discovery-heavy exceptions.
- **Type:** DM Sans (display/headings), Inter (dense UI/metadata), a brand face for the logo. Define component-level usage to avoid font soup.
- **All of the above are tokens** (§7.8) so a future design system can replace them wholesale.

## 9.3 Component Seed

Reuse the inventory documented on `/design-system` (App Shell, Profile & Vehicle, Timeline & Media, Activity Detail, Explore & Settings, Marketing, Specialty). Refactor to be token-driven. Add the **new** components v3 requires: marketplace category tiles (icon-based), the search/filter module, the listing purchase card (cart/offer/buy), listing Q&A, the content-management editor modals, and the mod-item editor (paste → parse → confirm).

---

# 10. Technical Architecture

- **Frontend:** Next.js + TypeScript, Tailwind CSS. (Note: this project targets a newer Next.js — consult `node_modules/next/dist/docs/` before writing routing/app code.)
- **Backend:** Supabase (Postgres, Auth, Storage, RLS, Realtime).
- **Payments:** Stripe Connect (or equivalent; processor decision pending) for checkout, offers, payouts, platform fee.
- **AI (deferred/optional):** RAG over the Stunspots corpus for mod-parsing/enrichment and, later, build-plan reasoning — run on-save + cached, cheap models.
- **Design tokens:** single source of truth (CSS variables + Tailwind theme) consumed by all components.
- **Reuse:** build on the existing repo; adapt current components.

### Suggested schema additions vs v2.1

Keep v2.1's core tables and extend for commerce + structured mods:

- `mod_items` (car_id, category, brand, product, part_number?, raw_text, linked_listing_id?, confidence)
- `orders`, `order_items`, `offers`, `payments`, `payouts`, `platform_fees`
- `reviews` (order-linked buyer↔seller ratings)
- `listing_questions` (public Q&A on listings)
- `messages` (marketplace-scoped: listing/offer threads only)
- Retain `wanted_parts` / build-goal tables for the deferred recommendation work.

---

# 11. Monetization

- **Primary (MVP):** platform transaction fee on in-app sales (small %, normalized from day one).
- **Also early:** featured listings; affiliate links on linked parts.
- **Later:** shop/business profiles, promoted sellers, promoted builds/events.

---

# 12. Milestones (re-sequenced for marketplace-first + checkout-at-MVP)

- **M0 — Foundation:** adapt repo; token-driven design system; app shell (sidebar); auth; Supabase + RLS; storage; retain `/design-system` via Settings.
- **M1 — Cars & Profiles:** garage (private), car profiles (image-forward, structured mods incl. paste→parse→confirm), lightweight user profile, content-management editor modals, public car URLs.
- **M2 — Marketplace Core:** search + icon category browse + category/subcategory pages; listings; Sell flow (single sectioned form); garage-fitment toggle + "fits your car" badge (metadata-based).
- **M3 — Commerce:** in-app checkout (cart, offer, purchase), Stripe Connect, payouts, platform fee, buyer/seller reviews, listing Q&A, marketplace messaging.
- **M4 — Discovery & Engagement:** Explore (mixed feed + tabs), saves, follows, likes, notifications (Profile + Marketplace sections), "more from seller."
- **M5 — Recommendations (phased):** P1 rule-based recommendations; introduce build-goal + Stunspots-aided parsing where beneficial.
- **Later:** similar items, saved searches, general DM inbox (if justified), shop/business profiles, events, AI build-plan.

---

# 13. Open Questions (to resolve in design)

1. **Where do a user's listings live/are managed** — Garage, a seller/marketplace area, or the home feed? (Unresolved.)
2. Final name for the engagement notifications section — **"Profile" vs "Activity."**
3. **Payment processor** choice (Stripe likely) and integration approach.
4. **Build-goal** design — how it's set and how deeply it drives recommendations.
5. Whether **saving activity posts** is worth the added complexity at MVP.
6. Final **tagline / marketing hero** copy.
7. **Mod entry UX** details: how confirmed, how linked items visually signal "for sale."
8. User Profile layout — evaluate **multiple HTML options** before committing.
9. Exact split of what content-editing lives in **Settings vs Garage**.

---

# 14. Acceptance Criteria (v3 highlights)

- **Marketplace-first:** a new visitor immediately understands DRVN as a place to buy/sell parts for modified cars, with car context.
- **Checkout:** a buyer can add to cart, make an offer, or purchase in-app; a platform fee applies; buyer/seller can review after a sale.
- **Listings:** created via a single sectioned Sell form; source-car link optional; compatibility is freeform/non-authoritative; public Q&A works.
- **Cars:** image-forward car page with a structured, linkable mod list (paste→parse→confirm), modal gallery, per-car activity, and active listings.
- **Fitment integrity:** no user-asserted fitment drives the platform's "fits your car" signal.
- **Discovery:** Marketplace (intent), Explore (inspiration feed + tabs), and logged-in Home (dashboard→feed) are visibly distinct.
- **Design:** token-driven; imagery-forward only on Home/marketing; product surfaces use the clean baseline; accent blue standardized to `#3B71FE`; an in-app design-system reference page is reachable via Settings.
- **Architecture:** built by adapting the existing repo and reusing its components.

---

# 15. Final Definition

DRVN is a **marketplace-first platform for modified cars**: the easiest place to sell the parts you pull off your build and to find parts that fit yours — made trustworthy by real car profiles, structured builds, seller ratings, and source-car context. Everything else exists to make that marketplace more useful, more trusted, and more fun to return to.

> **Show your build. Sell your parts. Find what fits.**
