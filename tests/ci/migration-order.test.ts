// Readiness #97 (report three): three migrations were renamed after rebase,
// so filename order stopped being apply order. Apply order on every target is
// merge order; this keeps the two the same from now on. A pull request may
// only add migration files, each dated after every file already on the base
// branch, and may never rename or remove a file the base has
// (supabase/MIGRATIONS.md, "A merged migration is never renamed").
//
// In CI the verify job checks out the PR's merge commit with its two parents
// and sets PR_DIFF_BASE=HEAD^1, the base branch tip, so "the base" is current
// main, the branch the file will land on. Locally the base is the merge base
// with origin/main. With no base to compare against, the PR check is skipped.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "../..");
const DIR = "supabase/migrations/";

/** A migration's version: the digits before the first underscore (`0057`, `20261108140000`). */
export function version(file: string): string {
  const match = /^(\d+)_/.exec(path.basename(file));
  if (!match) throw new Error(`${file}: a migration file name starts with its version and an underscore`);
  return match[1];
}

/** Sortable form: the four-digit baseline files (0001–0057) come before every dated file. */
const key = (file: string) => version(file).padStart(14, "0");

/**
 * Back-dated files that are let in by name (work review #126, decision D6 of
 * docs/plans/2026-11-work-review-remediation-plan.md). A file listed here may
 * be added although a later-dated file is already on the base branch. Every
 * other rule still holds for it, and any file not listed is still refused.
 *
 * An entry is the exact file name, the day it was let in, its pull request
 * and why. It is for a file that both shared databases already hold under
 * that name, in the order a new database will apply the files by name, so
 * that renaming it would mean rewriting two databases' history to cure a
 * problem that exists only in merge order. It is not a way to skip a rename
 * of a file that is applied nowhere: rename that file.
 *
 * Temporary: plan 2 item A6 replaces the migration history with one baseline
 * and this list goes with it.
 */
export const BACKDATED_EXCEPTIONS: Record<string, { date: string; pullRequest: number; reason: string }> = {
  "20261110110000_admin_resume_account_deletion.sql": {
    date: "2026-11-10",
    pullRequest: 198,
    reason: "applied to shared dev and staging on 10 Nov before merge; #200 merged first",
  },
};

/** What is wrong with the migration files a change adds or removes, given the base's files. */
export function orderProblems(baseFiles: string[], headFiles: string[], exceptions: Record<string, unknown> = BACKDATED_EXCEPTIONS): string[] {
  const base = new Set(baseFiles);
  const head = new Set(headFiles);
  const problems: string[] = [];
  for (const file of baseFiles) {
    if (!head.has(file)) problems.push(`${file} is on the base branch and this change renames or removes it; a merged migration is never renamed`);
  }
  const newest = [...base].sort((a, b) => key(a).localeCompare(key(b))).at(-1);
  for (const file of headFiles.filter((f) => !base.has(f)).sort()) {
    if (newest && key(file) <= key(newest) && !Object.hasOwn(exceptions, file)) {
      problems.push(`${file} is dated at or before ${newest}, already on the base branch; give it a timestamp later than every merged file`);
    }
  }
  return problems;
}

function migrationsAt(ref: string): string[] {
  return execFileSync("git", ["ls-tree", "--name-only", `${ref}:${DIR}`], { cwd: root, encoding: "utf8" })
    .split("\n")
    .filter((f) => f.endsWith(".sql"));
}

function resolveBase(): string | null {
  try {
    const ref = process.env.PR_DIFF_BASE ?? "origin/main";
    return execFileSync("git", ["merge-base", ref, "HEAD"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() || null;
  } catch {
    return null;
  }
}

describe("migration files are added in date order and never renamed (#97)", () => {
  it("accepts a later file and refuses a back-dated one, naming it", () => {
    const base = ["0057_x.sql", "20261107220500_a.sql", "20261108140000_b.sql"];
    expect(orderProblems(base, [...base, "20261108150000_c.sql"])).toEqual([]);
    expect(orderProblems(base, [...base, "20261108130000_late.sql"])).toEqual([
      "20261108130000_late.sql is dated at or before 20261108140000_b.sql, already on the base branch; give it a timestamp later than every merged file",
    ]);
    expect(orderProblems(base, [...base, "20261108140000_same.sql"])[0]).toMatch(/^20261108140000_same\.sql is dated at or before/);
  });

  it("refuses a rename or removal of a file the base has", () => {
    const base = ["20261107170000_a.sql", "20261108100000_b.sql"];
    const renamed = ["20261107170000_a.sql", "20261108200000_b.sql"];
    const problems = orderProblems(base, renamed);
    expect(problems).toContain(
      "20261108100000_b.sql is on the base branch and this change renames or removes it; a merged migration is never renamed",
    );
    expect(problems).toHaveLength(1);
  });

  it("orders the four-digit baseline files before every dated file", () => {
    expect(orderProblems(["0001_a.sql", "0057_b.sql"], ["0001_a.sql", "0057_b.sql", "20260905011618_c.sql"])).toEqual([]);
    expect(orderProblems(["20260905011618_c.sql"], ["20260905011618_c.sql", "0058_d.sql"])).toHaveLength(1);
  });

  it("N944: lets in a back-dated file only when it is named in the exceptions, and still refuses every other one (work review #126)", () => {
    const base = ["20261110100000_a.sql", "20261110120000_takedown.sql", "20261110130000_age.sql"];
    const listed = "20261110110000_admin_resume_account_deletion.sql";
    expect(Object.keys(BACKDATED_EXCEPTIONS)).toContain(listed);
    // The listed file is accepted although two later files are already on the base.
    expect(orderProblems(base, [...base, listed])).toEqual([]);
    // An unlisted file with the same date, or any other back-dated file, is refused as before.
    expect(orderProblems(base, [...base, "20261110110000_something_else.sql"])).toEqual([
      "20261110110000_something_else.sql is dated at or before 20261110130000_age.sql, already on the base branch; give it a timestamp later than every merged file",
    ]);
    expect(orderProblems(base, [...base, listed, "20261110125959_late.sql"])).toHaveLength(1);
    // With no exceptions at all, the listed file is refused: the list is what lets it in.
    expect(orderProblems(base, [...base, listed], {})).toHaveLength(1);
    // An exception never covers a rename or a removal.
    expect(orderProblems([...base, listed], base)).toEqual([`${listed} is on the base branch and this change renames or removes it; a merged migration is never renamed`]);
  });

  it("N944: every exception names a file that exists, with its day, pull request and reason", () => {
    const onDisk = new Set(fs.readdirSync(path.join(root, DIR)));
    for (const [file, entry] of Object.entries(BACKDATED_EXCEPTIONS)) {
      expect(onDisk.has(file), `${file} is listed as an exception and is not in ${DIR}`).toBe(true);
      expect(entry.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(Number.isInteger(entry.pullRequest) && entry.pullRequest > 0).toBe(true);
      expect(entry.reason.length).toBeGreaterThan(20);
    }
    // One entry, for one known file. Adding another is a decision to record, not a convenience.
    expect(Object.keys(BACKDATED_EXCEPTIONS)).toEqual(["20261110110000_admin_resume_account_deletion.sql"]);
  });

  const base = resolveBase();
  it.skipIf(!base)("this change adds migrations only after the base branch's newest, and renames none", () => {
    const problems = orderProblems(migrationsAt(base!), migrationsAt("HEAD"));
    expect(problems, `Migration order (supabase/MIGRATIONS.md):\n- ${problems.join("\n- ")}`).toEqual([]);
  });
});
