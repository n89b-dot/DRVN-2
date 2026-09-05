import { beforeEach, expect, it, vi } from "vitest";
vi.mock("@/lib/catalog-sitemap", () => ({ catalogSitemap: vi.fn() }));
import { catalogSitemap } from "@/lib/catalog-sitemap";
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
it("rejects malformed and overflowing pages before accessing the database", async () => {
  for (const id of ["cars--1.xml", "cars-01.xml", "cars-99999999999999999.xml", "secrets-0.xml"]) expect((await request(id)).status).toBe(404);
  expect(catalogSitemap).not.toHaveBeenCalled();
});
it("returns a retryable uncached failure instead of publishing an empty sitemap", async () => {
  vi.mocked(catalogSitemap).mockRejectedValue(new Error("database unavailable"));
  const response = await request("listings-0.xml");
  expect(response.status).toBe(503);
  expect(response.headers.get("cache-control")).toBe("no-store");
});
