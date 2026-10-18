/**
 * Living implementation registry — the typed source of truth for the
 * August 2026 platform-evolution workstream (the "DRVN Platform Evolution"
 * brief). `/docs/implementation` renders from this file, and the markdown
 * twin block in `docs/site/implementation.md` is generated from it
 * (`npm run docs:implementation`, guarded by implementation-docs.test.ts) —
 * there is exactly one place implementation status lives.
 *
 * Statuses are honest: an initiative is "implemented" only when the code
 * exists and compiles green, and "validated" only after the relevant tests
 * and responsive/visual checks have actually run. A file existing is not
 * completion.
 */

export type InitiativeStatus =
  | "planned"
  | "in-progress"
  | "implemented"
  | "validated"
  | "deferred"
  | "blocked-external";

export const STATUS_LABEL: Record<InitiativeStatus, string> = {
  planned: "Planned",
  "in-progress": "In progress",
  implemented: "Implemented",
  validated: "Validated",
  deferred: "Deferred",
  "blocked-external": "Blocked externally",
};

/** Chip tone per status, on the existing Livesheet chip recipes. */
export const STATUS_CHIP: Record<InitiativeStatus, string> = {
  planned: "chip chip--spent",
  "in-progress": "chip chip--live",
  implemented: "chip chip--info",
  validated: "chip chip--ok",
  deferred: "chip chip--ink",
  "blocked-external": "chip chip--warn",
};

export type GroupId =
  | "foundations"
  | "discovery"
  | "vehicle-identity"
  | "selling"
  | "composer"
  | "media"
  | "garage"
  | "notifications"
  | "admin"
  | "design-system"
  | "documentation"
  | "analytics"
  | "future-architecture"
  | "deferred";

export const GROUPS: { id: GroupId; index: string; title: string; sub: string }[] = [
  { id: "foundations", index: "01", title: "Engineering foundations", sub: "Branch/CI hardening, authorization boundaries, transaction diagnostics." },
  { id: "discovery", index: "02", title: "Marketplace discovery", sub: "Search architecture, saved searches, part identity for retrieval." },
  { id: "vehicle-identity", index: "03", title: "Vehicle identity & fitment", sub: "Canonical Add Car, vehicle catalog, lightweight fitment." },
  { id: "selling", index: "04", title: "Selling", sub: "A coherent seller workspace and the Build → Marketplace connection." },
  { id: "composer", index: "05", title: "Build Story Composer", sub: "One progressively enhanced editor with automotive blocks." },
  { id: "media", index: "06", title: "Media & galleries", sub: "Upload queue, reorder, framing, normalization — over the existing lifecycle." },
  { id: "garage", index: "07", title: "Garage & build experience", sub: "Showcase, Build Evolution, passive suggestions, share cards." },
  { id: "notifications", index: "08", title: "Notifications", sub: "A delivery-ready domain model for alerts that never nag." },
  { id: "admin", index: "09", title: "Admin operations", sub: "Cases, dispute dossiers, module boundaries." },
  { id: "design-system", index: "10", title: "Design system", sub: "Storybook beside Livesheet, registry governance for new components." },
  { id: "documentation", index: "11", title: "Documentation", sub: "Code-derived docs for search, vehicles, activity schema, selling, operations." },
  { id: "analytics", index: "12", title: "Analytics & observability", sub: "Product events behind an abstraction; privacy first." },
  { id: "future-architecture", index: "13", title: "Future-ready architecture", sub: "Domain states, background-job decisions, extension paths." },
  { id: "deferred", index: "14", title: "Deferred / not pursuing", sub: "Explicitly excluded scope, recorded so it stays excluded." },
];

export type Initiative = {
  /** Stable kebab-case id (anchor on the page). */
  id: string;
  name: string;
  group: GroupId;
  status: InitiativeStatus;
  /** Brief section reference(s), e.g. "A1". */
  brief: string;
  /** What the repository does today (baseline, kept honest as it changes). */
  existsToday: string;
  /** What this initiative changes. */
  changing: string;
  /** Routes/components/modules touched. */
  surfaces: string[];
  /** The benefit in user terms — never schema-speak. */
  benefit: string;
  /** Technical approach in one or two sentences. */
  approach: string;
  /** Ids of initiatives this depends on. */
  dependsOn?: string[];
  /** Non-negotiable UX rules for this initiative. */
  uxRules?: string[];
  /** What validation has actually run. */
  validation: string;
  /** Relevant docs (repo paths or /docs routes). */
  docs?: string[];
  /** Decisions of record made while implementing. */
  decisions?: string[];
  /** For blocked-external only: the exact external step required. */
  externalStep?: string;
};

export const IMPLEMENTATION_REGISTRY: Initiative[] = [
  // ── 01 · Engineering foundations ────────────────────────────────────────
  {
    id: "branch-protection",
    name: "Protect the production branch",
    group: "foundations",
    status: "blocked-external",
    brief: "A1",
    existsToday:
      "CI runs typecheck/lint/unit/build plus four SQL guards, but `main` is not branch-protected — a direct push can bypass every check.",
    changing:
      "Require pull requests into `main` with the existing verify + SQL-guard jobs as required status checks; document the exact GitHub configuration.",
    surfaces: [".github/workflows/ci.yml", "GitHub repository settings"],
    benefit:
      "The safety machinery that already exists cannot be accidentally skipped, so a broken money path can't land on main unnoticed.",
    approach:
      "Attempted via `gh api`: both branch protection and rulesets return 403 on this private Free-plan repository. The exact ruleset (PRs required, `verify` + `sql-guard` required checks, no force push) is documented in the production runbook §8 for one-click application once available.",
    validation:
      "Configuration attempt executed and refused by GitHub (403 requires Pro/public); documentation shipped. Re-checked 1 Oct 2026: `main` still reports protected:false. The required check is now the aggregate `release-gate` job (it needs verify, secrets, secrets-full, sql-guard, e2e and stripe-integration to have run and passed; secrets is the incremental PR/push scan, secrets-full the full-history + tracked-tree scan), not verify + sql-guard alone.",
    docs: ["docs/production-runbook.md"],
    externalStep:
      "Upgrade the GitHub account to Pro (or make the repo public), then run the documented `gh api` ruleset call in production-runbook §8.",
  },
  {
    id: "commerce-ci",
    name: "Real commerce integration coverage",
    group: "foundations",
    status: "validated",
    brief: "A2",
    existsToday:
      "Vitest units, four SQL guards and a Playwright golden path run in CI; Stripe test-mode integration never runs anywhere, and E2E skips loudly without secrets.",
    changing:
      "A Stripe test-mode integration harness (purchase, multi-seller cart, failed payment, webhook replay, transfer, retry, refund, partial refund, dispute, payout-disabled seller) wired as CI jobs that skip explicitly when secrets are absent.",
    surfaces: ["e2e/", ".github/workflows/ci.yml", "src/lib/payments/"],
    benefit:
      "The paths that move real money are proven against real Stripe test infrastructure instead of being assumed correct.",
    approach:
      "Vitest integration suite driving the payment provider + webhook dispatcher against Stripe test keys; secrets documented; skipped coverage stated in the CI summary — never faked.",
    decisions: [
      "Suite lives in tests/stripe (own vitest config) so `npm test` stays network-free; it throws on non-sk_test_ keys and self-skips loudly without one.",
      "Multi-seller settlement/transfers/disputes stay with the stub-mode golden path; the CI summary now names that gap on every build instead of the old blanket 'never runs' line.",
    ],
    validation:
      "8/8 passing locally against the real Stripe test API (intents + metadata, confirm, decline, create/refund idempotency replay, over-refund refusal, refund metadata attribution). CI job `stripe-integration` gated on STRIPE_TEST_SECRET_KEY. Superseded 1 Oct 2026: CI now runs every `supabase/tests/*_guard.sql` file (about 50), the full browser suite on a local `supabase start` stack (Realtime included), and `release-gate` fails unless e2e and stripe-integration actually ran — nothing self-skips.",
    docs: ["tests/stripe/README.md"],
  },
  {
    id: "authz-hardening",
    name: "Authorization boundaries & future roles groundwork",
    group: "foundations",
    status: "validated",
    brief: "L",
    existsToday:
      "Admin membership lives in `admin_users` with `is_admin()` RLS policies, but admin mutations use the service role, so the admin/viewer distinction is TypeScript-enforced only.",
    changing:
      "A centralized capability check on every admin action path, moving enforcement toward the database where practical (scoped RPCs / role checks), plus a documented extension path for shops, staff and specialized moderators — prepared, not launched.",
    surfaces: ["src/lib/admin/", "supabase/migrations/", "/admin"],
    benefit:
      "A read-only admin genuinely cannot mutate anything, and future shop/staff accounts have a place to land without a rewrite.",
    approach:
      "Capability map keyed by admin role, asserted inside `auditedAction` before any service-role work; DB-side role assertion where the call shape allows; no OpenFGA/Cerbos.",
    decisions: [
      "0040: `assert_admin_actor()` raises unless the actor holds the full admin role — auditedAction calls it before every mutation, so the database now refuses a viewer even on the service role; the audit-log trigger additionally refuses non-admin actors for every role including service_role.",
      "src/lib/admin/capabilities.ts is the extension seam for shops/staff/moderators: action families → required role today, a capability argument on assert_admin_actor when finer roles exist. No speculative role tables.",
    ],
    validation:
      "Migration 0040 applied twice (idempotent, self-checks pass); admin_guard.sql extended with four actor-enforcement assertions and executed green against the live dev schema (rolled back); capabilities unit tests cover every audit action family.",
    docs: ["supabase/migrations/0040_admin_actor_enforcement.sql", "src/lib/admin/capabilities.ts"],
  },
  {
    id: "transaction-diagnostics",
    name: "Transaction correlation & diagnostics",
    group: "foundations",
    status: "implemented",
    brief: "AF",
    existsToday:
      "Understanding one order means reading orders, payments, webhook_events, transfer_intents, refund_operations and Sentry separately.",
    changing:
      "A correlation identity threaded from checkout through Stripe metadata, settlement, transfers and refunds, surfaced as a timeline in the admin order sheet.",
    surfaces: ["src/lib/payments/", "/admin/orders/[id]", "/api/stripe/webhook"],
    benefit:
      "An admin can answer \"why is this order in this state?\" from one screen instead of five tables.",
    approach:
      "Correlation ID persisted on order/payment rows and stamped into Stripe metadata; a composed diagnostics view in admin. No heavy OpenTelemetry now.",
    decisions: [
      "0039 adds orders.correlation_id, stamped by both checkout paths and mirrored into PaymentIntent metadata; deliberately never threaded through money RPCs — an observability identity, not a lock.",
      "The admin order sheet gained a Transaction timeline composing order stamps, retained webhook events (matched on the intent reference), transfer-intent lifecycle, refund operations and audit rows — built by a pure, unit-tested builder (lib/admin/diagnostics.ts).",
    ],
    validation:
      "Migration 0039 applied twice (self-checks pass); timeline builder covered by 3 unit tests (chronology, refund lifecycle incl. recovery, future clearing-window truthfulness); Stripe integration test asserts correlation_id lands in intent metadata. Admin UI render check pending the Group 10 visual pass.",
  },

  // ── 02 · Marketplace discovery ──────────────────────────────────────────
  {
    id: "search-architecture",
    name: "Automotive search architecture",
    group: "discovery",
    status: "validated",
    brief: "B1–B2",
    existsToday:
      "Marketplace search is Postgres `ilike` over title/description/compatibility/part_number, with a separator-insensitive `part_number_compact` column (0033) and a pg_trgm helper (0008).",
    changing:
      "A `SearchProvider` abstraction with the Postgres implementation as always-working fallback and an optional self-hosted engine adapter; two conceptual lanes — fuzzy human discovery vs strict identifier matching that is never fuzzy-corrected.",
    surfaces: ["src/lib/marketplace/", "/marketplace", "supabase/migrations/"],
    benefit:
      "\"mk8 intake\" and \"11-42-7-566-327\" both find the right parts, without the marketplace depending on any hosted service.",
    approach:
      "Provider interface + Postgres FTS/trigram implementation now; Typesense evaluated as the optional engine (alphanumeric typo control fits part numbers); indexing contract + reindex tooling shipped regardless of engine availability.",
    uxRules: ["Search UI stays one box + existing filters — engine complexity is never exposed."],
    decisions: [
      "Two lanes share one pure classifier: single-token digit-bearing terms are identifiers (exact compact substring, one interchange-graph hop, never fuzzy); everything else rides the pg_trgm RPC with title-first ranking.",
      "Typesense chosen over Meilisearch for per-field alphanumeric typo control (num_typos=0 on part_numbers); reached over plain fetch — no client dependency, optional env config, every failure falls back to Postgres.",
      "Providers only produce candidate id sets; the canonical Postgres query still applies every filter and sort — no commerce decision touches an index.",
      "Per-listing index sync is fire-and-forget on publish/edit/status; full rebuilds via scripts/reindex-search.mjs.",
    ],
    validation:
      "Query classifier unit-tested against the brief's example queries; feature-regression e2e green through the provider (part-number search included) on the dev server; typecheck/lint/unit green. Typesense adapter + reindex tooling ship configured-off.",
  },
  {
    id: "saved-searches",
    name: "Saved searches & alerts",
    group: "discovery",
    status: "validated",
    brief: "C",
    existsToday: "No saved-search model exists anywhere; /saved covers listings, cars, sellers and posts only.",
    changing:
      "Users can save the marketplace state they built (query, category, price, condition, location, fitment/garage car) from an unobtrusive `Save search` action, and separately opt into alerts.",
    surfaces: ["/marketplace", "/saved", "supabase/migrations/", "notifications"],
    benefit:
      "A buyer hunting a specific part can come back to new matching inventory without rebuilding filters — and hears about it only if they asked to.",
    approach:
      "`saved_searches` table with RLS; matching evaluated on a worker pass feeding the existing notifications system; save and alert opt-in are separate actions.",
    dependsOn: ["notification-domain"],
    uxRules: [
      "Never prompt to save a search.",
      "Saving is silent; alerts are a separate explicit opt-in, easy to disable.",
      "New matches surface through existing home/notification patterns — no disruptive messaging.",
    ],
    decisions: [
      "Saving and alerting are separate columns and separate gestures; duplicate saves quietly succeed; 50-search cap enforced by a DB trigger.",
      "The worker (/api/jobs/saved-searches, CRON_SECRET) raises at most one notification per search per pass — a summary, never a per-listing flood; 'fits my garage' searches reuse the marketplace's exact fitment matcher.",
    ],
    validation:
      "Full loop verified live: silent save from the marketplace UI (toast receipt), row + alert toggle on /saved, worker baseline pass, a new matching listing produced exactly one summary notification with a deep link; first-pass baseline prevents pre-opt-in alerts. RLS guard (cross-user invisibility, forge refusal) executed green live; 0044 applied twice.",
  },
  {
    id: "explore-search",
    name: "Unified Explore search",
    group: "discovery",
    status: "implemented",
    brief: "Explore search brief (Aug 2026)",
    existsToday:
      "Search existed only for marketplace listings; /explore was a browse-only feed with a tab param and no query surface.",
    changing:
      "One coherent DRVN search ecosystem: Explore gains free-text search with grouped autocomplete over Builds, Updates, Accounts and Parts, plus a deliberately small Advanced Search (vehicle, owner-location for Builds, the marketplace refinement set for Parts). Parts reuse marketplace search wholesale; browse mode stays the untouched feed.",
    surfaces: [
      "/explore",
      "src/lib/explore/search/",
      "src/app/api/explore/suggest/",
      "src/lib/marketplace/query.ts",
      "supabase/migrations/0057_explore_search.sql",
    ],
    benefit:
      "\"Bilstein B16 Golf R\" finds the build carrying that mod, \"@kaito\" finds the person, and a part number still hits exact-identifier semantics — all from one search field, shareable as a URL.",
    approach:
      "The marketplace provider doctrine extended per object family: three word-wise pg_trgm RPCs (0057) as canonical truth, optional per-family Typesense collections behind the shared transport, ranked-ids-only providers, and hydration through the same hydrateFeedItems/fetchListings paths the feed already uses.",
    dependsOn: ["search-architecture"],
    uxRules: [
      "Browse mode is the feed; a query or refinement — not a sort — activates search mode.",
      "Domains rank within themselves and present as groups; one relevance score never compares a person to a part.",
      "Accounts are discoverable by identity only — no account filters, and location/vehicle filters can never retrieve people.",
      "Scope changes shed incompatible filters by construction; location never crosses a scope boundary (owner location ≠ listing location).",
    ],
    decisions: [
      "Build location filters through cars.owner_id → profiles.location; no location column was added to cars.",
      "Updates index a deliberate extractor (activity_post_search_text, generated column) — text blocks, mod labels/details, performance notes; never raw document JSON.",
      "Vehicle filtering is canonical catalog identity (\"<makeId>-<modelId>\"), implemented centrally in fetchListings for listings (fitment rows + source car, seller-stated only).",
      "Explore saved searches, alerts, and advanced filters beyond the brief's set are deliberately out of scope.",
    ],
    validation:
      "Migration 0057 applied and RPC-smoke-tested against dev data; params/extractor unit tests green; full vitest suite, typecheck and lint green; anon visual QA on the dev server (search, autocomplete keyboard flow, filter-only vehicle search, chips, empty state); explore-search e2e spec covers signed-in Parts scope, privacy exclusions and scope transitions.",
  },
  {
    id: "front-door",
    name: "Front door — one product, two doors",
    group: "discovery",
    status: "implemented",
    brief: "PRD 2026-09 F-1, F-2, N-1, E-5 (build plan WS1)",
    existsToday:
      "The landing page, the lockup and the root metadata described DRVN as a parts marketplace, and Explore hid the Parts segment, parts results and part suggestions from signed-out visitors.",
    changing:
      "The front door leads with the car and offers two equal actions (Add your car \u00b7 Shop parts), builds before parts; the lockup and root metadata describe the product rather than one door, while marketplace routes gain their own marketplace wording; the signed-out parts gate is lifted everywhere; and the rail's top level is reordered so Garage sits above the Selling family.",
    surfaces: [
      "/",
      "src/app/layout.tsx",
      "src/components/ui/nav-routes.ts",
      "src/components/ui/livesheet-bar.tsx",
      "src/lib/feed.ts",
      "src/lib/explore/search/query.ts",
      "src/app/api/explore/suggest/route.ts",
      "src/lib/marketplace/metadata.ts",
    ],
    benefit:
      "A first-time visitor understands DRVN at / and can go either way in one click; a stranger with no account can find a part in Explore, in the Parts segment, in search and in the suggestions, and buy it as a guest.",
    approach:
      "Copy, order and metadata only \u2014 no new components and no schema. The parts gate came from retired PRD v3.1 \u00a78.2 and lived in six places (FEED_TABS' loggedInOnly flag, kindsForTab, the legacy feed fallback, searchAll, the suggest route, and the All view's view-all link); lifting it made the isLoggedIn plumbing through fetchFeed dead, so it was removed rather than left as a re-gating hint. Category routes get generateMetadata from one shared helper, since both routes need identical wording.",
    dependsOn: ["explore-search"],
    uxRules: [
      "Neither front-door action is a ghost button: one is the accent, the other the ink fill, so they read as a genuine choice.",
      "Parts are public everywhere \u2014 feed, Parts segment, search, suggestions \u2014 signed in or not.",
      "A part whose source car is private is still named; only the link to that car is withheld.",
      "Marketplace routes keep marketplace wording for search engines; the root description describes the product.",
    ],
    decisions: [
      "The lockup microlabel reads BUILDS AND PARTS \u2014 it names both doors in three words.",
      "The landing band leads with public build pages before parts for sale; the offer window moved off the front door because the recipe is three columns.",
      "Garage sits above Selling in the rail: the car is the middle of the product, Selling is a workspace entered on purpose. Settings stays last as account plumbing.",
      "visibleFeedTabs() was deleted rather than kept as a zero-argument passthrough \u2014 callers read FEED_TABS directly.",
    ],
    validation:
      "Full vitest suite (105 files), typecheck and lint green; feed-tabs and nav-routes tests rewritten to pin the public taxonomy and the N-1 order; explore-search e2e green including a new signed-out journey (segment, Parts scope, All view, autocomplete) and a cleanup sweep the spec previously lacked; landing visual baselines regenerated at five viewports (darwin); verified signed out and signed in on the dev server in both themes and at phone width.",
  },
  {
    id: "part-aliases",
    name: "Part aliases, supersessions & interchange (groundwork)",
    group: "discovery",
    status: "validated",
    brief: "H",
    existsToday: "A listing has one part_number plus its compact variant; no alias or interchange relationships exist.",
    changing:
      "An internal extensible model for alternate numbers, supersessions and equivalents, consumed by search so an old OEM number can find a listing entered under its successor.",
    surfaces: ["supabase/migrations/", "src/lib/marketplace/"],
    benefit:
      "Buyers who know a part by a different number than the seller used still find the part.",
    approach:
      "Relationship table with typed kinds; source metadata stored internally only; wired into the search identifier lane. Users never manage the graph.",
    dependsOn: ["search-architecture"],
    uxRules: ["No user-facing source/confidence machinery."],
    decisions: [
      "0042: listing_part_numbers (seller-supplied 'also known as', RLS mirrors fitment) + part_number_links (internal typed graph, service-role only). Sell form gained one optional comma-separated field.",
    ],
    validation:
      "Identifier-lane expansion through part_number_links live in the provider; seller 'also known as' numbers persist from the sell form and match in search; migration applied twice; covered by the provider path the regression e2e exercises.",
  },

  // ── 03 · Vehicle identity & fitment ─────────────────────────────────────
  {
    id: "canonical-add-car",
    name: "Canonical Add Car flow",
    group: "vehicle-identity",
    status: "validated",
    brief: "E",
    existsToday:
      "Add Car is a dialog of free-text Name/Year/Make/Model; VIN decoding (vPIC) exists but only on the car edit page, after the record already holds invented strings.",
    changing:
      "The primary flow becomes vehicle selection — year, searchable make, searchable model, optional variant detail only when useful — with `Enter VIN instead` as the secondary shortcut and manual entry always available as fallback.",
    surfaces: ["/garage", "src/app/(product)/garage/add-car-form.tsx", "src/lib/vehicles/"],
    benefit:
      "A new car lands in the Garage as a recognized vehicle instead of whatever the owner happened to type — fitment, discovery and trust all inherit the accuracy.",
    approach:
      "Searchable cascading picker over the DRVN vehicle catalog (vPIC cache + catalog work below); VIN path reuses the existing decoder and prefills; wording is `VIN decoded`, never \"verified\"; VIN stays private.",
    dependsOn: ["vehicle-catalog"],
    uxRules: [
      "Picker first, VIN secondary, manual fallback always visible.",
      "No giant alphabetic menus — searchable controls with intelligent ranking.",
      "Never require variant detail that can be inferred or skipped.",
    ],
    decisions: [
      "A new registered ComboField primitive (ARIA combobox on the .field/.ctl recipes) powers make/model — options ranked by catalog popularity, aliases matched as keywords ('rabbit' finds Golf).",
      "An unnamed car is named by what it is ('2024 Volkswagen Golf'); a personal name stays optional in every mode.",
      "Manual entries that happen to name a catalog vehicle quietly gain the catalog reference — automation without a prompt.",
      "Visible data credit (VehiclesDB · NHTSA) sits as microcopy in the dialog foot, satisfying CC-BY attribution where the data is used.",
    ],
    validation:
      "3/3 Playwright specs green against the dev server (manual auto-naming, VIN decode-failure messaging with escape routes, catalog picker end-to-end); live browser run created a real picker car (catalog ids + frozen snapshot verified in the DB, then cleaned up); screenshots reviewed at 430px. Shared addCar e2e helper migrated.",
  },
  {
    id: "vehicle-catalog",
    name: "DRVN-owned vehicle catalog",
    group: "vehicle-identity",
    status: "validated",
    brief: "F",
    existsToday:
      "vPIC make/model caching exists (`vehicle_makes`/`vehicle_models`, 0025) feeding the sell fitment picker; cars store free-text make/model/year plus decoded VIN columns.",
    changing:
      "A canonical catalog layer (make/model, optional generation/variant, source + version) behind DRVN-owned IDs, with display snapshots preserved on cars so history never mutates when an upstream catalog updates.",
    surfaces: ["supabase/migrations/", "src/lib/vehicles/", "/api/vehicles/*"],
    benefit:
      "Every feature that touches a car — search facets, fitment, provenance of listings — works from one accurate identity instead of string-matching.",
    approach:
      "Extend the existing vPIC cache into a catalog with stable IDs; evaluate VehiclesDB (CC-BY) for global make/model breadth with license/attribution documented; cars gain nullable catalog references alongside the existing display fields.",
    decisions: [
      "0041: catalog_makes/catalog_models with DRVN identity ids — vPIC ids and VehiclesDB ids are references, never primary keys; the vPIC cache tables stay untouched as the fitment-datalist source.",
      "VehiclesDB verified live (v2026.08.2, CC-BY 4.0, github.com/vehiclesdb/vehiclesdb): 277 car makes / 4,895 models imported via scripts/import-vehiclesdb.mjs with aliases and popularity; catalog now 392 makes / 4,908 models.",
      "Make ranking is model-weighted (how many broadly-popular models a make has) — 'best single model decile' put one-hit small-market marques above Volkswagen.",
      "Ranked, cached public APIs: /api/vehicles/catalog/makes and /catalog/models?make=.",
    ],
    validation:
      "Migration applied twice (self-checks pass, 195 vPIC makes seeded); import re-run idempotently; both APIs verified live on the dev server including alias payloads.",
  },
  {
    id: "fitment-simplification",
    name: "Fitment: automatic first, optional detail",
    group: "vehicle-identity",
    status: "implemented",
    brief: "G",
    existsToday:
      "Structured fitment exists (`listing_fitments`, seller-stated wording, a picker on /sell, garage matching in fitment.ts) but is fully manual per listing.",
    changing:
      "Fitment infers automatically from the source car and canonical vehicle identity; optional qualifiers (generation/trim/engine/drivetrain) live behind progressive disclosure; internal source metadata only.",
    surfaces: ["/sell", "src/lib/marketplace/fitment.ts", "supabase/migrations/"],
    benefit:
      "Sellers get accurate fitment on their listings without filling a configuration form; buyers' \"fits my car\" filter gets more trustworthy.",
    approach:
      "Source-car → fitment prefill on the sell flow; qualifier columns optional; no user-facing confidence percentages ever.",
    dependsOn: ["vehicle-catalog"],
    uxRules: ["Default seller experience stays lightweight.", "No fitment-confidence UI."],
    decisions: [
      "?car= deep links seed the picker with the source car's fitment row (editable like any typed row); choosing a source car in-form offers a passive one-tap '+ Fits {car}' chip — never an unexplained transformation.",
      "Manual qualifier entry (trim/engine/drivetrain) deliberately NOT built: it bloats the seller form for data the catalog/VIN can eventually fill automatically. Revisit when catalog variants exist.",
    ],
    validation:
      "Typecheck/lint/unit green; behavior exercised in the sell flow during Group 10's visual pass (pending).",
  },

  // ── 04 · Selling ────────────────────────────────────────────────────────
  {
    id: "selling-workspace",
    name: "Selling workspace & IA",
    group: "selling",
    status: "validated",
    brief: "J",
    existsToday:
      "Seller operations are scattered: /listings, /offers, /orders (mixed with purchases), payouts inside /settings#payouts, questions inside listing pages; the marketplace family nav spans buyer and seller surfaces.",
    changing:
      "A coherent Selling section (Overview · Listings · Offers · Orders · Payouts · performance where useful) with deliberately designed desktop and mobile IA, leaving Marketplace purely for discovery/buying.",
    surfaces: ["src/components/ui/nav-routes.ts", "src/components/ui/app-shell.tsx", "src/app/(product)/"],
    benefit:
      "Occasional sellers can find everything selling-related in one place; power sellers get an operations home instead of hopping between five routes.",
    approach:
      "New route group/section composed almost entirely from existing surfaces and registry components; nav register updated for rail + Index sheet; IA decision recorded here after Mobbin reference review.",
    uxRules: ["Do not duplicate Marketplace browsing.", "Mobile Index sheet must not bloat."],
    decisions: [
      "IA decision: Marketplace is a plain top-level route (discovery only — the family strip left it entirely); Selling is the collapsible rail group and family — Selling overview / My Listings / Offers / Orders / Payouts. Orders stays one shared surface but homes with Selling, where its operational weight is; buyers keep reaching orders from Home and notifications.",
      "/selling composes existing capabilities only: needs-you (offers, questions, dispatch), stock tallies, ledger money, payout gating — no new browsing, no duplicated marketplace.",
      "/payouts returned from redirect-stub to a real Selling surface rendering the SAME ledger section Settings embeds (allowlisted share); configuration stays in Settings → Payments.",
      "Mobile: no bottom-nav addition — the Index sheet gained the family as a labeled group, keeping the register one tap deep without bloating it.",
    ],
    validation:
      "14/14 family e2e + 10/10 discovery e2e + a11y suite green against the dev server after the IA change; desktop rail, family strip and mobile Index screenshotted and reviewed (1440px + 390px); typecheck/lint/unit green.",
  },
  {
    id: "remove-to-sell",
    name: "Remove from Build → Sell this part",
    group: "selling",
    status: "validated",
    brief: "I",
    existsToday:
      "Build lines can deep-link to /sell?car=&mod= and mod_items carry linked_listing_id, but removing a mod and selling it are unconnected acts.",
    changing:
      "Removing (or deciding to sell) a modification offers a clean `Sell this part` path that prefills source car, brand, product, part number and category from data DRVN already holds.",
    surfaces: ["/garage/[id]/edit", "/sell", "src/app/(product)/sell/"],
    benefit:
      "Turning a real build change into a listing takes one step instead of re-typing everything the platform already knows.",
    approach:
      "Extend the existing ?car=&mod= prefill contract to carry the full mod context; contextual action on the mods editor and the removed-part composer block. No provenance ledger.",
    uxRules: ["A useful connection, not a ledger — ordinary relational data only."],
    validation:
      "Three bridges live: build-line 'Sell it' (pre-existing), ?car=&mod= prefill carrying title/category/part number + inferred fitment row, and the composer's removed-mod block linking 'Sell this part →'. Exercised via the sell-form fitment prefill path; no ledger machinery anywhere.",
  },

  {
    id: "mod-record-identity",
    name: "Change a part — removal is a state",
    group: "selling",
    status: "implemented",
    brief: "PRD 2026-09 A-1…A-3 (build plan WS2)",
    existsToday:
      "A mod line exists only while the part is on the car: the editor drops the row, save_mod_items deletes anything the payload omits, and the part is gone — along with the fact it was ever fitted, and along with the provenance behind any listing released off it. People also type over rows to record a replacement, which silently rewrites what past updates and live listings refer to.",
    changing:
      "mod_items gains status (installed / removed) and removed_at. Remove keeps the id and marks the row; Replace is its own editor action that marks the old line removed and files a new one in its position; editing in place stays what it is — a fix for typos; a true delete is still 'omit the row', and is only offered where nothing points at the line. Removing asks inline what happens to the old part: List it, or just remove it. The parts that came off get their own section on the editor and on the public build sheet.",
    surfaces: [
      "/garage/[id]/edit",
      "/cars/[slug]",
      "supabase/migrations/20260919170000_mod_record_identity.sql",
      "supabase/migrations/20260919171500_car_search_installed_mods.sql",
      "src/features/activity/mod-actions.ts",
    ],
    benefit:
      "A used part's provenance becomes checkable: a buyer can read the build it came off and see that the build says so. The first loop of the product — change a part, sell the old one — stops destroying its own evidence.",
    approach:
      "One migration for the state plus the columns two neighbouring workstreams need, so save_mod_items is re-created once. Its delete statement is byte-identical to the previous version, because the editor keeps sending removed rows with their status. Every reader then had to choose: the build sheet and the garage show what came off, while search, the OG count and the index describe only what is fitted.",
    dependsOn: ["remove-to-sell"],
    uxRules: [
      "Neither answer to 'what happens to the old part?' loses the record — 'just remove it' still keeps the line.",
      "Delete is only offered on a line with no linked listing.",
      "'List it' commits the sheet before opening the sell form, so abandoning the form leaves the part under 'came off this car' rather than losing both.",
      "An update that says a part came off OFFERS to mark it off the sheet; it never does so silently.",
    ],
    decisions: [
      "removed_at is derived by the database, never sent by the client — re-saving a sheet can't drag the date a part came off forward to today.",
      "A part that came off is excluded from car search text and the search index: a build should not keep matching a part it no longer has.",
      "The listing provenance line, post mod blocks and the sell prefill deliberately do NOT filter by status — a removed part is the normal case for all three.",
      "markModRemoved lives in features/activity rather than the garage's actions because the surface that offers it is the public post page, and a route may not reach into another route's actions.",
    ],
    validation:
      "Migration applied to the shared dev project and the local test database; mod_sheet_atomic_guard gained a record-identity block (remove keeps the id, replace files a new line in position, re-saving doesn't move the removal date, an omitted row still deletes, a price with no currency and an unknown state are both refused) and the whole SQL guard suite passes. Walked end to end on the dev server at desktop width: the inline ask renders in-row with 44px targets, the line moves to 'Came off this car', the save keeps the row's id and sets removed_at, the build sheet drops to six entries and grows a 'Came off this car' section carrying the owner's Sell it. Phone width for this editor was NOT visually confirmed this session.",
  },

  {
    id: "marketplace-card",
    name: "Marketplace and its card",
    group: "discovery",
    status: "implemented",
    brief: "PRD 2026-09 M-1…M-8 (build plan WS9)",
    existsToday:
      "Brand exists only inside the free-text title, so the most common way people describe a part — 'Öhlins coilovers' — can't be filtered. The card carries no brand, no description line and no sense of who is selling; the phone column is one card wide because the card is too tall to scan two-up.",
    changing:
      "listings gains brand, part_miles and part_miles_unit. The card gets brand, a clamped title, condition with miles, one line of the seller's own description, their avatar and 'N for sale', 'Off my {car}' and add-to-cart. Brand joins the filters, the facet, the search text and saved searches.",
    surfaces: [
      "/marketplace",
      "src/components/ui/listing-card.tsx",
      "src/lib/marketplace/query.ts",
      "supabase/migrations/20260919190000_listing_brand_and_miles.sql",
      "supabase/migrations/20260919190500_save_listing_creation_brand.sql",
      "supabase/migrations/20260919191000_seller_active_counts.sql",
    ],
    benefit:
      "A used-parts marketplace you can shop by brand instead of by scrolling, on a card that answers the questions a buyer actually has — what is it, what state is it in, how far has it been driven, who is selling and what else have they got.",
    approach:
      "The design proof measured the card before it was rebuilt: 163.5px columns, 523–571px cards, titles running to six lines because nothing clamped them. The clamp came first; the two-across phone column followed from it.",
    dependsOn: ["listings-to-followers", "search-architecture"],
    uxRules: [
      "No seller rating on a browse card — it invites comparing people rather than parts. It stays on the item page and the store's trust strip.",
      "Add to cart, never Buy now: deciding to buy happens on the item page.",
      "Miles are offered on used parts only — on a new part they would be a contradiction rather than a detail.",
      "One line of the seller's own description, never a generated summary: a card that paraphrases is a card that can be wrong about somebody else's part.",
    ],
    decisions: [
      "save_listing_creation enumerates columns in three places; all three were updated in one migration. Missing one drops the field silently on publish while everything looks correct.",
      "brand joined SAVED_SEARCH_KEYS in the same change — without it a saved search drops the brand and the alert job, which runs the same query, mails the member about every coilover on the site.",
      "The backfill only matches the curated brand list anchored at the start of a title, longest name first. A wrong brand is worse than none: it silently excludes the listing from the filter its seller wanted.",
      "The brand filter is an exact match, not ilike — the value comes from a facet built out of the brands actually stored, so a partial match could only widen it.",
      "The phone column drops back to one below 340px, not 480px: at 375px the columns are 165px, which the proof showed works once the title is clamped.",
    ],
    validation:
      "Four migrations applied to the shared dev project and the local test database; types regenerated and hand-edited. Verified in the browser at 1280px and 375px: two columns on the phone with titles clamped to two lines and the price above the fold, 'N for sale' and the seller avatar rendering, the cart button present, and the filter panel inline rather than a sheet at desktop width. NOT done: M-3's left-column placement — the panel and the results live in different subtrees, so moving it beside them needs page-content restructured around a sidebar slot.",
  },

  {
    id: "member-store",
    name: "Profile & Store",
    group: "selling",
    status: "implemented",
    brief: "PRD 2026-09 P-1…P-8 (build plan WS10)",
    existsToday:
      "A profile is About / For sale / Reviews / Activity — a seller's page with some cars attached. Listings render as rows, which look nothing like the marketplace they came from.",
    changing:
      "Tabs become Overview · Garage · Updates · Parts · Reviews, with the old keys kept as aliases. Parts IS the store: the marketplace grid and card, filtered to one seller, including sold. The header gains a borrowed car-cover banner, followers and cars, and a store note.",
    surfaces: [
      "/u/[username]",
      "src/lib/store/visible-statuses.ts",
      "src/lib/store/query.ts",
      "src/components/profile/profile-body.tsx",
      "supabase/migrations/20260919192000_profiles_store_note.sql",
    ],
    benefit:
      "A member's parts read as a shop without DRVN needing a shop entity, and the profile reads as a person with a garage rather than a seller with some cars.",
    approach:
      "The store runs its own rows query because it shows SOLD parts and the marketplace never does; bending the marketplace query to carry a seller key would put owner-visible state one URL parameter from every public browse surface. Everything after retrieval is shared — hydrateListingCards and ListingCard.",
    dependsOn: ["marketplace-card", "main-car"],
    uxRules: [
      "Allowed statuses come from who is viewing, never from the URL. The tab can only narrow the viewer's own allowance.",
      "Sold parts are public: a store with twelve sold and two live is a different proposition from a new seller, and hiding the history would flatten them.",
      "The owner sees an edit link where a stranger sees add-to-cart — you can't buy your own part.",
      "The About tab is gone. A bio is one paragraph, and giving it a tab meant the first thing on somebody's profile was prose rather than their cars.",
    ],
    decisions: [
      "Old tab keys (?view=forsale, about, activity) still resolve. Those links are in messages and bookmarks, and renaming a tab isn't a good enough reason to break them.",
      "Seller and status filter inside the query, before the count and the page window — filtering after fetching gives a count that disagrees with the rows and a silently short last page.",
      "The store note is capped at 180 characters in the database: it is voice, not policy, and policy belongs in the returns and shipping settings where it is enforceable.",
    ],
    validation:
      "Five unit tests on visibility, including the one that matters — ?status=draft on somebody else's store stays active+sold rather than listing their unpublished work. Verified in the browser: tabs render as Overview · Garage1 · Updates3 · Parts2 · Reviews, the banner renders from a car cover, and the Parts panel shows the marketplace card with price, shipping, condition and seller. NOT done: the trust strip (P-7) and the offer-floor default (P-9, deferred to M6).",
  },

  {
    id: "bought-to-my-car",
    name: "Add what you bought to your car",
    group: "garage",
    status: "implemented",
    brief: "PRD 2026-09 C-1 (build plan WS4)",
    existsToday:
      "A completed purchase is a dead end. The part arrives, goes on the car, and the build sheet knows nothing about it — so the loop that makes DRVN one product rather than two stops at the doorstep.",
    changing:
      "A delivered or completed order offers 'Add to a car', per item. The mod line is built from the order item's frozen purchase record and reads back as 'Bought on DRVN · off {car}'.",
    surfaces: [
      "/orders/[id]",
      "src/features/commerce/add-to-car-actions.ts",
      "src/lib/mods/provenance.ts",
      "src/lib/mods/category-map.ts",
    ],
    benefit:
      "The third loop closes: a part sold off one build becomes a documented part of another, and the marketplace starts feeding the community that feeds it.",
    approach:
      "Read from order_items.commercial_snapshot (0049), never the live listing — by the time somebody fits a part the seller may have edited, re-shot, relisted or deleted it. Idempotent through the unique mod_items.source_order_item_id; a second tap answers 'already on this car' rather than erroring or duplicating.",
    dependsOn: ["mod-record-identity", "main-car"],
    uxRules: [
      "Offered per item, not per order — an order can hold several parts going on different cars.",
      "Only once the part has arrived: delivered or completed, the same window the review and return flows use.",
      "A second tap adds nothing and says so. Same answer either way is what idempotent should feel like.",
      "A source build that has since gone private is not named at all.",
    ],
    decisions: [
      "The provenance line is NOT written into the mod's text at insert. source_order_item_id is the durable fact and the source car is read back at render, where its CURRENT visibility can be checked — a sentence written once can't stop naming a car that later went private.",
      "The reverse category map answers null rather than guessing: 'engine' could be a turbo, a manifold or a long block, and a wrong category quietly mis-files the part on somebody's build sheet.",
      "The 'owners manage mods' policy is already `for all`, so this is a plain insert rather than another database function.",
    ],
    validation:
      "Category mapping unit-tested both directions including the round-trip and the deliberate nulls. Buyer, car ownership and order state are all checked server-side. The uniqueness index is asserted in mod_sheet_atomic_guard. Typecheck, lint and the full unit suite green. NOT yet walked end to end — that is acceptance journey 6, and a full order-fixture SQL guard for the double-tap is still to write.",
  },

  {
    id: "main-car",
    name: "Main car",
    group: "vehicle-identity",
    status: "implemented",
    brief: "PRD 2026-09 P-5, P-1, M-1 (build plan WS5)",
    existsToday:
      "Four surfaces sort a member's cars and none of them agree — created ascending in the garage, model year descending on the profile, whatever the query returned on the sell form. Somebody with four cars sees a different 'first' car depending where they stand, and never gets to say which one they mean.",
    changing:
      "profiles.main_car_id, set from the car's own settings. It drives the featured car, the default profile banner, car order everywhere, the Garage's focused view, and the first one-tap suggestion in the marketplace vehicle picker.",
    surfaces: [
      "src/lib/cars/order.ts",
      "src/lib/cars/banner.ts",
      "/garage/[id]/edit",
      "/marketplace",
      "supabase/migrations/20260919181500_profiles_main_car.sql",
    ],
    benefit:
      "The product stops guessing at the one thing the member could just tell it, and a profile gets a banner without anyone having to upload a second image.",
    approach:
      "One ordering helper replacing four different sorts, and one banner helper choosing from photos that already exist. Null stays the ordinary state: with no main car every surface falls back to newest-first, which is what they all did before.",
    dependsOn: ["vehicle-catalog"],
    uxRules: [
      "Offered, never applied: the marketplace shows 'Parts for my {car}' as a one-tap choice and an explicit or URL-supplied vehicle always wins.",
      "A cleared vehicle filter stays cleared — clearing is an answer, not an absence.",
      "The banner never borrows a private car's cover, main car or not.",
      "No banner is a fine outcome. A plain header beats a stretched placeholder, and neither is a setup step.",
    ],
    decisions: [
      "The ownership trigger is the guard, not RLS: RLS says who may update the row and nothing about whether the VALUE is theirs, so without it a member could feature somebody else's car.",
      "The toggle saves on its own rather than with the car form — it is a garage-wide answer about this car, not one of the car's fields, and batching it would make unsetting feel like a rollback.",
      "New profiles columns are invisible until granted, so main_car_id has explicit column-level SELECT/UPDATE grants (the 0017 pattern) rather than riding a table-wide grant that would re-expose the Stripe pointers.",
    ],
    validation:
      "Ten unit tests across ordering and banner choice, including the two cases that matter most — no main car set behaves exactly as today, and a private car's cover is never borrowed. The ownership trigger is covered in security_guard.sql (another member's car refused, own car accepted, clearing accepted); the whole guard suite passes. Migration applied to the shared dev project and the local test database. Typecheck, lint and the full unit suite green; the marketplace offer was NOT clicked through in the browser this session.",
  },

  {
    id: "listings-to-followers",
    name: "A listing reaches the people following you",
    group: "discovery",
    status: "implemented",
    brief: "PRD 2026-09 B-1 (build plan WS3)",
    existsToday:
      "The followed feed carries cars and build updates only. A followed seller's new listing shows up nowhere: `follows` has no seller-listing edge, and the feed never asked the listings table.",
    changing:
      "A new listing reaches anyone following that seller or the car the part came off. Two queries feed it — seller lane and source-car lane — and one pure merge makes them a single ordered feed.",
    surfaces: [
      "src/lib/feed-merge.ts",
      "src/lib/feed.ts",
      "/home",
      "supabase/migrations/20260919180000_listings_seller_status_created_idx.sql",
    ],
    benefit:
      "Selling a part stops being an act of shouting into the marketplace: the people who already care about this build or this seller see it, which is the whole argument for the community and the marketplace being one product.",
    approach:
      "Two indexed queries rather than one `or`, because only the seller lane can use (seller_id, status, created_at desc) and an `or` would give up the index for the half that has one. Everything hard — dedupe, stable order, per-seller fairness — is a pure function with no database.",
    dependsOn: ["front-door"],
    uxRules: [
      "Following a seller AND the car a part came off gives one card, not two.",
      "At most three of one seller's listings sit together; the fourth waits for someone else and then returns.",
    ],
    decisions: [
      "The per-seller cap defers rather than drops: a seller alone in your feed still shows you everything. It is a cap on adjacency, not on presence.",
      "Order breaks ties on id. Equal timestamps are ordinary — a bulk insert stamps rows together — and without a total order page one and page two disagree, which shows a card twice or skips it.",
      "No push or email for new listings (B-2). This is a feed, not a broadcast.",
    ],
    validation:
      "Seven unit tests on the merge, covering follow-both-see-once, ids colliding across kinds, identical output from differently-ordered inputs, a six-row page walk on one shared timestamp, and the run cap deferring rather than dropping. Index applied to the shared dev project and the local test database. Typecheck, lint and the full unit suite green; NOT yet walked with a real follow graph in the browser.",
  },

  {
    id: "parts-by-link",
    name: "Add a part by pasting a link",
    group: "selling",
    status: "implemented",
    brief: "PRD 2026-09 L-1…L-4 (build plan WS6)",
    existsToday:
      "A mod line is typed, or pasted as text and parsed heuristically. Everything the shop page already knows — the exact title, the brand, the part number, a photo, what it cost — is retyped or lost.",
    changing:
      "\"Add mod\" opens on a product link. One fetch fills title, brand, part number, category, a thumbnail and the shop's price; everything stays editable and typing stays first-class, so a failed fetch costs nothing. The public build page shows the thumbnail and a plain link out.",
    surfaces: [
      "src/lib/mods/part-link.ts",
      "/garage/[id]/edit",
      "/cars/[slug]",
      "src/lib/listing-import/extract/html.ts",
      "src/lib/listing-import/media/import-images.ts",
    ],
    benefit:
      "A build sheet stops being a typing exercise, so it actually gets filled in — and a filled-in sheet is what makes the parts that come off it sellable with provenance.",
    approach:
      "The importer's plumbing at a fraction of its weight: the same SSRF guard, pinned DNS, byte caps and sharp re-encode, and none of the job ladder, AI extraction or twelve-photo gallery. The image importer's bucket and path became parameters so a mod thumbnail lands in car-images rather than listing-images.",
    dependsOn: ["listing-importer", "mod-record-identity"],
    uxRules: [
      "Typing stays first-class; a failed fetch falls back to it with a sentence saying so, never an error page.",
      "What the link gave us is shown under the row it filled in — the shop, the thumbnail, the price — so the owner can see it and correct it.",
      "A reference price without a currency is not shown, stored or returned.",
    ],
    decisions: [
      "L-4 is structural, not a promise: the thumbnail is uploaded to car-images, and the sell prefill does not select image_url at all. A test asserts the projection so widening it is a deliberate act.",
      "RATE_LIMITS.fetchPartLink is 30/hour — looser than the importer's 10, because one page fetch and one thumbnail is cheap and somebody filling in a sheet pastes a lot of links.",
      "Prices are refused rather than guessed: a European decimal comma (1.299,00) is ambiguous against a thousands comma, so both are read as no price.",
      "mod_items.image_url joined the media lifecycle's reference check, or the 48h sweep would take the thumbnail back out from under a build sheet still showing it.",
    ],
    validation:
      "Unit tests cover the price and currency rules, including the negative-price case they caught (a stripped minus sign read as a positive price). A projection guard holds L-4. Typecheck, lint and the full unit suite green. The remote fetch itself is exercised by the importer's existing safe-fetch coverage; a live paste was NOT walked in the browser this session.",
  },

  {
    id: "listing-importer",
    name: "Existing Listing Importer",
    group: "selling",
    status: "implemented",
    brief: "Importer brief (Aug 2026)",
    existsToday:
      "Sellers arriving from Facebook Marketplace or forums re-typed their listing field by field; docs/listing-importer-spec.md existed as a spec with nothing built.",
    changing:
      "Paste a listing URL (or the post text) at /sell/import and DRVN reads that one page, organizes it into the structured listing shape (deterministic parsers first, schema-forced AI last, server-side non-invention checks), re-hosts the photos through the staged-media lifecycle, and lands the seller in the normal sell form with specific check-this prompts. Facebook is first-class: anonymous single-page attempt with a paste fallback on the same import.",
    surfaces: [
      "/sell/import",
      "/sell",
      "src/lib/listing-import/",
      "src/app/(product)/sell/import/",
      "supabase/migrations/0047_listing_imports.sql",
      "/api/jobs/listing-imports",
    ],
    benefit:
      "A seller who already listed a part somewhere else brings it to DRVN in under a minute instead of rebuilding it — supply-side migration without redundant work.",
    approach:
      "Postgres-owned durable job (0047: status machine + transition trigger + step lease), one hardened SSRF-pinned fetcher for pages and images, a source-policy registry with engine adapters (Discourse JSON, XenForo, vBulletin, phpBB, generic JSON-LD/OG/Readability, Facebook, paste), Anthropic extraction behind a config seam with a deterministic stub for dev/CI, fitment through the 0041 catalog, and one SellFormInitialValues contract so the review IS the existing sell form.",
    dependsOn: ["vehicle-catalog", "background-jobs"],
    uxRules: [
      "The importer never publishes and never invents a seller claim — blank beats guessed.",
      "Specific review reasons, never confidence scores.",
      "Failures degrade forward to paste on the same import; the seller never restarts.",
    ],
    validation:
      "89 unit tests (SSRF matrix, fixture-driven adapters, non-invention validation, heuristic extractor, policy/config); import_guard.sql (8 assertions) green against the dev project; migration applied twice; e2e flow spec covering paste import, review and draft-save.",
    docs: ["docs/listing-importer-spec.md", "docs/site/listing-import.md"],
    decisions: [
      "Crawlee/metascraper not adopted: every import is exactly one user-supplied page fetch, so a hardened undici fetcher + cheerio adapters cover it without a crawler framework's queue machinery (matches the no-Redis/no-PGMQ posture).",
      "Facebook is public_url, not paste_only: the attempt is user-directed, single-page, logged-out, with hard no-bypass boundaries; viability is measured by the facebook_outcome analytics aggregate.",
      "No screenshot import — text/URL paths only, per product direction.",
      "Confidence scores dropped from the old spec in favor of field-specific review issues.",
    ],
  },

  // ── 05 · Build Story Composer ───────────────────────────────────────────
  {
    id: "composer-engine",
    name: "Editor engine & DRVN-owned schema",
    group: "composer",
    status: "validated",
    brief: "M1–M2",
    existsToday:
      "Posts store an ordered block array (text/images/embed) in `activity_posts.body` with `normalizeBlocks()` upgrading the legacy shape; editing is a hand-rolled block form (↑/↓ moves, bottom-only insertion).",
    changing:
      "One editor engine (Tiptap and Yoopta evaluated; decision recorded here) rendering DRVN's own versioned `ActivityDocumentV2`; editor state is transformed at the boundary and never stored as canonical data. Old posts keep rendering via the existing normalization path.",
    surfaces: ["src/lib/activity-blocks.ts", "src/app/(product)/garage/[id]/update/"],
    benefit:
      "Build updates gain a modern, reorderable writing experience without tying DRVN's data to any editor library.",
    approach:
      "Engine chosen after inspecting current code; DRVN block model extended (V2) with serializers both ways; renderer stays DRVN-owned.",
    decisions: [
      "Engine: Tiptap v3 (MIT, headless ProseMirror) — full Livesheet styling ownership, atom NodeViews for the automotive set; Yoopta kept as a UX reference only, per M1 one-engine rule.",
      "The stored format stays the self-describing body array (V0 legacy sections and V1 blocks still normalize on read); no schemaVersion column needed.",
      "No inline marks in V2 — bold/italic/link deliberately off (brief O: no arbitrary typography); text blocks stay plain.",
    ],
    validation:
      "Serializer round-trip unit-tested (4 tests, every block type); live end-to-end run: typed text + slash-inserted blocks published and the stored body verified as clean DRVN V2 JSON with zero editor state.",
  },
  {
    id: "unified-composer",
    name: "One progressively enhanced composer",
    group: "composer",
    status: "validated",
    brief: "M3, N",
    existsToday:
      "A simple quick composer (title + text + video) in the Garage editor and a separate full block editor — two products for one job.",
    changing:
      "One composer with an immediate writing surface: place cursor, type, publish. `+` / `/` menus, insertion between blocks, drag reorder and keyboard accessibility appear when wanted.",
    surfaces: ["/garage/[id]/update/new", "/garage/[id]/update/[postId]/edit", "garage editor"],
    benefit:
      "\"Installed the new wheels today\" is publishable in seconds, and richer stories don't require learning a CMS first.",
    approach:
      "The engine from composer-engine wrapped in DRVN chrome; quick-composer entry points route into the same surface.",
    dependsOn: ["composer-engine"],
    uxRules: ["Typing must work before any block/template decision.", "No mandatory template screen."],
    decisions: [
      "The quick/full split is gone: one BuildStoryComposer serves create and edit; server actions ride in as props so features/ never imports route code.",
      "Legacy intro/video fields ride through edits as hidden values — a body edit can never silently strip them.",
    ],
    validation:
      "Live browser run: title + typed paragraph + / menu + + menu + publish landed on the public page; the garage editor's quick form is retired — 'Post an update' opens the one composer. Console clean.",
  },
  {
    id: "automotive-blocks",
    name: "Automotive blocks",
    group: "composer",
    status: "validated",
    brief: "O",
    existsToday: "Blocks are text (normal/heading), images and YouTube embeds only.",
    changing:
      "Core blocks refined (paragraph, heading, photos, video, divider) plus a restrained automotive set: Modification change (linked to real mod_items), Before/After comparison, Performance result (owner-reported), optional Mileage milestone, Removed part with a contextual sell path.",
    surfaces: ["src/lib/activity-blocks.ts", "composer", "public post renderer"],
    benefit:
      "An update about coilovers can show the mod, the before/after and the numbers — machine-readable and visually distinct from a generic social post.",
    approach:
      "Each block is a DRVN document node + renderer + editor node; mod blocks reference existing mod_items rather than duplicating data; performance data clearly labeled owner-reported.",
    dependsOn: ["composer-engine"],
    uxRules: ["No arbitrary typography/layout controls.", "Block library stays small."],
    decisions: [
      "One Mod block covers installed/removed/replaced/updated — 'removed' doubles as the Sell-this-part bridge; no separate removed-part block.",
      "BeforeAfter is a registered ui primitive (keyboard slider); ActivityBlocksView is the one renderer for every post version, publicly and in previews.",
    ],
    validation:
      "normalizeBlocks V2 coverage unit-tested (malformed-field defense included); performance + mod blocks exercised live end-to-end; renderer verified on the public page (owner-reported label, INSTALLED chip). Before/after upload path pending photo-based visual pass (Group 10).",
  },
  {
    id: "composer-templates",
    name: "Optional update templates",
    group: "composer",
    status: "implemented",
    brief: "Q",
    existsToday: "No templates; every update starts blank.",
    changing:
      "Optional starter chips (General update, Installed something, Removed something, Photos, Dyno result, Issue/fix) that visibly and reversibly seed blocks — never a mandatory selection screen.",
    surfaces: ["composer"],
    benefit: "The blank page gets easier without the empty composer becoming harder.",
    approach: "Inline chips above the empty surface; applying one is explained, obvious and undoable.",
    dependsOn: ["unified-composer"],
    uxRules: ["Empty composer is already usable.", "No unexplained transformations."],
    validation:
      "Starter chips render only on the empty composer with explanatory tooltips; application is one undo away. Interactive template pass rides with Group 10 visual validation.",
  },
  {
    id: "composer-autosave",
    name: "Drafts & autosave",
    group: "composer",
    status: "validated",
    brief: "R",
    existsToday: "The full editor relies on an explicit Save draft action.",
    changing:
      "Debounced remote autosave with quiet `Saved` status and local recovery; publishing stays explicit.",
    surfaces: ["composer", "server actions"],
    benefit: "A ten-photo update survives a mobile browser reload instead of vanishing.",
    approach: "Debounced draft mutation + localStorage recovery buffer; no save spam.",
    dependsOn: ["unified-composer"],
    validation:
      "Live run: 1.6s-debounced draft save fired with the quiet 'Saved — only you can see it' status; localStorage recovery buffer written per keystroke and cleared on publish; publish stays explicit.",
  },
  {
    id: "composer-motion",
    name: "Composer motion & polish",
    group: "composer",
    status: "implemented",
    brief: "P",
    existsToday: "The current editor has no motion language.",
    changing:
      "Subtle, branded motion for block insertion/removal/reorder, menu opening, template application, upload completion and before/after interaction — reinforcing causality, never decorating.",
    surfaces: ["composer", "src/app/globals.css"],
    benefit: "The composer feels premium and unmistakably DRVN rather than like a form.",
    approach:
      "Livesheet-consistent transitions (Higgsfield references where useful); `prefers-reduced-motion` respected everywhere.",
    dependsOn: ["unified-composer"],
    validation:
      "Block rise-in on insert, hover-revealed tool rails (always-on for coarse pointers), live dropcursor, transition tokens from Livesheet; prefers-reduced-motion disables the entrance animation. Visual pass in Group 10.",
  },

  // ── 06 · Media & galleries ──────────────────────────────────────────────
  {
    id: "upload-queue",
    name: "Better upload queue",
    group: "media",
    status: "implemented",
    brief: "S1",
    existsToday:
      "`uploadImages` centralizes validation/storage/staging, but uploads run sequentially with no per-image progress, retry or continued-editing affordance.",
    changing:
      "Immediate local previews, per-image progress, partial-failure handling, retry, cancel where possible, and editing while uploads run — on top of the untouched staged-upload lifecycle.",
    surfaces: ["src/lib/media-upload.ts", "garage gallery", "/sell", "composer"],
    benefit: "Adding twelve photos feels fast and visible instead of a silent wait that might fail wholesale.",
    approach:
      "A queue layer (Uppy evaluated vs extending the existing helper — decision recorded) beneath a DRVN-designed surface; storage and GC unchanged.",
    decisions: [
      "Uppy evaluated and not adopted: byte-level progress would require switching to TUS resumable uploads; after §S4 normalization files are small, so an honest queued/uploading/done/failed ladder beats a simulated percent bar.",
    ],
    validation:
      "Queue hook (3-way concurrency, statuses, retry, remove) drives composer galleries, before/after slots and the sell form (instant previews + per-image state); typecheck/lint/unit green. Garage gallery keeps its immediate per-file persist flow with retry — documented decision.",
  },
  {
    id: "media-reorder",
    name: "Drag-and-drop reordering",
    group: "media",
    status: "validated",
    brief: "S2",
    existsToday: "Photo ordering is ↑/↓ buttons only.",
    changing:
      "Accessible drag-and-drop sorting (dnd-kit or equivalent) for garage photos, listing photos and composer galleries, with keyboard controls retained.",
    surfaces: ["garage gallery", "/sell", "composer"],
    benefit: "Arranging a photo set takes seconds instead of button-mashing.",
    validation:
      "SortableGrid/SortableItem (dnd-kit pointer+touch+keyboard) registered and applied to the garage gallery (optimistic order + full-order server action) and sell photos; ↑↓ controls retained as the explicit accessible path. Composer galleries keep ←/→ — in-gallery dnd nested inside a draggable ProseMirror node is conflict-prone (documented).",
    approach: "One sortable primitive registered in the design system, applied consistently.",
  },
  {
    id: "focal-point",
    name: "Cover & focal-point framing",
    group: "media",
    status: "implemented",
    brief: "S3",
    existsToday: "Cover selection exists; framing does not — crops are whatever the layout happens to do.",
    changing:
      "Non-destructive focal/crop metadata on important images so covers render well across hero, card, and gallery contexts. Originals kept.",
    surfaces: ["garage gallery", "car pages", "listing cards"],
    benefit: "Owners control how their car appears everywhere it's cropped, without destroying the photo.",
    approach: "react-easy-crop-style percentage focal data stored as technical metadata only.",
    validation:
      "0043 applied; the 'Frame the cover' dialog (click-to-set focal point with hero/card/thumb live previews) ships on the garage gallery; Media gained a focal prop applied on the public car hero. Visual pass in Group 10.",
  },
  {
    id: "photo-normalization",
    name: "Client-side photo normalization",
    group: "media",
    status: "validated",
    brief: "S4",
    existsToday: "Original camera files upload as-is (up to the size limit), EXIF/GPS included.",
    changing:
      "Public garage/activity/listing photos get orientation-corrected, resized, sensibly compressed, and stripped of EXIF/GPS before upload. Dispute evidence keeps originals untouched.",
    surfaces: ["src/lib/media-upload.ts"],
    benefit: "Uploads get faster and cheaper, and nobody accidentally publishes their home GPS coordinates.",
    approach: "Canvas-based normalization in the upload helper, bypassed for evidence flows.",
    uxRules: ["Never normalize private dispute evidence destructively."],
    validation:
      "normalizePublicPhoto (orientation via createImageBitmap, 2560px cap, JPEG re-encode = EXIF/GPS strip, graceful fallback) wired into garage, sell and composer uploads; dispute evidence untouched by construction (its flow never passes normalize).",
  },

  // ── 07 · Garage & build experience ──────────────────────────────────────
  {
    id: "annotated-showcase",
    name: "Annotated showcase image",
    group: "garage",
    status: "validated",
    brief: "U",
    existsToday: "Car photos are a plain gallery; nothing links an image region to build data.",
    changing:
      "An optional advanced feature on one (or very few) selected showcase images: hotspots linked to existing build entries, revealed through an `Explore this build`-style interaction.",
    surfaces: ["/cars/[slug]", "/garage/[id]/edit"],
    benefit: "A build becomes explorable through the car itself — tap the wheel, see the wheel spec.",
    approach:
      "Percentage-positioned hotspots referencing mod_items, accessible keyboard/touch interaction; explicitly not a post block, never on every photo.",
    uxRules: ["Default photo experience stays clean.", "Not a marketplace navigation system."],
    decisions: [
      "Pins snapshot their label and reference mod_items while it exists; a pinned part that's for sale links its live listing ('For sale · $x →'), otherwise the card just names the part.",
      "Hard bounds by construction: one image, 8 pins, reveal-on-request — the default photo experience stays clean.",
    ],
    validation:
      "0045 applied twice (8-pin trigger cap, visibility-following RLS); live run on a public build: 'Explore this build' toggle → staggered pins → part card with label verified by screenshot; owner editor (photo picker, click-to-pin, mod-linked labels) code-complete under the car edit sheet.",
  },
  {
    id: "build-evolution",
    name: "Build Evolution timeline",
    group: "garage",
    status: "validated",
    brief: "V",
    existsToday: "Activity is a list; there is no visual chronology of the car.",
    changing:
      "A visual chronological story derived from dated updates and their images — representative photos, major titles, thoughtful transitions. No snapshots, no diffs, no extra data entry.",
    surfaces: ["/cars/[slug]"],
    benefit: "Visitors can watch a build evolve instead of scrolling a feed backwards.",
    approach: "Derived entirely from existing posts/images; motion respects reduced-motion.",
    decisions: [
      "A milestone is simply a published update with a photo — zero new data entry, no snapshots, no diffs (§V/§AJ honored by construction).",
    ],
    validation:
      "Derived-only strip (published, dated, photographed updates → milestones) rendered on the Activity tab when ≥2 exist; verified live with three seeded dated updates; scroll-snap horizontal track with year ticks; hover lift disabled under reduced motion.",
  },
  {
    id: "passive-suggestions",
    name: "Passive creation suggestions",
    group: "garage",
    status: "validated",
    brief: "W",
    existsToday: "Editing the build or adding photos never connects to posting an update.",
    changing:
      "After a meaningful build edit or a batch of new photos, a quiet inline affordance offers `Create an update from these changes` / `Share these in an update`, prepopulating the composer when chosen.",
    surfaces: ["/garage/[id]/edit", "garage gallery"],
    benefit: "Real changes become content with one click — and the affordance is entirely ignorable.",
    approach: "Inline dismissible row, no modals, no repeat nagging; state remembered so it doesn't re-offer.",
    dependsOn: ["unified-composer"],
    uxRules: ["No popups.", "Ignorable forever without cost."],
    validation:
      "Both affordances are inline, dismissible rows — no modals, no repeats: the mods editor diffs labels on save and offers 'Create an update from these changes →'; the gallery offers 'Share these in an update →' after a ≥2-photo batch. The composer seeds visible, editable blocks from the links and never clobbers an in-flight draft. Typecheck/lint/unit green.",
  },
  {
    id: "share-cards",
    name: "Shareable build/update cards",
    group: "garage",
    status: "validated",
    brief: "AB",
    existsToday: "Car pages have OpenGraph metadata with car imagery; no designed share card exists.",
    changing:
      "Automatically generated build and update cards in DRVN's design language for social/OpenGraph use — no manual card workflow.",
    surfaces: ["/cars/[slug]", "activity posts", "OG image generation"],
    benefit: "Sharing a build off-platform looks intentional instead of like a screenshot.",
    approach: "Data-driven OG image route composing existing car/update data.",
    decisions: [
      "No manual card workflow anywhere: the card IS the route's opengraph-image, always current.",
    ],
    validation:
      "next/og cards for build pages and update pages, generated from existing data (cover/first photo, identity line, mod/update counts); verified live — 200 image/png, screenshot reviewed. The explicit openGraph.images override was removed so the designed card owns every unfurl.",
  },
  {
    id: "garage-hierarchy",
    name: "Garage hierarchy pass",
    group: "garage",
    status: "validated",
    brief: "Z",
    existsToday: "The garage sheet works; density and hierarchy have grown organically.",
    changing:
      "Only reorganize where existing information can form a clearer hierarchy (current car, recent update, selling activity, pending actions) without adding density. Otherwise preserve.",
    surfaces: ["/garage"],
    benefit: "Owners see what matters about their car first — with nothing new to learn.",
    approach: "Simplify-before-add rule; no intelligence dashboard.",
    decisions: [
      "No garage intelligence dashboard (§Z honored): the existing sheet already answers 'what matters about this car right now'.",
    ],
    validation:
      "Reviewed against the simplify-before-add rule: the Aug-2026 garage sheet already leads with the car, its latest update, selling counts and a bounded work-order list — reorganizing further would only move furniture. Preserved deliberately; the passive suggestions (§W) are the only additions, and they live on the edit surfaces, not the sheet.",
  },

  // ── 08 · Notifications ──────────────────────────────────────────────────
  {
    id: "notification-domain",
    name: "Notification domain & delivery boundary",
    group: "notifications",
    status: "validated",
    brief: "D",
    existsToday:
      "A notifications table with kind/section, nine SQL triggers, per-user prefs, unread badges and an open-and-redirect route — in-app only, delivery logic scattered in triggers.",
    changing:
      "A clean notification domain model (typed kinds registry, preference gating, delivery boundary) that supports saved-search and seller alerts now and email/push later — without a hard Novu (or any paid) dependency.",
    surfaces: ["supabase/migrations/", "src/lib/notifications/", "/notifications", "/settings"],
    benefit:
      "New alert types land consistently, respect user preferences, and can later reach email/push without re-architecture.",
    approach:
      "Typed kind registry + provider seam; Novu evaluated pragmatically and the decision recorded; in-app remains the working default.",
    uxRules: ["Alerts only ever arrive by explicit opt-in for non-transactional kinds."],
    decisions: [
      "Novu evaluated and not adopted: one in-app channel needs no workflow orchestration and DRVN must not depend on a hosted notification service; deliver.ts is the documented seam where email/push/Novu would fan out.",
    ],
    validation:
      "Typed kinds registry consistent with prefKeyForKind (unit-tested — caught and fixed ungoverned dispute kinds); deliverNotification enforces preferences at write time for app-sourced kinds and delivered the live saved-search alert; Novu decision recorded at the seam.",
  },

  // ── 09 · Admin operations ───────────────────────────────────────────────
  {
    id: "ops-cases",
    name: "Operations case model",
    group: "admin",
    status: "validated",
    brief: "K1",
    existsToday:
      "Disputes, reports, recoveries and audit exist as separate queues; nothing aggregates a problem into one assignable unit of work.",
    changing:
      "A case layer over disputes/reports: status, priority, assignment/claim, labels, internal notes, saved views, SLA awareness — operational tooling, not a CRM.",
    surfaces: ["/admin", "supabase/migrations/", "src/lib/admin/"],
    benefit: "Admin work becomes claimable and trackable instead of re-derived from queues each session.",
    approach: "Case table referencing existing objects; audited actions; module-boundary refactor where domains grew large.",
    decisions: [
      "Cases are a WORK wrapper, not a CRM: kind/status/priority/assignment/labels over the existing dispute/report objects; creation and resolution ride database triggers on the domain events so the ledger stays true no matter which path acted.",
      "Case reads use the admin console's normal read layer; mutations go through auditedAction under the pre-registered 'case.' capability family and the 0040 actor assertion.",
    ],
    validation:
      "0046 applied twice; backfill created cases from existing disputes/reports; live run as the console admin: queue renders, Claim → status 'claimed' + assigned_to + audited 'case.claim' row, labels/priority saved and audited. Lifecycle is trigger-owned, so SLA auto-refunds and buyer acceptances resolve cases without app code.",
  },
  {
    id: "dispute-dossier",
    name: "Dispute evidence dossier",
    group: "admin",
    status: "validated",
    brief: "K2",
    existsToday:
      "Dispute facts are spread across the order sheet, evidence viewer, webhook stream and messages.",
    changing:
      "One composed administrative view: listing snapshot, condition, photos, offer/order, payment and shipping timelines, messages, evidence, parties, prior actions.",
    surfaces: ["/admin/orders/[id]", "/admin/disputes"],
    benefit: "An admin resolves a dispute from one coherent dossier instead of mentally reconstructing the transaction.",
    approach: "Pure composition of existing data plus the correlation timeline from transaction-diagnostics.",
    dependsOn: ["transaction-diagnostics"],
    validation:
      "The admin order sheet now composes everything §K2 lists on one screen: listing snapshot + condition comparison (purchased vs current), photos/evidence via signed URLs, offer/order money state, the §AF transaction timeline (payment, webhook events, transfer lifecycle, refund operations), the thread, both parties with history, and prior admin actions. Timeline builder unit-tested; sheet exercised during the cases run.",
  },

  // ── 10 · Design system ──────────────────────────────────────────────────
  {
    id: "cooler-dark",
    name: "Cooler dark theme",
    group: "design-system",
    status: "implemented",
    brief: "PRD 2026-09 \u00a73 (build plan WS7)",
    existsToday:
      "The night sheet is warm sepia \u2014 #15130c paper, #f0eee5 ink, alpha-ink cut from 240,238,229 \u2014 which tints the shadows of every car photo towards brown.",
    changing:
      "One token block moves to a cool graphite paper: #121418 paper, #0c0e11 recessed, #1c1f25 / #171a1f plates, #eceef2 ink, #8a909b secondary, #22262d media fallback, #14161a on-ink, #262a31 ghost hover, and alpha-ink cut from 236,238,242. The day theme, the accent and the status hues are unchanged.",
    surfaces: [
      "src/app/globals.css",
      "src/app/(docs)/docs/brand/page.tsx",
      "src/app/(discover)/cart/payment-confirm.tsx",
    ],
    benefit:
      "Car photography sits on a neutral page instead of a warm one, so a blue car reads blue; secondary text also gained a little contrast in the move.",
    approach:
      "Night is a token remap, so the change is the one [data-theme=\"dark\"] block plus the three places that carry night hexes as literals \u2014 the brand page's swatches and night specimen, the Stripe appearance fallbacks, and the select chevron, which is an inline SVG and can't read a custom property.",
    dependsOn: [],
    uxRules: [
      "Every pairing re-measured on the switch; nothing was allowed to drop below 4.5:1.",
      "--photo-filter is unchanged: it answers how bright a photo sits on a dark page, not what colour the page is.",
    ],
    decisions: [
      "--scrim and --ink-hover follow the palette although the PRD doesn't list them: they are derived (a step under paper-deep, and ink at the day sheet's ~0.91 step), and left warm they would have been the two brown edges on a cool sheet.",
      "The status hues and their tints stay exactly as they were \u2014 accent unchanged is a ruling, and each status text token still clears 5.7:1 on its own tint over the new paper.",
    ],
    validation:
      "Contrast computed for every pairing before the switch and recorded in the CSS and in brand.md: ink 15.87:1 on paper, 14.21:1 on tile; dim 5.74:1 on paper (up from 5.52) and 5.14:1 on tile (up from 4.95); on-ink 15.59:1 on ink, 5.30:1 on the live fill. A new night axe pass over the five public pages is green \u2014 the suite had never rendered the dark theme, because the theme is a cookie and Playwright's colorScheme only sets prefers-color-scheme. Light-theme visual baselines unmoved; full vitest, typecheck and lint green; walked Home, Explore, Marketplace and Garage in the dark on the dev server at desktop and phone widths.",
  },
  {
    id: "storybook",
    name: "Storybook beside Livesheet",
    group: "design-system",
    status: "validated",
    brief: "AC",
    existsToday:
      "The registry + /docs/components specimens document components, but there is no isolated-state lab (loading/error/long-content/mobile per component).",
    changing:
      "A local/static Storybook wired to the component registry, with stories prioritized for foundational components, commerce states, composer blocks, media controls, vehicle picker, saved-search and Selling/Admin components; a11y checks where practical.",
    surfaces: ["new .storybook/", "src/components/"],
    benefit: "Every component's states are visible and testable in isolation before they ship into screens.",
    approach: "Storybook 9 static build; no paid visual-regression services; registry linkage documented.",
    decisions: [
      "Storybook 9 + nextjs-vite beside the docs site — /docs stays the narrative + registry inventory, Storybook is the isolated-state lab. Local/static only, no paid services.",
      "Accepted dev-only advisory: image-size (DoS in ICNS/JXL parsers) inside vite-plugin-storybook-nextjs — no fix exists, devDependency only, never in the production bundle.",
      "Stories use local data-URI imagery — no network, no CSP surprises.",
    ],
    validation:
      "Static build green in ~4s; nine story files cover the priority list (Button states, ListingCard incl. no-photo/long-title/sold/fitment, order status chips+pipeline, MetricCard, Alert/EmptyState/Skeletons, ComboField, BeforeAfter, the full automotive block set, MessageThread); a11y addon on; day/night toolbar mirrors the app's data-theme; story render verified by screenshot.",
  },

  // ── 11 · Documentation ──────────────────────────────────────────────────
  {
    id: "living-artifact",
    name: "Living implementation artifact",
    group: "documentation",
    status: "validated",
    brief: "First deliverable",
    existsToday: "The docs microsite documents design and components; implementation status lived in ad-hoc markdown files.",
    changing:
      "This page: /docs/implementation rendered from `src/lib/docs/implementation-registry.ts`, with a generated markdown twin — one source of truth, updated continuously through the workstream.",
    surfaces: ["/docs/implementation", "src/lib/docs/implementation-registry.ts", "docs/site/implementation.md"],
    benefit: "Anyone can see at a glance what is changing, why it matters, and how far along it actually is.",
    approach: "Same governance pattern as the component registry: typed source, rendered page, generated markdown, drift-guarded by tests.",
    validation:
      "Living since Group 1 and updated at every milestone: /docs/implementation renders from the typed registry, the markdown twin is drift-guarded (npm run docs:implementation), and the shareable board republishes from the same source. Statuses audited against the repository at each commit.",
  },
  {
    id: "generated-docs",
    name: "Code-derived documentation expansion",
    group: "documentation",
    status: "validated",
    brief: "AD, B3",
    existsToday:
      "components.md is generated from the registry; search, vehicles, notifications, activity schema, jobs and Stripe lifecycle have no authored docs pages.",
    changing:
      "Docs pages (with markdown twins) for search behavior, the vehicle catalog, fitment, the activity document schema and block types, notifications, Selling IA, background jobs and admin operations — derived from typed registries wherever one exists.",
    surfaces: ["/docs", "docs/site/", "src/lib/docs/"],
    benefit: "The systems being built in this workstream are approachable instead of mysterious.",
    approach:
      "Extend SITE_PAGES; generate from source-of-truth registries (blocks, notification kinds, domain states) where possible. Fumadocs evaluated: not adopted — the code-generated architecture is the asset (decision recorded).",
    decisions: [
      "Fumadocs evaluated and not adopted: the registry-driven generation + markdown-twin architecture is the asset; a docs framework would replace exactly the part that works.",
      "Three generated surfaces now share one governance pattern: components.md, implementation.md, and the systems docs (notification kinds + domain states).",
    ],
    validation:
      "Six new docs shipped and served through the microsite's md routes (verified 200 as admin): search (§B3 in full), vehicles (sources + licenses + attribution), activity schema + block table, notifications (GENERATED kinds table), domain states (GENERATED transition tables), operations (jobs decision, diagnostics, admin, Selling IA, analytics). Generated blocks drift-guarded by system-docs.test.ts (npm run docs:systems).",
  },

  // ── 12 · Analytics & observability ──────────────────────────────────────
  {
    id: "product-analytics",
    name: "Product analytics behind an abstraction",
    group: "analytics",
    status: "validated",
    brief: "AE",
    existsToday: "Sentry-style error monitoring exists; there is no product analytics at all.",
    changing:
      "A typed event taxonomy (vehicle added, update published, listing published, search performed, saved search created, offer submitted, checkout started, purchase completed…) behind a provider abstraction, with PostHog as the optional self-hostable sink and strict masking rules.",
    surfaces: ["src/lib/analytics/", "instrumented flows"],
    benefit: "Product decisions can be made from what users actually do — without capturing anything sensitive.",
    approach:
      "capture() no-ops without configuration; payment/address/message/evidence surfaces excluded by construction; DRVN never requires a paid service to run.",
    decisions: [
      "Server-side only: no autocapture, no session replay, no client SDK — the typed union is the privacy review gate; events carry ids and coarse counts, never free text/addresses/messages/evidence.",
      "Feature flags are env-based (FLAG_X) behind flagEnabled() — PostHog flags can slot in behind the same function when rollout targeting is actually needed.",
    ],
    validation:
      "Typed taxonomy behind capture() — unit-tested (no-op without POSTHOG_KEY, correct payload when configured, failure never throws, env flags). Fourteen flows instrumented server-side: vehicle added, update published, listing started/published, search (lane+results, first page only), fitment filter, saved-search created/alert, offer, checkout started, purchase completed (webhook settle), dispatch, dispute opened.",
  },

  // ── 13 · Future-ready architecture ──────────────────────────────────────
  {
    id: "domain-states",
    name: "Explicit domain state definitions",
    group: "future-architecture",
    status: "validated",
    brief: "AG, AH",
    existsToday:
      "Statuses for orders/offers/listings/disputes/refunds/transfers are enforced piecemeal across SQL and actions; no single TypeScript definition exists.",
    changing:
      "Typed state/transition definitions per domain used for developer clarity, UI mapping, docs generation and tests — with PostgreSQL protections staying authoritative. Medusa-style step/compensation ideas borrowed only where they clarify existing workflows.",
    surfaces: ["src/lib/domain/", "/docs"],
    benefit: "\"Which states can reach which states\" becomes one readable definition instead of archaeology.",
    approach: "Declarative transition maps + doc generation; no state-machine framework.",
    decisions: [
      "Deliberately not a state-machine framework: PostgreSQL stays authoritative; the maps are documentation with teeth (consistency tests + generated docs). Medusa/Vendure informed the shape only.",
    ],
    validation:
      "Transition maps for orders/listings/offers/transfers/refunds with per-domain enforcement notes; 5 unit tests (no dangling targets, terminals exist, covers every status the product's own grouping knows, load-bearing money rules, moderation-only takedown clearing); generated into docs/site/domain-states.md.",
  },
  {
    id: "background-jobs",
    name: "Background-job architecture decision",
    group: "future-architecture",
    status: "validated",
    brief: "AI",
    existsToday:
      "pg_cron + durable queue tables + bearer-gated worker routes handle money and GC; new non-financial work (search indexing, saved-search matching) needs a home.",
    changing:
      "A documented decision: whether the existing Postgres pattern covers the new async workloads or PGMQ earns its place. No Redis/Trigger.dev/Inngest without a justifying workload; money workers untouched.",
    surfaces: ["supabase/", "src/app/api/jobs/"],
    benefit: "Async work stays as durable and observable as the money path already is.",
    approach: "Extend the proven worker-route + queue-table pattern first; decision recorded here.",
    validation:
      "Decision recorded (docs/site/operations.md): the pg_cron + worker-route + durable-queue-table pattern absorbs the new workloads (search sync fire-and-forget + scripted reindex; saved-search matching as a worker pass). PGMQ not adopted — no workload needs SQS semantics; Redis/Trigger.dev/Inngest not introduced; money workers untouched.",
  },

  {
    id: "offer-floor-private",
    name: "A seller's offer minimum is private",
    group: "foundations",
    status: "validated",
    brief: "PRD O-3 · agent plan A0",
    existsToday:
      "The lowest offer a seller will take lived on `listings.offer_floor_cents`, which anon and authenticated could read table-wide through the API, and the listing page showed it as \"Offers accepted from\".",
    changing:
      "The minimum moves to `listing_private_terms`, readable only by the seller (`my_listing_offer_floor`) and the offer checks, in three releases: expand (copy, kept in step), switch (every reader moved, the old column held empty), contract (drop the column once the switched app is live everywhere).",
    surfaces: ["supabase/migrations/20261017120000_listing_private_terms.sql", "supabase/migrations/20261017130000_listing_private_terms_switch.sql", "supabase/migrations/20261019120000_negotiation_contract.sql", "src/features/commerce/offer-actions.ts", "/listings/[id]/edit", "/listings/[id]"],
    benefit: "A seller's minimum can't be read by anyone else, so it can't be used against them, by a buyer or by an agent.",
    approach:
      "Owner-only table, no client grants. One writer, `set_listing_offer_floor`, which acts only for the listing's seller and which the sell and edit functions call; the price bound is checked from both sides; offer_open and offer_move check the minimum and never name it. The switch step's absorb trigger and the old column are gone (contract, 20261019120000).",
    decisions: [
      "Showing the minimum on the listing becomes a seller toggle, off by default, with negotiation v2; until then no minimum is shown.",
    ],
    validation:
      "Expand and switch are on the shared dev project (probes in supabase/MIGRATIONS.md). Contract (20261019120000): offer_floor_privacy_guard.sql (39 checks) fails on the switch-step schema and passes after; every SQL guard, npm test, typecheck, lint and the negotiation drills pass. The contract's shared-dev apply waits until every running app copy has the switched code (supabase/MIGRATIONS.md).",
    docs: ["docs/decisions/agent-foundations.md", "supabase/MIGRATIONS.md"],
  },
  {
    id: "negotiation-v2",
    name: "Negotiation v2: counter-backs for every member",
    group: "selling",
    status: "validated",
    brief: "PRD O-1, O-2, O-4, O-5 · agent plan A1",
    existsToday:
      "An offer gets one answer: the seller accepts, declines or counters once. A below-minimum offer is refused before anything is recorded, so trying again costs nothing.",
    changing:
      "Up to 3 buyer offers per listing (counter-backs included), strict turns, a 72-hour turn, a below-minimum offer recorded as a declined turn, each round's terms kept as a snapshot, one atomic `offer_move` for every move, and seller cancellation only before checkout begins.",
    surfaces: ["src/features/commerce/offer-actions.ts", "OfferCard", "SellForm", "supabase/migrations/"],
    benefit: "Buyers and sellers can haggle a few rounds, and the minimum can't be found by trial and error.",
    approach: "Rules in the database, the same path for people and agents; lock order listing → negotiation → order → payment.",
    dependsOn: ["offer-floor-private"],
    validation:
      "Built in steps 20261017150000 (rounds), 20261017160000 (offer_open / offer_move), 20261018100000–100200 (show my minimum, listing-first locks) and 20261019120000 (contract: create_offer_with_message and the client write policies on offers are gone). offer_move_guard.sql, offer_rounds_guard.sql, tests/operations/negotiation-concurrency.test.ts and e2e/negotiation-three-rounds.spec.ts pass.",
    docs: ["docs/decisions/negotiation-v2.md", "docs/decisions/agent-foundations.md", "docs/plans/2026-10-agent-and-graph-plan.md"],
  },
  {
    id: "member-agent",
    name: "The DRVN agent",
    group: "future-architecture",
    status: "planned",
    brief: "PRD §4.9 (AG-1…AG-12) · agent plan A2–A3",
    existsToday:
      "No agent. AI is used only in the listing importer's last-resort extraction.",
    changing:
      "One agent per member that negotiates offers within limits the member sets, then chats and does garage and listing jobs, one at a time. Built on typed capabilities, mandates, tasks and a narrow worker role, with admin off switches.",
    surfaces: ["src/lib/capabilities/", "src/lib/ai/", "/agent", "BottomNav", "SidePanel"],
    benefit: "The tedious work between \"I want this\" and \"done\" gets done for you, inside limits you set, and every task still works without the agent.",
    approach:
      "Rules set prices, never the model; agents speak only to their owner; no auto-accept or automatic payment at launch. The shapes are fixed in docs/decisions/agent-foundations.md.",
    dependsOn: ["negotiation-v2"],
    validation: "Not started.",
    docs: ["docs/decisions/agent-foundations.md", "docs/plans/2026-10-agent-and-graph-plan.md"],
  },

  // ── 14 · Deferred / not pursuing ────────────────────────────────────────
  {
    id: "deferred-quick-capture",
    name: "Mobile Quick Capture",
    group: "deferred",
    status: "deferred",
    brief: "X",
    existsToday: "—",
    changing: "Not built: needs more product thinking; the improved responsive composer and media flow cover the need for now.",
    surfaces: [],
    benefit: "—",
    approach: "—",
    validation: "Intentionally deferred by the brief.",
  },
  {
    id: "deferred-logging",
    name: "Maintenance/logbook, OBD, telemetry, snapshots & diffs",
    group: "deferred",
    status: "deferred",
    brief: "Y, AJ",
    existsToday: "—",
    changing:
      "Not built: maintenance logbooks, service schedules, fuel logs, registration/inspection tracking, OBD/telemetry, GPS, automatic build snapshots, historical build diffs.",
    surfaces: [],
    benefit: "DRVN stays marketplace-first instead of becoming a vehicle-logging product.",
    approach: "—",
    validation: "Intentionally excluded by the brief.",
  },
  {
    id: "deferred-provenance-ledger",
    name: "Physical-part provenance ledger",
    group: "deferred",
    status: "deferred",
    brief: "AJ",
    existsToday: "Listings keep ordinary relational context (source car).",
    changing: "No installed→removed→sold→new-car event ledger; provenance is not a primary platform feature.",
    surfaces: [],
    benefit: "—",
    approach: "—",
    validation: "Intentionally excluded by the brief.",
  },
  {
    id: "deferred-trust-score",
    name: "Listing quality / trust completeness model",
    group: "deferred",
    status: "deferred",
    brief: "AJ",
    existsToday: "Reviews, ratings and condition grading already carry trust.",
    changing: "No completeness scores, trust checklists or opaque trust numbers.",
    surfaces: [],
    benefit: "—",
    approach: "—",
    validation: "Intentionally excluded by the brief.",
  },
  {
    id: "deferred-build-completeness",
    name: "Build completeness prompts",
    group: "deferred",
    status: "deferred",
    brief: "AA",
    existsToday: "—",
    changing: "No completion meters, checklists or gamified scores now; contextual suggestions may come later.",
    surfaces: [],
    benefit: "—",
    approach: "—",
    validation: "Intentionally deferred by the brief.",
  },
  {
    id: "deferred-push",
    name: "Push notifications",
    group: "deferred",
    status: "deferred",
    brief: "D",
    existsToday: "DRVN is web-first; in-app notifications exist.",
    changing: "Push delivery is a future channel behind the notification boundary, not built now.",
    surfaces: [],
    benefit: "—",
    approach: "—",
    validation: "Intentionally deferred by the brief.",
  },

  // ── Transaction Completion & Seller Scale (August 2026 brief) ───────────
  {
    id: "commercial-snapshot",
    name: "Immutable commercial sale snapshot",
    group: "selling",
    status: "validated",
    brief: "TX §6",
    existsToday:
      "order_items froze title/price/shipping plus the 0024 condition snapshot; description, category, part numbers, fitment, source car, seller identity and the photo gallery all resolved against the live listing — which the seller can edit or delete after the sale.",
    changing:
      "Migration 0049: order_items.commercial_snapshot (versioned jsonb, NOT NULL) frozen by BEFORE INSERT trigger from the listing/fitment/part-number/source-car/seller rows, plus order_item_snapshot_images (gallery frozen row-per-photo). DB-level immutability guards; media GC treats snapshot images as references; the order page's 'As purchased' reads snapshot data only.",
    surfaces: [
      "supabase/migrations/0049_commercial_snapshot.sql",
      "src/features/commerce/snapshot.ts",
      "src/app/(product)/orders/[id]/page.tsx",
      "src/lib/media-lifecycle.ts",
    ],
    benefit:
      "A dispute never depends on reconstructing historical truth: buyer and seller can both prove exactly what was represented at purchase, even after the listing changes or disappears.",
    approach:
      "Same trigger pattern as 0024 so every SQL order-creation path is covered without redefining the RPCs; snapshot content is built entirely server-side and cannot be forged or edited (42501 column guards, verified by supabase/tests/snapshot_guard.sql).",
    decisions: [
      "Versioned jsonb (snapshot_version) rather than accreting snapshot columns; v1 shape documented by the reader in src/features/commerce/snapshot.ts.",
      "Pre-0049 rows were backfilled from the live listing and flagged backfilled (or degraded when the listing was gone) — honest about being post-purchase content.",
      "listing_id stays unfrozen on order_items so the FK's ON DELETE SET NULL keeps working; everything evidential lives in the snapshot instead.",
      "No addresses, phone numbers or payment references in the snapshot — evidence of representation, not private fulfilment data.",
    ],
    validation:
      "snapshot_guard.sql green against the project (edit/delete everything post-sale → frozen record byte-identical; UPDATE forgeries refused); reader unit tests; full vitest suite green; 0049 applied twice (idempotent).",
    docs: ["supabase/MIGRATIONS.md"],
  },
  {
    id: "fee-includes-shipping",
    name: "Platform fee on goods + buyer-paid shipping",
    group: "selling",
    status: "validated",
    brief: "TX §7",
    existsToday:
      "The 10% fee was computed on the merchandise subtotal only, hardcoded in purchase_begin (0007) and offer_accept_begin (0034) — sellers could shrink DRVN's fee by pricing value into shipping.",
    changing:
      "Migration 0050 restates both RPCs with the fee basis as subtotal + shipping; the TS mirror, cart/checkout estimates and the /fees page follow. Historical orders keep their stored platform_fee_cents everywhere.",
    surfaces: [
      "supabase/migrations/0050_fee_includes_shipping.sql",
      "src/lib/payments/provider.ts",
      "src/lib/checkout-data.ts",
      "src/app/(legal)/fees/page.tsx",
    ],
    benefit:
      "The fee is split-proof: the same buyer total always produces the same fee, and the fee page shows exactly that arithmetic.",
    approach:
      "Authoritative computation stays in SQL; the ledger's null-fee fallback deliberately keeps the goods-only basis because every such row was charged under it — the ledger reports what was charged, never what today's rule would charge.",
    validation:
      "0050 self-checks assert the new basis via pg_get_functiondef; snapshot_guard.sql proves fee equality across opposite price/shipping splits of the same total; fee unit tests updated with the brief's $300+$23 worked example.",
    docs: ["src/app/(legal)/fees/page.tsx", "supabase/MIGRATIONS.md"],
  },
  {
    id: "integrated-shipping",
    name: "DRVN Shipping — rates, labels, tracking",
    group: "selling",
    status: "implemented",
    brief: "TX §8-§19",
    existsToday:
      "Shipping was one flat seller-set number and a client-trusted collection checkbox; tracking was two free-text columns on orders with no carrier feed.",
    changing:
      "A DRVN-owned shipping domain: private seller fulfillment profiles (0051, Settings → Shipping, address-verified), a provider seam (EasyPost via plain fetch + a deterministic stub for dev/e2e, gated by FLAG_INTEGRATED_SHIPPING_V1), shipments/shipment_items/shipment_events + the signed seller_adjustments ledger (0052), listing shipping modes with seller-declared parcels and rated checkout over server-held quotes (0053), seller label buy/void with idempotent adjustments, an HMAC-verified EasyPost webhook that drives shipment and order state, and payout math that nets label costs (transfer worker + ledger).",
    surfaces: [
      "src/lib/shipping/",
      "src/features/commerce/{fulfillment,checkout-shipping,shipping-quote-actions,fulfillment-actions}.ts",
      "src/app/api/shipping/easypost/route.ts",
      "src/app/(discover)/checkout/checkout-steps.tsx",
      "src/app/(product)/orders/[id]/shipping-controls.tsx",
      "supabase/migrations/0051-0053",
    ],
    benefit:
      "A buyer sees live carrier rates for their address and pays exactly that; the seller gets a one-click label whose cost transparently nets out of their payout; tracking moves the order without anyone clicking.",
    approach:
      "Nothing money-shaped trusts the client: quotes live server-side (deny-all RLS) keyed to a destination fingerprint, purchase_begin takes server-validated overrides, the fee basis (0050) includes quoted shipping automatically, and the DB guards shipment transitions and one-live-shipment-per-item.",
    decisions: [
      "One listing = one parcel (§12) — no cartonization.",
      "Shipping fails DISABLED, not closed: a missing EasyPost key in production quietly disables DRVN Shipping; seller-arranged always works.",
      "Offers are blocked on DRVN-Shipping listings for now: offers freeze money at accept, rated shipping prices at checkout — recorded as the §15 gap to close with offer-time rating.",
      "labels are seller-visible only: shipments.label_reference is excluded from the client column grant; provider ids are opaque so EndShipper→Forge stays a provider-file change (§10).",
    ],
    validation:
      "13 shipping unit tests (mode resolution, EasyPost mappers, stub determinism); guard behaviour in 0052/0053 self-checks; full vitest + production build green. Real EasyPost test-mode calls still to be exercised before production postage (§10 checklist in the runbook).",
    dependsOn: ["commercial-snapshot", "fee-includes-shipping"],
    docs: ["supabase/MIGRATIONS.md", ".env.example"],
  },
  {
    id: "pickup-confirmation",
    name: "Provable local pickup",
    group: "selling",
    status: "validated",
    brief: "TX §20-§21",
    existsToday:
      "Collection was an honor system: is_collection came from a client checkbox and nothing proved a handoff ever happened.",
    changing:
      "0054: seller marks Ready for pickup; buyer opens a rotating single-use Pickup Pass (QR encoding a seller-side redeem URL + six-digit fallback, hashes only in the DB, 1h TTL, 10-attempt lockout); pickup_redeem() burns it atomically and moves the order into the same delivered/clearing path as shipped orders. The 0053 guard separately refuses is_collection unless every item's frozen snapshot offered pickup.",
    surfaces: [
      "supabase/migrations/0054_pickup_confirmations.sql",
      "src/features/commerce/pickup-actions.ts",
      "src/app/(product)/orders/[id]/pickup-controls.tsx",
      "src/app/(product)/orders/[id]/pickup/page.tsx",
    ],
    benefit:
      "A local handoff has objective proof for both sides — no more 'never collected' disputes — and payout clearing starts the moment the part changes hands.",
    approach:
      "No reusable plaintext secrets (§21): the pass rotates on every show, only salted hashes persist, and the buyer's Mark received stays as the fallback path.",
    validation:
      "return_guard.sql proves seller-only redemption, attempt counting, single-use, and order delivery against the live project; nextAction unit tests cover the handshake wording; full suite green.",
    dependsOn: ["commercial-snapshot"],
  },
  {
    id: "returns-rma",
    name: "Returns / RMA domain",
    group: "selling",
    status: "validated",
    brief: "TX §22-§31",
    existsToday:
      "Dispute resolution was binary — full refund or argue — with no way to get the item back before money moved, and the day-10 auto-refund could fire while a part was physically in transit back.",
    changing:
      "0055: an item-aware RMA domain (returns + return_items, guarded 11-state lifecycle, one live RMA per unit) with deadlines frozen on the row (ship within 7 days or expire; 48h seller inspection or the agreed refund proceeds automatically). Sellers resolve disputes three ways (partial refund keep, full refund keep, return-then-refund); shops additionally take policy returns judged against the SNAPSHOT's frozen policy. DRVN return labels for seller-caused returns land on the seller's adjustment ledger; return tracking drives the RMA via the same webhook path; completion refunds through the 0026 engine (initiator return:<id>), and an active RMA pauses the dispute SLA clock.",
    surfaces: [
      "supabase/migrations/0055_returns.sql",
      "src/features/commerce/{returns,return-actions,shop-actions}.ts",
      "src/app/(product)/orders/[id]/return-controls.tsx",
      "src/lib/payments/dispute-sla.ts",
      "src/app/api/jobs/transfers/route.ts",
    ],
    benefit:
      "An item can travel back before a refund when it should; ordinary returns resolve on timers without founder intervention; a contested returned box goes to human review before any money moves.",
    approach:
      "The Return domain decides when/how much, the refund engine moves money — no provider calls in return code. Escalation reopens the order's existing ops case (§29), never a new queue. Entitlement math is pure and unit-tested (§31): seller-caused returns include the item's frozen shipping share, buyer-preference returns don't.",
    validation:
      "return_guard.sql green against the project (illegal transitions refused, moving returns can't expire, one live RMA per unit); 7 unit tests on entitlement + lifecycle map incl. no-refund-before-receipt; timers wired into the jobs pass; full suite + build green.",
    dependsOn: ["integrated-shipping", "commercial-snapshot"],
  },
  {
    id: "shop-profiles",
    name: "Lightweight shop profiles",
    group: "selling",
    status: "validated",
    brief: "TX §34-§38",
    existsToday:
      "profiles.profile_type = 'user'|'shop' existed since 0001 (guarded from self-escalation by 0017) but nothing used it — no shop features, no verification concept, no return policies.",
    changing:
      "0056: shop_profiles one-to-one with profiles (admin-granted verification, returns_accepted + 14/30/60-day window). Controlled server-side conversion in Settings → Shop; the storefront opens on For Sale with a Shop/Verified-shop eyebrow; the snapshot freezes the policy + verified state into every purchase; buyers get the §24B preference-return flow judged against that frozen policy.",
    surfaces: [
      "supabase/migrations/0056_shop_profiles.sql",
      "src/features/commerce/shop-actions.ts",
      "src/app/(product)/settings/shop-section.tsx",
      "src/app/(discover)/u/[username]/page.tsx",
    ],
    benefit:
      "A business runs a recognizable storefront on the same account it uses socially — and a shop tightening its policy tomorrow can never strip a right yesterday's buyer bought with.",
    approach:
      "Shops extend profiles; nothing is duplicated. Verification is manual for MVP: granted service-role/SQL like admin_users, never self-declared — an unverified shop is never rendered verified.",
    decisions: [
      "Deliberately NOT built (§38): employees/roles, inventory, POS, CRM, wholesale, fulfillment routing.",
    ],
    validation:
      "0056 self-checks (no client write policy; snapshot freezes the policy; profiles guard intact); frozen-policy reader covered by snapshot unit tests; full suite + build green.",
    dependsOn: ["commercial-snapshot", "returns-rma"],
  },

  {
    id: "app-shell",
    name: "The shell — search, Post, unread",
    group: "design-system",
    status: "implemented",
    brief: "PRD 2026-09 N-2, N-3, N-5 (build plan WS8)",
    existsToday:
      "The bar carried a plain search input that went to a results page, no way to start a post from anywhere, and a Messages link that never said whether anyone had written.",
    changing:
      "The suggesting search field is mounted in the bar itself, a Post button sits beside it, and unread message counts stream into the rail and the menu as badges.",
    surfaces: [
      "src/components/ui/livesheet-bar.tsx",
      "src/lib/shell-counts.ts",
      "src/components/ui/app-shell.tsx",
    ],
    benefit:
      "The two things a member does most often — look for something, say something — are one reach away on every page, and a message no longer waits to be discovered.",
    approach:
      "Counts stream through a Suspense boundary so the shell renders immediately and the badge arrives when the query does; nothing in the bar blocks first paint.",
    uxRules: [
      "A badge shows a number, never a dot with no meaning.",
      "The Post button goes to the quick box, not the full editor — the short path is the default.",
    ],
    validation:
      "Typecheck and the full unit suite green; verified in the running app at desktop and phone width in both themes.",
  },

  {
    id: "home-daily",
    name: "Home — what changed since you were last here",
    group: "garage",
    status: "implemented",
    brief: "PRD 2026-09 H-1, H-4…H-6 (build plan WS11)",
    existsToday:
      "Home was a wall of tiles: an attention list, seller KPIs, a prompt to post, and a feed underneath. It described the account rather than showing what had happened.",
    changing:
      "Two columns — the feed with the quick box on top, and a rail of the few things that genuinely need an answer. The seller KPIs move to /selling, where somebody actually goes to run a shop. Empty tiles don't render; a member with no car gets 'Add your car' instead of an empty garage tile; with fewer than three posts the first rail card follows the last post rather than sitting in a column of its own.",
    surfaces: [
      "src/app/(product)/home/page.tsx",
      "src/app/(product)/selling/page.tsx",
      "supabase/migrations/20260919193000_suggested_builders.sql",
    ],
    benefit:
      "Home answers the question people actually open it with, and a sparse account looks deliberate rather than broken.",
    approach:
      "suggested_builders takes a nullable viewer so the same RPC serves a signed-out preview; the feed scrolls to load using the Explore wall's existing mechanism rather than a second one.",
    dependsOn: ["app-shell"],
    uxRules: [
      "A tile with nothing in it does not render. An empty box is a bug that looks like a design.",
      "Local only appears once the member has said where they are.",
    ],
    validation:
      "Verified in the running app: the two-column 605px/320px grid, the quick box on top of the feed, the rail's cards, and the sparse fallbacks. Full unit suite and typecheck green.",
  },

  {
    id: "garage-focused",
    name: "Garage — one car at a time",
    group: "garage",
    status: "implemented",
    brief: "PRD 2026-09 G-1…G-5 (build plan WS12)",
    existsToday:
      "The garage listed every car as a sheet, so a member with one car read a list of one and a member with six read six half-sheets and could work on none of them.",
    changing:
      "A switcher picks the car; the focused view gives that car its stat strip, its tabs (Overview, Mods, Parts, Media) and the existing editors mounted inside them. /garage/[id]/edit stays exactly where it was.",
    surfaces: [
      "src/app/(product)/garage/page.tsx",
      "src/app/(product)/garage/garage-switcher.tsx",
      "src/app/(product)/garage/focused-car.tsx",
      "src/app/(product)/garage/focused-panels.tsx",
    ],
    benefit:
      "The garage becomes a workspace for the car you are working on rather than an index of cars you own.",
    approach:
      "?car= drives the selection, so the view is linkable and the back button works. The panels mount the editors that already exist rather than reimplementing them.",
    dependsOn: ["main-car"],
    uxRules: ["The main car leads the switcher; 'All cars' is always one tap away."],
    validation:
      "Verified in the running app: switcher, three-tile stat strip, and the four tabs with their counts. Full unit suite and typecheck green.",
  },

  {
    id: "explore-wall",
    name: "Explore — one wall, one footprint",
    group: "discovery",
    status: "implemented",
    brief: "PRD 2026-09 E-1…E-4 (build plan WS13)",
    existsToday:
      "The wall was two columns on a phone but the cells were not one footprint — a build cell sat shorter than the update beside it and the rows ran ragged, which is exactly what the direction rules out.",
    changing:
      "A uniform cell footprint per kind, and breakers (trending models, builders worth following) woven into the wall at fixed positions. Legacy posts with no photo are left off the photo walls rather than borrowing a car's cover, and stay everywhere else.",
    surfaces: [
      "src/components/ui/mosaic.tsx",
      "src/components/ui/masonry-feed.tsx",
      "src/app/(discover)/explore/breakers.tsx",
      "supabase/migrations/20260919195000_trending_models.sql",
    ],
    benefit:
      "The wall scans. A ragged grid reads as a broken page, and the eye stops at the first gap.",
    approach:
      "The caption block is a fixed height per kind rather than a natural one — the design proof's finding, made before the breakers were built.",
    uxRules: [
      "A breaker renders only with at least three results. Two 'builders worth following' is not a section.",
      "A post with no photo is never given somebody else's photo.",
    ],
    validation:
      "Measured in the running app: one footprint (229x355) across twenty cells, one breaker rendered, the Builders breaker correctly suppressed below three. Full unit suite green.",
  },

  {
    id: "quick-post",
    name: "Quick post, the photo rule, tagging a part",
    group: "composer",
    status: "validated",
    brief: "PRD 2026-09 W-1…W-3 (build plan WS14a)",
    existsToday:
      "Posting meant the full editor: a required title, blocks, a draft. 'New wheels turned up' had nowhere to go, and every post needed a heading whether or not the member had one in mind.",
    changing:
      "A quick box — photos, a caption, Post — with no title and no draft. A title becomes optional in the database and every reader goes through postHeadline() instead of assuming a string. A published post needs at least one photo. A post can tag up to three of the author's own active parts.",
    surfaces: [
      "src/features/composer/quick-post.tsx",
      "src/features/composer/part-picker.tsx",
      "src/lib/activity/headline.ts",
      "supabase/migrations/20260919194000_quick_post_and_tagged_parts.sql",
    ],
    benefit:
      "The gap between 'something happened to my car' and 'it is on DRVN' becomes about fifteen seconds.",
    approach:
      "A new `quick` write mode that returns before the draft lookup the publish path performs — the release-blocking contract, since publish converts a car's existing draft into the published post. Retry-safety comes from the same operation id publishing already uses.",
    dependsOn: ["unified-composer"],
    uxRules: [
      "A quick post never touches a saved draft. With no draft, 'Write a full update' carries the caption over; with one, the link says 'Continue your draft' and nothing is merged.",
      "The photo rule applies to new publishes only — a post published before the rule can still be edited without one.",
      "Three tagged parts at most. A post with eight is a shop window, and the feed is not the marketplace.",
    ],
    decisions: [
      "No generated headings. 'Update from the Silvia' is DRVN's sentence, not the member's — the fallback is their own first line.",
      "sync_activity_post_listings is SECURITY DEFINER and checks the author itself, so a direct call can't tag parts onto somebody else's post.",
    ],
    validation:
      "activity_quick_post_guard.sql (release-blocking) proves the draft is byte-identical after a quick post, both posts exist, the quick post has no title, a replay returns 'replayed', a photoless publish is refused and a draft may still have none. Whole SQL guard suite green; full unit suite and typecheck green; the box verified in the running app.",
  },

  {
    id: "carless-posts",
    name: "Posting without a car",
    group: "composer",
    status: "validated",
    brief: "PRD 2026-09 W-5 (build plan WS14b)",
    existsToday:
      "activity_posts.car_id was NOT NULL, so a member who had sold their car, or who was selling parts before buying one, could not post at all. Principle 1 says the car gives context and is never a gate.",
    changing:
      "car_id becomes optional, and a post must be about a car, a tagged part, or both. A carless post lives at /posts/[postId] with its own share card, and postHref() replaces the hand-built permalink in every reader.",
    surfaces: [
      "src/app/(discover)/posts/[postId]/page.tsx",
      "src/lib/activity/href.ts",
      "supabase/migrations/20260919197000_posts_without_a_car.sql",
      "supabase/migrations/20260919198000_carless_posts_reach.sql",
      "supabase/migrations/20260919199000_carless_quick_post.sql",
      "supabase/migrations/20260919200000_carless_post_policies.sql",
    ],
    benefit:
      "Between cars, you are still a member. The gate that said otherwise is gone without weakening the rule that everything is about a car or a part.",
    approach:
      "Dropping the NOT NULL is the small half. Every reader, the writer and the RLS policies expressed the car requirement as a join or an EXISTS against cars, and each would have dropped a carless post silently — which to the member is indistinguishable from posting into nothing. Four migrations: the column and the subject rule, the readers, the writer, the policies.",
    dependsOn: ["quick-post"],
    uxRules: [
      "A post with a car keeps the URL it has always had — every link already in the world still resolves.",
      "'No car — about a part' is the last option in the picker, not the first: it is the exception, not the default.",
    ],
    decisions: [
      "A published post with no car is public. There is no private car to hide behind, and publishing is the act of making it public; the alternative is a post its author can see and nobody else can.",
      "The subject rule is a deferred constraint trigger rather than composer validation — a rule about what the product IS belongs where it can't be forgotten.",
      "The car stays required in the full editor: it is reached from a car sheet and its draft machinery is keyed by car.",
    ],
    validation:
      "carless_post_reach_guard.sql: a carless post publishes, one about neither a car nor a part is refused, it appears in feed_events with the right owner, search finds it, Local finds it in the author's region and not another, post_href gives /posts/<id> for it and leaves a post with a car untouched, and a save, a comment and a reaction each notify the author at that URL. Whole SQL guard suite green; full unit suite and typecheck green.",
  },

  {
    id: "local-feed",
    name: "Local — what's happening near me",
    group: "discovery",
    status: "implemented",
    brief: "PRD 2026-09 H-2 (build plan WS15)",
    existsToday:
      "DRVN knew a member's free-text 'location' and did nothing with it. There was no way to see the builds and parts around you.",
    changing:
      "profiles gains country and region from a curated list, settings asks for them, and Home grows a Local tab backed by local_feed_rows.",
    surfaces: [
      "src/lib/geo/regions.ts",
      "src/app/(product)/settings/settings-panel.tsx",
      "src/app/(product)/home/page.tsx",
      "supabase/migrations/20260919196000_seller_defaults_and_region.sql",
    ],
    benefit:
      "Cars are a local hobby. The person with the part you need is often forty minutes away, and nothing in the product knew that.",
    approach:
      "Coarse on purpose — a country and a region, never a town. A build sheet plus a town is close to an address, and the PRD rules location tags out.",
    uxRules: [
      "Local only appears once the member has said where they are; it is never inferred.",
      "Changing the country clears the region rather than leaving an impossible pair.",
    ],
    decisions: [
      "One more column on feed_events rather than a second view: Local is the same feed with one more filter, and two views would drift.",
    ],
    validation:
      "Verified in the running app: the country and region rows in settings, the dependent region select appearing on choosing a country, and Local on Home. Covered by the geo unit tests and carless_post_reach_guard's region assertions.",
  },

  {
    id: "offer-floor-default",
    name: "A seller's default lowest offer",
    group: "selling",
    status: "implemented",
    brief: "PRD 2026-09 P-9 (build plan P-9)",
    existsToday:
      "Every listing asked for an offer floor from scratch, so a seller with a consistent policy re-typed it on every part.",
    changing:
      "profiles.default_offer_floor_pct prefills the sell form. It is a default, never a rule applied to listings that are already live.",
    surfaces: [
      "src/app/(product)/settings/settings-panel.tsx",
      "src/app/(product)/sell/sell-form.tsx",
      "supabase/migrations/20260919196000_seller_defaults_and_region.sql",
    ],
    benefit: "A seller states their policy once instead of on every listing.",
    approach:
      "A prefill only. Changing the default cannot retroactively change what a buyer is already looking at.",
    uxRules: ["Never retroactive. A live listing keeps the floor it was published with."],
    validation:
      "Column grants applied with the H-2 migration; the settings field and the sell-form prefill verified in the running app; full unit suite and typecheck green.",
  },
];

/** Count of initiatives per status, for the page's progress summary. */
export function statusCounts(): Record<InitiativeStatus, number> {
  const counts = {
    planned: 0,
    "in-progress": 0,
    implemented: 0,
    validated: 0,
    deferred: 0,
    "blocked-external": 0,
  } as Record<InitiativeStatus, number>;
  for (const item of IMPLEMENTATION_REGISTRY) counts[item.status] += 1;
  return counts;
}

export function initiativesFor(group: GroupId): Initiative[] {
  return IMPLEMENTATION_REGISTRY.filter((item) => item.group === group);
}
