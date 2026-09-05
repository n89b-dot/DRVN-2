import { afterEach, expect, it, vi } from "vitest";
import { abuseIdentity } from "./abuse-identity";
afterEach(() => vi.unstubAllEnvs());
it("ignores spoofable forwarded addresses unless a trusted proxy is configured", () => {
  vi.stubEnv("TRUST_PROXY_HEADERS", "false");
  expect(abuseIdentity(new Headers({ "x-forwarded-for": "192.0.2.1" }))).toBe(abuseIdentity(new Headers({ "x-forwarded-for": "192.0.2.2" })));
});
it("hashes trusted addresses and separates authenticated principals", () => {
  vi.stubEnv("TRUST_PROXY_HEADERS", "true"); vi.stubEnv("GUEST_RECEIPT_SECRET", "test-only-signing-key");
  const a = abuseIdentity(new Headers({ "x-forwarded-for": "192.0.2.1" }));
  expect(a).not.toContain("192.0.2.1");
  expect(a).not.toBe(abuseIdentity(new Headers({ "x-forwarded-for": "192.0.2.2" })));
  expect(abuseIdentity(new Headers(), "member")).toBe("user:member");
});
