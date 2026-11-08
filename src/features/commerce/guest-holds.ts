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
  input: { device: string; network: string; listingIds: string[]; buyerId: string },
): Promise<{ holds: string[] } | { error: string }> {
  const { data, error } = await admin.rpc("guest_hold_admit", {
    p_device: guestHoldKey("device", input.device),
    p_network: guestHoldKey("network", input.network),
    p_listing_ids: input.listingIds,
    p_buyer: input.buyerId,
  });
  if (error?.code === "GH429") return { error: GUEST_HOLD_LIMIT_MESSAGE };
  if (error?.code === "GH409") return { error: GUEST_HOLD_TAKEN_MESSAGE };
  if (error || !data) {
    reportError("[checkout] guest hold admission failed", { code: error?.code });
    return { error: "We couldn't start that purchase. Nothing was charged — try again." };
  }
  return { holds: data };
}

/** Points each hold at its order, or gives the admission back when nothing
 *  was reserved. A failure here never undoes the purchase: an unbound
 *  admission lapses on its own after 15 minutes. */
export async function settleGuestHolds(admin: Admin, holds: string[], buyerId: string, reserved: boolean): Promise<void> {
  const { error } = reserved
    ? await admin.rpc("guest_hold_bind", { p_hold_ids: holds, p_buyer: buyerId })
    : await admin.rpc("guest_hold_release", { p_hold_ids: holds });
  if (error) reportError("[checkout] guest hold settle failed", { code: error.code, reserved });
}
