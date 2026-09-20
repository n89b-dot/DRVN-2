# DRVN marketplace review

**Research and assessment • September 8, 2026 (revised the same day after verification)**
**Purpose:** decide what to change on the marketplace page, why, and in what order. This is a review and implementation brief. No application or database changes were made.

A published, easier-to-read version of this document exists as a Claude artifact (link in the session that produced it). This file is the canonical text.

---

## 1. The short version

DRVN's marketplace has the right raw ingredients: real category URLs, a shared taxonomy, a listing card that carries price, condition, shipping, seller and the build the part came off, a strong listing detail page, saved searches and buyer protection. What it does not yet have is the *shape* of a marketplace. A shopper cannot see how much is for sale, cannot tell what car they are shopping for, loses the category navigation the moment they type a search, and on a phone lands on an almost blank screen.

Three problems, in the order they must be fixed:

1. **The marketplace cannot load its inventory in this environment, and hides the failure.** The page calls a database function that does not exist in the connected project. The query swallows the error and the page says "Nothing listed right now." The database actually holds 16 active listings. This has been true since September 5, when the query was switched to the new function but its migration was only applied locally.
2. **The category system is not backed by the listing data.** 15 of 16 listings have no subcategory, so every subcategory page ("Coilovers & Springs", "Big Brake Kits"…) will stay empty even after the query is fixed. One listing uses a category value that no longer exists in the navigation.
3. **The page does not separate browsing, narrowing, and comparing.** Categories vanish when you filter. Sibling-category chips look like filters and drop your filters when clicked. There is no result count. The only vehicle control is a checkbox. On mobile the hero collapses into ~250px of empty space above the search box.

**Recommended direction:** keep DRVN's identity and its "see the car it came off" proposition, but rebuild the page around three durable things every reference marketplace has: **a persistent category tree, a visible "shopping for" vehicle context, and a results header that tells the truth (count, scope, applied filters, one sort).** Do the data and query repair first; a redesign over broken retrieval will still feel broken.

---

## 2. What was reviewed and how certain the findings are

### Directly inspected today

| Source | What was done |
|---|---|
| Running app at `localhost:3005` | Marketplace entrance, Filters dialog, a subcategory page with `?max=500`, a category page with a search query, a listing detail page. Desktop pane width and 375×812 mobile emulation. |
| Source code | Every marketplace route, the category nav and sheet, the filter bar, active filters, sort select, results, the query layer, fitment helpers, the listing card, quick commerce, and the relevant CSS recipes. A second agent independently re-verified each claim in this document against current source with file and line references (appendix). |
| Database (read-only, public key) | Count and grouping of active listings by category, subcategory, condition, shipping mode, part number and source car. A direct call to the marketplace function to confirm the error. |
| Dev server log | Confirms the same function error on every marketplace request. |
| USP Motorsports | Public HTML of the homepage, Suspension and Coilovers pages, including the embedded page state (category records, product hits, facet definitions). |
| eBay Motors | Public storefront page text; eBay iOS "My Garage" and parts-filter flows via Mobbin. |
| Etsy | Category page in the browser; Etsy web results and iOS filter sheet via Mobbin. |
| Mobbin (MCP) | Seven searches across web and iOS: marketplace homes, results grids with filters, filter sheets, category browsing, vehicle selectors, second-hand listing cards, eBay flows. Reference IDs are listed in the appendix. |

### Boundaries

- The **populated results grid was still never seen running**, because the query fails. Card findings come from source and from the "Similar in this category" rail on the listing detail page, which uses the same card.
- The browser pane could not paint several third-party pages while hidden, so eBay and USP structure comes from page text and HTML rather than screenshots. Mobbin captures cover the visual side.
- Database numbers describe the environment this checkout is configured for, not production.
- USP findings describe the frontend and the data it ships to the browser, not USP's private backend.

---

## 3. What is already working well

| Strength | Why it matters | Keep |
|---|---|---|
| **Provenance.** Every listing links to the build it came off; the detail page shows the car, and the card carries the source-car line. | No competitor offers this. It is DRVN's reason to exist. | Make it visible on every card and keep the build link on the detail page. |
| **Real category and subcategory URLs**, one taxonomy file driving nav, sell form and routes. | Shareable, indexable, consistent buyer/seller vocabulary. | Extend the taxonomy; do not fork it. |
| **Listing detail page** is genuinely good: price + shipping + total, condition, location, seller, seller-stated fitment with an honest "not verified by DRVN" label, public Q&A, buyer protection, "Came off this car", similar listings. | This is where the purchase decision happens, and it already answers the right questions. | Protect it. Make the results page live up to it. |
| **Applied-filter chips with Clear all**, URL-driven state, pagination. | Buyers can understand, share and revisit a search. | Keep. Add the count next to them. |
| **Mobile hygiene in CSS**: 44px minimum on filter buttons, 16px search input to stop iOS zoom, container-query grid (4 → 3 → 2 columns). | The foundations for a good phone experience exist. | Keep. Fix the layout around them (section 4J). |
| **Fitment honesty.** Cards say "Fits your garage"; detail says "Seller-stated, not verified by DRVN." | Trust is the whole game for used parts. | Keep the honesty; fix the wording inconsistency (4F). |
| **Selling is separate from buying.** No seller controls in the grid. | The marketplace stays a shop, not a dashboard. | Keep. Add one quiet "List a part" entry. |

---

## 4. What is wrong, and what should change

Each item: what is wrong → why it matters → what to change → priority.

### A. Inventory retrieval is broken and the failure is disguised as an empty shop — **Immediate**

**What is wrong.** `src/lib/marketplace/query.ts` calls the database function `marketplace_filtered_rows(...)`. The connected project returns `PGRST202: function not found in schema cache` on every marketplace request. The query catches the error and returns an empty page, so the UI says "Nothing listed right now" while 16 active listings exist.

**Why it happened.** Commit `8608345` (September 5) switched the query to the function. The migration that creates it, `supabase/migrations/20260905133456_uncapped_marketplace_filters.sql`, is part of the September 5 remediation set, which `supabase/MIGRATIONS.md` records as applied only to a local stack, not the shared project.

**What to change.**
- Apply the migration (or the coordinated September 5 set per `docs/remediation-rollout.md`) to the environment this app points at. This is a deploy decision, not a code fix.
- Separate three states in the UI: loaded, genuinely empty, and failed. A failed query must say "We couldn't load parts. Try again" with a retry that keeps the buyer's search. Never render a failure as an empty catalog.
- Delete the dead `searchTruncated` branch in results (it is hard-coded false and its copy can never render).

### B. Most listings cannot appear under any subcategory — **Immediate**

**What is wrong.** Database snapshot today:

| Category | Active listings |
|---|---:|
| Performance | 5 |
| Wheels & Tires | 3 |
| Brakes & Suspension | 3 |
| Interior & Lighting | 2 |
| Exterior & Body | 2 |
| Legacy value `interior` (no route) | 1 |
| **Total** | **16** |

Subcategory: 15 null, 1 `intake`. Part number: 1 of 16. Condition: all "used". Shipping: all "flat". Source car: 16 of 16.

Subcategory pages do an exact match, so "Coilovers & Springs" will be empty even though a KW Variant 2 coilover listing exists under Brakes & Suspension. The sell form validates the category but accepts subcategory as any nullable string.

**What to change.**
- Classify the 16 listings by hand now (an hour's work) and require a subcategory for new listings where the category has children.
- Map the legacy `interior` value to a current slug and add a guard so unknown category values surface in admin instead of disappearing.
- Show unclassified items at the parent level with an honest "Other" bucket, never hidden.

### C. The category labels describe DRVN's grouping, not what a buyer is looking for — **High**

"Performance" is a purpose, "Engine" is a system; performance brakes live under Brakes & Suspension, not Performance. Transmission sits inside Engine. Headlights sit inside Interior & Lighting. USP, eBay and every reference use *part/system* categories (Brakes, Suspension, Exhaust, Air Intake, Lighting…). USP's tree is 11 top-level, 42 second-level categories, and every product also belongs to its ancestors and can be cross-listed (a coilover kit appears under Coilovers *and* Suspension *and* Lowering Springs in its category keys).

**What to change.** Adopt a part/system tree (section 6). Treat "Performance" as a collection, not a category. Store categories as a set (primary + ancestors + optional cross-listing) so a part can be found in every reasonable aisle without being duplicated.

### D. Browsing disappears the moment a buyer starts narrowing — **High**

**What is wrong (verified in source).** The entrance and parent pages hide the category tiles whenever `q`, `condition`, `min`, `max`, `fit` or `location` is set (`marketplace/page.tsx:35-42, 93`). The tiles are also `hidden` below 640px, and the "Browse" sheet that replaces them is `sm:hidden`, so **on desktop with any filter applied there is no category navigation at all.** On the coilovers page with `?max=500`, the sibling chips under "Narrow it down" link to bare URLs and drop the price filter (`category-nav.tsx:46-60`).

**Why it matters.** Every reference keeps the tree visible while filtering (Etsy, Klarna, Selfridges, Amazon, lululemon, Faire — all left-rail; eBay/adidas — filter drawer with a category row). Narrowing *within* a category is the core marketplace loop.

**What to change.** A persistent category tree (left column ≥ 1024px, collapsible "Categories" control below). Sibling and parent links carry the current vehicle, condition, budget, location and sort, and reset the page number. Separate the visual language: a category is a *place* (link, breadcrumb, tree), a filter is a *condition* (checkbox, chip with ×).

### E. Results never say how many, what scope, or why — **High**

**What is wrong.** The query returns `total`; `results.tsx:66-68` deliberately doesn't render it. There is no heading on category pages (the hero is retired, leaving blank space where the title should be). The breadcrumb renders at the *bottom* of the page in the footer. On category/subcategory pages the empty copy is a fixed "No coilovers & springs listed right now" even when the emptiness is caused by the buyer's own filters (the entrance does distinguish "No parts match 'kw'" — the category routes do not).

**What to change.** One results header, on every marketplace route: breadcrumb → H1 (category or "Results for 'KW'") → **count** → vehicle context → applied chips → sort. Distinct empty states: no parts in this category / no parts match these filters / couldn't load. Show "Price: low to high" as words, not arrows.

### F. Vehicle context is a checkbox — **High**

**What is wrong.** The only vehicle control is "Potential matches for your garage", shown to signed-in users only (`filter-bar.tsx:109-120`). The query already supports `vehicle=<makeId>-<modelId>`, `ymin`, `ymax`, but no UI exposes them. The active chip says "Fits your garage" because no route passes the car label. Matching can fall back to same make+model of the *source* car without checking generation or engine.

**Why it matters.** USP opens with "CHOOSE YOUR VEHICLE: 1 year · 2 make · 3 model · 4 trim · 5 engine" and remembers it in "Your Garage". eBay opens Motors with "My Garage — find parts that fit your vehicle" and then shows a selected-vehicle strip ("2026 Honda CR-V… Change") with a "Fits your vehicle" line on each card. This is the defining pattern of an auto-parts marketplace.

**What to change.** A "Shopping for" strip under the search: guests pick make/model/year (session), signed-in buyers pick one garage car; visible everywhere with Change/Clear. Four honest states on cards: **Seller says it fits** · **Came off the same model** · **Universal** · **Fit not established**. Never promote same-model provenance to a fit guarantee.

### G. The entrance reads like an app directory, not a shop — **High (after data repair)**

**What is wrong.** Desktop sequence: promo headline, two lines of copy, search, seven small tiles (hint text truncates: "Everything listed ri…", "Exhaust & Downpipes …"), then results. The darkest, most prominent tile is "All parts". No count, no vehicle, no imagery, no "new this week". Filters open as a centered modal with four fields (condition, location, min, max) and two confusingly similar buttons ("Apply filters" and "Done").

**What to change.** Compact title → one-line proposition → big search ("Search parts, brands or part numbers") → Shopping-for strip → 6 category tiles with real part imagery and full labels + "All categories" as a text link → "New this week" (with count) → one provenance feature ("Parts off this build"). Filters become inline (desktop) or a labelled sheet (mobile) with one primary button that shows the count: "Show 12 parts".

### H. Cards carry the right facts but compete with themselves — **Medium–High**

**What is rendered (verified):** photo, title, price + shipping, condition · fit · location, provenance line (plain text, not a link), seller + rating, Buy now / Add to cart, then like/comment/share/save. **Not rendered:** part number (loaded, never shown), trust badge (prop exists, never passed), source-car *link* (slug is hydrated, unused).

**What to change.** Results-grid anatomy, in this order: image → title → price (+ ship) → condition + fit state → seller → "Off a 2007 Audi RS4" as a link. Save as the only secondary action on the card; comments and share move to detail. Test whether Buy now belongs on a grid of used, fitment-sensitive parts (Vinted, Depop, eBay, Grailed all make the detail page the decision surface; only grocery/retail grids use "Add"). Show part number when present. Remove the social strip from the marketplace grid (keep it on Explore).

### I. Save search stops at the entrance — **Medium**

`SaveSearchButton` is only rendered on `/marketplace` (`page.tsx:76-87`); category and subcategory routes never import it. A buyer watching for coilovers cannot save that. Offer it beside the results count on every route, saving category path + vehicle + refinements.

### J. Mobile: the foundations are there, the layout isn't — **High**

Verified at 375×812 today:

| Finding | Detail |
|---|---|
| **Dead space** | The hero is retired on compact, leaving roughly 250px of blank grid between the header and the search field on the entrance and on category pages. |
| **No categories** | Tiles are hidden; the only route into categories is the "Browse" button, which reads like a secondary action. Nothing on screen suggests categories exist. |
| **Toolbar** | Search + icon-only filter button + Browse on one row, then Sort alone on the next row. Sort is the least important control and gets the most room. |
| **Breadcrumb at the bottom** | "Marketplace / Brakes & Suspension" renders in the footer, below the empty state. Breadcrumb belongs above the results. |
| **Chips** | "Filtered by" chips are fine; the × target is 32px (below the 44px target used elsewhere). Sort select is ~40px tall. |
| **Grid** | Container queries give two columns under 600px with an 8px gap — good — but the card meta (condition · fit · location · seller · provenance) will be five lines on a 170px card. Needs a mobile density variant. |
| **Filter sheet** | The sheet works at all widths, but there is no result count on the primary button and "Done" vs "Apply" is ambiguous. Every reference (eBay, Etsy, Vestiaire, Vivino, UNIQLO, adidas) uses one button: "Show 17 results". |

**What to change.** Mobile order: compact title → search (full row) → Shopping-for strip → a single toolbar of three labelled buttons: **Categories · Filters (n) · Sort** → applied chips → count → grid. Breadcrumb at the top. One "Show N parts" button in the sheet. Bump chip × and sort to 44px.

---

## 5. What the references teach

### USP Motorsports (target catalog structure)

Public source, September 8:

- **Tree:** 11 top-level categories: Air Intake, Brakes, Cleaning & Car Care, Clutch & Flywheel, Engine, Exhaust, Exterior & Body, Interior, Lighting, Suspension, Wheels & Tires. 42 second-level (e.g. Suspension → Air Suspension, Coilovers, Control Arms & Ball Joints, Lowering Springs, Shocks & Struts, Subframe, Sway Bars, Under Bracing). Every menu entry shows its count ("Coilovers (2,857)").
- **Vehicle first:** homepage hero is "CHOOSE YOUR VEHICLE — 1 year · 2 make · 3 model · 4 trim · 5 engine", with "Your Garage / Add a Vehicle" in the header and three entry modes: Shop by Brand · Shop by Product · Browse Unfiltered.
- **Product record shipped to the browser:** `brand`, `partNumber`, `partNumberVariations` (normalized variants for search), `isOEMProduct`, `isOemFitment`, `isUniversal`, `isFitmentEmpty`, `labels` (sale), `inStock`, `leadTime`, `thumbnail`.
- **Facets on the Coilovers page:** `brand` with counts (KW 1,099 · BC Racing 496 · ST 268 …), `finalPrice`, `isUniversal`, `labels.title` (sale), `isFitmentEmpty`, and `categories.urlKey` — a *set* per product (`usp-coilovers`, `usp-suspension`, also `usp-lowering-springs` for cross-listed kits).
- **Page order on a leaf:** banner → breadcrumb → H1 "Coilovers" → filters (vehicle, brand, price) + count + sort → grid → "New Arrivals".

**Bring to DRVN:** the tree shape and naming, category counts, brand as a real field, part-number variants for search, multi-category membership, and vehicle-first entry. **Leave behind:** the promotional banner stack and the retail stock/lead-time vocabulary.

### eBay Motors (vehicle context and trust)

Page order: "My Garage — Find parts that fit your vehicle" → Shop by category (10) → "Worry-free shopping: Easy and Free Returns · eBay Guaranteed Fit · Money Back Guarantee" → popular categories → guides. iOS flow (Mobbin): pick vehicle → selected-vehicle strip with **Change** → cards carry "Fits your vehicle" → Filters sheet shows "302 results" in its header and "Show results" as its only button, with a **Universal Fitment: Yes / No** facet.

**Bring to DRVN:** the strip, the per-card fit line, the buyer-protection row on the entrance (DRVN already has the policy), and the universal-fitment facet. **Don't copy:** the "Guaranteed Fit" promise; DRVN's data is seller-stated.

### Etsy (entrance vs. results)

Category page (browser, today): title → one-line description → six image tiles for subcategories → "All filters" + sort → grid. Results (Mobbin web): breadcrumb, left tree, chips, sort, 4 columns, cards = image · title · seller · rating · price · shipping badge. iOS filter sheet: grouped sections, one "Show results" button.

**Bring to DRVN:** the category page template (title, sentence, image tiles, filters, grid) is almost exactly the DRVN parent-category page that should exist.

### Mobbin pattern synthesis

Across 100+ screens reviewed, the conventions that never vary:

| Convention | Seen on |
|---|---|
| Result count next to the heading or in the filter button | Klarna, Selfridges, adidas, lululemon, Walmart, Amazon, eBay, Etsy, Vestiaire, Vivino |
| Category tree visible while filtering (left rail on web, sheet row on mobile) | Etsy, Amazon, Klarna, Selfridges, Faire, Instacart, HubSpot, Unity |
| Filters in a drawer/sheet with **one** primary button that carries the count | eBay, Etsy, adidas, Vestiaire, Vivino, UNIQLO, Best Buy, Fiverr |
| Applied filters as removable chips above the grid | Klarna, Faire, adidas, Crypto.com, eBay |
| Home = search → category tiles with imagery → one merchandised rail | Faire, Etsy, Vestiaire, Whatnot, Instacart, Crate & Barrel |
| Second-hand cards: image · brand/title · size or spec · condition · price (+ protection incl.) · heart | Vinted, Depop, Grailed, eBay, alias |
| Vehicle selection as a first-class step, then a persistent strip | eBay, USP, Walmart Auto Care, Turo |

The counter-example worth noting: OpenSea, Reddit Collectibles and Cosmos put imagery first and metadata last. That works for art, not for a used intake manifold where condition and fit decide the sale.

---

## 6. Proposed category organization

Separate five concepts and stop mixing them in one list:

| Concept | Example | Lives in |
|---|---|---|
| Category | Suspension & Steering | Tree |
| Part type | Coilovers | Child of a category |
| Attribute / filter | KW · used · under $1,000 · local pickup | Filter panel |
| Vehicle | 2007 Audi RS4 (B7) 4.2 FSI | Shopping-for strip |
| Collection | Track-day prep · New this week | Curated rails |

### Candidate tree (USP-derived, DRVN-sized)

| Category | Part types | Change from today |
|---|---|---|
| Wheels & Tires | Wheels · Tires · Spacers & adapters · Bolts & hardware · TPMS | Keep |
| Brakes | Big brake kits · Calipers · Pads · Rotors · Lines | Split from Suspension |
| Suspension & Steering | Coilovers · Lowering springs · Shocks & struts · Sway bars · Control arms · Bracing · Air suspension | Split from Brakes |
| Exhaust | Systems · Downpipes · Headers & manifolds · Tips | Out of "Performance" |
| Air Intake & Forced Induction | Intake kits · Filters · Turbos & superchargers · Intercoolers & charge pipes · Throttle bodies | Out of "Performance" |
| Engine & Cooling | Internals · Ignition · Fueling · Mounts · Catch cans · Radiators & pumps · Service parts | Absorbs Engine |
| Drivetrain & Transmission | Clutch & flywheel · Transmission · Differential · Axles & driveshafts | Out of Engine |
| Exterior & Body | Bumpers · Hoods & fenders · Aero & diffusers · Spoilers · Mirrors & trim | Keep |
| Interior | Seats & harnesses · Steering wheels · Gauges · Trim | Lighting removed |
| Lighting & Electronics | Headlights · Taillights · ECUs & tuning hardware · Sensors | New home for lighting |
| Tools & Accessories | Add only when inventory warrants | Optional |

"Performance" becomes a collection that spans categories. With 16 listings, the entrance shows the 4–6 populated families with counts and an "All categories" link; the full tree lives in the Categories control.

### Migration requirements

Old-slug → new-slug map with redirects; where one old category splits (Brakes & Suspension), redirect to the parent and show both children. Update sell/edit forms, importer validation, the build-to-listing mapping (`src/lib/mods/category-map.ts`), condition checklists, saved searches, category counts and the search index together. Store `category_path` (primary + ancestors) on each listing so a coilover kit is found under Suspension *and* Coilovers with one row.

---

## 7. How the redesigned pages should work

Dimensions are DRVN design targets, not measurements copied from references.

### Entrance (`/marketplace`)

```
Marketplace                                        [Saved] [Cart] [List a part]
Used parts off real builds. Every listing links to the car it came off.

[ Search parts, brands or part numbers ..................... ] [Search]
Shopping for:  ( Add your car ▾ )   or   2007 Audi RS4 · Change · Clear

Browse                                             All categories →
[Suspension 4] [Wheels & Tires 3] [Exhaust 2] [Intake 2] [Body 2] [Interior 2]
   (photo)        (photo)          (photo)     (photo)    (photo)   (photo)

New this week · 16 parts                                 Newest ▾
[card] [card] [card] [card]
...
Off this build → 1992 Lancia Delta HF Integrale · 3 parts listed
Buyer protection · 30-day claims · Seller-stated fitment, always confirm
```

### Category, subcategory and search results (one template)

Desktop ≥ 1024px: 232px left column (category tree with counts, then filters: condition, price, delivery, location, brand, universal fit) + grid (3–4 columns). Header above grid: breadcrumb → H1 → count → shopping-for → chips → sort. Parent pages add a row of part-type tiles under the header. Leaf pages show siblings *in the tree*, not as chips.

Below 1024px: header → **Categories · Filters (2) · Sort** toolbar → chips → grid (2 columns under 600px with a compact card variant: image, title, price, condition + fit on one line, seller).

### Filters sheet / panel

Sections: Condition · Price · Delivery (ships / local pickup) · Location · Brand · Fits (seller-stated / universal). Draft state until "Show N parts" is pressed; Cancel restores. Reset clears filters, never the category or vehicle.

### Cards

Image (4:3 fixed frame, no crop of identifying features) → title (16px, 2 lines) → price 18–20px + "+ $10 ship" → condition chip + fit state → seller · rating → "Off a 2007 Audi RS4 →". Heart top-right. No Buy now on grid by default (test separately). Part number in a small mono line when present.

### Listing detail

Already right. Add: a "back to results" that restores the search, a part-number line near the title, and keep "Similar in this category" separate from "More from this build".

---

## 8. UX and UI evaluation, section by section

*UI is what people see; UX is what they can accomplish.*

| Section | Today | Better UI | Better UX | Check |
|---|---|---|---|---|
| **Global nav + intro** | Marketplace sits inside the app shell; large intro copy outranks shopping controls; on mobile the intro collapses to empty space | Compact title, one-line proposition, search as the dominant element, Cart/Saved/List a part in fixed positions | A first-time visitor knows what is sold, how to find it, and where saved/purchases live in one glance | New visitor finds a part, saved items and how to sell without touching the global menu |
| **Search** | "Search…" placeholder; scope invisible; sort defaults newest so relevance is by date | "Search parts, brands or part numbers"; visible Search button; scope shown on category pages ("in Suspension · search all parts") | Enter and button behave the same; query survives navigation; part numbers match exactly (USP's `partNumberVariations` idea) | Test a part number, a brand + type, a broad term, a misspelling |
| **Vehicle context** | Checkbox behind Filters, signed-in only, labelled "Potential matches" then "Fits" | A strip under search: car, Change, Clear; four fit labels on cards | Guests can pick a car; owners pick one garage car; switching cars explains what changed | Switch between two cars in one category and explain the result |
| **Categories** | Small tiles, truncated hints, hidden on filter and on mobile; siblings as filter chips at the bottom-page breadcrumb | Image tiles with counts on the entrance; tree in the left column; breadcrumb at top | Move down, sideways and up without losing filters | Ask where coilovers, headlights, a clutch and an intercooler live; sellers and buyers should agree |
| **Filters** | Centered modal, 4 fields, Apply + Done | Inline panel on desktop, sheet on mobile, grouped, one "Show N parts" button | Draft vs applied; Cancel restores; Reset keeps category and car | Set a budget, cancel, change sort — the budget must not apply |
| **Results header** | None: no title, no count, breadcrumb in footer | Breadcrumb · H1 · count · car · chips · one sort | Every control has a predictable effect; Back/refresh restore the same state | After any change the buyer can say what they are looking at and undo it |
| **Grid + cards** | Right facts, too many actions, provenance not a link, part number hidden | One anatomy, image-first, price second, fit third; Save only | Compare three similar parts by condition, shipping and fit without opening them | Compare three listings in under a minute |
| **Rails** | None | "New this week", "Off this build" | Each rail answers one question; hide rails inventory can't support | Ask what each rail adds beyond the grid |
| **Detail + purchase** | Strong | Add back-to-results, part number | Same item, price, fit story from grid to detail to cart | Trace grid → detail → cart → back |
| **Saved** | Save search only on entrance | Save search next to the count everywhere; Save item on card | Sign-in returns to the same task | Save from a leaf page, leave, return |
| **States** | Failure renders as empty; category empty copy ignores filters | Distinct loading/empty/no-match/failed states | Retry keeps the search; zero matches offers "broaden" | Deliberately fail the query, empty a category, over-filter |
| **Mobile** | ~250px dead space, no category access, sort on its own row, chips 32px | Title → search → car → Categories/Filters/Sort toolbar | Same task on a phone, fewer taps | 320, 375, 390, 768, 1440; keyboard; dark theme |

---

## 9. What implementation requires

| Workstream | Concrete work | Why |
|---|---|---|
| Restore retrieval | Apply the migration; add failed-state UI + retry; remove dead branch | Nothing else is testable until this lands |
| Catalog cleanup | Classify 16 listings; map `interior`; require subcategory; add `category_path` | Children pages need matching rows |
| Shared URL state | One helper that builds every marketplace href from current params (vehicle, condition, price, location, sort) and resets page | Buyers stop rebuilding their search |
| Results header + count | New `ResultsHeader` commerce component (breadcrumb, H1, count, chips, sort) reused by 3 routes | The single biggest perceived change |
| Category tree | `CategoryTree` (desktop column) + existing `CategorySheet` (mobile), both fed by taxonomy + counts RPC | Browsing survives filtering |
| Vehicle strip | `ShoppingFor` commerce component; guest selection in a cookie; expose `vehicle`/`ymin`/`ymax` already supported by the query | The auto-parts pattern |
| Filter panel | Inline `FilterPanel` (desktop) sharing fields with the sheet; "Show N parts" button (count from the query) | Draft/applied clarity |
| Cards | Marketplace variant of `ListingMosaicCell`: provenance as link, part number, fit state, no social strip, Save only | Comparison over engagement |
| Taxonomy migration | New tree, redirects, form + importer validation, category-map update | Buyers find parts where they expect them |
| Search quality | Part-number normalization, brand field, aliases | Automotive shopping starts from a part or brand |
| QA | Seeded fixtures with known categories/fitment; route-state tests; 320–1440 responsive; the acceptance list below | Prevent another appearance-only pass |

**Component-system note.** All of the above compose from existing primitives (`FilterPopover`, `SuggestingSearchField`, `Mosaic`, `Pagination`, `EmptyState`, `Alert`, `PageHead`) plus three new registered commerce components (`ResultsHeader`, `CategoryTree`, `ShoppingFor`). No raw recipe markup in routes; the ratchet test should not move.

---

## 10. Priority, effort and decisions

### Phase 1 — Make it truthful (est. 3–5 engineering days)

Apply migration · failed/empty/no-match states · classify listings · result count + H1 + top breadcrumb on every route · siblings and parents keep filters · category nav survives filtering (desktop) · fix mobile dead space and Browse visibility.

**Exit:** a known listing is reachable via All parts, its parent, its subcategory, and search; a failed query shows a failure; changing category keeps budget and car.

### Phase 2 — Make it a marketplace (est. 2–3 design days + 6–9 engineering days)

New taxonomy + redirects · `ResultsHeader` / `CategoryTree` / `ShoppingFor` · inline filter panel + "Show N parts" sheet · marketplace card variant · Save search on all routes · entrance with image tiles, counts, "New this week", one provenance rail · mobile toolbar.

**Exit:** find → narrow → compare → inspect → return without losing context or seeing a misleading fit claim, on desktop and phone.

### Phase 3 — Make it grow (est. 5–10 engineering days as needed)

Brand and spec facets with counts · part-number variants · relevance ranking · collections · compatible alternatives · saved-search alerts.

Add 2–4 QA days across phases. Ranges assume one engineer with design support and reuse of the existing commerce and component system.

### Decisions needed before building

| Decision | Recommendation |
|---|---|
| Apply the September 5 remediation migrations to this environment, or only the marketplace one? | Follow the rollout doc; at minimum apply `20260905133456`. |
| Category tree | Adopt the part/system tree in section 6; "Performance" becomes a collection. |
| Vehicle promise | Seller-stated + same-model + universal + not-established. No "guaranteed fit". |
| Buy now on the grid | Off by default; detail page is the decision surface. Revisit with data. |
| Social strip on marketplace cards | Remove from marketplace; keep on Explore. |
| Marketplace vs Explore filter UI | Unify on the Explore `.filterrow` + `FilterPopover` idiom for desktop; the sheet stays for mobile. |
| Visual identity | Keep DRVN's paper/ink/mono system; make shopping information louder than texture. |

---

## 11. Acceptance checks

1. Browse a parent and a child category; counts and listings agree, including migrated rows.
2. Set budget and car, change category, sort, open a listing, go Back. State intact and understandable.
3. Search by title, brand and part number, including punctuation variants.
4. Distinguish zero matches, empty category, out-of-range page and a database failure.
5. Save a search from the entrance and a leaf; reopening restores category, car and refinements.
6. Shop as a guest, as an owner with two garage cars, and as the seller of a listing.
7. Fit labels never turn same-model provenance into verified compatibility.
8. Open/apply/cancel/reset filters on mobile and by keyboard; no hidden draft filters apply.
9. Read long titles, shipping, condition and seller at 320px; inspect missing-photo state.
10. Grid → detail → cart/offer → back; sold-while-viewing state handled.

Measure: query failures, zero-result searches, category → listing clicks, detail → cart/offer, search abandonment, saved-search use.

---

## Appendix: evidence

### Reproducible today

- Active listings: **16** (public key, `status = active`).
- Marketplace function call: **PGRST202 / 404**. Dev log: `[marketplace] listing query failed … marketplace_filtered_rows … not found in the schema cache` on every `/marketplace` request.
- Function introduced in `query.ts` by commit `8608345` (2026-09-05); migration `20260905133456_uncapped_marketplace_filters.sql` recorded as local-only in `supabase/MIGRATIONS.md`.
- Data completeness: **15/16 no subcategory · 15/16 no part number · 1 legacy category · 16/16 used · 16/16 flat shipping · 16/16 source car**.
- Inspected URLs: `/marketplace`, `/marketplace/brakes-suspension/coilovers?max=500` (sibling chips drop `max`), `/marketplace/brakes-suspension?q=kw` (mobile), `/listings/106e584e-…` (detail renders correctly; "Similar in this category" rail shows four cards).

### Source verification (current code)

| Claim | Status | Where |
|---|---|---|
| Tiles hidden on any filter; Browse only < 640px | True | `marketplace/page.tsx:35-42, 93` · `category-nav.tsx:65, 105` · `filter-bar.tsx:62` |
| Sibling chips drop filters | True | `category-nav.tsx:46-60` · `[subcategory]/page.tsx:76` |
| Count returned, not rendered | True | `query.ts:44` · `results.tsx:66-68` |
| Failure rendered as empty | True | `query.ts:286-289` |
| Entrance distinguishes "no match" vs "nothing listed"; category routes don't | Corrected | `page.tsx:102-111` vs `[category]/page.tsx:83`, `[subcategory]/page.tsx:85-86` |
| Dead `searchTruncated` branch | True | `query.ts:217` · `results.tsx:58, 65` |
| Vehicle = checkbox only; query supports vehicle/ymin/ymax | True | `filter-bar.tsx:109-120` · `query.ts:19-38, 242-246` |
| Chip always says "Fits your garage" (label never passed) | True | `active-filters.tsx:50-55` |
| Save search only on entrance | True | `page.tsx:76-87` |
| Card: part number, trust, source link not rendered | True | `mosaic.tsx:475-540` · `query.ts:184, 247` |
| Sort: Newest / Price ↑ / Price ↓; page size 24 | True | `sort-select.tsx:27-29` · `query.ts:49, 190` |
| Grid: container queries 4/3/2 columns | True | `globals.css:2843-2872` |
| Touch targets: `.fbtn` 44px; chip × 32px; sort ~40px | True | `globals.css:4565-4576, 4555, 5206-5220` |
| Marketplace search bypasses the search provider seam | True | `query.ts` calls the RPC directly; `provider.ts` used only by suggest/saved-search jobs |

### Mobbin references (MCP, September 8)

Web: Etsy results `9704f9f5-5ca8-48cd-b584-0acf3b90e467`, Etsy category `d77777f0-40d7-4b7b-8ab7-69978f505777`, Klarna `2ff7fdaf-9702-4d37-9d3a-72eb63cf463c`, Selfridges `a22d22a5-0901-4a64-b5e4-ec3bf6fc2eb4`, adidas `1992b625-5178-453a-be2f-58e25ac7158f`, Faire home `c15617c3-a6be-4a79-8581-bd4e2f08604d`, Faire results `03cba7e2-ef4b-4f12-9845-f2d41de68584`, lululemon `9a95b71d-5d31-4896-bc48-1077bbb6d919`, Amazon `a4935a0f-869e-4fca-8b92-05c1d964e898`, Walmart `a7a2368e-6a09-4139-9513-ece40ec3bbb4`, Turo vehicles `7cdecb9f-3b3b-47e2-a45c-0440692a0f96`.
iOS: eBay filter `7b1996af-78d8-439d-a338-661cdddcef5d`, eBay flows `7b9e6241-c194-4af2-8ac0-936ae0ff5ae9` (parts & accessories) and `6f74f2a2-9388-42ab-ab72-8490caf16b25` (vehicles), Etsy filter `bac1e89c-3421-4570-bf01-d9de9de03b32`, Etsy home `00f3aa0f-d4cf-4568-98ed-228a8bc64e97`, Vestiaire `55c9157b-52fd-498d-a771-3aa428bb6dba` / `0fd540ce-5a78-4d39-9132-dfd7df484a4d`, Vinted `4828e059-6470-4fe1-b2c9-dfbf081dc4a8`, Depop `b961507b-6ad8-4193-82bf-f993ecec09aa`, Whatnot `a7ef6570-e562-4182-b62a-16506b4d20ff`, Vivino `0fae75cc-f2e2-4a60-81f0-5ecacb1d2947`, UNIQLO `8206376c-0896-4476-a228-e5d592905b4d`.
URL form: `https://mobbin.com/screens/<id>` or `https://mobbin.com/flows/<id>`.

### External pages

- USP: `https://www.uspmotorsports.com/`, `/category/suspension`, `/category/suspension/coilovers`
- eBay Motors: `https://www.ebay.com/b/Auto-Parts-and-Vehicles/6000/bn_1865334`
- Etsy: `https://www.etsy.com/c/craft-supplies-and-tools`

### Principal code locations

| Area | Files |
|---|---|
| Routes | `src/app/(discover)/marketplace/page.tsx`, `[category]/page.tsx`, `[category]/[subcategory]/page.tsx` |
| Navigation and filters | `category-nav.tsx`, `category-sheet.tsx`, `filter-bar.tsx`, `active-filters.tsx`, `sort-select.tsx` |
| Query and taxonomy | `src/lib/marketplace/query.ts`, `taxonomy.ts`, `fitment.ts`, `grading.ts` |
| Results and saved search | `src/features/marketplace/results.tsx`, `save-search-button.tsx` |
| Cards and commerce | `src/components/ui/mosaic.tsx`, `src/components/commerce/listing-card.tsx`, `src/features/commerce/quick-commerce.tsx` |
| Listing data quality | `src/app/(product)/sell/actions.ts`, `src/lib/mods/category-map.ts` |
| Migration | `supabase/migrations/20260905133456_uncapped_marketplace_filters.sql`, `supabase/MIGRATIONS.md`, `docs/remediation-rollout.md` |
