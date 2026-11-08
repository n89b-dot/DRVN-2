// The id forms the DRVN Intelligence OS reads, in one place, for the CI checks
// that make PRs, tests and guards name their work (docs/ids.md).
//
// TASK_ID is copied verbatim from the Intelligence OS repo,
// server/capture/types.ts (`export const TASK_ID = ...`), so the two can be
// diffed when either changes. Do not edit it here without changing it there.
export const TASK_ID = "OS-(?:PR\\d+|p1-commerce|W\\d+[a-z]?|R[A-Za-z0-9-]*[A-Za-z0-9])";

// Item ids: the OS's own N### (one scheme: the plan's N1–N250 are aliases the
// OS holds for its N4xx), report items R60–R87 with or without a slug
// (R69-age), slugged R items (R-staging, R-audit-composer), and the 3 Nov
// review's blockers B1–B9.
export const ITEM_ID = "(?:N\\d+|R\\d+(?:-[A-Za-z0-9]+)*|R-[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*|B\\d)";

/** Every id a PR title or a Resolves line may carry. */
export const ANY_ID = `(?:${TASK_ID}|${ITEM_ID})`;

/** An id standing alone: not part of a longer word or id (the OS's own boundaries). */
const bounded = (source: string, flags = "g") => new RegExp(`(?<![A-Za-z0-9-])${source}(?![A-Za-z0-9-])`, flags);

/** The ids named in a piece of text such as a PR title. */
export function idsIn(text: string): string[] {
  return [...new Set(text.match(bounded(ANY_ID)) ?? [])];
}

/** True when the whole token is one id. */
export function isId(token: string): boolean {
  return new RegExp(`^${ANY_ID}$`).test(token);
}

// The canonical forms a test or guard names (docs/ids.md, "Test names"):
// an item (N###, R-slug, R##) or a batch (OS-W##).
export const CANONICAL_TEST_ID = bounded("(?:N\\d+|R-[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*|R\\d+(?:-[A-Za-z0-9]+)*|OS-W\\d+[a-z]?)");

/**
 * The tokens of every "Resolves:" line, split exactly as the OS splits them
 * (server/capture/github.ts, resolvesLine): each line that starts with
 * "resolves:" in any case, then every run of letters, digits and hyphens.
 * Returns one entry per line so an empty line can be reported.
 */
export function resolvesLines(body: string): string[][] {
  return body
    .split("\n")
    .filter((line) => /^\s*resolves:/i.test(line))
    .map((line) => line.replace(/^\s*resolves:/i, "").match(/[A-Za-z0-9][A-Za-z0-9-]*/g) ?? []);
}
