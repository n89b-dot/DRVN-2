import { riskAtMost, type AgentScope, type Risk } from "@/lib/agent/context";

import { draftBuildList, draftCarUpdate, draftListingFromPhotos, findPartsToList, listMyCars, proposeBuildChange, readPartLink } from "./build";
import { moveOffer, setAgentLimits } from "./negotiation";
import { browseMarketplace, fitmentEvidence, priceComparables, readListing, readMyCar, readProduct, searchParts } from "./reads";
import type { Capability } from "./types";

/**
 * Every capability, and which the model may be handed in each scope. The
 * allow-list is explicit, not derived: adding a capability doesn't hand it to
 * the model until someone puts it here. The model is held to R0–R1 (rules
 * decide money, AG-5), so the money and limits capabilities never appear in it.
 * An MCP adapter (A6) will wrap this same registry.
 */
export const CAPABILITIES: readonly Capability[] = [searchParts, browseMarketplace, readListing, readMyCar, readProduct, fitmentEvidence, priceComparables, listMyCars, readPartLink, proposeBuildChange, draftBuildList, findPartsToList, draftListingFromPhotos, draftCarUpdate, moveOffer, setAgentLimits];

export const MODEL_TOOLS: Record<AgentScope, readonly string[]> = {
  seller: ["search_parts", "browse_marketplace", "read_listing", "read_product", "fitment_evidence", "price_comparables"],
  buyer: ["search_parts", "browse_marketplace", "read_listing", "list_my_cars", "read_my_car", "read_product", "fitment_evidence", "price_comparables", "read_part_link", "propose_build_change", "draft_build_list", "find_parts_to_list", "draft_listing_from_photos", "draft_car_update"],
  garage: ["search_parts", "browse_marketplace", "read_listing", "list_my_cars", "read_my_car", "read_product", "fitment_evidence", "read_part_link", "propose_build_change", "draft_build_list", "find_parts_to_list", "draft_listing_from_photos", "draft_car_update"],
};

/** A3d's jobs: handed to the model only once the jobs step is open (/admin/agent). */
export const JOB_TOOLS: ReadonlySet<string> = new Set(["draft_build_list", "find_parts_to_list", "draft_listing_from_photos", "draft_car_update"]);

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
