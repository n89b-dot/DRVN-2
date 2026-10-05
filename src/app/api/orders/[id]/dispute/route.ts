import { revalidatePath } from "@/lib/revalidate";
import { openDisputeCommand } from "@/features/commerce/dispute-command";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const headers = { "Cache-Control": "no-store" };
  if (request.headers.get("origin") !== new URL(process.env.NEXT_PUBLIC_SITE_URL || request.url).origin) return Response.json({ error: "Invalid origin." }, { status: 403, headers });
  if (!request.headers.get("content-type")?.startsWith("application/json")) return Response.json({ error: "Expected JSON." }, { status: 415, headers });
  const { id } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return Response.json({ error: "Invalid order." }, { status: 400, headers });
  const reader = request.body?.getReader();
  if (!reader) return Response.json({ error: "Missing request." }, { status: 400, headers });
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > 8192) { await reader.cancel(); return Response.json({ error: "Request too large." }, { status: 413, headers }); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  let input: { category?: unknown; reason?: unknown };
  try { input = JSON.parse(Buffer.concat(chunks).toString()); } catch { return Response.json({ error: "Invalid request." }, { status: 400, headers }); }
  if (!input || typeof input.category !== "string" || (input.reason !== undefined && typeof input.reason !== "string")) return Response.json({ error: "Invalid request." }, { status: 400, headers });
  const form = new FormData(); form.set("order_id", id); form.set("category", input.category); form.set("reason", String(input.reason ?? ""));
  const result = await openDisputeCommand(form);
  if (result.error) return Response.json(result, { status: 400, headers });
  // Route-handler invalidation does not append a Flight render to the mutation.
  revalidatePath("/orders"); revalidatePath(`/orders/${id}`);
  return Response.json(result, { headers });
}
