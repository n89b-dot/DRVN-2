import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import Stripe from "stripe";

// N539: the Stripe API version is pinned where the client is created, not
// left to whatever the installed SDK defaults to.

const constructed = vi.hoisted(() => ({ configs: [] as unknown[] }));

vi.mock("@/lib/monitoring", () => ({ reportError: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("stripe", async (importOriginal) => {
  const actual = await importOriginal<{ default: typeof Stripe }>();
  class FakeStripe {
    static API_VERSION = actual.default.API_VERSION;
    static errors = actual.default.errors;
    constructor(_key: string, config: unknown) {
      constructed.configs.push(config);
    }
  }
  return { default: FakeStripe };
});

import { STRIPE_API_VERSION, stripeClient } from "./stripe";

afterEach(() => {
  delete process.env.STRIPE_SECRET_KEY;
});

describe("Stripe API version (N539)", () => {
  it("creates the client with the pinned apiVersion", () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_unit";
    stripeClient();
    expect(constructed.configs).toHaveLength(1);
    expect(constructed.configs[0]).toMatchObject({ apiVersion: "2026-07-29.dahlia" });
    expect(STRIPE_API_VERSION).toBe("2026-07-29.dahlia");
  });

  it("pins the version the installed SDK defaults to, so pinning changed nothing", () => {
    // If this fails after a `stripe` upgrade, the pin is doing its job: the
    // new SDK defaults to a different API version. Moving the pin is a
    // deliberate change — see the comment on STRIPE_API_VERSION.
    expect(STRIPE_API_VERSION).toBe(Stripe.API_VERSION);
  });

  it("the owner scripts pin the same version", () => {
    const webhooks = readFileSync("scripts/owner/stripe-webhooks.mjs", "utf8");
    expect(webhooks).toContain(`export const STRIPE_API_VERSION = "${STRIPE_API_VERSION}";`);
    expect(webhooks).toContain("new Stripe(key, { apiVersion: STRIPE_API_VERSION,");
    expect(webhooks).not.toContain("Stripe.API_VERSION");
    const balances = readFileSync("scripts/owner/stripe-negative-balances.mjs", "utf8");
    expect(balances).toContain("new Stripe(key, { apiVersion: STRIPE_API_VERSION,");
  });
});
