# Review of the marketplace plan comments

**September 12, 2026 • Code review and limited public API verification**

## 1. Recommendation

Adopt the comments' main direction: ship a small visible improvement early, reuse the substantial infrastructure DRVN already has, and keep R04's state-transition table as the shared behavior contract. The original plan made too much design and data expansion appear necessary before the marketplace could improve visibly.

Do not adopt the comments verbatim. Their claims about absent tests, the alert worker's query dependency, and Explore's popover interface do not match this checkout. The asserted category-count function could not be identified. These distinctions change what engineers should repair and which existing work they should preserve.

The [remediation plan][plan] now reflects the faster sequence, narrower initial scope, component requirements, existing infrastructure, and corrections below. No application or database changes were made as part of this review.

## 2. What the comments get right

| Comment | Assessment and consequence |
|---|---|
| R01 requires a coordinated dependency rollout | Correct. The filtered-results function calls `marketplace_search_rows`. Its earlier migration also introduces suspension-related visibility policies on cars and listings. Review the dependency chain and visibility impact together; a one-function deployment is not an adequate instruction. |
| Category integrity needs database rules | Supported by the local schema: category/subcategory are text and no catalog-pair constraint was found. Validate all publishing paths and enforce valid assignments at the database boundary. Existing fixtures need updating when stricter rules arrive. |
| Saved-search definitions are incomplete | Correct: eight parameter keys, no definition version, no saved sort or explicit vehicle criteria. Preserve legacy meaning while adding a versioned definition. |
| Part-number and analytics infrastructure should be reused | Correct, and identifier support goes further than the comment suggests: compact values, alternate identifiers, and an interchange relationship table already exist. Consent-aware analytics and durable purchase analytics also exist. |
| Component governance belongs in R08/R09 | Correct. Public component exports, the registry, and generated docs must agree. The recipe ratchet prevents copied styling recipes from spreading. Include component specimens in design review. |
| Independent category IDs add unnecessary work | Agree with simplifying. The plan proposed separate stable IDs, but did not specify numeric IDs. Keep slugs as identifiers and use redirects/mapping for renames. A category split still needs a useful choice destination rather than an arbitrary redirect. |

Evidence: [filtered function][filtered], [dependency and policies][privacy], [saved-search serialization][saved], [compact identifiers][compact], [alternate identifiers][identifiers], [analytics][analytics], [purchase analytics][purchase], [component registry tests][registry], [generated-doc checks][docchecks], and [recipe ratchet][ratchet].

## 3. Factual corrections before implementation

### The alert worker does not use the same listing query

Explore's Parts results call `fetchListings`, so the marketplace retrieval failure affects that path too. Add it to R01's completion evidence. [Explore query][explorequery]

The saved-search worker instead builds a direct administrative query against `listings`, applies criteria itself, and calls `getSearchProvider().searchIds` for text. The PostgreSQL provider uses `search_listing_ids` and identifier tables; it does not call either unavailable marketplace function. Its notification destination does return to the broken marketplace. [Alert worker][alerts], [PostgreSQL provider][provider]

Therefore, include alerts in regression checks, but do not state that this missing RPC proves the worker itself is broken. Check agreement between alert criteria and visible results, and explicitly test visibility because administrative reads bypass ordinary public access rules. Do that with isolated fixtures and captured notifications.

### Marketplace tests already exist

The statement that there are no marketplace unit tests is false. There are [query-normalization unit tests][unit]. Coverage outside the marketplace-named end-to-end file also includes [category and mobile browsing][discoverytests], [raw/compact part-number search and shipping][featuretests], and [operations tests for filtered retrieval, counts, pagination, and privacy][operationtests].

The useful criticism is that R04's full transition contract and truthful error presentation need focused coverage. Extend the existing suites. Some tests currently require quick-buy and social controls, so intentionally changing the card design requires updating those expectations. This review inspected tests; it did not run them or establish that the current deployment passes them.

### Explore currently uses a refinement sheet

Explore's current search bar uses `SuggestingSearchField`, `FinderRefineSheet`, vehicle controls, and sorting. It uses a sheet at all widths. A `FilterPopover` component exists, but no usage was found in the current application. The scope links on Explore are not a row of individual filter popovers. [Explore search bar][explorebar], [popover primitive][popover]

Unify the existing search/refinement behavior and primitives first. A different desktop filter layout remains a design choice to evaluate; it is not simply copying a pattern already deployed on Explore.

### A missing category-count function is unverified

The current results query requests an exact count from `marketplace_filtered_rows`. No separate category-count RPC or caller was found in `src` or the checked migrations. Obtain the exact function name and migration before treating it as a required deployment item. Displaying the existing results total does not require building dynamic counts for every category/filter option. [Current query][query]

## 4. What the database check establishes

Using only the configured public client, the September 12 probes returned:

| Probe | Result |
|---|---|
| Direct count of public active listings | HTTP 200; 16 listings |
| `marketplace_filtered_rows` with the app's argument names | HTTP 404; PGRST202, function unavailable in the API schema cache |
| `marketplace_search_rows(p_query)` | HTTP 404; PGRST202, function unavailable in the API schema cache |

This confirms the retrieval blocker remains. It does not establish whether the definitions are absent from the underlying database or unavailable because of exposure/cache state. An authenticated migration-ledger/schema inspection remains part of R01.

The two directly implicated September 5 files also depend on earlier schema. “At least these two, subject to the actual ledger” is safer and more accurate than “exactly two migrations.” Review and deploy the required dependency closure; do not apply the entire date's unrelated changes automatically. After the visibility changes, reconcile counts against eligible inventory rather than requiring the total to remain 16.

## 5. The delivery sequence I would adopt

1. **Restore retrieval and ship the visible slice.** Repair R01; retain valid existing category slugs and map supported legacy assignments; apply R04 to touched navigation. Add the results total, top breadcrumb, persistent category access, and mobile spacing repair as R09a. Verify the restored populated page before closing visual findings.
2. **Finish the existing shopping journey.** Make current filters, sort, pagination, vehicle context, cards, saved searches, and detail/authentication handoff consistent. Reuse the existing component system and commerce services. Verify each increment.
3. **Expand only when needed.** Add technical specifications, advanced multi-select counts, broader ranking evaluation, merchandising, and richer analytics when inventory or observed shopper problems justify them.

A few days for the first visible slice is plausible after successful environment diagnosis. Three to four weeks is a reasonable planning allowance for the reduced core with available design/QA support and no wider migration or commerce blocker. It is not a validated estimate for delivering the original full scope.

Keep basic search fixtures, filter correctness, and monitoring in the first release. Advanced ranking evaluation and a new analytics dashboard can wait; returning the wrong part or hiding another retrieval failure cannot. Existing consent-based analytics excludes some browsing, particularly guests, so a future conversion baseline must state its coverage.

## 6. Proposed answers to the four open decisions

| Decision | Recommended answer | Reason |
|---|---|---|
| Buy now on the grid | Keep purchase/cart actions on detail for this release; grid emphasizes Open listing and Save | Used parts need condition, inclusions, compatibility, and delivery context before a buyer commits. Preserve existing commerce services. |
| Social strip on marketplace cards | Move it to detail; retain appropriate variants elsewhere | Makes listing comparison easier without changing DRVN's social feeds globally. |
| Explore filter unification | Share the current finder/sheet primitives and transition behavior | Reduces duplicate work and inconsistent Apply/Cancel behavior. Revisit desktop presentation after observing usage. |
| Whole September 5 migration set | Deploy the verified dependency chain with policy regression checks | Dates alone do not define a safe release unit. Broader outstanding migrations need their own dependency and release assessment. |

These are recommendations for implementation, not a claim that the user has already approved each product choice. Legacy saved “my garage” searches should remain explicitly dynamic; do not silently convert them to one fixed vehicle while adding explicit vehicle searches.

[plan]: </Users/neilbarrow/Desktop/Cursor Projects/DRVN 2/docs/marketplace-remediation-plan-2026-09-08.md>
[filtered]: </Users/neilbarrow/Desktop/Cursor Projects/DRVN 2/supabase/migrations/20260905133456_uncapped_marketplace_filters.sql>
[privacy]: </Users/neilbarrow/Desktop/Cursor Projects/DRVN 2/supabase/migrations/20260905124039_worker_privacy_hardening.sql>
[saved]: </Users/neilbarrow/Desktop/Cursor Projects/DRVN 2/src/features/marketplace/saved-search-actions.ts>
[compact]: </Users/neilbarrow/Desktop/Cursor Projects/DRVN 2/supabase/migrations/0033_part_number_compact.sql>
[identifiers]: </Users/neilbarrow/Desktop/Cursor Projects/DRVN 2/supabase/migrations/0042_part_identifiers.sql>
[analytics]: </Users/neilbarrow/Desktop/Cursor Projects/DRVN 2/src/lib/analytics.ts>
[purchase]: </Users/neilbarrow/Desktop/Cursor Projects/DRVN 2/src/lib/purchase-analytics.ts>
[registry]: </Users/neilbarrow/Desktop/Cursor Projects/DRVN 2/src/components/registry.test.ts>
[docchecks]: </Users/neilbarrow/Desktop/Cursor Projects/DRVN 2/src/lib/docs/registry-docs.test.ts>
[ratchet]: </Users/neilbarrow/Desktop/Cursor Projects/DRVN 2/src/components/recipe-ratchet.test.ts>
[explorequery]: </Users/neilbarrow/Desktop/Cursor Projects/DRVN 2/src/lib/explore/search/query.ts>
[alerts]: </Users/neilbarrow/Desktop/Cursor Projects/DRVN 2/src/app/api/jobs/saved-searches/route.ts>
[provider]: </Users/neilbarrow/Desktop/Cursor Projects/DRVN 2/src/lib/marketplace/search/postgres.ts>
[unit]: </Users/neilbarrow/Desktop/Cursor Projects/DRVN 2/src/lib/marketplace/search/normalize.test.ts>
[discoverytests]: </Users/neilbarrow/Desktop/Cursor Projects/DRVN 2/e2e/discovery-remediation.spec.ts>
[featuretests]: </Users/neilbarrow/Desktop/Cursor Projects/DRVN 2/e2e/feature-regression.spec.ts>
[operationtests]: </Users/neilbarrow/Desktop/Cursor Projects/DRVN 2/tests/operations/search.test.ts>
[explorebar]: </Users/neilbarrow/Desktop/Cursor Projects/DRVN 2/src/app/(discover)/explore/search-bar.tsx>
[popover]: </Users/neilbarrow/Desktop/Cursor Projects/DRVN 2/src/components/ui/filter-popover.tsx>
[query]: </Users/neilbarrow/Desktop/Cursor Projects/DRVN 2/src/lib/marketplace/query.ts>
