import { describe, expect, it } from "vitest";

import nextConfig from "../../next.config";

/**
 * The Permissions-Policy header decides whether checkout wallets can render at
 * all: Apple Pay and Google Pay run through the Payment Request API inside
 * Stripe's frame, which `payment=()` forbade outright.
 */
describe("Permissions-Policy", () => {
  async function policy(): Promise<Map<string, string>> {
    const rules = await nextConfig.headers!();
    const value = rules.flatMap((rule) => rule.headers).find((header) => header.key === "Permissions-Policy")?.value ?? "";
    return new Map(value.split(/,\s*/).map((directive) => directive.split("=") as [string, string]));
  }

  it("lets this origin and Stripe.js's frame origins use payment, and nothing else", async () => {
    // The same Stripe.js frame origins the CSP's frame-src admits (src/lib/csp.ts).
    expect((await policy()).get("payment")).toBe('(self "https://js.stripe.com" "https://*.js.stripe.com")');
  });

  it("keeps camera, microphone and geolocation off", async () => {
    const directives = await policy();
    for (const feature of ["camera", "microphone", "geolocation"]) expect(directives.get(feature)).toBe("()");
  });
});
