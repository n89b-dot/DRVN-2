import { afterEach, describe, expect, it, vi } from "vitest";
import { abuseIdentity, attributedNetworkIdentity, trustedClientAddress } from "./abuse-identity";

afterEach(() => vi.unstubAllEnvs());

function off() {
  vi.stubEnv("TRUST_PROXY_HEADERS", "");
  vi.stubEnv("VERCEL", "");
}

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

describe("trusted client address", () => {
  it("trusts nothing on an unknown host", () => {
    off();
    expect(trustedClientAddress(new Headers({ "x-forwarded-for": "192.0.2.1", "x-vercel-forwarded-for": "192.0.2.1" }))).toBeNull();
    expect(attributedNetworkIdentity(new Headers({ "x-forwarded-for": "192.0.2.1" }))).toBeNull();
  });

  it("reads Vercel's own header first on Vercel, without an opt-in", () => {
    off();
    vi.stubEnv("VERCEL", "1");
    expect(trustedClientAddress(new Headers({ "x-vercel-forwarded-for": "198.51.100.7", "x-forwarded-for": "203.0.113.9" }))).toBe("198.51.100.7");
    expect(trustedClientAddress(new Headers({ "x-forwarded-for": "203.0.113.9, 10.0.0.1" }))).toBe("203.0.113.9");
  });

  it("lets an operator switch Vercel trust off", () => {
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("TRUST_PROXY_HEADERS", "false");
    expect(trustedClientAddress(new Headers({ "x-vercel-forwarded-for": "198.51.100.7" }))).toBeNull();
  });

  it("only uses a verified proxy's X-Forwarded-For, and only when it is an address", () => {
    off();
    vi.stubEnv("TRUST_PROXY_HEADERS", "true");
    expect(trustedClientAddress(new Headers({ "x-vercel-forwarded-for": "198.51.100.7" }))).toBeNull();
    expect(trustedClientAddress(new Headers({ "x-forwarded-for": "not-an-ip" }))).toBeNull();
    expect(trustedClientAddress(new Headers({ "x-forwarded-for": "2001:db8::1" }))).toBe("2001:db8::1");
  });

  it("gives an attributed identity only for a trusted address", () => {
    off();
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("GUEST_RECEIPT_SECRET", "test-only-signing-key");
    const id = attributedNetworkIdentity(new Headers({ "x-vercel-forwarded-for": "198.51.100.7" }));
    expect(id).toMatch(/^network:[0-9a-f]{64}$/);
    expect(id).toBe(abuseIdentity(new Headers({ "x-vercel-forwarded-for": "198.51.100.7" })));
    expect(attributedNetworkIdentity(new Headers())).toBeNull();
  });
});
