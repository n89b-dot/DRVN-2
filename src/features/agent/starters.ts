import type { AgentScope } from "@/lib/agent/context";
import { modelToolNames } from "@/lib/capabilities/allow-list";

/**
 * The chat's starters (design 02), built from what the agent can do (OS-W07
 * N170). Each one names the tools its answer needs; a starter is shown only
 * when every one of them is in the model's tools for this chat (the same
 * allow-list runAgentTurn hands it, jobs step included), so a starter never
 * promises a tool the agent doesn't have. "Will this fit my car?" and "What
 * do parts like this sell for?" went with the graph reads they leaned on
 * (OS-R73), and "What's my agent doing?" with the task-status tool that was
 * never built.
 */

export type ChatAboutKind = { kind: "listing" | "car"; mine: boolean };

export type Starter = { text: string; needs: readonly string[] };

/** The chat runs in the buyer scope (sendAgentMessage's default). */
export const CHAT_SCOPE: AgentScope = "buyer";

/** Opened from nowhere in particular. */
const GENERAL: readonly Starter[] = [
  { text: "Find parts for my car", needs: ["list_my_cars", "read_my_car", "search_parts"] },
  { text: "Update my build", needs: ["list_my_cars", "read_my_car", "propose_build_change"] },
  { text: "How many are for sale on DRVN?", needs: ["browse_marketplace"] },
];

/** A3d's jobs, once their step is open. */
const JOBS: readonly Starter[] = [
  { text: "Paste my build", needs: ["list_my_cars", "draft_build_list"] },
  { text: "List the parts that came off", needs: ["find_parts_to_list"] },
  { text: "List this part from my photos", needs: ["draft_listing_from_photos"] },
  { text: "Post an update", needs: ["list_my_cars", "draft_car_update"] },
];

const ABOUT_CAR: readonly Starter[] = [
  { text: "Update my build", needs: ["read_my_car", "propose_build_change"] },
  { text: "Find parts for my car", needs: ["read_my_car", "search_parts"] },
  { text: "What's on this car?", needs: ["read_my_car"] },
];

const ABOUT_MY_LISTING: readonly Starter[] = [
  { text: "What are buyers asking about this?", needs: ["read_listing_messages"] },
  { text: "How many like this are for sale?", needs: ["read_listing", "browse_marketplace"] },
];

const ABOUT_A_LISTING: readonly Starter[] = [
  { text: "Tell me about this part", needs: ["read_listing"] },
  { text: "Find others like this", needs: ["read_listing", "search_parts"] },
];

/** Every starter there is, for the tests. */
export const ALL_STARTERS: readonly Starter[] = [...GENERAL, ...JOBS, ...ABOUT_CAR, ...ABOUT_MY_LISTING, ...ABOUT_A_LISTING];

export function startersFor(about: ChatAboutKind | null, jobs: boolean, tools: readonly string[] = modelToolNames(CHAT_SCOPE, jobs)): string[] {
  const candidates = !about ? (jobs ? [...GENERAL.slice(0, 2), ...JOBS, ...GENERAL.slice(2)] : GENERAL) : about.kind === "car" ? ABOUT_CAR : about.mine ? ABOUT_MY_LISTING : ABOUT_A_LISTING;
  const enabled = new Set(tools);
  return candidates.filter((starter) => starter.needs.every((name) => enabled.has(name))).map((starter) => starter.text);
}
