import { describe, expect, it } from "vitest";

import { clientAddressSource, resolvePaymentsMode, validatePaymentsEnv, PaymentsConfigError } from "./env";

/**
 * The fail-closed matrix. The one behavior these exist to pin down forever:
 * production can NEVER silently select the stub provider — the historical
 * shape of that bug was a missing STRIPE_SECRET_KEY quietly "succeeding"
 * every checkout without charging anyone.
 */

const LIVE = {
  NODE_ENV: "production",
  STRIPE_SECRET_KEY: "sk_live_x",
  STRIPE_WEBHOOK_SECRET: "whsec_x",
  STRIPE_CONNECT_WEBHOOK_SECRET: "whsec_connect_x",
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: "pk_live_x",
  SENTRY_DSN: "https://k@o.ingest.sentry.io/1",
  ADMIN_ALERT_WEBHOOK_URL: "https://hooks.example/x",
  NEXT_PUBLIC_SITE_URL: "https://drvn.example",
  CRON_SECRET: "test-cron-secret-at-least-32-characters",
  GUEST_RECEIPT_SECRET: "test-receipt-secret-at-least-32-characters",
};

describe("resolvePaymentsMode", () => {
  it("selects stripe when the secret is present", () => {
    expect(resolvePaymentsMode({ STRIPE_SECRET_KEY: "sk_test_x" })).toBe("stripe");
  });

  it("defaults to stub in development without a secret", () => {
    expect(resolvePaymentsMode({ NODE_ENV: "development" })).toBe("stub");
  });

  it("throws in production when no secret and no explicit mode", () => {
    expect(() => resolvePaymentsMode({ NODE_ENV: "production" })).toThrow(PaymentsConfigError);
  });

  it("throws on PAYMENTS_MODE=stripe without a secret, in any environment", () => {
    expect(() =>
      resolvePaymentsMode({ NODE_ENV: "development", PAYMENTS_MODE: "stripe" })
    ).toThrow(PaymentsConfigError);
  });

  it("refuses PAYMENTS_MODE=stub in production without the explicit override", () => {
    expect(() =>
      resolvePaymentsMode({ NODE_ENV: "production", PAYMENTS_MODE: "stub" })
    ).toThrow(PaymentsConfigError);
  });

  it("allows stub in production only with PAYMENTS_ALLOW_STUB_IN_PRODUCTION=true", () => {
    expect(
      resolvePaymentsMode({
        NODE_ENV: "production",
        PAYMENTS_MODE: "stub",
        PAYMENTS_ALLOW_STUB_IN_PRODUCTION: "true",
      })
    ).toBe("stub");
  });

  it("explicit stub wins over a present secret", () => {
    expect(
      resolvePaymentsMode({ NODE_ENV: "development", PAYMENTS_MODE: "stub", STRIPE_SECRET_KEY: "sk_test_x" })
    ).toBe("stub");
  });

  it("rejects unknown modes", () => {
    expect(() => resolvePaymentsMode({ PAYMENTS_MODE: "fake" })).toThrow(PaymentsConfigError);
  });
});

describe("clientAddressSource", () => {
  it("trusts Vercel by default, another proxy only by opt-in, and nothing when switched off", () => {
    expect(clientAddressSource({})).toBeNull();
    expect(clientAddressSource({ VERCEL: "1" })).toBe("vercel");
    expect(clientAddressSource({ TRUST_PROXY_HEADERS: "true" })).toBe("proxy");
    expect(clientAddressSource({ VERCEL: "1", TRUST_PROXY_HEADERS: "false" })).toBeNull();
  });
});

describe("validatePaymentsEnv", () => {
  it("passes a fully configured live production", () => {
    const { mode, warnings } = validatePaymentsEnv({
      ...LIVE,
      ADMIN_ALERT_WEBHOOK_URL: "https://hooks.example/x",
      CRON_SECRET: LIVE.CRON_SECRET,
      VERCEL: "1",
    });
    expect(mode).toBe("stripe");
    expect(warnings).toEqual([]);
  });

  it("warns, without failing, when live production can't attribute signed-out visitors", () => {
    expect(validatePaymentsEnv(LIVE).warnings).toEqual([expect.stringMatching(/shares one rate-limit bucket/)]);
    expect(validatePaymentsEnv({ ...LIVE, VERCEL: "1", TRUST_PROXY_HEADERS: "false" }).warnings).toHaveLength(1);
    expect(validatePaymentsEnv({ ...LIVE, TRUST_PROXY_HEADERS: "true" }).warnings).toEqual([]);
  });

  it("throws when live production lacks webhook secret, publishable key, or monitoring", () => {
    for (const missing of [
      "STRIPE_WEBHOOK_SECRET",
      "STRIPE_CONNECT_WEBHOOK_SECRET",
      "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY",
      "SENTRY_DSN",
    ]) {
      const env = { ...LIVE } as Record<string, string | undefined>;
      delete env[missing];
      expect(() => validatePaymentsEnv(env), `missing ${missing}`).toThrow(PaymentsConfigError);
    }
  });

  it("fails closed when workers, receipt signing or alert delivery are missing", () => {
    for (const key of ["CRON_SECRET", "GUEST_RECEIPT_SECRET", "ADMIN_ALERT_WEBHOOK_URL", "NEXT_PUBLIC_SITE_URL"]) {
      const env: Record<string, string | undefined> = { ...LIVE }; delete env[key];
      expect(() => validatePaymentsEnv(env)).toThrow(PaymentsConfigError);
    }
  });

  it("does not demand live config outside production", () => {
    const { mode } = validatePaymentsEnv({ NODE_ENV: "test", STRIPE_SECRET_KEY: "sk_test_x" });
    expect(mode).toBe("stripe");
  });
});
