# DRVN — Product Overview & Design Rationale

> **What to read this for:** the plain-English "what and why" behind DRVN. The
> [PRD (DRVN-PRD-2026-09.md)](DRVN-PRD-2026-09.md) is the authoritative spec; this document is
> the narrative companion — what the app essentially is, what we're trying to build, and *why*
> the pages and design choices are the way they are. Where this and the PRD ever disagree,
> the PRD wins.
>
> The framing below was rewritten on 2026-09-19 (workstream 1 of the
> [build plan](plans/2026-09-direction-build-plan.md)). Before then this document, like
> [DRVN-PRD-v3.1.md](DRVN-PRD-v3.1.md), called DRVN "marketplace-first", with cars and
> community existing to support listings. Sections further down that still read that way are
> as-built history of individual screens, not direction.

## What DRVN essentially is

DRVN is **one product with two front doors and the car in the middle**. The one-line promise:

> **The home for your car and its build — follow what others are building, and buy or sell
> the parts that come off.**

A profile has a garage; each car has its updates and its parts; the parts you sell are your
**store**, which is a tab on your profile that looks and works like the marketplace.
**Explore** is door one — one scrolling feed of builds, updates and parts, with people to
follow and what's trending mixed in. The **Marketplace** is door two — filters down the side,
cards four across, cart and checkout, working with no account at all. Every card can name the
car the part came off.

Enthusiasts are constantly pulling parts off their cars, and there is no enthusiast-native
place to sell them *with real context*. DRVN is that place — but it is also where the car
itself lives between transactions, which is the part that brings people back. **The community
is why people come back; the marketplace is why it pays.** Both are legitimate reasons to
arrive, and both are marketed.

**What DRVN is:** a public home for your car and its build, a feed of what everyone else is
building, a build-aware parts marketplace, and a store per member.

**What DRVN is *not*:** a generic social feed, an Instagram/TikTok clone, a
Craigslist/Facebook-Marketplace clone, a forum, or a generic e-commerce store.

## What we're trying to create

**A place where a car's build and the parts that come off it are the same product.** Someone
documents what they have done to their car; when a part comes off, listing it is the easiest
thing to do next; that listing reaches the people following the seller or the car; and a
buyer can add what they bought back onto their own car. Those three loops are the product.

The car's **trust-and-context layer is now load-bearing, not a supporting feature**: a good
DRVN listing answers four questions ordinary classifieds can't —

- **What car did this part come off?** — source-car context
- **Who's the seller, and are they credible?** — profile + ratings
- **Is it likely to fit my car?** — fitment (handled with integrity; see below)
- **What was it paired with / how was it used?** — the seller's freeform notes

(Historical note: through mid-2026 this document argued the opposite — that provenance was a
supporting feature and should never be the headline. The September 2026 direction reverses
that: the car is the middle of the product.) Seven principles drive every decision:

1. **The car gives context; it is never a gate.** You can list tyres with no car behind them,
   and buy with no account.
2. **The community is why people come back; the marketplace is why it pays.** Neither serves
   the other.
3. **Everything is about a car or a part.** Every post is attached to a car, a part, or both,
   and has a photo.
4. **Same for everyone first.** Fixed layouts; sections hide when empty; no personalisation
   engine.
5. **Never trust user-asserted fitment.** Seller compatibility notes are informational only
   and must never drive the platform's authoritative "fits your car" signal.
6. **Clean by default, rich where it earns it.** Imagery-heavy treatment is reserved for the
   front door and the photo walls; product pages stay minimal, structured, and scannable.
7. **Token-driven and swappable.** Build against centralized design tokens; reuse the
   component registry before adding to it.

### How this differs from the earlier directions (v2.1 → v3 → 2026-09)

Two shifts, in order. **v3** took a product that treated profile, marketplace and social as
roughly co-equal with checkout deferred, and made the marketplace the headline with real
in-app checkout at MVP. **The September 2026 direction** keeps the checkout and drops the
headline: the car is the middle of the product and the marketplace is one of two front doors,
both public. Concretely, v3 established: commerce (cart + make-offer + purchase + platform fee +
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

The navigation is a **left collapsing sidebar** for the product, in a fixed order — Home,
Explore, Marketplace, Garage, Selling (a family of five), Messages, Profile, then Settings;
utility: Cart, Notifications, Saved. Garage sits above Selling because the car is the middle
of the product and Selling is a workspace you enter when you have something to run. A top
horizontal nav is reserved for the front door and marketing pages. Three discovery surfaces are kept deliberately distinct so they never
collapse into one blurry feed: **Marketplace** = intent-driven part search, **Explore** =
lean-back inspiration, **Home** = a light dashboard that flows into the feed.

### Home — two experiences by auth state
Logged-out is **imagery-forward marketing** at `/`: an editorial hero leading with the car
("The home for your car and its build"), two equal actions — Add your car · Shop parts — a
short "what DRVN is" loop that runs garage → community → market, then builds before parts. Logged-in is
a **light dashboard header** (garage strip, quick actions like Sell / Add car, saved +
notification highlights) that flows into the Explore feed — Marketplace always one tap away.
Home is an aggregator, so its exact composition is finalized *last*, after the object pages
are settled.

### Explore — one wall, everything public
A single **mixed feed** of cars, builds, build updates and parts, with segments (All ·
Builds · Updates · Parts). Every segment is public: a signed-out visitor sees parts in the
wall, in the Parts segment, in search and in the suggestions. (Until September 2026 parts
were signed-in-only here, from v3.1 §8.2's "listings are a signed-in view"; that ruling is
retired — the marketplace is a front door, and hiding stock from strangers cost sales.)
Strong content-type labels keep cars/builds/parts/updates from blurring together.

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
