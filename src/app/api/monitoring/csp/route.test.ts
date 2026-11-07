import { beforeEach, describe, expect, it, vi } from "vitest";

const { capture, allow } = vi.hoisted(() => ({ capture: vi.fn(), allow: vi.fn() }));
vi.mock("@/lib/monitoring", () => ({ captureMessage: capture }));
vi.mock("@/lib/rate-limit", async (original) => ({ ...(await original<typeof import("@/lib/rate-limit")>()), allowAction: allow }));
vi.mock("@/lib/abuse-identity", () => ({ abuseIdentity: () => "network:test" }));

import { parseCspReports } from "@/lib/csp-report";

import { POST } from "./route";

beforeEach(() => { capture.mockReset(); allow.mockReset(); allow.mockResolvedValue(true); });

const legacy = {
  "csp-report": {
    "document-uri": "https://drvn.example/checkout?order=1&token=secret",
    "violated-directive": "frame-src",
    "effective-directive": "frame-src",
    "blocked-uri": "https://b.js.stripe.com/v3/elements-inner.html?key=pk_live_x#frame",
    "original-policy": "default-src 'self'; script-src 'nonce-abc'",
    "script-sample": "private text",
    referrer: "https://elsewhere.example/?q=private",
    disposition: "enforce",
  },
};
const batch = [
  { type: "csp-violation", url: "https://drvn.example/", body: { documentURL: "https://drvn.example/cart", effectiveDirective: "script-src-elem", blockedURL: "inline", sourceFile: "https://drvn.example/_next/x.js", lineNumber: 4, sample: "private", disposition: "enforce" } },
  { type: "csp-violation", body: { documentURL: "https://drvn.example/", effectiveDirective: "img-src", blockedURL: "chrome-extension://abc/icon.png" } },
  { type: "deprecation", body: { id: "x" } },
];

function post(body: unknown, type = "application/csp-report") {
  return new Request("https://drvn.example/api/monitoring/csp", { method: "POST", headers: { "content-type": type }, body: JSON.stringify(body) });
}

describe("CSP report parsing", () => {
  it("reads both formats, strips queries and fragments, and drops samples, referrers and the policy", () => {
    const [one] = parseCspReports(legacy);
    expect(one).toEqual({ directive: "frame-src", blocked: "https://b.js.stripe.com/v3/elements-inner.html", document: "https://drvn.example/checkout", sourceFile: "", line: null, disposition: "enforce" });
    const text = JSON.stringify(parseCspReports(batch));
    expect(text).toContain("script-src-elem");
    expect(text).not.toContain("private");
    expect(text).not.toContain("chrome-extension");
    expect(parseCspReports(batch)).toHaveLength(1);
    expect(parseCspReports({ unrelated: true })).toEqual([]);
    expect(parseCspReports(Array.from({ length: 50 }, () => batch[0]))).toHaveLength(5);
  });
});

describe("CSP report intake", () => {
  it("forwards a blocked Stripe frame as a tagged warning", async () => {
    expect((await POST(post(legacy))).status).toBe(204);
    expect(capture).toHaveBeenCalledOnce();
    const [message, level, context] = capture.mock.calls[0];
    expect(message).toBe("CSP blocked frame-src: https://b.js.stripe.com/v3/elements-inner.html");
    expect(level).toBe("warning");
    expect(context.tags).toEqual({ source: "csp", directive: "frame-src", alert: "csp-stripe-blocked" });
    expect(JSON.stringify(capture.mock.calls)).not.toMatch(/token=|pk_live|nonce-abc|private/);
  });

  it("accepts Reporting API batches", async () => {
    expect((await POST(post(batch, "application/reports+json"))).status).toBe(204);
    expect(capture).toHaveBeenCalledOnce();
    expect(capture.mock.calls[0][2].tags).toEqual({ source: "csp", directive: "script-src-elem" });
  });

  it("rejects other content types, oversized bodies and rate-limited senders without reporting", async () => {
    expect((await POST(post(legacy, "text/plain"))).status).toBe(415);
    expect((await POST(new Request("https://drvn.example/api/monitoring/csp", { method: "POST", headers: { "content-type": "application/csp-report" }, body: "x".repeat(20000) }))).status).toBe(413);
    allow.mockResolvedValueOnce(false);
    expect((await POST(post(legacy))).status).toBe(429);
    allow.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    expect((await POST(post(legacy))).status).toBe(429);
    expect(capture).not.toHaveBeenCalled();
  });

  it("answers malformed JSON quietly", async () => {
    const response = await POST(new Request("https://drvn.example/api/monitoring/csp", { method: "POST", headers: { "content-type": "application/csp-report" }, body: "{not json" }));
    expect(response.status).toBe(204);
    expect(capture).not.toHaveBeenCalled();
  });
});
