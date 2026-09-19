/**
 * Registry for the DRVN docs microsite (/docs).
 *
 * Every HTML page under /docs has a markdown twin so agents and LLMs can read
 * the same documentation as plain text: the twin is served at /docs/md/<slug>
 * with a text/markdown content type, and /docs/llms.txt indexes all of them.
 *
 * `file` paths are relative to the repository root. Authored microsite pages
 * live in docs/site/; reference entries point at pre-existing repo documents
 * (the Livesheet design.md contract, the component design doc, the PRD…) so
 * the microsite is one front door to everything.
 */

export type DocEntry = {
  slug: string;
  title: string;
  description: string;
  /** Repo-root-relative path to the markdown source. */
  file: string;
  /** Authored microsite page (has an HTML twin at /docs/<slug>) vs raw reference doc. */
  kind: "site" | "reference";
};

export const SITE_PAGES: DocEntry[] = [
  {
    slug: "index",
    title: "DRVN documentation",
    description: "What this microsite covers and how to read it (humans and LLMs).",
    file: "docs/site/index.md",
    kind: "site",
  },
  {
    slug: "brand",
    title: "Brand",
    description: "The DRVN name, wordmark, voice, palette and photography rules.",
    file: "docs/site/brand.md",
    kind: "site",
  },
  {
    slug: "design-system",
    title: "Design system — Livesheet",
    description:
      "How Livesheet functions: concept, tokens, day/night theming, geometry, motion.",
    file: "docs/site/design-system.md",
    kind: "site",
  },
  {
    slug: "typography",
    title: "Typography",
    description: "IBM Plex Sans + Mono, the full type scale, and usage rules.",
    file: "docs/site/typography.md",
    kind: "site",
  },
  {
    slug: "components",
    title: "Components",
    description: "The complete component catalog, categorized, with markup shapes.",
    file: "docs/site/components.md",
    kind: "site",
  },
  {
    slug: "motion",
    title: "Motion",
    description:
      "The DRVN motion language: philosophy, Motion for React vs CSS boundary, timing, springs, recipes, reduced motion.",
    file: "docs/site/motion.md",
    kind: "site",
  },
  {
    slug: "patterns",
    title: "Patterns",
    description:
      "Page-level patterns: route map, commerce flows, empty states, form states.",
    file: "docs/site/patterns.md",
    kind: "site",
  },
  {
    slug: "rules",
    title: "Rules",
    description:
      "The do/don't contract: design rules, content rules, accessibility, engineering conventions.",
    file: "docs/site/rules.md",
    kind: "site",
  },
  {
    slug: "material",
    title: "Material 3 as a behavioral reference",
    description:
      "What the component library borrows from Material 3 (behavior, adaptive model) and what it never will (any of Google's styling).",
    file: "docs/site/material.md",
    kind: "site",
  },
  {
    slug: "implementation",
    title: "Implementation — living record",
    description:
      "Live status of the platform-evolution workstream: every initiative, its benefit, approach and honest validation state.",
    file: "docs/site/implementation.md",
    kind: "site",
  },
];

export const REFERENCE_DOCS: DocEntry[] = [
  {
    slug: "search",
    title: "DRVN search",
    description:
      "Marketplace and Explore search: lanes, object families, filters, providers, indexing lifecycle, hydration and privacy model.",
    file: "docs/site/search.md",
    kind: "reference",
  },
  {
    slug: "vehicles",
    title: "Vehicle identity & fitment",
    description:
      "The DRVN-owned catalog, data sources and licenses (vPIC, VehiclesDB CC-BY), the Add Car flows, and lightweight fitment.",
    file: "docs/site/vehicles.md",
    kind: "reference",
  },
  {
    slug: "activity-schema",
    title: "Activity document schema",
    description:
      "DRVN's content model for build updates: versions, every block type, the editor seam, autosave and rendering.",
    file: "docs/site/activity-schema.md",
    kind: "reference",
  },
  {
    slug: "notifications",
    title: "Notifications",
    description:
      "Every notification kind, its governing preference and source (generated table), the delivery seam, and alert etiquette.",
    file: "docs/site/notifications.md",
    kind: "reference",
  },
  {
    slug: "domain-states",
    title: "Domain states & transitions",
    description:
      "Generated transition tables for orders, listings, offers, transfers and refunds — with what enforces each.",
    file: "docs/site/domain-states.md",
    kind: "reference",
  },
  {
    slug: "operations",
    title: "Operations — jobs, admin, selling IA",
    description:
      "Background-job architecture and decisions, transaction diagnostics, admin cases/authorization, the Selling IA, analytics.",
    file: "docs/site/operations.md",
    kind: "reference",
  },
  {
    slug: "livesheet-design-md",
    title: "Livesheet design.md (source contract)",
    description:
      "The machine-readable Livesheet design contract: every token, component spec and motion rule.",
    file: "design-mockups/livesheet/design.md",
    kind: "reference",
  },
  {
    slug: "livesheet-inventory",
    title: "Livesheet component & page inventory (historical)",
    description:
      "HISTORICAL Phase-1 porting contract (2026-07) — for the current system use /docs/components and src/components/registry.ts.",
    file: "docs/livesheet-inventory.md",
    kind: "reference",
  },
  {
    slug: "component-design-doc",
    title: "Component design doc (DEPRECATED — pre-Livesheet)",
    description:
      "DEPRECATED: describes the replaced dark/Read.cv-era system; kept only for its historical iteration reports. Do not build from it.",
    file: "docs/component-design-doc.md",
    kind: "reference",
  },
  {
    slug: "product-overview",
    title: "Product overview",
    description: "What DRVN is and how the product fits together.",
    file: "docs/product-overview.md",
    kind: "reference",
  },
  {
    slug: "prd",
    title: "PRD — September 2026 direction (current)",
    description:
      "The current product definition: one product, two front doors (Explore, Marketplace), the car in the middle. Supersedes v3.1.",
    file: "docs/DRVN-PRD-2026-09.md",
    kind: "reference",
  },
  {
    slug: "build-plan-2026-09",
    title: "Build plan — September 2026 direction",
    description: "Workstreams, order of work, component-reuse decisions and documentation duties that deliver the current PRD.",
    file: "docs/plans/2026-09-direction-build-plan.md",
    kind: "reference",
  },
  {
    slug: "prd-v3-1",
    title: "PRD v3.1 (historical)",
    description: "SUPERSEDED by the September 2026 PRD — retained as as-built history and design rationale.",
    file: "docs/DRVN-PRD-v3.1.md",
    kind: "reference",
  },
  {
    slug: "production-runbook",
    title: "Production runbook",
    description: "Operating the deployed product: jobs, webhooks, incident notes.",
    file: "docs/production-runbook.md",
    kind: "reference",
  },
  {
    slug: "remediation-status",
    title: "Remediation status",
    description:
      "Remediation status — the Aug 2026 hardening pass, issues 1–54, all verified.",
    file: "docs/remediation-status.md",
    kind: "reference",
  },
  {
    slug: "listing-importer-spec",
    title: "Listing importer specification",
    description:
      "The Existing Listing Importer as built: sources, policies, pipeline, non-invention rules, review UX.",
    file: "docs/listing-importer-spec.md",
    kind: "reference",
  },
  {
    slug: "listing-import",
    title: "Listing import system",
    description:
      "Operating the importer (0047): state machine, safe fetch, adapters, AI contract, media lifecycle, analytics, troubleshooting.",
    file: "docs/site/listing-import.md",
    kind: "reference",
  },
];

export const ALL_DOCS: DocEntry[] = [...SITE_PAGES, ...REFERENCE_DOCS];

export function findDoc(slug: string): DocEntry | undefined {
  return ALL_DOCS.find((doc) => doc.slug === slug);
}
