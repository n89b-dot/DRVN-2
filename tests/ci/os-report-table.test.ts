// The table the Intelligence OS reads from a report or review (docs/ids.md,
// "The table the OS reads"). The OS used to interpret a report's prose and
// needed a new correction rule most days; a report now carries one small
// table that it reads exactly. This check makes a malformed table fail here,
// before the OS meets it.
//
// One file outside the reports carries the table too: the remediation record
// (docs/plans/2026-11-remediation-record.md), where the OS reads both plans
// step by step. There a row may be a step: a progress marker for the ids it
// names (State "step"), never a second item. "The record's table" below.
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
/** In the record: a plan and a step or key, as in #1-2.7 or #1-AL1. */
const STEP_FINDING = /^#\d-[A-Za-z0-9]+(?:\.[A-Za-z0-9]+)*$/;
const ITEMS = new RegExp(`^${ITEM}(?: ${ITEM})*$`);

/** The one file under docs/plans/ whose table the OS reads: both remediation plans, step by step. */
export const RECORD_FILE = "docs/plans/2026-11-remediation-record.md";
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
  const record = file.split(path.sep).join("/") === RECORD_FILE;
  if (!record && !isReportFile(file)) problems.push(`${file}: the OS reads this table only from a docs/ file whose name contains readiness, review, audit, report or findings, outside docs/plans/`);
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
    const isStep = state === "step";
    const severalIds = ITEMS.test(osId) && osId.includes(" ");
    if (record && (isStep || severalIds)) {
      // A step: a progress marker for the ids it names, never a second item.
      if (!isStep) problems.push(`${row}: an OS id cell with more than one id is allowed only with State "step" (got "${state}")`);
      if (!ITEMS.test(osId)) problems.push(`${row}: State "step" needs one or more existing ids in OS id, separated by single spaces (got "${osId}")`);
      if (!STEP_FINDING.test(finding)) problems.push(`${row}: a step's Finding is the plan and the step, as in "#1-2.7" (got "${finding}")`);
    } else {
      if (!OS_ID.test(osId)) problems.push(`${row}: OS id "${osId}" is not an existing id (N123, R-slug, R12) or "new"`);
      const findingOk = FINDING.test(finding) || (record && STEP_FINDING.test(finding));
      if (finding ? !findingOk : isNew) problems.push(`${row}: Finding is "#" and digits, and is required when OS id is "new" (got "${finding}")`);
    }
    if (isStep && !record) problems.push(`${row}: State "step" is read only from ${RECORD_FILE}`);
    if (!isStep && !STATE.test(state)) {
      problems.push(`${row}: State "${state}" is not one of fixed, open, same as <id>, not the same as <id>, by design, accepted, waiting on <id>, after launch (an <id> is one N or R id)`);
    }
    if (pullRequests && !PULL_REQUESTS.test(pullRequests)) problems.push(`${row}: Pull request is blank, "#N", or several separated by commas (got "${pullRequests}")`);
    if (forWhom ? !FOR.has(forWhom) : isNew) problems.push(`${row}: For is one of engineer, you, counsel, decide, and is required when OS id is "new" (got "${forWhom}")`);
    if (isNew && !note) problems.push(`${row}: Note is the one-line title of a "new" item and cannot be blank`);
    if (FINDING.test(finding) || (record && STEP_FINDING.test(finding))) {
      if (findings.has(finding)) problems.push(`${row}: Finding ${finding} is already on row ${findings.get(finding)}`);
      else findings.set(finding, offset + 1);
    }
  }
  // The record has no findings written up in prose: its rows are the plans' steps.
  if (record) return problems;

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

/** The record: no prose entries, rows that are steps or new items. */
const recordWith = (rows: string[]) => ["# Remediation record", "", HEADING, "", "One table for both plans.", "", HEADER, "|---|---|---|---|---|---|", ...rows, ""].join("\n");
const STEP = "| N940 N1062 | #1-2.7 | step | #210, #237 | engineer | Photo signing rules |";
const inRecord = (...rows: string[]) => osTableProblems(recordWith(rows), RECORD_FILE);

describe("the record's table: both remediation plans, step by step (plan 1 step 4.8)", () => {
  it("accepts steps, one id or several, and new items keyed by plan and step, with no prose to match", () => {
    expect(
      inRecord(
        STEP,
        "| N718 | #1-2.8 | step | #199 | engineer | 1,000-row limits |",
        "| N1048 N1051 N1052 N1053 | #1-3.1 | step |  |  |  |",
        "| new | #1-AL1 | after launch |  | engineer | The ledger reads every unpaid sale |",
        "| new | #1-H2 | open |  | you | Measure image latency once staging is hosted |",
        "| new | #2-A6 | fixed | #240 | engineer | One baseline |",
      ),
    ).toEqual([]);
  });

  it("refuses a step that names no existing id, or names them any way but single spaces", () => {
    for (const ids of ["new", "", "N940, N1062", "N940  N1062", "N940 new", "n940 N1062", "#210"]) {
      expect(inRecord(`| ${ids} | #1-2.7 | step | #210 | engineer | Title |`).some((p) => p.includes("needs one or more existing ids")), `"${ids}"`).toBe(true);
    }
  });

  it("refuses a step whose Finding is not a plan and a step", () => {
    for (const finding of ["#131", "", "1-2.7", "#1", "#12-2.7", "#1-2.7.", "#1-", "#1 2.7", "step 2.7"]) {
      expect(inRecord(`| N940 N1062 | ${finding} | step | #210 | engineer | Title |`).some((p) => p.includes("a step's Finding is the plan and the step")), `"${finding}"`).toBe(true);
    }
  });

  it("refuses several ids in one cell unless the row is a step", () => {
    for (const state of ["open", "fixed", "after launch", "same as N940"]) {
      expect(inRecord(`| N940 N1062 | #1-2.7 | ${state} | #210 | engineer | Title |`), state).toEqual([expect.stringContaining('more than one id is allowed only with State "step"')]);
    }
  });

  it("keeps a report's rules for a new row, and for the same step written twice", () => {
    expect(inRecord("| new | #1-AL1 | after launch |  |  | Title |").some((p) => p.includes("For is one of"))).toBe(true);
    expect(inRecord("| new |  | open |  | you | Title |").some((p) => p.includes("Finding is"))).toBe(true);
    expect(inRecord("| new | AL1 | open |  | you | Title |").some((p) => p.includes("Finding is"))).toBe(true);
    expect(inRecord("| new | #1-AL1 | open |  | you |  |").some((p) => p.includes("Note is the one-line title"))).toBe(true);
    expect(inRecord("| new | #1-AL1 | done |  | you | Title |").some((p) => p.includes("State"))).toBe(true);
    expect(inRecord(STEP, STEP).some((p) => p.includes("Finding #1-2.7 is already on row 1"))).toBe(true);
  });

  it("reads a step, or a plan-and-step Finding, from the record only", () => {
    expect(osTableProblems(good([STEP, ...ROWS]), FILE).some((p) => p.includes(`State "step" is read only from ${RECORD_FILE}`))).toBe(true);
    expect(withRow("| new | #1-2.7 | open |  | engineer | Title |").some((p) => p.includes("Finding is"))).toBe(true);
    // Any other file under docs/plans/ is still not one the OS reads.
    expect(osTableProblems(recordWith([STEP]), "docs/plans/another-record.md").some((p) => p.includes("reads this table only from"))).toBe(true);
  });

  it("the record on this branch has one row for every step of plan 1", () => {
    const text = fs.readFileSync(path.join(root, RECORD_FILE), "utf8");
    expect(osTableProblems(text, RECORD_FILE)).toEqual([]);
    const findings = new Set([...text.matchAll(/^\|[^|]*\| (#\d-[A-Za-z0-9.]+) \|/gm)].map((m) => m[1]));
    const steps = ["1", "2.1", "2.2", "2.3", "2.4", "2.5", "2.6", "2.7", "2.8", "2.9", "2.10", "2.11", "2.12", "2.13", "3.1", "3.2", "3.3", "3.4", "4.8"];
    expect(steps.filter((step) => !findings.has(`#1-${step}`))).toEqual([]);
  });

  it("the record on this branch has one row for every item of plan 2, Part A", () => {
    const text = fs.readFileSync(path.join(root, RECORD_FILE), "utf8");
    expect(osTableProblems(text, RECORD_FILE)).toEqual([]);
    const findings = new Set([...text.matchAll(/^\|[^|]*\| (#\d-[A-Za-z0-9.]+) \|/gm)].map((m) => m[1]));
    const items = ["A0", "A0b", "A1", "A2", "A3", "A4", "A5", "A6"];
    expect(items.filter((item) => !findings.has(`#2-${item}`))).toEqual([]);
  });

  it("N718: plan 1 step 2.8 is in the record as a step that names it, so the OS reads its progress from one row", () => {
    const text = fs.readFileSync(path.join(root, RECORD_FILE), "utf8");
    const row = text.split("\n").find((line) => /^\|[^|]*\| #1-2\.8 \|/.test(line));
    expect(row, "no row for #1-2.8").toBeDefined();
    const [osId, finding, state, pullRequests] = row!.split("|").slice(1).map((cell) => cell.trim());
    expect(osId.split(" ")).toContain("N718");
    expect([finding, state]).toEqual(["#1-2.8", "step"]);
    expect(pullRequests).toContain("#199");
  });
});
