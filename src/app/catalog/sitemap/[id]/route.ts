import { SITEMAP_PAGE_SIZE } from "@/lib/sitemap-pages";
import { catalogSitemap } from "@/lib/catalog-sitemap";

export const dynamic = "force-dynamic";

function xml(value: string) {
  return value.replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[character]!);
}

/** Discover pages at crawl time; production builds never need database access. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const match = /^(cars|listings|profiles)-(0|[1-9]\d*)\.xml$/.exec(id);
  if (!match || !Number.isSafeInteger(Number(match[2]) * SITEMAP_PAGE_SIZE + SITEMAP_PAGE_SIZE - 1)) return new Response("Not found", { status: 404 });
  try {
    const entries = await catalogSitemap(id.slice(0, -4));
    const body = entries.map(entry => `<url><loc>${xml(entry.url)}</loc>${entry.lastModified ? `<lastmod>${xml(String(entry.lastModified))}</lastmod>` : ""}</url>`).join("");
    return new Response(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${body}</urlset>`, { headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=0, s-maxage=3600" } });
  } catch {
    return new Response("Sitemap temporarily unavailable", { status: 503, headers: { "Cache-Control": "no-store", "Retry-After": "60" } });
  }
}
