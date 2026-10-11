# DRVN marketplace remediation plan

**September 8, 2026 • Revised September 12, 2026 • Implementation in progress**

Based on the [marketplace review, including the holistic UI/UX assessment][review] and [recorded design references][design]. The first retrieval/layout slice is implemented: both focused database repairs are applied to the shared project, and the interface changes are available locally. See the [implementation evidence][implementation] for tests, deployment history and remaining work. The wider plan remains open.

The September 12 revision incorporates the [review of the implementation comments][comments]. Read **R04's state-transition table first**: it is the contract for every shopping control. R01–R16 describe the full remediation map; the delivery slices below determine the sequence. The first visible improvements do not wait for the complete taxonomy, advanced filters, or search-ranking work.

## 1. Intended outcome

A buyer should be able to enter DRVN, choose a vehicle or browse freely, find the right category, narrow the available parts, compare listings, inspect condition and compatibility, and continue to a purchase or offer without losing context.

The solution is a coordinated repair of **inventory retrieval, listing classification, shopping behavior, and page design**. Each visible control must be supported by real data and a consistent interaction rule.

I would preserve DRVN’s existing commerce foundations, visual identity, and source-build provenance. I would build a compact marketplace entrance and a shared category/search results layout, backed by one catalog definition and one search-state model.

### Recommended product defaults

These provide a concrete starting point for design and implementation; they are recommendations rather than previously approved product decisions.

| Area | Proposed default |
|---|---|
| Categories | Organize by part/system; use Performance as a curated collection |
| Visible entrance | Feature populated categories; keep the full catalog accessible |
| Vehicle selection | Optional for browsing, available to guests, explicit selection for multi-car garages |
| Compatibility | Show the evidence behind a potential match; no inferred fit guarantee |
| Results cards | Open listing and Save are the main interactions; keep Buy now/cart and social actions on detail for the first marketplace release |
| Search | Exact part identification first; relevance for keyword searches once implemented; Newest for unsearched browsing |
| Filters | Reuse the existing Marketplace/Explore finder and refinement sheet; repair Apply/Cancel and share state rules before adding another desktop pattern |
| Price sorting | Item price initially, labeled clearly; delivery costs shown separately until comparable totals are available |
| Notifications | Saving is separate from opting into alerts |

## 2. Delivery sequence and dependencies

| Delivery slice | Work packages | Visible result and completion boundary |
|---|---|---|
| 1. Restore and make browsing legible | R01; minimal R02/R03; R04 for touched links; R08/R09a/R10; focused R14–R16 | Inventory/error states, result count, top breadcrumb, persistent category access, and compact mobile spacing |
| 2. Make the existing journey consistent | Remaining core R03–R12, including R09b; R14–R16 throughout | Existing filters, supported vehicle selection, cards, saved searches, and commerce handoff behave consistently |
| 3. Expand when evidence supports it | Advanced R03/R06/R07, full R08 layout exploration, R13, expanded R15 analysis | Rich specifications/facets, richer ranking, merchandising, and funnel analysis justified by inventory or observed shopper needs |

The Stage A–F headings below group related work; they are not sequential gates. Design and verification accompany each slice. Slice 1 uses valid existing category slugs plus supported legacy mappings. A full catalog expansion is not its prerequisite. Work that changes navigation must implement the relevant R04 transitions immediately; preserving broken links is not an acceptable shortcut.

**First implementation slice:** confirm and repair the database dependency chain, inspect the restored populated page, then deliver R09a with targeted desktop/mobile checks. Allow a few engineering days after environment diagnosis if the migration rehearsal succeeds. Broader policy or commerce failures can extend this; do not promise an exact release date before that check.

**Four proposed decisions:** use detail for Buy now/cart; move marketplace social controls to detail while preserving other feed variants; unify on the existing finder/sheet primitives with shared behavior; deploy the verified dependency chain, not every September 5 migration solely because it shares a date. These are implementation recommendations, not a claim of prior product approval. Existing card tests must change deliberately with the chosen marketplace behavior.

## 3. Stage A — Restore inventory and classification

### R01 — Repair retrieval and distinguish failure from empty inventory

**Problem:** the reviewed environment returned an API schema-cache error for `marketplace_filtered_rows`, while a direct public count found active listings. The application displayed the failure as an empty catalog.

**How I would solve it:**

1. Confirm the app’s target environment, current function signature, migration history, API exposure, and permissions. Repeat the marketplace request using the same arguments as the app.
2. If the function is absent, deploy the required reviewed migration and its dependencies in the correct order. If the signature differs, reconcile the application and database deliberately. If the correct function exists but is not exposed, correct exposure/cache handling and verify it. Do not assume a cache refresh fixes an absent function.
3. Keep existing row visibility protections. Do not make the function privileged or use an administrator client to hide a public-client failure.
4. Change the query result into explicit success and failure outcomes. Successful results include items, total, page, and pagination information. A failure includes a safe user message and diagnostic reference, without inventing a zero count.
5. Render matching loading, results, empty, and error presentations. Retry repeats the current search and preserves its URL.

**Verified dependency detail (September 12):** `20260905133456_uncapped_marketplace_filters.sql` calls `marketplace_search_rows`, defined in `20260905124039_worker_privacy_hardening.sql`. That earlier migration also introduces restrictive suspension-related visibility policies on cars/listings and depends on earlier schema/functions. Reconcile the complete migration ledger and rehearse it in an isolated environment. These are two directly implicated files, not proof that applying exactly two files is sufficient. Verify anonymous, signed-in, owner, private-build, and suspended-seller cases, including other car/listing surfaces affected by the policies. Expected counts follow legitimate visibility rules rather than a hard-coded target of 16.

Public read-only probes on September 12 still returned 16 active listings from a direct count, but both named functions returned HTTP 404 / PGRST202 through the API. This confirms API unavailability; it does not distinguish an absent definition from exposure/cache problems. No category-count RPC or consumer was found in this checkout; obtain its exact name and migration before including it as a verified dependency.

**Why:** buyers need an honest answer before any visual improvement can matter. The same separation also makes future failures observable.

**Completion evidence:** guest and signed-in requests load known visible inventory; an intentionally failed request displays Retry rather than “Nothing listed”; logs identify the failed operation without exposing credentials. Recheck every marketplace route and **Explore's Parts results**, which call the same `fetchListings` function. Check saved-search alert matching and notification destinations separately: that worker queries listings directly and uses the older search-provider path, so its failure cannot be inferred from this missing RPC. Its administrative reads need explicit checks that alerts respect shopper-visible inventory. Use isolated fixtures and captured notifications for worker verification.

**Primary locations:** [query][query], [results][results], [function migration][rpc].

### R02 — Define the category tree and migrate legacy assignments

**Problem:** unrelated part families are combined, category names have drifted, and most reviewed listings have no part type.

**How I would solve it:**

1. Keep the current supported tree for the first slice; resolve invalid legacy assignments and document uncertain ones. Use the review's larger tree as a direction for later expansion, adding branches when actual parts require them. Write placement rules before changing ambiguous families.
2. Keep existing category/part-type **slugs as identifiers**, with editable display labels. Add an explicit old-slug → current-slug map for renames; do not introduce a parallel numeric or surrogate ID system for this repair. Retain the shared catalog definition as the authored source; derive runtime validators, navigation, and database lookup/constraint data from it rather than maintaining independent lists manually.
3. Produce a dry-run inventory worksheet containing listing ID, old assignment, proposed assignment, supporting evidence, and unresolved questions. Recount the actual inventory instead of assuming the original 16 records are still the entire set.
4. Apply only supported mappings. Preserve ambiguous records as explicitly unclassified within a valid parent where possible; keep them discoverable at parent/All parts level. Never assign an unclassified item to every child category to inflate results.
5. Use an idempotent data migration with before/after assignments and guards against overwriting intervening seller edits. Reconcile counts and record unresolved items separately.
6. Map old URLs and saved category values. Use redirects for one-to-one successors; use a useful choice page for an old category split across several new categories. Preserve compatible query parameters through those transitions.

**Why:** a category redesign succeeds only if the inventory, seller form, URLs, and search all agree on what belongs where.

**Completion evidence:** every active listing has a valid category; every populated part type has its intended listings; unresolved records remain visible and explicitly tracked; historical links resolve usefully. Parent counts count each listing once.

**Primary locations:** [taxonomy][taxonomy], [category navigation][catnav], [build-to-listing mapping][mapping], listing import and condition-checklist consumers of that taxonomy.

### R03 — Improve seller data entry and prevent classification regressions

**Problem:** repairing existing records will not last if create, edit, import, or build-release flows can continue producing inconsistent data.

**How I would solve it:**

- Validate category/part-type pairs on the server and in database integrity rules, as well as in the form. Selecting a different category clears an incompatible part type.
- Give sellers a clear part-type choice and a deliberate “Not sure” route into an unresolved state. Do not silently default to an arbitrary leaf.
- Audit and reuse existing part-number support: the original field, generated `part_number_compact`, `listing_part_numbers`, and `part_number_links`. Improve seller entry and supported brand data where necessary; do not create duplicate normalization or alias storage. Accept “Unknown” where truthful. Never invent missing identifiers.
- Collect relevant specifications by part type: for example, wheel quantity, diameter, width, bolt pattern, and offset. Define units, allowed values, requiredness, and unknown states. Do not present fields the application cannot use accurately.
- Separate condition, defects, included hardware/quantity, source build, seller-stated compatibility, and delivery choices. Reuse existing checklists where suitable.
- Run imports and build-to-listing prefill through the same validation. Suggestions should remain reviewable by the seller before publishing.

**Why:** buyer filters and comparison cards are only as trustworthy as the facts sellers provide.

**Completion evidence:** create/edit/import/build-release paths produce consistent assignments; invalid pairs are rejected; missing optional evidence is honestly represented; a supported technical field can be searched or filtered without parsing a description.

**Primary locations:** [sell validation][sell], [taxonomy][taxonomy], [build mapping][mapping], existing import validation and condition-checklist modules.

**Scope split:** category/pair integrity and consistent create/edit/import validation belong in the core release. New type-specific specification schemas and mandatory backfills can follow real inventory needs. Recheck existing fixtures when constraints are introduced; `engine` is already a valid catalog slug and needs no rename.

## 4. Stage B — Give shopping one consistent behavior

### R04 — Centralize URL state and navigation rules

**Problem:** category links drop filters, some parameters are not preserved by forms, and clearing state has inconsistent scope.

**How I would solve it:** create one parser, serializer, and link builder for marketplace state. The route owns category/part type; query parameters own the query, vehicle selection, refinements, sorting, and page. Normalize legacy query-based categories into their canonical routes and reject conflicting inputs deterministically.

The rendered controls must read this normalized state. Filter-sheet drafts remain separate until Apply. Use public catalog vehicle identifiers in shareable URLs; keep private garage-record identifiers out of shared search links. Every control uses the same transition rules:

| Action | Preserve | Change or clear |
|---|---|---|
| Submit search | Category, vehicle, applicable refinements, explicit sort | Replace query; reset page |
| Move to parent/sibling | Query, vehicle, condition, price, location/delivery, valid sort | Change category; drop only inapplicable technical attributes; reset page |
| Search all parts | Query, vehicle, broadly applicable refinements | Clear category scope and incompatible attributes; reset page |
| Change vehicle | Query, category, budget, condition, delivery | Re-evaluate vehicle-dependent attributes; explain removals; reset page |
| Apply filters | Query, category, vehicle, sort | Commit draft refinements; reset page |
| Cancel filters | Entire applied state | Discard draft edits |
| Reset in the filter sheet | Query, category, vehicle, sort | Clear draft refinements; commit only on Apply |
| Remove one applied chip | All unrelated state | Remove that refinement; reset page |
| Clear filters | Query, category, vehicle, sort | Clear all refinements; reset page |
| Change sort | Query, category, vehicle, applied refinements | Change sort; reset page |
| Change page | All shopping selections | Change only page |
| Browser Back / saved search | Recorded normalized state | Restore it without silently applying later drafts |

Give query and vehicle their own explicit clear actions. A price range is one refinement even though it uses two fields; the displayed filter count should match that meaning.

**Completion evidence:** a journey that sets a budget, visits siblings, sorts, paginates, opens a listing, and returns preserves the defined state. Malformed prices, unsupported sort values, and stale attributes do not produce misleading chips.

**Primary locations:** [filter bar][filters], [active filters][active], [category navigation][catnav], all marketplace route pages and saved-search serialization.

### R05 — Add explicit vehicle selection and evidence-based matching

**Problem:** an all-garage checkbox hides which car is being considered and uses stronger fit wording than its evidence supports.

**How I would solve it:**

1. Add a compact vehicle control near search. Guests select a catalog vehicle for the current session; signed-in shoppers can choose a garage car or another vehicle. Provide Change and Clear.
2. Represent selected-vehicle context separately from a listing’s source car. Derive the public query from catalog identity and known details.
3. Return a match explanation with each relevant result: seller-stated compatible vehicle/year range, source car with the same model, universal item, unknown, or an explicit known conflict. Unknown is not a mismatch, and same-model provenance is not verified fit.
4. Require known years to satisfy year-bounded claims; a missing year should request clarification or remain uncertain rather than becoming a positive year-specific match. Apply the same rules in the database and card/detail explanation.
5. Start with the vehicle detail the catalog actually supports. Do not show trim/engine precision unless corresponding data is available. Keep source-car year filtering separate from compatibility-year matching.

**Why:** a buyer needs to know both which car is selected and why an item is relevant.

**Completion evidence:** two selected vehicles produce explainable differences; cards and detail use the same evidence labels; guests can shop; an unknown year, universal item, private source build, and same-model/different-year case all behave honestly.

**Primary locations:** [fitment helpers][fitment], [query][query], [filter bar][filters], [cards][cards], [listing detail][detail].

**Scope split:** reuse the existing catalog picker/resolver, make the supported vehicle context visible, and correct overconfident labels now. Keep an explicitly labeled dynamic “my garage” search supported where it already exists. A comprehensive verified-fitment catalog, new trim/engine data, and a richer evidence service are later work. The existing source-car year field must stay labeled as source-car year until compatibility-year semantics are implemented.

### R06 — Build useful filters, counts, and result feedback

**Problem:** refinements are hidden, lack useful automotive attributes, and results omit the available total.

**How I would solve it:**

- Compute results, total, and facet counts from the same active/public inventory rules. A facet is simply a filter group with available choices and counts.
- Support multiple choices within a group with OR behavior, and combine different groups with AND behavior. For each group’s option counts, apply the other active groups while leaving its own selections out, so buyers can understand available additions. Explain this in the query contract and test it against known inventory.
- Start with condition, item-price range, supported delivery method, normalized brand, and relevant specifications from R03. Hide unavailable technical filters instead of showing decorative controls.
- Define location precisely. Use clearly labeled seller-location text initially if that is all the data supports. Add ZIP/radius filtering only with suitable location data and real distance calculations.
- Keep selected zero-count options removable. Unknown values remain available when no restrictive attribute filter is set; do not pretend they satisfy a precise specification.
- Render a title, truthful total, active context, one sort control, and pagination. Explain no matches separately from an empty category or request failure. Out-of-range pages offer a return to page one.

**Completion evidence:** counts match controlled fixtures across category/vehicle combinations; the filter count matches visible chips; Cancel does not affect a later sort; clearing one filter broadens results predictably; no-results recovery works.

**Primary locations:** [query][query], [results][results], [filter bar][filters], [active filters][active], mobile sheet components.

**Scope split:** display the existing truthful total and repair current single-choice condition, price, location, vehicle, applied-state, sort, and pagination behavior in the core release. Do not require dynamic option counts, multi-select groups, a new brand filter, or technical facets for 16 listings. When introduced, multiple values within one group use OR and groups combine with AND; do not expose multi-select before that behavior is implemented and tested. Result totals and optional per-choice counts are different deliverables.

### R07 — Make search identify the right parts

**Problem:** newest-first keyword results and incomplete identifiers are insufficient for specific automotive shopping.

**How I would solve it:** audit the existing normalization and alias support before extending search. Migration 0033 already supplies generated `part_number_compact` and its index; 0042 adds alternate listing identifiers and a relationship graph. The search provider already reads these structures and supports an optional Typesense path. Reuse those assets and preserve original identifiers. Check parity between the marketplace SQL path and the alert-worker provider path. Add reviewed name synonyms only when actual searches justify them.

Use a documented ranking order: exact part-number identity, strong title/brand/part-type match, then broader descriptive matches. Add stable tie-breakers and explicit price/newest overrides. Introduce Best match in the UI only when this ranking exists. Search suggestions and corrections should be visible alternatives; never silently rewrite a precise identifier.

Create a compact relevance fixture set from representative DRVN inventory, including ambiguous numbers, aliases, typo cases, and known non-matches. Assess the expected top results with a human reviewer. Start with the existing database/search implementation; consider external search infrastructure only if measured relevance, latency, or scale requires it.

**Completion evidence:** named fixture queries return the expected leading results, filters still apply, pagination is stable, and no-result suggestions broaden the search deliberately.

**Dependency:** R02–R04; brand/specification depth depends on R03.

**Scope split:** keep a few exact/raw/compact identifier, known non-match, filtering, and stable-pagination checks in the first release. Defer a broad relevance fixture program, new synonym management, and Best match ranking until justified. Low inventory reduces the need for ranking sophistication; it does not remove the need to return the right part.

## 5. Stage C — Rebuild the marketplace UI and UX

### R08 — Design the complete page family from real content

**Problem:** the entrance, results controls, and cards currently do not share a sufficiently clear shopping hierarchy.

**How I would solve it:** create connected desktop/mobile designs for the entrance, parent category, leaf/search results, filter sheet, and listing-detail handoff. Use real or controlled representative listing content—including long titles, poor photos, expensive items, sparse inventory, and unknown fitment—so the design is not approved only with ideal examples.

Use the existing [Etsy/Faire/Depop reference notes][design] as evidence for structural choices, while preserving DRVN’s design system. Record deliberate differences and approved spacing/type/image targets in the project design documentation. The deliverable should include clickable transitions and state descriptions, not just disconnected screenshots.

Design the first slice against current components immediately; the complete page-family design is not a gate for its release. Explore currently uses `SuggestingSearchField`, `FinderRefineSheet`, a vehicle field, and sort, with applied chips outside the form. It does **not** currently use a row of per-filter popovers; an unused `FilterPopover` component is available. Unify the existing finder/sheet behavior first and evaluate a desktop sidebar or popovers later if usability warrants it.

**Component-system requirements:** reuse registered primitives and their canonical styling recipes. New shared public exports must have matching entries in `src/components/registry.ts`; update the `/docs/components` specimens when a component or variant changes, and regenerate the component reference with `npm run docs:components` when the registry changes. Registry and generated-doc tests enforce consistency; the recipe-ratchet test prevents new copied raw recipe markup in feature code. Update relevant implementation documentation only when its registered claims change. The specimens are part of the review deliverable, not evidence that every visual state is automatically tested.

**Page composition to implement:**

| Surface | Proposed structure and improvement |
|---|---|
| Global shell | Clear active Marketplace state; consistent Cart, Saved, and Sell access; distinguish global navigation from catalog browsing |
| Entrance | Compact title → search → vehicle → populated category access → newest parts; add a discovery section only when inventory supports it |
| Parent category | Breadcrumb/title → search/vehicle → available child destinations → result summary and inventory |
| Leaf/search | Compact context → persistent category access → filter/results layout; omit repeated promotional hero and full category wall |
| Wide results | Category/refinement column only when the remaining grid supports readable cards; avoid competing wide navigation columns |
| Mobile results | Full search row → vehicle → labeled Categories/Filters/Sort → active state → grid or readable list |
| Help/footer | Short, reliable paths to shopping help and actual delivery/returns policies; no large promotional block interrupting results |

**Completion evidence:** four shopper scenarios from the review can be followed through the designs; every control has a defined destination/behavior; both light and dark versions use the same hierarchy. Mark remaining assumptions explicitly.

### R09 — Deliver a thin layout slice, then improve comparison cards

**R09a — First visible slice:** add a truthful results header using the existing query total; place the breadcrumb above search on category/leaf pages; keep category/child/sibling navigation available while filters are active; remove unnecessary mobile header/section spacing. Use a compact category tree/disclosure or current browse sheet rather than repeating the full tile wall above filtered results. Preserve R04 state when following those links. An error must never display “0 results.” Check actual 320px and 390px layouts with populated, empty, and failed results before calling the spacing issue fixed.

This slice does not depend on full taxonomy replacement, advanced facet counts, or a new card data model. Keep it small and independently releasable after R01 and the minimum classification/transition work.

**R09b — Shared layout and comparison cards:**

**Problem:** duplicated route composition and context-specific card actions can drift as the UI evolves.

**How I would solve it:** have marketplace routes pass normalized context into shared search, vehicle, category, refinement, result-summary, and results components. Categories remain routes; filters remain query state. Render category access in searches and at every breakpoint. Keep the current shared card data shape, extending it only for supported facts.

For marketplace cards, use image → title → price/delivery → condition/specifications → seller → source build. Preserve accurate aspect/cropping behavior; fit the entire part into its frame where identification requires it. Include meaningful part-number/specification information without making every card a specification sheet. Define a clear fallback for unknown or missing data.

Make Open listing and Save the principal grid interactions. Keep likes, questions, and sharing on the detail surface; retain social variants where appropriate elsewhere in DRVN. Any quick-buy/cart control retained after testing must respect ownership, availability, and server-side eligibility. Do not accidentally change the Home/Explore card actions through a global component edit.

Follow R08's registry, specimen, generated-documentation, and recipe requirements in both slices. Existing browser tests explicitly expect Buy now/Add to cart and social controls on marketplace cards; revise those expectations to the agreed marketplace variant while retaining commerce eligibility and other-feed regression checks.

**Completion evidence:** populated entrance, parent, leaf, and search pages render consistent data; the essential facts remain readable; Save never opens the listing; card/detail values agree; shared components do not regress other pages.

**Primary locations:** [marketplace entry][entry], [category navigation][catnav], [filter bar][filters], [results][results], [cards][cards], existing theme styles.

### R10 — Make mobile, accessibility, and interface states part of the build

**Problem:** smaller layouts and failure cases can undermine an otherwise attractive desktop design.

**How I would solve it:** implement responsive behavior by task: preserve a usable search field, readable category access, explicit filtering, and product comparison. Use two columns only where required facts fit; permit a list/single-column alternative at narrow widths. Verify the report’s proposed 44px touch targets on actual controls.

Use semantic headings/navigation, labeled form controls, distinct selected states, visible keyboard focus, accessible dialog focus handling, and result announcements. Validate color contrast, zoom, and reduced motion with suitable tooling and manual checks; do not claim conformance from appearance alone. Avoid relying on hover to expose important information.

Build the complete state set: initial loading, successful results, updating results, zero matches, empty category, unavailable listing, missing image, invalid filter input, and failed request with Retry. Loading should reserve appropriate space. During updates, avoid announcing or presenting an old result count as the answer to a new selection.

**Completion evidence:** keyboard-only journeys work; dialogs restore focus and honor Apply/Cancel; no clipped essential metadata or horizontal overflow at 320, 390, 768, and 1440px; light/dark, zoom, and reduced-motion checks have recorded results.

## 6. Stage D — Complete detail, purchase, and return journeys

### R11 — Align listing detail and commerce handoff

**Problem:** the marketplace must deliver on the identity, price, condition, and compatibility communicated before a buyer opens a listing. The earlier review did not complete a live transaction walkthrough.

**How I would solve it:** perform that walkthrough after R01, then repair confirmed gaps using the existing commerce services. Organize detail around photos and purchase summary, condition/inclusions, specifications/compatibility, seller/source build, and questions. Display defects, quantity, hardware, and modifications clearly. Source build is supporting evidence, with a reliable return path to the part and then search.

Keep item price, chosen delivery method, availability, and primary action together. Label any amounts calculated later rather than presenting an incomplete number as a final total. Revalidate availability and price on the server at the next commerce step; explain a change before the buyer continues. Never rely on a stale card to authorize purchase.

Preserve a safe local return destination and action intent through sign-in/eligibility flows. Restore the chosen search and, where feasible, scroll position on Back. Check buyer, owner, guest, sold, and ineligible states. Show actual policy/help links without inventing guarantees. For a sold item, retain useful detail and offer relevant alternatives.

**Completion evidence:** controlled listing-to-cart/offer flows preserve facts and intent; owner and unavailable-item controls behave correctly; authentication returns to the right action; source-build browsing and Back restore shopping context. Use the project’s test commerce environment, not live purchases.

**Primary locations:** [listing detail][detail], [cards][cards], existing commerce/authentication intent components and tests.

### R12 — Finish saved items and saved searches across routes

**Problem:** category/leaf searches lack consistent persistence controls, and saved objects must survive taxonomy changes and availability changes.

**How I would solve it:** add Save search to the shared result summary and serialize R04’s complete normalized search definition. Store a version so older saved definitions can be mapped when the taxonomy changes. Save the selected public vehicle criteria rather than depending on access to another user’s private garage entry. Preserve explicit sort; reopen from page one unless a separate last-viewed feature is intended.

Keep Save item distinct from Save search in labels and confirmations. Guests can browse freely; a save action requiring an account preserves the destination and intended save through sign-in. Saved listings retain an honest sold/unavailable label. Clear feedback handles failed or repeated save requests without creating confusing duplicates.

Keep alert opt-in separate. If existing alerts are affected by category migration, test their criteria mapping and avoid unintentionally widening what a user subscribed to. New alert frequency/channel behavior is a separate product decision.

**Completion evidence:** save and reopen an entrance query and a filtered leaf search; selected vehicle and refinements restore; legacy definitions map correctly; unavailable listings and save failures are understandable; saving alone does not enable alerts.

**Existing behavior to preserve deliberately:** saved searches currently store eight keys (`q`, `category`, `subcategory`, `condition`, `min`, `max`, `location`, `fit`) without a version or sort. A saved `fit=1` resolves against the saving user's current garage; that can be a useful dynamic preference. Version legacy searches with that explicit meaning rather than silently freezing them to an arbitrary car. New vehicle-specific searches store public catalog criteria. Update the separate alert matcher alongside any newly supported criteria, and test that reopening an alert agrees with the search that generated it.

## 7. Stage E — Add discovery only where it is useful

### R13 — Introduce inventory-backed merchandising and alternatives

**Problem:** extra homepage sections could improve discovery, but sparse inventory makes repetition and empty destinations likely.

**How I would solve it:** start with Newest available parts and a small number of populated category tiles. Add an explicitly curated collection only when it has sufficient distinct active listings to serve a real purpose. Store a collection definition and destination, then calculate membership from actual inventory. Hide a section when it cannot meet its stated purpose; do not fill it with placeholders or unsupported “Trending” claims.

On detail, separate More from this build/seller from Similar parts. Explain similarity through category/specifications; describe compatibility only to the level of available evidence. Exclude the current item and unavailable inventory; deduplicate where repeated sections would add no value. A See all link must reproduce the collection being advertised.

**Completion evidence:** each visible section has a distinct purpose and matching destination; stock changes do not leave stale recommendations; source-build privacy is respected; keyword searches are not interrupted by unrelated merchandising.

**Release treatment:** the core marketplace can ship without a collection whose data is insufficient. Record that as explicitly deferred, not completed. Revisit after inventory growth supports it.

## 8. Stage F — Validate, measure, and release

### R14 — Test each section and the complete shopping journeys

**How I would solve it:** use a small controlled fixture catalog representing each category and relevant edge case. Include unclassified records, invalid legacy values for migration tests, missing part numbers, mixed shipping methods, uncertain fitment, sold items, long titles, and more than one results page.

Test shared state transitions and match explanations at the unit level; test catalog constraints, facets, row visibility, and query failures at integration level; test cross-page buyer journeys in the browser. Reuse existing tests and add checks for actual risks rather than duplicating component implementation.

**Existing coverage to extend:** `src/lib/marketplace/search/normalize.test.ts` covers query classification/normalization; `tests/operations/search.test.ts` and `supabase/tests/search_scale_guard.sql` cover retrieval/counting/scale and privacy cases; `e2e/discovery-remediation.spec.ts` covers category destinations and mobile browsing/cards; `e2e/feature-regression.spec.ts` covers raw/compact part numbers and shipping. Their existence is not a claim that they currently pass. Add the missing R04 transition and truthful-error regression cases, update intentional UI changes, and run the relevant suites in their proper isolated environments. New advanced-facet cases become required when that deferred feature is implemented.

| Required journey | Evidence for completion |
|---|---|
| Guest searches an exact part number | Expected result leads; identification remains intact on detail |
| Buyer browses category → part type | Correct records/counts; context and old URLs resolve |
| Buyer with two cars switches selection | Relevant results and honest evidence labels change together |
| Buyer applies/cancels filters, sorts, and goes Back | Only committed state persists; pagination resets correctly |
| Buyer opens part → source build → returns | Part and result context remain reachable |
| Buyer saves a leaf search and revisits | Criteria restore, including migrated category and vehicle |
| Buyer continues through cart/offer/sign-in | Facts and action intent remain consistent; unavailable states are handled |
| Request fails, then recovers | Failure is not an empty catalog; Retry retains selections |
| Keyboard/mobile shopper completes the above | Controls, focus, layout, and feedback remain usable |

Record the review’s UI/UX questions as Pass, Needs improvement, or Not yet verified for every section. A beautiful screenshot cannot close a behavioral defect. Require no unresolved failures in the core journeys before release.

### R15 — Reuse monitoring now; deepen analysis with sufficient usage

**How I would solve it:** distinguish query failures from genuine zero-result searches in telemetry. Track category/search results viewed, listing opened, refinement applied, search saved, and successful progression into cart/offer. Reuse existing events where possible; avoid counting server renders, retries, or prefetches as new human actions.

Build on `src/lib/analytics.ts`, its typed events and consent checks, existing `reportError` monitoring, and `src/lib/purchase-analytics.ts` with its durable purchase-event worker. Do not add a parallel tracker or emit a second purchase-completed event from the UI. The generic capture path requires a known user and valid consent; it does not measure all guest browsing. Confirm provider configuration and describe that sample limitation before interpreting a funnel.

Use coarse properties and aggregate metrics where sufficient; avoid collecting raw queries, precise location, or private garage data unnecessarily. Record category/vehicle-filter usage, result counts, timing, and error class. Establish a baseline after retrieval is reliable, since the broken period is not a fair usability baseline.

Monitor retrieval error rate, search latency, genuine zero-result rate, category-to-detail progression, and detail-to-cart/offer progression. Review technical failures immediately and behavioral trends over a meaningful traffic sample. Set numerical performance and conversion targets from measured conditions rather than inventing a promised uplift.

**Completion evidence:** dashboard/log queries distinguish failures from no matches, events are not duplicated, and the release has named metrics with owners and a review date. Low traffic is reported as insufficient evidence rather than success.

**Scope split:** query-error visibility, basic latency/zero-result checks, and protection of existing consent/purchase-event behavior belong in the first release. Validate existing collection now; defer a new analytics dashboard, extra behavioral instrumentation, and conversion conclusions until the intended question and traffic sample justify them. A baseline is collected after the repair and assessed when meaningful; waiting for inventory growth must not make another outage invisible.

### R16 — Release in reversible increments

**How I would solve it:** keep migrations and app changes compatible during deployment. Apply additive catalog/data support first; verify reads and mapped records; then enable the new UI. Keep legacy URL handling active. Avoid removing old fields or functions until the running app and saved definitions no longer depend on them.

Deploy R01’s repair separately where feasible. Stage the category migration and the new results family independently so a visual regression can be rolled back without discarding repaired listing data. Preserve pre-migration assignment snapshots; any data reversal must avoid overwriting newer seller edits. An app rollback should remain compatible with the expanded schema.

Before code changes, read the relevant installed Next.js guides under `node_modules/next/dist/docs/`, as required by this repository. Use the current Supabase workflow for database changes. Run the repository’s relevant type, lint, integration, and browser checks, followed by a target-environment smoke test. Do not execute mutation-heavy tests against production inventory.

**Release gate:** active listings load for guests and buyers; categories and counts reconcile; filter/vehicle/search state is consistent; saved searches and old links work; commerce intent survives handoff; core responsive/accessibility checks pass; monitoring and a usable rollback are recorded.

## 9. Coverage of every review area

| Review finding or UI/UX section | Work packages that address it |
|---|---|
| 4A: retrieval failure presented as empty | R01, R10, R14–R16 |
| 4B: missing subcategories and legacy assignments | R02, R03, R14 |
| 4C: ambiguous category organization | R02, R07, R08 |
| 4D: hidden navigation and lost filters | R04, R06, R09 |
| 4E: missing counts and misleading results | R01, R06, R10 |
| 4F: hidden vehicle selection and fit wording | R05, R09, R11 |
| 4G: weak storefront hierarchy | R08–R10, R13 |
| 4H: competing card actions and comparison facts | R03, R09, R11 |
| 4I: saved-search gaps | R04, R12 |
| 8.1: global navigation/introduction | R08–R10 |
| 8.2: search | R04, R07–R09 |
| 8.3: vehicle/compatibility | R05, R11 |
| 8.4: categories/subcategories | R02–R04, R08–R09 |
| 8.5: filters/mobile sheet | R04, R06, R10 |
| 8.6: result summary/sort/pagination | R04, R06, R09 |
| 8.7: grid/cards | R03, R09–R10 |
| 8.8: curated discovery | R08, R13 |
| 8.9: detail/purchase handoff | R11, R14 |
| 8.10: saved items/searches | R12, R14 |
| 8.11: states/help/accessibility | R01, R10–R11, R14 |
| 8.12: connections between sections | R04–R05, R11–R12, R14–R16 |

The report’s taxonomy, design, implementation, and acceptance recommendations are incorporated into these packages. Referenced competitor patterns are inputs to the design specification, not additional features to copy wholesale.

## 10. Effort, responsibility, and scope control

**Reduced-core planning allowance:** approximately **12–18 engineering days** plus overlapping design and focused QA, or roughly **3–4 calendar weeks** with one engineer and available review support. This covers retrieval/dependency repair; valid existing slugs and integrity rules; R04 for currently supported controls; R09a and a modest R09b; honest vehicle labels and the existing picker; saved-search compatibility; and verification of the existing commerce handoff. The first visible slice should land earlier, within a few working days after a successful environment diagnosis and migration rehearsal.

That range assumes no newly discovered commerce blocker or wider privacy/migration repair, no complete taxonomy replacement, and no comprehensive fitment service. If those assumptions fail, revise the estimate after the populated walkthrough. It is a planning range, not a delivery commitment.

**Deferred scope:** expanded technical-specification collection, advanced multi-select facets and per-option counts, a broad ranking/alias program, a complete new desktop filtering layout, R13 discovery expansion, and richer analytics/dashboard work. Review these when real inventory, search failures, or user observations demonstrate a need; listing count alone is not the trigger. Keep them open in the backlog with an owner and review point. The original **5–8 week** allowance remains the broader planning reference if those capabilities are brought back into the initial scope; merely reordering them does not make the full scope a three-week build.

| Responsibility | Accountable role |
|---|---|
| Catalog boundaries, uncertainty rules, card action choice, merchandising scope | Product owner with designer/engineering input |
| Supported listing assignments and ambiguous-record resolution | Catalog owner or seller review workflow |
| Page hierarchy, mobile layouts, readable visual specification | Designer |
| Query/data/state/components, migration and release implementation | Engineer |
| Independent journey checks and section-level evidence | QA/reviewer |
| Release health and metric follow-up | Engineer with product owner |

Roles can be combined on a small team, but each deliverable still needs a named owner when execution begins. Unresolved seller facts should remain in a tracked queue; they should not be fabricated to close a task.

**Outside the core estimate:** procuring a comprehensive verified-fitment catalog, launching new payment/returns guarantees, broadening into vehicle sales, replacing the search platform without demonstrated need, and building a new notification delivery system. Any of these can become a separately scoped extension. Existing functionality affected by this work still requires regression coverage.

## 11. Execution checklist

The revised core and deferred extensions are tracked separately below. The [September 13 acceptance record][completion] is the current implementation evidence; the September 12 record remains the first browsing repair.

- [x] R01 core — Shared retrieval and visibility dependencies repaired; Marketplace, Explore Parts and alert matching share the query; failed retrieval remains distinct from zero results.
- [x] R02 core — Stable existing slugs, supported redirects, assignment snapshot and known legacy mappings. Fourteen missing part types were resolved from recorded listing evidence; one roof box remains at its parent because no suitable leaf exists. The misplaced KW coilovers parent is corrected. No unsupported subtype was guessed.
- [ ] R02 expansion — Broader taxonomy changes after catalog evidence and product review.
- [x] R03 core — Create/edit/import assignment validation and database category/part-type integrity; explicit unknown part type.
- [ ] R03 expansion — Type-specific specifications and evidence-based backfills.
- [x] R04 — Normalized URL state, draft versus applied controls, category/vehicle/sort/page transitions, safe detail/source return and saved definitions.
- [x] R05 core — Guest catalog selection, explicit garage choices, selected year and consistent evidence labels; unknown years stay uncertain.
- [x] R06 core — Current single-choice filters, item-price sort, truthful totals, pagination, applied-state counts and recovery.
- [ ] R06 expansion — Multiselect facets, per-option counts, technical and brand filters.
- [x] R07 core — Existing raw/compact identifiers, exact/non-match fixtures, shared alert retrieval and stable pagination.
- [ ] R07 expansion — Managed synonyms and evidence-based Best match ranking.
- [x] R08 core — Recorded reference adaptation and connected page/state specification, registered components and live specimens.
- [x] R09a — Count, breadcrumb, persistent categories and mobile spacing.
- [x] R09b core — Shared shopping layout and complete comparison cards; Open and separate Save on the grid. Social and purchase controls remain on detail; Explore retains its existing feed variant.
- [ ] R09 expansion — New full desktop filter layout; reconsider only with evidence from actual use.
- [x] R10 core — Responsive layouts, focus/dialog behavior, light/dark accessibility scans, enlarged text, loading/pending, empty/error and unavailable states.
- [x] R11 core — Detail/source return and authentication handoff; isolated buyer checkout, sold/owner handling, dispatch, receipt and review. Real provider and hosted acceptance remain R16.
- [x] R12 core — Full versioned searches and alert opt-in, save authentication intent, complete restoration and sold/unavailable saved parts.
- [ ] R13 expansion — Curated collections deliberately deferred: sixteen active listings do not yet support a distinct collection purpose. Populated category navigation and deduplicated active detail alternatives are implemented.
- [x] R14 core — Unit, schema/visibility, scale and browser evidence; final acceptance details and limitations are in the linked record.
- [x] R15 core — Existing consent boundary and authoritative purchase event path preserved; visible-page events and retrieval/worker outcomes distinguish failure from no matches.
- [ ] R15 expansion — Hosted baseline, funnel conclusions and additional dashboards require actual consented usage. Product and engineering review the first week after hosted launch.
- [ ] R16 — **External release dependency remains:** provisioned HTTPS staging, the full compatible commerce chain, provider acceptance and external monitoring. No hosting target is linked here. Shared shopping migrations and read-only smoke checks are complete; a hosted app release is not claimed.

Engineering owns implementation and release checks; the catalog/product owner owns uncertain assignments and decisions to expand the deferred work. Review technical failures immediately. Revisit deferred discovery, fields and ranking when inventory or observed failed searches supports a specific need. The first week of hosted operation is the review point for meaningful monitoring, not a fabricated current conversion baseline.

The four execution decisions are resolved for this implementation: Open + Save on shopping cards, social actions on detail, reuse Explore's current finder/sheet behavior, and focused dependency migrations instead of the whole September 5 batch. Additive functions and saved definitions remain during an app rollback; do not reverse the category snapshot over newer seller edits. The full remediation remains open where explicitly deferred or externally blocked above.

[completion]: </Users/neilbarrow/Desktop/Cursor Projects/DRVN 2/docs/remediation-evidence/marketplace-2026-09-13/README.md>
[comments]: </Users/neilbarrow/Desktop/Cursor Projects/DRVN 2/docs/marketplace-plan-comment-review-2026-09-12.md>
[implementation]: </Users/neilbarrow/Desktop/Cursor Projects/DRVN 2/docs/remediation-evidence/marketplace-2026-09-12/README.md>
[review]: </Users/neilbarrow/Desktop/Cursor Projects/DRVN 2/docs/marketplace-review-2026-09-08.md>
[design]: marketplace-reference-evidence-2026-09.md
[query]: </Users/neilbarrow/Desktop/Cursor Projects/DRVN 2/src/lib/marketplace/query.ts>
[results]: </Users/neilbarrow/Desktop/Cursor Projects/DRVN 2/src/features/marketplace/results.tsx>
[rpc]: </Users/neilbarrow/Desktop/Cursor Projects/DRVN 2/supabase/migrations/20260905133456_uncapped_marketplace_filters.sql>
[taxonomy]: </Users/neilbarrow/Desktop/Cursor Projects/DRVN 2/src/lib/marketplace/taxonomy.ts>
[catnav]: </Users/neilbarrow/Desktop/Cursor Projects/DRVN 2/src/app/(discover)/marketplace/category-nav.tsx>
[mapping]: </Users/neilbarrow/Desktop/Cursor Projects/DRVN 2/src/lib/mods/category-map.ts>
[sell]: </Users/neilbarrow/Desktop/Cursor Projects/DRVN 2/src/app/(product)/sell/actions.ts>
[filters]: </Users/neilbarrow/Desktop/Cursor Projects/DRVN 2/src/app/(discover)/marketplace/filter-bar.tsx>
[active]: </Users/neilbarrow/Desktop/Cursor Projects/DRVN 2/src/app/(discover)/marketplace/active-filters.tsx>
[fitment]: </Users/neilbarrow/Desktop/Cursor Projects/DRVN 2/src/lib/marketplace/fitment.ts>
[cards]: </Users/neilbarrow/Desktop/Cursor Projects/DRVN 2/src/components/ui/mosaic.tsx>
[detail]: </Users/neilbarrow/Desktop/Cursor Projects/DRVN 2/src/app/(discover)/listings/[id]/page.tsx>
[entry]: </Users/neilbarrow/Desktop/Cursor Projects/DRVN 2/src/app/(discover)/marketplace/page.tsx>
