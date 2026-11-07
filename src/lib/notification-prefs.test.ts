import { describe, expect, it } from "vitest";

import { NOTIFICATION_PREFS, kindIsShown, mutedKindFilter, prefEnabled, prefKeyForKind } from "./notification-prefs";
import { NOTIFICATION_KINDS } from "./notifications/kinds";

/** Splits a PostgREST logic list on its top-level commas. */
function split(list: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < list.length; i++) {
    if (list[i] === "(") depth++;
    else if (list[i] === ")") depth--;
    else if (list[i] === "," && depth === 0) {
      out.push(list.slice(start, i));
      start = i + 1;
    }
  }
  out.push(list.slice(start));
  return out;
}

/** Evaluates the subset of PostgREST logic grammar mutedKindFilter emits. */
function holds(kind: string, term: string): boolean {
  const group = term.match(/^(and|or)\((.*)\)$/);
  if (group) {
    const parts = split(group[2]).map((part) => holds(kind, part));
    return group[1] === "and" ? parts.every(Boolean) : parts.some(Boolean);
  }
  const notIn = term.match(/^kind\.not\.in\.\((.*)\)$/);
  if (notIn) return !notIn[1].split(",").includes(kind);
  const isIn = term.match(/^kind\.in\.\((.*)\)$/);
  if (isIn) return isIn[1].split(",").includes(kind);
  const notLike = term.match(/^kind\.not\.like\.(.*)\*$/);
  if (notLike) return !kind.startsWith(notLike[1]);
  throw new Error(`unexpected term ${term}`);
}

/** Preferences for a channel other than in-app, governing no in-app kind. */
const EMAIL_ONLY = new Set(["saved_search_emails"]);

const KINDS = [...NOTIFICATION_KINDS.map((k) => k.kind), "order_refunded", "offer_expired", "brand_new_kind"];

describe("mutedKindFilter", () => {
  it("filters nothing when nothing is muted", () => {
    expect(mutedKindFilter(null)).toBeNull();
    expect(mutedKindFilter({ comments: true })).toBeNull();
  });

  // Every single mute and a few combinations must agree with kindIsShown,
  // the in-memory rule the bell badge still uses.
  const combos: Record<string, boolean>[] = [
    ...NOTIFICATION_PREFS.map((p) => ({ [p.key]: false })),
    { offers_sales: false, order_updates: false },
    { comments: false, order_updates: false },
    Object.fromEntries(NOTIFICATION_PREFS.map((p) => [p.key, false])),
  ];
  for (const prefs of combos) {
    it(`agrees with kindIsShown for ${JSON.stringify(prefs)}`, () => {
      const filter = mutedKindFilter(prefs);
      // Only a channel preference that governs no in-app kind filters nothing.
      expect(filter === null).toBe(Object.keys(prefs).every((key) => EMAIL_ONLY.has(key)));
      for (const kind of KINDS) {
        // `.or(filter)` sends `or=(filter)`.
        const shown = filter === null ? true : holds(kind, `or(${filter})`);
        expect([kind, shown]).toEqual([kind, kindIsShown(prefs, kind)]);
      }
    });
  }
});

describe("saved-search emails (N78)", () => {
  it("is on unless exactly false, like every preference and like the digest admission's SQL", () => {
    expect(prefEnabled(null, "saved_search_emails")).toBe(true);
    expect(prefEnabled({}, "saved_search_emails")).toBe(true);
    expect(prefEnabled({ saved_search_emails: true }, "saved_search_emails")).toBe(true);
    expect(prefEnabled({ saved_search_emails: "false" }, "saved_search_emails")).toBe(true);
    expect(prefEnabled({ saved_search_emails: false }, "saved_search_emails")).toBe(false);
  });

  it("turning the emails off leaves every in-app notification shown", () => {
    expect(mutedKindFilter({ saved_search_emails: false })).toBeNull();
    for (const kind of KINDS) expect([kind, kindIsShown({ saved_search_emails: false }, kind)]).toEqual([kind, true]);
  });

  it("is a toggle on the settings page, beside the in-app saved-search one", () => {
    const keys = NOTIFICATION_PREFS.filter((p) => p.group === "Marketplace").map((p) => p.key);
    expect(keys.indexOf("saved_search_emails")).toBe(keys.indexOf("saved_searches") + 1);
    expect(prefKeyForKind("saved_search")).toBe("saved_searches");
  });
});
