import "server-only";

import type { AgeConfirmationSource } from "@/lib/age-confirmation";
import { reportError } from "@/lib/monitoring";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Server half of the 18+ confirmation (src/lib/age-confirmation.ts). The
 * table is service-role only (20261107231001), so these are the only writers.
 */

/**
 * Records that `userId` confirmed they're 18 or over. The first answer
 * stands: a later one never moves its time or source. Returns false when the
 * record couldn't be written, so a caller that needs it can stop.
 *
 * An account id Supabase invented for an address that already exists (sign-up
 * hides whether an email is registered) matches no account: the insert fails
 * on its foreign key, quietly, and nothing is recorded for anyone.
 */
export async function recordAgeConfirmation(userId: string, source: AgeConfirmationSource): Promise<boolean> {
  const { error } = await createAdminClient()
    .from("age_confirmations")
    .upsert({ user_id: userId, source }, { onConflict: "user_id", ignoreDuplicates: true });
  if (!error) return true;
  if (error.code !== "23503") reportError("[age] confirmation could not be recorded", { source, error });
  return false;
}

/** Whether `userId` has already confirmed (at sign-up or a guest checkout). */
export async function hasAgeConfirmation(userId: string): Promise<boolean> {
  const { data, error } = await createAdminClient()
    .from("age_confirmations")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) {
    reportError("[age] confirmation lookup failed", { error });
    // Unknown reads as "ask": asking again is harmless, skipping isn't.
    return false;
  }
  return Boolean(data);
}
