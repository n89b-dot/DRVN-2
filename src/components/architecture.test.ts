import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Governance: route folders may not import UI/domain code from *other* route
 * folders. A component two routes need is shared — it belongs in
 * `src/components/ui` (primitive), `src/components/commerce` (domain), or
 * `src/features/*` — not in whichever route happened to build it first.
 * (The historical example: Offers importing StatusChip from an Orders file.)
 *
 * A file's "route unit" is its route group plus first path segment, e.g.
 * `(product)/orders`. Importing within your own unit, from `_components`
 * folders of your own group, or from outside `src/app` is always fine.
 */

const ROOT = resolve(__dirname, "..", "..");
const APP = join(ROOT, "src", "app");

/** Deliberate exceptions — each is a conscious feature-family share, not drift. */
const ALLOWED: { from: string; to: string; why: string }[] = [
  {
    from: "(product)/listings",
    to: "(product)/sell",
    why: "Edit Listing IS the Sell workflow re-entered — SellForm is one feature with two entry routes.",
  },
  {
    from: "(product)/orders",
    to: "(discover)/checkout",
    why: "Order checkout re-enters the same CheckoutSteps workflow the cart uses.",
  },
  {
    from: "(discover)/checkout",
    to: "(discover)/cart",
    why: "PaymentConfirm bridges the two halves of one purchase flow.",
  },
  {
    from: "(product)/settings",
    to: "(auth)",
    why: "Sign-out lives with the auth actions.",
  },
  {
    from: "(admin)",
    to: "(auth)",
    why: "Admin layout signs out via the auth actions.",
  },
  {
    from: "(product)/settings",
    to: "(product)/garage",
    why: "Profile/account server actions currently live in garage/actions.ts (actions, not UI).",
  },
  {
    from: "(product)/profile",
    to: "(product)/garage",
    why: "Same account-actions module as settings.",
  },
  {
    from: "(product)/listings",
    to: "(product)/garage",
    why: "Garage mods editor and listings share sell/garage server actions.",
  },
  {
    from: "(product)/garage",
    to: "(product)/sell",
    why: "Mods editor lists parts through the sell actions.",
  },
];

function walk(dir: string, out: string[] = []): string[] {
  for (const item of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, item.name);
    if (item.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(item.name)) out.push(full);
  }
  return out;
}

/** `(group)/segment` for a file under src/app, or null outside it. */
function routeUnit(absPath: string): string | null {
  const rel = relative(APP, absPath);
  if (rel.startsWith("..")) return null;
  const parts = rel.split(sep);
  if (!parts[0]?.startsWith("(")) return parts[0] ?? null; // api/, root files
  // Files directly in the group root (layout, error) and any `_components`
  // folder belong to the group as a whole.
  if (parts.length <= 2 || parts.some((p) => p.startsWith("_"))) return parts[0];
  return `${parts[0]}/${parts[1]}`;
}

function importTargets(file: string): string[] {
  const src = readFileSync(file, "utf8");
  return [...src.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]);
}

describe("route-boundary imports", () => {
  it("routes only import other routes' code through the allowlist", () => {
    const violations: string[] = [];
    for (const file of walk(APP)) {
      const fromUnit = routeUnit(file);
      if (!fromUnit) continue;
      for (const spec of importTargets(file)) {
        let target: string | null = null;
        if (spec.startsWith(".")) target = resolve(join(file, ".."), spec);
        else if (spec.startsWith("@/app/")) target = join(ROOT, "src", "app", spec.slice(6));
        if (!target) continue;
        const toUnit = routeUnit(target);
        if (!toUnit || toUnit === fromUnit) continue;
        // Same group root (e.g. shared (auth) forms, group layout/_components).
        const fromGroup: string = fromUnit.split("/")[0];
        if (toUnit === fromGroup) continue;
        // A group-root file (layout/error) composing its own group's routes.
        if (fromUnit === toUnit.split("/")[0]) continue;
        const allowed = ALLOWED.some(
          (rule) => fromUnit.startsWith(rule.from) && toUnit.startsWith(rule.to),
        );
        if (!allowed) {
          violations.push(
            `${relative(ROOT, file)} imports "${spec}" (${fromUnit} → ${toUnit})`,
          );
        }
      }
    }
    expect(
      violations,
      "Cross-route import. Move the shared piece to src/components/ui, src/components/commerce or src/features — or add a justified ALLOWED entry.",
    ).toEqual([]);
  });
});
