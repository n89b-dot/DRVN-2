import "server-only";
import { createPublicClient } from "@/lib/supabase/public";
export const SITEMAP_PAGE_SIZE = 1000;
export async function sitemapPages() {
  const client = createPublicClient();
  const counts = await Promise.all([
    client.from("cars").select("id", { count: "exact", head: true }).eq("is_public", true),
    client.from("listings").select("id", { count: "exact", head: true }).eq("status", "active"),
    client.from("profiles").select("id", { count: "exact", head: true }).not("username", "is", null),
  ]);
  return counts.flatMap((result, i) => {
    if (result.error) throw new Error("Sitemap enumeration unavailable");
    const entity = ["cars", "listings", "profiles"][i];
    return Array.from({ length: Math.max(1, Math.ceil((result.count || 0) / SITEMAP_PAGE_SIZE)) }, (_, page) => ({ id: `${entity}-${page}` }));
  });
}
