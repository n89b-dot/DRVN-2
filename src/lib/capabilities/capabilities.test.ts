import { describe, expect, it } from "vitest";

import { memberContext, modelContext } from "@/lib/agent/context";

import { offerMoveKey } from "./negotiation";
import { fitmentEvidence, priceComparables, readProduct, searchParts } from "./reads";
import { CAPABILITIES, MODEL_TOOLS, modelToolsFor } from "./registry";
import { CapabilityError, invokeCapability, type MemberClient } from "./types";

const noClient = {} as MemberClient;
const member = "22222222-2222-4222-8222-222222222222";

describe("capabilities", () => {
  it("every capability is uniquely named and every allow-listed tool exists", () => {
    const names = CAPABILITIES.map((capability) => capability.name);
    expect(new Set(names).size).toBe(names.length);
    for (const list of Object.values(MODEL_TOOLS)) for (const name of list) expect(names).toContain(name);
  });

  it("refuses a capability outside its scope or above the context's risk", async () => {
    const moveOffer = CAPABILITIES.find((capability) => capability.name === "move_offer")!;
    await expect(invokeCapability(moveOffer, { context: modelContext(member, "seller"), supabase: noClient }, {})).rejects.toMatchObject({ code: "not_allowed" });
    await expect(invokeCapability(priceComparables, { context: memberContext(member, "garage"), supabase: noClient }, {})).rejects.toBeInstanceOf(CapabilityError);
  });

  it("validates input before running anything", async () => {
    await expect(invokeCapability(searchParts, { context: memberContext(member, "buyer"), supabase: noClient }, { query: "" })).rejects.toMatchObject({ code: "invalid_input" });
  });

  it("the graph-backed reads say there isn't enough evidence until B1", async () => {
    const run = { context: memberContext(member, "buyer"), supabase: noClient };
    await expect(invokeCapability(readProduct, run, { partNumber: "06K145722T" })).resolves.toMatchObject({ status: "not_enough_evidence" });
    await expect(invokeCapability(fitmentEvidence, run, {})).resolves.toMatchObject({ status: "not_enough_evidence", evidence: [] });
    await expect(invokeCapability(priceComparables, run, {})).resolves.toMatchObject({ status: "not_enough_sales", medianCents: null });
  });

  it("the model's tools are the allow-list, filtered to R1", () => {
    expect(modelToolsFor("buyer").map((tool) => tool.name)).toEqual(MODEL_TOOLS.buyer);
  });

  it("the agent and the member build the same move key", () => {
    expect(offerMoveKey({ offerId: "o", kind: "counter", round: 3, amountCents: 86000 })).toBe("counter:o:r3:86000");
    expect(offerMoveKey({ offerId: "o", kind: "accept", round: 4 })).toBe("accept:o:r4:0");
  });
});
