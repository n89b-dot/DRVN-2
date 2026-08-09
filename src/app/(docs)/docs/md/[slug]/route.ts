import { readFile } from "node:fs/promises";
import path from "node:path";

import { getAdminContext } from "@/lib/admin/guard";
import { findDoc } from "@/lib/docs/site";

/**
 * Markdown twin of every docs page, plus the raw reference library — the
 * LLM/agent-readable face of the microsite. Gated exactly like the console:
 * non-admins get a bare 404 so the surface's existence isn't confirmed.
 * (When the microsite moves to its own origin, this handler lifts with it.)
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const ctx = await getAdminContext();
  if (!ctx) return new Response("Not found", { status: 404 });

  const { slug } = await params;
  const doc = findDoc(slug);
  if (!doc) return new Response("Not found", { status: 404 });

  let body: string;
  try {
    // turbopackIgnore: the registry's paths are data, not imports — without it
    // the tracer assumes the whole project is reachable. The files themselves
    // are shipped via outputFileTracingIncludes in next.config.ts.
    body = await readFile(path.join(/* turbopackIgnore: true */ process.cwd(), doc.file), "utf8");
  } catch {
    return new Response("Not found", { status: 404 });
  }

  return new Response(body, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "X-Robots-Tag": "noindex, nofollow",
      "Cache-Control": "private, no-cache",
    },
  });
}
