import { onboardingPath, safeRedirectPath } from "@/lib/safe-redirect";
import type { createClient } from "@/lib/supabase/server";

type Reader = Pick<Awaited<ReturnType<typeof createClient>>, "from">;

/**
 * OS-W11 (Codex on #157): a member whose account deletion is paused on a
 * financial hold has sign-in back to settle the order holding it. Cleanup may
 * already have cleared their username; picking a new handle for an account
 * being deleted is not what they came for, and onboarding used to refuse it
 * anyway (block_deleted_account_writes). So "no username" sends them to the
 * order, not to onboarding.
 */
export type HeldDeletion = { orderId: string | null };

/** The member's own held case (RLS: owners read their own request), or null. */
export async function loadHeldDeletion(
  supabase: Reader,
  userId: string
): Promise<HeldDeletion | null> {
  const { data, error } = await supabase
    .from("account_deletion_requests")
    .select("outcome, hold_order_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (error || !data || data.outcome !== "temporary_financial_hold") return null;
  return { orderId: data.hold_order_id };
}

/** Where a held member settles: the order holding the deletion, or their orders. */
export function heldDeletionPath(held: HeldDeletion): string {
  return held.orderId ? `/orders/${held.orderId}` : "/orders";
}

/**
 * Where sign-in lands an account with no username: onboarding, unless its
 * deletion is held, when it is the requested page (validated) or the order.
 */
export function landingWithoutUsername(held: HeldDeletion | null, requested?: unknown): string {
  if (held) return safeRedirectPath(requested, heldDeletionPath(held));
  return onboardingPath(requested);
}
