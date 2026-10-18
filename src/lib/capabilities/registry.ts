import { riskAtMost, type AgentScope, type Risk } from "@/lib/agent/context";

import { moveOffer, setAgentLimits } from "./negotiation";
import { fitmentEvidence, priceComparables, readListing, readMyCar, readProduct, searchParts } from "./reads";
import type { Capability } from "./types";

/**
 * Every capability, and which the model may be handed in each scope. The
 * allow-list is explicit, not derived: adding a capability doesn't hand it to
 * the model until someone puts it here. The model is held to R0–R1 (rules
 * decide money, AG-5), so the money and limits capabilities never appear in it.
 * An MCP adapter (A6) will wrap this same registry.
 */
export const CAPABILITIES: readonly Capability[] = [searchParts, readListing, readMyCar, readProduct, fitmentEvidence, priceComparables, moveOffer, setAgentLimits];

export const MODEL_TOOLS: Record<AgentScope, readonly string[]> = {
  seller: ["search_parts", "read_listing", "read_product", "fitment_evidence", "price_comparables"],
  buyer: ["search_parts", "read_listing", "read_my_car", "read_product", "fitment_evidence", "price_comparables"],
  garage: ["search_parts", "read_listing", "read_my_car", "read_product", "fitment_evidence"],
};

export const MODEL_MAX_RISK: Risk = "R1";

export function capabilityNamed(name: string): Capability | undefined {
  return CAPABILITIES.find((capability) => capability.name === name);
}

/** The tools a model may use in this scope: allow-listed, in scope, and no riskier than R1. */
export function modelToolsFor(scope: AgentScope): Capability[] {
  return MODEL_TOOLS[scope]
    .map((name) => capabilityNamed(name))
    .filter((capability): capability is Capability => Boolean(capability && capability.scopes.includes(scope) && riskAtMost(capability.risk, MODEL_MAX_RISK)));
}
