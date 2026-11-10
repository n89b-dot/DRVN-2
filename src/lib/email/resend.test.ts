import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { resendTransport } = await import("./resend");

const message = { to: "buyer@example.test", subject: "Receipt", text: "t", html: "<p>t</p>", idempotencyKey: "order-email/1" };

describe("the Resend transport (OS-W41, report five #116)", () => {
  it("sends with the idempotency key and returns Resend's id", async () => {
    const fetchImpl = vi.fn(async () => Response.json({ id: "re_1" }));
    const send = resendTransport({ from: "DRVN <orders@drvn.example>", env: { RESEND_API_KEY: "re_test" }, fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(await send(message)).toEqual({ status: "sent", providerId: "re_1" });
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>)["idempotency-key"]).toBe("order-email/1");
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  const answering = (status: number, name: string, text = "", headers: Record<string, string> = {}) =>
    resendTransport({ from: "f", env: { RESEND_API_KEY: "k" }, fetchImpl: (async () => Response.json({ name, message: text }, { status, headers })) as unknown as typeof fetch })(message);

  it("N1063: a fault with our own account is a retry marked provider, never a rejection (work review #147)", async () => {
    const ours: [number, string, string][] = [
      [401, "missing_api_key", "Missing API Key"],
      [401, "validation_error", "API key is invalid"],
      [401, "restricted_api_key", "This API key is restricted to only send emails"],
      [403, "validation_error", "The drvn.example domain is not verified. Please, add and verify your domain"],
      [403, "suspended_api_key", ""],
      [403, "", ""],
      [400, "validation_error", "API key is invalid"],
      [422, "invalid_from_address", "Invalid `from` field"],
      [422, "validation_error", "The `from` address must use a verified domain"],
      [429, "daily_quota_exceeded", "You have reached your daily email sending quota"],
      [429, "monthly_quota_exceeded", ""],
    ];
    for (const [status, name, text] of ours) {
      expect(await answering(status, name, text), `${status} ${name} ${text}`).toEqual({ status: "retry", reason: `resend: ${status}${name ? ` ${name}` : ""}`, provider: true });
    }
  });

  it("N1063: a refused recipient or a malformed message is a rejection; a 5xx or a request in flight is a plain retry", async () => {
    for (const [status, name, text] of [[422, "validation_error", "buyer@example.test is invalid"], [400, "validation_error", "Invalid `to` field"], [422, "missing_required_field", "Missing `subject`"], [404, "not_found", ""]] as const) {
      const outcome = await answering(status, name, text);
      expect(outcome, `${status} ${text}`).toEqual({ status: "rejected", reason: `resend: ${status} ${name}` });
      expect(JSON.stringify(outcome)).not.toContain("buyer@example.test");
    }
    for (const [status, name] of [[503, "service_unavailable"], [500, "application_error"], [409, "concurrent_idempotent_requests"]] as const) {
      expect(await answering(status, name), `${status} ${name}`).toEqual({ status: "retry", reason: `resend: ${status} ${name}` });
    }
    const down = await resendTransport({ from: "f", env: { RESEND_API_KEY: "k" }, fetchImpl: (async () => { throw new Error("ECONNRESET"); }) as unknown as typeof fetch })(message);
    expect(down).toEqual({ status: "retry", reason: "resend: network" });
  });

  it("N1063: a rate limit is a retry marked rateLimited, with Resend's own wait when it gives one in seconds (review of #204)", async () => {
    expect(await answering(429, "rate_limit_exceeded", "Too many requests", { "retry-after": "3" })).toEqual({ status: "retry", reason: "resend: 429 rate_limit_exceeded", rateLimited: true, retryAfterSeconds: 3 });
    expect(await answering(429, "rate_limit_exceeded", "", { "retry-after": "0.4" })).toEqual({ status: "retry", reason: "resend: 429 rate_limit_exceeded", rateLimited: true, retryAfterSeconds: 1 });
    // No wait given, or one that is not a number of seconds: the caller's default.
    expect(await answering(429, "rate_limit_exceeded")).toEqual({ status: "retry", reason: "resend: 429 rate_limit_exceeded", rateLimited: true });
    expect(await answering(429, "", "", { "retry-after": "Wed, 21 Oct 2015 07:28:00 GMT" })).toEqual({ status: "retry", reason: "resend: 429", rateLimited: true });
    // A quota is not a rate limit: it is our account, and stays a provider fault.
    expect(await answering(429, "daily_quota_exceeded", "", { "retry-after": "3" })).toEqual({ status: "retry", reason: "resend: 429 daily_quota_exceeded", provider: true });
  });

  it("N1063: a key Resend already took with a different body is taken as sent, and marked so it can be counted", async () => {
    expect(await answering(409, "invalid_idempotent_request", "Same idempotency key used with a different request body")).toEqual({ status: "sent", providerId: null, repeatedKey: true });
    // An ordinary acceptance carries no such mark.
    const ok = resendTransport({ from: "f", env: { RESEND_API_KEY: "k" }, fetchImpl: (async () => Response.json({ id: "re_2" })) as unknown as typeof fetch });
    expect(await ok(message)).toEqual({ status: "sent", providerId: "re_2" });
  });

  it("N1063: a missing key keeps everything waiting and is our fault to fix", async () => {
    expect(await resendTransport({ from: "f", env: {} })(message)).toEqual({ status: "retry", reason: "resend: RESEND_API_KEY missing", provider: true });
  });
});
