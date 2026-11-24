import { createSavedSearch } from "@/features/marketplace/saved-search-actions";
import { requireSameOrigin } from "@/lib/http/origin";

const headers = { "Cache-Control": "no-store" };

/** A small mutation response keeps saving independent of a results-page RSC
 * refresh. Authentication, normalization, RLS and deduplication stay shared. */
export async function POST(request: Request) {
  const refused = requireSameOrigin(request, headers);
  if (refused) return refused;
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
