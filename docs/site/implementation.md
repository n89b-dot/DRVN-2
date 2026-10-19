# Implementation — the living record

> **What this is.** The live status of the August 2026 platform-evolution
> workstream. The typed source of truth is
> `src/lib/docs/implementation-registry.ts`; the visual page at
> `/docs/implementation` and the block below both render from it. Statuses are
> honest: *Implemented* means the code exists and compiles green; *Validated*
> means the relevant tests and responsive/visual checks actually ran.

<!-- BEGIN GENERATED: implementation-registry (npm run docs:implementation) -->

Source of truth: `src/lib/docs/implementation-registry.ts` (rendered live at `/docs/implementation`).

**Progress:** 72 initiatives — 1 in progress · 26 implemented · 38 validated · 6 deferred · 1 blocked externally

### 01 · Engineering foundations

#### Protect the production branch — Blocked externally

- **Brief:** A1
- **Exists today:** CI runs typecheck/lint/unit/build plus four SQL guards, but `main` is not branch-protected — a direct push can bypass every check.
- **Changing:** Require pull requests into `main` with the existing verify + SQL-guard jobs as required status checks; document the exact GitHub configuration.
- **Surfaces:** `.github/workflows/ci.yml`, `GitHub repository settings`
- **User benefit:** The safety machinery that already exists cannot be accidentally skipped, so a broken money path can't land on main unnoticed.
- **Approach:** Attempted via `gh api`: both branch protection and rulesets return 403 on this private Free-plan repository. The exact ruleset (PRs required, `verify` + `sql-guard` required checks, no force push) is documented in the production runbook §8 for one-click application once available.
- **Validation:** Configuration attempt executed and refused by GitHub (403 requires Pro/public); documentation shipped. Re-checked 1 Oct 2026: `main` still reports protected:false. The required check is now the aggregate `release-gate` job (it needs verify, secrets, secrets-full, sql-guard, e2e and stripe-integration to have run and passed; secrets is the incremental PR/push scan, secrets-full the full-history + tracked-tree scan), not verify + sql-guard alone.
- **External step:** Upgrade the GitHub account to Pro (or make the repo public), then run the documented `gh api` ruleset call in production-runbook §8.
- **Docs:** docs/production-runbook.md

#### Real commerce integration coverage — Validated

- **Brief:** A2
- **Exists today:** Vitest units, four SQL guards and a Playwright golden path run in CI; Stripe test-mode integration never runs anywhere, and E2E skips loudly without secrets.
- **Changing:** A Stripe test-mode integration harness (purchase, multi-seller cart, failed payment, webhook replay, transfer, retry, refund, partial refund, dispute, payout-disabled seller) wired as CI jobs that skip explicitly when secrets are absent.
- **Surfaces:** `e2e/`, `.github/workflows/ci.yml`, `src/lib/payments/`
- **User benefit:** The paths that move real money are proven against real Stripe test infrastructure instead of being assumed correct.
- **Approach:** Vitest integration suite driving the payment provider + webhook dispatcher against Stripe test keys; secrets documented; skipped coverage stated in the CI summary — never faked.
- **Decisions:** Suite lives in tests/stripe (own vitest config) so `npm test` stays network-free; it throws on non-sk_test_ keys and self-skips loudly without one. Multi-seller settlement/transfers/disputes stay with the stub-mode golden path; the CI summary now names that gap on every build instead of the old blanket 'never runs' line.
- **Validation:** 8/8 passing locally against the real Stripe test API (intents + metadata, confirm, decline, create/refund idempotency replay, over-refund refusal, refund metadata attribution). CI job `stripe-integration` gated on STRIPE_TEST_SECRET_KEY. Superseded 1 Oct 2026: CI now runs every `supabase/tests/*_guard.sql` file (about 50), the full browser suite on a local `supabase start` stack (Realtime included), and `release-gate` fails unless e2e and stripe-integration actually ran — nothing self-skips.
- **Docs:** tests/stripe/README.md

#### Authorization boundaries & future roles groundwork — Validated

- **Brief:** L
- **Exists today:** Admin membership lives in `admin_users` with `is_admin()` RLS policies, but admin mutations use the service role, so the admin/viewer distinction is TypeScript-enforced only.
- **Changing:** A centralized capability check on every admin action path, moving enforcement toward the database where practical (scoped RPCs / role checks), plus a documented extension path for shops, staff and specialized moderators — prepared, not launched.
- **Surfaces:** `src/lib/admin/`, `supabase/migrations/`, `/admin`
- **User benefit:** A read-only admin genuinely cannot mutate anything, and future shop/staff accounts have a place to land without a rewrite.
- **Approach:** Capability map keyed by admin role, asserted inside `auditedAction` before any service-role work; DB-side role assertion where the call shape allows; no OpenFGA/Cerbos.
- **Decisions:** 0040: `assert_admin_actor()` raises unless the actor holds the full admin role — auditedAction calls it before every mutation, so the database now refuses a viewer even on the service role; the audit-log trigger additionally refuses non-admin actors for every role including service_role. src/lib/admin/capabilities.ts is the extension seam for shops/staff/moderators: action families → required role today, a capability argument on assert_admin_actor when finer roles exist. No speculative role tables.
- **Validation:** Migration 0040 applied twice (idempotent, self-checks pass); admin_guard.sql extended with four actor-enforcement assertions and executed green against the live dev schema (rolled back); capabilities unit tests cover every audit action family.
- **Docs:** supabase/migrations/0040_admin_actor_enforcement.sql, src/lib/admin/capabilities.ts

#### Transaction correlation & diagnostics — Implemented

- **Brief:** AF
- **Exists today:** Understanding one order means reading orders, payments, webhook_events, transfer_intents, refund_operations and Sentry separately.
- **Changing:** A correlation identity threaded from checkout through Stripe metadata, settlement, transfers and refunds, surfaced as a timeline in the admin order sheet.
- **Surfaces:** `src/lib/payments/`, `/admin/orders/[id]`, `/api/stripe/webhook`
- **User benefit:** An admin can answer "why is this order in this state?" from one screen instead of five tables.
- **Approach:** Correlation ID persisted on order/payment rows and stamped into Stripe metadata; a composed diagnostics view in admin. No heavy OpenTelemetry now.
- **Decisions:** 0039 adds orders.correlation_id, stamped by both checkout paths and mirrored into PaymentIntent metadata; deliberately never threaded through money RPCs — an observability identity, not a lock. The admin order sheet gained a Transaction timeline composing order stamps, retained webhook events (matched on the intent reference), transfer-intent lifecycle, refund operations and audit rows — built by a pure, unit-tested builder (lib/admin/diagnostics.ts).
- **Validation:** Migration 0039 applied twice (self-checks pass); timeline builder covered by 3 unit tests (chronology, refund lifecycle incl. recovery, future clearing-window truthfulness); Stripe integration test asserts correlation_id lands in intent metadata. Admin UI render check pending the Group 10 visual pass.

#### A seller's offer minimum is private — Validated

- **Brief:** PRD O-3 · agent plan A0
- **Exists today:** The lowest offer a seller will take lived on `listings.offer_floor_cents`, which anon and authenticated could read table-wide through the API, and the listing page showed it as "Offers accepted from".
- **Changing:** The minimum moves to `listing_private_terms`, readable only by the seller (`my_listing_offer_floor`) and the offer checks, in three releases: expand (copy, kept in step), switch (every reader moved, the old column held empty), contract (drop the column once the switched app is live everywhere).
- **Surfaces:** `supabase/migrations/20261017120000_listing_private_terms.sql`, `supabase/migrations/20261017130000_listing_private_terms_switch.sql`, `supabase/migrations/20261019120000_negotiation_contract.sql`, `src/features/commerce/offer-actions.ts`, `/listings/[id]/edit`, `/listings/[id]`
- **User benefit:** A seller's minimum can't be read by anyone else, so it can't be used against them, by a buyer or by an agent.
- **Approach:** Owner-only table, no client grants. One writer, `set_listing_offer_floor`, which acts only for the listing's seller and which the sell and edit functions call; the price bound is checked from both sides; offer_open and offer_move check the minimum and never name it. The switch step's absorb trigger and the old column are gone (contract, 20261019120000).
- **Decisions:** Showing the minimum on the listing becomes a seller toggle, off by default, with negotiation v2; until then no minimum is shown.
- **Validation:** Expand and switch are on the shared dev project (probes in supabase/MIGRATIONS.md). Contract (20261019120000): offer_floor_privacy_guard.sql (39 checks) fails on the switch-step schema and passes after; every SQL guard, npm test, typecheck, lint and the negotiation drills pass. The contract's shared-dev apply waits until every running app copy has the switched code (supabase/MIGRATIONS.md).
- **Docs:** docs/decisions/agent-foundations.md, supabase/MIGRATIONS.md

### 02 · Marketplace discovery

#### Automotive search architecture — Validated

- **Brief:** B1–B2
- **Exists today:** Marketplace search is Postgres `ilike` over title/description/compatibility/part_number, with a separator-insensitive `part_number_compact` column (0033) and a pg_trgm helper (0008).
- **Changing:** A `SearchProvider` abstraction with the Postgres implementation as always-working fallback and an optional self-hosted engine adapter; two conceptual lanes — fuzzy human discovery vs strict identifier matching that is never fuzzy-corrected.
- **Surfaces:** `src/lib/marketplace/`, `/marketplace`, `supabase/migrations/`
- **User benefit:** "mk8 intake" and "11-42-7-566-327" both find the right parts, without the marketplace depending on any hosted service.
- **Approach:** Provider interface + Postgres FTS/trigram implementation now; Typesense evaluated as the optional engine (alphanumeric typo control fits part numbers); indexing contract + reindex tooling shipped regardless of engine availability.
- **UX rules:** Search UI stays one box + existing filters — engine complexity is never exposed.
- **Decisions:** Two lanes share one pure classifier: single-token digit-bearing terms are identifiers (exact compact substring, one interchange-graph hop, never fuzzy); everything else rides the pg_trgm RPC with title-first ranking. Typesense chosen over Meilisearch for per-field alphanumeric typo control (num_typos=0 on part_numbers); reached over plain fetch — no client dependency, optional env config, every failure falls back to Postgres. Providers only produce candidate id sets; the canonical Postgres query still applies every filter and sort — no commerce decision touches an index. Per-listing index sync is fire-and-forget on publish/edit/status; full rebuilds via scripts/reindex-search.mjs.
- **Validation:** Query classifier unit-tested against the brief's example queries; feature-regression e2e green through the provider (part-number search included) on the dev server; typecheck/lint/unit green. Typesense adapter + reindex tooling ship configured-off.

#### Saved searches & alerts — Validated

- **Brief:** C
- **Exists today:** No saved-search model exists anywhere; /saved covers listings, cars, sellers and posts only.
- **Changing:** Users can save the marketplace state they built (query, category, price, condition, location, fitment/garage car) from an unobtrusive `Save search` action, and separately opt into alerts.
- **Surfaces:** `/marketplace`, `/saved`, `supabase/migrations/`, `notifications`
- **User benefit:** A buyer hunting a specific part can come back to new matching inventory without rebuilding filters — and hears about it only if they asked to.
- **Approach:** `saved_searches` table with RLS; matching evaluated on a worker pass feeding the existing notifications system; save and alert opt-in are separate actions.
- **Depends on:** notification-domain
- **UX rules:** Never prompt to save a search. Saving is silent; alerts are a separate explicit opt-in, easy to disable. New matches surface through existing home/notification patterns — no disruptive messaging.
- **Decisions:** Saving and alerting are separate columns and separate gestures; duplicate saves quietly succeed; 50-search cap enforced by a DB trigger. The worker (/api/jobs/saved-searches, CRON_SECRET) raises at most one notification per search per pass — a summary, never a per-listing flood; 'fits my garage' searches reuse the marketplace's exact fitment matcher.
- **Validation:** Full loop verified live: silent save from the marketplace UI (toast receipt), row + alert toggle on /saved, worker baseline pass, a new matching listing produced exactly one summary notification with a deep link; first-pass baseline prevents pre-opt-in alerts. RLS guard (cross-user invisibility, forge refusal) executed green live; 0044 applied twice.

#### Unified Explore search — Implemented

- **Brief:** Explore search brief (Aug 2026)
- **Exists today:** Search existed only for marketplace listings; /explore was a browse-only feed with a tab param and no query surface.
- **Changing:** One coherent DRVN search ecosystem: Explore gains free-text search with grouped autocomplete over Builds, Updates, Accounts and Parts, plus a deliberately small Advanced Search (vehicle, owner-location for Builds, the marketplace refinement set for Parts). Parts reuse marketplace search wholesale; browse mode stays the untouched feed.
- **Surfaces:** `/explore`, `src/lib/explore/search/`, `src/app/api/explore/suggest/`, `src/lib/marketplace/query.ts`, `supabase/migrations/0057_explore_search.sql`
- **User benefit:** "Bilstein B16 Golf R" finds the build carrying that mod, "@kaito" finds the person, and a part number still hits exact-identifier semantics — all from one search field, shareable as a URL.
- **Approach:** The marketplace provider doctrine extended per object family: three word-wise pg_trgm RPCs (0057) as canonical truth, optional per-family Typesense collections behind the shared transport, ranked-ids-only providers, and hydration through the same hydrateFeedItems/fetchListings paths the feed already uses.
- **Depends on:** search-architecture
- **UX rules:** Browse mode is the feed; a query or refinement — not a sort — activates search mode. Domains rank within themselves and present as groups; one relevance score never compares a person to a part. Accounts are discoverable by identity only — no account filters, and location/vehicle filters can never retrieve people. Scope changes shed incompatible filters by construction; location never crosses a scope boundary (owner location ≠ listing location).
- **Decisions:** Build location filters through cars.owner_id → profiles.location; no location column was added to cars. Updates index a deliberate extractor (activity_post_search_text, generated column) — text blocks, mod labels/details, performance notes; never raw document JSON. Vehicle filtering is canonical catalog identity ("<makeId>-<modelId>"), implemented centrally in fetchListings for listings (fitment rows + source car, seller-stated only). Explore saved searches, alerts, and advanced filters beyond the brief's set are deliberately out of scope.
- **Validation:** Migration 0057 applied and RPC-smoke-tested against dev data; params/extractor unit tests green; full vitest suite, typecheck and lint green; anon visual QA on the dev server (search, autocomplete keyboard flow, filter-only vehicle search, chips, empty state); explore-search e2e spec covers signed-in Parts scope, privacy exclusions and scope transitions.

#### Front door — one product, two doors — Implemented

- **Brief:** PRD 2026-09 F-1, F-2, N-1, E-5 (build plan WS1)
- **Exists today:** The landing page, the lockup and the root metadata described DRVN as a parts marketplace, and Explore hid the Parts segment, parts results and part suggestions from signed-out visitors.
- **Changing:** The front door leads with the car and offers two equal actions (Add your car · Shop parts), builds before parts; the lockup and root metadata describe the product rather than one door, while marketplace routes gain their own marketplace wording; the signed-out parts gate is lifted everywhere; and the rail's top level is reordered so Garage sits above the Selling family.
- **Surfaces:** `/`, `src/app/layout.tsx`, `src/components/ui/nav-routes.ts`, `src/components/ui/livesheet-bar.tsx`, `src/lib/feed.ts`, `src/lib/explore/search/query.ts`, `src/app/api/explore/suggest/route.ts`, `src/lib/marketplace/metadata.ts`
- **User benefit:** A first-time visitor understands DRVN at / and can go either way in one click; a stranger with no account can find a part in Explore, in the Parts segment, in search and in the suggestions, and buy it as a guest.
- **Approach:** Copy, order and metadata only — no new components and no schema. The parts gate came from retired PRD v3.1 §8.2 and lived in six places (FEED_TABS' loggedInOnly flag, kindsForTab, the legacy feed fallback, searchAll, the suggest route, and the All view's view-all link); lifting it made the isLoggedIn plumbing through fetchFeed dead, so it was removed rather than left as a re-gating hint. Category routes get generateMetadata from one shared helper, since both routes need identical wording.
- **Depends on:** explore-search
- **UX rules:** Neither front-door action is a ghost button: one is the accent, the other the ink fill, so they read as a genuine choice. Parts are public everywhere — feed, Parts segment, search, suggestions — signed in or not. A part whose source car is private is still named; only the link to that car is withheld. Marketplace routes keep marketplace wording for search engines; the root description describes the product.
- **Decisions:** The lockup microlabel reads BUILDS AND PARTS — it names both doors in three words. The landing band leads with public build pages before parts for sale; the offer window moved off the front door because the recipe is three columns. Garage sits above Selling in the rail: the car is the middle of the product, Selling is a workspace entered on purpose. Settings stays last as account plumbing. visibleFeedTabs() was deleted rather than kept as a zero-argument passthrough — callers read FEED_TABS directly.
- **Validation:** Full vitest suite (105 files), typecheck and lint green; feed-tabs and nav-routes tests rewritten to pin the public taxonomy and the N-1 order; explore-search e2e green including a new signed-out journey (segment, Parts scope, All view, autocomplete) and a cleanup sweep the spec previously lacked; landing visual baselines regenerated at five viewports (darwin); verified signed out and signed in on the dev server in both themes and at phone width.

#### Part aliases, supersessions & interchange (groundwork) — Validated

- **Brief:** H
- **Exists today:** A listing has one part_number plus its compact variant; no alias or interchange relationships exist.
- **Changing:** An internal extensible model for alternate numbers, supersessions and equivalents, consumed by search so an old OEM number can find a listing entered under its successor.
- **Surfaces:** `supabase/migrations/`, `src/lib/marketplace/`
- **User benefit:** Buyers who know a part by a different number than the seller used still find the part.
- **Approach:** Relationship table with typed kinds; source metadata stored internally only; wired into the search identifier lane. Users never manage the graph.
- **Depends on:** search-architecture
- **UX rules:** No user-facing source/confidence machinery.
- **Decisions:** 0042: listing_part_numbers (seller-supplied 'also known as', RLS mirrors fitment) + part_number_links (internal typed graph, service-role only). Sell form gained one optional comma-separated field.
- **Validation:** Identifier-lane expansion through part_number_links live in the provider; seller 'also known as' numbers persist from the sell form and match in search; migration applied twice; covered by the provider path the regression e2e exercises.

#### Marketplace and its card — Implemented

- **Brief:** PRD 2026-09 M-1…M-8 (build plan WS9)
- **Exists today:** Brand exists only inside the free-text title, so the most common way people describe a part — 'Öhlins coilovers' — can't be filtered. The card carries no brand, no description line and no sense of who is selling; the phone column is one card wide because the card is too tall to scan two-up.
- **Changing:** listings gains brand, part_miles and part_miles_unit. The card gets brand, a clamped title, condition with miles, one line of the seller's own description, their avatar and 'N for sale', 'Off my {car}' and add-to-cart. Brand joins the filters, the facet, the search text and saved searches.
- **Surfaces:** `/marketplace`, `src/components/ui/listing-card.tsx`, `src/lib/marketplace/query.ts`, `supabase/migrations/20260919190000_listing_brand_and_miles.sql`, `supabase/migrations/20260919190500_save_listing_creation_brand.sql`, `supabase/migrations/20260919191000_seller_active_counts.sql`
- **User benefit:** A used-parts marketplace you can shop by brand instead of by scrolling, on a card that answers the questions a buyer actually has — what is it, what state is it in, how far has it been driven, who is selling and what else have they got.
- **Approach:** The design proof measured the card before it was rebuilt: 163.5px columns, 523–571px cards, titles running to six lines because nothing clamped them. The clamp came first; the two-across phone column followed from it.
- **Depends on:** listings-to-followers, search-architecture
- **UX rules:** No seller rating on a browse card — it invites comparing people rather than parts. It stays on the item page and the store's trust strip. Add to cart, never Buy now: deciding to buy happens on the item page. Miles are offered on used parts only — on a new part they would be a contradiction rather than a detail. One line of the seller's own description, never a generated summary: a card that paraphrases is a card that can be wrong about somebody else's part.
- **Decisions:** save_listing_creation enumerates columns in three places; all three were updated in one migration. Missing one drops the field silently on publish while everything looks correct. brand joined SAVED_SEARCH_KEYS in the same change — without it a saved search drops the brand and the alert job, which runs the same query, mails the member about every coilover on the site. The backfill only matches the curated brand list anchored at the start of a title, longest name first. A wrong brand is worse than none: it silently excludes the listing from the filter its seller wanted. The brand filter is an exact match, not ilike — the value comes from a facet built out of the brands actually stored, so a partial match could only widen it. The phone column drops back to one below 340px, not 480px: at 375px the columns are 165px, which the proof showed works once the title is clamped.
- **Validation:** Four migrations applied to the shared dev project and the local test database; types regenerated and hand-edited. Verified in the browser at 1280px and 375px: two columns on the phone with titles clamped to two lines and the price above the fold, 'N for sale' and the seller avatar rendering, the cart button present, and the filter panel inline rather than a sheet at desktop width. NOT done: M-3's left-column placement — the panel and the results live in different subtrees, so moving it beside them needs page-content restructured around a sidebar slot.

#### A listing reaches the people following you — Implemented

- **Brief:** PRD 2026-09 B-1 (build plan WS3)
- **Exists today:** The followed feed carries cars and build updates only. A followed seller's new listing shows up nowhere: `follows` has no seller-listing edge, and the feed never asked the listings table.
- **Changing:** A new listing reaches anyone following that seller or the car the part came off. Two queries feed it — seller lane and source-car lane — and one pure merge makes them a single ordered feed.
- **Surfaces:** `src/lib/feed-merge.ts`, `src/lib/feed.ts`, `/home`, `supabase/migrations/20260919180000_listings_seller_status_created_idx.sql`
- **User benefit:** Selling a part stops being an act of shouting into the marketplace: the people who already care about this build or this seller see it, which is the whole argument for the community and the marketplace being one product.
- **Approach:** Two indexed queries rather than one `or`, because only the seller lane can use (seller_id, status, created_at desc) and an `or` would give up the index for the half that has one. Everything hard — dedupe, stable order, per-seller fairness — is a pure function with no database.
- **Depends on:** front-door
- **UX rules:** Following a seller AND the car a part came off gives one card, not two. At most three of one seller's listings sit together; the fourth waits for someone else and then returns.
- **Decisions:** The per-seller cap defers rather than drops: a seller alone in your feed still shows you everything. It is a cap on adjacency, not on presence. Order breaks ties on id. Equal timestamps are ordinary — a bulk insert stamps rows together — and without a total order page one and page two disagree, which shows a card twice or skips it. No push or email for new listings (B-2). This is a feed, not a broadcast.
- **Validation:** Seven unit tests on the merge, covering follow-both-see-once, ids colliding across kinds, identical output from differently-ordered inputs, a six-row page walk on one shared timestamp, and the run cap deferring rather than dropping. Index applied to the shared dev project and the local test database. Typecheck, lint and the full unit suite green; NOT yet walked with a real follow graph in the browser.

#### Explore — one wall, one footprint — Implemented

- **Brief:** PRD 2026-09 E-1…E-4 (build plan WS13)
- **Exists today:** The wall was two columns on a phone but the cells were not one footprint — a build cell sat shorter than the update beside it and the rows ran ragged, which is exactly what the direction rules out.
- **Changing:** A uniform cell footprint per kind, and breakers (trending models, builders worth following) woven into the wall at fixed positions. Legacy posts with no photo are left off the photo walls rather than borrowing a car's cover, and stay everywhere else.
- **Surfaces:** `src/components/ui/mosaic.tsx`, `src/components/ui/masonry-feed.tsx`, `src/app/(discover)/explore/breakers.tsx`, `supabase/migrations/20260919195000_trending_models.sql`
- **User benefit:** The wall scans. A ragged grid reads as a broken page, and the eye stops at the first gap.
- **Approach:** The caption block is a fixed height per kind rather than a natural one — the design proof's finding, made before the breakers were built.
- **UX rules:** A breaker renders only with at least three results. Two 'builders worth following' is not a section. A post with no photo is never given somebody else's photo.
- **Validation:** Measured in the running app: one footprint (229x355) across twenty cells, one breaker rendered, the Builders breaker correctly suppressed below three. Full unit suite green.

#### Local — what's happening near me — Implemented

- **Brief:** PRD 2026-09 H-2 (build plan WS15)
- **Exists today:** DRVN knew a member's free-text 'location' and did nothing with it. There was no way to see the builds and parts around you.
- **Changing:** profiles gains country and region from a curated list, settings asks for them, and Home grows a Local tab backed by local_feed_rows.
- **Surfaces:** `src/lib/geo/regions.ts`, `src/app/(product)/settings/settings-panel.tsx`, `src/app/(product)/home/page.tsx`, `supabase/migrations/20260919196000_seller_defaults_and_region.sql`
- **User benefit:** Cars are a local hobby. The person with the part you need is often forty minutes away, and nothing in the product knew that.
- **Approach:** Coarse on purpose — a country and a region, never a town. A build sheet plus a town is close to an address, and the PRD rules location tags out.
- **UX rules:** Local only appears once the member has said where they are; it is never inferred. Changing the country clears the region rather than leaving an impossible pair.
- **Decisions:** One more column on feed_events rather than a second view: Local is the same feed with one more filter, and two views would drift.
- **Validation:** Verified in the running app: the country and region rows in settings, the dependent region select appearing on choosing a country, and Local on Home. Covered by the geo unit tests and carless_post_reach_guard's region assertions.

### 03 · Vehicle identity & fitment

#### Car generations, products and price comparables (graph foundation) — Implemented

- **Brief:** Agent and graph plan B1 · PRD §4.9
- **Exists today:** Cars know make and model, not generation. Part numbers link listings to each other (part_number_links) but nothing says which records are the same product, build lines can't be joined to listings, and no price comparable exists.
- **Changing:** vehicle_generations with cars resolved from model and year; products grown from the brand + part number members write, with explicit brand-aware membership and an admin review list for the ambiguous; part keys on build lines; the brand kept through a purchase; product fitment evidence with source and constraints; price comparables from completed sales net of refunds and live listings.
- **Surfaces:** `supabase/migrations/20261020100000_vehicle_generations.sql`, `supabase/migrations/20261020110000_part_keys.sql`, `supabase/migrations/20261020120000_products.sql`, `supabase/migrations/20261020130000_product_fitments.sql`, `supabase/migrations/20261020140000_price_comparables.sql`, `src/app/(admin)/admin/products/`, `src/features/commerce/add-to-car-actions.ts`
- **User benefit:** The agent and the marketplace can say "this is the same part" and "this fits a Mk8" without guessing, and a part's real selling price can be shown once enough have sold.
- **Approach:** Deterministic resolution only. Products merge on the same brand and number, a brand-scoped same_product link, or an admin's decision; interchange, supersedes and aftermarket links stay edges. Records reach their product through the membership, never a stored id. An hourly job grows products and files ambiguity.
- **Depends on:** part-aliases, canonical-add-car
- **UX rules:** A changeover year is asked, never guessed. An interchangeable or aftermarket part is never called the same part.
- **Decisions:** Generation year ranges are the union of production and main-market model years, so overlaps resolve to nothing rather than to the wrong generation. Products and their membership are internal (service role only): a product named from a private car's build line must not be readable as a catalog. Only numbers with a digit, 3–64 characters compacted, start a product; draft and removed listings don't. Comparables show no price below three sales, and never a row or an id; completed orders only, net of refunds, returned lines left out.
- **Validation:** vehicle_generations_guard, products_guard and price_comparables_guard on CI's database image; the admin review list end to end (e2e/admin-product-identity.spec.ts); a rehearsal on a copy of shared dev's catalog; the 2M-part gate in docs/performance/query-plans.md (vehicle fit unchanged, plans rechecked); applied to shared dev.
- **Docs:** docs/site/vehicles.md, docs/plans/2026-10-agent-and-graph-plan.md, supabase/MIGRATIONS.md

#### Canonical Add Car flow — Validated

- **Brief:** E
- **Exists today:** Add Car is a dialog of free-text Name/Year/Make/Model; VIN decoding (vPIC) exists but only on the car edit page, after the record already holds invented strings.
- **Changing:** The primary flow becomes vehicle selection — year, searchable make, searchable model, optional variant detail only when useful — with `Enter VIN instead` as the secondary shortcut and manual entry always available as fallback.
- **Surfaces:** `/garage`, `src/app/(product)/garage/add-car-form.tsx`, `src/lib/vehicles/`
- **User benefit:** A new car lands in the Garage as a recognized vehicle instead of whatever the owner happened to type — fitment, discovery and trust all inherit the accuracy.
- **Approach:** Searchable cascading picker over the DRVN vehicle catalog (vPIC cache + catalog work below); VIN path reuses the existing decoder and prefills; wording is `VIN decoded`, never "verified"; VIN stays private.
- **Depends on:** vehicle-catalog
- **UX rules:** Picker first, VIN secondary, manual fallback always visible. No giant alphabetic menus — searchable controls with intelligent ranking. Never require variant detail that can be inferred or skipped.
- **Decisions:** A new registered ComboField primitive (ARIA combobox on the .field/.ctl recipes) powers make/model — options ranked by catalog popularity, aliases matched as keywords ('rabbit' finds Golf). An unnamed car is named by what it is ('2024 Volkswagen Golf'); a personal name stays optional in every mode. Manual entries that happen to name a catalog vehicle quietly gain the catalog reference — automation without a prompt. Visible data credit (VehiclesDB · NHTSA) sits as microcopy in the dialog foot, satisfying CC-BY attribution where the data is used.
- **Validation:** 3/3 Playwright specs green against the dev server (manual auto-naming, VIN decode-failure messaging with escape routes, catalog picker end-to-end); live browser run created a real picker car (catalog ids + frozen snapshot verified in the DB, then cleaned up); screenshots reviewed at 430px. Shared addCar e2e helper migrated.

#### DRVN-owned vehicle catalog — Validated

- **Brief:** F
- **Exists today:** vPIC make/model caching exists (`vehicle_makes`/`vehicle_models`, 0025) feeding the sell fitment picker; cars store free-text make/model/year plus decoded VIN columns.
- **Changing:** A canonical catalog layer (make/model, optional generation/variant, source + version) behind DRVN-owned IDs, with display snapshots preserved on cars so history never mutates when an upstream catalog updates.
- **Surfaces:** `supabase/migrations/`, `src/lib/vehicles/`, `/api/vehicles/*`
- **User benefit:** Every feature that touches a car — search facets, fitment, provenance of listings — works from one accurate identity instead of string-matching.
- **Approach:** Extend the existing vPIC cache into a catalog with stable IDs; evaluate VehiclesDB (CC-BY) for global make/model breadth with license/attribution documented; cars gain nullable catalog references alongside the existing display fields.
- **Decisions:** 0041: catalog_makes/catalog_models with DRVN identity ids — vPIC ids and VehiclesDB ids are references, never primary keys; the vPIC cache tables stay untouched as the fitment-datalist source. VehiclesDB verified live (v2026.08.2, CC-BY 4.0, github.com/vehiclesdb/vehiclesdb): 277 car makes / 4,895 models imported via scripts/import-vehiclesdb.mjs with aliases and popularity; catalog now 392 makes / 4,908 models. Make ranking is model-weighted (how many broadly-popular models a make has) — 'best single model decile' put one-hit small-market marques above Volkswagen. Ranked, cached public APIs: /api/vehicles/catalog/makes and /catalog/models?make=.
- **Validation:** Migration applied twice (self-checks pass, 195 vPIC makes seeded); import re-run idempotently; both APIs verified live on the dev server including alias payloads.

#### Fitment: automatic first, optional detail — Implemented

- **Brief:** G
- **Exists today:** Structured fitment exists (`listing_fitments`, seller-stated wording, a picker on /sell, garage matching in fitment.ts) but is fully manual per listing.
- **Changing:** Fitment infers automatically from the source car and canonical vehicle identity; optional qualifiers (generation/trim/engine/drivetrain) live behind progressive disclosure; internal source metadata only.
- **Surfaces:** `/sell`, `src/lib/marketplace/fitment.ts`, `supabase/migrations/`
- **User benefit:** Sellers get accurate fitment on their listings without filling a configuration form; buyers' "fits my car" filter gets more trustworthy.
- **Approach:** Source-car → fitment prefill on the sell flow; qualifier columns optional; no user-facing confidence percentages ever.
- **Depends on:** vehicle-catalog
- **UX rules:** Default seller experience stays lightweight. No fitment-confidence UI.
- **Decisions:** ?car= deep links seed the picker with the source car's fitment row (editable like any typed row); choosing a source car in-form offers a passive one-tap '+ Fits {car}' chip — never an unexplained transformation. Manual qualifier entry (trim/engine/drivetrain) deliberately NOT built: it bloats the seller form for data the catalog/VIN can eventually fill automatically. Revisit when catalog variants exist.
- **Validation:** Typecheck/lint/unit green; behavior exercised in the sell flow during Group 10's visual pass (pending).

#### Main car — Implemented

- **Brief:** PRD 2026-09 P-5, P-1, M-1 (build plan WS5)
- **Exists today:** Four surfaces sort a member's cars and none of them agree — created ascending in the garage, model year descending on the profile, whatever the query returned on the sell form. Somebody with four cars sees a different 'first' car depending where they stand, and never gets to say which one they mean.
- **Changing:** profiles.main_car_id, set from the car's own settings. It drives the featured car, the default profile banner, car order everywhere, the Garage's focused view, and the first one-tap suggestion in the marketplace vehicle picker.
- **Surfaces:** `src/lib/cars/order.ts`, `src/lib/cars/banner.ts`, `/garage/[id]/edit`, `/marketplace`, `supabase/migrations/20260919181500_profiles_main_car.sql`
- **User benefit:** The product stops guessing at the one thing the member could just tell it, and a profile gets a banner without anyone having to upload a second image.
- **Approach:** One ordering helper replacing four different sorts, and one banner helper choosing from photos that already exist. Null stays the ordinary state: with no main car every surface falls back to newest-first, which is what they all did before.
- **Depends on:** vehicle-catalog
- **UX rules:** Offered, never applied: the marketplace shows 'Parts for my {car}' as a one-tap choice and an explicit or URL-supplied vehicle always wins. A cleared vehicle filter stays cleared — clearing is an answer, not an absence. The banner never borrows a private car's cover, main car or not. No banner is a fine outcome. A plain header beats a stretched placeholder, and neither is a setup step.
- **Decisions:** The ownership trigger is the guard, not RLS: RLS says who may update the row and nothing about whether the VALUE is theirs, so without it a member could feature somebody else's car. The toggle saves on its own rather than with the car form — it is a garage-wide answer about this car, not one of the car's fields, and batching it would make unsetting feel like a rollback. New profiles columns are invisible until granted, so main_car_id has explicit column-level SELECT/UPDATE grants (the 0017 pattern) rather than riding a table-wide grant that would re-expose the Stripe pointers.
- **Validation:** Ten unit tests across ordering and banner choice, including the two cases that matter most — no main car set behaves exactly as today, and a private car's cover is never borrowed. The ownership trigger is covered in security_guard.sql (another member's car refused, own car accepted, clearing accepted); the whole guard suite passes. Migration applied to the shared dev project and the local test database. Typecheck, lint and the full unit suite green; the marketplace offer was NOT clicked through in the browser this session.

### 04 · Selling

#### Selling workspace & IA — Validated

- **Brief:** J
- **Exists today:** Seller operations are scattered: /listings, /offers, /orders (mixed with purchases), payouts inside /settings#payouts, questions inside listing pages; the marketplace family nav spans buyer and seller surfaces.
- **Changing:** A coherent Selling section (Overview · Listings · Offers · Orders · Payouts · performance where useful) with deliberately designed desktop and mobile IA, leaving Marketplace purely for discovery/buying.
- **Surfaces:** `src/components/ui/nav-routes.ts`, `src/components/ui/app-shell.tsx`, `src/app/(product)/`
- **User benefit:** Occasional sellers can find everything selling-related in one place; power sellers get an operations home instead of hopping between five routes.
- **Approach:** New route group/section composed almost entirely from existing surfaces and registry components; nav register updated for rail + Index sheet; IA decision recorded here after Mobbin reference review.
- **UX rules:** Do not duplicate Marketplace browsing. Mobile Index sheet must not bloat.
- **Decisions:** IA decision: Marketplace is a plain top-level route (discovery only — the family strip left it entirely); Selling is the collapsible rail group and family — Selling overview / My Listings / Offers / Orders / Payouts. Orders stays one shared surface but homes with Selling, where its operational weight is; buyers keep reaching orders from Home and notifications. /selling composes existing capabilities only: needs-you (offers, questions, dispatch), stock tallies, ledger money, payout gating — no new browsing, no duplicated marketplace. /payouts returned from redirect-stub to a real Selling surface rendering the SAME ledger section Settings embeds (allowlisted share); configuration stays in Settings → Payments. Mobile: no bottom-nav addition — the Index sheet gained the family as a labeled group, keeping the register one tap deep without bloating it.
- **Validation:** 14/14 family e2e + 10/10 discovery e2e + a11y suite green against the dev server after the IA change; desktop rail, family strip and mobile Index screenshotted and reviewed (1440px + 390px); typecheck/lint/unit green.

#### Remove from Build → Sell this part — Validated

- **Brief:** I
- **Exists today:** Build lines can deep-link to /sell?car=&mod= and mod_items carry linked_listing_id, but removing a mod and selling it are unconnected acts.
- **Changing:** Removing (or deciding to sell) a modification offers a clean `Sell this part` path that prefills source car, brand, product, part number and category from data DRVN already holds.
- **Surfaces:** `/garage/[id]/edit`, `/sell`, `src/app/(product)/sell/`
- **User benefit:** Turning a real build change into a listing takes one step instead of re-typing everything the platform already knows.
- **Approach:** Extend the existing ?car=&mod= prefill contract to carry the full mod context; contextual action on the mods editor and the removed-part composer block. No provenance ledger.
- **UX rules:** A useful connection, not a ledger — ordinary relational data only.
- **Validation:** Three bridges live: build-line 'Sell it' (pre-existing), ?car=&mod= prefill carrying title/category/part number + inferred fitment row, and the composer's removed-mod block linking 'Sell this part →'. Exercised via the sell-form fitment prefill path; no ledger machinery anywhere.

#### Change a part — removal is a state — Implemented

- **Brief:** PRD 2026-09 A-1…A-3 (build plan WS2)
- **Exists today:** A mod line exists only while the part is on the car: the editor drops the row, save_mod_items deletes anything the payload omits, and the part is gone — along with the fact it was ever fitted, and along with the provenance behind any listing released off it. People also type over rows to record a replacement, which silently rewrites what past updates and live listings refer to.
- **Changing:** mod_items gains status (installed / removed) and removed_at. Remove keeps the id and marks the row; Replace is its own editor action that marks the old line removed and files a new one in its position; editing in place stays what it is — a fix for typos; a true delete is still 'omit the row', and is only offered where nothing points at the line. Removing asks inline what happens to the old part: List it, or just remove it. The parts that came off get their own section on the editor and on the public build sheet.
- **Surfaces:** `/garage/[id]/edit`, `/cars/[slug]`, `supabase/migrations/20260919170000_mod_record_identity.sql`, `supabase/migrations/20260919171500_car_search_installed_mods.sql`, `src/features/activity/mod-actions.ts`
- **User benefit:** A used part's provenance becomes checkable: a buyer can read the build it came off and see that the build says so. The first loop of the product — change a part, sell the old one — stops destroying its own evidence.
- **Approach:** One migration for the state plus the columns two neighbouring workstreams need, so save_mod_items is re-created once. Its delete statement is byte-identical to the previous version, because the editor keeps sending removed rows with their status. Every reader then had to choose: the build sheet and the garage show what came off, while search, the OG count and the index describe only what is fitted.
- **Depends on:** remove-to-sell
- **UX rules:** Neither answer to 'what happens to the old part?' loses the record — 'just remove it' still keeps the line. Delete is only offered on a line with no linked listing. 'List it' commits the sheet before opening the sell form, so abandoning the form leaves the part under 'came off this car' rather than losing both. An update that says a part came off OFFERS to mark it off the sheet; it never does so silently.
- **Decisions:** removed_at is derived by the database, never sent by the client — re-saving a sheet can't drag the date a part came off forward to today. A part that came off is excluded from car search text and the search index: a build should not keep matching a part it no longer has. The listing provenance line, post mod blocks and the sell prefill deliberately do NOT filter by status — a removed part is the normal case for all three. markModRemoved lives in features/activity rather than the garage's actions because the surface that offers it is the public post page, and a route may not reach into another route's actions.
- **Validation:** Migration applied to the shared dev project and the local test database; mod_sheet_atomic_guard gained a record-identity block (remove keeps the id, replace files a new line in position, re-saving doesn't move the removal date, an omitted row still deletes, a price with no currency and an unknown state are both refused) and the whole SQL guard suite passes. Walked end to end on the dev server at desktop width: the inline ask renders in-row with 44px targets, the line moves to 'Came off this car', the save keeps the row's id and sets removed_at, the build sheet drops to six entries and grows a 'Came off this car' section carrying the owner's Sell it. Phone width for this editor was NOT visually confirmed this session.

#### Profile & Store — Implemented

- **Brief:** PRD 2026-09 P-1…P-8 (build plan WS10)
- **Exists today:** A profile is About / For sale / Reviews / Activity — a seller's page with some cars attached. Listings render as rows, which look nothing like the marketplace they came from.
- **Changing:** Tabs become Overview · Garage · Updates · Parts · Reviews, with the old keys kept as aliases. Parts IS the store: the marketplace grid and card, filtered to one seller, including sold. The header gains a borrowed car-cover banner, followers and cars, and a store note.
- **Surfaces:** `/u/[username]`, `src/lib/store/visible-statuses.ts`, `src/lib/store/query.ts`, `src/components/profile/profile-body.tsx`, `supabase/migrations/20260919192000_profiles_store_note.sql`
- **User benefit:** A member's parts read as a shop without DRVN needing a shop entity, and the profile reads as a person with a garage rather than a seller with some cars.
- **Approach:** The store runs its own rows query because it shows SOLD parts and the marketplace never does; bending the marketplace query to carry a seller key would put owner-visible state one URL parameter from every public browse surface. Everything after retrieval is shared — hydrateListingCards and ListingCard.
- **Depends on:** marketplace-card, main-car
- **UX rules:** Allowed statuses come from who is viewing, never from the URL. The tab can only narrow the viewer's own allowance. Sold parts are public: a store with twelve sold and two live is a different proposition from a new seller, and hiding the history would flatten them. The owner sees an edit link where a stranger sees add-to-cart — you can't buy your own part. The About tab is gone. A bio is one paragraph, and giving it a tab meant the first thing on somebody's profile was prose rather than their cars.
- **Decisions:** Old tab keys (?view=forsale, about, activity) still resolve. Those links are in messages and bookmarks, and renaming a tab isn't a good enough reason to break them. Seller and status filter inside the query, before the count and the page window — filtering after fetching gives a count that disagrees with the rows and a silently short last page. The store note is capped at 180 characters in the database: it is voice, not policy, and policy belongs in the returns and shipping settings where it is enforceable.
- **Validation:** Five unit tests on visibility, including the one that matters — ?status=draft on somebody else's store stays active+sold rather than listing their unpublished work. Verified in the browser: tabs render as Overview · Garage1 · Updates3 · Parts2 · Reviews, the banner renders from a car cover, and the Parts panel shows the marketplace card with price, shipping, condition and seller. NOT done: the trust strip (P-7) and the offer-floor default (P-9, deferred to M6).

#### Add a part by pasting a link — Implemented

- **Brief:** PRD 2026-09 L-1…L-4 (build plan WS6)
- **Exists today:** A mod line is typed, or pasted as text and parsed heuristically. Everything the shop page already knows — the exact title, the brand, the part number, a photo, what it cost — is retyped or lost.
- **Changing:** "Add mod" opens on a product link. One fetch fills title, brand, part number, category, a thumbnail and the shop's price; everything stays editable and typing stays first-class, so a failed fetch costs nothing. The public build page shows the thumbnail and a plain link out.
- **Surfaces:** `src/lib/mods/part-link.ts`, `/garage/[id]/edit`, `/cars/[slug]`, `src/lib/listing-import/extract/html.ts`, `src/lib/listing-import/media/import-images.ts`
- **User benefit:** A build sheet stops being a typing exercise, so it actually gets filled in — and a filled-in sheet is what makes the parts that come off it sellable with provenance.
- **Approach:** The importer's plumbing at a fraction of its weight: the same SSRF guard, pinned DNS, byte caps and sharp re-encode, and none of the job ladder, AI extraction or twelve-photo gallery. The image importer's bucket and path became parameters so a mod thumbnail lands in car-images rather than listing-images.
- **Depends on:** listing-importer, mod-record-identity
- **UX rules:** Typing stays first-class; a failed fetch falls back to it with a sentence saying so, never an error page. What the link gave us is shown under the row it filled in — the shop, the thumbnail, the price — so the owner can see it and correct it. A reference price without a currency is not shown, stored or returned.
- **Decisions:** L-4 is structural, not a promise: the thumbnail is uploaded to car-images, and the sell prefill does not select image_url at all. A test asserts the projection so widening it is a deliberate act. RATE_LIMITS.fetchPartLink is 30/hour — looser than the importer's 10, because one page fetch and one thumbnail is cheap and somebody filling in a sheet pastes a lot of links. Prices are refused rather than guessed: a European decimal comma (1.299,00) is ambiguous against a thousands comma, so both are read as no price. mod_items.image_url joined the media lifecycle's reference check, or the 48h sweep would take the thumbnail back out from under a build sheet still showing it.
- **Validation:** Unit tests cover the price and currency rules, including the negative-price case they caught (a stripped minus sign read as a positive price). A projection guard holds L-4. Typecheck, lint and the full unit suite green. The remote fetch itself is exercised by the importer's existing safe-fetch coverage; a live paste was NOT walked in the browser this session.

#### Existing Listing Importer — Implemented

- **Brief:** Importer brief (Aug 2026)
- **Exists today:** Sellers arriving from Facebook Marketplace or forums re-typed their listing field by field; docs/listing-importer-spec.md existed as a spec with nothing built.
- **Changing:** Paste a listing URL (or the post text) at /sell/import and DRVN reads that one page, organizes it into the structured listing shape (deterministic parsers first, schema-forced AI last, server-side non-invention checks), re-hosts the photos through the staged-media lifecycle, and lands the seller in the normal sell form with specific check-this prompts. Facebook is first-class: anonymous single-page attempt with a paste fallback on the same import.
- **Surfaces:** `/sell/import`, `/sell`, `src/lib/listing-import/`, `src/app/(product)/sell/import/`, `supabase/migrations/0047_listing_imports.sql`, `/api/jobs/listing-imports`
- **User benefit:** A seller who already listed a part somewhere else brings it to DRVN in under a minute instead of rebuilding it — supply-side migration without redundant work.
- **Approach:** Postgres-owned durable job (0047: status machine + transition trigger + step lease), one hardened SSRF-pinned fetcher for pages and images, a source-policy registry with engine adapters (Discourse JSON, XenForo, vBulletin, phpBB, generic JSON-LD/OG/Readability, Facebook, paste), Anthropic extraction behind a config seam with a deterministic stub for dev/CI, fitment through the 0041 catalog, and one SellFormInitialValues contract so the review IS the existing sell form.
- **Depends on:** vehicle-catalog, background-jobs
- **UX rules:** The importer never publishes and never invents a seller claim — blank beats guessed. Specific review reasons, never confidence scores. Failures degrade forward to paste on the same import; the seller never restarts.
- **Decisions:** Crawlee/metascraper not adopted: every import is exactly one user-supplied page fetch, so a hardened undici fetcher + cheerio adapters cover it without a crawler framework's queue machinery (matches the no-Redis/no-PGMQ posture). Facebook is public_url, not paste_only: the attempt is user-directed, single-page, logged-out, with hard no-bypass boundaries; viability is measured by the facebook_outcome analytics aggregate. No screenshot import — text/URL paths only, per product direction. Confidence scores dropped from the old spec in favor of field-specific review issues.
- **Validation:** 89 unit tests (SSRF matrix, fixture-driven adapters, non-invention validation, heuristic extractor, policy/config); import_guard.sql (8 assertions) green against the dev project; migration applied twice; e2e flow spec covering paste import, review and draft-save.
- **Docs:** docs/listing-importer-spec.md, docs/site/listing-import.md

#### Negotiation v2: counter-backs for every member — Validated

- **Brief:** PRD O-1, O-2, O-4, O-5 · agent plan A1
- **Exists today:** An offer gets one answer: the seller accepts, declines or counters once. A below-minimum offer is refused before anything is recorded, so trying again costs nothing.
- **Changing:** Up to 3 buyer offers per listing (counter-backs included), strict turns, a 72-hour turn, a below-minimum offer recorded as a declined turn, each round's terms kept as a snapshot, one atomic `offer_move` for every move, and seller cancellation only before checkout begins.
- **Surfaces:** `src/features/commerce/offer-actions.ts`, `OfferCard`, `SellForm`, `supabase/migrations/`
- **User benefit:** Buyers and sellers can haggle a few rounds, and the minimum can't be found by trial and error.
- **Approach:** Rules in the database, the same path for people and agents; lock order listing → negotiation → order → payment.
- **Depends on:** offer-floor-private
- **Validation:** Merged (#27–#29) and on the shared dev project since 18 Oct (probes in supabase/MIGRATIONS.md). offer_rounds_guard and offer_move_guard pass, the four-race negotiation-concurrency suite passes, and e2e/negotiation-three-rounds.spec.ts runs offer → counter → counter-back → accept in a browser. The contract step, 20261019120000, retires create_offer_with_message and the client write policies on offers; its shared-dev apply waits until every running app copy has the switched code.
- **Docs:** docs/decisions/negotiation-v2.md, docs/decisions/agent-foundations.md, docs/plans/2026-10-agent-and-graph-plan.md

#### Seller helpers: photo shot lists and what came off — Implemented

- **Brief:** Agent plan, alongside A3c–A3d (no AI) · AG-9, AG-11
- **Exists today:** The sell form asks for photos with no guidance on which ones buyers look for. The build sheet lists only aftermarket parts, so fitting first coilovers to a stock car leaves nothing to mark removed, and the stock parts never get listed.
- **Changing:** The photo step suggests 3–5 shots for the part type (a generic list until the type is known; the title sharpens mixed types such as springs vs coilovers). A new mod line asks once, inline, which stock parts came off; ticked ones become removed lines marked stock (`mod_items.origin`), each with List it, so the listing carries the car maker as brand and the source car's fitment.
- **Surfaces:** `src/lib/marketplace/photo-guide.ts`, `src/lib/mods/stock-parts.ts`, `SellForm`, `/garage/[id]/edit`, `supabase/migrations/20261019100000_mod_items_stock_origin.sql`
- **User benefit:** Better photos without a checklist to fill in, and parts that came off a stock car become things to sell.
- **Approach:** Static maps, no AI and no new screens. The shot list is a suggestion, never required (one photo still publishes). The stock offer reads the finer mod type from the product name by keyword, with a short pick list as the fallback; save_mod_items keeps a line's origin when an older editor omits it. The agent later calls the same functions (AG-9).
- **Validation:** photo-guide.test.ts (every subcategory covered, 3–5 shots) and stock-parts.test.ts pass; mod_stock_origin_guard.sql passes on a fresh database with every other guard; generated types check clean.
- **Docs:** docs/decisions/seller-helpers.md, supabase/MIGRATIONS.md

#### Immutable commercial sale snapshot — Validated

- **Brief:** TX §6
- **Exists today:** order_items froze title/price/shipping plus the 0024 condition snapshot; description, category, part numbers, fitment, source car, seller identity and the photo gallery all resolved against the live listing — which the seller can edit or delete after the sale.
- **Changing:** Migration 0049: order_items.commercial_snapshot (versioned jsonb, NOT NULL) frozen by BEFORE INSERT trigger from the listing/fitment/part-number/source-car/seller rows, plus order_item_snapshot_images (gallery frozen row-per-photo). DB-level immutability guards; media GC treats snapshot images as references; the order page's 'As purchased' reads snapshot data only.
- **Surfaces:** `supabase/migrations/0049_commercial_snapshot.sql`, `src/features/commerce/snapshot.ts`, `src/app/(product)/orders/[id]/page.tsx`, `src/lib/media-lifecycle.ts`
- **User benefit:** A dispute never depends on reconstructing historical truth: buyer and seller can both prove exactly what was represented at purchase, even after the listing changes or disappears.
- **Approach:** Same trigger pattern as 0024 so every SQL order-creation path is covered without redefining the RPCs; snapshot content is built entirely server-side and cannot be forged or edited (42501 column guards, verified by supabase/tests/snapshot_guard.sql).
- **Decisions:** Versioned jsonb (snapshot_version) rather than accreting snapshot columns; v1 shape documented by the reader in src/features/commerce/snapshot.ts. Pre-0049 rows were backfilled from the live listing and flagged backfilled (or degraded when the listing was gone) — honest about being post-purchase content. listing_id stays unfrozen on order_items so the FK's ON DELETE SET NULL keeps working; everything evidential lives in the snapshot instead. No addresses, phone numbers or payment references in the snapshot — evidence of representation, not private fulfilment data.
- **Validation:** snapshot_guard.sql green against the project (edit/delete everything post-sale → frozen record byte-identical; UPDATE forgeries refused); reader unit tests; full vitest suite green; 0049 applied twice (idempotent).
- **Docs:** supabase/MIGRATIONS.md

#### Platform fee on goods + buyer-paid shipping — Validated

- **Brief:** TX §7
- **Exists today:** The 10% fee was computed on the merchandise subtotal only, hardcoded in purchase_begin (0007) and offer_accept_begin (0034) — sellers could shrink DRVN's fee by pricing value into shipping.
- **Changing:** Migration 0050 restates both RPCs with the fee basis as subtotal + shipping; the TS mirror, cart/checkout estimates and the /fees page follow. Historical orders keep their stored platform_fee_cents everywhere.
- **Surfaces:** `supabase/migrations/0050_fee_includes_shipping.sql`, `src/lib/payments/provider.ts`, `src/lib/checkout-data.ts`, `src/app/(legal)/fees/page.tsx`
- **User benefit:** The fee is split-proof: the same buyer total always produces the same fee, and the fee page shows exactly that arithmetic.
- **Approach:** Authoritative computation stays in SQL; the ledger's null-fee fallback deliberately keeps the goods-only basis because every such row was charged under it — the ledger reports what was charged, never what today's rule would charge.
- **Validation:** 0050 self-checks assert the new basis via pg_get_functiondef; snapshot_guard.sql proves fee equality across opposite price/shipping splits of the same total; fee unit tests updated with the brief's $300+$23 worked example.
- **Docs:** src/app/(legal)/fees/page.tsx, supabase/MIGRATIONS.md

#### DRVN Shipping — rates, labels, tracking — Implemented

- **Brief:** TX §8-§19
- **Exists today:** Shipping was one flat seller-set number and a client-trusted collection checkbox; tracking was two free-text columns on orders with no carrier feed.
- **Changing:** A DRVN-owned shipping domain: private seller fulfillment profiles (0051, Settings → Shipping, address-verified), a provider seam (EasyPost via plain fetch + a deterministic stub for dev/e2e, gated by FLAG_INTEGRATED_SHIPPING_V1), shipments/shipment_items/shipment_events + the signed seller_adjustments ledger (0052), listing shipping modes with seller-declared parcels and rated checkout over server-held quotes (0053), seller label buy/void with idempotent adjustments, an HMAC-verified EasyPost webhook that drives shipment and order state, and payout math that nets label costs (transfer worker + ledger).
- **Surfaces:** `src/lib/shipping/`, `src/features/commerce/{fulfillment,checkout-shipping,shipping-quote-actions,fulfillment-actions}.ts`, `src/app/api/shipping/easypost/route.ts`, `src/app/(discover)/checkout/checkout-steps.tsx`, `src/app/(product)/orders/[id]/shipping-controls.tsx`, `supabase/migrations/0051-0053`
- **User benefit:** A buyer sees live carrier rates for their address and pays exactly that; the seller gets a one-click label whose cost transparently nets out of their payout; tracking moves the order without anyone clicking.
- **Approach:** Nothing money-shaped trusts the client: quotes live server-side (deny-all RLS) keyed to a destination fingerprint, purchase_begin takes server-validated overrides, the fee basis (0050) includes quoted shipping automatically, and the DB guards shipment transitions and one-live-shipment-per-item.
- **Depends on:** commercial-snapshot, fee-includes-shipping
- **Decisions:** One listing = one parcel (§12) — no cartonization. Shipping fails DISABLED, not closed: a missing EasyPost key in production quietly disables DRVN Shipping; seller-arranged always works. Offers are blocked on DRVN-Shipping listings for now: offers freeze money at accept, rated shipping prices at checkout — recorded as the §15 gap to close with offer-time rating. labels are seller-visible only: shipments.label_reference is excluded from the client column grant; provider ids are opaque so EndShipper→Forge stays a provider-file change (§10).
- **Validation:** 13 shipping unit tests (mode resolution, EasyPost mappers, stub determinism); guard behaviour in 0052/0053 self-checks; full vitest + production build green. Real EasyPost test-mode calls still to be exercised before production postage (§10 checklist in the runbook).
- **Docs:** supabase/MIGRATIONS.md, .env.example

#### Provable local pickup — Validated

- **Brief:** TX §20-§21
- **Exists today:** Collection was an honor system: is_collection came from a client checkbox and nothing proved a handoff ever happened.
- **Changing:** 0054: seller marks Ready for pickup; buyer opens a rotating single-use Pickup Pass (QR encoding a seller-side redeem URL + six-digit fallback, hashes only in the DB, 1h TTL, 10-attempt lockout); pickup_redeem() burns it atomically and moves the order into the same delivered/clearing path as shipped orders. The 0053 guard separately refuses is_collection unless every item's frozen snapshot offered pickup.
- **Surfaces:** `supabase/migrations/0054_pickup_confirmations.sql`, `src/features/commerce/pickup-actions.ts`, `src/app/(product)/orders/[id]/pickup-controls.tsx`, `src/app/(product)/orders/[id]/pickup/page.tsx`
- **User benefit:** A local handoff has objective proof for both sides — no more 'never collected' disputes — and payout clearing starts the moment the part changes hands.
- **Approach:** No reusable plaintext secrets (§21): the pass rotates on every show, only salted hashes persist, and the buyer's Mark received stays as the fallback path.
- **Depends on:** commercial-snapshot
- **Validation:** return_guard.sql proves seller-only redemption, attempt counting, single-use, and order delivery against the live project; nextAction unit tests cover the handshake wording; full suite green.

#### Returns / RMA domain — Validated

- **Brief:** TX §22-§31
- **Exists today:** Dispute resolution was binary — full refund or argue — with no way to get the item back before money moved, and the day-10 auto-refund could fire while a part was physically in transit back.
- **Changing:** 0055: an item-aware RMA domain (returns + return_items, guarded 11-state lifecycle, one live RMA per unit) with deadlines frozen on the row (ship within 7 days or expire; 48h seller inspection or the agreed refund proceeds automatically). Sellers resolve disputes three ways (partial refund keep, full refund keep, return-then-refund); shops additionally take policy returns judged against the SNAPSHOT's frozen policy. DRVN return labels for seller-caused returns land on the seller's adjustment ledger; return tracking drives the RMA via the same webhook path; completion refunds through the 0026 engine (initiator return:<id>), and an active RMA pauses the dispute SLA clock.
- **Surfaces:** `supabase/migrations/0055_returns.sql`, `src/features/commerce/{returns,return-actions,shop-actions}.ts`, `src/app/(product)/orders/[id]/return-controls.tsx`, `src/lib/payments/dispute-sla.ts`, `src/app/api/jobs/transfers/route.ts`
- **User benefit:** An item can travel back before a refund when it should; ordinary returns resolve on timers without founder intervention; a contested returned box goes to human review before any money moves.
- **Approach:** The Return domain decides when/how much, the refund engine moves money — no provider calls in return code. Escalation reopens the order's existing ops case (§29), never a new queue. Entitlement math is pure and unit-tested (§31): seller-caused returns include the item's frozen shipping share, buyer-preference returns don't.
- **Depends on:** integrated-shipping, commercial-snapshot
- **Validation:** return_guard.sql green against the project (illegal transitions refused, moving returns can't expire, one live RMA per unit); 7 unit tests on entitlement + lifecycle map incl. no-refund-before-receipt; timers wired into the jobs pass; full suite + build green.

#### Lightweight shop profiles — Validated

- **Brief:** TX §34-§38
- **Exists today:** profiles.profile_type = 'user'|'shop' existed since 0001 (guarded from self-escalation by 0017) but nothing used it — no shop features, no verification concept, no return policies.
- **Changing:** 0056: shop_profiles one-to-one with profiles (admin-granted verification, returns_accepted + 14/30/60-day window). Controlled server-side conversion in Settings → Shop; the storefront opens on For Sale with a Shop/Verified-shop eyebrow; the snapshot freezes the policy + verified state into every purchase; buyers get the §24B preference-return flow judged against that frozen policy.
- **Surfaces:** `supabase/migrations/0056_shop_profiles.sql`, `src/features/commerce/shop-actions.ts`, `src/app/(product)/settings/shop-section.tsx`, `src/app/(discover)/u/[username]/page.tsx`
- **User benefit:** A business runs a recognizable storefront on the same account it uses socially — and a shop tightening its policy tomorrow can never strip a right yesterday's buyer bought with.
- **Approach:** Shops extend profiles; nothing is duplicated. Verification is manual for MVP: granted service-role/SQL like admin_users, never self-declared — an unverified shop is never rendered verified.
- **Depends on:** commercial-snapshot, returns-rma
- **Decisions:** Deliberately NOT built (§38): employees/roles, inventory, POS, CRM, wholesale, fulfillment routing.
- **Validation:** 0056 self-checks (no client write policy; snapshot freezes the policy; profiles guard intact); frozen-policy reader covered by snapshot unit tests; full suite + build green.

#### A seller's default lowest offer — Implemented

- **Brief:** PRD 2026-09 P-9 (build plan P-9)
- **Exists today:** Every listing asked for an offer floor from scratch, so a seller with a consistent policy re-typed it on every part.
- **Changing:** profiles.default_offer_floor_pct prefills the sell form. It is a default, never a rule applied to listings that are already live.
- **Surfaces:** `src/app/(product)/settings/settings-panel.tsx`, `src/app/(product)/sell/sell-form.tsx`, `supabase/migrations/20260919196000_seller_defaults_and_region.sql`
- **User benefit:** A seller states their policy once instead of on every listing.
- **Approach:** A prefill only. Changing the default cannot retroactively change what a buyer is already looking at.
- **UX rules:** Never retroactive. A live listing keeps the floor it was published with.
- **Validation:** Column grants applied with the H-2 migration; the settings field and the sell-form prefill verified in the running app; full unit suite and typecheck green.

### 05 · Build Story Composer

#### Editor engine & DRVN-owned schema — Validated

- **Brief:** M1–M2
- **Exists today:** Posts store an ordered block array (text/images/embed) in `activity_posts.body` with `normalizeBlocks()` upgrading the legacy shape; editing is a hand-rolled block form (↑/↓ moves, bottom-only insertion).
- **Changing:** One editor engine (Tiptap and Yoopta evaluated; decision recorded here) rendering DRVN's own versioned `ActivityDocumentV2`; editor state is transformed at the boundary and never stored as canonical data. Old posts keep rendering via the existing normalization path.
- **Surfaces:** `src/lib/activity-blocks.ts`, `src/app/(product)/garage/[id]/update/`
- **User benefit:** Build updates gain a modern, reorderable writing experience without tying DRVN's data to any editor library.
- **Approach:** Engine chosen after inspecting current code; DRVN block model extended (V2) with serializers both ways; renderer stays DRVN-owned.
- **Decisions:** Engine: Tiptap v3 (MIT, headless ProseMirror) — full Livesheet styling ownership, atom NodeViews for the automotive set; Yoopta kept as a UX reference only, per M1 one-engine rule. The stored format stays the self-describing body array (V0 legacy sections and V1 blocks still normalize on read); no schemaVersion column needed. No inline marks in V2 — bold/italic/link deliberately off (brief O: no arbitrary typography); text blocks stay plain.
- **Validation:** Serializer round-trip unit-tested (4 tests, every block type); live end-to-end run: typed text + slash-inserted blocks published and the stored body verified as clean DRVN V2 JSON with zero editor state.

#### One progressively enhanced composer — Validated

- **Brief:** M3, N
- **Exists today:** A simple quick composer (title + text + video) in the Garage editor and a separate full block editor — two products for one job.
- **Changing:** One composer with an immediate writing surface: place cursor, type, publish. `+` / `/` menus, insertion between blocks, drag reorder and keyboard accessibility appear when wanted.
- **Surfaces:** `/garage/[id]/update/new`, `/garage/[id]/update/[postId]/edit`, `garage editor`
- **User benefit:** "Installed the new wheels today" is publishable in seconds, and richer stories don't require learning a CMS first.
- **Approach:** The engine from composer-engine wrapped in DRVN chrome; quick-composer entry points route into the same surface.
- **Depends on:** composer-engine
- **UX rules:** Typing must work before any block/template decision. No mandatory template screen.
- **Decisions:** The quick/full split is gone: one BuildStoryComposer serves create and edit; server actions ride in as props so features/ never imports route code. Legacy intro/video fields ride through edits as hidden values — a body edit can never silently strip them.
- **Validation:** Live browser run: title + typed paragraph + / menu + + menu + publish landed on the public page; the garage editor's quick form is retired — 'Post an update' opens the one composer. Console clean.

#### Automotive blocks — Validated

- **Brief:** O
- **Exists today:** Blocks are text (normal/heading), images and YouTube embeds only.
- **Changing:** Core blocks refined (paragraph, heading, photos, video, divider) plus a restrained automotive set: Modification change (linked to real mod_items), Before/After comparison, Performance result (owner-reported), optional Mileage milestone, Removed part with a contextual sell path.
- **Surfaces:** `src/lib/activity-blocks.ts`, `composer`, `public post renderer`
- **User benefit:** An update about coilovers can show the mod, the before/after and the numbers — machine-readable and visually distinct from a generic social post.
- **Approach:** Each block is a DRVN document node + renderer + editor node; mod blocks reference existing mod_items rather than duplicating data; performance data clearly labeled owner-reported.
- **Depends on:** composer-engine
- **UX rules:** No arbitrary typography/layout controls. Block library stays small.
- **Decisions:** One Mod block covers installed/removed/replaced/updated — 'removed' doubles as the Sell-this-part bridge; no separate removed-part block. BeforeAfter is a registered ui primitive (keyboard slider); ActivityBlocksView is the one renderer for every post version, publicly and in previews.
- **Validation:** normalizeBlocks V2 coverage unit-tested (malformed-field defense included); performance + mod blocks exercised live end-to-end; renderer verified on the public page (owner-reported label, INSTALLED chip). Before/after upload path pending photo-based visual pass (Group 10).

#### Optional update templates — Implemented

- **Brief:** Q
- **Exists today:** No templates; every update starts blank.
- **Changing:** Optional starter chips (General update, Installed something, Removed something, Photos, Dyno result, Issue/fix) that visibly and reversibly seed blocks — never a mandatory selection screen.
- **Surfaces:** `composer`
- **User benefit:** The blank page gets easier without the empty composer becoming harder.
- **Approach:** Inline chips above the empty surface; applying one is explained, obvious and undoable.
- **Depends on:** unified-composer
- **UX rules:** Empty composer is already usable. No unexplained transformations.
- **Validation:** Starter chips render only on the empty composer with explanatory tooltips; application is one undo away. Interactive template pass rides with Group 10 visual validation.

#### Drafts & autosave — Validated

- **Brief:** R
- **Exists today:** The full editor relies on an explicit Save draft action.
- **Changing:** Debounced remote autosave with quiet `Saved` status and local recovery; publishing stays explicit.
- **Surfaces:** `composer`, `server actions`
- **User benefit:** A ten-photo update survives a mobile browser reload instead of vanishing.
- **Approach:** Debounced draft mutation + localStorage recovery buffer; no save spam.
- **Depends on:** unified-composer
- **Validation:** Live run: 1.6s-debounced draft save fired with the quiet 'Saved — only you can see it' status; localStorage recovery buffer written per keystroke and cleared on publish; publish stays explicit.

#### Composer motion & polish — Implemented

- **Brief:** P
- **Exists today:** The current editor has no motion language.
- **Changing:** Subtle, branded motion for block insertion/removal/reorder, menu opening, template application, upload completion and before/after interaction — reinforcing causality, never decorating.
- **Surfaces:** `composer`, `src/app/globals.css`
- **User benefit:** The composer feels premium and unmistakably DRVN rather than like a form.
- **Approach:** Livesheet-consistent transitions (Higgsfield references where useful); `prefers-reduced-motion` respected everywhere.
- **Depends on:** unified-composer
- **Validation:** Block rise-in on insert, hover-revealed tool rails (always-on for coarse pointers), live dropcursor, transition tokens from Livesheet; prefers-reduced-motion disables the entrance animation. Visual pass in Group 10.

#### Quick post, the photo rule, tagging a part — Validated

- **Brief:** PRD 2026-09 W-1…W-3 (build plan WS14a)
- **Exists today:** Posting meant the full editor: a required title, blocks, a draft. 'New wheels turned up' had nowhere to go, and every post needed a heading whether or not the member had one in mind.
- **Changing:** A quick box — photos, a caption, Post — with no title and no draft. A title becomes optional in the database and every reader goes through postHeadline() instead of assuming a string. A published post needs at least one photo. A post can tag up to three of the author's own active parts.
- **Surfaces:** `src/features/composer/quick-post.tsx`, `src/features/composer/part-picker.tsx`, `src/lib/activity/headline.ts`, `supabase/migrations/20260919194000_quick_post_and_tagged_parts.sql`
- **User benefit:** The gap between 'something happened to my car' and 'it is on DRVN' becomes about fifteen seconds.
- **Approach:** A new `quick` write mode that returns before the draft lookup the publish path performs — the release-blocking contract, since publish converts a car's existing draft into the published post. Retry-safety comes from the same operation id publishing already uses.
- **Depends on:** unified-composer
- **UX rules:** A quick post never touches a saved draft. With no draft, 'Write a full update' carries the caption over; with one, the link says 'Continue your draft' and nothing is merged. The photo rule applies to new publishes only — a post published before the rule can still be edited without one. Three tagged parts at most. A post with eight is a shop window, and the feed is not the marketplace.
- **Decisions:** No generated headings. 'Update from the Silvia' is DRVN's sentence, not the member's — the fallback is their own first line. sync_activity_post_listings is SECURITY DEFINER and checks the author itself, so a direct call can't tag parts onto somebody else's post.
- **Validation:** activity_quick_post_guard.sql (release-blocking) proves the draft is byte-identical after a quick post, both posts exist, the quick post has no title, a replay returns 'replayed', a photoless publish is refused and a draft may still have none. Whole SQL guard suite green; full unit suite and typecheck green; the box verified in the running app.

#### Posting without a car — Validated

- **Brief:** PRD 2026-09 W-5 (build plan WS14b)
- **Exists today:** activity_posts.car_id was NOT NULL, so a member who had sold their car, or who was selling parts before buying one, could not post at all. Principle 1 says the car gives context and is never a gate.
- **Changing:** car_id becomes optional, and a post must be about a car, a tagged part, or both. A carless post lives at /posts/[postId] with its own share card, and postHref() replaces the hand-built permalink in every reader.
- **Surfaces:** `src/app/(discover)/posts/[postId]/page.tsx`, `src/lib/activity/href.ts`, `supabase/migrations/20260919197000_posts_without_a_car.sql`, `supabase/migrations/20260919198000_carless_posts_reach.sql`, `supabase/migrations/20260919199000_carless_quick_post.sql`, `supabase/migrations/20260919200000_carless_post_policies.sql`
- **User benefit:** Between cars, you are still a member. The gate that said otherwise is gone without weakening the rule that everything is about a car or a part.
- **Approach:** Dropping the NOT NULL is the small half. Every reader, the writer and the RLS policies expressed the car requirement as a join or an EXISTS against cars, and each would have dropped a carless post silently — which to the member is indistinguishable from posting into nothing. Four migrations: the column and the subject rule, the readers, the writer, the policies.
- **Depends on:** quick-post
- **UX rules:** A post with a car keeps the URL it has always had — every link already in the world still resolves. 'No car — about a part' is the last option in the picker, not the first: it is the exception, not the default.
- **Decisions:** A published post with no car is public. There is no private car to hide behind, and publishing is the act of making it public; the alternative is a post its author can see and nobody else can. The subject rule is a deferred constraint trigger rather than composer validation — a rule about what the product IS belongs where it can't be forgotten. The car stays required in the full editor: it is reached from a car sheet and its draft machinery is keyed by car.
- **Validation:** carless_post_reach_guard.sql: a carless post publishes, one about neither a car nor a part is refused, it appears in feed_events with the right owner, search finds it, Local finds it in the author's region and not another, post_href gives /posts/<id> for it and leaves a post with a car untouched, and a save, a comment and a reaction each notify the author at that URL. Whole SQL guard suite green; full unit suite and typecheck green.

### 06 · Media & galleries

#### Better upload queue — Implemented

- **Brief:** S1
- **Exists today:** `uploadImages` centralizes validation/storage/staging, but uploads run sequentially with no per-image progress, retry or continued-editing affordance.
- **Changing:** Immediate local previews, per-image progress, partial-failure handling, retry, cancel where possible, and editing while uploads run — on top of the untouched staged-upload lifecycle.
- **Surfaces:** `src/lib/media-upload.ts`, `garage gallery`, `/sell`, `composer`
- **User benefit:** Adding twelve photos feels fast and visible instead of a silent wait that might fail wholesale.
- **Approach:** A queue layer (Uppy evaluated vs extending the existing helper — decision recorded) beneath a DRVN-designed surface; storage and GC unchanged.
- **Decisions:** Uppy evaluated and not adopted: byte-level progress would require switching to TUS resumable uploads; after §S4 normalization files are small, so an honest queued/uploading/done/failed ladder beats a simulated percent bar.
- **Validation:** Queue hook (3-way concurrency, statuses, retry, remove) drives composer galleries, before/after slots and the sell form (instant previews + per-image state); typecheck/lint/unit green. Garage gallery keeps its immediate per-file persist flow with retry — documented decision.

#### Drag-and-drop reordering — Validated

- **Brief:** S2
- **Exists today:** Photo ordering is ↑/↓ buttons only.
- **Changing:** Accessible drag-and-drop sorting (dnd-kit or equivalent) for garage photos, listing photos and composer galleries, with keyboard controls retained.
- **Surfaces:** `garage gallery`, `/sell`, `composer`
- **User benefit:** Arranging a photo set takes seconds instead of button-mashing.
- **Approach:** One sortable primitive registered in the design system, applied consistently.
- **Validation:** SortableGrid/SortableItem (dnd-kit pointer+touch+keyboard) registered and applied to the garage gallery (optimistic order + full-order server action) and sell photos; ↑↓ controls retained as the explicit accessible path. Composer galleries keep ←/→ — in-gallery dnd nested inside a draggable ProseMirror node is conflict-prone (documented).

#### Cover & focal-point framing — Implemented

- **Brief:** S3
- **Exists today:** Cover selection exists; framing does not — crops are whatever the layout happens to do.
- **Changing:** Non-destructive focal/crop metadata on important images so covers render well across hero, card, and gallery contexts. Originals kept.
- **Surfaces:** `garage gallery`, `car pages`, `listing cards`
- **User benefit:** Owners control how their car appears everywhere it's cropped, without destroying the photo.
- **Approach:** react-easy-crop-style percentage focal data stored as technical metadata only.
- **Validation:** 0043 applied; the 'Frame the cover' dialog (click-to-set focal point with hero/card/thumb live previews) ships on the garage gallery; Media gained a focal prop applied on the public car hero. Visual pass in Group 10.

#### Client-side photo normalization — Validated

- **Brief:** S4
- **Exists today:** Original camera files upload as-is (up to the size limit), EXIF/GPS included.
- **Changing:** Public garage/activity/listing photos get orientation-corrected, resized, sensibly compressed, and stripped of EXIF/GPS before upload. Dispute evidence keeps originals untouched.
- **Surfaces:** `src/lib/media-upload.ts`
- **User benefit:** Uploads get faster and cheaper, and nobody accidentally publishes their home GPS coordinates.
- **Approach:** Canvas-based normalization in the upload helper, bypassed for evidence flows.
- **UX rules:** Never normalize private dispute evidence destructively.
- **Validation:** normalizePublicPhoto (orientation via createImageBitmap, 2560px cap, JPEG re-encode = EXIF/GPS strip, graceful fallback) wired into garage, sell and composer uploads; dispute evidence untouched by construction (its flow never passes normalize).

### 07 · Garage & build experience

#### Add what you bought to your car — Implemented

- **Brief:** PRD 2026-09 C-1 (build plan WS4)
- **Exists today:** A completed purchase is a dead end. The part arrives, goes on the car, and the build sheet knows nothing about it — so the loop that makes DRVN one product rather than two stops at the doorstep.
- **Changing:** A delivered or completed order offers 'Add to a car', per item. The mod line is built from the order item's frozen purchase record and reads back as 'Bought on DRVN · off {car}'.
- **Surfaces:** `/orders/[id]`, `src/features/commerce/add-to-car-actions.ts`, `src/lib/mods/provenance.ts`, `src/lib/mods/category-map.ts`
- **User benefit:** The third loop closes: a part sold off one build becomes a documented part of another, and the marketplace starts feeding the community that feeds it.
- **Approach:** Read from order_items.commercial_snapshot (0049), never the live listing — by the time somebody fits a part the seller may have edited, re-shot, relisted or deleted it. Idempotent through the unique mod_items.source_order_item_id; a second tap answers 'already on this car' rather than erroring or duplicating.
- **Depends on:** mod-record-identity, main-car
- **UX rules:** Offered per item, not per order — an order can hold several parts going on different cars. Only once the part has arrived: delivered or completed, the same window the review and return flows use. A second tap adds nothing and says so. Same answer either way is what idempotent should feel like. A source build that has since gone private is not named at all.
- **Decisions:** The provenance line is NOT written into the mod's text at insert. source_order_item_id is the durable fact and the source car is read back at render, where its CURRENT visibility can be checked — a sentence written once can't stop naming a car that later went private. The reverse category map answers null rather than guessing: 'engine' could be a turbo, a manifold or a long block, and a wrong category quietly mis-files the part on somebody's build sheet. The 'owners manage mods' policy is already `for all`, so this is a plain insert rather than another database function.
- **Validation:** Category mapping unit-tested both directions including the round-trip and the deliberate nulls. Buyer, car ownership and order state are all checked server-side. The uniqueness index is asserted in mod_sheet_atomic_guard. Typecheck, lint and the full unit suite green. NOT yet walked end to end — that is acceptance journey 6, and a full order-fixture SQL guard for the double-tap is still to write.

#### Annotated showcase image — Validated

- **Brief:** U
- **Exists today:** Car photos are a plain gallery; nothing links an image region to build data.
- **Changing:** An optional advanced feature on one (or very few) selected showcase images: hotspots linked to existing build entries, revealed through an `Explore this build`-style interaction.
- **Surfaces:** `/cars/[slug]`, `/garage/[id]/edit`
- **User benefit:** A build becomes explorable through the car itself — tap the wheel, see the wheel spec.
- **Approach:** Percentage-positioned hotspots referencing mod_items, accessible keyboard/touch interaction; explicitly not a post block, never on every photo.
- **UX rules:** Default photo experience stays clean. Not a marketplace navigation system.
- **Decisions:** Pins snapshot their label and reference mod_items while it exists; a pinned part that's for sale links its live listing ('For sale · $x →'), otherwise the card just names the part. Hard bounds by construction: one image, 8 pins, reveal-on-request — the default photo experience stays clean.
- **Validation:** 0045 applied twice (8-pin trigger cap, visibility-following RLS); live run on a public build: 'Explore this build' toggle → staggered pins → part card with label verified by screenshot; owner editor (photo picker, click-to-pin, mod-linked labels) code-complete under the car edit sheet.

#### Build Evolution timeline — Validated

- **Brief:** V
- **Exists today:** Activity is a list; there is no visual chronology of the car.
- **Changing:** A visual chronological story derived from dated updates and their images — representative photos, major titles, thoughtful transitions. No snapshots, no diffs, no extra data entry.
- **Surfaces:** `/cars/[slug]`
- **User benefit:** Visitors can watch a build evolve instead of scrolling a feed backwards.
- **Approach:** Derived entirely from existing posts/images; motion respects reduced-motion.
- **Decisions:** A milestone is simply a published update with a photo — zero new data entry, no snapshots, no diffs (§V/§AJ honored by construction).
- **Validation:** Derived-only strip (published, dated, photographed updates → milestones) rendered on the Activity tab when ≥2 exist; verified live with three seeded dated updates; scroll-snap horizontal track with year ticks; hover lift disabled under reduced motion.

#### Passive creation suggestions — Validated

- **Brief:** W
- **Exists today:** Editing the build or adding photos never connects to posting an update.
- **Changing:** After a meaningful build edit or a batch of new photos, a quiet inline affordance offers `Create an update from these changes` / `Share these in an update`, prepopulating the composer when chosen.
- **Surfaces:** `/garage/[id]/edit`, `garage gallery`
- **User benefit:** Real changes become content with one click — and the affordance is entirely ignorable.
- **Approach:** Inline dismissible row, no modals, no repeat nagging; state remembered so it doesn't re-offer.
- **Depends on:** unified-composer
- **UX rules:** No popups. Ignorable forever without cost.
- **Validation:** Both affordances are inline, dismissible rows — no modals, no repeats: the mods editor diffs labels on save and offers 'Create an update from these changes →'; the gallery offers 'Share these in an update →' after a ≥2-photo batch. The composer seeds visible, editable blocks from the links and never clobbers an in-flight draft. Typecheck/lint/unit green.

#### Shareable build/update cards — Validated

- **Brief:** AB
- **Exists today:** Car pages have OpenGraph metadata with car imagery; no designed share card exists.
- **Changing:** Automatically generated build and update cards in DRVN's design language for social/OpenGraph use — no manual card workflow.
- **Surfaces:** `/cars/[slug]`, `activity posts`, `OG image generation`
- **User benefit:** Sharing a build off-platform looks intentional instead of like a screenshot.
- **Approach:** Data-driven OG image route composing existing car/update data.
- **Decisions:** No manual card workflow anywhere: the card IS the route's opengraph-image, always current.
- **Validation:** next/og cards for build pages and update pages, generated from existing data (cover/first photo, identity line, mod/update counts); verified live — 200 image/png, screenshot reviewed. The explicit openGraph.images override was removed so the designed card owns every unfurl.

#### Garage hierarchy pass — Validated

- **Brief:** Z
- **Exists today:** The garage sheet works; density and hierarchy have grown organically.
- **Changing:** Only reorganize where existing information can form a clearer hierarchy (current car, recent update, selling activity, pending actions) without adding density. Otherwise preserve.
- **Surfaces:** `/garage`
- **User benefit:** Owners see what matters about their car first — with nothing new to learn.
- **Approach:** Simplify-before-add rule; no intelligence dashboard.
- **Decisions:** No garage intelligence dashboard (§Z honored): the existing sheet already answers 'what matters about this car right now'.
- **Validation:** Reviewed against the simplify-before-add rule: the Aug-2026 garage sheet already leads with the car, its latest update, selling counts and a bounded work-order list — reorganizing further would only move furniture. Preserved deliberately; the passive suggestions (§W) are the only additions, and they live on the edit surfaces, not the sheet.

#### Home — what changed since you were last here — Implemented

- **Brief:** PRD 2026-09 H-1, H-4…H-6 (build plan WS11)
- **Exists today:** Home was a wall of tiles: an attention list, seller KPIs, a prompt to post, and a feed underneath. It described the account rather than showing what had happened.
- **Changing:** Two columns — the feed with the quick box on top, and a rail of the few things that genuinely need an answer. The seller KPIs move to /selling, where somebody actually goes to run a shop. Empty tiles don't render; a member with no car gets 'Add your car' instead of an empty garage tile; with fewer than three posts the first rail card follows the last post rather than sitting in a column of its own.
- **Surfaces:** `src/app/(product)/home/page.tsx`, `src/app/(product)/selling/page.tsx`, `supabase/migrations/20260919193000_suggested_builders.sql`
- **User benefit:** Home answers the question people actually open it with, and a sparse account looks deliberate rather than broken.
- **Approach:** suggested_builders takes a nullable viewer so the same RPC serves a signed-out preview; the feed scrolls to load using the Explore wall's existing mechanism rather than a second one.
- **Depends on:** app-shell
- **UX rules:** A tile with nothing in it does not render. An empty box is a bug that looks like a design. Local only appears once the member has said where they are.
- **Validation:** Verified in the running app: the two-column 605px/320px grid, the quick box on top of the feed, the rail's cards, and the sparse fallbacks. Full unit suite and typecheck green.

#### Garage — one car at a time — Implemented

- **Brief:** PRD 2026-09 G-1…G-5 (build plan WS12)
- **Exists today:** The garage listed every car as a sheet, so a member with one car read a list of one and a member with six read six half-sheets and could work on none of them.
- **Changing:** A switcher picks the car; the focused view gives that car its stat strip, its tabs (Overview, Mods, Parts, Media) and the existing editors mounted inside them. /garage/[id]/edit stays exactly where it was.
- **Surfaces:** `src/app/(product)/garage/page.tsx`, `src/app/(product)/garage/garage-switcher.tsx`, `src/app/(product)/garage/focused-car.tsx`, `src/app/(product)/garage/focused-panels.tsx`
- **User benefit:** The garage becomes a workspace for the car you are working on rather than an index of cars you own.
- **Approach:** ?car= drives the selection, so the view is linkable and the back button works. The panels mount the editors that already exist rather than reimplementing them.
- **Depends on:** main-car
- **UX rules:** The main car leads the switcher; 'All cars' is always one tap away.
- **Validation:** Verified in the running app: switcher, three-tile stat strip, and the four tabs with their counts. Full unit suite and typecheck green.

### 08 · Notifications

#### Notification domain & delivery boundary — Validated

- **Brief:** D
- **Exists today:** A notifications table with kind/section, nine SQL triggers, per-user prefs, unread badges and an open-and-redirect route — in-app only, delivery logic scattered in triggers.
- **Changing:** A clean notification domain model (typed kinds registry, preference gating, delivery boundary) that supports saved-search and seller alerts now and email/push later — without a hard Novu (or any paid) dependency.
- **Surfaces:** `supabase/migrations/`, `src/lib/notifications/`, `/notifications`, `/settings`
- **User benefit:** New alert types land consistently, respect user preferences, and can later reach email/push without re-architecture.
- **Approach:** Typed kind registry + provider seam; Novu evaluated pragmatically and the decision recorded; in-app remains the working default.
- **UX rules:** Alerts only ever arrive by explicit opt-in for non-transactional kinds.
- **Decisions:** Novu evaluated and not adopted: one in-app channel needs no workflow orchestration and DRVN must not depend on a hosted notification service; deliver.ts is the documented seam where email/push/Novu would fan out.
- **Validation:** Typed kinds registry consistent with prefKeyForKind (unit-tested — caught and fixed ungoverned dispute kinds); deliverNotification enforces preferences at write time for app-sourced kinds and delivered the live saved-search alert; Novu decision recorded at the seam.

### 09 · Admin operations

#### Operations case model — Validated

- **Brief:** K1
- **Exists today:** Disputes, reports, recoveries and audit exist as separate queues; nothing aggregates a problem into one assignable unit of work.
- **Changing:** A case layer over disputes/reports: status, priority, assignment/claim, labels, internal notes, saved views, SLA awareness — operational tooling, not a CRM.
- **Surfaces:** `/admin`, `supabase/migrations/`, `src/lib/admin/`
- **User benefit:** Admin work becomes claimable and trackable instead of re-derived from queues each session.
- **Approach:** Case table referencing existing objects; audited actions; module-boundary refactor where domains grew large.
- **Decisions:** Cases are a WORK wrapper, not a CRM: kind/status/priority/assignment/labels over the existing dispute/report objects; creation and resolution ride database triggers on the domain events so the ledger stays true no matter which path acted. Case reads use the admin console's normal read layer; mutations go through auditedAction under the pre-registered 'case.' capability family and the 0040 actor assertion.
- **Validation:** 0046 applied twice; backfill created cases from existing disputes/reports; live run as the console admin: queue renders, Claim → status 'claimed' + assigned_to + audited 'case.claim' row, labels/priority saved and audited. Lifecycle is trigger-owned, so SLA auto-refunds and buyer acceptances resolve cases without app code.

#### Dispute evidence dossier — Validated

- **Brief:** K2
- **Exists today:** Dispute facts are spread across the order sheet, evidence viewer, webhook stream and messages.
- **Changing:** One composed administrative view: listing snapshot, condition, photos, offer/order, payment and shipping timelines, messages, evidence, parties, prior actions.
- **Surfaces:** `/admin/orders/[id]`, `/admin/disputes`
- **User benefit:** An admin resolves a dispute from one coherent dossier instead of mentally reconstructing the transaction.
- **Approach:** Pure composition of existing data plus the correlation timeline from transaction-diagnostics.
- **Depends on:** transaction-diagnostics
- **Validation:** The admin order sheet now composes everything §K2 lists on one screen: listing snapshot + condition comparison (purchased vs current), photos/evidence via signed URLs, offer/order money state, the §AF transaction timeline (payment, webhook events, transfer lifecycle, refund operations), the thread, both parties with history, and prior admin actions. Timeline builder unit-tested; sheet exercised during the cases run.

### 10 · Design system

#### Cooler dark theme — Implemented

- **Brief:** PRD 2026-09 §3 (build plan WS7)
- **Exists today:** The night sheet is warm sepia — #15130c paper, #f0eee5 ink, alpha-ink cut from 240,238,229 — which tints the shadows of every car photo towards brown.
- **Changing:** One token block moves to a cool graphite paper: #121418 paper, #0c0e11 recessed, #1c1f25 / #171a1f plates, #eceef2 ink, #8a909b secondary, #22262d media fallback, #14161a on-ink, #262a31 ghost hover, and alpha-ink cut from 236,238,242. The day theme, the accent and the status hues are unchanged.
- **Surfaces:** `src/app/globals.css`, `src/app/(docs)/docs/brand/page.tsx`, `src/app/(discover)/cart/payment-confirm.tsx`
- **User benefit:** Car photography sits on a neutral page instead of a warm one, so a blue car reads blue; secondary text also gained a little contrast in the move.
- **Approach:** Night is a token remap, so the change is the one [data-theme="dark"] block plus the three places that carry night hexes as literals — the brand page's swatches and night specimen, the Stripe appearance fallbacks, and the select chevron, which is an inline SVG and can't read a custom property.
- **UX rules:** Every pairing re-measured on the switch; nothing was allowed to drop below 4.5:1. --photo-filter is unchanged: it answers how bright a photo sits on a dark page, not what colour the page is.
- **Decisions:** --scrim and --ink-hover follow the palette although the PRD doesn't list them: they are derived (a step under paper-deep, and ink at the day sheet's ~0.91 step), and left warm they would have been the two brown edges on a cool sheet. The status hues and their tints stay exactly as they were — accent unchanged is a ruling, and each status text token still clears 5.7:1 on its own tint over the new paper.
- **Validation:** Contrast computed for every pairing before the switch and recorded in the CSS and in brand.md: ink 15.87:1 on paper, 14.21:1 on tile; dim 5.74:1 on paper (up from 5.52) and 5.14:1 on tile (up from 4.95); on-ink 15.59:1 on ink, 5.30:1 on the live fill. A new night axe pass over the five public pages is green — the suite had never rendered the dark theme, because the theme is a cookie and Playwright's colorScheme only sets prefers-color-scheme. Light-theme visual baselines unmoved; full vitest, typecheck and lint green; walked Home, Explore, Marketplace and Garage in the dark on the dev server at desktop and phone widths.

#### Storybook beside Livesheet — Validated

- **Brief:** AC
- **Exists today:** The registry + /docs/components specimens document components, but there is no isolated-state lab (loading/error/long-content/mobile per component).
- **Changing:** A local/static Storybook wired to the component registry, with stories prioritized for foundational components, commerce states, composer blocks, media controls, vehicle picker, saved-search and Selling/Admin components; a11y checks where practical.
- **Surfaces:** `new .storybook/`, `src/components/`
- **User benefit:** Every component's states are visible and testable in isolation before they ship into screens.
- **Approach:** Storybook 9 static build; no paid visual-regression services; registry linkage documented.
- **Decisions:** Storybook 9 + nextjs-vite beside the docs site — /docs stays the narrative + registry inventory, Storybook is the isolated-state lab. Local/static only, no paid services. Accepted dev-only advisory: image-size (DoS in ICNS/JXL parsers) inside vite-plugin-storybook-nextjs — no fix exists, devDependency only, never in the production bundle. Stories use local data-URI imagery — no network, no CSP surprises.
- **Validation:** Static build green in ~4s; nine story files cover the priority list (Button states, ListingCard incl. no-photo/long-title/sold/fitment, order status chips+pipeline, MetricCard, Alert/EmptyState/Skeletons, ComboField, BeforeAfter, the full automotive block set, MessageThread); a11y addon on; day/night toolbar mirrors the app's data-theme; story render verified by screenshot.

#### The shell — search, Post, unread — Implemented

- **Brief:** PRD 2026-09 N-2, N-3, N-5 (build plan WS8)
- **Exists today:** The bar carried a plain search input that went to a results page, no way to start a post from anywhere, and a Messages link that never said whether anyone had written.
- **Changing:** The suggesting search field is mounted in the bar itself, a Post button sits beside it, and unread message counts stream into the rail and the menu as badges.
- **Surfaces:** `src/components/ui/livesheet-bar.tsx`, `src/lib/shell-counts.ts`, `src/components/ui/app-shell.tsx`
- **User benefit:** The two things a member does most often — look for something, say something — are one reach away on every page, and a message no longer waits to be discovered.
- **Approach:** Counts stream through a Suspense boundary so the shell renders immediately and the badge arrives when the query does; nothing in the bar blocks first paint.
- **UX rules:** A badge shows a number, never a dot with no meaning. The Post button goes to the quick box, not the full editor — the short path is the default.
- **Validation:** Typecheck and the full unit suite green; verified in the running app at desktop and phone width in both themes.

### 11 · Documentation

#### Living implementation artifact — Validated

- **Brief:** First deliverable
- **Exists today:** The docs microsite documents design and components; implementation status lived in ad-hoc markdown files.
- **Changing:** This page: /docs/implementation rendered from `src/lib/docs/implementation-registry.ts`, with a generated markdown twin — one source of truth, updated continuously through the workstream.
- **Surfaces:** `/docs/implementation`, `src/lib/docs/implementation-registry.ts`, `docs/site/implementation.md`
- **User benefit:** Anyone can see at a glance what is changing, why it matters, and how far along it actually is.
- **Approach:** Same governance pattern as the component registry: typed source, rendered page, generated markdown, drift-guarded by tests.
- **Validation:** Living since Group 1 and updated at every milestone: /docs/implementation renders from the typed registry, the markdown twin is drift-guarded (npm run docs:implementation), and the shareable board republishes from the same source. Statuses audited against the repository at each commit.

#### Code-derived documentation expansion — Validated

- **Brief:** AD, B3
- **Exists today:** components.md is generated from the registry; search, vehicles, notifications, activity schema, jobs and Stripe lifecycle have no authored docs pages.
- **Changing:** Docs pages (with markdown twins) for search behavior, the vehicle catalog, fitment, the activity document schema and block types, notifications, Selling IA, background jobs and admin operations — derived from typed registries wherever one exists.
- **Surfaces:** `/docs`, `docs/site/`, `src/lib/docs/`
- **User benefit:** The systems being built in this workstream are approachable instead of mysterious.
- **Approach:** Extend SITE_PAGES; generate from source-of-truth registries (blocks, notification kinds, domain states) where possible. Fumadocs evaluated: not adopted — the code-generated architecture is the asset (decision recorded).
- **Decisions:** Fumadocs evaluated and not adopted: the registry-driven generation + markdown-twin architecture is the asset; a docs framework would replace exactly the part that works. Three generated surfaces now share one governance pattern: components.md, implementation.md, and the systems docs (notification kinds + domain states).
- **Validation:** Six new docs shipped and served through the microsite's md routes (verified 200 as admin): search (§B3 in full), vehicles (sources + licenses + attribution), activity schema + block table, notifications (GENERATED kinds table), domain states (GENERATED transition tables), operations (jobs decision, diagnostics, admin, Selling IA, analytics). Generated blocks drift-guarded by system-docs.test.ts (npm run docs:systems).

### 12 · Analytics & observability

#### Product analytics behind an abstraction — Validated

- **Brief:** AE
- **Exists today:** Sentry-style error monitoring exists; there is no product analytics at all.
- **Changing:** A typed event taxonomy (vehicle added, update published, listing published, search performed, saved search created, offer submitted, checkout started, purchase completed…) behind a provider abstraction, with PostHog as the optional self-hostable sink and strict masking rules.
- **Surfaces:** `src/lib/analytics/`, `instrumented flows`
- **User benefit:** Product decisions can be made from what users actually do — without capturing anything sensitive.
- **Approach:** capture() no-ops without configuration; payment/address/message/evidence surfaces excluded by construction; DRVN never requires a paid service to run.
- **Decisions:** Server-side only: no autocapture, no session replay, no client SDK — the typed union is the privacy review gate; events carry ids and coarse counts, never free text/addresses/messages/evidence. Feature flags are env-based (FLAG_X) behind flagEnabled() — PostHog flags can slot in behind the same function when rollout targeting is actually needed.
- **Validation:** Typed taxonomy behind capture() — unit-tested (no-op without POSTHOG_KEY, correct payload when configured, failure never throws, env flags). Fourteen flows instrumented server-side: vehicle added, update published, listing started/published, search (lane+results, first page only), fitment filter, saved-search created/alert, offer, checkout started, purchase completed (webhook settle), dispatch, dispute opened.

### 13 · Future-ready architecture

#### Explicit domain state definitions — Validated

- **Brief:** AG, AH
- **Exists today:** Statuses for orders/offers/listings/disputes/refunds/transfers are enforced piecemeal across SQL and actions; no single TypeScript definition exists.
- **Changing:** Typed state/transition definitions per domain used for developer clarity, UI mapping, docs generation and tests — with PostgreSQL protections staying authoritative. Medusa-style step/compensation ideas borrowed only where they clarify existing workflows.
- **Surfaces:** `src/lib/domain/`, `/docs`
- **User benefit:** "Which states can reach which states" becomes one readable definition instead of archaeology.
- **Approach:** Declarative transition maps + doc generation; no state-machine framework.
- **Decisions:** Deliberately not a state-machine framework: PostgreSQL stays authoritative; the maps are documentation with teeth (consistency tests + generated docs). Medusa/Vendure informed the shape only.
- **Validation:** Transition maps for orders/listings/offers/transfers/refunds with per-domain enforcement notes; 5 unit tests (no dangling targets, terminals exist, covers every status the product's own grouping knows, load-bearing money rules, moderation-only takedown clearing); generated into docs/site/domain-states.md.

#### Background-job architecture decision — Validated

- **Brief:** AI
- **Exists today:** pg_cron + durable queue tables + bearer-gated worker routes handle money and GC; new non-financial work (search indexing, saved-search matching) needs a home.
- **Changing:** A documented decision: whether the existing Postgres pattern covers the new async workloads or PGMQ earns its place. No Redis/Trigger.dev/Inngest without a justifying workload; money workers untouched.
- **Surfaces:** `supabase/`, `src/app/api/jobs/`
- **User benefit:** Async work stays as durable and observable as the money path already is.
- **Approach:** Extend the proven worker-route + queue-table pattern first; decision recorded here.
- **Validation:** Decision recorded (docs/site/operations.md): the pg_cron + worker-route + durable-queue-table pattern absorbs the new workloads (search sync fire-and-forget + scripted reindex; saved-search matching as a worker pass). PGMQ not adopted — no workload needs SQS semantics; Redis/Trigger.dev/Inngest not introduced; money workers untouched.

#### The DRVN agent — In progress

- **Brief:** PRD §4.9 (AG-1…AG-12) · agent plan A2–A3
- **Exists today:** A2 foundation and A3a/A3b on main and shared dev: the agent tables, the NOLOGIN agent_worker role, admin kill switches, beta steps opened from /admin/agent, per-member and global model spend caps, daily first-party measures (agent_metrics_daily, docs/site/agent-measures.md), one member's agent for support with an audited chat gate, and agent provenance on admin orders. The seller agent (Let DRVN handle offers) and buyer agent (Negotiate for me) stay closed until their steps open. A3c: the agent chat on /agent (one model turn per message, stored server-side, listing result cards resolved through the member's own read, starters, a first-visit intro), behind the chat step; "Update my build" from words or a pasted link as a confirm card (Confirm saves through the mods editor's save with its replace semantics, Edit opens the editor filled in, then List the old one); the desktop side panel beside any page and Ask your agent on listings and your cars. A3d, behind the jobs step: Paste your build (a pasted list becomes lines from the editor's own parser, as a confirm card) and List the parts that came off (cards that open the sell form prefilled).
- **Changing:** One agent per member that negotiates offers within limits the member sets, then chats and does garage and listing jobs, one at a time. Built on typed capabilities, mandates, tasks and a narrow worker role, with admin off switches.
- **Surfaces:** `src/lib/capabilities/`, `src/lib/ai/`, `src/lib/agent/`, `/admin/agent`, `/api/jobs/agent`, `/agent`, `BottomNav`, `SidePanel`
- **User benefit:** The tedious work between "I want this" and "done" gets done for you, inside limits you set, and every task still works without the agent.
- **Approach:** Rules set prices, never the model; agents speak only to their owner; no auto-accept or automatic payment at launch. The shapes are fixed in docs/decisions/agent-foundations.md.
- **Depends on:** negotiation-v2
- **Validation:** A2: supabase/tests/agent_worker_guard.sql (the security regression set) run as the real worker role. A3a: offer-history.test.ts (roles, via agent, the owner-only reason), agent_notifications_guard.sql, and e2e/seller-agent.spec.ts — a person against the seller agent: counters within limits, no minimum in anything the buyer can load, Needs you accept, Cancel before checkout only before checkout. A3c: e2e/agent-chat.spec.ts — a member's message and the agent's reply are stored, come back on reload, and members can't write chat rows; the evals check the reply's result cards. e2e/agent-build.spec.ts — a drafted build change saves only on Confirm, replaces the old part (kept, marked removed), offers List the old one, and Edit opens the editor unsaved; the evals check a draft writes nothing and a link is read only when the member pasted it. e2e/agent-jobs.spec.ts — a pasted build saves only on Confirm with its confidence kept, and a part that came off opens the sell form; the evals check the job tools reach the model only once the jobs step is open.
- **Docs:** docs/decisions/agent-foundations.md, docs/plans/2026-10-agent-and-graph-plan.md, docs/decisions/agent-data-rules.md

### 14 · Deferred / not pursuing

#### Mobile Quick Capture — Deferred

- **Brief:** X
- **Exists today:** —
- **Changing:** Not built: needs more product thinking; the improved responsive composer and media flow cover the need for now.
- **User benefit:** —
- **Approach:** —
- **Validation:** Intentionally deferred by the brief.

#### Maintenance/logbook, OBD, telemetry, snapshots & diffs — Deferred

- **Brief:** Y, AJ
- **Exists today:** —
- **Changing:** Not built: maintenance logbooks, service schedules, fuel logs, registration/inspection tracking, OBD/telemetry, GPS, automatic build snapshots, historical build diffs.
- **User benefit:** DRVN stays marketplace-first instead of becoming a vehicle-logging product.
- **Approach:** —
- **Validation:** Intentionally excluded by the brief.

#### Physical-part provenance ledger — Deferred

- **Brief:** AJ
- **Exists today:** Listings keep ordinary relational context (source car).
- **Changing:** No installed→removed→sold→new-car event ledger; provenance is not a primary platform feature.
- **User benefit:** —
- **Approach:** —
- **Validation:** Intentionally excluded by the brief.

#### Listing quality / trust completeness model — Deferred

- **Brief:** AJ
- **Exists today:** Reviews, ratings and condition grading already carry trust.
- **Changing:** No completeness scores, trust checklists or opaque trust numbers.
- **User benefit:** —
- **Approach:** —
- **Validation:** Intentionally excluded by the brief.

#### Build completeness prompts — Deferred

- **Brief:** AA
- **Exists today:** —
- **Changing:** No completion meters, checklists or gamified scores now; contextual suggestions may come later.
- **User benefit:** —
- **Approach:** —
- **Validation:** Intentionally deferred by the brief.

#### Push notifications — Deferred

- **Brief:** D
- **Exists today:** DRVN is web-first; in-app notifications exist.
- **Changing:** Push delivery is a future channel behind the notification boundary, not built now.
- **User benefit:** —
- **Approach:** —
- **Validation:** Intentionally deferred by the brief.

<!-- END GENERATED: implementation-registry -->
