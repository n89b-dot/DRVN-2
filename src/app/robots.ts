import { sitemapPages } from "@/lib/sitemap-pages";
import type { MetadataRoute } from "next";

import { siteUrl } from "@/lib/site";

export const dynamic = "force-dynamic";

/**
 * Authed product surfaces are excluded — they redirect to /login for a
 * crawler anyway, so indexing them only wastes crawl budget.
 */
export default async function robots(): Promise<MetadataRoute.Robots> {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/api/",
          "/callback",
          "/confirm",
          "/admin",
          "/admin-verify",
          "/docs",
          "/cart",
          "/orders",
          "/settings",
          "/notifications",
          "/saved",
          "/garage",
          "/sell",
          "/listings/*/edit",
        ],
      },
    ],
    sitemap: [`${siteUrl()}/sitemap.xml`, ...(await sitemapPages()).map(({ id }) => `${siteUrl()}/catalog/sitemap/${id}.xml`)],
    host: siteUrl(),
  };
}
