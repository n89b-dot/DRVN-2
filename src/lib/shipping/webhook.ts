import { mapTracker } from "./easypost";
import { applyTrackingSummary, findShipmentForTracker } from "./apply-tracking";
import type { createAdminClient } from "@/lib/supabase/admin";

/** Shared by verified live delivery and authenticated, audited stored replay. */
export async function dispatchEasyPostEvent(
  admin: ReturnType<typeof createAdminClient>,
  payload: unknown
): Promise<"committed" | "irrelevant"> {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Invalid shipping event payload");
  }
  const event = payload as Record<string, unknown>;
  if (typeof event.id !== "string" || !event.id) throw new Error("Missing shipping event identity");
  if (event.description !== "tracker.updated" && event.description !== "tracker.created") {
    return "irrelevant";
  }
  if (!event.result || typeof event.result !== "object" || Array.isArray(event.result)) {
    throw new Error("tracker payload missing; retry required");
  }
  const summary = mapTracker(event.result as Record<string, unknown>);
  const lookup = await findShipmentForTracker(admin, summary);
  if (lookup.kind !== "found") throw new Error(`tracker mapping ${lookup.kind}; retry required`);
  await applyTrackingSummary(admin, lookup.shipment, summary);
  return "committed";
}
