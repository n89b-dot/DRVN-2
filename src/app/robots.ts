import type { MetadataRoute } from "next";

import { siteUrl } from "@/lib/site";

/**
 * Authed product surfaces are excluded — they redirect to /login for a
 * crawler anyway, so indexing them only wastes crawl budget.
 *
 * Nothing here reads the database. Crawlers treat a failing robots.txt as
 * "don't crawl", so it names two fixed sitemaps and stops: the static one,
 * and the catalog index, which counts the catalog itself and answers a
 * retryable 503 when it can't (src/app/catalog/sitemap/[id]/route.ts).
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
    sitemap: [`${siteUrl()}/sitemap.xml`, `${siteUrl()}/catalog/sitemap/index.xml`],
    host: siteUrl(),
  };
}
