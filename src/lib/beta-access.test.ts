import { describe, expect, it } from "vitest";

import { hashBetaInvitationToken, normalizeBetaEmail } from "./beta-access";

describe("beta invitation primitives", () => {
  it("normalizes invitation email consistently with Postgres", () => {
    expect(normalizeBetaEmail("  Buyer.Name@Example.COM  ")).toBe("buyer.name@example.com");
  });

  it("stores a deterministic hash rather than the invitation credential", () => {
    const token = "a".repeat(64);
    const hash = hashBetaInvitationToken(token);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain(token);
    expect(hashBetaInvitationToken(`${token}x`)).not.toBe(hash);
  });
});
