/**
 * The payout clearing hold — how long a delivered order's money waits before
 * it is released to the seller.
 *
 * The owner sets it in one place, the `settlement_settings` row
 * (20261006100000; docs/decisions/payout-hold.md). The database applies it:
 * `payout_available_at()` stamps each transfer intent's `available_at` at
 * delivery. This module reads the same row so the ledger, the payouts tile
 * and the terms say what the database does, and mirrors the date rule for
 * display. It never decides a payout.
 *
 * Client-safe helpers plus one read; no server-only imports.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database, Json } from "@/lib/database.types";
import { DISPUTE_WINDOW_DAYS } from "@/features/commerce/disputes";

export type PayoutHoldMode = "fixed" | "claim_window";

export type PayoutHoldPolicy = {
  /** 'fixed': delivery + holdDays. 'claim_window': the later of that, the
   *  window to report a problem, and the shop's return window on the order. */
  mode: PayoutHoldMode;
  holdDays: number;
};

/** What the database uses when the settings row is missing — today's rule. */
export const DEFAULT_PAYOUT_HOLD: PayoutHoldPolicy = { mode: "fixed", holdDays: 7 };

const DAY_MS = 86_400_000;

/** Days from delivery until the payout is available, for one order. */
export function payoutHoldDaysFor(policy: PayoutHoldPolicy, returnWindowDays: number | null): number {
  if (policy.mode === "fixed") return policy.holdDays;
  return Math.max(policy.holdDays, DISPUTE_WINDOW_DAYS, returnWindowDays ?? 0);
}

/** The display mirror of SQL payout_available_at(). */
export function payoutAvailableAt(
  deliveredAt: string,
  policy: PayoutHoldPolicy,
  returnWindowDays: number | null = null
): string {
  return new Date(
    new Date(deliveredAt).getTime() + payoutHoldDaysFor(policy, returnWindowDays) * DAY_MS
  ).toISOString();
}

/**
 * The shop return window an order item was bought under, given the
 * `commercial.return_policy` object of its frozen snapshot — the same fields,
 * and the same "ignore what is malformed" rule, as the SQL. Null when the
 * item had no shop returns.
 */
export function returnWindowDays(policy: Json | null | undefined): number | null {
  if (!policy || typeof policy !== "object" || Array.isArray(policy)) return null;
  if (policy.returns_accepted !== true) return null;
  const days = policy.window_days;
  if (typeof days === "number" && Number.isInteger(days) && days >= 0 && days <= 999) return days;
  if (typeof days === "string" && /^[0-9]{1,3}$/.test(days)) return Number(days);
  return null;
}

/** The rule in words, for "A sale is paid out ___ after delivery". */
export function payoutHoldPhrase(policy: PayoutHoldPolicy): string {
  const days = payoutHoldDaysFor(policy, null);
  const span = days === 1 ? "1 day" : `${days} days`;
  return policy.mode === "fixed" ? span : `${span} (or once the shop's return window closes, if later)`;
}

function readPolicy(row: { payout_hold_days: number; payout_hold_mode: string } | undefined): PayoutHoldPolicy | null {
  if (!row) return DEFAULT_PAYOUT_HOLD;
  const { payout_hold_days: holdDays, payout_hold_mode: mode } = row;
  if (!Number.isInteger(holdDays) || holdDays < 0) return null;
  if (mode !== "fixed" && mode !== "claim_window") return null;
  return { mode, holdDays };
}

/**
 * After how many days an untracked shipment the buyer never confirmed is
 * treated as delivered (settlement_settings.auto_confirm_after_days,
 * 20261006100100), for the terms to state. `null` means the rule is off;
 * `undefined` means it couldn't be read, and the caller words it without a
 * number rather than leave a live rule out.
 */
export async function readAutoConfirmDays(
  supabase: SupabaseClient<Database>
): Promise<number | null | undefined> {
  const { data, error } = await supabase
    .from("settlement_settings")
    .select("auto_confirm_after_days")
    .limit(1);
  if (error || !data) return undefined;
  const days = data[0]?.auto_confirm_after_days ?? null;
  if (days === null) return null;
  return Number.isInteger(days) && days > 0 ? days : undefined;
}

/**
 * The owner's current setting. Null when it can't be read: a payout date
 * computed from a guessed rule would be a confident wrong answer, so callers
 * say the date is unavailable (or fall back to wording without a number).
 */
export async function readPayoutHoldPolicy(
  supabase: SupabaseClient<Database>
): Promise<PayoutHoldPolicy | null> {
  const { data, error } = await supabase
    .from("settlement_settings")
    .select("payout_hold_days, payout_hold_mode")
    .limit(1);
  if (error || !data) return null;
  return readPolicy(data[0]);
}
