/**
 * Query classification for the two search lanes (brief §B2):
 *
 *   Human discovery — "mk8 intake", "bilstein b16", "golf r downpipe" —
 *   fuzzy matching helps.
 *
 *   Identifier discovery — "11427566327", "11-42-7-566-327", "CP9660-2S4" —
 *   an exact-substring match on the separator-stripped form. NEVER
 *   fuzzy-corrected: a typo in a part number must not "helpfully" match a
 *   different part.
 *
 * Pure and unit-tested; both the Postgres and engine providers share it.
 */

export type QueryClass = {
  kind: "identifier" | "human";
  /** Lowercased, separator-stripped form — the part_number_compact shape. */
  compact: string;
  /** The cleaned display/search term. */
  term: string;
};

export function compactForm(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function classifyQuery(raw: string): QueryClass {
  const term = raw.replace(/[,()]/g, " ").trim();
  const compact = compactForm(term);
  const singleToken = !/\s/.test(term);
  const digits = (compact.match(/[0-9]/g) ?? []).length;
  // One token, mostly alphanumeric with real digit content → an identifier.
  // "b16" (short) and "mk8 intake" (multi-word) stay human.
  const kind = singleToken && compact.length >= 5 && digits >= 2 ? "identifier" : "human";
  return { kind, compact, term };
}
