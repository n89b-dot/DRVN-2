# DRVN Product Requirements — September 2026 direction

> **Status (2026-09-19): current.** This is the product definition DRVN is being built towards. It supersedes `DRVN-PRD-v3.1.md` (retained as design rationale and as-built history). Where the two disagree, this document wins. The work that delivers it is in [`plans/2026-09-direction-build-plan.md`](plans/2026-09-direction-build-plan.md).
>
> Living artifacts (private to Neil): Direction — https://claude.ai/artifact/RtxJD7miquRrULqpnkowxw · Build plan — https://claude.ai/artifact/1tSqTJ2YTC5nTDGv1EApqY
>
> **Amended 2026-11-07 — W-3 keeps the picker.** Neil ruled on 7 Nov 2026 to keep the listing picker for tagging a part and drop "paste your own listing link" (R-w3). Nothing is built for it.
>
> **Amended 2026-10-18 — build intelligence ruled out.** Build Mine with AI equivalents, goal planning and similar-build search (agent plan B3) became a non-goal, and their parked row went.

> **Amended 2026-10-17 — the DRVN agent.** New §4.9 (Intelligence), a fifth principle, offers v2 (M-8 narrowed), and the mobile bottom bar (N-4 reversed, non-goal and parked row removed). Implementation plan: "DRVN AI-native: review and implementation plan" — https://claude.ai/code/artifact/0116734a-9a0d-4148-9efa-ecde4f9a177b (a repo copy goes in `docs/plans/` when build starts).

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
5. **Software acts only inside limits you set.** The agent does the tedious work of buying, selling and keeping a build up to date, but prices come from the member's own limits, it never speaks to other people, and money only moves when the member pays. Every task still works without it.

### Vocabulary

Home, Explore, Marketplace, Garage, Profile, Store, Selling, Agent. Not "Build / Scene / Market", not "automotive graph", not "assistant" or "bot" for the agent.

## 2. Goals and non-goals

**Goals**

- A first-time visitor understands DRVN at `/` and can go either way in one click.
- Changing a part on a car is the easiest way to create a listing.
- A listing reaches the people following that seller or that car.
- Adding a part to a build is as easy as pasting a link.
- A person's store looks and works like the marketplace.
- A marketplace-only visitor never has to touch the social side.
- Every post is about a car or a part and has a photo.
- A seller can hand lowball offers to an agent that negotiates inside their limits, and a buyer can do the same up to a maximum (2026-10-17).

**Non-goals this cycle** (each is a ruling, not an oversight)

- Modular or personalised Home. Onboarding by intent (wanted, but its own later session).
- Maintenance, notes, records, car facts, "% complete".
- Polls, video upload, location tags, reposts, communities, free-form "what's on your mind" posts.
- Direct messages from a profile. Away / holiday mode. Buy now on marketplace cards. Dispatch-time statistics.
- Horizontal content shelves. New accent colour. New typeface. Sidebar artwork. (The bottom tab bar left this list on 2026-10-17 — see N-4.)
- Separate shop entity, catalogue sync, stock, product ratings, brand strips, sale events, bulk edit, stats dashboards.
- Whole-car sales. Part history across several cars.
- Build intelligence: Build Mine with AI equivalents, goal planning, similar-build search (ruled out 2026-10-18; comparing two builds is "Compare with my car", which has no AI).
- Agents messaging other people (they may read their owner's messages for context, never reply). Automatic payment. Agent auto-accept of offers at launch. Open-ended chit-chat with the agent. Dynamic bundles. Admin and analytics agents.

A community-built product record (one entry per real part, grown from DRVN's own listings, Garages and sales) is **not** "catalogue sync": nothing is fed in from brands or retailers.

## 3. Design system rulings

- **Typeface unchanged:** IBM Plex Sans and IBM Plex Mono, as in `docs/site/typography.md`.
- **Accent unchanged** (`--live`). **Light theme unchanged.**
- **Dark theme moves to a cooler paper** (one block, `[data-theme="dark"]` in `src/app/styles/00-tokens-base.css`): `--paper #121418`, `--paper-deep #0c0e11`, `--tile #1c1f25`, `--tile-2 #171a1f`, `--ink #eceef2`, `--dim #8a909b`, `--img-fallback #22262d`, `--on-ink #14161a`, `--ghost-hover #262a31`; ink-tint tokens swap `240,238,229` → `236,238,242`.
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
| N-4 | (2026-10-17, reverses the September ruling) Below 1081px a bottom bar: **Explore · Marketplace · Home · Garage · Agent** — Home in the centre, Agent last. Profile (avatar), Messages, Notifications and Cart sit in the top bar; the full-screen Index menu stays for everything else. Signed out: Explore · Marketplace · Join. The bar hides on checkout, the sell form and composers. Prototyped at 360–390px before it ships | P1 | Change |
| N-5 | Messages shows an unread count | P1 | New |
| F-1 | (Revised 2026-10-17.) Landing says plainly what DRVN is — **the parts marketplace for modified cars** — and ties it to the visitor's own car: two actions, Shop parts for my car · Sell my parts; a "What do you drive?" picker; parts shown with the car they came off; the community as the reason to trust a part. "Add your car" lives in the selling story. Written for someone who has never seen DRVN — no in-app vocabulary (build page, provenance, feed) on the front door. Was: "leads with the car; Add your car · Shop parts; builds before parts" | P0 | Change |
| F-2 | Lockup stays "Builds and parts". The landing page's title and description say "parts marketplace for modified cars" (revised 2026-10-17, with F-1); marketplace routes keep marketplace wording | P0 | Change |
| F-3 | Sign-up, onboarding and return-to-where-you-were unchanged — except (2026-09-24) that "Add your car" now carries `next=/garage` through sign-up, and an account with nowhere to return to finishes onboarding on add-car, with "Skip — just browsing" going to Home | P0 | Change |

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
| E-4 | Full-width breakers between rows: Trending now (wrapping chips); Builders to follow (stacked rows). Each ships with its query and renders only when it has enough to show — never a placeholder | P1 | New |
| E-5 | Parts visible on Explore, in search and in suggestions for signed-out visitors | P0 | Change |

### 4.4 Marketplace

Mock 4's layout with mock 3's card.

| ID | Requirement | P | State |
|---|---|---|---|
| M-1 | Page head with "Find the part. See the car it came off.", search, and the vehicle control beside it. The main car is offered as the first one-tap choice — never applied for the visitor; an explicit or URL-supplied vehicle wins and a cleared filter stays cleared | P1 | Change |
| M-2 | Category tiles stay icons with counts | P0 | Exists |
| M-3 | Desktop left sidebar: Category, Brand, Condition, Price, Ships from, Fits my garage. Below desktop width: today's sheet, same fields | P0 | Change |
| M-4 | Four / three / two cards across | P0 | Exists |
| M-5 | Card: photo + bookmark · title · price · condition and grade · fitment · one line of description · seller photo, name, "N for sale" · "Off my {car}" → build · add-to-cart. No rating, no car thumbnail, no Buy now | P0 | Change |
| M-6 | Brand on listings: prefilled from the mod or importer, matched from titles otherwise, backfilled, editable. Saved searches and their alerts understand it | P1 | New |
| M-7 | Optional "miles on this part" for used parts | P1 | New |
| M-8 | Item page, cart, guest checkout, Q&A unchanged — with two named item-page exceptions: brand and miles join the record block (M-6, M-7) and "Posts about this part" (W-4). The item-page redesign is its own session. **Offers are no longer unchanged** (2026-10-17): they move to negotiation v2, §4.9 O-1…O-6 | P0 | Exists |
| M-9 | (2026-11-07, Neil's ruling R-directcontact) **Message seller** on an item page: a signed-in buyer can ask the seller about a part for sale; it lands in their conversation, where the seller replies. New contacts are limited in the database, and a block between two members stops it (and every other contact), except messages about an order they share. Direct messages from a profile stay a non-goal, and agents never message people (AG-4) | P0 | New |

### 4.5 Profile and Store

| ID | Requirement | P | State |
|---|---|---|---|
| P-1 | Header: banner (main car's cover if public, else another public car's cover, else a plain header — no new setup step), avatar, name, bio, location, links; followers · following · cars. No About block | P1 | Change |
| P-2 | Visitor actions: Follow (compact) · **Store** · share. No Message | P0 | New |
| P-3 | Tabs: Overview · Garage · Updates · Parts · Reviews; owner also sees Saved. No Builds tab, no activity log | P0 | Change |
| P-4 | Overview: main car · latest three updates · parts for sale | P1 | New |
| P-5 | Main car: drives featured car, default banner, car order everywhere (main first, then newest), Garage focus, and the first suggestion in the Marketplace vehicle picker | P1 | New |
| P-6 | Parts tab = the store: the marketplace grid and card for this seller; All / Active / Sold; owner gets status badges and edit links. Allowed statuses are decided on the server from who is viewing (public: active + sold), never from the URL; seller and status filter before counting and paging | P0 | Change |
| P-7 | Trust strip: rating · sold · member since | P1 | Change |
| P-8 | Store note: one short line pinned above the grid | P1 | New |
| P-9 | Seller default: offer floor as a % of price. The floor itself is private (O-3) | P2 | New |

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
| A-1 | Removing or replacing a saved mod asks inline: "What happens to the old part?" → List it · Just remove it. **Replace** is its own action: the old row keeps its id and is marked removed; the replacement is a new row. Editing in place is for typos. "Delete — added by mistake" remains, but is not offered on a row with a linked listing | P0 | New |
| A-2 | Removal is a state, not a delete. "Came off this car" on the public build and in the Garage | P0 | New |
| A-3 | Composer: sell link on "replaced" as well as "removed"; seeded blocks carry the mod id; publishing offers to mark the part removed | P0 | Change |
| A-4 | "List it" saves the sheet first, then opens the sell form prefilled from the mod and car. Abandoning leaves the part under "Came off this car". If the row already has a linked listing (including a draft), List it opens that listing | P0 | Exists |

**B — A listing reaches the people following you**

| ID | Requirement | P | State |
|---|---|---|---|
| B-1 | Following includes new listings from sellers and cars you follow; a listing appears once however it is followed; order is stable across pages; at most three in a row from one seller | P0 | New |
| B-2 | Feed only; no push or email for new listings | — | Decision |

**C — Buy a part, add it to your car**

| ID | Requirement | P | State |
|---|---|---|---|
| C-1 | Delivered or completed order, per item → "Add to a car in your garage", built from the order item's frozen purchase record (not the live listing), once only; the mod line shows "Bought on DRVN · off {car}" when the source build is public | P1 | New |

### 4.8 Posting

| ID | Requirement | P | State |
|---|---|---|---|
| W-1 | Quick post: pick a car → 1–6 photos → caption → Post. No title. **A quick post never touches a saved full-editor draft** (release-blocking). "Write a full update →" saves the content as the draft when none exists; when one exists the link is "Continue your draft" and nothing is merged | P1 | New |
| W-2 | Every new post needs a photo — quick or full. Drafts are exempt. Posts published before the rule keep their pages and list placements, are left off the photo walls (Explore, Home), and can be edited without adding a photo | P1 | Change |
| W-3 | Tag a part: a picker over your active listings (current car's first, type to filter); up to three per post; available in the quick box and as a "Part for sale" block in the editor. (2026-11-07) Pasting your own listing link was dropped by Neil's ruling on 7 Nov 2026; the picker stays | P1 | New |
| W-4 | Tagged parts render as a compact row under the photos with price and add-to-cart; "Sold" when sold; the listing page gains "Posts about this part" | P1 | New |
| W-5 | Posting with no car: tag a part instead. A post must have a car, a tagged part, or both. Not available before this ships — W-1…W-4 require a car | P2 | New |

### 4.9 Intelligence — the DRVN agent (added 2026-10-17)

Every member can have an agent that does the tedious work around buying, selling and keeping a build up to date, inside limits the member sets. To the member there is **one** agent; "seller" and "buyer" are internal scopes. Its first job is negotiating offers. Underneath, DRVN keeps a growing record of cars, generations, products and fitment so the agent can answer harder questions over time. The rollout order, the safety gates and the reasoning are in the implementation plan linked at the top.

**Negotiation v2 — for everyone, agent or not**

| ID | Requirement | P | State |
|---|---|---|---|
| O-1 | Buyers can counter back (eBay's model): up to 3 buyer offers per listing, counter-backs included, counted across every thread a buyer opens on that listing; strict turns; a seller counter never exceeds the asking price; each turn replaces the last; 72-hour expiry per turn | P0 | Change |
| O-2 | An offer below the seller's minimum is recorded as a declined round and uses one of the buyer's 3 offers; the refusal never reveals the number | P0 | New |
| O-3 | The seller's minimum is private — unreadable through the database API, not just hidden on the page. Showing it on the listing is an opt-in toggle, off by default; minimums shown today become hidden when the toggle ships | P0 | Change |
| O-4 | Every move, human or agent, is one atomic, retry-safe database step. Each issued round keeps a snapshot of its terms (amount, expiry, who sent it, the limits in force); accepting an outstanding round honours that snapshot even if limits or price changed later | P0 | New |
| O-5 | A seller may cancel an accepted offer only before checkout begins; after that, the normal order and refund rules apply | P0 | Change |
| O-6 | Offers stay unavailable on DRVN Shipping listings, which are priced at checkout | — | Exists |

**The agent**

| ID | Requirement | P | State |
|---|---|---|---|
| AG-1 | One agent per member covering selling, buying and the Garage | P0 | New |
| AG-2 | Seller — "Let DRVN handle offers": a minimum, a target (default: asking price) and a style (Firm · Balanced · Flexible). The listing keeps one minimum (O-3); the agent's can only be stricter, never lower. Turning it on, the seller confirms once per listing that the agent's counters are binding. The agent counters inside the limits and recommends accepting, with a reason; it does not auto-accept at launch | P0 | New |
| AG-3 | Buyer — "Negotiate for me": a ceiling stated as item price or item + shipping, plus a style. The agent accepts a seller counter within the ceiling on its own. Payment is always made by the member | P0 | New |
| AG-4 | Agents never message other people. An offer an agent sent carries a quiet "via agent" in the offer history, and the accept screen and checkout summary say when an agent set the price | P0 | New |
| AG-5 | Prices are set by rules from the owner's limits, never by the AI model; the model understands requests and writes words | P0 | New |
| AG-6 | Approving the agent's limits authorises its counters within them without asking each time. Every other change the agent makes shows a confirm card first; drafts never publish themselves | P0 | New |
| AG-7 | Agent home: Needs you · Working · Done, plus settings (Off · Suggest · Act within my limits). Notifications open the specific task | P0 | New |
| AG-8 | Chat with the agent, for getting things done on DRVN — not open-ended conversation. Mobile: the Agent tab opens `/agent` full screen. Desktop: an Agent item in the rail opens a non-modal side panel that stays open while browsing. One design, two containers | P1 | New |
| AG-9 | Garage jobs through the agent, one at a time: update my build (from words, a link or a photo; the replaced part is marked removed and listing it is offered) → post an update → list the parts that came off → paste your build → listing from photos | P1 | New |
| AG-10 | A small "Agent" action on listings, offers, cars and mod rows opens the agent with that object as context | P1 | New |
| AG-11 | Every task works without the agent. AI-assist features arrive one at a time, each also available as a plain button | P0 | Decision |
| AG-12 | Admin can pause all agent negotiation, one side, one agent or limit set, or one listing or account, without touching existing offers and orders | P0 | New |

Rollout: seller negotiation → buyer negotiation → chat with one Garage job → more jobs. Each step turns on for everyone behind a beta flag once the previous step's checks pass. No invited cohort.

## 5. Data changes

| Object | Change |
|---|---|
| `mod_items` | + `status` (installed / removed), `removed_at`, `source_order_item_id` (unique), `product_url`, `image_url`, `source_domain`, `ref_price_cents` + `ref_price_currency`; `save_mod_items` re-created once to carry them |
| `listings` | + `brand`, `part_miles`, `part_miles_unit`; `save_listing_creation` and the listing search text updated; new index `(seller_id, status, created_at desc)` |
| `profiles` | + `main_car_id`, `store_note`; later `default_offer_floor_pct`, `country`, `region`. Each needs explicit column grants |
| `activity_posts` | `title` nullable; publish requires a photo; a `quick` write mode that never reads or alters drafts; new `listing` block + mirror table `activity_post_listings`. Later: `car_id` nullable with a "car or tagged part" rule |
| `feed_events` view | Later: append `owner_id` so Local can filter by region |
| Saved searches | `brand` added to `SAVED_SEARCH_KEYS` |
| New RPCs | `suggested_builders`, `trending_models`, `seller_active_counts`, `marketplace_brand_counts`, `local_feed_rows` |
| `listing_private_terms` (2026-10-17) | New, owner-only: the seller's real minimum. Moved out of `listings` in three steps (add and dual-write → switch every reader → drop `listings.offer_floor_cents`); `listings` gains a public opt-in display value |
| Offers (2026-10-17) | New `offer_rounds` with a snapshot per round; one transition function owns every move, acceptance included, with one lock order (listing → negotiation → order → payment) |
| Agent (2026-10-17) | New `agent_mandates`, `agent_tasks`, `agent_events`, `agent_conversations`, `agent_approvals`, `agent_jobs`; a dedicated database role for the agent worker. Every agent table is covered by data export, account deletion and a retention rule |
| Car and part record (2026-10-17) | New `vehicle_generations`, `products` with brand-aware identifier membership, `product_fitments` with source and configuration constraints; `mod_items` part keys |

Not needed: tables for shops, personas, home modules, away mode, car facts, notes, maintenance or part-history chains.

## 6. Measures

- **Is it one product?** Share of listings with a source car · share of removed mods that become listings · share of purchases added to a car · listing views arriving from a car, profile or post.
- **Do people come back?** Members active in a week without buying · posts per active car per month · share of mods added by link · share of posts that tag a part.
- **Does the second door work?** Guest checkouts completed · store visits from the profile's Store button.
- **Does the agent help?** (2026-10-17) Paid, completed sales from agent-handled listings vs comparable manual listings — not offer counts · offers handled with no action from the seller · accepted deals that complete payment · seller cancellation rate · time to first useful agent task · repeat use · incorrect-action rate · cost per completed task.

## 7. Parked — and what would bring each back

| Idea | Bring it back when |
|---|---|
| Modular / personalised Home | Real usage shows two clearly different patterns and the fixed Home fails one |
| Onboarding by intent | Scheduled as its own session |
| Away mode | Sellers ask, or late-dispatch complaints appear |
| Dispatch-time statistic | Orders record paid and shipped times reliably |
| Buy now on cards | Cart-to-checkout drop-off suggests it |
| Agent auto-accept of offers | The beta shows a low seller cancellation rate |
| "Find one that fits my car" watches | There's enough inventory for them to find things |
| Agent dashboard (full page) | Needs you regularly holds more than three things |
| Outside agents (MCP / API) | The agent's capabilities are stable and there are users |
| Admin and analytics agents | The member agent's runtime is proven |
| Maintenance, notes, records | Members ask unprompted |
| Shop entity, catalogue sync, stock, product ratings | Real shops ask to list more than one of something |
| Part history across cars · whole-car sales | Purchases are regularly added to cars · the parts marketplace is healthy |
