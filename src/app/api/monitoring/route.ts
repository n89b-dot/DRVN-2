import { abuseIdentity } from "@/lib/abuse-identity";
import { readBoundedBody } from "@/lib/bounded-body";
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
    const text = await readBoundedBody(request, MAX_BYTES);
    if (text === null) return new Response(null, { status: 413 });
    if (!text) return new Response(null, { status: 204 });
    const body = JSON.parse(text);
    if (!body || typeof body !== "object" || Array.isArray(body)) return new Response(null, { status: 204 });
    const field = (name: string, max: number) => typeof body[name] === "string" ? body[name].slice(0, max) : "";
    await captureMessage(field("message", 500) || "client error", "error", {
      tags: { source: "client-boundary" },
      extra: { stack: field("stack", 4000), digest: field("digest", 100), path: field("path", 300).split("?")[0] },
    });
  } catch { /* Invalid telemetry must not produce another error report. */ }
  return new Response(null, { status: 204 });
}
