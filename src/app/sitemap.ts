import type { MetadataRoute } from "next";

import { CATEGORIES } from "@/lib/marketplace/taxonomy";
import { siteUrl } from "@/lib/site";
import { createPublicClient } from "@/lib/supabase/public";
import { reportError } from "@/lib/monitoring";

/**
 * SEO is named as an acquisition channel in the PRD, and there was no sitemap at
 * all. Lists the surfaces worth discovering: the public entity pages plus the
 * marketplace taxonomy. Bounded, so a large catalogue doesn't produce an
 * unbounded document.
 */
const MAX_PER_TYPE = 1000;

/** Regenerated hourly rather than on every crawl. */
export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = siteUrl();

  const staticEntries: MetadataRoute.Sitemap = [
    { url: `${base}/`, changeFrequency: "daily", priority: 1 },
    { url: `${base}/marketplace`, changeFrequency: "hourly", priority: 0.9 },
    { url: `${base}/explore`, changeFrequency: "hourly", priority: 0.8 },
    { url: `${base}/terms`, changeFrequency: "yearly", priority: 0.3 },
    { url: `${base}/privacy`, changeFrequency: "yearly", priority: 0.3 },
    { url: `${base}/fees`, changeFrequency: "monthly", priority: 0.4 },
    { url: `${base}/protection`, changeFrequency: "monthly", priority: 0.4 },
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

  try {
    // Cookieless: keeps the sitemap cacheable and scoped to anonymous reads.
    const supabase = createPublicClient();

    const [{ data: cars }, { data: listings }, { data: profiles }] = await Promise.all([
      supabase
        .from("cars")
        .select("slug, updated_at")
        .eq("is_public", true)
        .order("updated_at", { ascending: false })
        .limit(MAX_PER_TYPE),
      supabase
        .from("listings")
        .select("id, updated_at")
        .eq("status", "active")
        .order("updated_at", { ascending: false })
        .limit(MAX_PER_TYPE),
      supabase
        .from("profiles")
        .select("username, updated_at")
        .not("username", "is", null)
        .order("updated_at", { ascending: false })
        .limit(MAX_PER_TYPE),
    ]);

    return [
      ...staticEntries,
      ...categoryEntries,
      ...(cars ?? []).map((car) => ({
        url: `${base}/cars/${car.slug}`,
        lastModified: car.updated_at,
        changeFrequency: "weekly" as const,
        priority: 0.8,
      })),
      ...(listings ?? []).map((listing) => ({
        url: `${base}/listings/${listing.id}`,
        lastModified: listing.updated_at,
        changeFrequency: "daily" as const,
        priority: 0.7,
      })),
      ...(profiles ?? []).map((profile) => ({
        url: `${base}/u/${profile.username}`,
        lastModified: profile.updated_at,
        changeFrequency: "weekly" as const,
        priority: 0.5,
      })),
    ];
  } catch (error) {
    // A sitemap that 500s is worse than a small one.
    reportError("[sitemap] failed to load entities", error);
    return [...staticEntries, ...categoryEntries];
  }
}
