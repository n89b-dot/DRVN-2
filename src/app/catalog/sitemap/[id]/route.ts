import { SITEMAP_ENTITIES, SITEMAP_PAGE_SIZE, sitemapPages } from "@/lib/sitemap-pages";
import { catalogSitemap } from "@/lib/catalog-sitemap";
import { siteUrl } from "@/lib/site";

export const dynamic = "force-dynamic";

const PAGE_FILE = new RegExp(`^(${SITEMAP_ENTITIES.join("|")})-(0|[1-9]\\d*)\\.xml$`);
const XML_HEADERS = { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=0, s-maxage=3600" };

function xml(value: string) {
  return value.replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[character]!);
}

/** A failed read is retryable and never cached: an empty or short sitemap would tell crawlers pages are gone. */
function unavailable() {
  return new Response("Sitemap temporarily unavailable", { status: 503, headers: { "Cache-Control": "no-store", "Retry-After": "60" } });
}

/**
 * Discover pages at crawl time; production builds never need database access.
 *
 * `index.xml` is the sitemap index robots.txt points at: it counts the
 * catalog live and lists every page below. Counting lives here, not in
 * robots.txt, so a database blip costs one retryable sitemap fetch instead of
 * a failing robots.txt (which crawlers read as "don't crawl").
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (id === "index.xml") {
    try {
      const base = siteUrl();
      const body = (await sitemapPages()).map(page => `<sitemap><loc>${xml(`${base}/catalog/sitemap/${page.id}.xml`)}</loc></sitemap>`).join("");
      return new Response(`<?xml version="1.0" encoding="UTF-8"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${body}</sitemapindex>`, { headers: XML_HEADERS });
    } catch {
      return unavailable();
    }
  }
  const match = PAGE_FILE.exec(id);
  if (!match || !Number.isSafeInteger(Number(match[2]) * SITEMAP_PAGE_SIZE + SITEMAP_PAGE_SIZE - 1)) return new Response("Not found", { status: 404 });
  try {
    const entries = await catalogSitemap(id.slice(0, -4));
    const body = entries.map(entry => `<url><loc>${xml(entry.url)}</loc>${entry.lastModified ? `<lastmod>${xml(String(entry.lastModified))}</lastmod>` : ""}</url>`).join("");
    return new Response(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${body}</urlset>`, { headers: XML_HEADERS });
  } catch {
    return unavailable();
  }
}
