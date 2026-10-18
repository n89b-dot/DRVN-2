# Marketplace reference evidence

Research date: September 8, 2026. Companion to the [marketplace review](</Users/neilbarrow/Desktop/Cursor Projects/DRVN 2/docs/marketplace-review-2026-09-08.md>).

These are structural observations from real reference images, not an approved replacement design system. Existing tokens and rules remain documented in [the design system](</Users/neilbarrow/Desktop/Cursor Projects/DRVN 2/docs/site/design-system.md>). Mobbin MCP was unavailable; the references were inspected in Mobbin through the browser. Pixel dimensions not reliably measured are deliberately omitted. Proposed DRVN dimensions in the report are design targets, not reference measurements.

## P1 — Narrowed marketplace results (web)

Source: Etsy via Mobbin, web, inspected September 8, 2026. Shows category navigation and applied filters together during an active search.

Reference screen ID: [976ba7bb-7226-429e-bfba-7c05389b24c4](https://mobbin.com/screens/976ba7bb-7226-429e-bfba-7c05389b24c4).

What we lift: persistent category context, a separate refinement area, applied-state feedback, consistent product comparison.

| Property | Observed value | Notes |
|---|---|---|
| Source capture | Desktop, 1512 × 945 | Reported by Mobbin |
| Product columns | 4 | At the captured desktop size |
| Category placement | Left sidebar | Nested hierarchy; active leaf visible |
| Main vertical order | Search/header → breadcrumbs → filter/sort controls → products | Search remains populated |
| Applied state | Removable pills above products | Separate from the category tree |
| Sort | One control at the right of the controls row | Most relevant in the captured screen |
| Card content | Image → title → seller/rating → price → delivery note where present → actions | Compare equivalent information across columns |

Where it lands: marketplace category/search layout, category navigation, applied filters, listing cards.

Deliberate divergences proposed September 8, 2026: retain DRVN’s global navigation and theme; add selected-vehicle context and source-build evidence; do not copy Etsy’s gifting, discounts, or seller badges without matching product support. The first structural implementation is recorded in P4; a complete redesign has not been approved.

## P2 — Category and filter organization (web)

Source: Faire via Mobbin, web, inspected September 8, 2026. Supporting reference for browse/filter organization; this screen lists brands rather than individual parts.

Reference screen ID: [1c42b65b-fd0c-458a-9422-999d830d8984](https://mobbin.com/screens/1c42b65b-fd0c-458a-9422-999d830d8984).

What we lift: a stable filter location, visible applied-filter feedback, repeated image-led entries, one sort control.

| Property | Observed value | Notes |
|---|---|---|
| Grid columns | 5 | At the captured desktop size |
| Navigation | Search and All categories in the header; category links below | Separate from result-specific filtering |
| Refinements | Left column | Location and other groups |
| Applied feedback | “2 filters applied” and Clear all | Visible in the left column |
| Sort position | Upper right of results | One control |
| Entry content | Image, save heart, name, rating/minimum information | Wholesale-specific content |

Where it lands: desktop marketplace refinement layout and search-state feedback.

Deliberate divergences proposed September 8, 2026: do not copy wholesale minimums or the five-column density automatically; use product price, condition, delivery, and seller data. DRVN’s existing global rail reduces available grid width.

## P3 — Continue shopping after viewing a listing (web)

Source: Depop via Mobbin, web, inspected September 8, 2026. A product-detail continuation, not evidence for a results filter layout.

Reference screen ID: [44040af3-fb92-4c39-9010-b1fc161d8900](https://mobbin.com/screens/44040af3-fb92-4c39-9010-b1fc161d8900).

What we lift: distinguish seller-related inventory from alternative recommendations.

| Property | Observed value | Notes |
|---|---|---|
| Section order | More from this seller → You might also like | Different recommendation reasons |
| First seller row | 6 image/price entries | At the captured desktop size |
| Alternative row | 6 columns | Same comparison rhythm |
| Section continuation | See more, aligned right | Each section has its own continuation |
| Persistent header | Search, category links, account/commerce actions | Shopping remains accessible |

Where it lands: listing-detail related inventory; optionally a build-based collection at the marketplace entrance when supported by stock.

Deliberate divergences proposed September 8, 2026: explain “More from this build/seller” separately from compatibility-based alternatives. Keep essential condition and fitment evidence visible; do not adopt image-and-price-only density for technical parts.

## P4 — First browsing implementation, September 12, 2026

Scope: R09a with the minimum retrieval, classification and navigation repairs. Uses P1's persistent category context and applied-state feedback, and P2's stable refinement location and single sort control. P3 remains later detail-page work. The values below are the as-built DRVN specification, not reference measurements.

| Property | Implemented value | Purpose |
|---|---|---|
| Vertical order | Category breadcrumb → title → search/refinement toolbar → applied chips → optional Save search → category navigation → count/range → listings | Make location, controls and inventory distinct |
| Page family | One shared server composition for entrance, parent and leaf | Prevent behavior drifting between routes |
| Header spacing | 16px top; 20px bottom on desktop, 16px on mobile | Reduce the distance to inventory |
| Breadcrumb | Existing 12px/16px micro type token; wraps; semantic ordered navigation | Retain hierarchy on narrow screens |
| Refinement position | Existing Finder sheet at every width; Apply commits, Cancel discards | Reuse the established Marketplace/Explore idiom |
| Mobile toolbar | Below 640px: full-row search, then Filters / Categories / Sort; filter button minimum 40px height | Keep browse access visible without a tile wall |
| Category presentation | Existing tiles for unfiltered entrance/parent; compact native disclosure for filtered/leaf desktop results; sheet on mobile | Preserve browsing without pushing results down |
| Desktop category tree | Auto-fit columns, 180px minimum; 16px row / 24px column gaps; 36px minimum link height | Expose parent, child and sibling destinations |
| Category type and borders | Existing 16px body token and theme-aware rule-mid token | Match DRVN's established visual system |
| Results header | Existing 20px/28px section token, weight 600; count left, range right; wraps | Give a truthful inventory summary |
| Mobile content spacing | 16px below Finder; 32px deck bottom | Remove the previous dead space |
| Error presentation | Registered EmptyState and Button; no count; diagnostic reference; Retry reloads current URL | Distinguish failed retrieval from an empty search |

Deliberate differences from the references: the first slice uses a compact category disclosure instead of Etsy's full left sidebar, retains DRVN's global rail/theme and existing cards, and keeps refinements in the existing sheet instead of adding a second desktop interaction model. These are recorded scope choices for the small catalog. Exact visual copying is not claimed. Selected-vehicle explanations, card comparison hierarchy and related inventory still require their own implementation work.

Component governance: Finder's optional cancellation callback is recorded in the component registry and demonstrated by an interactive Apply/Cancel specimen on `/docs/components`. The generated inventory is current. Existing Button, EmptyState, PageHead, Pagination and BottomSheet recipes are reused, and the recipe baseline decreased.

Fidelity check: inspected populated 320px, 390px, 768px and 1440px captures; all four browser checks passed after the final token correction. Search and category access remain visible without horizontal page overflow, and the mobile first listing starts above 600px. Actual shared inventory was inspected in dark mode as well. Card prices/shipping remain crowded in this retained card implementation; R09b owns that correction. This is structural verification of the first slice, not approval of the full visual redesign.

See [implementation evidence and captures](</Users/neilbarrow/Desktop/Cursor Projects/DRVN 2/docs/remediation-evidence/marketplace-2026-09-12/README.md>).

State audit: separate empty and failed results were also inspected at 320px and 390px. Both fit the viewport; only a successful empty request shows zero. Retry recovered the populated search and retained its budget and category in both sizes. At 320px the native sort control wraps below Filters/Categories to preserve readable labels and touch targets.

## P5 — Complete shopping journey (September 13, 2026)

Source: the recorded P1/P2 Etsy/Faire results references and P3 Depop continuation reference, combined with DRVN's revised R04–R12 contract. This is a deliberate DRVN adaptation; no additional reference dimensions are claimed.

| Property | Implementation target | Reason |
|---|---|---|
| Shopping card order | Image → full title → item price → separate delivery line → condition/location → part number → compatibility evidence → seller → source build → Save | Comparable facts without clipped price or social/checkout noise |
| Grid | 1 column below 480px, 2 below 900px, 3 below 1280px, 4 above; 16px gaps | Minimum readable card width |
| Card image | 4:3 frame, object-contain, consistent fallback | Show the whole technical part |
| Card body | 16px padding, 8px gaps; 16px/24px title, 20px/28px price, 12px/16px supporting text | Existing type scale, readable facts |
| Card actions | Main content opens detail; separate Save button with 40px minimum height | Valid independent targets; social actions retained on detail |
| Vehicle control | Below search: explicit catalog vehicle, optional vehicle year; signed-in garage choices; Change/Clear | No private garage IDs in URLs; source-year refinements remain separate |
| Filter sheet | Existing Finder; Apply, Cancel and Reset draft; seller-location label; item-price sort label | Shared behavior with Explore; no decorative unsupported controls |
| Saved searches | Versioned normalized state; save from any category/search; page resets; explicit alert opt-in | Same criteria on reopen and alert destination |
| Detail return | Visible Back to results preserving normalized local URL; same context carried through sign-in and source build | Complete shopping loop |
| Compatibility | Seller-stated match / source-model similarity / year needed / outside stated years / unknown | No verified-fit promise; unknown is not a mismatch |
| Sparse inventory | Available categories first, full tree remains accessible; distinct live related parts only | No empty promotional sections or fabricated popularity |

Deliberate divergences: retain the existing DRVN feed card variant on Home/Explore. Use the new shopping variant only for marketplace comparison and related shopping rails. New technical facets, managed synonyms, and curated collections remain conditional on real supported data as specified in the revised plan; any retirement or deferral must be explicit in the final coverage record.

P5 audit reconciliation: the seller block deliberately aligns toward the card bottom, with 16px minimum separation from evidence (8px gap + 8px padding). Shopping images use their own responsive size hint; keyboard focus draws inward so card clipping does not hide it. Missing delivery evidence says “Delivery details not provided”; known rated shipping says it is calculated at checkout, and pickup-only listings say so explicitly.


P5 final interface verification: the complete shopping variant was inspected with actual shared inventory in dark mode and controlled populated/error/empty fixtures at 320, 390, 768 and 1440px. Light/dark axe scans found no WCAG A/AA violations in the tested main content. Every computed text size and line-height in the 320px main content was doubled, including pixel-based tokens; long titles and filter values wrap and the remove control remains visible. This is an explicit text-resizing simulation, not a claim of full browser/assistive-technology conformance. Reduced motion and dialog focus return were exercised. The old P4 card crowding is resolved in the shopping variant. The catalog now has fifteen classified active parts and one parent-level roof box, so populated leaf destinations are useful without promotional filler. See the [September 13 acceptance record](remediation-evidence/marketplace-2026-09-13/README.md) and captures.
