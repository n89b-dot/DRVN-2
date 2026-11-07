import type { MetadataRoute } from "next";
import { postHref } from "@/lib/activity/href";
import { siteUrl } from "@/lib/site";
import { createPublicClient } from "@/lib/supabase/public";
import { SITEMAP_ENTITIES, SITEMAP_PAGE_SIZE } from "@/lib/sitemap-pages";

const PAGE_ID = new RegExp(`^(${SITEMAP_ENTITIES.join("|")})-(\\d+)$`);

export async function catalogSitemap(id: string): Promise<MetadataRoute.Sitemap> {
  const match = PAGE_ID.exec(id);
  if (!match) return [];
  const start = Number(match[2]) * SITEMAP_PAGE_SIZE, end = start + SITEMAP_PAGE_SIZE - 1;
  const client = createPublicClient(), base = siteUrl();
  if (match[1] === "cars") {
    const { data, error } = await client.from("cars").select("slug,updated_at").eq("is_public", true).order("id").range(start,end);
    if (error) throw error;
    return (data || []).map((car) => ({ url: `${base}/cars/${car.slug}`, lastModified: car.updated_at }));
  }
  if (match[1] === "listings") {
    const { data, error } = await client.from("listings").select("id,updated_at").eq("status", "active").order("id").range(start,end);
    if (error) throw error;
    return (data || []).map((listing) => ({ url: `${base}/listings/${listing.id}`, lastModified: listing.updated_at }));
  }
  if (match[1] === "posts") return postsSitemap(client, base, start, end);
  const { data, error } = await client.from("profiles").select("username,updated_at").not("username", "is", null).order("id").range(start,end);
  if (error) throw error;
  return (data || []).map((profile) => ({ url: `${base}/u/${profile.username}`, lastModified: profile.updated_at }));
}

/**
 * Published updates, at their one canonical address (postHref): under the
 * car when there is one, /posts/{id} when there isn't.
 *
 * One page is filtered in SQL by sitemap_post_page (20261107150000), under
 * the visitor's row security: no drafts, no update on a car a visitor can't
 * read, and nothing by a suspended member, car or no car. The suspension
 * check runs inside the query because the suspended set, read over the Data
 * API, is capped at 1,000 rows and would let the rest through.
 */
async function postsSitemap(
  client: ReturnType<typeof createPublicClient>,
  base: string,
  start: number,
  end: number,
): Promise<MetadataRoute.Sitemap> {
  const { data, error } = await client.rpc("sitemap_post_page", { p_start: start, p_count: end - start + 1 });
  if (error) throw error;
  return (data || []).map((post) => ({
    url: `${base}${postHref({ id: post.id, carSlug: post.car_slug })}`,
    lastModified: post.updated_at,
  }));
}
