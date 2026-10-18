# Marketplace implementation and acceptance — September 13, 2026

This record extends the September 12 browsing repair through the revised plan's complete **core scope**. Advanced specification schemas, multiselect facets, Best match ranking, curated collections and a new analytics dashboard remain conditional work in the revised plan, rather than prerequisites imposed on sixteen active listings.

## What is implemented

- One category and URL-state vocabulary across entrance, parent, leaf and search results. Existing slugs and supported redirects remain; uncertain legacy part types remain unclassified rather than guessed.
- Optional public-catalog vehicle selection, including choosing either car from a signed-in garage. URLs carry catalog identity and an optional vehicle year, never a private garage-row identifier. A selected vehicle is distinct from source-car year filters.
- Shared match explanations for cards, detail and database retrieval. Unknown years cannot establish a bounded seller claim; source-model similarity cannot override a conflicting seller year range. Source evidence respects build privacy. Garage-wide searches explicitly refer to the current garage.
- Shopping cards preserve the entire title, part number, item price, delivery mode/cost, condition/location, seller and source build. Images fit a 4:3 frame. Marketplace actions are Open listing and Save; other feed variants retain their established anatomy.
- Complete versioned saved-search definitions, canonical deduplication and explicit alert opt-in. The alert worker uses the same retrieval/filter contract, applies all criteria before limiting displayed matches and retains its cursor after delivery failure.
- Detail-to-source-build-to-part-to-results return links and authentication intent. Delivery calculated later is labeled as such. Related sections exclude the current item and do not repeat the same seller's inventory across both rails.
- Explore keeps the existing finder and sheet, with corrected Cancel, Reset, price validation and sorting from applied state. Marketplace category access remains available while filtering, and entrance tiles feature populated branches.
- Distinct loading, pending, empty, failed, unavailable and missing-image states. Pending selection suppresses the obsolete result announcement. Vehicle catalog errors offer Retry. Saved retrieval failures and unavailable saved items are explicit.
- Existing consent-based analytics reused for visible result/detail views. Events carry coarse counts/flags, not query text, location or garage data. Browser mounting avoids prefetch events; a five-minute per-tab view key suppresses refresh/Back duplicates. Existing durable purchase analytics remains authoritative. Technical retrieval outcomes log success, zero or error with timing.

## UI and UX coverage

| Section | Result and reason |
|---|---|
| Entrance and introduction | Compact page heading and populated category choices bring real stock into view sooner. No unsupported popularity or promotional claims. |
| Search and category navigation | Parent and leaf destinations preserve the current shopping criteria; breadcrumbs explain location, and category access survives a narrowed search. |
| Vehicle context | Optional public-catalog selection and explicit garage choices sit beside the shopping controls. Matching copy explains the evidence and treats missing years honestly. |
| Filters and sorting | One established Finder sheet; Apply commits, Cancel discards and Reset edits the draft. Item-price sort does not silently apply an abandoned budget. |
| Results and cards | Truthful count/range, 1/2/3/4 responsive columns, entire title and photo, separate delivery line, seller/source and a distinct Save target make parts comparable. |
| Detail and source builds | The detail confirms card facts and carries a safe return route through source browsing, sign-in and purchase intent. Alternatives have distinct seller/category purposes. |
| Saved items and searches | Item saving resumes after sign-in; complete search definitions restore the vehicle, category, price and sort. Sold and unavailable items remain understandable. Alerts require a separate choice. |
| Loading, failure and accessibility | Loading reserves grid space; pending changes suppress obsolete result announcements. Retry differs from zero results. Long filter values wrap at doubled text size without losing their remove control. |

The existing component registry, generated component documentation and interactive specimens are updated. The feed-card redesign that was already in the working tree is preserved. The [P5 specification](../../marketplace-reference-evidence-2026-09.md) records measured DRVN targets and deliberate differences from the original Mobbin references.

## Database rollout

The shopping and consent migrations were rehearsed on the disposable local database before applying to shared `drvn-v3` (`grunnjojhdevhuckujmc`). No shared customer notifications, offers, purchases or fixture records were created.

| Local file | Shared ledger version | Changes |
|---|---|---|
| `20260913132451_marketplace_shopping_contract.sql` | `20260913134641` | Invoker-rights browse/evidence/count functions; versioned saved definitions; idempotent search saving; existing relationship mutation; service-only worker execution records |
| `20260913134823_marketplace_consent_and_offers.sql` | `20260913135341` | Existing consent table/function and atomic offer submission, with an explicit duplicate-offer preflight |
| `20260913144218_marketplace_evidenced_part_types.sql` | `20260913144516` | Fourteen evidence-backed part-type assignments; correct the KW coilovers parent; skip later seller edits |

Post-rollout inventory remains **16 active parts**. Categories now reconcile to 4 performance, 3 interior/lighting, 4 brakes/suspension, 3 wheels/tires and 2 exterior/body. Fifteen parts have supported leaf assignments after reviewing the actual titles and descriptions; the KW coilovers moved from Performance to Brakes & Suspension. The roof box/rack stays at Exterior & Body because the current taxonomy has no appropriate leaf. The [assignment snapshot and rationale](catalog-assignment-review.json) records each decision, including the [manufacturer identification of the Garrett GT2871R](https://www.garrettmotion.com/racing-and-performance/performance-catalog/turbo/gt2871r/). This classifies the part type only; it does not verify condition, dimensions or compatibility. Rehearsal proved repeatability and protection of changed seller facts/classifications. Public reads remain invoker-rights. Anonymous offer and consent mutations are denied.

Local security advisors reported no errors. Shared advisors retain existing warnings about mutable search paths, public definer functions, extensions and password protection. The new service-only worker table intentionally has RLS and no public policies. The authenticated consent function is deliberately privileged to maintain an account's own preference while preventing arbitrary direct writes. These scoped changes are not a claim that every pre-existing shared-project warning has been remediated. See [Supabase's advisor guidance](https://supabase.com/docs/guides/database/database-linter).

## Validation record

The retained diagnostic logs show the defects that were found; a failed whole run is not relabeled as a clean release pass. The final scoped runs verify the repaired behavior.

| Check | Evidence |
|---|---|
| Unit and contract tests | **673/673 tests passed across 103 files**, with one worker to avoid local resource contention. See `unit-tests.log`; includes state, taxonomy, matching, delivery, saved definitions, worker failures, API origin checks, registry/docs and recipe enforcement. |
| Fresh schema and SQL guards | All 108 migrations present at the schema rehearsal and all 44 guards passed in a new disposable PostgreSQL instance. The later data-only assignment migration passed an additional guard proving the fourteen assignments, safe repeat runs and protection of changed seller facts. See `fresh-schema-and-guards.log` and `catalog-assignment-guard.log`. |
| Retrieval at scale | The existing operation test passed with 1,100 listings, including a match beyond the former cap, exact counts and pagination. Optional Typesense tests were not part of this run. |
| Browser regression matrix | 49 discovery, feature, browsing, family and golden-path checks passed in the combined diagnostic run. Its saved-search failure is retained in `browser-core-diagnostic.log`, and the repaired shopping flow is verified separately. |
| Shopping acceptance | **20/20 executions passed: ten shopping scenarios run twice, with no retries.** The final shopping run covers exact identifiers, detail/source return, optional vehicle/year, two garage cars, full leaf searches, authentication/save/un-save, catalog Retry/focus, light/dark enlarged text, guest saved-search restoration and unavailable saved-item removal. See `browser-shopping.log`. Together with the 49 other passing scenarios, this verifies all 59 unique core browser scenarios across the recorded runs. |
| Static checks | Type checking, generated database types and lint passed; lint retains three pre-existing unused-directive warnings and no errors. |
| Shared preview | Read-only inspection confirmed sixteen active cards, matching category totals and no horizontal page overflow. The repaired live Brakes & Suspension parent showed four parts, and its Coilovers & Springs leaf showed both classified listings. Shared data writes were limited to reviewed migrations/classification repairs; all purchase, offer and notification fixtures stayed isolated. |

The local purchase walkthrough covered listing → cart/checkout → sold state → dispatch → buyer receipt/review → public seller review. Payments and shipping were stubs; this is not real-provider acceptance. Saved-search worker failure/cursor tests used mocked delivery and the shared query contract, supplemented by database visibility tests; the shared alert job was not invoked to send customer notifications.

Browser diagnostics repaired duplicate sibling keys, sign-in URL cleanup competing with a pending save, and save/remove responses being coupled to page rerendering. Saving a search and removing a saved relationship now use small authenticated, same-origin responses through the existing mutations, with bounded client waiting and explicit retry feedback. Repeated requests retain the existing idempotence. Successful removal reloads the current Saved URL only after confirmation; failed removal retains the item.

Parallel diagnostic runs timed out in an unrelated importer fixture while other local checks competed for resources. The final full suite used one worker, preserved the existing assertion timeouts and passed all 673 tests; that run is the acceptance evidence. One browser build also exceeded its startup deadline before any scenario ran. Neither infrastructure diagnostic is silently counted as a passing run.

### Visual evidence

- [320px shopping, light](shopping-light-320.png) and [dark](shopping-dark-320.png).
- [Doubled computed text, light](shopping-light-320-text200.png) and [dark](shopping-dark-320-text200.png). This explicitly scales pixel-based text as well as relative text; it is not a claim of complete browser zoom or assistive-technology conformance.
- [390px populated results](marketplace-390.png), [768px](marketplace-768.png) and [1440px](marketplace-1440.png).
- [320px empty](marketplace-empty-320.png) and [failed retrieval](marketplace-error-320.png); equivalent [390px empty](marketplace-empty-390.png) and [failure](marketplace-error-390.png).

Axe reported no WCAG A/AA violations in the tested main content in light and dark mode. Reduced motion, dialog focus return, long titles and horizontal overflow were checked. These focused checks do not establish universal accessibility conformance.

## Release boundary

The app runs locally at `http://localhost:3005/marketplace` against the shared inventory. **No hosted application release has been promoted.** The repository's existing release records identify unprovisioned HTTPS staging and external provider/monitor acceptance; no hosting target is linked in this checkout.

The shared database still has the older `purchase_begin` signature and lacks the durable payment preparation, cart freeze/binding and purchase-outbox dependencies. Those belong to the previously implemented, wider commerce rollout; installing a date-based batch or silently falling back to the older payment function would not establish a verified release. The controlled local commerce database has the complete chain. `supabase/marketplace-release-preflight.sql` makes the required shared compatibility checks explicit and read-only. R16 remains open until the selected hosted environment is provisioned, the complete commerce chain is rehearsed there and the existing candidate/provider/monitor gates pass.

Rollback of the marketplace UI keeps all additive database functions, category mappings and existing saved-search criteria. Do not reverse classification snapshots over subsequent seller edits. The previous browsing RPC remains available. Restoring an older app must also retain its matching commerce schema; this work does not authorize weakening that contract.

## Measurement and follow-up

Engineering owns retrieval error/zero rates, query duration, failed alert runs and dependency checks from deployment onward. Product owns category-to-detail and detail-to-cart/offer review once consented usage provides a meaningful sample. Review failures immediately and review the first week of actual hosted operation; an absence of traffic is not a conversion result. Catalog ownership must decide whether roof racks/storage merit a supported leaf; the one remaining unclassified part remains visible in its parent. All fourteen otherwise-resolvable assignments have been repaired using recorded evidence. Add specifications, synonyms, facets or collections only when actual inventory or observed failed searches establishes their purpose.
