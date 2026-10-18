# Marketplace implementation record — September 12, 2026

The first slice of the revised remediation plan is implemented. **The database repairs are applied to the shared `drvn-v3` project. The interface changes are in the local working tree and have not been deployed as an application release.** The wider remediation remains open.

Preview: [local marketplace](http://localhost:3005/marketplace). The existing development server was preserved.

## What changed for shoppers

- Marketplace entrance, category and part-type pages now share one layout and one normalized search state.
- Successful requests show the actual result total and the displayed range. Retrieval failures show a separate error with Retry and a diagnostic reference; they do not claim that no parts exist.
- Category pages have breadcrumbs above search. Categories remain accessible during a search: a compact tree on desktop and a Categories sheet on phones.
- Category links and breadcrumbs retain search, budget, vehicle criteria and sort, while returning pagination to page one.
- Clear filters removes refinements while retaining the search, category, selected catalog vehicle and sort. Search and vehicle chips can be removed separately.
- Cancel discards draft refinements. Sort changes applied state only. Invalid price ranges explain the problem before submitting.
- Mobile search occupies its own row, followed by Filters, Categories and Sort. Reduced spacing brings inventory into the first screen.
- Explore Parts uses the repaired retrieval and displays the same truthful error state. A failed Parts request also remains visible inside combined Explore results.

This slice preserves the existing listing cards. The live-content inspection still shows crowded price/shipping text and purchase controls dominating cards; those are the next R09b changes, not resolved findings.

## Database repair and deployment evidence

Before repair, direct public reads found 16 active listings, but the marketplace functions were absent and the API returned `PGRST202`. The shared migration ledger listed only 0001–0011 despite later schema objects already existing. Replaying the migration tree would be unsafe.

The missing marketplace definitions were extracted from the two reviewed September 5 files into a focused migration. It restores their suspension visibility rules, identifier helper, search rows and filtered rows. The result functions remain **SECURITY INVOKER**, so normal shopper permissions apply. The unrelated worker migration also requires `remediation_jobs`, which is absent on the shared project; its worker/payment changes were not included.

Both new files were generated with the CLI, rehearsed locally and applied through Supabase MCP. MCP assigned different ledger timestamps; use this mapping when reconciling history and do not apply a duplicate based only on the local filename.

| Local migration | Shared ledger version | Outcome |
|---|---|---|
| `20260913012911_marketplace_retrieval_repair.sql` | `20260913014536` | Applied successfully |
| `20260913014222_marketplace_category_integrity.sql` | `20260913014621` | Applied successfully; category constraint validated |

The date is September 13 in UTC and September 12 in New York.

The classification repair maps supported legacy parent slugs: `interior` → `interior-lighting` and `brakes` → `brakes-suspension`. It changed one active listing and one sold listing; immutable order snapshots were not changed. [Pre-migration assignments](</Users/neilbarrow/Desktop/Cursor Projects/DRVN 2/docs/remediation-evidence/marketplace-2026-09-12/legacy-assignments.json>) retain the exact affected listing IDs.

There are still 24 total listings and 16 active listings. Fifteen active listings lack a part type; their values remain null because the available evidence does not justify guessing. A database check now rejects unsupported categories and part types assigned to the wrong parent. Seller create/edit validation enforces the same catalog, with a test checking the SQL snapshot against the authored taxonomy. Existing category slugs remain identifiers, including the valid `engine` slug.

Public API checks after deployment returned:

| Request | HTTP result | Matching listings |
|---|---|---|
| All active inventory | 200 | 16 |
| Keyword `intake` | 200 | 1 |
| Interior & Lighting | 200 | 3 |
| Deliberately unmatched keyword | 200 | 0 |

The signed-in local interface was also inspected with actual shared inventory and photos: it displayed all 16 listings.

## Verification

- TypeScript checking and focused linting passed.
- **36 tests across eight files passed** for marketplace state/query/taxonomy, Explore parameters, component registry, generated documentation and recipe rules. Command: `npm run test -- src/lib/marketplace src/lib/explore/search/params.test.ts src/components/registry.test.ts src/lib/docs/registry-docs.test.ts src/components/recipe-ratchet.test.ts`.
- The additional route-boundary architecture test passed: **37 unit/governance tests in total**.
- **10 initial Chromium browsing tests passed**, covering result totals, pagination, category/breadcrumb transitions, legacy URLs, Apply/Cancel, invalid budgets, Explore Parts and recovery from an actual database permission failure.
- After the final typography/token correction, all four responsive checks passed again at **320, 390, 768 and 1440px**. They check horizontal overflow, accessible category navigation and visible inventory; mobile first-card position stays above 600px.
- An additional mobile empty/error test passed at **320 and 390px**, checking genuine zero results, failed retrieval without a false zero, no overflow, and successful Retry with context retained. That brings browsing coverage to **11 passing tests** across the recorded runs. The populated, empty and error captures were visually inspected.
- `supabase/tests/marketplace_retrieval_guard.sql` passed with rolled-back local fixtures: guest/buyer/owner visibility, suspended sellers, private source builds, compact part numbers, combined vehicle/year/budget criteria and rejected category mismatches.
- The existing SQL search scale guard passed with 450 rows. The focused operations test passed with 1,100 listings, verifying filtering before pagination and a stable exact total; the unrelated Typesense test was excluded.

Browser fixtures and database fault injection used only the disposable local Supabase project with stub payments. These checks are not a real payment, email-delivery or complete commerce walkthrough.

The shared security advisor returned no ERROR-level findings before or after deployment. Existing warnings remain. Two intentional boolean helper functions add executable-function warnings for the guest and signed-in roles; their narrow outputs and explicit visibility checks are retained from the reviewed migration. Result RPCs remain invoker functions, and the role-based SQL checks pass. This is not a claim that all project-wide advisories are resolved.

## Design and component-system evidence

The implementation reuses the existing Finder, BottomSheet, Button, EmptyState, PageHead and Pagination components. Finder gained an optional cancellation callback, documented with an interactive Apply/Cancel specimen. Its registry description and generated component inventory were updated; the recipe baseline decreased instead of allowing new duplication.

The [as-built design specification](../../marketplace-reference-evidence-2026-09.md) records the structural use of the earlier Etsy/Faire references and deliberate differences. These are DRVN design values, not measurements copied from Mobbin.

Responsive captures use controlled test inventory, not the live catalog: [320px](</Users/neilbarrow/Desktop/Cursor Projects/DRVN 2/docs/remediation-evidence/marketplace-2026-09-12/marketplace-320.png>), [390px](</Users/neilbarrow/Desktop/Cursor Projects/DRVN 2/docs/remediation-evidence/marketplace-2026-09-12/marketplace-390.png>), [768px](</Users/neilbarrow/Desktop/Cursor Projects/DRVN 2/docs/remediation-evidence/marketplace-2026-09-12/marketplace-768.png>), [1440px](</Users/neilbarrow/Desktop/Cursor Projects/DRVN 2/docs/remediation-evidence/marketplace-2026-09-12/marketplace-1440.png>).

Mobile state captures: [empty at 320px](</Users/neilbarrow/Desktop/Cursor Projects/DRVN 2/docs/remediation-evidence/marketplace-2026-09-12/marketplace-empty-320.png>), [error at 320px](</Users/neilbarrow/Desktop/Cursor Projects/DRVN 2/docs/remediation-evidence/marketplace-2026-09-12/marketplace-error-320.png>), [empty at 390px](</Users/neilbarrow/Desktop/Cursor Projects/DRVN 2/docs/remediation-evidence/marketplace-2026-09-12/marketplace-empty-390.png>), [error at 390px](</Users/neilbarrow/Desktop/Cursor Projects/DRVN 2/docs/remediation-evidence/marketplace-2026-09-12/marketplace-error-390.png>).

## Remaining work and rollback boundary

Next is R09b: make cards easier to compare, keep price and shipping readable, and move marketplace purchase/social emphasis to the appropriate detail actions. Follow with explicit vehicle selection and consistent compatibility explanations, complete saved-search state/versioning, and the detail/authentication/commerce return journey.

Saved searches still persist the existing eight criteria without version or sort; the new URL model does not itself complete R12. The alert worker has its own administrative query and search provider. Its notification links now reach working results, but matching/visibility agreement still requires isolated worker tests with captured notifications. No shared alert job was invoked.

R01, R02–R04 and R10/R14–R16 therefore have initial-slice evidence, not full-package completion. Advanced facet counts, richer ranking, merchandising and larger analytics baselines remain later work.

An interface rollback should revert only this slice's source changes and preserve unrelated working-tree edits. Keep the additive database repair and category mappings in place: the old application already recognizes the canonical category slugs. Do not remove visibility policies merely to roll back appearance. Any exceptional data reversal must compare the assignment snapshot against current values and avoid overwriting subsequent seller edits. The original worker migration's two policy creations are now idempotent so a later reviewed rollout can coexist with this repair. The broader September 5 migration set still needs its own coordinated rollout.
