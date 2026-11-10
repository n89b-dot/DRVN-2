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

  const answering = (status: number, name: string, text = "") =>
    resendTransport({ from: "f", env: { RESEND_API_KEY: "k" }, fetchImpl: (async () => Response.json({ name, message: text }, { status })) as unknown as typeof fetch })(message);

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

  it("N1063: a refused recipient or a malformed message is a rejection; a rate limit, a 5xx or a request in flight is a plain retry", async () => {
    for (const [status, name, text] of [[422, "validation_error", "buyer@example.test is invalid"], [400, "validation_error", "Invalid `to` field"], [422, "missing_required_field", "Missing `subject`"], [404, "not_found", ""]] as const) {
      const outcome = await answering(status, name, text);
      expect(outcome, `${status} ${text}`).toEqual({ status: "rejected", reason: `resend: ${status} ${name}` });
      expect(JSON.stringify(outcome)).not.toContain("buyer@example.test");
    }
    for (const [status, name] of [[429, "rate_limit_exceeded"], [503, "service_unavailable"], [500, "application_error"], [409, "concurrent_idempotent_requests"]] as const) {
      expect(await answering(status, name), `${status} ${name}`).toEqual({ status: "retry", reason: `resend: ${status} ${name}` });
    }
    const down = await resendTransport({ from: "f", env: { RESEND_API_KEY: "k" }, fetchImpl: (async () => { throw new Error("ECONNRESET"); }) as unknown as typeof fetch })(message);
    expect(down).toEqual({ status: "retry", reason: "resend: network" });
  });

  it("N1063: a key Resend already took with a different body means the email went; it is not retried to failure", async () => {
    expect(await answering(409, "invalid_idempotent_request", "Same idempotency key used with a different request body")).toEqual({ status: "sent", providerId: null });
  });

  it("N1063: a missing key keeps everything waiting and is our fault to fix", async () => {
    expect(await resendTransport({ from: "f", env: {} })(message)).toEqual({ status: "retry", reason: "resend: RESEND_API_KEY missing", provider: true });
  });
});
