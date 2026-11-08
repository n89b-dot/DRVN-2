import { describe, expect, it } from "vitest";

import { memberContext, modelContext, type AgentScope } from "@/lib/agent/context";
import { AGENT_MODES, agentModeAllowsChat, agentModeAllowsMandates } from "@/lib/agent/mode";
import { MODEL_TOOLS, modelToolsFor } from "@/lib/capabilities/registry";

import { agentStatusLine } from "./status-line";

const SCOPES: AgentScope[] = ["seller", "buyer", "garage"];

// AG-1 (docs/decisions/agent-foundations.md §1): one agent per member,
// covering selling, buying and the Garage. The scope is internal; the member
// sees one agent, with one setting and one status line.
describe("one agent per member (AG-1)", () => {
  it("acts for the same member in every scope — the scope never changes who it is", () => {
    for (const scope of SCOPES) {
      expect(memberContext("member-1", scope).principal).toEqual({ kind: "member", memberId: "member-1" });
      expect(modelContext("member-1", scope).principal).toEqual({ kind: "member", memberId: "member-1" });
    }
    expect(() => memberContext("", "garage")).toThrow();
  });

  it("covers selling, buying and the Garage, each with tools of its own", () => {
    expect(Object.keys(MODEL_TOOLS).sort()).toEqual([...SCOPES].sort());
    const names = (scope: AgentScope) => modelToolsFor(scope).map((tool) => tool.name);
    expect(names("seller")).toContain("price_comparables");
    expect(names("buyer")).toEqual(expect.arrayContaining(["search_parts", "browse_marketplace"]));
    expect(names("garage")).toEqual(expect.arrayContaining(["propose_build_change", "draft_car_update", "list_my_cars"]));
  });

  it("is switched by one member-level setting for all of it", () => {
    // Off stops the chat (garage and buying help) and every mandate (selling
    // and buying negotiations) together; there is no per-scope switch.
    expect(AGENT_MODES).toEqual(["off", "suggest", "act"]);
    expect([agentModeAllowsChat("off"), agentModeAllowsMandates("off")]).toEqual([false, false]);
    expect([agentModeAllowsChat("suggest"), agentModeAllowsMandates("suggest")]).toEqual([true, false]);
    expect([agentModeAllowsChat("act"), agentModeAllowsMandates("act")]).toEqual([true, true]);
  });

  it("reports selling and buying work on one status line", () => {
    expect(agentStatusLine({ handling: 2, buying: 1, needsYou: 1 })).toBe(
      "Handling offers on 2 listings · Negotiating 1 part for you · 1 needs you"
    );
    expect(agentStatusLine({ handling: 1, buying: 0, needsYou: 0 })).toBe("Handling offers on 1 listing");
    expect(agentStatusLine({ handling: 0, buying: 0, needsYou: 0 })).toBe("Nothing running yet");
  });
});
