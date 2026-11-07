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
 * Since 20261107210000 (N26) the row itself is server-only: it also holds the
 * fraud thresholds. Anyone reads the public part, `settlement_hold_policy()`,
 * which says whether each threshold is on but never its amount;
 * `readSettlementRisk` reads the amounts and needs the service-role client.
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

/**
 * The payouts tile's sentence: "Clears ___." Fixed mode also releases a
 * payout as soon as the buyer confirms a parcel that could plausibly have
 * arrived (mark_order_received, 20261009100000); claim_window never does.
 */
export function payoutClearsPhrase(policy: PayoutHoldPolicy): string {
  const base = `${payoutHoldPhrase(policy)} after delivery`;
  return policy.mode === "fixed" ? `${base}, or as soon as the buyer confirms it arrived` : base;
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

/** The public projection's row: periods, and whether each control is on. */
type HoldPolicyRow = Database["public"]["Functions"]["settlement_hold_policy"]["Returns"][number];

/**
 * The public part of the settings (settlement_hold_policy, 20261107210000).
 * `undefined` when it can't be read; `null` when there is no settings row,
 * which the SQL answers with its own defaults.
 */
async function readHoldPolicyRow(
  supabase: SupabaseClient<Database>
): Promise<HoldPolicyRow | null | undefined> {
  const { data, error } = await supabase.rpc("settlement_hold_policy");
  if (error || !Array.isArray(data)) return undefined;
  return data[0] ?? null;
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
  const row = await readHoldPolicyRow(supabase);
  if (row === undefined) return undefined;
  const days = row?.auto_confirm_after_days ?? null;
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
  const row = await readHoldPolicyRow(supabase);
  if (row === undefined) return null;
  return readPolicy(row ?? undefined);
}

/**
 * The risk controls as the public may know them (N26): how soon a buyer's
 * confirmation releases a payout, and whether card verification is on —
 * never the amount it starts at, which would let someone price just under
 * it. Null when it can't be read.
 */
export type PublicRiskControls = {
  receiptReleaseAfterDays: number;
  cardVerificationOn: boolean;
};

export async function readPublicRiskControls(
  supabase: SupabaseClient<Database>
): Promise<PublicRiskControls | null> {
  const row = await readHoldPolicyRow(supabase);
  if (row === undefined) return null;
  // A missing row: the SQL's own fallbacks (3 days, both controls off).
  if (row === null) return { receiptReleaseAfterDays: 3, cardVerificationOn: false };
  const days = row.receipt_release_after_days;
  if (!Number.isInteger(days) || days < 0) return null;
  return {
    receiptReleaseAfterDays: days,
    cardVerificationOn: row.card_verification_on === true,
  };
}

/**
 * The owner's risk settings beside the hold (20261009100000). Amounts are
 * cents; null means that control is off. tracking_required_from_cents is no
 * longer read: there is no amount-based dispatch rule (20261107200100, N110).
 * Server-only: the amounts are fraud thresholds, readable by the service
 * role alone (20261107210000).
 */
export type SettlementRiskSettings = {
  /** A buyer's "received" releases the payout at once only after this many
   *  days in transit (or a carrier delivery scan). */
  receiptReleaseAfterDays: number;
  /** Payments at or above this ask the card's bank to verify the buyer. */
  cardVerificationFromCents: number | null;
};

function positiveCents(value: unknown): number | null | undefined {
  if (value === null) return null;
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
}

/** The risk settings, or null when they can't be read. Pass the service-role client. */
export async function readSettlementRisk(
  supabase: SupabaseClient<Database>
): Promise<SettlementRiskSettings | null> {
  const { data, error } = await supabase
    .from("settlement_settings")
    .select("receipt_release_after_days, card_verification_from_cents")
    .limit(1);
  if (error || !data) return null;
  const row = data[0];
  // A missing row: the SQL's own fallbacks (3 days, verification off).
  if (!row) return { receiptReleaseAfterDays: 3, cardVerificationFromCents: null };
  const card = positiveCents(row.card_verification_from_cents);
  const days = row.receipt_release_after_days;
  if (card === undefined || !Number.isInteger(days) || days < 0) return null;
  return { receiptReleaseAfterDays: days, cardVerificationFromCents: card };
}
