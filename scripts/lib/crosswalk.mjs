// Reads docs/plans/2026-11-readiness-crosswalk.md into data the Intelligence
// OS can join on without parsing prose: one record per OS item row.
// scripts/crosswalk-json.mjs writes it to docs/plans/2026-11-readiness-crosswalk.json;
// tests/ci/crosswalk-json.test.ts fails when that file is stale.

const BATCH = /(?<![A-Za-z0-9-])OS-(?:PR\d+|p1-commerce|W\d+[a-z]?|R[A-Za-z0-9-]*[A-Za-z0-9])(?![A-Za-z0-9-])/g;
const PLAN_ID = /(?<![A-Za-z0-9-])(?:N\d+|R\d+(?:-[A-Za-z0-9]+)*|R-[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*)(?![A-Za-z0-9-])/g;
const EMPTY = /^(—|-|)$/;

/** Splits a markdown table row into trimmed cells, keeping pipes inside backticks. */
function cells(line) {
  const out = [];
  let cell = "";
  let code = false;
  for (const ch of line.trim().replace(/^\|/, "").replace(/\|$/, "")) {
    if (ch === "`") code = !code;
    if (ch === "|" && !code) {
      out.push(cell.trim());
      cell = "";
    } else cell += ch;
  }
  out.push(cell.trim());
  return out;
}

/** Plan ids (N1–N250, R##, R-slug) named outside parentheses; batch ids anywhere. */
function planCell(text) {
  const inferred = /\(inferred\)/.test(text);
  const outside = text.replace(/\*?\([^)]*\)\*?/g, " ");
  return {
    plan_ids: [...new Set(outside.match(PLAN_ID) ?? [])],
    batches: [...new Set(text.match(BATCH) ?? [])],
    inferred,
  };
}

/** "#86 / 23f725c; #91, open" → [{number: 86, merge_sha: "23f725c", merged: true}, {number: 91, merge_sha: null, merged: false}] */
function prCell(text) {
  if (EMPTY.test(text)) return [];
  return text
    .split(";")
    .map((part) => {
      const number = part.match(/#(\d+)/);
      const sha = part.match(/\/\s*([0-9a-f]{7,40})\b/);
      return number ? { number: Number(number[1]), merge_sha: sha ? sha[1] : null, merged: Boolean(sha) } : null;
    })
    .filter(Boolean);
}

/**
 * Backtick spans are tests ("file › describe › test") or SQL guard files;
 * a double-quoted string after a guard is that guard's check text. A span
 * that starts with "…" continues the previous test's file, and, when it is
 * shorter, its leading describe blocks.
 */
function testsCell(text) {
  if (EMPTY.test(text)) return [];
  const tests = [];
  let guard = null;
  let previous = null;
  for (const m of text.matchAll(/`([^`]+)`|"([^"]+)"/g)) {
    if (m[2] !== undefined) {
      if (guard) tests.push({ file: guard, name: m[2] });
      continue;
    }
    const span = m[1].trim();
    const parts = span.split(" › ").map((p) => p.trim());
    if (/\.sql$/.test(span)) {
      if (guard && !tests.some((t) => t.file === guard)) tests.push({ file: guard, name: null });
      guard = span;
      continue;
    }
    if (guard && !tests.some((t) => t.file === guard)) tests.push({ file: guard, name: null });
    guard = null;
    let file;
    let name;
    if (parts[0] === "…" && previous) {
      const rest = parts.slice(1);
      const lead = previous.segments.slice(0, Math.max(0, previous.segments.length - rest.length));
      file = previous.file;
      name = [...lead, ...rest];
    } else {
      file = parts[0];
      name = parts.slice(1);
    }
    previous = { file, segments: name };
    tests.push({ file, name: name.length ? name.join(" › ") : null });
  }
  if (guard && !tests.some((t) => t.file === guard)) tests.push({ file: guard, name: null });
  return tests;
}

export function parseCrosswalk(markdown) {
  const rows = [];
  let section = null;
  let inTable = false;
  for (const line of markdown.split("\n")) {
    const heading = line.match(/^##\s+(.+?)\s*$/);
    if (heading) {
      section = heading[1];
      inTable = false;
      continue;
    }
    if (!line.startsWith("|")) {
      inTable = false;
      continue;
    }
    const c = cells(line);
    if (c[0] === "Item" && c.length === 6) {
      inTable = true;
      continue;
    }
    if (!inTable || /^-+$/.test(c[0].replace(/[:\s]/g, "")) || c.length !== 6) continue;
    const [osId, title, status, plan, pr, proving] = c;
    const p = planCell(plan);
    const prs = prCell(pr);
    const first = prs.find((x) => x.merged) ?? prs[0] ?? null;
    rows.push({
      os_id: osId,
      title,
      status,
      plan_ids: p.plan_ids,
      batch: p.batches[0] ?? null,
      batches: p.batches,
      pr: first ? first.number : null,
      merge_sha: first ? first.merge_sha : null,
      prs,
      proving_tests: testsCell(proving),
      inferred: p.inferred,
      section,
    });
  }
  return rows;
}

export const CROSSWALK_MD = "docs/plans/2026-11-readiness-crosswalk.md";
export const CROSSWALK_JSON = "docs/plans/2026-11-readiness-crosswalk.json";

/** The JSON file's exact text (an array of items), so the sync test compares bytes. */
export function crosswalkJson(markdown) {
  return `${JSON.stringify(parseCrosswalk(markdown), null, 2)}\n`;
}
