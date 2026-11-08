import "server-only";

import { createHash } from "node:crypto";

import { reportError } from "@/lib/monitoring";
import type { createAdminClient } from "@/lib/supabase/admin";

type Admin = ReturnType<typeof createAdminClient>;

/**
 * Guest checkout's hold caps (N89, OS-W31; Neil's ruling: guest caps
 * approved). The database admits a guest's holds atomically — at most 2 live
 * per device and per network, and 1 live guest hold per listing — under
 * locks taken in one order (guest_hold_admit, 20261107220800). The device is
 * the signed checkout cookie and the network the signed client address; both
 * reach the database only as one-way digests.
 */
export const GUEST_HOLD_LIMIT_MESSAGE = "Guest checkout holds up to 2 parts at a time. Sign in to buy more, or finish paying for the ones you're holding.";
export const GUEST_HOLD_TAKEN_MESSAGE = "Someone else is checking out this part right now. Try again in a few minutes.";

export function guestHoldKey(kind: "device" | "network", value: string): string {
  return createHash("sha256").update(`guest-hold:${kind}:${value}`).digest("hex");
}

export async function admitGuestHolds(
  admin: Admin,
  input: {
    device: string;
    network: string;
    listingIds: string[];
    buyerId: string;
    /** The checkout request (guest idempotency key) the admissions belong
     *  to: only it reuses, binds or releases them (20261108130000). */
    request: string;
  },
): Promise<{ holds: string[] } | { error: string }> {
  const { data, error } = await admin.rpc("guest_hold_admit", {
    p_device: guestHoldKey("device", input.device),
    p_network: guestHoldKey("network", input.network),
    p_listing_ids: input.listingIds,
    p_buyer: input.buyerId,
    p_request: input.request,
  });
  if (error?.code === "GH429") return { error: GUEST_HOLD_LIMIT_MESSAGE };
  if (error?.code === "GH409") return { error: GUEST_HOLD_TAKEN_MESSAGE };
  if (error || !data) {
    reportError("[checkout] guest hold admission failed", { code: error?.code });
    return { error: "We couldn't start that purchase. Nothing was charged — try again." };
  }
  return { holds: data };
}

/** Gives back this request's own unbound admissions, for a checkout whose
 *  purchase_begin never committed. purchase_begin binds (or gives back) a
 *  request's admissions in its own transaction, so once it has run there is
 *  nothing left here to release, and another request's admissions are never
 *  reachable. A failure is reported, never fatal: an unbound admission
 *  lapses on its own after 15 minutes. */
export async function releaseGuestHolds(admin: Admin, request: string): Promise<void> {
  const { error } = await admin.rpc("guest_hold_release", { p_request: request });
  if (error) reportError("[checkout] guest hold release failed", { code: error.code });
}
