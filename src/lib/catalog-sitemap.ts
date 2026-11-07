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
 * The anonymous read already leaves out drafts and updates on a private or
 * suspended member's car (the "published activity readable" rule asks the
 * car's own row security). Two things it can't see are dropped here: an
 * update whose car the visitor can't read (no slug to link, and the page
 * would 404), and a carless update by a suspended member, which the post
 * rule doesn't hide but the sitemap shouldn't advertise.
 */
async function postsSitemap(
  client: ReturnType<typeof createPublicClient>,
  base: string,
  start: number,
  end: number,
): Promise<MetadataRoute.Sitemap> {
  const [posts, suspended] = await Promise.all([
    client
      .from("activity_posts")
      .select("id,car_id,author_id,updated_at,cars(slug)")
      .not("published_at", "is", null)
      .order("id")
      .range(start, end),
    client.rpc("suspended_profile_ids"),
  ]);
  if (posts.error) throw posts.error;
  if (suspended.error) throw suspended.error;
  const hidden = new Set<string>(suspended.data ?? []);
  return (posts.data || []).flatMap((post) => {
    const car = post.cars as unknown as { slug: string | null } | null;
    if (hidden.has(post.author_id)) return [];
    if (post.car_id && !car?.slug) return [];
    return [{ url: `${base}${postHref({ id: post.id, car })}`, lastModified: post.updated_at }];
  });
}
