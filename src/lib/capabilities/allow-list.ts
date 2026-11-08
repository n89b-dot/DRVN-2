import type { AgentScope } from "@/lib/agent/context";

/**
 * Which capabilities the model is handed in each scope (registry.ts holds the
 * capabilities themselves). Pure data, with no server imports, so the chat's
 * starters (features/agent/starters.ts) are built from the same list the
 * model is given and can't promise a tool it doesn't have (OS-W07 N170).
 *
 * Not advertised (OS-R73, Neil's ruling 7 Nov): read_product,
 * fitment_evidence and price_comparables. They still answer "not enough
 * evidence" whatever is asked, so they stay out of this list, the starters
 * and the copy until they return real graph answers.
 */
export const MODEL_TOOLS: Record<AgentScope, readonly string[]> = {
  seller: ["search_parts", "browse_marketplace", "read_listing_messages", "read_listing"],
  buyer: ["search_parts", "browse_marketplace", "read_listing_messages", "read_listing", "list_my_cars", "read_my_car", "read_part_link", "propose_build_change", "draft_build_list", "find_parts_to_list", "draft_listing_from_photos", "draft_car_update"],
  garage: ["search_parts", "browse_marketplace", "read_listing_messages", "read_listing", "list_my_cars", "read_my_car", "read_part_link", "propose_build_change", "draft_build_list", "find_parts_to_list", "draft_listing_from_photos", "draft_car_update"],
};

/** A3d's jobs: handed to the model only once the jobs step is open (/admin/agent). */
export const JOB_TOOLS: ReadonlySet<string> = new Set(["draft_build_list", "find_parts_to_list", "draft_listing_from_photos", "draft_car_update"]);

/** Capabilities that exist but are never advertised to the model until they return real answers (OS-R73). */
export const UNADVERTISED_TOOLS: ReadonlySet<string> = new Set(["read_product", "fitment_evidence", "price_comparables"]);

/** The tool names the model gets in this scope, with or without the jobs step. */
export function modelToolNames(scope: AgentScope, jobs: boolean): string[] {
  return MODEL_TOOLS[scope].filter((name) => jobs || !JOB_TOOLS.has(name));
}
