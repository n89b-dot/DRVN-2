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
