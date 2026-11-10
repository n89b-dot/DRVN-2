// The table the Intelligence OS reads from a report or review (docs/ids.md,
// "The table the OS reads"). The OS used to interpret a report's prose and
// needed a new correction rule most days; a report now carries one small
// table that it reads exactly. This check makes a malformed table fail here,
// before the OS meets it.
//
// A file is checked only if it has the heading. With no such file on the
// branch, the repository check passes and the rules are still exercised by
// the cases below.
import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "../..");

export const HEADING = "## For the Intelligence OS";
export const HEADER = "| OS id | Finding | State | Pull request | For | Note |";

/** An item id the OS already holds: N123, R12 (with or without a slug) or R-slug. */
const ITEM = "(?:N\\d+|R\\d+(?:-[A-Za-z0-9]+)*|R-[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*)";
const OS_ID = new RegExp(`^(?:new|${ITEM})$`);
const FINDING = /^#\d+$/;
const STATE = new RegExp(`^(?:fixed|open|by design|accepted|after launch|(?:same as|not the same as|waiting on) ${ITEM})$`);
// Separated by commas, with or without a space after each: the OS's own rule, no stricter.
const PULL_REQUESTS = /^#\d+(?:, ?#\d+)*$/;
const FOR = new Set(["engineer", "you", "counsel", "decide"]);

/**
 * The Intelligence OS's own pattern for a file it reads as a report, copied
 * from the OS so the two can be compared: a docs/ file, not under
 * docs/plans/, whose name contains readiness, review, audit, report or
 * findings.
 */
export const OS_REPORT_FILE = /^docs\/(?!plans\/)(?:.*\/)?[^/]*(readiness|review|audit|report|findings)[^/]*\.md$/i;

/** Whether the OS reads a table from this path. */
export function isReportFile(file: string): boolean {
  return OS_REPORT_FILE.test(file.split(path.sep).join("/"));
}

/** A table row's cells, trimmed; `\|` inside a cell is a literal bar. */
function cells(line: string): string[] {
  const inner = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return inner.split(/(?<!\\)\|/).map((cell) => cell.replace(/\\\|/g, "|").trim());
}

/**
 * What is wrong with a file's table for the Intelligence OS, as sentences
 * that name the row. An empty list means the OS can read it. A file without
 * the heading has no table and no problems.
 */
export function osTableProblems(markdown: string, file = "the file"): string[] {
  const lines = markdown.split("\n");
  const headings = lines.flatMap((line, index) => (line.trim() === HEADING ? [index] : []));
  if (!headings.length) return [];
  const problems: string[] = [];
  if (!isReportFile(file)) problems.push(`${file}: the OS reads this table only from a docs/ file whose name contains readiness, review, audit, report or findings, outside docs/plans/`);
  if (headings.length > 1) problems.push(`${file}: "${HEADING}" appears ${headings.length} times; a file carries at most one such table`);

  // The table is the first run of lines starting with "|" after the heading, before the next heading.
  let start = headings[0] + 1;
  while (start < lines.length && !lines[start].trim().startsWith("|") && !/^#{1,6} /.test(lines[start])) start += 1;
  if (start >= lines.length || !lines[start].trim().startsWith("|")) {
    problems.push(`${file}: no table follows "${HEADING}"`);
    return problems;
  }
  let end = start;
  while (end < lines.length && lines[end].trim().startsWith("|")) end += 1;
  const table = lines.slice(start, end).map((line) => line.trim());

  if (table[0] !== HEADER) problems.push(`${file}: the table's header must be exactly "${HEADER}"`);
  if (!table[1] || !/^\|(?:\s*:?-{3,}:?\s*\|){6}$/.test(table[1])) problems.push(`${file}: the header is followed by a six-column separator row`);

  const findings = new Map<string, number>();
  for (const [offset, line] of table.slice(2).entries()) {
    const row = `${file}, row ${offset + 1}`;
    const cell = cells(line);
    if (cell.length !== 6) {
      problems.push(`${row}: has ${cell.length} cells, not 6`);
      continue;
    }
    const [osId, finding, state, pullRequests, forWhom, note] = cell;
    const isNew = osId === "new";
    if (!OS_ID.test(osId)) problems.push(`${row}: OS id "${osId}" is not an existing id (N123, R-slug, R12) or "new"`);
    if (finding ? !FINDING.test(finding) : isNew) problems.push(`${row}: Finding is "#" and digits, and is required when OS id is "new" (got "${finding}")`);
    if (!STATE.test(state)) {
      problems.push(`${row}: State "${state}" is not one of fixed, open, same as <id>, not the same as <id>, by design, accepted, waiting on <id>, after launch (an <id> is one N or R id)`);
    }
    if (pullRequests && !PULL_REQUESTS.test(pullRequests)) problems.push(`${row}: Pull request is blank, "#N", or several separated by commas (got "${pullRequests}")`);
    if (forWhom ? !FOR.has(forWhom) : isNew) problems.push(`${row}: For is one of engineer, you, counsel, decide, and is required when OS id is "new" (got "${forWhom}")`);
    if (isNew && !note) problems.push(`${row}: Note is the one-line title of a "new" item and cannot be blank`);
    if (FINDING.test(finding)) {
      if (findings.has(finding)) problems.push(`${row}: Finding ${finding} is already on row ${findings.get(finding)}`);
      else findings.set(finding, offset + 1);
    }
  }

  // Rows and prose agree: every entry that starts a line "**#NNN " has a row, and every row's Finding has an entry.
  const prose = new Set([...markdown.matchAll(/^\*\*(#\d+) /gm)].map((m) => m[1]));
  for (const number of prose) if (!findings.has(number)) problems.push(`${file}: finding ${number} is written up in the prose and has no row in the table`);
  for (const number of findings.keys()) if (!prose.has(number)) problems.push(`${file}: the table has a row for ${number} and no entry in the prose starts "**${number} "`);
  return problems;
}

function markdownFiles(dir: string): string[] {
  return fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((entry) => {
    const relative = `${dir}/${entry.name}`;
    if (entry.isDirectory()) return markdownFiles(relative);
    return entry.name.endsWith(".md") ? [relative] : [];
  });
}

/** A small, well-formed report: two findings in prose, a row for each. */
const good = (rows: string[], prose = ["**#124 A test fails (High, Checked).** Text.", "**#131 A photo is unlocked by field name (High).** Text."]) =>
  ["# A review", "", ...prose, "", HEADING, "", "One row per finding.", "", HEADER, "|---|---|---|---|---|---|", ...rows, "", "## Method"].join("\n");
const ROWS = ["| new | #124 | fixed | #200 | engineer | A test fails |", "| N940 | #131 | open | #210, #196 | engineer | A photo is unlocked by field name |"];
const FILE = "docs/work-review-2026-11-10.md";
const withRow = (row: string) => osTableProblems(good([row, ROWS[1]]), FILE);

describe("the table the Intelligence OS reads from a report", () => {
  it("every report or review in docs/ that carries the table carries a well-formed one", () => {
    const problems = markdownFiles("docs").flatMap((file) => osTableProblems(fs.readFileSync(path.join(root, file), "utf8"), file));
    expect(problems).toEqual([]);
  });

  it("accepts a well-formed table, and a file with no such heading has nothing to check", () => {
    expect(osTableProblems(good(ROWS), FILE)).toEqual([]);
    expect(osTableProblems("# A plan\n\n**#124 text**\n", "docs/plans/a-plan.md")).toEqual([]);
    // Every State, with and without an id; an existing item needs no Finding, For or Note.
    for (const state of ["fixed", "open", "by design", "accepted", "after launch", "same as N940", "not the same as R-staging", "waiting on R69-age"]) {
      expect(withRow(`| new | #124 | ${state} |  | you | A test fails |`), state).toEqual([]);
    }
    expect(osTableProblems(good(["| N725 |  | open |  |  |  |", ...ROWS]), FILE)).toEqual([]);
  });

  it("refuses a header that is not exactly the six columns, and a missing separator", () => {
    const renamed = good(ROWS).replace(HEADER, "| OS id | Finding | State | PR | For | Note |");
    expect(osTableProblems(renamed, FILE)).toEqual([expect.stringContaining("header must be exactly")]);
    const noSeparator = good(ROWS).replace("|---|---|---|---|---|---|\n", "");
    expect(osTableProblems(noSeparator, FILE).some((p) => p.includes("separator row"))).toBe(true);
  });

  it("refuses an OS id that is neither an existing id nor new", () => {
    for (const id of ["n940", "N940a", "B3", "OS-W12", "", "NEW"]) {
      expect(withRow(`| ${id} | #124 | open |  | engineer | Title |`).some((p) => p.includes("is not an existing id")), id).toBe(true);
    }
  });

  it("refuses a State outside the list, or one that needs an id and has none or two", () => {
    for (const state of ["done", "Fixed", "fixed in #200", "same as", "same as #131", "waiting on N1 N2", "waiting on Neil", ""]) {
      expect(withRow(`| new | #124 | ${state} |  | engineer | Title |`).some((p) => p.includes("State")), state).toBe(true);
    }
  });

  it("refuses a malformed Finding, and a new item with no Finding, For or Note", () => {
    expect(withRow("| new | 124 | open |  | engineer | Title |").some((p) => p.includes("Finding is"))).toBe(true);
    expect(withRow("| new |  | open |  | engineer | Title |").some((p) => p.includes("Finding is"))).toBe(true);
    expect(withRow("| new | #124 | open |  |  | Title |").some((p) => p.includes("For is one of"))).toBe(true);
    expect(withRow("| new | #124 | open |  | neil | Title |").some((p) => p.includes("For is one of"))).toBe(true);
    expect(withRow("| new | #124 | open |  | engineer |  |").some((p) => p.includes("Note is the one-line title"))).toBe(true);
  });

  it("refuses a Pull request cell that is not #N or several separated by commas", () => {
    for (const cell of ["200", "PR #200", "#200 #201", "#200;#201", "#200 and #201", "#200,", "#200,  #201", "n89b-dot/DRVN-2#200"]) {
      expect(withRow(`| new | #124 | fixed | ${cell} | engineer | Title |`).some((p) => p.includes("Pull request is")), cell).toBe(true);
    }
    // A comma with or without a space after it: what the OS accepts, this accepts.
    for (const cell of ["#200", "#200, #201", "#200,#201", "#188, #190,#195"]) {
      expect(withRow(`| new | #124 | fixed | ${cell} | engineer | Title |`), cell).toEqual([]);
    }
  });

  it("refuses a row with the wrong number of cells, and the same finding twice", () => {
    expect(withRow("| new | #124 | fixed | #200 | engineer |").some((p) => p.includes("cells, not 6"))).toBe(true);
    expect(osTableProblems(good([ROWS[0], ROWS[0], ROWS[1]]), FILE).some((p) => p.includes("already on row 1"))).toBe(true);
  });

  it("holds the table and the prose to each other, both ways", () => {
    // A finding written up with no row.
    const extraProse = good(ROWS, ["**#124 A.** x", "**#131 B.** y", "**#132 C.** z"]);
    expect(osTableProblems(extraProse, FILE)).toEqual([`${FILE}: finding #132 is written up in the prose and has no row in the table`]);
    // A row with no write-up.
    const extraRow = good([...ROWS, "| new | #199 | open |  | engineer | Title |"]);
    expect(osTableProblems(extraRow, FILE)).toEqual([`${FILE}: the table has a row for #199 and no entry in the prose starts "**#199 "`]);
    // A mention inside a sentence is not an entry.
    expect(osTableProblems(good(ROWS, ["**#124 A.** x", "**#131 B.** y", "See **#132 elsewhere**."]), FILE)).toEqual([]);
  });

  it("refuses two tables in one file, a heading with no table, and a table in a file the OS does not read", () => {
    expect(osTableProblems(`${good(ROWS)}\n\n${HEADING}\n`, FILE).some((p) => p.includes("appears 2 times"))).toBe(true);
    expect(osTableProblems(`# A review\n\n${HEADING}\n\nNo table here.\n\n## Method\n`, FILE)).toEqual([`${FILE}: no table follows "${HEADING}"`]);
    for (const file of ["docs/plans/2026-11-a-review.md", "docs/plans/sub/readiness.md", "docs/production-runbook.md", "README-review.md", "docs/review-evidence/notes.md", "docs/a-report.txt"]) {
      expect(osTableProblems(good(ROWS), file).some((p) => p.includes("reads this table only from")), file).toBe(true);
    }
    // The OS's five words, in the file's own name, at any depth outside docs/plans/.
    for (const file of ["docs/work-review-2026-11-10.md", "docs/production-readiness-2026-11-09.md", "docs/Section-Audit-Oct.md", "docs/site/a-report.md", "docs/review-evidence/2026-11-08-codex-post-merge-review.md", "docs/security-findings.md"]) {
      expect(isReportFile(file), file).toBe(true);
      expect(osTableProblems(good(ROWS), file), file).toEqual([]);
    }
  });
});
