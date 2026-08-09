import type { MetadataRoute } from "next";

import { siteUrl } from "@/lib/site";

/**
 * Authed product surfaces are excluded — they redirect to /login for a
 * crawler anyway, so indexing them only wastes crawl budget.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/api/",
          "/callback",
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
    sitemap: `${siteUrl()}/sitemap.xml`,
    host: siteUrl(),
  };
}
