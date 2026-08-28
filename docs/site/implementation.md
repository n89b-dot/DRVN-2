# Implementation — the living record

> **What this is.** The live status of the August 2026 platform-evolution
> workstream. The typed source of truth is
> `src/lib/docs/implementation-registry.ts`; the visual page at
> `/docs/implementation` and the block below both render from it. Statuses are
> honest: *Implemented* means the code exists and compiles green; *Validated*
> means the relevant tests and responsive/visual checks actually ran.

<!-- BEGIN GENERATED: implementation-registry (npm run docs:implementation) -->

Source of truth: `src/lib/docs/implementation-registry.ts` (rendered live at `/docs/implementation`).

**Progress:** 43 initiatives — 13 planned · 1 in progress · 6 implemented · 15 validated · 7 deferred · 1 blocked externally

### 01 · Engineering foundations

#### Protect the production branch — Blocked externally

- **Brief:** A1
- **Exists today:** CI runs typecheck/lint/unit/build plus four SQL guards, but `main` is not branch-protected — a direct push can bypass every check.
- **Changing:** Require pull requests into `main` with the existing verify + SQL-guard jobs as required status checks; document the exact GitHub configuration.
- **Surfaces:** `.github/workflows/ci.yml`, `GitHub repository settings`
- **User benefit:** The safety machinery that already exists cannot be accidentally skipped, so a broken money path can't land on main unnoticed.
- **Approach:** Attempted via `gh api`: both branch protection and rulesets return 403 on this private Free-plan repository. The exact ruleset (PRs required, `verify` + `sql-guard` required checks, no force push) is documented in the production runbook §8 for one-click application once available.
- **Validation:** Configuration attempt executed and refused by GitHub (403 requires Pro/public); documentation shipped.
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
- **Validation:** 8/8 passing locally against the real Stripe test API (intents + metadata, confirm, decline, create/refund idempotency replay, over-refund refusal, refund metadata attribution). CI job `stripe-integration` gated on STRIPE_TEST_SECRET_KEY.
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

### 03 · Vehicle identity & fitment

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

### 04 · Selling

#### Selling workspace & IA — Planned

- **Brief:** J
- **Exists today:** Seller operations are scattered: /listings, /offers, /orders (mixed with purchases), payouts inside /settings#payouts, questions inside listing pages; the marketplace family nav spans buyer and seller surfaces.
- **Changing:** A coherent Selling section (Overview · Listings · Offers · Orders · Payouts · performance where useful) with deliberately designed desktop and mobile IA, leaving Marketplace purely for discovery/buying.
- **Surfaces:** `src/components/ui/nav-routes.ts`, `src/components/ui/app-shell.tsx`, `src/app/(product)/`
- **User benefit:** Occasional sellers can find everything selling-related in one place; power sellers get an operations home instead of hopping between five routes.
- **Approach:** New route group/section composed almost entirely from existing surfaces and registry components; nav register updated for rail + Index sheet; IA decision recorded here after Mobbin reference review.
- **UX rules:** Do not duplicate Marketplace browsing. Mobile Index sheet must not bloat.
- **Validation:** Not yet validated.

#### Remove from Build → Sell this part — Validated

- **Brief:** I
- **Exists today:** Build lines can deep-link to /sell?car=&mod= and mod_items carry linked_listing_id, but removing a mod and selling it are unconnected acts.
- **Changing:** Removing (or deciding to sell) a modification offers a clean `Sell this part` path that prefills source car, brand, product, part number and category from data DRVN already holds.
- **Surfaces:** `/garage/[id]/edit`, `/sell`, `src/app/(product)/sell/`
- **User benefit:** Turning a real build change into a listing takes one step instead of re-typing everything the platform already knows.
- **Approach:** Extend the existing ?car=&mod= prefill contract to carry the full mod context; contextual action on the mods editor and the removed-part composer block. No provenance ledger.
- **UX rules:** A useful connection, not a ledger — ordinary relational data only.
- **Validation:** Three bridges live: build-line 'Sell it' (pre-existing), ?car=&mod= prefill carrying title/category/part number + inferred fitment row, and the composer's removed-mod block linking 'Sell this part →'. Exercised via the sell-form fitment prefill path; no ledger machinery anywhere.

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

#### Annotated showcase image — Planned

- **Brief:** U
- **Exists today:** Car photos are a plain gallery; nothing links an image region to build data.
- **Changing:** An optional advanced feature on one (or very few) selected showcase images: hotspots linked to existing build entries, revealed through an `Explore this build`-style interaction.
- **Surfaces:** `/cars/[slug]`, `/garage/[id]/edit`
- **User benefit:** A build becomes explorable through the car itself — tap the wheel, see the wheel spec.
- **Approach:** Percentage-positioned hotspots referencing mod_items, accessible keyboard/touch interaction; explicitly not a post block, never on every photo.
- **UX rules:** Default photo experience stays clean. Not a marketplace navigation system.
- **Validation:** Not yet validated.

#### Build Evolution timeline — Planned

- **Brief:** V
- **Exists today:** Activity is a list; there is no visual chronology of the car.
- **Changing:** A visual chronological story derived from dated updates and their images — representative photos, major titles, thoughtful transitions. No snapshots, no diffs, no extra data entry.
- **Surfaces:** `/cars/[slug]`
- **User benefit:** Visitors can watch a build evolve instead of scrolling a feed backwards.
- **Approach:** Derived entirely from existing posts/images; motion respects reduced-motion.
- **Validation:** Not yet validated.

#### Passive creation suggestions — Planned

- **Brief:** W
- **Exists today:** Editing the build or adding photos never connects to posting an update.
- **Changing:** After a meaningful build edit or a batch of new photos, a quiet inline affordance offers `Create an update from these changes` / `Share these in an update`, prepopulating the composer when chosen.
- **Surfaces:** `/garage/[id]/edit`, `garage gallery`
- **User benefit:** Real changes become content with one click — and the affordance is entirely ignorable.
- **Approach:** Inline dismissible row, no modals, no repeat nagging; state remembered so it doesn't re-offer.
- **Depends on:** unified-composer
- **UX rules:** No popups. Ignorable forever without cost.
- **Validation:** Not yet validated.

#### Shareable build/update cards — Planned

- **Brief:** AB
- **Exists today:** Car pages have OpenGraph metadata with car imagery; no designed share card exists.
- **Changing:** Automatically generated build and update cards in DRVN's design language for social/OpenGraph use — no manual card workflow.
- **Surfaces:** `/cars/[slug]`, `activity posts`, `OG image generation`
- **User benefit:** Sharing a build off-platform looks intentional instead of like a screenshot.
- **Approach:** Data-driven OG image route composing existing car/update data.
- **Validation:** Not yet validated.

#### Garage hierarchy pass — Planned

- **Brief:** Z
- **Exists today:** The garage sheet works; density and hierarchy have grown organically.
- **Changing:** Only reorganize where existing information can form a clearer hierarchy (current car, recent update, selling activity, pending actions) without adding density. Otherwise preserve.
- **Surfaces:** `/garage`
- **User benefit:** Owners see what matters about their car first — with nothing new to learn.
- **Approach:** Simplify-before-add rule; no intelligence dashboard.
- **Validation:** Not yet validated.

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

#### Operations case model — Planned

- **Brief:** K1
- **Exists today:** Disputes, reports, recoveries and audit exist as separate queues; nothing aggregates a problem into one assignable unit of work.
- **Changing:** A case layer over disputes/reports: status, priority, assignment/claim, labels, internal notes, saved views, SLA awareness — operational tooling, not a CRM.
- **Surfaces:** `/admin`, `supabase/migrations/`, `src/lib/admin/`
- **User benefit:** Admin work becomes claimable and trackable instead of re-derived from queues each session.
- **Approach:** Case table referencing existing objects; audited actions; module-boundary refactor where domains grew large.
- **Validation:** Not yet validated.

#### Dispute evidence dossier — Planned

- **Brief:** K2
- **Exists today:** Dispute facts are spread across the order sheet, evidence viewer, webhook stream and messages.
- **Changing:** One composed administrative view: listing snapshot, condition, photos, offer/order, payment and shipping timelines, messages, evidence, parties, prior actions.
- **Surfaces:** `/admin/orders/[id]`, `/admin/disputes`
- **User benefit:** An admin resolves a dispute from one coherent dossier instead of mentally reconstructing the transaction.
- **Approach:** Pure composition of existing data plus the correlation timeline from transaction-diagnostics.
- **Depends on:** transaction-diagnostics
- **Validation:** Not yet validated.

### 10 · Design system

#### Storybook beside Livesheet — Planned

- **Brief:** AC
- **Exists today:** The registry + /docs/components specimens document components, but there is no isolated-state lab (loading/error/long-content/mobile per component).
- **Changing:** A local/static Storybook wired to the component registry, with stories prioritized for foundational components, commerce states, composer blocks, media controls, vehicle picker, saved-search and Selling/Admin components; a11y checks where practical.
- **Surfaces:** `new .storybook/`, `src/components/`
- **User benefit:** Every component's states are visible and testable in isolation before they ship into screens.
- **Approach:** Storybook 9 static build; no paid visual-regression services; registry linkage documented.
- **Validation:** Not yet validated.

### 11 · Documentation

#### Living implementation artifact — In progress

- **Brief:** First deliverable
- **Exists today:** The docs microsite documents design and components; implementation status lived in ad-hoc markdown files.
- **Changing:** This page: /docs/implementation rendered from `src/lib/docs/implementation-registry.ts`, with a generated markdown twin — one source of truth, updated continuously through the workstream.
- **Surfaces:** `/docs/implementation`, `src/lib/docs/implementation-registry.ts`, `docs/site/implementation.md`
- **User benefit:** Anyone can see at a glance what is changing, why it matters, and how far along it actually is.
- **Approach:** Same governance pattern as the component registry: typed source, rendered page, generated markdown, drift-guarded by tests.
- **Validation:** Registry + page + markdown twin under construction.

#### Code-derived documentation expansion — Planned

- **Brief:** AD, B3
- **Exists today:** components.md is generated from the registry; search, vehicles, notifications, activity schema, jobs and Stripe lifecycle have no authored docs pages.
- **Changing:** Docs pages (with markdown twins) for search behavior, the vehicle catalog, fitment, the activity document schema and block types, notifications, Selling IA, background jobs and admin operations — derived from typed registries wherever one exists.
- **Surfaces:** `/docs`, `docs/site/`, `src/lib/docs/`
- **User benefit:** The systems being built in this workstream are approachable instead of mysterious.
- **Approach:** Extend SITE_PAGES; generate from source-of-truth registries (blocks, notification kinds, domain states) where possible. Fumadocs evaluated: not adopted — the code-generated architecture is the asset (decision recorded).
- **Validation:** Not yet validated.

### 12 · Analytics & observability

#### Product analytics behind an abstraction — Planned

- **Brief:** AE
- **Exists today:** Sentry-style error monitoring exists; there is no product analytics at all.
- **Changing:** A typed event taxonomy (vehicle added, update published, listing published, search performed, saved search created, offer submitted, checkout started, purchase completed…) behind a provider abstraction, with PostHog as the optional self-hostable sink and strict masking rules.
- **Surfaces:** `src/lib/analytics/`, `instrumented flows`
- **User benefit:** Product decisions can be made from what users actually do — without capturing anything sensitive.
- **Approach:** capture() no-ops without configuration; payment/address/message/evidence surfaces excluded by construction; DRVN never requires a paid service to run.
- **Validation:** Not yet validated.

### 13 · Future-ready architecture

#### Explicit domain state definitions — Planned

- **Brief:** AG, AH
- **Exists today:** Statuses for orders/offers/listings/disputes/refunds/transfers are enforced piecemeal across SQL and actions; no single TypeScript definition exists.
- **Changing:** Typed state/transition definitions per domain used for developer clarity, UI mapping, docs generation and tests — with PostgreSQL protections staying authoritative. Medusa-style step/compensation ideas borrowed only where they clarify existing workflows.
- **Surfaces:** `src/lib/domain/`, `/docs`
- **User benefit:** "Which states can reach which states" becomes one readable definition instead of archaeology.
- **Approach:** Declarative transition maps + doc generation; no state-machine framework.
- **Validation:** Not yet validated.

#### Background-job architecture decision — Planned

- **Brief:** AI
- **Exists today:** pg_cron + durable queue tables + bearer-gated worker routes handle money and GC; new non-financial work (search indexing, saved-search matching) needs a home.
- **Changing:** A documented decision: whether the existing Postgres pattern covers the new async workloads or PGMQ earns its place. No Redis/Trigger.dev/Inngest without a justifying workload; money workers untouched.
- **Surfaces:** `supabase/`, `src/app/api/jobs/`
- **User benefit:** Async work stays as durable and observable as the money path already is.
- **Approach:** Extend the proven worker-route + queue-table pattern first; decision recorded here.
- **Validation:** Not yet validated.

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

#### AI authoring/enrichment features — Deferred

- **Brief:** AJ
- **Exists today:** —
- **Changing:** No automatic mod extraction, AI rewriting, image classification, cover selection or build advice in this workstream; the architecture merely stays compatible.
- **User benefit:** —
- **Approach:** —
- **Validation:** Intentionally deferred by the brief.

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
