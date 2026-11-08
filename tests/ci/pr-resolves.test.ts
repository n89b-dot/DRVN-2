// OS-signals: a pull request that names launch work says, in one line, what
// it closes, so the DRVN Intelligence OS can close items on evidence instead
// of guessing from prose (docs/ids.md).
//
// CI's verify job passes the PR's title and description in PR_TITLE and
// PR_BODY. A local run, or a push to main, has neither and skips the PR
// check; the rule itself is tested on fixed examples either way.
//
// The description is read when the job runs. Editing it afterwards doesn't
// rerun CI: push a commit or rerun the verify job.
import fs from "node:fs";
import path from "node:path";

import yaml from "js-yaml";
import { describe, expect, it } from "vitest";

import { idsIn, isId, resolvesLines } from "./os-ids";

/** What is wrong with a PR's title and description, or [] when nothing is. */
export function resolvesProblems(title: string, body: string): string[] {
  const problems: string[] = [];
  const lines = resolvesLines(body);
  const titleIds = idsIn(title);
  if (titleIds.length && !lines.length) {
    problems.push(
      `the title names ${titleIds.join(", ")} but the description has no "Resolves:" line. ` +
        'Add one line listing every id this PR closes, such as "Resolves: N410 OS-W08", or "Resolves: none".',
    );
  }
  for (const tokens of lines) {
    if (!tokens.length) {
      problems.push('a "Resolves:" line is empty: list the ids this PR closes, or write "Resolves: none".');
      continue;
    }
    const none = tokens.filter((t) => t.toLowerCase() === "none");
    if (none.length && tokens.length > 1) {
      problems.push(`"Resolves: none" can't also list ids (${tokens.filter((t) => t.toLowerCase() !== "none").join(", ")}).`);
      continue;
    }
    if (none.length) continue;
    const bad = tokens.filter((t) => !isId(t));
    if (bad.length) {
      problems.push(
        `"Resolves:" has ${bad.map((t) => `"${t}"`).join(", ")}, which ${bad.length > 1 ? "aren't ids" : "isn't an id"}. ` +
          "Ids are N###, R##, R-slug, B#, OS-W##, OS-PR##, OS-R-slug or OS-p1-commerce, exactly as docs/ids.md writes them (capitals included); put prose on another line.",
      );
    }
  }
  return problems;
}

describe("Resolves line rule (OS-signals)", () => {
  it.each([
    ["no id in the title, no line", "Fix a typo", "Small change."],
    ["id in the title, ids listed", "OS-W12: sign-in security", "Body\nResolves: N420 N421 OS-W12\n"],
    ["Resolves: none", "OS-signals: JUnit everywhere", "Resolves: none"],
    ["commas and lower-case keyword", "OS-PR33 R-pg", "resolves: OS-PR33, R-pg, R69-age"],
    ["every family", "B1 hardening", "Resolves: N4 R75 R-staging-behind B1 OS-W20a OS-PR65 OS-R-cron OS-p1-commerce"],
  ])("passes: %s", (_, title, body) => {
    expect(resolvesProblems(title, body)).toEqual([]);
  });

  it.each([
    ["id in the title, no line", "OS-W12: sign-in security", "Fixes auth.", /no "Resolves:" line/],
    ["an empty line", "Docs", "Resolves:", /is empty/],
    ["a lower-case id", "Docs", "Resolves: n410", /"n410"/],
    ["a PR number", "Docs", "Resolves: #123", /"123"/],
    ["prose on the line", "N410 deps", "Resolves: N410 and the zod advisory", /"and", "the"/],
    ["none mixed with ids", "Docs", "Resolves: none N410", /can't also list/],
  ])("fails: %s", (_, title, body, message) => {
    expect(resolvesProblems(title, body).join("\n")).toMatch(message);
  });

  it("reads ids in titles as whole tokens, the way the OS does", () => {
    expect(idsIn("OS-signals: Resolves enforcement")).toEqual([]);
    expect(idsIn("Refunds and Reviews")).toEqual([]);
    expect(idsIn("OS-W12 OS-R-cron: sign-in (N40, R69-age)")).toEqual(["OS-W12", "OS-R-cron", "N40", "R69-age"]);
  });
});

describe("CI hands this check the pull request", () => {
  it("verify's Tests step passes the PR title and description through env", () => {
    type Step = { name?: string; env?: Record<string, string> };
    const ci = yaml.load(fs.readFileSync(path.resolve(__dirname, "../../.github/workflows/ci.yml"), "utf8")) as {
      jobs: { verify: { steps: Step[] } };
    };
    const tests = ci.jobs.verify.steps.find((s) => s.name === "Tests");
    expect(tests?.env).toMatchObject({
      PR_TITLE: "${{ github.event.pull_request.title }}",
      PR_BODY: "${{ github.event.pull_request.body }}",
      PR_DIFF_BASE: "HEAD^1",
    });
    type Checkout = { uses?: string; with?: Record<string, unknown> };
    const checkout = (ci.jobs.verify.steps as Checkout[]).find((s) => s.uses?.startsWith("actions/checkout@"));
    expect(checkout?.with?.["fetch-depth"], "verify fetches the merge commit's base parent").toBe(2);
  });
});

const title = process.env.PR_TITLE;
describe.skipIf(!title)("this pull request's Resolves line", () => {
  it("names what it closes in a well-formed Resolves line", () => {
    const problems = resolvesProblems(title ?? "", process.env.PR_BODY ?? "");
    expect(problems, `Pull request description:\n- ${problems.join("\n- ")}`).toEqual([]);
  });
});
