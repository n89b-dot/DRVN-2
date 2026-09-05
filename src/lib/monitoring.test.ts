import { afterEach, describe, expect, it, vi } from "vitest";
import { captureMessage, flushMonitoring, scrubTelemetry } from "./monitoring";

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
