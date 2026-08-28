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
    status: "planned",
    brief: "A1",
    existsToday:
      "CI runs typecheck/lint/unit/build plus four SQL guards, but `main` is not branch-protected — a direct push can bypass every check.",
    changing:
      "Require pull requests into `main` with the existing verify + SQL-guard jobs as required status checks; document the exact GitHub configuration.",
    surfaces: [".github/workflows/ci.yml", "GitHub repository settings"],
    benefit:
      "The safety machinery that already exists cannot be accidentally skipped, so a broken money path can't land on main unnoticed.",
    approach:
      "Configure via `gh api` if the token allows; otherwise ship the precise settings as documentation and mark only the GitHub step external.",
    validation: "Not yet validated.",
  },
  {
    id: "commerce-ci",
    name: "Real commerce integration coverage",
    group: "foundations",
    status: "planned",
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
    validation: "Not yet validated.",
  },
  {
    id: "authz-hardening",
    name: "Authorization boundaries & future roles groundwork",
    group: "foundations",
    status: "planned",
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
    validation: "Not yet validated.",
  },
  {
    id: "transaction-diagnostics",
    name: "Transaction correlation & diagnostics",
    group: "foundations",
    status: "planned",
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
    validation: "Not yet validated.",
  },

  // ── 02 · Marketplace discovery ──────────────────────────────────────────
  {
    id: "search-architecture",
    name: "Automotive search architecture",
    group: "discovery",
    status: "planned",
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
    validation: "Not yet validated.",
  },
  {
    id: "saved-searches",
    name: "Saved searches & alerts",
    group: "discovery",
    status: "planned",
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
    validation: "Not yet validated.",
  },
  {
    id: "part-aliases",
    name: "Part aliases, supersessions & interchange (groundwork)",
    group: "discovery",
    status: "planned",
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
    validation: "Not yet validated.",
  },

  // ── 03 · Vehicle identity & fitment ─────────────────────────────────────
  {
    id: "canonical-add-car",
    name: "Canonical Add Car flow",
    group: "vehicle-identity",
    status: "planned",
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
    validation: "Not yet validated.",
  },
  {
    id: "vehicle-catalog",
    name: "DRVN-owned vehicle catalog",
    group: "vehicle-identity",
    status: "planned",
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
    validation: "Not yet validated.",
  },
  {
    id: "fitment-simplification",
    name: "Fitment: automatic first, optional detail",
    group: "vehicle-identity",
    status: "planned",
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
    validation: "Not yet validated.",
  },

  // ── 04 · Selling ────────────────────────────────────────────────────────
  {
    id: "selling-workspace",
    name: "Selling workspace & IA",
    group: "selling",
    status: "planned",
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
    validation: "Not yet validated.",
  },
  {
    id: "remove-to-sell",
    name: "Remove from Build → Sell this part",
    group: "selling",
    status: "planned",
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
    validation: "Not yet validated.",
  },

  // ── 05 · Build Story Composer ───────────────────────────────────────────
  {
    id: "composer-engine",
    name: "Editor engine & DRVN-owned schema",
    group: "composer",
    status: "planned",
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
    validation: "Not yet validated.",
  },
  {
    id: "unified-composer",
    name: "One progressively enhanced composer",
    group: "composer",
    status: "planned",
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
    validation: "Not yet validated.",
  },
  {
    id: "automotive-blocks",
    name: "Automotive blocks",
    group: "composer",
    status: "planned",
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
    validation: "Not yet validated.",
  },
  {
    id: "composer-templates",
    name: "Optional update templates",
    group: "composer",
    status: "planned",
    brief: "Q",
    existsToday: "No templates; every update starts blank.",
    changing:
      "Optional starter chips (General update, Installed something, Removed something, Photos, Dyno result, Issue/fix) that visibly and reversibly seed blocks — never a mandatory selection screen.",
    surfaces: ["composer"],
    benefit: "The blank page gets easier without the empty composer becoming harder.",
    approach: "Inline chips above the empty surface; applying one is explained, obvious and undoable.",
    dependsOn: ["unified-composer"],
    uxRules: ["Empty composer is already usable.", "No unexplained transformations."],
    validation: "Not yet validated.",
  },
  {
    id: "composer-autosave",
    name: "Drafts & autosave",
    group: "composer",
    status: "planned",
    brief: "R",
    existsToday: "The full editor relies on an explicit Save draft action.",
    changing:
      "Debounced remote autosave with quiet `Saved` status and local recovery; publishing stays explicit.",
    surfaces: ["composer", "server actions"],
    benefit: "A ten-photo update survives a mobile browser reload instead of vanishing.",
    approach: "Debounced draft mutation + localStorage recovery buffer; no save spam.",
    dependsOn: ["unified-composer"],
    validation: "Not yet validated.",
  },
  {
    id: "composer-motion",
    name: "Composer motion & polish",
    group: "composer",
    status: "planned",
    brief: "P",
    existsToday: "The current editor has no motion language.",
    changing:
      "Subtle, branded motion for block insertion/removal/reorder, menu opening, template application, upload completion and before/after interaction — reinforcing causality, never decorating.",
    surfaces: ["composer", "src/app/globals.css"],
    benefit: "The composer feels premium and unmistakably DRVN rather than like a form.",
    approach:
      "Livesheet-consistent transitions (Higgsfield references where useful); `prefers-reduced-motion` respected everywhere.",
    dependsOn: ["unified-composer"],
    validation: "Not yet validated.",
  },

  // ── 06 · Media & galleries ──────────────────────────────────────────────
  {
    id: "upload-queue",
    name: "Better upload queue",
    group: "media",
    status: "planned",
    brief: "S1",
    existsToday:
      "`uploadImages` centralizes validation/storage/staging, but uploads run sequentially with no per-image progress, retry or continued-editing affordance.",
    changing:
      "Immediate local previews, per-image progress, partial-failure handling, retry, cancel where possible, and editing while uploads run — on top of the untouched staged-upload lifecycle.",
    surfaces: ["src/lib/media-upload.ts", "garage gallery", "/sell", "composer"],
    benefit: "Adding twelve photos feels fast and visible instead of a silent wait that might fail wholesale.",
    approach:
      "A queue layer (Uppy evaluated vs extending the existing helper — decision recorded) beneath a DRVN-designed surface; storage and GC unchanged.",
    validation: "Not yet validated.",
  },
  {
    id: "media-reorder",
    name: "Drag-and-drop reordering",
    group: "media",
    status: "planned",
    brief: "S2",
    existsToday: "Photo ordering is ↑/↓ buttons only.",
    changing:
      "Accessible drag-and-drop sorting (dnd-kit or equivalent) for garage photos, listing photos and composer galleries, with keyboard controls retained.",
    surfaces: ["garage gallery", "/sell", "composer"],
    benefit: "Arranging a photo set takes seconds instead of button-mashing.",
    validation: "Not yet validated.",
    approach: "One sortable primitive registered in the design system, applied consistently.",
  },
  {
    id: "focal-point",
    name: "Cover & focal-point framing",
    group: "media",
    status: "planned",
    brief: "S3",
    existsToday: "Cover selection exists; framing does not — crops are whatever the layout happens to do.",
    changing:
      "Non-destructive focal/crop metadata on important images so covers render well across hero, card, and gallery contexts. Originals kept.",
    surfaces: ["garage gallery", "car pages", "listing cards"],
    benefit: "Owners control how their car appears everywhere it's cropped, without destroying the photo.",
    approach: "react-easy-crop-style percentage focal data stored as technical metadata only.",
    validation: "Not yet validated.",
  },
  {
    id: "photo-normalization",
    name: "Client-side photo normalization",
    group: "media",
    status: "planned",
    brief: "S4",
    existsToday: "Original camera files upload as-is (up to the size limit), EXIF/GPS included.",
    changing:
      "Public garage/activity/listing photos get orientation-corrected, resized, sensibly compressed, and stripped of EXIF/GPS before upload. Dispute evidence keeps originals untouched.",
    surfaces: ["src/lib/media-upload.ts"],
    benefit: "Uploads get faster and cheaper, and nobody accidentally publishes their home GPS coordinates.",
    approach: "Canvas-based normalization in the upload helper, bypassed for evidence flows.",
    uxRules: ["Never normalize private dispute evidence destructively."],
    validation: "Not yet validated.",
  },

  // ── 07 · Garage & build experience ──────────────────────────────────────
  {
    id: "annotated-showcase",
    name: "Annotated showcase image",
    group: "garage",
    status: "planned",
    brief: "U",
    existsToday: "Car photos are a plain gallery; nothing links an image region to build data.",
    changing:
      "An optional advanced feature on one (or very few) selected showcase images: hotspots linked to existing build entries, revealed through an `Explore this build`-style interaction.",
    surfaces: ["/cars/[slug]", "/garage/[id]/edit"],
    benefit: "A build becomes explorable through the car itself — tap the wheel, see the wheel spec.",
    approach:
      "Percentage-positioned hotspots referencing mod_items, accessible keyboard/touch interaction; explicitly not a post block, never on every photo.",
    uxRules: ["Default photo experience stays clean.", "Not a marketplace navigation system."],
    validation: "Not yet validated.",
  },
  {
    id: "build-evolution",
    name: "Build Evolution timeline",
    group: "garage",
    status: "planned",
    brief: "V",
    existsToday: "Activity is a list; there is no visual chronology of the car.",
    changing:
      "A visual chronological story derived from dated updates and their images — representative photos, major titles, thoughtful transitions. No snapshots, no diffs, no extra data entry.",
    surfaces: ["/cars/[slug]"],
    benefit: "Visitors can watch a build evolve instead of scrolling a feed backwards.",
    approach: "Derived entirely from existing posts/images; motion respects reduced-motion.",
    validation: "Not yet validated.",
  },
  {
    id: "passive-suggestions",
    name: "Passive creation suggestions",
    group: "garage",
    status: "planned",
    brief: "W",
    existsToday: "Editing the build or adding photos never connects to posting an update.",
    changing:
      "After a meaningful build edit or a batch of new photos, a quiet inline affordance offers `Create an update from these changes` / `Share these in an update`, prepopulating the composer when chosen.",
    surfaces: ["/garage/[id]/edit", "garage gallery"],
    benefit: "Real changes become content with one click — and the affordance is entirely ignorable.",
    approach: "Inline dismissible row, no modals, no repeat nagging; state remembered so it doesn't re-offer.",
    dependsOn: ["unified-composer"],
    uxRules: ["No popups.", "Ignorable forever without cost."],
    validation: "Not yet validated.",
  },
  {
    id: "share-cards",
    name: "Shareable build/update cards",
    group: "garage",
    status: "planned",
    brief: "AB",
    existsToday: "Car pages have OpenGraph metadata with car imagery; no designed share card exists.",
    changing:
      "Automatically generated build and update cards in DRVN's design language for social/OpenGraph use — no manual card workflow.",
    surfaces: ["/cars/[slug]", "activity posts", "OG image generation"],
    benefit: "Sharing a build off-platform looks intentional instead of like a screenshot.",
    approach: "Data-driven OG image route composing existing car/update data.",
    validation: "Not yet validated.",
  },
  {
    id: "garage-hierarchy",
    name: "Garage hierarchy pass",
    group: "garage",
    status: "planned",
    brief: "Z",
    existsToday: "The garage sheet works; density and hierarchy have grown organically.",
    changing:
      "Only reorganize where existing information can form a clearer hierarchy (current car, recent update, selling activity, pending actions) without adding density. Otherwise preserve.",
    surfaces: ["/garage"],
    benefit: "Owners see what matters about their car first — with nothing new to learn.",
    approach: "Simplify-before-add rule; no intelligence dashboard.",
    validation: "Not yet validated.",
  },

  // ── 08 · Notifications ──────────────────────────────────────────────────
  {
    id: "notification-domain",
    name: "Notification domain & delivery boundary",
    group: "notifications",
    status: "planned",
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
    validation: "Not yet validated.",
  },

  // ── 09 · Admin operations ───────────────────────────────────────────────
  {
    id: "ops-cases",
    name: "Operations case model",
    group: "admin",
    status: "planned",
    brief: "K1",
    existsToday:
      "Disputes, reports, recoveries and audit exist as separate queues; nothing aggregates a problem into one assignable unit of work.",
    changing:
      "A case layer over disputes/reports: status, priority, assignment/claim, labels, internal notes, saved views, SLA awareness — operational tooling, not a CRM.",
    surfaces: ["/admin", "supabase/migrations/", "src/lib/admin/"],
    benefit: "Admin work becomes claimable and trackable instead of re-derived from queues each session.",
    approach: "Case table referencing existing objects; audited actions; module-boundary refactor where domains grew large.",
    validation: "Not yet validated.",
  },
  {
    id: "dispute-dossier",
    name: "Dispute evidence dossier",
    group: "admin",
    status: "planned",
    brief: "K2",
    existsToday:
      "Dispute facts are spread across the order sheet, evidence viewer, webhook stream and messages.",
    changing:
      "One composed administrative view: listing snapshot, condition, photos, offer/order, payment and shipping timelines, messages, evidence, parties, prior actions.",
    surfaces: ["/admin/orders/[id]", "/admin/disputes"],
    benefit: "An admin resolves a dispute from one coherent dossier instead of mentally reconstructing the transaction.",
    approach: "Pure composition of existing data plus the correlation timeline from transaction-diagnostics.",
    dependsOn: ["transaction-diagnostics"],
    validation: "Not yet validated.",
  },

  // ── 10 · Design system ──────────────────────────────────────────────────
  {
    id: "storybook",
    name: "Storybook beside Livesheet",
    group: "design-system",
    status: "planned",
    brief: "AC",
    existsToday:
      "The registry + /docs/components specimens document components, but there is no isolated-state lab (loading/error/long-content/mobile per component).",
    changing:
      "A local/static Storybook wired to the component registry, with stories prioritized for foundational components, commerce states, composer blocks, media controls, vehicle picker, saved-search and Selling/Admin components; a11y checks where practical.",
    surfaces: ["new .storybook/", "src/components/"],
    benefit: "Every component's states are visible and testable in isolation before they ship into screens.",
    approach: "Storybook 9 static build; no paid visual-regression services; registry linkage documented.",
    validation: "Not yet validated.",
  },

  // ── 11 · Documentation ──────────────────────────────────────────────────
  {
    id: "living-artifact",
    name: "Living implementation artifact",
    group: "documentation",
    status: "in-progress",
    brief: "First deliverable",
    existsToday: "The docs microsite documents design and components; implementation status lived in ad-hoc markdown files.",
    changing:
      "This page: /docs/implementation rendered from `src/lib/docs/implementation-registry.ts`, with a generated markdown twin — one source of truth, updated continuously through the workstream.",
    surfaces: ["/docs/implementation", "src/lib/docs/implementation-registry.ts", "docs/site/implementation.md"],
    benefit: "Anyone can see at a glance what is changing, why it matters, and how far along it actually is.",
    approach: "Same governance pattern as the component registry: typed source, rendered page, generated markdown, drift-guarded by tests.",
    validation: "Registry + page + markdown twin under construction.",
  },
  {
    id: "generated-docs",
    name: "Code-derived documentation expansion",
    group: "documentation",
    status: "planned",
    brief: "AD, B3",
    existsToday:
      "components.md is generated from the registry; search, vehicles, notifications, activity schema, jobs and Stripe lifecycle have no authored docs pages.",
    changing:
      "Docs pages (with markdown twins) for search behavior, the vehicle catalog, fitment, the activity document schema and block types, notifications, Selling IA, background jobs and admin operations — derived from typed registries wherever one exists.",
    surfaces: ["/docs", "docs/site/", "src/lib/docs/"],
    benefit: "The systems being built in this workstream are approachable instead of mysterious.",
    approach:
      "Extend SITE_PAGES; generate from source-of-truth registries (blocks, notification kinds, domain states) where possible. Fumadocs evaluated: not adopted — the code-generated architecture is the asset (decision recorded).",
    validation: "Not yet validated.",
  },

  // ── 12 · Analytics & observability ──────────────────────────────────────
  {
    id: "product-analytics",
    name: "Product analytics behind an abstraction",
    group: "analytics",
    status: "planned",
    brief: "AE",
    existsToday: "Sentry-style error monitoring exists; there is no product analytics at all.",
    changing:
      "A typed event taxonomy (vehicle added, update published, listing published, search performed, saved search created, offer submitted, checkout started, purchase completed…) behind a provider abstraction, with PostHog as the optional self-hostable sink and strict masking rules.",
    surfaces: ["src/lib/analytics/", "instrumented flows"],
    benefit: "Product decisions can be made from what users actually do — without capturing anything sensitive.",
    approach:
      "capture() no-ops without configuration; payment/address/message/evidence surfaces excluded by construction; DRVN never requires a paid service to run.",
    validation: "Not yet validated.",
  },

  // ── 13 · Future-ready architecture ──────────────────────────────────────
  {
    id: "domain-states",
    name: "Explicit domain state definitions",
    group: "future-architecture",
    status: "planned",
    brief: "AG, AH",
    existsToday:
      "Statuses for orders/offers/listings/disputes/refunds/transfers are enforced piecemeal across SQL and actions; no single TypeScript definition exists.",
    changing:
      "Typed state/transition definitions per domain used for developer clarity, UI mapping, docs generation and tests — with PostgreSQL protections staying authoritative. Medusa-style step/compensation ideas borrowed only where they clarify existing workflows.",
    surfaces: ["src/lib/domain/", "/docs"],
    benefit: "\"Which states can reach which states\" becomes one readable definition instead of archaeology.",
    approach: "Declarative transition maps + doc generation; no state-machine framework.",
    validation: "Not yet validated.",
  },
  {
    id: "background-jobs",
    name: "Background-job architecture decision",
    group: "future-architecture",
    status: "planned",
    brief: "AI",
    existsToday:
      "pg_cron + durable queue tables + bearer-gated worker routes handle money and GC; new non-financial work (search indexing, saved-search matching) needs a home.",
    changing:
      "A documented decision: whether the existing Postgres pattern covers the new async workloads or PGMQ earns its place. No Redis/Trigger.dev/Inngest without a justifying workload; money workers untouched.",
    surfaces: ["supabase/", "src/app/api/jobs/"],
    benefit: "Async work stays as durable and observable as the money path already is.",
    approach: "Extend the proven worker-route + queue-table pattern first; decision recorded here.",
    validation: "Not yet validated.",
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
    id: "deferred-ai",
    name: "AI authoring/enrichment features",
    group: "deferred",
    status: "deferred",
    brief: "AJ",
    existsToday: "—",
    changing:
      "No automatic mod extraction, AI rewriting, image classification, cover selection or build advice in this workstream; the architecture merely stays compatible.",
    surfaces: [],
    benefit: "—",
    approach: "—",
    validation: "Intentionally deferred by the brief.",
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
