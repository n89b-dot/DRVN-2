import { getAdminContext } from "@/lib/admin/guard";
import { REFERENCE_DOCS, SITE_PAGES } from "@/lib/docs/site";
import { siteUrl } from "@/lib/site";

/**
 * llms.txt for the docs microsite — an index an agent can fetch once to learn
 * where every markdown document lives. Deliberately inside the gated /docs
 * path (not at the site root): the microsite is admin-only for now, and a
 * public root llms.txt would advertise a hidden route.
 */
export async function GET() {
  const ctx = await getAdminContext();
  if (!ctx) return new Response("Not found", { status: 404 });

  const base = siteUrl();
  const line = (slug: string, title: string, description: string) =>
    `- [${title}](${base}/docs/md/${slug}): ${description}`;

  const body = [
    "# DRVN documentation",
    "",
    "> DRVN is the home for your car and its build — follow what others are",
    "> building, and buy or sell the parts that come off.",
    "> This index lists every documentation page as raw markdown. The design",
    '> system is called Livesheet — "a drawing that knows what\'s happening."',
    "",
    "## Docs",
    "",
    ...SITE_PAGES.map((p) => line(p.slug, p.title, p.description)),
    "",
    "## Reference",
    "",
    ...REFERENCE_DOCS.map((p) => line(p.slug, p.title, p.description)),
    "",
  ].join("\n");

  return new Response(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "X-Robots-Tag": "noindex, nofollow",
      "Cache-Control": "private, no-cache",
    },
  });
}
