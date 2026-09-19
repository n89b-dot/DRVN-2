# DRVN Product Requirements — September 2026 direction

> **Status (2026-09-19): current.** This is the product definition DRVN is being built towards. It supersedes `DRVN-PRD-v3.1.md` (retained as design rationale and as-built history). Where the two disagree, this document wins. The work that delivers it is in [`plans/2026-09-direction-build-plan.md`](plans/2026-09-direction-build-plan.md).
>
> Living artifacts (private to Neil): Direction — https://claude.ai/artifact/RtxJD7miquRrULqpnkowxw · Build plan — https://claude.ai/artifact/1tSqTJ2YTC5nTDGv1EApqY

## 1. The product

**DRVN is the home for your car and its build — follow what others are building, and buy or sell the parts that come off.**

One product, two front doors, the car in the middle.

- **You → your garage → what happens to your cars.** A profile has a garage; each car has its updates and its parts. The parts you sell are your **store**, and your store is a tab on your profile that looks and works like the marketplace.
- **Explore** is door one: one scrolling feed of builds, updates and parts, with people to follow and what's trending mixed in.
- **Marketplace** is door two: filters down the side, cards four across, cart and checkout. It works with no account. Every card can name the car the part came off.
- **Home** (signed in): Following · For you · Local. A quick post box on top; your garage and parts-for-your-cars alongside.

### What changed from v3.1

v3.1 defined DRVN as a "marketplace-first platform" where cars and social features exist to support listings. The product that was actually built — and what the founders want — is car-centred, with community and commerce as two equal ways in. Consequences recorded here so nobody re-derives them:

- The marketplace is fully public, including parts on Explore for signed-out visitors. v3.1 §8.2 ("listings are a signed-in view") is **retired**; it is the origin of the `loggedInOnly` Parts gate in `src/lib/feed.ts`.
- The front door (`/`), the logo lockup and root metadata stop describing DRVN as only a parts marketplace. Marketplace routes keep marketplace wording for search engines.

### Principles

1. **The car gives context; it is never a gate.** You can list tyres with no car behind them, buy with no account, and post about a part with no garage.
2. **The community is why people come back; the marketplace is why it pays.** Both are legitimate reasons to arrive and both are marketed.
3. **Everything is about a car or a part.** Every post is attached to a car, a part, or both, and has a photo. That keeps the feed on topic without making posting feel restricted.
4. **Same for everyone first.** Fixed layouts; sections hide when empty; no personalisation engine.

### Vocabulary

Home, Explore, Marketplace, Garage, Profile, Store, Selling. Not "Build / Scene / Market", not "automotive graph".

## 2. Goals and non-goals

**Goals**

- A first-time visitor understands DRVN at `/` and can go either way in one click.
- Changing a part on a car is the easiest way to create a listing.
- A listing reaches the people following that seller or that car.
- Adding a part to a build is as easy as pasting a link.
- A person's store looks and works like the marketplace.
- A marketplace-only visitor never has to touch the social side.
- Every post is about a car or a part and has a photo.

**Non-goals this cycle** (each is a ruling, not an oversight)

- Modular or personalised Home. Onboarding by intent (wanted, but its own later session).
- Maintenance, notes, records, car facts, "% complete".
- Polls, video upload, location tags, reposts, communities, free-form "what's on your mind" posts.
- Direct messages from a profile. Away / holiday mode. Buy now on marketplace cards. Dispatch-time statistics.
- Bottom tab bar (until there is a native app). Horizontal content shelves. New accent colour. New typeface. Sidebar artwork.
- Separate shop entity, catalogue sync, stock, product ratings, brand strips, sale events, bulk edit, stats dashboards.
- Whole-car sales. Part history across several cars.

## 3. Design system rulings

- **Typeface unchanged:** IBM Plex Sans and IBM Plex Mono, as in `docs/site/typography.md`.
- **Accent unchanged** (`--live`). **Light theme unchanged.**
- **Dark theme moves to a cooler paper** (one block, `src/app/globals.css` `[data-theme="dark"]`): `--paper #121418`, `--paper-deep #0c0e11`, `--tile #1c1f25`, `--tile-2 #171a1f`, `--ink #eceef2`, `--dim #8a909b`, `--img-fallback #22262d`, `--on-ink #14161a`, `--ghost-hover #262a31`; ink-tint tokens swap `240,238,229` → `236,238,242`.
- **Reuse before create.** Screens are composed from the registry. A new component is made only when it is clearly better than extending or composing an existing one, and it is then registered, documented and given a specimen. CSS-only needs become named recipes, not wrapper components.
- If imagery is ever generated, use the Higgsfield MCP. Nothing here requires it.

## 4. Requirements

Priority: **P0** the direction doesn't hold without it · **P1** needed for the screens to be real · **P2** later. State: Exists / Change / New.

### 4.1 Shell and front door

| ID | Requirement | P | State |
|---|---|---|---|
| N-1 | Rail order: Home, Explore, Marketplace, Garage, Selling, Messages, Profile | P1 | Change |
| N-2 | Global search in the top bar on every page (existing suggest endpoint) | P1 | New |
| N-3 | A **Post** button in the top bar. "List a part" stays where it is in the rail | P1 | Change |
| N-4 | Mobile keeps the full-screen menu; no bottom bar | P0 | Exists |
| N-5 | Messages shows an unread count | P1 | New |
| F-1 | Landing leads with the car; two equal actions — Add your car · Shop parts; builds before parts | P0 | Change |
| F-2 | Lockup and root metadata stop saying "Parts marketplace"; marketplace routes keep marketplace wording | P0 | Change |
| F-3 | Sign-up, onboarding and return-to-where-you-were unchanged | P0 | Exists |

### 4.2 Home

| ID | Requirement | P | State |
|---|---|---|---|
| H-1 | Tabs Following · For you; Following falls back to For you when you follow no one | P0 | Change |
| H-2 | Local tab, shown once you've set a country + region on your profile | P2 | New |
| H-3 | Quick post box on top of the feed | P1 | New |
| H-4 | Desktop rail: Your garage (main car first) · Parts for your cars · Builders to follow · Browse Marketplace | P1 | Change |
| H-5 | Phones: one column; rail tiles become full-width cards after the 3rd and 8th post; nothing scrolls sideways | P0 | New |
| H-6 | "Needs you" and seller KPIs leave Home; figures unique to Home move to Selling | P1 | Change |

### 4.3 Explore

| ID | Requirement | P | State |
|---|---|---|---|
| E-1 | One vertical wall; every card the same footprint with a fixed caption block; no double-width or text-only cells | P0 | Change |
| E-2 | Kinds differ only by label and one line: build → car + counts; update → title/first line + car; part → price + "Off {car}" + cart | P0 | Change |
| E-3 | Icon segments: All · Builds · Parts · Updates · Builders | P1 | Change |
| E-4 | Full-width breakers between rows: Trending now (wrapping chips); Builders to follow (stacked rows) | P1 | New |
| E-5 | Parts visible on Explore, in search and in suggestions for signed-out visitors | P0 | Change |

### 4.4 Marketplace

Mock 4's layout with mock 3's card.

| ID | Requirement | P | State |
|---|---|---|---|
| M-1 | Page head with "Find the part. See the car it came off.", search, and the vehicle control beside it (defaults to main car) | P1 | Change |
| M-2 | Category tiles stay icons with counts | P0 | Exists |
| M-3 | Desktop left sidebar: Category, Brand, Condition, Price, Ships from, Fits my garage. Below desktop width: today's sheet, same fields | P0 | Change |
| M-4 | Four / three / two cards across | P0 | Exists |
| M-5 | Card: photo + bookmark · title · price · condition and grade · fitment · one line of description · seller photo, name, "N for sale" · "Off my {car}" → build · add-to-cart. No rating, no car thumbnail, no Buy now | P0 | Change |
| M-6 | Brand on listings: prefilled from the mod or importer, matched from titles otherwise, backfilled, editable. Saved searches and their alerts understand it | P1 | New |
| M-7 | Optional "miles on this part" for used parts | P1 | New |
| M-8 | Item page, cart, guest checkout, offers, Q&A unchanged (item page gets its own session) | P0 | Exists |

### 4.5 Profile and Store

| ID | Requirement | P | State |
|---|---|---|---|
| P-1 | Header: banner (defaults to main car's cover), avatar, name, bio, location, links; followers · following · cars. No About block | P1 | Change |
| P-2 | Visitor actions: Follow (compact) · **Store** · share. No Message | P0 | New |
| P-3 | Tabs: Overview · Garage · Updates · Parts · Reviews; owner also sees Saved. No Builds tab, no activity log | P0 | Change |
| P-4 | Overview: main car · latest three updates · parts for sale | P1 | New |
| P-5 | Main car: drives featured car, default banner, car order everywhere (main first, then newest), Garage focus, Marketplace vehicle | P1 | New |
| P-6 | Parts tab = the store: the marketplace grid and card for this seller; All / Active / Sold; owner gets status badges and edit links | P0 | Change |
| P-7 | Trust strip: rating · sold · member since | P1 | Change |
| P-8 | Store note: one short line pinned above the grid | P1 | New |
| P-9 | Seller default: offer floor as a % of price | P2 | New |

### 4.6 Garage and parts by link

| ID | Requirement | P | State |
|---|---|---|---|
| G-1 | Switcher strip: every car, main first, plus All cars (today's list) and one Add vehicle | P0 | Change |
| G-2 | Focused car: cover with a gradient scrim so text reads on any photo; no user text on the image | P0 | New |
| G-3 | Stat strip from existing data (engine, drivetrain, trim, mods, updates, parts live, sold, followers); tiles render only with values; fewer than three → no strip | P1 | New |
| G-4 | Tabs: Overview · Mods · Parts · Media. "Next" to-dos and earnings kept as an Overview section to evaluate | P1 | Change |
| G-5 | Parts tab: for sale and sold from this car, plus "came off, not listed" with List it | P0 | Change |
| L-1 | "Add mod" opens on *Paste a product link*; typing stays first-class; paste-a-list unchanged | P1 | New |
| L-2 | Fills title, brand, part number, image, shop, reference price; everything editable; a failed fetch falls back to typing | P1 | New |
| L-3 | Public build page shows the mod's thumbnail and a plain link out | P1 | Change |
| L-4 | A shop's product photo never becomes a listing photo | P0 | New |

### 4.7 The three loops

**A — Change a part, sell the old one**

| ID | Requirement | P | State |
|---|---|---|---|
| A-1 | Removing or replacing a saved mod asks inline: "What happens to the old part?" → List it · Just remove it. "Delete — added by mistake" remains | P0 | New |
| A-2 | Removal is a state, not a delete. "Came off this car" on the public build and in the Garage | P0 | New |
| A-3 | Composer: sell link on "replaced" as well as "removed"; seeded blocks carry the mod id; publishing offers to mark the part removed | P0 | Change |
| A-4 | "List it" opens the sell form prefilled from the mod and car | P0 | Exists |

**B — A listing reaches the people following you**

| ID | Requirement | P | State |
|---|---|---|---|
| B-1 | Following includes new listings from sellers and cars you follow; at most three in a row from one seller | P0 | New |
| B-2 | Feed only; no push or email for new listings | — | Decision |

**C — Buy a part, add it to your car**

| ID | Requirement | P | State |
|---|---|---|---|
| C-1 | Completed order → "Add to a car in your garage"; the mod line shows "Bought on DRVN · off {car}" when the source build is public | P1 | New |

### 4.8 Posting

| ID | Requirement | P | State |
|---|---|---|---|
| W-1 | Quick post: pick a car → 1–6 photos → caption → Post. No title. "Write a full update →" carries everything into the editor | P1 | New |
| W-2 | Every post needs a photo — quick or full. Drafts are exempt | P1 | Change |
| W-3 | Tag a part: a picker over your active listings (current car's first, type to filter, or paste your own listing link); up to three per post; available in the quick box and as a "Part for sale" block in the editor | P1 | New |
| W-4 | Tagged parts render as a compact row under the photos with price and add-to-cart; "Sold" when sold; the listing page gains "Posts about this part" | P1 | New |
| W-5 | Posting with no car: tag a part instead. A post must have a car, a tagged part, or both | P2 | New |

## 5. Data changes

| Object | Change |
|---|---|
| `mod_items` | + `status` (installed / removed), `removed_at`, `source_listing_id`, `product_url`, `image_url`, `source_domain`, `ref_price_cents`; `save_mod_items` re-created once to carry them |
| `listings` | + `brand`, `part_miles`, `part_miles_unit`; `save_listing_creation` and the listing search text updated; new index `(seller_id, status, created_at desc)` |
| `profiles` | + `main_car_id`, `store_note`; later `default_offer_floor_pct`, `country`, `region`. Each needs explicit column grants |
| `activity_posts` | `title` nullable; publish requires a photo; new `listing` block + mirror table `activity_post_listings`. Later: `car_id` nullable with a "car or tagged part" rule |
| `feed_events` view | Later: append `owner_id` so Local can filter by region |
| Saved searches | `brand` added to `SAVED_SEARCH_KEYS` |
| New RPCs | `suggested_builders`, `trending_models`, `seller_active_counts`, `marketplace_brand_counts`, `local_feed_rows` |

Not needed: tables for shops, personas, home modules, away mode, car facts, notes, maintenance or part-history chains.

## 6. Measures

- **Is it one product?** Share of listings with a source car · share of removed mods that become listings · share of purchases added to a car · listing views arriving from a car, profile or post.
- **Do people come back?** Members active in a week without buying · posts per active car per month · share of mods added by link · share of posts that tag a part.
- **Does the second door work?** Guest checkouts completed · store visits from the profile's Store button.

## 7. Parked — and what would bring each back

| Idea | Bring it back when |
|---|---|
| Modular / personalised Home | Real usage shows two clearly different patterns and the fixed Home fails one |
| Onboarding by intent | Scheduled as its own session |
| Message button / open DMs | Listing Q&A and offers demonstrably aren't enough for pre-sale contact |
| Away mode | Sellers ask, or late-dispatch complaints appear |
| Dispatch-time statistic | Orders record paid and shipped times reliably |
| Buy now on cards | Cart-to-checkout drop-off suggests it |
| Bottom tab bar | There is a native app |
| Maintenance, notes, records | Members ask unprompted |
| Shop entity, catalogue sync, stock, product ratings | Real shops ask to list more than one of something |
| Part history across cars · whole-car sales | Purchases are regularly added to cars · the parts marketplace is healthy |
