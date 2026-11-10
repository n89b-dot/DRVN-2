import type { MetadataRoute } from "next";

import { isIndexable } from "@/lib/deployment";
import { CATEGORIES } from "@/lib/marketplace/taxonomy";
import { siteUrl } from "@/lib/site";

/**
 * SEO is named as an acquisition channel in the PRD, and there was no sitemap at
 * all. Lists the surfaces worth discovering: the public entity pages plus the
 * marketplace taxonomy. Bounded, so a large catalogue doesn't produce an
 * unbounded document.
 */

/** Regenerated hourly rather than on every crawl. */
export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  // N958 (work review #156): a deployment not named production lists
  // nothing. The request proxy also answers /sitemap.xml with 404 there
  // (src/proxy.ts), so this is the second layer, for the prerendered file.
  if (!isIndexable()) return [];
  const base = siteUrl();

  const staticEntries: MetadataRoute.Sitemap = [
    { url: `${base}/`, changeFrequency: "daily", priority: 1 },
    { url: `${base}/marketplace`, changeFrequency: "hourly", priority: 0.9 },
    { url: `${base}/explore`, changeFrequency: "hourly", priority: 0.8 },
    { url: `${base}/terms`, changeFrequency: "yearly", priority: 0.3 },
    { url: `${base}/privacy`, changeFrequency: "yearly", priority: 0.3 },
    { url: `${base}/fees`, changeFrequency: "monthly", priority: 0.4 },
    { url: `${base}/protection`, changeFrequency: "monthly", priority: 0.4 },
    { url: `${base}/copyright`, changeFrequency: "yearly", priority: 0.2 },
  ];

  const categoryEntries: MetadataRoute.Sitemap = CATEGORIES.flatMap((category) => [
    {
      url: `${base}/marketplace/${category.slug}`,
      changeFrequency: "daily" as const,
      priority: 0.7,
    },
    ...category.subcategories.map((sub) => ({
      url: `${base}/marketplace/${category.slug}/${sub.slug}`,
      changeFrequency: "daily" as const,
      priority: 0.6,
    })),
  ]);

  return [...staticEntries, ...categoryEntries];
}
