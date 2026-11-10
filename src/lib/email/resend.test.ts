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

  it("retries a 429, a 5xx or a network failure; rejects a 4xx; never echoes the body or the address", async () => {
    const answer = (status: number) => vi.fn(async () => Response.json({ name: "validation_error", message: "buyer@example.test is invalid" }, { status }));
    for (const [status, expected] of [[429, "retry"], [503, "retry"], [422, "rejected"]] as const) {
      const outcome = await resendTransport({ from: "f", env: { RESEND_API_KEY: "k" }, fetchImpl: answer(status) as unknown as typeof fetch })(message);
      expect(outcome.status, String(status)).toBe(expected);
      expect(JSON.stringify(outcome)).not.toContain("buyer@example.test");
    }
    const down = await resendTransport({ from: "f", env: { RESEND_API_KEY: "k" }, fetchImpl: (async () => { throw new Error("ECONNRESET"); }) as unknown as typeof fetch })(message);
    expect(down).toEqual({ status: "retry", reason: "resend: network" });
  });

  it("refuses without a key", async () => {
    expect(await resendTransport({ from: "f", env: {} })(message)).toEqual({ status: "rejected", reason: "resend: RESEND_API_KEY missing" });
  });
});
