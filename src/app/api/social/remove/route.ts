import { removeFollow, removeSave } from "@/features/social/actions";
import { requireSameOrigin } from "@/lib/http/origin";

const headers = { "Cache-Control": "no-store" };

export async function POST(request: Request) {
  const refused = requireSameOrigin(request, headers);
  if (refused) return refused;
  try {
    const text = await request.text();
    if (text.length > 1000) return Response.json({ error: "Request too large." }, { status: 413, headers });
    const params = new URLSearchParams(text);
    const kind = params.get("kind");
    if (kind !== "save" && kind !== "follow") return Response.json({ error: "Invalid request." }, { status: 400, headers });
    const form = new FormData();
    form.set("target_type", params.get("target_type") ?? "");
    form.set("target_id", params.get("target_id") ?? "");
    const result = await (kind === "save" ? removeSave : removeFollow)({}, form);
    return Response.json(result, { status: result.error ? 400 : 200, headers });
  } catch {
    return Response.json({ error: "Couldn't remove that. Please try again." }, { status: 503, headers });
  }
}
