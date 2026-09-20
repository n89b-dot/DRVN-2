import { createSavedSearch } from "@/features/marketplace/saved-search-actions";

const headers = { "Cache-Control": "no-store" };

/** A small mutation response keeps saving independent of a results-page RSC
 * refresh. Authentication, normalization, RLS and deduplication stay shared. */
export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  const allowed = [new URL(request.url).origin, process.env.NEXT_PUBLIC_SITE_URL].filter(Boolean);
  if (!origin || !allowed.includes(origin)) return Response.json({ error: "Invalid origin." }, { status: 403, headers });
  try {
    const text = await request.text();
    if (text.length > 8000) return Response.json({ error: "This search is too large to save." }, { status: 413, headers });
    const params = new URLSearchParams(text);
    const form = new FormData();
    for (const [key, value] of params) form.append(key, value);
    const result = await createSavedSearch({}, form);
    return Response.json(result, { status: result.error ? 400 : 200, headers });
  } catch {
    return Response.json({ error: "Couldn't save that search. Please try again." }, { status: 503, headers });
  }
}
