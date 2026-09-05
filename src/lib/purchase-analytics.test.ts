import { describe, it, expect } from "vitest";
import { consentAllowsPurchase } from "./purchase-analytics";
describe("queued purchase consent", () => {
  const consent = { allowed: true, version: "v2", expires_at: "2030-01-01T00:00:00Z" };
  it("requires current consent and the version captured at checkout", () => {
    expect(consentAllowsPurchase(consent, "v2", 0)).toBe(true);
    expect(consentAllowsPurchase(null, "v2", 0)).toBe(false);
    expect(consentAllowsPurchase({ ...consent, allowed: false }, "v2", 0)).toBe(false);
    expect(consentAllowsPurchase(consent, "v1", 0)).toBe(false);
    expect(consentAllowsPurchase(consent, "v2", Date.parse("2031-01-01"))).toBe(false);
  });
});
