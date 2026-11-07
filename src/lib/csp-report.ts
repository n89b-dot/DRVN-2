/**
 * Parsing for Content Security Policy violation reports (intake:
 * src/app/api/monitoring/csp). Both shapes browsers send are read — the
 * `report-uri` `{"csp-report": {...}}` object and the Reporting API's
 * `[{ type: "csp-violation", body: {...} }]` batch. Only the directive and
 * where things point are kept: URLs lose their query and fragment, and script
 * samples, referrers and the policy text are never read.
 */
const MAX_REPORTS = 5;
/** Browser extensions inject into every page; their violations are not ours. */
const EXTENSION_SCHEME = /^(?:chrome|moz|safari|safari-web|ms-browser)-extension:/i;

export type CspViolation = { directive: string; blocked: string; document: string; sourceFile: string; line: number | null; disposition: string };

const text = (value: unknown, max: number) => (typeof value === "string" ? value.slice(0, max) : "");

/** A URL reduced to origin and path; CSP keywords ("inline", "eval") pass through. */
export function urlSummary(value: unknown): string {
  const raw = text(value, 2000).trim();
  if (!raw) return "";
  if (/^[a-z-]+$/i.test(raw)) return raw.slice(0, 40);
  try {
    const url = new URL(raw);
    if (url.protocol === "http:" || url.protocol === "https:") return `${url.origin}${url.pathname}`.slice(0, 300);
    return url.protocol;
  } catch {
    return "[unparseable]";
  }
}

function violation(fields: Record<string, unknown>, legacy: boolean): CspViolation | null {
  const pick = (modern: string, old: string) => fields[legacy ? old : modern];
  const directive = text(pick("effectiveDirective", "effective-directive"), 60) || text(fields["violated-directive"], 60).split(" ")[0];
  const blockedRaw = text(pick("blockedURL", "blocked-uri"), 2000);
  const sourceRaw = text(pick("sourceFile", "source-file"), 2000);
  if (!directive || EXTENSION_SCHEME.test(blockedRaw) || EXTENSION_SCHEME.test(sourceRaw)) return null;
  const line = Number(pick("lineNumber", "line-number"));
  return {
    directive,
    blocked: urlSummary(blockedRaw) || "unknown",
    document: urlSummary(pick("documentURL", "document-uri")),
    sourceFile: urlSummary(sourceRaw),
    line: Number.isInteger(line) && line > 0 ? line : null,
    disposition: text(fields.disposition, 20) || "enforce",
  };
}

/** Violations in either report format; anything else yields none. */
export function parseCspReports(body: unknown): CspViolation[] {
  const found: CspViolation[] = [];
  if (Array.isArray(body)) {
    for (const report of body.slice(0, MAX_REPORTS)) {
      if (report && typeof report === "object" && report.type === "csp-violation" && report.body && typeof report.body === "object") {
        const parsed = violation(report.body as Record<string, unknown>, false);
        if (parsed) found.push(parsed);
      }
    }
  } else if (body && typeof body === "object" && "csp-report" in body) {
    const legacy = (body as Record<string, unknown>)["csp-report"];
    if (legacy && typeof legacy === "object") {
      const parsed = violation(legacy as Record<string, unknown>, true);
      if (parsed) found.push(parsed);
    }
  }
  return found;
}
