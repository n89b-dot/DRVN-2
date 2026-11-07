import { expect, it, vi } from "vitest";

// Every way the database could be asked is wired to fail: robots.txt must not
// notice, because crawlers read a failing robots.txt as "don't crawl".
vi.mock("@/lib/supabase/public", () => ({
  createPublicClient: vi.fn(() => {
    throw new Error("database unavailable");
  }),
}));
vi.mock("@/lib/sitemap-pages", () => ({
  sitemapPages: vi.fn(async () => {
    throw new Error("Sitemap enumeration unavailable");
  }),
}));
vi.mock("@/lib/site", () => ({ siteUrl: () => "https://drvn.example" }));

import { createPublicClient } from "@/lib/supabase/public";
import { sitemapPages } from "@/lib/sitemap-pages";
// robots.ts is a root route file, and root files may not import each other
// (architecture.test.ts), so its test sits here beside the sitemap tests.
import robots from "@/app/robots";

it("answers during a database outage with fixed sitemaps and no database read", async () => {
  const result = await robots();
  expect(result.sitemap).toEqual(["https://drvn.example/sitemap.xml", "https://drvn.example/catalog/sitemap/index.xml"]);
  expect(result.host).toBe("https://drvn.example");
  const rules = Array.isArray(result.rules) ? result.rules : [result.rules];
  expect(rules[0]).toMatchObject({ userAgent: "*", allow: "/" });
  expect(rules[0].disallow).toContain("/admin");
  expect(createPublicClient).not.toHaveBeenCalled();
  expect(sitemapPages).not.toHaveBeenCalled();
});
