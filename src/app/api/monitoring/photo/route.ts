import { abuseIdentity } from "@/lib/abuse-identity";
import { readBoundedBody } from "@/lib/bounded-body";
import { captureMessage } from "@/lib/monitoring";
import { photoReportArea } from "@/lib/photo-report";
import { SIGNED_PHOTO_BUCKETS } from "@/lib/photo-urls";
import { allowAction, RATE_LIMITS } from "@/lib/rate-limit";

/**
 * Intake for "a member photo reached a page unsigned" (N1053; the sender is
 * src/lib/photo-report.ts). A warning, not an error: the page showed its
 * no-photo plate. Two limits, as the CSP reports have: one per visitor, and
 * one across everyone, because the time these arrive in numbers is a signing
 * outage, when every visitor's page would send one (review of #244).
 *
 * What is kept is a bucket from the known list and the first segment of the
 * page's path, checked again here. Nothing else in the body is read.
 */
const MAX_BYTES = 512;

export async function POST(request: Request) {
  try {
    if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") return new Response(null, { status: 415 });
    if (Number(request.headers.get("content-length")) > MAX_BYTES) return new Response(null, { status: 413 });
    if (!(await allowAction(RATE_LIMITS.photoReport, abuseIdentity(request.headers)))) return new Response(null, { status: 429 });
    if (!(await allowAction(RATE_LIMITS.photoReportCeiling, "global"))) return new Response(null, { status: 429 });
    const raw = await readBoundedBody(request, MAX_BYTES);
    if (raw === null) return new Response(null, { status: 413 });
    if (!raw) return new Response(null, { status: 204 });
    const body = JSON.parse(raw) as { bucket?: unknown; area?: unknown } | null;
    if (!body || typeof body !== "object" || Array.isArray(body)) return new Response(null, { status: 204 });
    const bucket = (SIGNED_PHOTO_BUCKETS as readonly string[]).includes(String(body.bucket)) ? String(body.bucket) : null;
    if (!bucket) return new Response(null, { status: 204 });
    // The sender already cut the path down; a body written by hand is cut down the same way.
    const area = photoReportArea(typeof body.area === "string" ? `/${body.area}` : "/");
    if (area === null) return new Response(null, { status: 204 });
    await captureMessage(`A member photo reached a page unsigned (${bucket})`, "warning", {
      tags: { source: "unsigned-photo", bucket, area },
    });
  } catch { /* Invalid telemetry must not produce another error report. */ }
  return new Response(null, { status: 204 });
}
