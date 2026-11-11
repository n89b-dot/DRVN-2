import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { NOTIFICATION_KINDS, kindRegistryConsistent } from "./kinds";

describe("notification kinds registry", () => {
  it("has unique kinds", () => {
    const kinds = NOTIFICATION_KINDS.map((entry) => entry.kind);
    expect(new Set(kinds).size).toBe(kinds.length);
  });

  it("agrees with prefKeyForKind for every registered kind", () => {
    expect(kindRegistryConsistent()).toEqual([]);
  });
});

/**
 * Whose words a kind carries is decided in the database, in
 * private.notification_member_text (the account-deletion scrub reads it), and
 * a kind it does not know is scrubbed as a member's words. These tests hold
 * the app's side to that list (work review #153): the registry above, and
 * every kind the app's own code writes.
 */
const ROOT = resolve(__dirname, "..", "..", "..");

/** kind → class, from the function as the database holds it (supabase/schema/, plan 2 items A1 and A6). */
function classifiedKinds(): Map<string, string> {
  const body = readFileSync(join(ROOT, "supabase", "schema", "functions", "private.notification_member_text.sql"), "utf8");
  const kinds = new Map<string, string>();
  for (const match of body.matchAll(/when p_kind (?:in \(([^)]*)\)|= '([a-z_]+)') then '([a-z_]+)'/g)) {
    for (const kind of (match[1] ?? `'${match[2]}'`).matchAll(/'([a-z_]+)'/g)) kinds.set(kind[1], match[3]);
  }
  return kinds;
}

function sources(dir: string, out: string[] = []): string[] {
  for (const item of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, item.name);
    if (item.isDirectory()) sources(full, out);
    else if (/\.tsx?$/.test(item.name) && !/\.test\.tsx?$/.test(item.name)) out.push(full);
  }
  return out;
}

/** Kinds written by `deliverNotification({…})` or `.from("notifications").insert(…)`: every literal after `kind:` in the call. */
function appWrittenKinds(): Map<string, string> {
  const found = new Map<string, string>();
  for (const file of sources(join(ROOT, "src"))) {
    const text = readFileSync(file, "utf8");
    for (const call of text.matchAll(/deliverNotification\(\{|from\("notifications"\)\s*\.insert\(/g)) {
      const block = text.slice(call.index!, call.index! + 900);
      const line = /\bkind:\s*([^\n]*)/.exec(block);
      if (!line) continue;
      // A literal compared against (state === "suspended" ? … : …) is not a kind.
      const written = line[1].replace(/[!=]==?\s*"[a-z_]+"/g, "");
      for (const literal of written.matchAll(/"([a-z_]+)"/g)) found.set(literal[1], file.slice(ROOT.length + 1));
    }
  }
  return found;
}

describe("N1069: every notification kind says whose words it carries (work review #153)", () => {
  const classified = classifiedKinds();

  it("N1069: reads the database's classification", () => {
    expect(classified.size).toBeGreaterThan(40);
    expect(classified.get("comment")).toBe("actor");
    expect(classified.get("offer_declined")).toBe("listing_title");
    expect(classified.get("order_disputed")).toBe("order_reason");
    expect(classified.get("saved_search")).toBe("matched_titles");
    expect(classified.get("policy_updated")).toBe("none");
  });

  it("N1069: every kind in the registry is classified", () => {
    expect(NOTIFICATION_KINDS.map((entry) => entry.kind).filter((kind) => !classified.has(kind))).toEqual([]);
  });

  it("N1069: every kind the app writes is classified", () => {
    const written = appWrittenKinds();
    // The scan finds the writers it is meant to.
    for (const kind of ["offer_accepted", "refund_offered", "payout_sent", "account_suspended", "account_restored", "post_removed", "comment_removed", "saved_search", "password_changed"]) {
      expect(written.has(kind), kind).toBe(true);
    }
    expect([...written].filter(([kind]) => !classified.has(kind)).map(([kind, file]) => `${kind} (${file})`)).toEqual([]);
  });
});

