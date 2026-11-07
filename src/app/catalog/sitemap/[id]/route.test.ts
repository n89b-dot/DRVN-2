import { beforeEach, expect, it, vi } from "vitest";
vi.mock("@/lib/catalog-sitemap", () => ({ catalogSitemap: vi.fn() }));
vi.mock("@/lib/sitemap-pages", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/sitemap-pages")>()), sitemapPages: vi.fn() }));
vi.mock("@/lib/site", () => ({ siteUrl: () => "https://example.test" }));
import { catalogSitemap } from "@/lib/catalog-sitemap";
import { sitemapPages } from "@/lib/sitemap-pages";
import { GET } from "./route";
const request = (id: string) => GET(new Request(`https://example.test/catalog/sitemap/${id}`), { params: Promise.resolve({ id }) });
beforeEach(() => vi.resetAllMocks());
it("serves existing sitemap URLs and escapes XML", async () => {
  vi.mocked(catalogSitemap).mockResolvedValue([{ url: "https://example.test/cars/a&b", lastModified: "2026-09-05" }]);
  const response = await request("cars-1.xml");
  expect(response.status).toBe(200);
  expect(catalogSitemap).toHaveBeenCalledWith("cars-1");
  expect(await response.text()).toContain("<loc>https://example.test/cars/a&amp;b</loc><lastmod>2026-09-05</lastmod>");
});
it("serves post pages", async () => {
  vi.mocked(catalogSitemap).mockResolvedValue([{ url: "https://example.test/posts/p1" }]);
  const response = await request("posts-2.xml");
  expect(response.status).toBe(200);
  expect(catalogSitemap).toHaveBeenCalledWith("posts-2");
});
it("rejects malformed and overflowing pages before accessing the database", async () => {
  for (const id of ["cars--1.xml", "cars-01.xml", "cars-99999999999999999.xml", "secrets-0.xml", "posts-0", "index"]) expect((await request(id)).status).toBe(404);
  expect(catalogSitemap).not.toHaveBeenCalled();
  expect(sitemapPages).not.toHaveBeenCalled();
});
it("returns a retryable uncached failure instead of publishing an empty sitemap", async () => {
  vi.mocked(catalogSitemap).mockRejectedValue(new Error("database unavailable"));
  const response = await request("listings-0.xml");
  expect(response.status).toBe(503);
  expect(response.headers.get("cache-control")).toBe("no-store");
});
it("lists every counted page, posts included, in the sitemap index", async () => {
  vi.mocked(sitemapPages).mockResolvedValue([{ id: "cars-0" }, { id: "listings-0" }, { id: "profiles-0" }, { id: "posts-0" }, { id: "posts-1" }]);
  const response = await request("index.xml");
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toContain("application/xml");
  const body = await response.text();
  expect(body).toContain('<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
  for (const id of ["cars-0", "listings-0", "profiles-0", "posts-0", "posts-1"]) expect(body).toContain(`<sitemap><loc>https://example.test/catalog/sitemap/${id}.xml</loc></sitemap>`);
  expect(catalogSitemap).not.toHaveBeenCalled();
});
it("answers the index with a retryable 503 when the counts fail", async () => {
  vi.mocked(sitemapPages).mockRejectedValue(new Error("Sitemap enumeration unavailable"));
  const response = await request("index.xml");
  expect(response.status).toBe(503);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("retry-after")).toBe("60");
});
