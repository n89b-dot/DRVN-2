import type { Metadata } from "next";

import { CATEGORY_REDIRECTS } from "./state";
import { getCategory } from "./taxonomy";

/**
 * Metadata for the marketplace category routes.
 *
 * The root description stopped selling parts when the front door stopped
 * describing DRVN as only a marketplace (F-2), so every marketplace route
 * carries marketplace wording of its own — this is the page a search for
 * "used coilovers" should land on, and it needs to read like one.
 *
 * Unknown slugs fall back to the marketplace's own wording rather than
 * throwing: the page itself answers a bad slug with the full marketplace and
 * a notice, and a
 * redirected alias (`CATEGORY_REDIRECTS`) resolves to its canonical label so
 * the transient response isn't titled "Marketplace".
 */
export function categoryMetadata(categorySlug: string, subcategorySlug?: string): Metadata {
  const category = getCategory(CATEGORY_REDIRECTS[categorySlug] ?? categorySlug);
  const leaf = subcategorySlug
    ? category?.subcategories.find((s) => s.slug === subcategorySlug)
    : undefined;
  // An unknown slug renders the whole marketplace with a notice (see
  // MarketplacePageContent) — useful to the visitor, not a page to index.
  if (!category) return { title: "Marketplace - DRVN", robots: { index: false, follow: true } };

  const label = leaf?.label ?? category.label;
  const canonical = `/marketplace/${category.slug}${leaf ? `/${leaf.slug}` : ""}`;
  const description = `Used ${label.toLowerCase()} from modified cars, sold by the people who took them off. See the build each part came off before you buy.`;

  return {
    title: `${label} - DRVN Marketplace`,
    description,
    alternates: { canonical },
    openGraph: {
      title: `${label} — used parts on DRVN`,
      description,
      url: canonical,
      type: "website",
    },
  };
}
