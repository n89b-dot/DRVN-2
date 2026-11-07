import "server-only";
import { createPublicClient } from "@/lib/supabase/public";
export const SITEMAP_PAGE_SIZE = 1000;
/** The public objects the catalog sitemaps enumerate, one page family each. */
export const SITEMAP_ENTITIES = ["cars", "listings", "profiles", "posts"] as const;
export type SitemapEntity = (typeof SITEMAP_ENTITIES)[number];
/**
 * The catalog sitemap pages that exist right now, counted live. Only the
 * sitemap index route calls this — never robots.txt, which has to answer even
 * while the database is unreachable. A failed count throws, so the index can
 * say "try again" instead of publishing a shorter list.
 *
 * Counts are anonymous reads, so they only see what a signed-out visitor
 * could: public cars, active listings, published updates whose car (if any)
 * is public. A page can come out shorter than SITEMAP_PAGE_SIZE once
 * catalogSitemap drops the rows it excludes; it is never longer.
 */
export async function sitemapPages() {
  const client = createPublicClient();
  const counts = await Promise.all([
    client.from("cars").select("id", { count: "exact", head: true }).eq("is_public", true),
    client.from("listings").select("id", { count: "exact", head: true }).eq("status", "active"),
    client.from("profiles").select("id", { count: "exact", head: true }).not("username", "is", null),
    client.from("activity_posts").select("id", { count: "exact", head: true }).not("published_at", "is", null),
  ]);
  return counts.flatMap((result, i) => {
    if (result.error) throw new Error("Sitemap enumeration unavailable");
    const entity = SITEMAP_ENTITIES[i];
    return Array.from({ length: Math.max(1, Math.ceil((result.count || 0) / SITEMAP_PAGE_SIZE)) }, (_, page) => ({ id: `${entity}-${page}` }));
  });
}
