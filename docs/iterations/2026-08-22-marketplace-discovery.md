# Marketplace + Discovery UX remediation — 22 Aug 2026

Baseline: `main` @ `c93c434` ("feat(ui): apply garage and card patterns across
product surfaces"). Brief: clearer product hierarchy across Home / Explore /
Marketplace, Home Discovery segmentation, one listing-card system, quick
commerce on Marketplace cards, Explore icon discoverability, "My Listings",
a contained Marketplace local nav, category navigation separated from
filtering, progressive-disclosure filtering, consistent vehicle typography,
provenance preserved throughout.

## Audit against main (before changes)

| Issue | On main | Status | Change |
|---|---|---|---|
| Hierarchy | Task heads compacted; categories, sort, refine and family nav all in `.fbtn`/mono-caps | Partial | Each register gets its own treatment (below) |
| Home Discovery segmentation | One mixed `FeedList`, page-one only; Explore had its own `TABS` literal | Unresolved | Shared `FEED_TABS`, `?discover=` segments with per-segment empty states |
| Home recs vs Marketplace cards | `ListingCard` (`.mkt`) vs `ListingMosaicCell` (`.mcell`) — two anatomies; recs had no source car / seller | Partial | One card (`MosaicCell`), `hydrateListingCards` everywhere |
| Buy now / Add to cart on cards | PDP only; cards were `<a>` wrapping engagement `<button>`s | Unresolved | `<article>` cell + `ListingQuickCommerce` |
| Explore icon discoverability | aria-label + native `title` | Partial | `data-tip` tooltip on hover and focus |
| "My Listings" | "Listings" in the register | Unresolved | Renamed in the register, docs, e2e, one copy string |
| Marketplace local nav | Hairline strip, dim caps | Partial | Recessed plate, raised current member |
| Category nav vs filters | Real routes; entry point was a chip carousel styled like filters | Partial | Tile grid (≥640) / Browse sheet (compact) / sibling row at the leaf |
| Progressive disclosure | `FinderRefineSheet` on compact; desktop inline | Partial | Kept; labelled "Refine" register, Browse joins the compact toolbar, one sort control per width |
| Vehicle typography | `[year, make, model].join(" ")` ×8; `.mcell__sub` uppercase-transformed | Unresolved | `vehicleLabel()` + `.vref` |
| Provenance | Sub line on the wall only; no path to the build | Partial | "Off a <car> →" on every card, links to the public build |

## USP Motorsports (uspmotorsports.com) — what was taken, what wasn't

Observed: 21 top-level categories at `/catalog`, three-level `/category/l1/l2/l3`
URLs; category landings show child-category tiles with counts above the grid,
and the leaf drops the tiles; a year→make→model→trim→engine stepper with
"Browse Unfiltered" escape hatches and a persistent header garage; sidebar
facets as accordions (price slider, brand list, category tree) that become a
full-height drawer on mobile; no active-filter chips or breadcrumb.

Adapted: the tile-descent (category tiles → subcategory tiles → sibling row at
the leaf) on DRVN's existing routes; one responsive markup with the compact
toolbar carrying Browse · Refine · Sort. Not adapted: the vehicle stepper (the
buyer's garage is already on file — fit stays one checkbox and is always
labelled seller-stated), brand/year facets the query doesn't support, and the
colour-coded fitment badges (DRVN says "Fits your <car>" only on a match and
leads with provenance instead).

## What changed

**Shared** — `src/lib/feed.ts` (`FEED_TABS`, `visibleFeedTabs`, `resolveFeedTab`;
part items carry `sourceCarName`/`sourceCarSlug`); `src/lib/vehicles/label.ts`
(`vehicleLabel`, `platformLabel`, `provenanceLine`); `globals.css` gains an
unlayered remediation register: `.vref`, `[data-tip]`, `.mcell__link/__prov/
__trust/__actions`, `.mosaic--commerce`, `.qcom`, the `.familynav` plate,
`.catnav/.catgrid/.cattile/.catlist/.catrow`.

**Cards** — `MosaicCell` is an `<article role=listitem>` holding one `.mcell__link`
(eyebrow · photo · caption), then a provenance link, seller trust (wide cells),
a context-owned `actions` slot and the engagement strip. `ListingCard` now
renders `ListingMosaicCell`; Home, PDP rails, Saved and the auth backdrop use
`<Mosaic>`. `hydrateListingCards` returns `source_car_name`, `source_car_slug`
(public builds only), `seller_id`, `status_flag`; `recommendListings` hydrates
through it. No interactive element nests inside another anywhere on the wall.

**Commerce** — `src/features/commerce/quick-commerce.tsx`: Buy now (`.btn--live`)
+ Add to cart (ghost, icon-only under 300px of cell width, `data-tip`), calling
the existing `buyNow` / `addToCart` actions; toast + "In cart ✓" + `router.refresh()`
for the badge; inline `role=alert` on error. Rendered by Marketplace results
only, and only for active listings the viewer doesn't own ("Your listing" otherwise).

**Home** — Discovery section always renders on page one with All · Builds ·
Updates · Parts (`?discover=`; unknown → All; "Parts" = active listings, so no
"For sale" twin), at least four rows, a named empty state per segment, "More on
Explore →" carrying the segment. Followed feed and `?page=` pagination unchanged.

**Explore** — reads the shared tabs; engagement actions show their name on hover
(fine pointers only) and on `:focus-visible`; native `title` removed.

**Navigation** — `MARKETPLACE_FAMILY` label "My Listings" (rail, index, family
nav all read it); `/listings` route, RPCs and tables untouched. `.familynav` is a
recessed `--paper-deep` plate; the current member sits on `--tile` with the live
tick; compact widths keep the scroll + edge fades.

**Marketplace** — `category-nav.tsx` (tiles ≥640px; subcategory tiles on a
category page; sibling `filters--sub` row at the leaf) and `category-sheet.tsx`
("Browse" in the compact toolbar → BottomSheet of all categories with the
current one unfolded). Tiles hide while a text search is active. `FilterBar`
gains the `browse` slot, a "Refine" label on the desktop row and an "Apply
refinements" submit inside the compact sheet. Results pass `viewerId`.

**Typography** — `vehicleLabel()` replaces the join in vehicle-card, garage-sheet,
saved, landing, cars/[slug], profile-data, feed, query; `.vref` on the mosaic
sub line, vehicle cards and garage sheets (no transform, casing preserved).

## Validation

- `npm run typecheck`, `npm run lint`: pass. `npx vitest run`: 125/125 (10 new:
  `lib/vehicles/label.test.ts`, `lib/feed-tabs.test.ts`, nav label).
- Headless probes (guest): first card top 429px @390×844, 533px @320×568,
  402px @430×932; 0 nested interactives on /marketplace and /explore; no
  horizontal overflow 320→1920; sub-tiles one column; `.vref` transform none.
- Signed-in (viz-check): /home Discovery segments ×4 on one row; /marketplace,
  /listings, /orders family plate; /saved on the shared card.
- Playwright: `e2e/discovery-remediation.spec.ts` (new) + marketplace-family,
  mobile-layout, mobile-matrix, a11y, feature-regression, mobile-remediation —
  results in the changelog entry.

## Follow-up pass (same day, user feedback)

- **Home** — Discovery is no longer boxed in a tile: heading, segment row, then the plain ruled rows, as before.
- **Cards** — the provenance line is the bare car name ("2022 Porsche 911 GT3 →"), no "Off a" prefix.
- **Quick commerce re-sized** against Mobbin references (Faire / Walmart "+ Add" pills, Temu's square cart, Shopee's compact Buy Now): 34px filled Buy now sized to its word + square ghost cart, 40px on touch, no bracket glyphs; `.mosaic--commerce` unit reduced to match.
- **Garage sheets** — Earned dimension and the ledger stamp removed (four dims; labels wrap instead of clipping); the fold is a toggle at every width (open ≥641px, closed on phones until tapped; viewport read via `useSyncExternalStore`, stylesheet draws the default) with the tool rail always visible; Manage is the live fill, siblings ghost (ink-on-tile vanished on the night theme); rail brackets drop under 1180px and the rail wraps instead of overflowing; Latest/Next/empty copy capped at 34–44ch; `PlateSwiper` — the cover plate is a scroll-snapped track of the car's photos with pips + "1/2" as the only indicator; `loadGarageSheets` returns `photoUrls` (cover first).
