import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { ADMIN_CAPABILITIES, capabilityFor, roleAllows } from "./capabilities";

describe("admin capabilities", () => {
  it("registers a family for every audit action used in actions.ts", () => {
    const source = readFileSync(join(__dirname, "actions.ts"), "utf8");
    // Static names: action: "order.force_refund". Dynamic: action: `report.${outcome}`.
    const staticNames = [...source.matchAll(/action: "([^"]+)"/g)].map((m) => m[1]);
    const dynamicPrefixes = [...source.matchAll(/action: `([a-z]+)\.\$\{/g)].map(
      (m) => `${m[1]}.x`,
    );
    const all = [...staticNames, ...dynamicPrefixes];
    expect(all.length).toBeGreaterThan(5);
    for (const action of all) {
      expect(capabilityFor(action), `no capability family covers "${action}"`).not.toBeNull();
    }
  });

  it("viewers can perform no registered mutation today", () => {
    for (const capability of ADMIN_CAPABILITIES) {
      expect(roleAllows("viewer", `${capability.family}anything`)).toBe(
        capability.requires === "viewer",
      );
      expect(roleAllows("admin", `${capability.family}anything`)).toBe(true);
    }
  });

  it("unregistered action families never pass", () => {
    expect(capabilityFor("mystery.action")).toBeNull();
    expect(roleAllows("admin", "mystery.action")).toBe(false);
  });
});
