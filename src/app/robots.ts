import type { MetadataRoute } from "next";

import { siteUrl } from "@/lib/site";

/**
 * `/design-system` is an internal component reference kept for development. It
 * is no longer linked from the product and must not be indexed. Authed product
 * surfaces are excluded too — they redirect to /login for a crawler anyway, so
 * indexing them only wastes crawl budget.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/design-system",
          "/api/",
          "/callback",
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
    sitemap: `${siteUrl()}/sitemap.xml`,
    host: siteUrl(),
  };
}
