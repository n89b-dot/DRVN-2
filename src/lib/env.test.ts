import { describe, expect, it } from "vitest";

import { clientAddressSource, databaseKeyProblems, resolvePaymentsMode, stubOverrideProblem, supabaseKeyKind, validatePaymentsEnv, PaymentsConfigError } from "./env";

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
  NEXT_PUBLIC_SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_x",
  SUPABASE_SECRET_KEY: "sb_secret_x",
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

  it("checks the agent's model and worker URL when the beta is on in production", () => {
    const agentOn = { ...LIVE, TRUST_PROXY_HEADERS: "true", AGENTS_BETA: "on", ANTHROPIC_API_KEY: "sk-ant-x" };
    expect(validatePaymentsEnv(agentOn).warnings).toEqual([]);
    expect(validatePaymentsEnv({ ...agentOn, AGENT_MODEL: "claude-sonnet-5-5", AGENT_WORKER_DATABASE_URL: "postgresql://agent_worker.ref:pw@pooler.example:6543/postgres" }).warnings).toEqual([]);
    expect(() => validatePaymentsEnv({ ...agentOn, AGENT_MODEL: "claude-next-9" })).toThrow(/AGENT_MODEL/);
    expect(() => validatePaymentsEnv({ ...agentOn, AGENT_WORKER_DATABASE_URL: "https://pooler.example/postgres" })).toThrow(/AGENT_WORKER_DATABASE_URL/);
    expect(() => validatePaymentsEnv({ ...agentOn, AGENT_WORKER_DATABASE_URL: "postgresql://pooler.example:6543/postgres" })).toThrow(/AGENT_WORKER_DATABASE_URL/);
    // Without a key the agent is off, not broken: a warning, not a refusal.
    const noKey = Object.fromEntries(Object.entries(agentOn).filter(([name]) => name !== "ANTHROPIC_API_KEY"));
    expect(validatePaymentsEnv(noKey).warnings).toEqual([expect.stringMatching(/without ANTHROPIC_API_KEY/)]);
    // Off, nothing is checked.
    expect(() => validatePaymentsEnv({ ...LIVE, TRUST_PROXY_HEADERS: "true", AGENT_MODEL: "claude-next-9" })).not.toThrow();
  });
});

describe("the sandbox payment override is never on a hosted deployment (N540)", () => {
  const SANDBOX = { NODE_ENV: "production", PAYMENTS_MODE: "stub", PAYMENTS_ALLOW_STUB_IN_PRODUCTION: "true" };

  it("N540: CI's browser suite and the local rehearsal (loopback, no platform) still boot on stub payments", () => {
    expect(stubOverrideProblem({ ...SANDBOX, NEXT_PUBLIC_SITE_URL: "http://127.0.0.1:3001" })).toBeNull();
    expect(stubOverrideProblem({ ...SANDBOX, NEXT_PUBLIC_SITE_URL: "https://localhost:3006" })).toBeNull();
    expect(stubOverrideProblem({ ...SANDBOX })).toBeNull();
    expect(resolvePaymentsMode({ ...SANDBOX, NEXT_PUBLIC_SITE_URL: "http://127.0.0.1:3001" })).toBe("stub");
  });

  it("N540: boot fails on Vercel, on a public site URL or with a live key, whatever the payment mode", () => {
    for (const hosted of [
      { VERCEL: "1", VERCEL_ENV: "production" },
      { VERCEL: "1", VERCEL_ENV: "preview" },
      { NEXT_PUBLIC_SITE_URL: "https://drvn.app/" },
      { NEXT_PUBLIC_SITE_URL: "https://staging.drvn.app" },
      { STRIPE_SECRET_KEY: "sk_live_x", PAYMENTS_MODE: "stripe" },
      { STRIPE_SECRET_KEY: "rk_live_x", PAYMENTS_MODE: "stripe" },
    ]) {
      const env = { ...SANDBOX, ...hosted };
      expect(stubOverrideProblem(env), JSON.stringify(hosted)).toMatch(/must be absent from every hosted environment \(N540\)/);
      expect(() => resolvePaymentsMode(env), JSON.stringify(hosted)).toThrow(PaymentsConfigError);
      expect(() => validatePaymentsEnv(env), JSON.stringify(hosted)).toThrow(/PAYMENTS_ALLOW_STUB_IN_PRODUCTION is set on/);
    }
  });

  it("N540: any value counts, even false, and a fully configured live production with it set refuses to boot", () => {
    expect(stubOverrideProblem({ PAYMENTS_ALLOW_STUB_IN_PRODUCTION: "false", VERCEL: "1" })).toMatch(/a Vercel deployment/);
    expect(() =>
      validatePaymentsEnv({ ...LIVE, ADMIN_ALERT_WEBHOOK_URL: "https://hooks.example/x", VERCEL: "1", PAYMENTS_ALLOW_STUB_IN_PRODUCTION: "true" }),
    ).toThrow(/N540/);
  });

  it("N540: with the variable absent, nothing changes", () => {
    expect(stubOverrideProblem({ VERCEL: "1", NEXT_PUBLIC_SITE_URL: "https://drvn.app", STRIPE_SECRET_KEY: "sk_live_x" })).toBeNull();
  });
});

describe("the database keys are checked at boot (N962, report five #123)", () => {
  it("live-money production refuses to boot without the Supabase URL, public key or secret key", () => {
    for (const name of ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "SUPABASE_SECRET_KEY"]) {
      const env = { ...LIVE, [name]: undefined };
      expect(() => validatePaymentsEnv(env), name).toThrow(new RegExp(name));
    }
  });

  it("a hosted deployment can't boot in stub mode at all, and in Stripe mode is checked for the keys outside the live-money block", () => {
    const hostedStub = { NODE_ENV: "production", VERCEL: "1", PAYMENTS_MODE: "stub", NEXT_PUBLIC_SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_x" };
    expect(() => validatePaymentsEnv(hostedStub)).toThrow(PaymentsConfigError);
    expect(() => validatePaymentsEnv({ ...LIVE, VERCEL: "1", SUPABASE_SECRET_KEY: undefined })).toThrow(/hosted production deployment is missing its database configuration: SUPABASE_SECRET_KEY/);
  });

  it("never fires in CI's or a local production build (loopback, no Vercel, no live key)", () => {
    const local = { NODE_ENV: "production", PAYMENTS_MODE: "stub", PAYMENTS_ALLOW_STUB_IN_PRODUCTION: "true", NEXT_PUBLIC_SITE_URL: "http://127.0.0.1:3000" };
    expect(() => validatePaymentsEnv(local)).not.toThrow();
  });

  it("refuses a guest receipt secret equal to the cron secret", () => {
    expect(() => validatePaymentsEnv({ ...LIVE, GUEST_RECEIPT_SECRET: LIVE.CRON_SECRET })).toThrow(/GUEST_RECEIPT_SECRET \(must differ from CRON_SECRET\)/);
  });

  it("accepts either generation of key", () => {
    const legacy = { ...LIVE, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: undefined, SUPABASE_SECRET_KEY: undefined, NEXT_PUBLIC_SUPABASE_ANON_KEY: legacyKey("anon"), SUPABASE_SERVICE_ROLE_KEY: legacyKey("service_role") };
    expect(() => validatePaymentsEnv(legacy)).not.toThrow();
  });
});

/** A legacy Supabase key: a JWT whose payload names the role. Unsigned here; only its shape is read. */
function legacyKey(role: string): string {
  const part = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${part({ alg: "HS256", typ: "JWT" })}.${part({ iss: "supabase", ref: "abcdefghijklmnopqrst", role })}.signature`;
}

describe("N962: each database key is the right kind, and no secret sits in a public variable (work review #140)", () => {
  const HOSTED = { ...LIVE, VERCEL: "1" };

  it("tells the two kinds of key apart, in both generations", () => {
    expect(supabaseKeyKind("sb_publishable_abc")).toBe("publishable");
    expect(supabaseKeyKind("sb_secret_abc")).toBe("secret");
    expect(supabaseKeyKind(legacyKey("anon"))).toBe("publishable");
    expect(supabaseKeyKind(legacyKey("service_role"))).toBe("secret");
    expect(supabaseKeyKind(legacyKey("authenticated"))).toBe("unknown");
    expect(supabaseKeyKind("anon")).toBe("unknown");
    expect(supabaseKeyKind("a.b.c")).toBe("unknown");
  });

  it("a correctly configured hosted production boots, in both generations", () => {
    expect(databaseKeyProblems(HOSTED)).toEqual([]);
    expect(() => validatePaymentsEnv(HOSTED)).not.toThrow();
  });

  it("refuses a secret key in the public key variable, new or legacy, and never prints it", () => {
    for (const secret of ["sb_secret_do_not_print", legacyKey("service_role")]) {
      const env = { ...HOSTED, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: secret };
      expect(() => validatePaymentsEnv(env)).toThrow(/NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY holds a secret key, and every NEXT_PUBLIC_ value is sent to browsers/);
      try {
        validatePaymentsEnv(env);
      } catch (error) {
        expect((error as Error).message).not.toContain(secret);
        expect(error).toBeInstanceOf(PaymentsConfigError);
      }
    }
    const legacyName = { ...HOSTED, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: undefined, NEXT_PUBLIC_SUPABASE_ANON_KEY: legacyKey("service_role") };
    expect(() => validatePaymentsEnv(legacyName)).toThrow(/NEXT_PUBLIC_SUPABASE_ANON_KEY holds a secret key/);
  });

  it("refuses any secret-shaped value in any NEXT_PUBLIC_ variable", () => {
    expect(databaseKeyProblems({ ...HOSTED, NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: "sk_live_x" })).toEqual([expect.stringMatching(/^NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY holds a secret key/)]);
    expect(databaseKeyProblems({ ...HOSTED, NEXT_PUBLIC_SOMETHING_NEW: "whsec_x" })).toEqual([expect.stringMatching(/^NEXT_PUBLIC_SOMETHING_NEW holds a secret key/)]);
    expect(databaseKeyProblems({ ...HOSTED, NEXT_PUBLIC_OTHER: "rk_test_x" })).toHaveLength(1);
    // Publishable values are what these variables are for.
    expect(databaseKeyProblems({ ...HOSTED, NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: "pk_test_x" })).toEqual([]);
  });

  it("refuses a publishable key, or something that is no key at all, in the secret variable", () => {
    expect(() => validatePaymentsEnv({ ...HOSTED, SUPABASE_SECRET_KEY: "sb_publishable_x" })).toThrow(/SUPABASE_SECRET_KEY holds a publishable key, not the secret/);
    expect(() => validatePaymentsEnv({ ...HOSTED, SUPABASE_SECRET_KEY: undefined, SUPABASE_SERVICE_ROLE_KEY: legacyKey("anon") })).toThrow(/SUPABASE_SERVICE_ROLE_KEY holds a publishable key/);
    expect(() => validatePaymentsEnv({ ...HOSTED, SUPABASE_SECRET_KEY: "postgres-password" })).toThrow(/SUPABASE_SECRET_KEY is not a Supabase secret/);
    expect(() => validatePaymentsEnv({ ...HOSTED, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "the-project-ref" })).toThrow(/NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY is not a Supabase publishable/);
  });

  it("refuses a Supabase URL that is not a bare https origin", () => {
    for (const url of ["http://abcdefghijklmnopqrst.supabase.co", "https://abcdefghijklmnopqrst.supabase.co/rest/v1", "abcdefghijklmnopqrst", "https://user:pass@abcdefghijklmnopqrst.supabase.co"]) {
      expect(() => validatePaymentsEnv({ ...HOSTED, NEXT_PUBLIC_SUPABASE_URL: url }), url).toThrow(/NEXT_PUBLIC_SUPABASE_URL is not a bare https origin/);
    }
  });

  it("names every problem at once, and checks nothing off a hosted deployment", () => {
    const both = { ...HOSTED, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_secret_x", SUPABASE_SECRET_KEY: "sb_publishable_x" };
    expect(databaseKeyProblems(both)).toHaveLength(2);
    const local = { NODE_ENV: "production", PAYMENTS_MODE: "stub", PAYMENTS_ALLOW_STUB_IN_PRODUCTION: "true", NEXT_PUBLIC_SITE_URL: "http://127.0.0.1:3000", NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321", NEXT_PUBLIC_SUPABASE_ANON_KEY: "anything", SUPABASE_SERVICE_ROLE_KEY: "anything" };
    expect(() => validatePaymentsEnv(local)).not.toThrow();
  });
});
