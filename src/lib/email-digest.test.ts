import { createHmac } from "node:crypto";

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { accountEmailDigest } = await import("./email-digest");

afterEach(() => vi.unstubAllEnvs());

describe("N16 keyed email digest", () => {
  it("is a keyed HMAC of the normalised address, never the address or a plain hash", () => {
    vi.stubEnv("ACCOUNT_EMAIL_DIGEST_KEY", "k".repeat(40));
    const { digest, key } = accountEmailDigest("  Dana@Example.TEST ");
    expect(key).toBe("dedicated-v1");
    expect(digest).toBe(createHmac("sha256", "k".repeat(40)).update("dana@example.test").digest("hex"));
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
    expect(accountEmailDigest("dana@example.test").digest).toBe(digest);
  });

  it("derives a separate key from the guest secret when no dedicated key is set", () => {
    vi.stubEnv("ACCOUNT_EMAIL_DIGEST_KEY", "");
    vi.stubEnv("GUEST_RECEIPT_SECRET", "g".repeat(40));
    const { digest, key } = accountEmailDigest("dana@example.test");
    expect(key).toBe("derived-v1");
    // Not the guest secret used directly: the digest is for this purpose only.
    expect(digest).not.toBe(createHmac("sha256", "g".repeat(40)).update("dana@example.test").digest("hex"));
  });

  it("refuses to make a digest in production with no key at all", () => {
    vi.stubEnv("ACCOUNT_EMAIL_DIGEST_KEY", "");
    vi.stubEnv("GUEST_RECEIPT_SECRET", "");
    vi.stubEnv("NODE_ENV", "production");
    expect(() => accountEmailDigest("dana@example.test")).toThrow(/not configured/);
  });
});
