import { describe, expect, it } from "vitest";

import { UNADVERTISED_TOOLS, modelToolNames, modelToolsFor } from "@/lib/capabilities/registry";

import { ALL_STARTERS, CHAT_SCOPE, startersFor } from "./starters";

/**
 * N170 (OS-W07): the chat's starters come from the tools the agent has. A
 * starter that leans on a tool the model isn't handed is never shown, and no
 * starter promises fitment, sale prices or task status.
 */
describe("chat starters", () => {
  it("every starter needs only tools the chat's model is really handed", () => {
    const handed = new Set(modelToolsFor(CHAT_SCOPE).map((tool) => tool.name));
    for (const starter of ALL_STARTERS) {
      for (const name of starter.needs) {
        expect(handed.has(name), `"${starter.text}" needs ${name}`).toBe(true);
        expect(UNADVERTISED_TOOLS.has(name)).toBe(false);
      }
    }
  });

  it("shows only starters whose tools are enabled, in every place the chat opens from", () => {
    const openers = [null, { kind: "car" as const, mine: true }, { kind: "listing" as const, mine: true }, { kind: "listing" as const, mine: false }];
    for (const jobs of [false, true]) {
      const enabled = new Set(modelToolNames(CHAT_SCOPE, jobs));
      for (const about of openers) {
        const shown = startersFor(about, jobs);
        expect(shown.length, `no starters for ${JSON.stringify(about)} jobs=${jobs}`).toBeGreaterThan(0);
        for (const text of shown) {
          const starter = ALL_STARTERS.find((candidate) => candidate.text === text)!;
          expect(starter.needs.every((name) => enabled.has(name))).toBe(true);
        }
      }
    }
  });

  it("drops a starter when its tool is switched off, and the jobs starters until that step opens", () => {
    expect(startersFor(null, false)).not.toContain("Paste my build");
    expect(startersFor(null, true)).toContain("Paste my build");
    const withoutSearch = modelToolNames(CHAT_SCOPE, false).filter((name) => name !== "search_parts");
    expect(startersFor(null, false, withoutSearch)).not.toContain("Find parts for my car");
    expect(startersFor(null, false, withoutSearch)).toContain("Update my build");
  });

  it("promises nothing the agent can't do: no fitment, sale prices or task status", () => {
    const every = new Set(ALL_STARTERS.map((starter) => starter.text));
    for (const dead of ["Will this fit my car?", "What do parts like this sell for?", "What's my agent doing?", "How is this listing doing?"]) expect(every.has(dead)).toBe(false);
  });
});
