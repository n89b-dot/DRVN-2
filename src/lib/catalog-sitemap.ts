import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/site";
import { createPublicClient } from "@/lib/supabase/public";
import { SITEMAP_PAGE_SIZE } from "@/lib/sitemap-pages";
export async function catalogSitemap(id: string): Promise<MetadataRoute.Sitemap> {
  const match = /^(cars|listings|profiles)-(\d+)$/.exec(id);
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
  const { data, error } = await client.from("profiles").select("username,updated_at").not("username", "is", null).order("id").range(start,end);
  if (error) throw error;
  return (data || []).map((profile) => ({ url: `${base}/u/${profile.username}`, lastModified: profile.updated_at }));
}
