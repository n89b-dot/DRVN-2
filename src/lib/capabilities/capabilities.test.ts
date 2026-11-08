import { describe, expect, it } from "vitest";

import { memberContext, modelContext } from "@/lib/agent/context";

import { offerMoveKey } from "./negotiation";
import { fitmentEvidence, priceComparables, readProduct, searchParts } from "./reads";
import { CAPABILITIES, JOB_TOOLS, MODEL_TOOLS, UNADVERTISED_TOOLS, modelToolNames, modelToolsFor } from "./registry";
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

  it("the graph-backed reads still say there isn't enough evidence", async () => {
    const run = { context: memberContext(member, "buyer"), supabase: noClient };
    await expect(invokeCapability(readProduct, run, { partNumber: "06K145722T" })).resolves.toMatchObject({ status: "not_enough_evidence" });
    await expect(invokeCapability(fitmentEvidence, run, {})).resolves.toMatchObject({ status: "not_enough_evidence", evidence: [] });
    await expect(invokeCapability(priceComparables, run, {})).resolves.toMatchObject({ status: "not_enough_sales", medianCents: null });
  });

  it("the model's tools are the allow-list, filtered to R1", () => {
    expect(modelToolsFor("buyer").map((tool) => tool.name)).toEqual(MODEL_TOOLS.buyer);
  });

  // OS-R73 (Neil, 7 Nov: stop advertising): the three graph stubs answer
  // "not enough evidence" whatever is asked, so no scope hands them to the model.
  it("never hands the model a graph stub, in any scope, with or without the jobs step", () => {
    expect([...UNADVERTISED_TOOLS].sort()).toEqual(["fitment_evidence", "price_comparables", "read_product"]);
    for (const scope of ["seller", "buyer", "garage"] as const) {
      const names = modelToolsFor(scope).map((tool) => tool.name);
      for (const stub of UNADVERTISED_TOOLS) {
        expect(MODEL_TOOLS[scope], `${scope} allow-lists ${stub}`).not.toContain(stub);
        expect(names, `${scope} hands the model ${stub}`).not.toContain(stub);
        expect(modelToolNames(scope, true)).not.toContain(stub);
      }
    }
    // The working marketplace search and filter tools stay.
    for (const kept of ["search_parts", "browse_marketplace", "read_listing"]) expect(modelToolsFor("buyer").map((tool) => tool.name)).toContain(kept);
  });

  it("names the tools by the jobs step the way the runner filters them", () => {
    expect(modelToolNames("buyer", false).some((name) => JOB_TOOLS.has(name))).toBe(false);
    expect(modelToolNames("buyer", true)).toEqual(MODEL_TOOLS.buyer);
  });

  it("the agent and the member build the same move key", () => {
    expect(offerMoveKey({ offerId: "o", kind: "counter", round: 3, amountCents: 86000 })).toBe("counter:o:r3:86000");
    expect(offerMoveKey({ offerId: "o", kind: "accept", round: 4 })).toBe("accept:o:r4:0");
  });
});
