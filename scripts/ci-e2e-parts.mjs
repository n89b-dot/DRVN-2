#!/usr/bin/env node
// Plan 2 item A0b: the browser suite runs in CI as four parts side by side
// (e2e/parts.json). This is everything the workflow needs around that:
//
//   plan <part>              what this part must install and run, as step outputs
//   record <part> <dir>      write this part's result (ran, passed first time)
//   merge <partsDir> <out>   judge the four parts and merge their results into
//                            the files a single-job suite used to write
//   balance <playwright.xml> propose a new split from a run's measured times
//
// The rule `merge` enforces is the one the release gate has always had, now
// per part: every part must have run and passed on its first attempt. A part
// that is missing, did not run, or failed makes the whole suite fail. The
// merged files keep their old names and shapes, so nothing that reads them
// (the release-gate record, the Intelligence OS) has to change.
//
// No dependencies: the merge job runs it without `npm ci`.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const MANIFEST_PATH = path.join(root, "e2e/parts.json");

/** @typedef {{ operationsPart: string, parts: Record<string, Record<string, string[]>> }} Manifest */

/** @returns {Manifest} */
export function readManifest(file = MANIFEST_PATH) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

/**
 * What is wrong with a manifest, given the spec files on disk and the files
 * each project of the whole suite runs. Empty when every (project, file) the
 * whole suite runs is in exactly one part and no part names anything else.
 *
 * @param {Manifest} manifest
 * @param {Record<string, string[]>} whole project -> files, for the whole suite
 */
export function manifestProblems(manifest, whole) {
  const problems = [];
  const names = Object.keys(manifest.parts ?? {});
  if (!names.length) return ["the manifest has no parts"];
  if (!names.includes(manifest.operationsPart)) problems.push(`operationsPart "${manifest.operationsPart}" is not one of the parts (${names.join(", ")})`);
  const seen = new Map();
  for (const [part, projects] of Object.entries(manifest.parts)) {
    if (!Object.keys(projects).length) problems.push(`part ${part} runs nothing`);
    for (const [project, files] of Object.entries(projects)) {
      for (const file of files) {
        const key = `${project} ${file}`;
        if (seen.has(key)) problems.push(`${file} (${project}) is in part ${seen.get(key)} and in part ${part}: it would run twice`);
        else seen.set(key, part);
        if (!whole[project]?.includes(file)) problems.push(`part ${part} names ${file} for ${project}, which the whole suite does not run there`);
      }
    }
  }
  for (const [project, files] of Object.entries(whole)) {
    for (const file of files) {
      if (!seen.has(`${project} ${file}`)) problems.push(`${file} (${project}) is in no part: it would never run in CI. Add it to the lightest part in e2e/parts.json`);
    }
  }
  return problems;
}

/** What one part must install and whether it runs the recovery drills. */
export function planPart(manifest, part) {
  const projects = manifest.parts[part];
  if (!projects) throw new Error(`There is no part "${part}" in e2e/parts.json (parts: ${Object.keys(manifest.parts).join(", ")})`);
  return { browsers: Object.keys(projects).join(" "), operations: manifest.operationsPart === String(part) };
}

/**
 * Judges the parts. `results` maps a part's name to what its `record` step
 * wrote, or to null when its result file is missing.
 */
export function judgeParts(expected, results) {
  const problems = [];
  for (const part of expected) {
    const result = results[part];
    if (!result) problems.push(`part ${part}: no result (the job was skipped, cancelled, or never uploaded one)`);
    else if (String(result.part) !== String(part)) problems.push(`part ${part}: its result file says it is part ${result.part}`);
    else if (result.ran !== true) problems.push(`part ${part}: the suite did not run`);
    else if (result.first_attempt_passed !== true) problems.push(`part ${part}: the suite did not pass on its first attempt`);
  }
  for (const part of Object.keys(results)) if (!expected.includes(part)) problems.push(`part ${part}: not a part of this suite`);
  const all = expected.map((part) => results[part]);
  return {
    ran: all.every((r) => r?.ran === true),
    first_attempt_passed: problems.length === 0,
    problems,
  };
}

/**
 * The whole-suite rule a single part cannot hold: the suite has exactly the
 * named exclusions the release reporter allows (two importer tests that need
 * the production network guard), no more and no fewer. Each part's summary
 * says how many it saw skipped and how many the whole suite must have
 * (`e2e/release-reporter.ts`); the rule is held here, on the sum.
 * `summaries` maps a part's name to its browser release summary, or to null.
 */
export function inventoryProblems(expected, summaries) {
  const problems = [];
  const present = [];
  for (const part of expected) {
    const summary = summaries[part];
    if (!summary) problems.push(`part ${part}: no browser release summary`);
    else if (String(summary.part) !== String(part)) problems.push(`part ${part}: its browser release summary says it is part ${summary.part ?? "of no part (a whole-suite run)"}`);
    else if (!Number.isInteger(summary.exclusionsRequired) || summary.exclusionsRequired < 0) problems.push(`part ${part}: its summary does not say how many named exclusions the whole suite must have`);
    else if (!Number.isInteger(summary.counts?.excluded) || summary.counts.excluded < 0) problems.push(`part ${part}: its summary does not say how many named exclusions it saw`);
    else present.push([part, summary]);
  }
  if (problems.length || present.length === 0) return problems.length ? problems : ["no part wrote a browser release summary"];
  const required = new Set(present.map(([, summary]) => summary.exclusionsRequired));
  if (required.size !== 1) return [`the parts disagree on how many named exclusions the whole suite must have (${present.map(([part, s]) => `part ${part}: ${s.exclusionsRequired}`).join(", ")})`];
  const [need] = required;
  const seen = present.reduce((sum, [, summary]) => sum + summary.counts.excluded, 0);
  if (seen !== need) problems.push(`named exclusions: the whole suite must have exactly ${need}; the parts have ${seen} (${present.map(([part, s]) => `part ${part}: ${s.counts.excluded}`).join(", ")})`);
  return problems;
}

const attribute = (tag, name) => new RegExp(`\\b${name}="([^"]*)"`).exec(tag)?.[1];

/**
 * One JUnit file from several: every `<testsuite>` of every input, under one
 * `<testsuites>` whose counts are the sums. Playwright writes one testsuite
 * per spec file and project, so the result has the shape of an unsplit run.
 */
export function mergeJUnit(documents) {
  const suites = [];
  const totals = { tests: 0, failures: 0, skipped: 0, errors: 0, time: 0 };
  for (const xml of documents) {
    for (const match of xml.matchAll(/<testsuite\b[^>]*?(?:\/>|>[\s\S]*?<\/testsuite>)/g)) {
      suites.push(match[0]);
      const open = /<testsuite\b[^>]*>/.exec(match[0])[0];
      for (const key of Object.keys(totals)) totals[key] += Number(attribute(open, key) ?? 0);
    }
  }
  const head = `<testsuites id="" name="" tests="${totals.tests}" failures="${totals.failures}" skipped="${totals.skipped}" errors="${totals.errors}" time="${totals.time}">`;
  return `${head}\n${suites.join("\n")}\n</testsuites>\n`;
}

/** The browser release summary of the whole suite from the parts' summaries. */
export function mergeSummaries(summaries, candidate) {
  const counts = { selected: 0, expected: 0, flaky: 0, excluded: 0, unexpected: 0 };
  for (const summary of summaries) for (const key of Object.keys(counts)) counts[key] += Number(summary?.counts?.[key] ?? 0);
  const all = (field) => (summaries.length > 0 && summaries.every((s) => s?.[field] === "passed") ? "passed" : "failed");
  return { candidate, playwrightStatus: all("playwrightStatus"), releaseStatus: all("releaseStatus"), counts, parts: summaries.length };
}

/** A greedy split of (project, file, seconds) units into `count` parts of near-equal time. */
export function balance(units, count, fixed = {}) {
  const bins = Array.from({ length: count }, (_, i) => ({ part: String(i + 1), seconds: fixed[String(i + 1)] ?? 0, units: [] }));
  for (const unit of [...units].sort((a, b) => b.seconds - a.seconds || `${a.project} ${a.file}`.localeCompare(`${b.project} ${b.file}`))) {
    const bin = bins.reduce((least, b) => (b.seconds < least.seconds ? b : least));
    bin.units.push(unit);
    bin.seconds += unit.seconds;
  }
  return bins;
}

function output(values) {
  const lines = Object.entries(values).map(([key, value]) => `${key}=${value}`);
  console.log(lines.join("\n"));
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `${lines.join("\n")}\n`);
}

/**
 * The first file (or directory) called `name` anywhere under `dir`, or null.
 * An uploaded artifact is rooted at the common folder of the files that
 * existed, so the same file sits at a different depth when a part failed
 * before writing the others.
 */
export function findUnder(dir, name, wantDirectory = false) {
  if (!fs.existsSync(dir)) return null;
  const entries = fs.readdirSync(dir, { withFileTypes: true }).sort((x, y) => x.name.localeCompare(y.name));
  for (const entry of entries) if (entry.name === name && entry.isDirectory() === wantDirectory) return path.join(dir, entry.name);
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const found = findUnder(path.join(dir, entry.name), name, wantDirectory);
    if (found) return found;
  }
  return null;
}

const readUnder = (dir, name) => {
  const file = findUnder(dir, name);
  return file ? fs.readFileSync(file, "utf8") : null;
};

function copyTree(from, to) {
  if (!fs.existsSync(from)) return;
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const source = path.join(from, entry.name);
    const target = path.join(to, entry.name);
    if (entry.isDirectory()) copyTree(source, target);
    else {
      fs.mkdirSync(to, { recursive: true });
      fs.copyFileSync(source, target);
    }
  }
}

function main() {
  const [command, a, b] = process.argv.slice(2);
  const manifest = readManifest();
  const sha = process.env.GITHUB_SHA ?? "local";

  if (command === "plan" && a) {
    const plan = planPart(manifest, a);
    output({ browsers: plan.browsers, operations: plan.operations });
    return;
  }

  if (command === "record" && a && b) {
    fs.mkdirSync(b, { recursive: true });
    const result = { part: String(a), sha, ran: process.env.RAN === "true", first_attempt_passed: process.env.FIRST_ATTEMPT_PASSED === "true" };
    fs.writeFileSync(path.join(b, "part.json"), `${JSON.stringify(result, null, 2)}\n`);
    console.log(JSON.stringify(result));
    return;
  }

  if (command === "merge" && a && b) {
    const expected = Object.keys(manifest.parts);
    const dirOf = (part) => path.join(a, `e2e-part-${part}-${sha}`);
    const results = Object.fromEntries(expected.map((part) => {
      const text = readUnder(dirOf(part), "part.json");
      return [part, text ? JSON.parse(text) : null];
    }));
    const verdict = judgeParts(expected, results);

    // The merged files are written whatever the verdict: a red run keeps its results too.
    const junit = (name) => expected.map((part) => readUnder(dirOf(part), name)).filter(Boolean);
    fs.mkdirSync(path.join(b, "test-results"), { recursive: true });
    fs.mkdirSync(path.join(b, "release-results"), { recursive: true });
    if (junit("playwright.xml").length) fs.writeFileSync(path.join(b, "test-results/playwright.xml"), mergeJUnit(junit("playwright.xml")));
    if (junit("playwright-diagnostic.xml").length) fs.writeFileSync(path.join(b, "test-results/playwright-diagnostic.xml"), mergeJUnit(junit("playwright-diagnostic.xml")));
    const operations = readUnder(dirOf(manifest.operationsPart), "operations.xml");
    if (operations) fs.writeFileSync(path.join(b, "test-results/operations.xml"), operations);
    const byPart = Object.fromEntries(expected.map((part) => {
      const text = readUnder(dirOf(part), `browser-release-${sha}.json`);
      return [part, text ? JSON.parse(text) : null];
    }));
    const summaries = Object.values(byPart).filter(Boolean);
    const summary = mergeSummaries(summaries, sha);
    // Judged only when every part ran: a part that did not is already a problem above.
    const inventory = verdict.ran ? inventoryProblems(expected, byPart) : [];
    if (summaries.length !== expected.length || inventory.length) summary.releaseStatus = "failed";
    fs.writeFileSync(path.join(b, "release-results", `browser-release-${sha}.json`), `${JSON.stringify(summary, null, 2)}\n`);
    for (const part of expected) {
      const design = findUnder(dirOf(part), "design", true);
      if (design) copyTree(design, path.join(b, "test-results/design"));
    }

    const problems = [...verdict.problems, ...inventory];
    output({ ran: verdict.ran, first_attempt_passed: verdict.first_attempt_passed && problems.length === 0 });
    console.log(`Browser suite across ${expected.length} parts: ${summary.counts.selected} tests, ${summary.counts.expected} expected, ${summary.counts.unexpected} unexpected, ${summary.counts.flaky} flaky.`);
    if (process.env.GITHUB_STEP_SUMMARY) {
      const row = (part) => `| ${part} | ${results[part] ? (results[part].ran ? "yes" : "no") : "missing"} | ${results[part]?.first_attempt_passed ? "yes" : "no"} |`;
      fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## Browser suite, four parts\n\n| Part | Ran | Passed first time |\n|---|---|---|\n${expected.map(row).join("\n")}\n\n${summary.counts.selected} tests in all.\n`);
    }
    if (problems.length) {
      for (const problem of problems) console.log(`::error title=Browser suite::${problem}`);
      process.exit(1);
    }
    return;
  }

  if (command === "balance" && a) {
    const xml = fs.readFileSync(a, "utf8");
    const units = [...xml.matchAll(/<testsuite\b[^>]*>/g)].map((m) => ({ project: attribute(m[0], "hostname"), file: attribute(m[0], "name"), seconds: Number(attribute(m[0], "time") ?? 0) }));
    const cross = units.filter((u) => u.project !== "chromium");
    const crossPart = Object.entries(manifest.parts).find(([, projects]) => Object.keys(projects).some((p) => p !== "chromium"))?.[0] ?? "4";
    // Fixed costs: the recovery drills, and installing two more browsers.
    const fixed = { [manifest.operationsPart]: 31, [crossPart]: 25 + cross.reduce((sum, u) => sum + u.seconds, 0) };
    const bins = balance(units.filter((u) => u.project === "chromium"), Object.keys(manifest.parts).length, fixed);
    bins.find((bin) => bin.part === crossPart).units.push(...cross);
    const parts = Object.fromEntries(bins.map((bin) => {
      const projects = {};
      for (const unit of [...bin.units].sort((x, y) => `${x.project} ${x.file}`.localeCompare(`${y.project} ${y.file}`))) (projects[unit.project] ??= []).push(unit.file);
      return [bin.part, projects];
    }));
    console.log(JSON.stringify({ seconds: Object.fromEntries(bins.map((bin) => [bin.part, Math.round(bin.seconds)])), parts }, null, 2));
    return;
  }

  console.error("usage: ci-e2e-parts.mjs plan <part> | record <part> <dir> | merge <partsDir> <outDir> | balance <playwright.xml>");
  process.exit(2);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
