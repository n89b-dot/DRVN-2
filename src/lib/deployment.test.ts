import { afterEach, describe, expect, it, vi } from "vitest";

import nextConfig from "../../next.config";
import robots from "../app/robots";

import sitemap from "../app/sitemap";

import { deployEnv, deployEnvProblem, hostedReasons, hostedSigns, isHostedProductionDeploy, isIndexable, monitoringEnvironment } from "./deployment";
import { hostedReasons as hostedReasonsFromEnv, stubOverrideProblem } from "./env";

afterEach(() => vi.unstubAllEnvs());

async function robotsTag(): Promise<string | undefined> {
  const rules = await nextConfig.headers!();
  const all = rules.find((rule) => rule.source === "/:path*")!;
  return all.headers.find((header) => header.key === "X-Robots-Tag")?.value;
}

describe("staging stays out of search engines (N958, report five #121)", () => {
  it("only a deployment named production is indexable", () => {
    expect(isIndexable({ DRVN_DEPLOY_ENV: "production" })).toBe(true);
    expect(isIndexable({ DRVN_DEPLOY_ENV: "staging" })).toBe(false);
    expect(isIndexable({ VERCEL: "1", VERCEL_ENV: "production", NODE_ENV: "production" })).toBe(false);
    expect(isIndexable({})).toBe(false);
    expect(isIndexable({ DRVN_DEPLOY_ENV: "Production" })).toBe(false);
  });

  it("robots.txt disallows everything and names no sitemap outside production", () => {
    vi.stubEnv("DRVN_DEPLOY_ENV", "staging");
    expect(robots()).toEqual({ rules: [{ userAgent: "*", disallow: "/" }] });
  });

  it("robots.txt keeps the production rules and sitemaps in production", () => {
    vi.stubEnv("DRVN_DEPLOY_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://drvn.example");
    const result = robots();
    const rule = [result.rules].flat()[0];
    expect(rule.allow).toBe("/");
    expect(rule.disallow).toContain("/admin");
    expect(result.sitemap).toEqual(["https://drvn.example/sitemap.xml", "https://drvn.example/catalog/sitemap/index.xml"]);
  });

  it("every response carries X-Robots-Tag: noindex outside production, and none in production", async () => {
    vi.stubEnv("DRVN_DEPLOY_ENV", "staging");
    expect(await robotsTag()).toBe("noindex, nofollow");
    vi.stubEnv("DRVN_DEPLOY_ENV", "");
    expect(await robotsTag()).toBe("noindex, nofollow");
    vi.stubEnv("DRVN_DEPLOY_ENV", "production");
    expect(await robotsTag()).toBeUndefined();
  });

  it("boot refuses a misspelt name, and a hosted production-mode deploy with no name", () => {
    expect(deployEnvProblem({ DRVN_DEPLOY_ENV: "prod" })).toMatch(/must be "production" or "staging"/);
    expect(deployEnvProblem({ VERCEL: "1", VERCEL_ENV: "production" })).toMatch(/not set on a hosted deployment/);
    expect(deployEnvProblem({ VERCEL: "1", VERCEL_ENV: "production", DRVN_DEPLOY_ENV: "staging" })).toBeNull();
    expect(deployEnvProblem({ VERCEL: "1", VERCEL_ENV: "preview" })).toBeNull();
    expect(deployEnvProblem({ NODE_ENV: "production" })).toBeNull();
    expect(deployEnvProblem({})).toBeNull();
  });

  it("names the deployment for error reports", () => {
    expect(deployEnv({ DRVN_DEPLOY_ENV: "staging" })).toBe("staging");
    expect(monitoringEnvironment({ DRVN_DEPLOY_ENV: "staging", NODE_ENV: "production" })).toBe("staging");
    expect(monitoringEnvironment({ VERCEL_ENV: "preview", NODE_ENV: "production" })).toBe("preview");
    expect(monitoringEnvironment({ NODE_ENV: "test" })).toBe("test");
    expect(monitoringEnvironment({})).toBe("development");
  });
});

describe("the build refuses what boot refuses, since indexing is fixed at build (N958)", () => {
  const load = async () => {
    vi.resetModules();
    return (await import("../../next.config")).default;
  };

  it("a hosted production-mode build with no name, or a misspelt one, fails", async () => {
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("DRVN_DEPLOY_ENV", "");
    await expect(load()).rejects.toThrow(/Build refused: DRVN_DEPLOY_ENV is not set/);
    vi.stubEnv("DRVN_DEPLOY_ENV", "prod");
    await expect(load()).rejects.toThrow(/Build refused: DRVN_DEPLOY_ENV must be/);
  });

  it("staging and production build, and so do CI's and a local build with nothing set", async () => {
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("VERCEL_ENV", "production");
    for (const name of ["staging", "production"]) {
      vi.stubEnv("DRVN_DEPLOY_ENV", name);
      await expect(load()).resolves.toBeTruthy();
    }
    vi.unstubAllEnvs();
    vi.stubEnv("VERCEL", "");
    vi.stubEnv("DRVN_DEPLOY_ENV", "");
    await expect(load()).resolves.toBeTruthy();
  });

  it("the noindex header changes no status or caching rule: it is the only header added, on every path alike", async () => {
    vi.stubEnv("DRVN_DEPLOY_ENV", "staging");
    const rules = await nextConfig.headers!();
    expect(rules.map((rule) => rule.source)).toEqual(["/:path*"]);
    const keys = rules[0].headers.map((header) => header.key);
    expect(keys).not.toContain("Cache-Control");
    expect(keys.filter((key) => key === "X-Robots-Tag")).toHaveLength(1);
  });
});

describe("N1060: what counts as hosted is read in one place (work review #144)", () => {
  it("env.ts and deployment.ts share one reading of the environment", () => {
    expect(hostedReasonsFromEnv).toBe(hostedReasons);
  });

  it("reads each sign: the host's flag and its environment, a public https site URL, a live Stripe key", () => {
    expect(hostedSigns({})).toEqual({ vercel: false, vercelEnv: null, publicSiteOrigin: null, liveStripeKey: false });
    expect(hostedSigns({ VERCEL: "1", VERCEL_ENV: "preview" })).toMatchObject({ vercel: true, vercelEnv: "preview" });
    expect(hostedSigns({ NEXT_PUBLIC_SITE_URL: "https://drvn.app/" }).publicSiteOrigin).toBe("https://drvn.app");
    for (const local of ["http://127.0.0.1:3000", "https://localhost:3000", "https://app.localhost", "http://drvn.app", "not a url", ""]) {
      expect(hostedSigns({ NEXT_PUBLIC_SITE_URL: local }).publicSiteOrigin, local).toBeNull();
    }
    expect(hostedSigns({ STRIPE_SECRET_KEY: "sk_live_x" }).liveStripeKey).toBe(true);
    expect(hostedSigns({ STRIPE_SECRET_KEY: "rk_live_x" }).liveStripeKey).toBe(true);
    expect(hostedSigns({ STRIPE_SECRET_KEY: "sk_test_x" }).liveStripeKey).toBe(false);
  });

  it("the broad question, could the public reach this, says yes on any one sign, in the same words as before", () => {
    expect(hostedReasons({})).toEqual([]);
    expect(hostedReasons({ VERCEL: "1", VERCEL_ENV: "production" })).toEqual(["a Vercel deployment (production)"]);
    expect(hostedReasons({ VERCEL: "1" })).toEqual(["a Vercel deployment"]);
    expect(hostedReasons({ NEXT_PUBLIC_SITE_URL: "https://staging.drvn.app", STRIPE_SECRET_KEY: "sk_live_x" })).toEqual(["a public site URL (https://staging.drvn.app)", "a live Stripe key"]);
    // The use that depends on it: the sandbox payment override is refused on any of them (N540).
    expect(stubOverrideProblem({ PAYMENTS_ALLOW_STUB_IN_PRODUCTION: "true", NEXT_PUBLIC_SITE_URL: "https://staging.drvn.app" })).toMatch(/a public site URL/);
  });

  it("the narrow question, is the host building a production-mode deployment, takes only the host's word", () => {
    expect(isHostedProductionDeploy({ VERCEL: "1", VERCEL_ENV: "production" })).toBe(true);
    expect(isHostedProductionDeploy({ VERCEL: "1", VERCEL_ENV: "preview" })).toBe(false);
    expect(isHostedProductionDeploy({ VERCEL: "1" })).toBe(false);
    // CI's build sets a public-looking placeholder URL (.github/workflows/ci.yml): hosted by the
    // broad question, not a deployment by the narrow one, so it builds with no name, hidden from search.
    const ciBuild = { NODE_ENV: "production", NEXT_PUBLIC_SITE_URL: "https://example.com" };
    expect(hostedReasons(ciBuild)).toEqual(["a public site URL (https://example.com)"]);
    expect(isHostedProductionDeploy(ciBuild)).toBe(false);
    expect(deployEnvProblem(ciBuild)).toBeNull();
    expect(isIndexable(ciBuild)).toBe(false);
  });
});

describe("N958: the static sitemap lists nothing off production (work review #156)", () => {
  it("is empty on staging and on an unnamed deployment, and lists the site on production", async () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://drvn.example");
    for (const name of ["staging", ""]) {
      vi.stubEnv("DRVN_DEPLOY_ENV", name);
      expect(await sitemap(), name || "unnamed").toEqual([]);
    }
    vi.stubEnv("DRVN_DEPLOY_ENV", "production");
    const listed = await sitemap();
    expect(listed.length).toBeGreaterThan(8);
    expect(listed[0].url).toBe("https://drvn.example/");
  });
});
