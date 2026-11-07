import { abuseIdentity } from "@/lib/abuse-identity";
import { readBoundedBody } from "@/lib/bounded-body";
import { parseCspReports } from "@/lib/csp-report";
import { captureMessage } from "@/lib/monitoring";
import { allowAction, RATE_LIMITS } from "@/lib/rate-limit";

/**
 * Content Security Policy violation intake (policy: src/lib/csp.ts; parsing
 * and redaction: src/lib/csp-report.ts). Each violation becomes a monitoring
 * warning; a blocked Stripe origin is tagged for its own alert rule.
 */
const MAX_BYTES = 16384;
const CONTENT_TYPES = new Set(["application/csp-report", "application/reports+json", "application/json"]);

export async function POST(request: Request) {
  try {
    if (!CONTENT_TYPES.has(request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() ?? "")) return new Response(null, { status: 415 });
    if (Number(request.headers.get("content-length")) > MAX_BYTES) return new Response(null, { status: 413 });
    if (!(await allowAction(RATE_LIMITS.cspReport, abuseIdentity(request.headers)))) return new Response(null, { status: 429 });
    if (!(await allowAction(RATE_LIMITS.cspReportCeiling, "global"))) return new Response(null, { status: 429 });
    const raw = await readBoundedBody(request, MAX_BYTES);
    if (raw === null) return new Response(null, { status: 413 });
    if (!raw) return new Response(null, { status: 204 });
    for (const report of parseCspReports(JSON.parse(raw))) {
      // A blocked Stripe frame or script is a checkout outage, not noise.
      const stripe = /(^|\.)stripe\.com$/.test(safeHost(report.blocked));
      await captureMessage(`CSP blocked ${report.directive}: ${report.blocked}`, "warning", {
        tags: { source: "csp", directive: report.directive, ...(stripe ? { alert: "csp-stripe-blocked" } : {}) },
        extra: { document: report.document, sourceFile: report.sourceFile, line: report.line, disposition: report.disposition },
      });
    }
  } catch { /* Invalid telemetry must not produce another error report. */ }
  return new Response(null, { status: 204 });
}

function safeHost(summary: string): string {
  try { return new URL(summary).hostname; } catch { return ""; }
}
