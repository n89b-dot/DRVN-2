// Plan 2 item A0b: the browser suite runs in CI as four parts side by side.
// What must stay true, and is proven here by running the real code:
//
//   1. The parts together run every test of the unsplit suite exactly once.
//      Playwright itself lists the unsplit suite and each part; the lists are
//      compared test by test (project, file, title, line).
//   2. Every part must have run and passed on its first attempt. A part that
//      is missing, skipped, cancelled or failed fails the suite, and the
//      release gate with it.
//   3. The merged results keep the names and shapes a single job wrote.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import yaml from "js-yaml";
import { afterAll, describe, expect, it } from "vitest";

import { balance, findUnder, inventoryProblems, judgeParts, manifestProblems, mergeJUnit, mergeSummaries, planPart, readManifest } from "../../scripts/ci-e2e-parts.mjs";

const root = path.resolve(__dirname, "../..");
const manifest = readManifest();
const PARTS = Object.keys(manifest.parts);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "drvn-e2e-parts-"));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

type Listed = { key: string; project: string; file: string };

/**
 * What Playwright would run, from `playwright test --list`: the real config,
 * the real spec files, no browser and no server. The keys only have to be
 * present for the config and the specs to load; nothing is contacted.
 */
function list(part: string | null): { tests: Listed[]; status: number | null; stderr: string } {
  const env: Record<string, string | undefined> = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    NODE_ENV: "test",
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
    E2E_TEST_PROJECT_REF: "local-drvn-remediation",
    PAYMENTS_MODE: "stub",
    SUPABASE_SECRET_KEY: "list-only",
    SUPABASE_SERVICE_ROLE_KEY: "list-only",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "list-only",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "list-only",
  };
  if (part !== null) env.E2E_PART = part;
  const run = spawnSync("npx", ["playwright", "test", "--list", "--reporter=json"], { cwd: root, env: env as NodeJS.ProcessEnv, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  const tests: Listed[] = [];
  try {
    type Suite = { title: string; specs?: { title: string; file: string; line: number; tests: { projectName: string }[] }[]; suites?: Suite[] };
    const report = JSON.parse(run.stdout) as { suites: Suite[]; errors?: unknown[] };
    const walk = (suite: Suite, titles: string[]) => {
      for (const spec of suite.specs ?? []) {
        for (const test of spec.tests) {
          tests.push({ project: test.projectName, file: spec.file, key: [test.projectName, spec.file, [...titles, spec.title].join(" › "), spec.line].join(" | ") });
        }
      }
      for (const child of suite.suites ?? []) walk(child, [...titles, child.title]);
    };
    for (const suite of report.suites) walk(suite, []);
    if (report.errors?.length) return { tests: [], status: 1, stderr: JSON.stringify(report.errors).slice(0, 400) };
  } catch {
    return { tests: [], status: run.status ?? 1, stderr: run.stderr.slice(-400) };
  }
  return { tests, status: run.status, stderr: run.stderr };
}

const filesByProject = (tests: Listed[]) => {
  const out: Record<string, string[]> = {};
  for (const test of tests) if (!(out[test.project] ??= []).includes(test.file)) out[test.project].push(test.file);
  return out;
};

describe("the four parts are the whole browser suite, each test once (plan 2 A0b)", () => {
  const whole = list(null);
  const parts = Object.fromEntries(PARTS.map((part) => [part, list(part)]));

  it("Playwright lists the unsplit suite and every part without error", () => {
    expect(whole.status, whole.stderr).toBe(0);
    expect(whole.tests.length).toBeGreaterThan(300);
    for (const part of PARTS) {
      expect(parts[part].status, `part ${part}: ${parts[part].stderr}`).toBe(0);
      expect(parts[part].tests.length, `part ${part} runs something`).toBeGreaterThan(0);
    }
  }, 120_000);

  it("no test is in two parts", () => {
    const seen = new Map<string, string>();
    const twice: string[] = [];
    for (const part of PARTS) {
      for (const test of parts[part].tests) {
        if (seen.has(test.key)) twice.push(`${test.key} (parts ${seen.get(test.key)} and ${part})`);
        seen.set(test.key, part);
      }
    }
    expect(twice).toEqual([]);
  });

  it("every test of the unsplit suite is in a part, and no part runs anything else", () => {
    const inParts = new Set(PARTS.flatMap((part) => parts[part].tests.map((test) => test.key)));
    const wholeKeys = new Set(whole.tests.map((test) => test.key));
    expect(whole.tests.map((t) => t.key).filter((key) => !inParts.has(key)), "tests that would never run in CI").toEqual([]);
    expect([...inParts].filter((key) => !wholeKeys.has(key)), "tests only a part runs").toEqual([]);
    expect(PARTS.reduce((sum, part) => sum + parts[part].tests.length, 0)).toBe(whole.tests.length);
  });

  it("the manifest names every spec file the suite runs, per browser, exactly once", () => {
    expect(manifestProblems(manifest, filesByProject(whole.tests))).toEqual([]);
  });

  it("the same browsers run the same specs as before the split", () => {
    const projects = filesByProject(whole.tests);
    expect(Object.keys(projects).sort()).toEqual(["chromium", "firefox", "webkit"]);
    expect(projects.firefox.sort()).toEqual(["golden-path.spec.ts", "remediation-security.spec.ts"]);
    expect(projects.webkit.sort()).toEqual(["golden-path.spec.ts", "remediation-security.spec.ts"]);
    // chromium runs every spec file there is, bar the evidence capture the config leaves out.
    const onDisk = fs.readdirSync(path.join(root, "e2e")).filter((f) => f.endsWith(".spec.ts") && f !== "evidence.spec.ts").sort();
    expect(projects.chromium.sort()).toEqual(onDisk);
  });

  it("a part that does not exist is an error, not an empty run", () => {
    const bad = list("9");
    expect(bad.status).not.toBe(0);
    expect(bad.tests).toEqual([]);
  }, 60_000);
});

describe("a manifest that would drop or repeat a test is refused (plan 2 A0b)", () => {
  const whole = { chromium: ["a.spec.ts", "b.spec.ts", "c.spec.ts"], firefox: ["a.spec.ts"] };
  const good = { operationsPart: "1", parts: { "1": { chromium: ["a.spec.ts", "b.spec.ts"] }, "2": { chromium: ["c.spec.ts"], firefox: ["a.spec.ts"] } } };

  it("accepts a split that covers everything once", () => {
    expect(manifestProblems(good, whole)).toEqual([]);
  });

  it.each([
    ["a spec left out of every part", { ...good, parts: { ...good.parts, "2": { firefox: ["a.spec.ts"], chromium: [] as string[] } } }, /c\.spec\.ts \(chromium\) is in no part/],
    ["a spec in two parts", { ...good, parts: { ...good.parts, "2": { chromium: ["c.spec.ts", "a.spec.ts"], firefox: ["a.spec.ts"] } } }, /a\.spec\.ts \(chromium\) is in part 1 and in part 2/],
    ["a cross-browser run left out", { ...good, parts: { ...good.parts, "2": { chromium: ["c.spec.ts"] } } }, /a\.spec\.ts \(firefox\) is in no part/],
    ["a file the suite does not run", { ...good, parts: { ...good.parts, "1": { chromium: ["a.spec.ts", "b.spec.ts", "gone.spec.ts"] } } }, /gone\.spec\.ts/],
    ["a browser the suite does not run that file in", { ...good, parts: { ...good.parts, "1": { chromium: ["a.spec.ts", "b.spec.ts"], firefox: ["b.spec.ts"] } } }, /b\.spec\.ts for firefox/],
    ["an empty part", { ...good, parts: { ...good.parts, "3": {} } }, /part 3 runs nothing/],
    ["drills assigned to a part that does not exist", { ...good, operationsPart: "7" }, /operationsPart "7"/],
  ])("refuses %s", (_, changed, message) => {
    expect(manifestProblems(changed, whole).join("\n")).toMatch(message);
  });

  it("the recovery drills run in exactly one part, and only one part installs the other browsers", () => {
    const plans = PARTS.map((part) => planPart(manifest, part));
    expect(plans.filter((plan) => plan.operations)).toHaveLength(1);
    expect(plans.filter((plan) => plan.browsers !== "chromium").map((plan) => plan.browsers)).toEqual(["chromium firefox webkit"]);
    expect(() => planPart(manifest, "9")).toThrow(/no part "9"/);
  });
});

describe("every part must have run and passed first time (plan 2 A0b)", () => {
  const ok = (part: string) => ({ part, sha: "abc", ran: true, first_attempt_passed: true });
  const all = () => Object.fromEntries(PARTS.map((part) => [part, ok(part)])) as Record<string, ReturnType<typeof ok> | null>;

  it("four parts that ran and passed are a passing suite", () => {
    expect(judgeParts(PARTS, all())).toEqual({ ran: true, first_attempt_passed: true, problems: [] });
  });

  it.each([
    ["a part with no result (skipped, cancelled, never uploaded)", (r: ReturnType<typeof all>) => { r["3"] = null; }, /part 3: no result/],
    ["a part whose suite did not run", (r: ReturnType<typeof all>) => { r["2"] = { ...ok("2"), ran: false, first_attempt_passed: false }; }, /part 2: the suite did not run/],
    ["a part that failed its first attempt", (r: ReturnType<typeof all>) => { r["4"] = { ...ok("4"), first_attempt_passed: false }; }, /part 4: the suite did not pass on its first attempt/],
    ["one part's result standing in for another", (r: ReturnType<typeof all>) => { r["2"] = ok("1"); }, /part 2: its result file says it is part 1/],
    ["a part nobody asked for", (r: ReturnType<typeof all>) => { r["5"] = ok("5"); }, /part 5: not a part of this suite/],
  ])("refuses %s", (_, change, message) => {
    const results = all();
    change(results);
    const verdict = judgeParts(PARTS, results);
    expect(verdict.first_attempt_passed).toBe(false);
    expect(verdict.problems.join("\n")).toMatch(message);
  });

  it("values that only look true do not count", () => {
    const results = all();
    results["1"] = { ...ok("1"), first_attempt_passed: "true" as unknown as boolean };
    expect(judgeParts(PARTS, results).first_attempt_passed).toBe(false);
  });
});

describe("the two named exclusions are counted across the parts (plan 2 A0b)", () => {
  // What e2e/release-reporter.ts writes in a part: how many named exclusions it saw, and how many the whole suite must have.
  const summary = (part: string, excluded = 0, exclusionsRequired: unknown = 2) => ({ candidate: "abc", part, exclusionsRequired, playwrightStatus: "passed", releaseStatus: "passed", counts: { selected: 5, expected: 5 - excluded, flaky: 0, excluded, unexpected: 0 } });
  const all = (where: Record<string, number> = { "3": 2 }) => Object.fromEntries(PARTS.map((part) => [part, summary(part, where[part] ?? 0)])) as Record<string, ReturnType<typeof summary> | null>;

  it("both in one part, or one in each of two, is the whole suite's two", () => {
    expect(inventoryProblems(PARTS, all())).toEqual([]);
    expect(inventoryProblems(PARTS, all({ "1": 1, "4": 1 }))).toEqual([]);
  });

  it.each([
    ["one of the two gone (deleted, renamed, or no longer skipped)", all({ "3": 1 }), /must have exactly 2; the parts have 1 \(part 1: 0, part 2: 0, part 3: 1, part 4: 0\)/],
    ["both gone", all({}), /must have exactly 2; the parts have 0/],
    ["the same two counted in two parts", all({ "2": 2, "3": 2 }), /must have exactly 2; the parts have 4/],
  ])("refuses %s", (_, summaries, message) => {
    expect(inventoryProblems(PARTS, summaries).join("\n")).toMatch(message);
  });

  it("refuses a part with no summary, one part's summary standing in for another, and a whole-suite summary", () => {
    const missing = all(); missing["2"] = null;
    expect(inventoryProblems(PARTS, missing)).toEqual(["part 2: no browser release summary"]);
    const swapped = all(); swapped["2"] = summary("3", 2);
    expect(inventoryProblems(PARTS, swapped).join("\n")).toMatch(/part 2: its browser release summary says it is part 3/);
    const whole = all(); delete (whole["1"] as { part?: string }).part;
    expect(inventoryProblems(PARTS, whole).join("\n")).toMatch(/part 1: its browser release summary says it is part of no part/);
  });

  it("refuses parts that disagree on, or do not say, how many the whole suite must have", () => {
    const disagree = all(); disagree["4"] = summary("4", 0, 0);
    expect(inventoryProblems(PARTS, disagree).join("\n")).toMatch(/the parts disagree .*part 3: 2, part 4: 0/);
    for (const bad of [null, "2", -1, 1.5]) {
      const silent = all(); silent["1"] = summary("1", 0, bad);
      expect(inventoryProblems(PARTS, silent).join("\n")).toMatch(/part 1: its summary does not say how many named exclusions the whole suite must have/);
    }
    // A requirement of zero everywhere cannot hide two skipped tests either.
    expect(inventoryProblems(PARTS, Object.fromEntries(PARTS.map((part) => [part, summary(part, part === "3" ? 2 : 0, 0)]))).join("\n")).toMatch(/must have exactly 0; the parts have 2/);
    expect(inventoryProblems([], {})).toEqual(["no part wrote a browser release summary"]);
  });
});

describe("the merged results keep their old names and shapes (plan 2 A0b)", () => {
  const junit = (suites: string, tests: number, failures = 0) => `<testsuites id="" name="" tests="${tests}" failures="${failures}" skipped="0" errors="0" time="1.5">\n${suites}\n</testsuites>`;
  const suite = (name: string, project: string, tests: number, failures = 0) =>
    `<testsuite name="${name}" timestamp="t" hostname="${project}" tests="${tests}" failures="${failures}" skipped="0" time="2.5" errors="0">\n<testcase name="x" classname="${name}" time="1"></testcase>\n</testsuite>`;

  it("JUnit: every testsuite of every part under one root whose counts are the sums", () => {
    const merged = mergeJUnit([junit(suite("a.spec.ts", "chromium", 3), 3), junit([suite("b.spec.ts", "chromium", 2, 1), suite("a.spec.ts", "firefox", 3)].join("\n"), 5, 1)]);
    expect(merged).toMatch(/^<testsuites id="" name="" tests="8" failures="1" skipped="0" errors="0" time="7.5">/);
    expect(merged.match(/<testsuite name=/g)).toHaveLength(3);
    expect(merged.match(/<testcase /g)).toHaveLength(3);
    expect(merged.trimEnd().endsWith("</testsuites>")).toBe(true);
  });

  it("browser summary: counts are summed; passed only when every part passed", () => {
    const part = (expected: number, unexpected = 0, status = "passed") => ({ candidate: "abc", playwrightStatus: status, releaseStatus: status, counts: { selected: expected + unexpected, expected, flaky: 0, excluded: 0, unexpected } });
    expect(mergeSummaries([part(10), part(20), part(30), part(40)], "abc")).toEqual({
      candidate: "abc", playwrightStatus: "passed", releaseStatus: "passed", parts: 4,
      counts: { selected: 100, expected: 100, flaky: 0, excluded: 0, unexpected: 0 },
    });
    expect(mergeSummaries([part(10), part(19, 1, "failed")], "abc")).toMatchObject({ releaseStatus: "failed", counts: { selected: 30, unexpected: 1 } });
    expect(mergeSummaries([], "abc")).toMatchObject({ releaseStatus: "failed", counts: { selected: 0 } });
  });

  /** Lays out what four part jobs upload, runs the real merge command, and returns what it wrote. */
  function merge(name: string, shape: (part: string) => { result?: object | null; flat?: boolean; summary?: boolean; excluded?: number }) {
    const partsDir = path.join(tmp, name, "parts");
    const out = path.join(tmp, name, "out");
    const outputs = path.join(tmp, name, "outputs");
    for (const part of PARTS) {
      const { result = { part, sha: "abc", ran: true, first_attempt_passed: true }, flat = false, summary = true, excluded = part === "3" ? 2 : 0 } = shape(part);
      if (result === null) continue;
      const dir = path.join(partsDir, `e2e-part-${part}-abc`);
      // A part that wrote only its result file is uploaded with that file at the artifact's root.
      const resultDir = flat ? dir : path.join(dir, "e2e-part");
      fs.mkdirSync(resultDir, { recursive: true });
      fs.writeFileSync(path.join(resultDir, "part.json"), JSON.stringify(result));
      if (flat) continue;
      fs.mkdirSync(path.join(dir, "test-results/design"), { recursive: true });
      fs.mkdirSync(path.join(dir, "release-results"), { recursive: true });
      fs.writeFileSync(path.join(dir, "test-results/playwright.xml"), junit(suite(`part${part}.spec.ts`, "chromium", 2), 2));
      fs.writeFileSync(path.join(dir, `test-results/design/shot-${part}.png`), part);
      if (part === manifest.operationsPart) fs.writeFileSync(path.join(dir, "test-results/operations.xml"), "<testsuites><testsuite name=\"drills\"></testsuite></testsuites>");
      if (summary) fs.writeFileSync(path.join(dir, "release-results/browser-release-abc.json"), JSON.stringify({ candidate: "abc", part, exclusionsRequired: 2, playwrightStatus: "passed", releaseStatus: "passed", counts: { selected: 2 + excluded, expected: 2, flaky: 0, excluded, unexpected: 0 } }));
    }
    fs.mkdirSync(partsDir, { recursive: true });
    const run = spawnSync("node", [path.join(root, "scripts/ci-e2e-parts.mjs"), "merge", partsDir, out], {
      encoding: "utf8",
      env: { NODE_ENV: "test", PATH: process.env.PATH, GITHUB_SHA: "abc", GITHUB_OUTPUT: outputs } as NodeJS.ProcessEnv,
    });
    const read = (file: string) => (fs.existsSync(path.join(out, file)) ? fs.readFileSync(path.join(out, file), "utf8") : null);
    return { status: run.status, stdout: run.stdout, outputs: fs.existsSync(outputs) ? fs.readFileSync(outputs, "utf8") : "", read, out };
  }

  it("four good parts: exit 0, both outputs true, and the three old artifacts' files are written", () => {
    const merged = merge("good", () => ({}));
    expect(merged.status).toBe(0);
    expect(merged.outputs).toBe("ran=true\nfirst_attempt_passed=true\n");
    expect(merged.read("test-results/playwright.xml")).toMatch(/^<testsuites id="" name="" tests="8"/);
    expect(merged.read("test-results/operations.xml")).toContain("drills");
    expect(JSON.parse(merged.read("release-results/browser-release-abc.json")!)).toEqual({ candidate: "abc", playwrightStatus: "passed", releaseStatus: "passed", parts: 4, counts: { selected: 10, expected: 8, flaky: 0, excluded: 2, unexpected: 0 } });
    expect(fs.readdirSync(path.join(merged.out, "test-results/design")).sort()).toEqual(PARTS.map((part) => `shot-${part}.png`));
  });

  it("a part that failed: exit 1, first_attempt_passed=false, and the results are still written", () => {
    const merged = merge("failed", (part) => (part === "2" ? { result: { part, sha: "abc", ran: true, first_attempt_passed: false } } : {}));
    expect(merged.status).toBe(1);
    expect(merged.outputs).toBe("ran=true\nfirst_attempt_passed=false\n");
    expect(merged.stdout).toContain("::error title=Browser suite::part 2: the suite did not pass on its first attempt");
    expect(merged.read("test-results/playwright.xml")).toMatch(/tests="8"/);
  });

  it("every part green but a named exclusion missing from the whole suite: exit 1, and the summary says failed", () => {
    const merged = merge("inventory", (part) => (part === "3" ? { excluded: 1 } : {}));
    expect(merged.status).toBe(1);
    expect(merged.outputs).toBe("ran=true\nfirst_attempt_passed=false\n");
    expect(merged.stdout).toContain("::error title=Browser suite::named exclusions: the whole suite must have exactly 2; the parts have 1");
    expect(JSON.parse(merged.read("release-results/browser-release-abc.json")!)).toMatchObject({ releaseStatus: "failed", counts: { excluded: 1 } });
  });

  it("every part green but one wrote no browser summary: exit 1", () => {
    const merged = merge("no-summary", (part) => (part === "2" ? { summary: false } : {}));
    expect(merged.status).toBe(1);
    expect(merged.outputs).toBe("ran=true\nfirst_attempt_passed=false\n");
    expect(merged.stdout).toContain("part 2: no browser release summary");
  });

  it("a part that was skipped or cancelled (nothing uploaded): exit 1, and neither output is true", () => {
    const merged = merge("missing", (part) => (part === "3" ? { result: null } : {}));
    expect(merged.status).toBe(1);
    expect(merged.outputs).toBe("ran=false\nfirst_attempt_passed=false\n");
    expect(merged.stdout).toContain("part 3: no result");
    expect(JSON.parse(merged.read("release-results/browser-release-abc.json")!)).toMatchObject({ releaseStatus: "failed", parts: 3 });
  });

  it("a part that died before the suite ran still has its result read, wherever the upload put the file", () => {
    const merged = merge("flat", (part) => (part === "1" ? { result: { part, sha: "abc", ran: false, first_attempt_passed: false }, flat: true } : {}));
    expect(merged.status).toBe(1);
    expect(merged.stdout).toContain("part 1: the suite did not run");
    expect(merged.stdout).not.toContain("part 1: no result");
    expect(findUnder(path.join(tmp, "flat/parts/e2e-part-1-abc"), "part.json")).toMatch(/e2e-part-1-abc\/part\.json$/);
  });

  it("no parts at all (every job skipped): exit 1", () => {
    expect(merge("none", () => ({ result: null })).status).toBe(1);
  });
});

describe("the split is by measured time (plan 2 A0b)", () => {
  it("puts each unit in the lightest part, heaviest first, honouring a part's fixed cost", () => {
    const units = [50, 40, 30, 20, 10, 10].map((seconds, i) => ({ project: "chromium", file: `s${i}.spec.ts`, seconds }));
    const bins = balance(units, 2, { "1": 20 });
    expect(bins.map((bin) => Math.round(bin.seconds))).toEqual([90, 90]);
    expect(bins.flatMap((bin) => bin.units).length).toBe(6);
  });

  it("the committed split is near-equal on the run it was measured from", () => {
    const seconds = Object.values((manifest as unknown as { measured: { seconds: Record<string, number> } }).measured.seconds);
    expect(seconds).toHaveLength(PARTS.length);
    // Parts 1 and 4 carry fixed costs (the drills; two more browsers), so their tests are fewer seconds.
    expect(Math.max(...seconds) - Math.min(...seconds)).toBeLessThanOrEqual(60);
  });
});

describe("the workflow runs the parts and judges them (plan 2 A0b)", () => {
  type Step = { id?: string; name?: string; if?: string; run?: string; uses?: string; env?: Record<string, string>; with?: Record<string, unknown> };
  type Job = { name?: string; if?: string; needs?: string[]; outputs?: Record<string, string>; env?: Record<string, string>; strategy?: { "fail-fast"?: boolean; matrix?: { part?: number[] } }; steps: Step[] };
  const ci = yaml.load(fs.readFileSync(path.join(root, ".github/workflows/ci.yml"), "utf8")) as { jobs: Record<string, Job> };
  const parts = ci.jobs["e2e-parts"];
  const judge = ci.jobs.e2e;
  const step = (job: Job, name: string) => job.steps.find((s) => s.name === name)!;

  it("one job per part in the manifest, none cancelled when another fails", () => {
    expect(parts.strategy?.matrix?.part?.map(String)).toEqual(PARTS);
    expect(parts.strategy?.["fail-fast"]).toBe(false);
    expect(parts.env?.E2E_PART).toBe("${{ matrix.part }}");
    expect(parts.needs).toEqual(["changes"]);
    expect(parts.if).toBe("needs.changes.outputs.docs_only != 'true'");
  });

  it("each part has its own stack and build, and only the planned part runs the drills", () => {
    expect(step(parts, "Start isolated Supabase with captured email").if).toBeUndefined();
    expect(step(parts, "Required browser regression suite").if).toBeUndefined();
    for (const name of ["Start isolated Typesense", "Storage, deletion and search recovery drills"]) {
      expect(step(parts, name).if, name).toBe("steps.plan.outputs.operations == 'true'");
    }
    expect(step(parts, "Plan this part").run).toBe('node scripts/ci-e2e-parts.mjs plan "$E2E_PART"');
    expect(step(parts, "Install this part's browsers").env).toEqual({ BROWSERS: "${{ steps.plan.outputs.browsers }}" });
  });

  it("each part records its result on every outcome and uploads it under its own name", () => {
    const record = step(parts, "Record this part's result");
    expect(record.if).toBe("always()");
    expect(record.env).toEqual({ RAN: "${{ steps.executed.outputs.ran }}", FIRST_ATTEMPT_PASSED: "${{ steps.executed.outputs.first_attempt_passed }}" });
    const upload = step(parts, "Retain this part's results");
    expect(upload.if).toBe("always()");
    expect(upload.with).toMatchObject({ name: "e2e-part-${{ matrix.part }}-${{ github.sha }}", "if-no-files-found": "error" });
  });

  it("the judging job runs when a part has failed, not on a documents-only change, and owns the gate's two outputs", () => {
    expect(judge.needs).toEqual(["changes", "e2e-parts"]);
    expect(judge.if).toBe("${{ !cancelled() && needs.changes.result == 'success' && needs.changes.outputs.docs_only != 'true' }}");
    expect(judge.outputs).toEqual({ ran: "${{ steps.merge.outputs.ran }}", first_attempt_passed: "${{ steps.merge.outputs.first_attempt_passed }}" });
    expect(step(judge, "Fetch every part's results").with).toMatchObject({ pattern: "e2e-part-*-${{ github.sha }}" });
    expect(step(judge, "Judge the parts and merge their results")).toMatchObject({ id: "merge", run: 'node scripts/ci-e2e-parts.mjs merge "$PARTS_DIR" .' });
  });

  it("the three artifacts readers know keep their names", () => {
    const names = judge.steps.map((s) => s.with?.name).filter(Boolean);
    expect(names).toEqual(["browser-release-summary-${{ github.sha }}", "test-results-${{ github.sha }}-e2e", "design-screenshots-${{ github.sha }}"]);
  });

  it("the gate reads the parts' own result as well as the judgement", () => {
    const gate = ci.jobs["release-gate"];
    expect(gate.needs).toEqual(expect.arrayContaining(["e2e-parts", "e2e"]));
    expect(gate.steps[0].env).toMatchObject({ E2E_PARTS: "${{ needs.e2e-parts.result }}", E2E: "${{ needs.e2e.result }}" });
  });
});
