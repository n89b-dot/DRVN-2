import { abuseIdentity } from "@/lib/abuse-identity";
import { captureMessage } from "@/lib/monitoring";
import { allowAction, RATE_LIMITS } from "@/lib/rate-limit";

const MAX_BYTES = 8192;
/** Bound bytes before parsing, including chunked requests without Content-Length. */
export async function POST(request: Request) {
  try {
    if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") return new Response(null, { status: 415 });
    if (Number(request.headers.get("content-length")) > MAX_BYTES) return new Response(null, { status: 413 });
    const subject = abuseIdentity(request.headers);
    if (!(await allowAction(RATE_LIMITS.clientError, subject))) return new Response(null, { status: 429 });
    const reader = request.body?.getReader();
    if (!reader) return new Response(null, { status: 204 });
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_BYTES) { await reader.cancel(); return new Response(null, { status: 413 }); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!body || typeof body !== "object" || Array.isArray(body)) return new Response(null, { status: 204 });
    const field = (name: string, max: number) => typeof body[name] === "string" ? body[name].slice(0, max) : "";
    await captureMessage(field("message", 500) || "client error", "error", {
      tags: { source: "client-boundary" },
      extra: { stack: field("stack", 4000), digest: field("digest", 100), path: field("path", 300).split("?")[0] },
    });
  } catch { /* Invalid telemetry must not produce another error report. */ }
  return new Response(null, { status: 204 });
}
