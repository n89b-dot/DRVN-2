import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

import Stripe from "stripe";
import { afterEach, describe, expect, it, vi } from "vitest";

import { STRIPE_API_VERSION as SCRIPT_API_VERSION } from "../../../scripts/owner/stripe-webhooks.mjs";

import { STRIPE_API_VERSION } from "./stripe-api-version";

/**
 * N144: the Stripe API version is pinned explicitly, not inherited from the
 * SDK. The shared client sends it, the webhook setup script creates endpoints
 * on it, and the webhook fixtures in the money tests describe it.
 */

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/monitoring", () => ({ reportError: vi.fn() }));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("the pinned Stripe API version", () => {
  it("is what the shared client sends on every request", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "fixture-key-not-a-secret");
    const { stripeClient } = await import("./stripe");
    const client = stripeClient() as unknown as { getApiField(key: string): unknown };
    expect(client.getApiField("version")).toBe(STRIPE_API_VERSION);
  });

  it("is the version the installed SDK was generated for, so upgrading the SDK is a deliberate change", () => {
    // tsc already refuses a pin the SDK's types don't know; this says why at
    // runtime too. When it fails after an upgrade, read Stripe's changelog
    // between the two versions before moving the pin.
    expect(Stripe.API_VERSION).toBe(STRIPE_API_VERSION);
  });

  it("is the version the webhook setup script creates endpoints on", () => {
    expect(SCRIPT_API_VERSION).toBe(STRIPE_API_VERSION);
    const script = readFileSync(resolve(__dirname, "../../../scripts/owner/stripe-webhooks.mjs"), "utf8");
    expect(script).not.toContain("Stripe.API_VERSION");
  });

  it("is the only version the payments tests' event fixtures name", () => {
    const dir = __dirname;
    const named = new Set<string>();
    for (const file of readdirSync(dir).filter((name) => name.endsWith(".test.ts"))) {
      for (const match of readFileSync(join(dir, file), "utf8").matchAll(/api_version:\s*"([^"]+)"/g)) named.add(match[1]);
    }
    for (const version of named) expect(version).toBe(STRIPE_API_VERSION);
  });

  it("is written in the runbook's webhook instructions", () => {
    const runbook = readFileSync(resolve(__dirname, "../../../docs/production-runbook.md"), "utf8");
    expect(runbook).toContain(STRIPE_API_VERSION);
  });
});
