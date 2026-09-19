# DRVN — Product Overview & Design Rationale

> **Direction changed (2026-09-19):** the authoritative spec is now [DRVN-PRD-2026-09.md](DRVN-PRD-2026-09.md) — one product, two front doors, the car in the middle. The "marketplace-first" framing in this document is out of date and gets rewritten as part of workstream 1 of the [build plan](plans/2026-09-direction-build-plan.md).

> **What to read this for:** the plain-English "what and why" behind DRVN. The
> [PRD (DRVN-PRD-v3.1.md)](DRVN-PRD-v3.1.md) is the authoritative spec; this document is the
> narrative companion — what the app essentially is, what we're trying to build, and *why*
> the pages and design choices are the way they are. Where this and the PRD ever disagree,
> the PRD wins.

## What DRVN essentially is

DRVN is a **marketplace-first platform for modified cars**. The one-line promise:

> **The home for your modified car — show off your build, and buy or sell the parts behind it.**

Enthusiasts are constantly pulling parts off their cars — stock parts when they upgrade, old
parts when they change direction, spares they never installed — and there's no clean,
enthusiast-native place to sell them *with real context*. DRVN is that place. The
**marketplace is the core utility and the primary reason to join.** Everything else — car
profiles, build activity, light social features — exists to give listings **context and
trust** ("this part came off *this* car, owned by *this* credible seller") and to give people
a reason to keep coming back beyond a single transaction.

**What DRVN is:** a build-aware parts marketplace, a public profile for your car, a
lightweight place to post your car's progress, and a way to discover parts with real
fitment/source context.

**What DRVN is *not*:** a generic social feed, an Instagram/TikTok clone, a
Craigslist/Facebook-Marketplace clone, a forum, or a generic e-commerce store.

## What we're trying to create

**A marketplace for parts from modified cars.** The main point of the platform is buying and
selling the parts behind enthusiasts' builds — selection, easy listing, easy buying, and the
enthusiast identity around it. That's the product.

The car profile's **trust-and-context layer is a supporting feature, not the mission.** It's
a genuine differentiator and should stay featured in most of the places it appears today: a
good DRVN listing *can* answer four questions ordinary classifieds can't —

- **What car did this part come off?** — source-car context
- **Who's the seller, and are they credible?** — profile + ratings
- **Is it likely to fit my car?** — fitment (handled with integrity; see below)
- **What was it paired with / how was it used?** — the seller's freeform notes

— but provenance/documentation is not what DRVN *is about*, and it should not be treated as
the product's headline in design, copy, or roadmap decisions. (Historical note: earlier
framings over-weighted this layer as "the reason to exist"; clarified 07.2026.) Six
principles drive every decision:

1. **Marketplace-first.** Every choice optimizes for buying and selling parts with context.
   Identity and social features serve the marketplace, not the other way around.
2. **Cars are first-class context objects.** A car gets its own public page, gallery,
   structured mods, activity, and listings — largely to give the marketplace trust and depth.
3. **Never trust user-asserted fitment.** Seller compatibility notes are informational only
   and must never drive the platform's authoritative "fits your car" signal.
4. **Clean by default, rich where it earns it.** Imagery-heavy treatment is reserved for Home
   and marketing pages; product pages stay minimal, structured, and scannable.
5. **Token-driven and swappable.** Build against centralized design tokens so a future design
   system drops in without rewriting pages.
6. **Adapt, don't rebuild.** Reuse the existing prototype's components and patterns.

### How this differs from the earlier direction (v2.1 → v3)

The single most important shift: DRVN used to treat profile + marketplace + social as roughly
co-equal, with checkout deferred. **v3 makes the marketplace the headline and ships real
in-app checkout at MVP.** Concretely: commerce (cart + make-offer + purchase + platform fee +
buyer/seller reviews) is in the MVP; there is no standalone "Build" page (build = per-car
activity); messaging is marketplace-scoped only (no general DM inbox); fitment is freeform
seller notes (not a structured picker users can assert as truth); and the product shell is a
left collapsing sidebar rather than a top nav.

## Why the design looks the way it does

> **Note (2026-08-09):** the two subsections below record the **v1-era rationale** (dark
> `#1A1D1F`, blue `#3B71FE`, DM Sans) and are kept for the reasoning. The shipped system
> today is **Livesheet**: IBM Plex Sans/Mono, light-first paper `#efede6` / ink `#20232a`,
> a single signal accent (live `#f03a20`), and a descending radius scale (16/10/6/3).
> Details live in the in-app `/docs` microsite and
> [docs/livesheet-inventory.md](livesheet-inventory.md).

### Dark, premium, enthusiast-native — but disciplined
The palette is dark by design (app background `#1A1D1F`), because automotive photography —
paint, chrome, night shots — reads dramatically better on dark surfaces. But the key
discipline is **"clean by default, rich where it earns it."** Imagery-forward treatment is
reserved for **Home and marketing/explainer pages**; every other product surface uses a
clean, structured, **read.cv-style baseline**. This keeps the product fast, scannable, and
free of the "generic Pinterest" blur — photos are used where they sell the dream, and
structure is used where people are trying to get something done.

### The visual language
- **Large radii (24px cards/surfaces, 90px pills)** and a single blue accent (`#3B71FE`,
  standardized — not `#007AFF`) keep CTAs unmistakable while letting car photos supply the
  color. One accent avoids fighting the photography.
- **Focused ~540px column** on product/profile pages (phone-first, low-scroll), with
  Explore, Marketplace, and marketing as deliberately wider, discovery-heavy exceptions.
- **Typography with defined roles** — DM Sans for display/headings, Inter for dense UI and
  metadata — to avoid "font soup."
- **Everything is a token** (CSS variables + Tailwind theme) so a future design system can be
  swapped in wholesale without touching pages. The existing `/design-system` page (~50
  components across 7 groups) is treated as the reusable seed of the real component library.

## Why the pages are shaped the way they are

The navigation is a **left collapsing sidebar** for the product (Home, Explore, Marketplace,
Garage, Profile; utility: Notifications, Saved, Settings), with a top horizontal nav reserved
for marketing pages. Three discovery surfaces are kept deliberately distinct so they never
collapse into one blurry feed: **Marketplace** = intent-driven part search, **Explore** =
lean-back inspiration, **Home** = a light dashboard that flows into the feed.

### Home — two experiences by auth state
Logged-out is **imagery-forward marketing**: an editorial hero leading with the marketplace
utility wrapped in car identity, a short "how DRVN works" loop, and proof rails. Logged-in is
a **light dashboard header** (garage strip, quick actions like Sell / Add car, saved +
notification highlights) that flows into the Explore feed — Marketplace always one tap away.
Home is an aggregator, so its exact composition is finalized *last*, after the object pages
are settled.

### Explore — inspiration, not parts-first
A single **mixed feed** of cool cars, builds, and build updates, with secondary tabs (Cars +
Builds, Parts). It's a lean-back surface, so builds lead and parts appear only for logged-in
users (parts to a logged-out browser here would be confusing). Strong content-type labels
keep cars/builds/parts/updates from blurring together.

### Marketplace — focused, intent-driven
The goal is "I have a Golf R, find an exhaust" made effortless: a prominent search + filter
bar on top (keyword, car, category, condition, price, location), then **browse-by-category**
using a **condensed ~6-category taxonomy** (Performance; Engine; Exterior & Body; Interior &
Lighting; Brakes & Suspension; Wheels & Tires). Categories use **custom icons, not photos** —
cleaner and faster to scan. A **garage-fitment toggle** ("show parts that fit my car") adds a
"fits your [car]" indicator — driven by *platform* fitment, never seller claims.

### Sell — "list a part in under 3 minutes"
A **single, well-sectioned form** (not a wizard) covering basics → photos → came-from car
(optional) → compatibility notes → price/location → review, with an optional sticky preview.
Linking to a garage car is **fully optional** (people sell parts for cars they've since
sold). Compatibility began as **freeform seller notes** only; since migration `0025` the
sell form also has a **structured fitment picker** backed by platform (vPIC-sourced)
make/model data, so structured fitment comes from platform data rather than free
assertion. The integrity rule still stands: seller-stated compatibility remains clearly
labeled non-authoritative and never drives the platform's "fits your car" signal.

### Garage — a private back-office
The garage is your **private dashboard** for managing cars and their content — not the public
"here are my cars" view (that lives on your profile). Cars are listed first; "Add a car" is a
compact, elegant action (the old giant top-of-page form was wrong). Each car has an action
menu: edit, list a part from it, edit mods, view public page, add activity updates.

### User Profile — a lightweight identity hub
"Link-in-bio for your car life": points to your cars and listings and links out (YouTube,
Instagram, website). Deliberately **minimal** — followers are MVP, but full activity feeds and
reputation are post-MVP (except seller ratings, which are MVP because checkout needs trust).
No cover image at MVP; a large avatar is enough. One flexible profile for now, with the data
model architected for a shop/business profile type later.

### Car Profile — the centerpiece
This is where people land and linger, so it **earns image-forward treatment** — but it's kept
from being bogged down by photos: the gallery **expands into a modal** to keep the page clean.
The module hierarchy: identity block → meta chips (year, color, location, tags like "Bagged"
/ "FBO") → About/Activity tabs → about text → gallery → **structured Modifications** → Wheels
& Tires, plus an **"active listings from this car"** module. Modifications are discrete,
linkable items (some link straight to a listing for sale) entered via **paste → AI parse →
confirm** — the connective tissue between a build and the marketplace. Notably, **there is no
standalone Build page**: the build lives as the car's Activity tab, plus a deferred build-goal
concept that will feed recommendations later.

### Listing Detail — evaluate and transact with confidence
Gallery grid + a right-side **purchase card** (price, seller with rating, location, quantity)
with **in-app checkout at MVP**: Add to cart, Make an offer, Purchase now. **Public Q&A** on
the listing lets buyers ask and sellers reply in context. The **source car appears as a
badge/highlight** ("came off this car"), not a giant section. "More from seller" ships at MVP
(hidden if none); "similar items" comes later.

### Saved & Notifications — engagement, kept meaningful
**Saved** is a simple bookmarks page grouped by type (parts, cars, sellers) — and an important
input to the recommendation engine. **Notifications** are split into **two never-combined
sections**: Profile/engagement first (follows, saves, comments on your stuff), Marketplace
second (sold, new offer, offer accepted, questions, price drops) — so the product never feels
like it's only about offloading parts.

### Settings — config + the content-management layer
Account/profile config, notification prefs, and real billing/payouts — Stripe Connect
onboarding lives in Settings → Payments, with the payout ledger at `/payouts` — plus
purchase/sales history now that checkout is live. It's also the practical home for some of
the **read.cv-style editor modals** — the content-management layer the prototype was missing,
which is a first-class part of the build, not an afterthought. The design reference now
lives in the in-app docs microsite (`/docs/design-system`).

## Why the technical choices support the product

- **Next.js + TypeScript + Tailwind + Supabase** — server-rendered public pages (car/listing
  detail) are fast and indexable, which matters because SEO is an acquisition channel; a
  relational Postgres schema fits the highly structured domain (cars, mods, listings, orders);
  and RLS enforces ownership at the database layer rather than trusting UI code.
- **In-app checkout means real payments infrastructure** — Stripe Connect (or equivalent),
  seller payouts, order/fee handling, and buyer/seller reviews are all MVP because a
  marketplace people actually transact on needs them from day one. A small platform fee is
  charged from launch so introducing a fee later isn't a bait-and-switch.
- **Structured, linkable mods (paste → parse → confirm)** — a cheap, cached AI parse turns a
  freeform mod list into discrete items the user confirms, each optionally linked to a
  listing. This is what connects "here's my build" to "here's the part, for sale."
- **Fitment as a separate, integrity-protected system** — the authoritative "fits your car"
  signal is derived from car metadata + category (and eventually AI reasoning), never from
  seller claims, so bad or dishonest data can't poison the platform.
- **Token-driven architecture + adapt-the-repo** — build on the existing prototype's
  components, refactored to be token-driven, to minimize re-coding and let a future design
  system swap in cleanly.

## Where we are

*(updated 2026-08-09)* All milestones are shipped and the money is real. **Stripe is fully
integrated**: Connect onboarding for sellers, PaymentIntents checkout with saved payment
methods, transfers that move only on buyer-confirmed delivery plus a 7-day clearing hold,
a durable refund state machine that reverses the seller's transfer on every refund path,
a dispute SLA with escalation and auto-refund, and a webhook that is the settlement
authority. Messaging exists (`/messages`, order-scoped threads) alongside a dedicated
offers surface (`/offers` with negotiation threads). There is a full **admin console** at
`/admin` (role-based membership, append-only audit log, disputes/orders/listings/users/
reports/payments-ops/settings surfaces). The schema stands at **28 applied migrations**,
and CI runs typecheck/lint/unit tests, the SQL guard suites (`purchase_guard`,
`admin_guard`) against a real Postgres, and the E2E specs. For history see
[CHANGELOG.md](../CHANGELOG.md); for the original as-built requirements see
[DRVN-PRD-v3.1.md](DRVN-PRD-v3.1.md) (retained as design rationale).

> **Show your build. Sell your parts. Find what fits.**
