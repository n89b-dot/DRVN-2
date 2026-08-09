/**
 * Registry for the DRVN docs microsite (/docs).
 *
 * Every HTML page under /docs has a markdown twin so agents and LLMs can read
 * the same documentation as plain text: the twin is served at /docs/md/<slug>
 * with a text/markdown content type, and /llms.txt indexes all of them.
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
];

export const REFERENCE_DOCS: DocEntry[] = [
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
    title: "Livesheet component & page inventory",
    description:
      "Class-by-class component inventory and the mockup-to-route map used for the port.",
    file: "docs/livesheet-inventory.md",
    kind: "reference",
  },
  {
    slug: "component-design-doc",
    title: "Component design doc (profile network surfaces)",
    description:
      "Developer-facing spec for profile/vehicle/activity components, plus iteration reports.",
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
    title: "PRD v3.1",
    description: "The full product requirements document.",
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
];

export const ALL_DOCS: DocEntry[] = [...SITE_PAGES, ...REFERENCE_DOCS];

export function findDoc(slug: string): DocEntry | undefined {
  return ALL_DOCS.find((doc) => doc.slug === slug);
}
