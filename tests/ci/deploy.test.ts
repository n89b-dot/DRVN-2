// N634, N528 (remediation plan D2, C3): the deploy pipeline. A merge reaches
// staging only after its release-gate passes and staging has every
// migration; production is reached only by hand, for an annotated release
// tag, through an environment the owner guards, with the sandbox overrides
// absent (N540). This pins the workflow's order of steps and the decisions in
// scripts/deploy.mjs.
import fs from "node:fs";
import path from "node:path";

import yaml from "js-yaml";
import { describe, expect, it } from "vitest";

import { alertPayload, describeAttempt, gateVerdict, indexingProblems, missingMigrations, stillHead, validReleaseTag, versionMatches, waitForVersion } from "../../scripts/deploy.mjs";

type Step = { name?: string; uses?: string; run?: string; if?: string; env?: Record<string, string>; with?: Record<string, unknown> };
type Job = { if?: string; environment?: string; permissions?: Record<string, string>; steps: Step[] };
type Workflow = { on: Record<string, unknown>; permissions: Record<string, string>; jobs: Record<string, Job> };

const root = path.resolve(__dirname, "../..");
const deploy = yaml.load(fs.readFileSync(path.join(root, ".github/workflows/deploy.yml"), "utf8")) as Workflow;

const indexOf = (job: Job, match: (s: Step) => boolean) => {
  const i = job.steps.findIndex(match);
  expect(i, "step exists").toBeGreaterThanOrEqual(0);
  return i;
};
const runs = (text: string) => (s: Step) => (s.run ?? "").includes(text);

describe("the deploy workflow (N634, N528)", () => {
  it("N634: runs on main and by hand only, with a read-only token", () => {
    expect(Object.keys(deploy.on).sort()).toEqual(["push", "workflow_dispatch"]);
    expect(deploy.on.push).toEqual({ branches: ["main"] });
    expect(deploy.permissions).toEqual({ contents: "read" });
    for (const job of Object.values(deploy.jobs)) {
      for (const level of Object.values(job.permissions ?? {})) expect(level).toBe("read");
    }
  });

  it("N528: staging deploys a main commit only after its release-gate passed and staging has every migration", () => {
    const staging = deploy.jobs.staging;
    expect(staging.if).toBe("github.event_name == 'push' && vars.DRVN_DEPLOY_STAGING == 'true'");
    const gate = indexOf(staging, runs("scripts/deploy.mjs gate"));
    const status = indexOf(staging, runs("--target staging --env-file"));
    const check = indexOf(staging, runs("scripts/deploy.mjs migrations"));
    const ship = indexOf(staging, runs("vercel@65.2.0 deploy --prebuilt --prod"));
    const version = indexOf(staging, runs("scripts/deploy.mjs version"));
    expect(gate).toBeLessThan(status);
    expect(status).toBe(check);
    expect(check).toBeLessThan(ship);
    expect(ship).toBeLessThan(version);
    expect(staging.steps[status].run).toContain("--status");
    expect(staging.steps[status].run).not.toMatch(/--apply/);
  });

  it("N634: production is by hand, for a release tag, through the guarded environment, with the overrides absent (N540)", () => {
    const production = deploy.jobs.production;
    expect(production.if).toBe("github.event_name == 'workflow_dispatch'");
    expect(production.environment).toBe("production");
    expect(production.steps[0].with?.ref).toBe("refs/tags/${{ inputs.tag }}");
    const tag = indexOf(production, runs("scripts/deploy.mjs tag"));
    const gate = indexOf(production, runs("scripts/deploy.mjs gate"));
    const migrations = indexOf(production, runs("--target production --env-file"));
    const overrides = indexOf(production, runs("release-candidate.mjs hosted-env"));
    const ship = indexOf(production, runs("vercel@65.2.0 deploy --prebuilt --prod"));
    expect(production.steps[tag].run).toContain('git cat-file -t "refs/tags/$TAG"');
    expect(production.steps[tag].run).toContain("git merge-base --is-ancestor HEAD origin/main");
    for (const before of [tag, gate, migrations, overrides]) expect(before).toBeLessThan(ship);
  });

  it("N634: never applies a migration, never interpolates an input into a script, and pins the host's CLI", () => {
    for (const job of Object.values(deploy.jobs)) {
      for (const step of job.steps) {
        expect(step.run ?? "").not.toMatch(/--apply/);
        expect(step.run ?? "").not.toMatch(/\$\{\{\s*(inputs|github\.event)/);
        for (const cli of (step.run ?? "").matchAll(/npx --yes (vercel[^\s]*)/g)) expect(cli[1]).toBe("vercel@65.2.0");
        if (step.uses) expect(step.uses).toMatch(/@[0-9a-f]{40}$/);
      }
    }
  });

  it("N634: holds no database owner's password; each migration check signs in with the read-only login (work review #138)", () => {
    const raw = fs.readFileSync(path.join(root, ".github/workflows/deploy.yml"), "utf8");
    // Neither the secret's name nor the env-file line that would carry an owner password.
    expect(raw).not.toMatch(/SUPABASE_DB_PASSWORD/);
    expect(raw).not.toMatch(/_DB_PASSWORD/);
    for (const [name, secret] of [["staging", "STAGING_SUPABASE_READER_PASSWORD"], ["production", "PRODUCTION_SUPABASE_READER_PASSWORD"]] as const) {
      const step = deploy.jobs[name].steps[indexOf(deploy.jobs[name], runs(`--target ${name} --env-file`))];
      expect(step.env?.SUPABASE_DB_READER_PASSWORD).toBe(`\${{ secrets.${secret} }}`);
      expect(step.run).toContain("SUPABASE_DB_READER_USER=deploy_reader");
      expect(step.run).toContain("--status");
      // The file with the login is removed before the next command runs.
      expect(step.run).toMatch(/--status > "\$RUNNER_TEMP\/status\.json"\n\s*rm -f "\$RUNNER_TEMP\/target\.env"/);
    }
  });

  it("N634: tells the alert channel on every outcome", () => {
    for (const [name, job] of Object.entries(deploy.jobs)) {
      const alert = job.steps.at(-1)!;
      // The two deploy jobs report every outcome. The guard before production reports only a refusal:
      // when it passes, the production job that follows reports the deploy itself.
      expect(alert.if, name).toBe(name === "production-guard" ? "failure()" : "always()");
      expect(alert.run).toContain("scripts/deploy.mjs alert");
    }
  });
});

describe("the deploy decisions (N528)", () => {
  const run = (status: string, conclusion: string | null, started: string) => ({ name: "release-gate", status, conclusion, started_at: started });

  it("N528: the newest release-gate run decides; no run yet, or one still going, is pending", () => {
    expect(gateVerdict([])).toBe("pending");
    expect(gateVerdict([{ name: "verify", status: "completed", conclusion: "success" }])).toBe("pending");
    expect(gateVerdict([run("in_progress", null, "2026-11-08T10:00:00Z")])).toBe("pending");
    expect(gateVerdict([run("completed", "success", "2026-11-08T10:00:00Z")])).toBe("passed");
    expect(gateVerdict([run("completed", "failure", "2026-11-08T10:00:00Z")])).toBe("failed");
    expect(gateVerdict([run("completed", "failure", "2026-11-08T10:00:00Z"), run("completed", "success", "2026-11-08T11:00:00Z")])).toBe("passed");
    expect(gateVerdict([run("completed", "success", "2026-11-08T10:00:00Z"), run("completed", "cancelled", "2026-11-08T11:00:00Z")])).toBe("failed");
  });

  it("N528: a target missing any migration stops the deploy; anything but the runner's status is refused", () => {
    expect(missingMigrations({ target: "staging", missing: [] })).toEqual([]);
    expect(missingMigrations({ target: "staging", missing: ["20261108150000_x.sql"] })).toEqual(["20261108150000_x.sql"]);
    expect(() => missingMigrations({ missing: [] })).toThrow(/--status output/);
    expect(() => missingMigrations(null)).toThrow(/--status output/);
  });

  it("N634: the deployed version must name the commit", () => {
    const sha = "a99ee54c0ffee0000000000000000000000000ab";
    expect(versionMatches({ sha }, sha)).toBe(true);
    expect(versionMatches({ sha: sha.slice(0, 7) }, sha)).toBe(true);
    expect(versionMatches({ sha: "e0e696c35330303392a8c11aa6df2b2d62c07bbf" }, sha)).toBe(false);
    expect(versionMatches({ sha: null }, sha)).toBe(false);
    expect(versionMatches({ sha: "a9" }, sha)).toBe(false);
  });

  it("N634: only rc-YYYYMMDD tags with a real date are release tags", () => {
    for (const ok of ["rc-20261201", "rc-20261201-2", "rc-20240229"]) expect(validReleaseTag(ok), ok).toBe(true);
    for (const bad of ["rc-20261301", "rc-20261231x", "v1.0.0", "rc-2026121", "rc-20230229", "", "rc-20261201-123"]) expect(validReleaseTag(bad), bad).toBe(false);
  });

  it("N634: the alert is plain text, bounded", () => {
    expect(alertPayload("deployed")).toEqual({ text: "deployed" });
    expect(alertPayload("x".repeat(5000)).text).toHaveLength(3000);
  });
});

describe("the version step says what it got (N952, report five #115)", () => {
  const SHA = "aee656d9aee656d9aee656d9aee656d9aee656d9";

  it("describes a status and body, trimmed, or a network error", () => {
    expect(describeAttempt({ status: 500, text: "Internal\n  Server Error" })).toBe("HTTP 500: Internal Server Error");
    expect(describeAttempt({ status: 200, text: "" })).toBe("HTTP 200: (empty body)");
    expect(describeAttempt({ status: 502, text: "x".repeat(400) })).toMatch(/^HTTP 502: x{300}…$/);
    expect(describeAttempt({ error: "ENOTFOUND" })).toBe("no answer (ENOTFOUND)");
  });

  it("prints each new answer once and names the last one when it gives up", async () => {
    const answers = [
      { status: 500, body: "A server error occurred" },
      { status: 500, body: "A server error occurred" },
      { status: 200, body: JSON.stringify({ sha: "0000000000" }) },
    ];
    let clock = 0;
    let call = 0;
    const lines: string[] = [];
    const fetchImpl = async () => {
      const answer = answers[Math.min(call++, answers.length - 1)];
      return new Response(answer.body, { status: answer.status });
    };
    await expect(
      waitForVersion("https://staging.example", SHA, {
        timeoutMinutes: 1,
        intervalSeconds: 20,
        fetchImpl: fetchImpl as typeof fetch,
        log: (line: string) => lines.push(line),
        wait: async (ms: number) => { clock += ms; },
        now: () => clock,
      }),
    ).rejects.toThrow(/still reports 0000000000, not aee656d9.*Last answer: HTTP 200: \{"sha":"0000000000"\}.*refused to boot/);
    expect(lines).toEqual([
      "https://staging.example/api/version: HTTP 500: A server error occurred",
      'https://staging.example/api/version: HTTP 200: {"sha":"0000000000"}',
    ]);
  });

  it("returns as soon as the deployment names the commit", async () => {
    const lines: string[] = [];
    await waitForVersion("https://staging.example", SHA, {
      fetchImpl: (async () => new Response(JSON.stringify({ sha: SHA }), { status: 200 })) as typeof fetch,
      log: (line: string) => lines.push(line),
      wait: async () => {},
    });
    expect(lines).toEqual([`https://staging.example reports ${SHA}`]);
  });
});

describe("a superseded staging run deploys nothing (N634, Codex on #175)", () => {
  it("asks whether its commit is still main's head just before the build, and gates the deploy and version check on it", () => {
    const staging = deploy.jobs.staging;
    const head = indexOf(staging, runs("scripts/deploy.mjs current"));
    const ship = indexOf(staging, runs("vercel@65.2.0 deploy --prebuilt --prod"));
    const version = indexOf(staging, runs("scripts/deploy.mjs version"));
    expect(head).toBeLessThan(ship);
    expect(staging.steps[head].run).toContain('>> "$GITHUB_OUTPUT"');
    expect(staging.steps[ship].if).toBe("steps.head.outputs.current == 'true'");
    expect(staging.steps[version].if).toBe("steps.head.outputs.current == 'true'");
  });

  it("only main's exact head counts as current", () => {
    const sha = "aee656d9aee656d9aee656d9aee656d9aee656d9";
    expect(stillHead(sha, sha)).toBe(true);
    expect(stillHead("b".repeat(40), sha)).toBe(false);
    expect(stillHead(undefined, sha)).toBe(false);
    expect(stillHead("", "")).toBe(false);
  });
});

describe("N958: a deploy checks what the served site tells search engines (work review #156, N1072)", () => {
  it("each job names its deployment to the version check, so the served site is held to it", () => {
    for (const name of ["staging", "production"] as const) {
      const step = deploy.jobs[name].steps[indexOf(deploy.jobs[name], runs("scripts/deploy.mjs version"))];
      expect(step.run, name).toMatch(new RegExp(`scripts/deploy\\.mjs version "\\$ORIGIN" "\\$(GITHUB_)?SHA" ${name}$`));
      // After the deploy, before the alert: a deployment that fails it is reported as failed.
      const ship = indexOf(deploy.jobs[name], runs("vercel@65.2.0 deploy --prebuilt --prod"));
      expect(indexOf(deploy.jobs[name], runs("scripts/deploy.mjs version"))).toBeGreaterThan(ship);
    }
  });

  const STAGING_ROBOTS = "User-Agent: *\nDisallow: /\n";
  const PRODUCTION_ROBOTS = "User-Agent: *\nAllow: /\nDisallow: /api/\nDisallow: /admin\n\nHost: https://drvn.app\nSitemap: https://drvn.app/sitemap.xml\nSitemap: https://drvn.app/catalog/sitemap/index.xml\n";
  const hidden = {
    robots: { status: 200, text: STAGING_ROBOTS },
    pages: [{ path: "/", status: 200, tag: "noindex, nofollow" }, { path: "/api/version", status: 200, tag: "noindex, nofollow" }],
    sitemaps: [{ path: "/sitemap.xml", status: 404 }, { path: "/catalog/sitemap/index.xml", status: 404 }],
  };
  const open = {
    robots: { status: 200, text: PRODUCTION_ROBOTS },
    pages: [{ path: "/", status: 200, tag: null }, { path: "/api/version", status: 200, tag: null }],
    sitemaps: [{ path: "/sitemap.xml", status: 200 }],
  };

  it("passes a staging site that is hidden and a production site that is open", () => {
    expect(indexingProblems("staging", hidden)).toEqual([]);
    expect(indexingProblems("production", open)).toEqual([]);
  });

  it("fails a staging deploy that would be crawled, naming each way", () => {
    // Built as production by mistake: everything about it is open.
    expect(indexingProblems("staging", open)).toEqual([
      "/robots.txt does not disallow the whole site: staging would be crawled",
      "/robots.txt names a sitemap: staging would hand its pages to search engines",
      '/ was served without "X-Robots-Tag: noindex" (got no header)',
      '/api/version was served without "X-Robots-Tag: noindex" (got no header)',
      "/sitemap.xml answered 200, not 404: staging serves a sitemap",
    ]);
    // Each fault alone.
    expect(indexingProblems("staging", { ...hidden, pages: [{ path: "/", status: 200, tag: "nofollow" }] })).toEqual(['/ was served without "X-Robots-Tag: noindex" (got "nofollow")']);
    expect(indexingProblems("staging", { ...hidden, sitemaps: [{ path: "/sitemap.xml", status: 200 }] })).toHaveLength(1);
    expect(indexingProblems("staging", { ...hidden, robots: { status: 200, text: "User-Agent: *\nDisallow: /admin\n" } })).toEqual(["/robots.txt does not disallow the whole site: staging would be crawled"]);
    expect(indexingProblems("staging", { ...hidden, robots: { status: 200, text: `${STAGING_ROBOTS}Allow: /\n` } })).toHaveLength(1);
  });

  it("fails a production deploy that is hidden from search", () => {
    expect(indexingProblems("production", hidden)).toEqual([
      "/robots.txt disallows the whole site: production is hidden from search",
      "/robots.txt names no sitemap",
      '/ was served with "X-Robots-Tag: noindex, nofollow": production is hidden from search',
      '/api/version was served with "X-Robots-Tag: noindex, nofollow": production is hidden from search',
      "/sitemap.xml answered 404, not 200",
      "/catalog/sitemap/index.xml answered 404, not 200",
    ]);
    // A path rule such as "Disallow: /api/" is not the whole-site refusal.
    expect(indexingProblems("production", open)).toEqual([]);
  });

  it("fails when robots.txt is not served at all, and on a name that is not a deployment", () => {
    expect(indexingProblems("staging", { ...hidden, robots: { status: 500, text: "" } })).toEqual(["/robots.txt answered 500, not 200"]);
    expect(indexingProblems("production", { ...open, robots: { status: 404, text: "" } })).toEqual(["/robots.txt answered 404, not 200"]);
    expect(indexingProblems("preview", hidden)).toEqual(['"preview" is not a deployment name (staging or production)']);
  });
});
