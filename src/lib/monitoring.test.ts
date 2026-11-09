import { afterEach, describe, expect, it, vi } from "vitest";
import { captureException, captureMessage, flushMonitoring, reportError, scrubTelemetry } from "./monitoring";

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.useRealTimers(); });
describe("bounded monitoring", () => {
  it("redacts credentials and private structured fields", () => {
    const text = JSON.stringify(scrubTelemetry({ email: "private@example.test", token_hash: "abc", nested: { message: "pi_123_secret_abc sk_live_123 /confirm?token_hash=abc" } }));
    expect(text).not.toContain("private@example.test");
    expect(text).not.toContain("sk_live_123");
    expect(text).not.toContain("pi_123_secret_abc");
    expect(text).not.toContain("token_hash=abc");
  });
  it("flush stops waiting and aborts an unresponsive transport", async () => {
    vi.useFakeTimers();
    vi.stubEnv("SENTRY_DSN", "https://key@example.test/123");
    let signal: AbortSignal | undefined;
    vi.stubGlobal("fetch", vi.fn((_url, init) => { signal = init.signal; return new Promise(() => {}); }));
    void captureMessage("synthetic");
    const flush = flushMonitoring(100);
    await vi.advanceTimersByTimeAsync(100);
    await flush;
    expect(signal?.aborted).toBe(true);
  });
  it("ignores malformed or insecure DSNs", async () => {
    vi.stubEnv("SENTRY_DSN", "http://key@example.test/no-project");
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    await captureMessage("synthetic");
    expect(fetcher).not.toHaveBeenCalled();
  });
});

/** The JSON event inside a Sentry envelope (third line). */
function sentEvent(fetcher: ReturnType<typeof vi.fn>, call = 0) {
  return JSON.parse(String(fetcher.mock.calls[call][1].body).split("\n")[2]);
}

function stubSentry() {
  vi.stubEnv("SENTRY_DSN", "https://key@example.test/123");
  const fetcher = vi.fn(async () => new Response(null, { status: 200 }));
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
}

describe("nested errors (N104)", () => {
  it("keeps name, message and stack of an Error nested in an object", () => {
    const out = scrubTelemetry({ orderId: "o1", error: new TypeError("transfer refused") }) as Record<string, Record<string, unknown>>;
    expect(out.orderId).toBe("o1");
    expect(out.error.name).toBe("TypeError");
    expect(out.error.message).toBe("transfer refused");
    expect(String(out.error.stack)).toContain("transfer refused");
  });

  it("serialises cause chains, AggregateError members and errors inside arrays", () => {
    const root = new Error("socket hang up");
    const wrapped = new Error("refund create failed", { cause: new Error("provider unavailable", { cause: root }) });
    const out = scrubTelemetry({ attempts: [wrapped], all: new AggregateError([new Error("a"), new Error("b")], "both failed") });
    const text = JSON.stringify(out);
    for (const message of ["refund create failed", "provider unavailable", "socket hang up", "both failed", "\"a\"", "\"b\""]) expect(text).toContain(message);
  });

  it("keeps a database error's diagnostic fields and redacts emails inside them", () => {
    class PostgrestLikeError extends Error {
      details: string; hint: string; code: string;
      constructor() { super("duplicate key value violates unique constraint"); this.name = "PostgrestError"; this.details = "Key (email)=(buyer@example.test) already exists."; this.hint = ""; this.code = "23505"; }
    }
    const out = scrubTelemetry({ beginError: new PostgrestLikeError() }) as Record<string, Record<string, unknown>>;
    expect(out.beginError).toMatchObject({ name: "PostgrestError", message: "duplicate key value violates unique constraint", code: "23505" });
    expect(String(out.beginError.details)).not.toContain("buyer@example.test");
    expect(String(out.beginError.details)).toContain("[email]");
  });

  it("drops provider payloads from Stripe-shaped errors and keeps only object ids", () => {
    const error = Object.assign(new Error("Your card was declined."), {
      type: "StripeCardError", code: "card_declined", decline_code: "insufficient_funds", requestId: "req_1", statusCode: 402,
      raw: { message: "Your card was declined.", payment_method: { billing_details: { name: "Private Person" } } },
      headers: { "request-id": "req_1", "set-cookie": "x" },
      payment_intent: { id: "pi_123", client_secret: "fixture", shipping: { name: "Private Person" } },
      payment_method: { id: "pm_9", billing_details: { name: "Private Person" } },
    });
    const out = scrubTelemetry({ error }) as Record<string, Record<string, unknown>>;
    expect(out.error).toMatchObject({ message: "Your card was declined.", code: "card_declined", decline_code: "insufficient_funds", requestId: "req_1", statusCode: 402, payment_intent: "pi_123", payment_method: "pm_9" });
    expect(out.error).not.toHaveProperty("raw");
    expect(out.error).not.toHaveProperty("headers");
    const text = JSON.stringify(out);
    expect(text).not.toContain("Private Person");
    expect(text).not.toContain("secret_abc");
  });

  it("cuts cycles and runaway depth without throwing, and keeps repeated siblings", () => {
    const loop = new Error("loop") as Error & { self?: unknown };
    loop.self = loop;
    loop.cause = loop;
    const shared = { id: "s" };
    const deep: Record<string, unknown> = {};
    let cursor = deep;
    for (let i = 0; i < 20; i += 1) { cursor.next = {}; cursor = cursor.next as Record<string, unknown>; }
    const out = scrubTelemetry({ loop, a: shared, b: shared, deep }) as Record<string, Record<string, unknown>>;
    expect(out.loop.self).toBe("[circular]");
    expect(out.loop.cause).toBe("[circular]");
    expect(out.a).toEqual({ id: "s" });
    expect(out.b).toEqual({ id: "s" });
    expect(JSON.stringify(out.deep)).toContain("[truncated]");
  });

  it("reportError logs and reports the nested error, not {}", async () => {
    const fetcher = stubSentry();
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    reportError("[stripe:webhook] handler failed", { type: "charge.refunded", error: new Error("ledger write failed", { cause: new Error("deadlock detected") }) });
    await flushMonitoring();
    const [label, context] = logged.mock.calls[0] as [string, { error: Record<string, unknown> }];
    expect(label).toBe("[stripe:webhook] handler failed");
    expect(context.error.message).toBe("ledger write failed");
    const event = sentEvent(fetcher);
    expect(event.tags.report).toBe("[stripe:webhook] handler failed");
    expect(event.exception.values.map((v: { value: string }) => v.value)).toEqual(["deadlock detected", "ledger write failed"]);
    expect(event.extra.message).toBe("[stripe:webhook] handler failed");
    expect(event.extra.arg0.error.message).toBe("ledger write failed");
    expect(event.extra.arg0.type).toBe("charge.refunded");
    logged.mockRestore();
  });

  it("captureException keeps the content of a thrown non-Error object", async () => {
    const fetcher = stubSentry();
    await captureException({ message: "relation missing", code: "42P01", email: "x@example.test" });
    const value = sentEvent(fetcher).exception.values[0].value as string;
    expect(value).toContain("relation missing");
    expect(value).toContain("42P01");
    expect(value).not.toContain("x@example.test");
  });
});


describe("error reports name the deployment (N961, report five #123)", () => {
  it("staging and production are distinct environments in Sentry", async () => {
    const fetcher = stubSentry();
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DRVN_DEPLOY_ENV", "staging");
    await captureMessage("synthetic");
    expect(sentEvent(fetcher).environment).toBe("staging");
    vi.stubEnv("DRVN_DEPLOY_ENV", "production");
    await captureMessage("synthetic");
    expect(sentEvent(fetcher, 1).environment).toBe("production");
  });
});
