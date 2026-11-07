import { riskAtMost, type AgentScope, type Risk } from "@/lib/agent/context";

import { draftBuildList, draftCarUpdate, draftListingFromPhotos, findPartsToList, listMyCars, proposeBuildChange, readPartLink } from "./build";
import { moveOffer, setAgentLimits } from "./negotiation";
import { browseMarketplace, fitmentEvidence, readListingMessages, priceComparables, readListing, readMyCar, readProduct, searchParts } from "./reads";
import { MODEL_TOOLS, UNADVERTISED_TOOLS } from "./allow-list";
import type { Capability } from "./types";

export { JOB_TOOLS, MODEL_TOOLS, UNADVERTISED_TOOLS, modelToolNames } from "./allow-list";

/**
 * Every capability, and which the model may be handed in each scope. The
 * allow-list is explicit, not derived: adding a capability doesn't hand it to
 * the model until someone puts it here (allow-list.ts). The model is held to
 * R0–R1 (rules decide money, AG-5), so the money and limits capabilities never
 * appear in it, and the graph reads that only say "not enough evidence" are
 * left out until they answer (OS-R73).
 * An MCP adapter (A6) will wrap this same registry.
 */
export const CAPABILITIES: readonly Capability[] = [searchParts, browseMarketplace, readListingMessages, readListing, readMyCar, readProduct, fitmentEvidence, priceComparables, listMyCars, readPartLink, proposeBuildChange, draftBuildList, findPartsToList, draftListingFromPhotos, draftCarUpdate, moveOffer, setAgentLimits];

export const MODEL_MAX_RISK: Risk = "R1";

export function capabilityNamed(name: string): Capability | undefined {
  return CAPABILITIES.find((capability) => capability.name === name);
}

/** The tools a model may use in this scope: allow-listed, advertised, in scope, and no riskier than R1. */
export function modelToolsFor(scope: AgentScope): Capability[] {
  return MODEL_TOOLS[scope]
    .filter((name) => !UNADVERTISED_TOOLS.has(name))
    .map((name) => capabilityNamed(name))
    .filter((capability): capability is Capability => Boolean(capability && capability.scopes.includes(scope) && riskAtMost(capability.risk, MODEL_MAX_RISK)));
}
