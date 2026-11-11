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
 * Plan 2 item A6 (N1075): the migration history became one baseline, and the
 * files it replaced moved, byte for byte, to supabase/migrations-archive/.
 * That move is the one way a file may leave supabase/migrations/: it must
 * arrive in the archive with the same bytes (the same git blob). The archive
 * itself never changes: nothing in it is edited, renamed or removed. (Work
 * review #126's named exception for PR #198 went with the history.)
 */
export const ARCHIVE = "supabase/migrations-archive/";

/** What is wrong with the migration files a change adds, removes or archives, given the base's files. */
export function orderProblems(
  baseFiles: string[],
  headFiles: string[],
  archive: { base: Map<string, string>; head: Map<string, string>; baseBlobs: Map<string, string> } = { base: new Map(), head: new Map(), baseBlobs: new Map() },
): string[] {
  const base = new Set(baseFiles);
  const head = new Set(headFiles);
  const problems: string[] = [];
  for (const file of baseFiles) {
    if (head.has(file)) continue;
    const blob = archive.baseBlobs.get(file);
    if (blob && archive.head.get(file) === blob) continue;
    problems.push(
      archive.head.has(file)
        ? `${file} is on the base branch and this change archives it with different bytes; a file moves to ${ARCHIVE} unchanged`
        : `${file} is on the base branch and this change renames or removes it; a merged migration is never renamed`,
    );
  }
  for (const [file, blob] of archive.base) {
    if (archive.head.get(file) !== blob) problems.push(`${file} is in ${ARCHIVE} on the base branch and this change edits, renames or removes it; the archive never changes`);
  }
  for (const file of archive.head.keys()) {
    if (!archive.base.has(file) && !(archive.baseBlobs.has(file) && !head.has(file))) {
      problems.push(`${file} is new in ${ARCHIVE} and was not moved there from supabase/migrations/ unchanged; only the history the baseline replaced is archived`);
    }
  }
  const newest = [...base].sort((a, b) => key(a).localeCompare(key(b))).at(-1);
  for (const file of headFiles.filter((f) => !base.has(f)).sort()) {
    if (newest && key(file) <= key(newest)) {
      problems.push(`${file} is dated at or before ${newest}, already on the base branch; give it a timestamp later than every merged file`);
    }
  }
  return problems;
}

/** name → git blob of every .sql file in one folder at one commit (empty when the folder is not there). */
function blobsAt(ref: string, dir: string): Map<string, string> {
  try {
    const listing = execFileSync("git", ["ls-tree", `${ref}:${dir}`], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    return new Map(
      listing
        .split("\n")
        .map((line) => /^\d+ blob ([0-9a-f]+)\t(.+\.sql)$/.exec(line))
        .filter((m): m is RegExpExecArray => m !== null)
        .map((m) => [m[2], m[1]]),
    );
  } catch {
    return new Map();
  }
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

  it("lets the history move to the archive unchanged, and nothing else (N1075)", () => {
    const blobs = new Map([["0001_a.sql", "aaa"], ["20261111120000_b.sql", "bbb"]]);
    const moved = { base: new Map<string, string>(), head: new Map(blobs), baseBlobs: blobs };
    // The A6 change: both files archived as they were, one baseline dated after them.
    expect(orderProblems([...blobs.keys()], ["20261111130000_baseline.sql"], moved)).toEqual([]);
    // Archived with different bytes.
    expect(orderProblems([...blobs.keys()], ["20261111130000_baseline.sql"], { ...moved, head: new Map([["0001_a.sql", "aaa"], ["20261111120000_b.sql", "xxx"]]) })).toEqual([
      "20261111120000_b.sql is on the base branch and this change archives it with different bytes; a file moves to supabase/migrations-archive/ unchanged",
    ]);
    // Removed, not archived.
    expect(orderProblems([...blobs.keys()], ["20261111130000_baseline.sql"], { ...moved, head: new Map([["0001_a.sql", "aaa"]]) })).toEqual([
      "20261111120000_b.sql is on the base branch and this change renames or removes it; a merged migration is never renamed",
    ]);
    // A file put in the archive that was never in the migrations folder.
    expect(orderProblems([...blobs.keys()], ["20261111130000_baseline.sql"], { ...moved, head: new Map([...blobs, ["20990101000000_new.sql", "nnn"]]) })).toEqual([
      "20990101000000_new.sql is new in supabase/migrations-archive/ and was not moved there from supabase/migrations/ unchanged; only the history the baseline replaced is archived",
    ]);
    // A back-dated baseline is refused like any back-dated file.
    expect(orderProblems([...blobs.keys()], ["20261111110000_baseline.sql"], moved)).toHaveLength(1);
  });

  it("never lets the archive change once it is on the base branch (N1075)", () => {
    const archived = new Map([["0001_a.sql", "aaa"], ["20261111120000_b.sql", "bbb"]]);
    const after = (head: Map<string, string>) => orderProblems(["20261111130000_baseline.sql"], ["20261111130000_baseline.sql", "20261112000000_next.sql"], { base: archived, head, baseBlobs: new Map() });
    expect(after(new Map(archived))).toEqual([]);
    expect(after(new Map([["0001_a.sql", "aaa"], ["20261111120000_b.sql", "edited"]]))).toEqual([
      "20261111120000_b.sql is in supabase/migrations-archive/ on the base branch and this change edits, renames or removes it; the archive never changes",
    ]);
    expect(after(new Map([["0001_a.sql", "aaa"]]))).toHaveLength(1);
  });

  const base = resolveBase();
  it.skipIf(!base)("this change adds migrations only after the base branch's newest, and renames none", () => {
    const problems = orderProblems(migrationsAt(base!), migrationsAt("HEAD"), {
      base: blobsAt(base!, ARCHIVE),
      head: blobsAt("HEAD", ARCHIVE),
      baseBlobs: blobsAt(base!, DIR),
    });
    expect(problems, `Migration order (supabase/MIGRATIONS.md):\n- ${problems.join("\n- ")}`).toEqual([]);
  });
});
