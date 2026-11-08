// Report three #95 (remediation plan A3): the post-merge Codex review queue
// lives in the repository, docs/review-evidence/codex-queue.md, one row per PR
// merged since #61. In CI (a shallow checkout) this checks every row's shape.
// Where the full history is present, it also checks that every PR merged to
// main since #61 has a row, allowing two days for the row to be added after
// the merge, so another session's merge never turns main red.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "../..");
const QUEUE = "docs/review-evidence/codex-queue.md";
const FIRST = 61;
const GRACE_DAYS = 2;

export type QueueRow = { pr: number; merged: string; review: string; reviewedOn: string; verdict: string };

const REVIEWS = new Set(["full", "fix-check", "full + fix-check", "skipped", "owed"]);
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function queueRows(markdown: string): QueueRow[] {
  const rows: QueueRow[] = [];
  for (const line of markdown.split("\n")) {
    const cells = line.replace(/^\|/, "").replace(/\|\s*$/, "").split("|").map((c) => c.trim());
    const pr = /^#(\d+)$/.exec(cells[0] ?? "");
    if (!line.startsWith("|") || !pr) continue;
    rows.push({ pr: Number(pr[1]), merged: cells[1], review: cells[3], reviewedOn: cells[4], verdict: cells[5] });
  }
  return rows;
}

/** What is wrong with one row. */
export function rowProblem(row: QueueRow): string | null {
  if (!DATE.test(row.merged)) return `#${row.pr}: Merged is not a date`;
  if (!REVIEWS.has(row.review)) return `#${row.pr}: Review must be one of ${[...REVIEWS].join(", ")}`;
  if (row.review === "owed" && row.reviewedOn !== "owed") return `#${row.pr}: an owed review has "owed" as its date`;
  if (row.review === "skipped" && row.reviewedOn !== "—") return `#${row.pr}: a skipped review has "—" as its date`;
  if (!["owed", "skipped"].includes(row.review) && !DATE.test(row.reviewedOn)) return `#${row.pr}: a done review needs its date`;
  if (!row.verdict) return `#${row.pr}: Verdict is empty`;
  return null;
}

/** PRs merged to HEAD's first-parent history since #61, with their merge dates; null in a shallow clone. */
function mergedPrs(): Array<{ pr: number; at: Date }> | null {
  try {
    const shallow = execFileSync("git", ["rev-parse", "--is-shallow-repository"], { cwd: root, encoding: "utf8" }).trim();
    if (shallow !== "false") return null;
    const log = execFileSync("git", ["log", "--first-parent", "--merges", "--format=%cI %s", "HEAD"], { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    return log
      .split("\n")
      .map((line) => /^(\S+) Merge pull request #(\d+) /.exec(line))
      .filter((m): m is RegExpExecArray => !!m && Number(m[2]) >= FIRST)
      .map((m) => ({ pr: Number(m[2]), at: new Date(m[1]) }));
  } catch {
    return null;
  }
}

describe("the Codex review queue is in the repository (#95)", () => {
  const rows = queueRows(fs.readFileSync(path.join(root, QUEUE), "utf8"));

  it("has one well-formed row per PR, from #61", () => {
    expect(rows.length).toBeGreaterThan(90);
    expect(new Set(rows.map((r) => r.pr)).size).toBe(rows.length);
    expect(Math.min(...rows.map((r) => r.pr))).toBe(FIRST);
    expect(rows.map(rowProblem).filter(Boolean)).toEqual([]);
  });

  it("reads rows and refuses malformed ones", () => {
    const md = "| PR | Merged | Title | Review | Reviewed on | Verdict |\n|---|---|---|---|---|---|\n| #200 | 2026-11-09 | x | owed | owed | — |\n| #201 | 2026-11-09 | y | full | soon | clean |";
    const [a, b] = queueRows(md);
    expect(rowProblem(a)).toBeNull();
    expect(rowProblem(b)).toBe("#201: a done review needs its date");
    expect(rowProblem({ ...a, review: "maybe" })).toMatch(/Review must be one of/);
  });

  const merged = mergedPrs();
  it.skipIf(!merged)("lists every PR merged to main since #61, two days after its merge", () => {
    const listed = new Set(rows.map((r) => r.pr));
    const cutoff = Date.now() - GRACE_DAYS * 24 * 60 * 60 * 1000;
    const missing = merged!.filter((m) => m.at.getTime() < cutoff && !listed.has(m.pr)).map((m) => `#${m.pr}`);
    expect(missing, `Add these merged PRs to ${QUEUE} (as owed, or skipped when docs-only)`).toEqual([]);
  });
});
