// OS-signals: supabase/MIGRATIONS.md is the human record of where each
// migration is applied, and the Intelligence OS reads it, so every migration
// file has a row and every new "Applied to" cell uses a closed vocabulary
// (docs/ids.md, "Migrations"):
//
//   not applied | shared-dev YYYY-MM-DD | staging YYYY-MM-DD | production YYYY-MM-DD
//
// with several places joined by "; ". A ratchet: supabase/migrations-md-baseline.json
// lists the files that had no row when this check arrived and the prose cells
// that were already there. Those stay allowed until they change; the list may
// only shrink. Rebuild it only as a reviewed exception:
// UPDATE_MIGRATIONS_BASELINE=1 npx vitest run tests/ci/migrations-md.test.ts
import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "../..");
const MIGRATIONS_MD = path.join(root, "supabase/MIGRATIONS.md");
const MIGRATIONS_DIR = path.join(root, "supabase/migrations");
const BASELINE = path.join(root, "supabase/migrations-md-baseline.json");

type Baseline = { unrecorded: string[]; cells: Record<string, string[]> };

const PLACE = "(?:shared-dev|staging|production) \\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\\d|3[01])";
const VOCABULARY = new RegExp(`^(?:not applied|${PLACE}(?:; ${PLACE})*)$`);

export const isVocabulary = (cell: string) => VOCABULARY.test(cell);

/** Every table row whose first cell is a migration file: file → its "Applied to" cells (or the row's other cells). */
export function recordedCells(markdown: string): Map<string, string[]> {
  const rows = new Map<string, string[]>();
  let header: string[] | null = null;
  for (const line of markdown.split("\n")) {
    if (!line.startsWith("|")) {
      header = null;
      continue;
    }
    const cells = line.replace(/^\|/, "").replace(/\|\s*$/, "").split("|").map((c) => c.trim());
    if (!header) {
      header = cells;
      continue;
    }
    const file = cells[0].match(/^`([^`]+\.sql)`$/)?.[1];
    if (!file) continue;
    const appliedAt = header.findIndex((h) => /^applied to$/i.test(h));
    const cell = appliedAt > 0 ? (cells[appliedAt] ?? "") : cells.slice(1).join(" | ");
    rows.set(file, [...(rows.get(file) ?? []), cell]);
  }
  return rows;
}

const migrationFiles = () => fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();

function currentBaseline(): Baseline {
  const rows = recordedCells(fs.readFileSync(MIGRATIONS_MD, "utf8"));
  const cells: Record<string, string[]> = {};
  for (const [file, list] of [...rows].sort(([a], [b]) => a.localeCompare(b))) {
    const prose = list.filter((c) => !isVocabulary(c));
    if (prose.length) cells[file] = prose;
  }
  return { unrecorded: migrationFiles().filter((f) => !rows.has(f)), cells };
}

if (process.env.UPDATE_MIGRATIONS_BASELINE) {
  fs.writeFileSync(BASELINE, `${JSON.stringify(currentBaseline(), null, 2)}\n`);
}

describe("MIGRATIONS.md vocabulary (OS-signals)", () => {
  it.each(["not applied", "shared-dev 2026-11-08", "staging 2026-11-07; shared-dev 2026-11-08", "production 2026-12-01"])(
    "accepts %s",
    (cell) => expect(isVocabulary(cell)).toBe(true),
  );
  it.each(["—", "", "shared dev project (2026-10-19)", "shared-dev", "staging 2026-13-01", "not applied; staging 2026-11-07", "shared-dev 2026-11-08;staging 2026-11-08"])(
    "refuses %j",
    (cell) => expect(isVocabulary(cell)).toBe(false),
  );

  it("reads Applied to cells, and the other cells of tables without one", () => {
    const md = [
      "| File | Applied to |",
      "|---|---|",
      "| `2026_a.sql` | not applied |",
      "",
      "| File | Merged in | Shared dev, by probe |",
      "|---|---|---|",
      "| `2026_b.sql` | #64 | present |",
    ].join("\n");
    expect([...recordedCells(md)]).toEqual([
      ["2026_a.sql", ["not applied"]],
      ["2026_b.sql", ["#64 | present"]],
    ]);
  });
});

describe("supabase/MIGRATIONS.md records every migration (OS-signals)", () => {
  const baseline = JSON.parse(fs.readFileSync(BASELINE, "utf8")) as Baseline;
  const rows = recordedCells(fs.readFileSync(MIGRATIONS_MD, "utf8"));

  it("every file in supabase/migrations/ has a row, apart from the baseline's old gaps", () => {
    const missing = migrationFiles().filter((f) => !rows.has(f) && !baseline.unrecorded.includes(f));
    expect(
      missing,
      'Add a row for each new migration under its own "## <date> — <what>" heading in supabase/MIGRATIONS.md: | `<file>` | not applied |',
    ).toEqual([]);
  });

  it("every Applied to cell is in the vocabulary, or is prose the baseline already held", () => {
    const bad: string[] = [];
    for (const [file, cells] of rows) {
      for (const cell of cells) {
        if (!isVocabulary(cell) && !(baseline.cells[file] ?? []).includes(cell)) bad.push(`${file}: "${cell}"`);
      }
    }
    expect(bad, "Write the Applied to cell as: not applied | shared-dev YYYY-MM-DD | staging YYYY-MM-DD | production YYYY-MM-DD (join several with \"; \")").toEqual([]);
  });

  it("the baseline only shrinks: no listed gap has since been filled, no listed file is gone", () => {
    const stale = baseline.unrecorded.filter((f) => rows.has(f) || !fs.existsSync(path.join(MIGRATIONS_DIR, f)));
    expect(stale, "Remove these from supabase/migrations-md-baseline.json \"unrecorded\": they now have a row or no file").toEqual([]);
  });
});

const PENDING = path.join(root, "supabase/migrations-staging-pending.json");
const TWO_DAYS = 2 * 24 * 60 * 60 * 1000;

/** A dated migration's timestamp as UTC milliseconds, or null for the four-digit baseline files. */
export function fileTime(file: string): number | null {
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})_/.exec(file);
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) : null;
}

/** Files whose vocabulary cells never name staging, though the file is two days old or more and not listed as pending. */
export function behindStaging(rows: Map<string, string[]>, pending: Record<string, string>, now: number): string[] {
  const late: string[] = [];
  for (const [file, cells] of rows) {
    const vocabulary = cells.filter(isVocabulary);
    if (!vocabulary.length || vocabulary.some((c) => /(^|; )staging /.test(c))) continue;
    const at = fileTime(file);
    if (at === null || now - at < TWO_DAYS || pending[file]) continue;
    late.push(`${file}: "${vocabulary.join(" / ")}"`);
  }
  return late.sort();
}

describe("staging stays level with shared dev (R-staging-behind)", () => {
  const now = Date.UTC(2026, 10, 10, 12);

  it("R-staging-behind: a row without staging is allowed for two days, then fails unless listed as pending", () => {
    const rows = new Map([
      ["20261108100000_a.sql", ["shared-dev 2026-11-08"]],
      ["20261109140000_b.sql", ["shared-dev 2026-11-09"]],
      ["20261107140000_c.sql", ["not applied"]],
      ["20261107150000_d.sql", ["shared-dev 2026-11-07; staging 2026-11-07"]],
      ["20261101000000_e.sql", ["shared dev project (2026-11-01)"]],
      ["0040_f.sql", ["shared-dev 2026-09-01"]],
      ["20261106000000_g.sql", ["shared-dev 2026-11-06"]],
    ]);
    expect(behindStaging(rows, { "20261106000000_g.sql": "staging credential unavailable" }, now)).toEqual([
      '20261107140000_c.sql: "not applied"',
      '20261108100000_a.sql: "shared-dev 2026-11-08"',
    ]);
  });

  it("R-staging-behind: every migration two days old or more is recorded on staging, or listed as pending with a reason", () => {
    const rows = recordedCells(fs.readFileSync(MIGRATIONS_MD, "utf8"));
    const pending = (JSON.parse(fs.readFileSync(PENDING, "utf8")) as { pending: Record<string, string> }).pending;
    for (const [file, reason] of Object.entries(pending)) {
      expect(fs.existsSync(path.join(MIGRATIONS_DIR, file)), `${file} is listed as pending but has no file`).toBe(true);
      expect(reason.trim().length, `${file} needs a reason`).toBeGreaterThan(0);
    }
    expect(
      behindStaging(rows, pending, Date.now()),
      "Apply these to staging with the runner and add their staging cell (supabase/MIGRATIONS.md), or list them in supabase/migrations-staging-pending.json with the reason",
    ).toEqual([]);
  });
});

