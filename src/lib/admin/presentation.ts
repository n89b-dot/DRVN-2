import type { OrderStatus } from "@/lib/database.types";

/**
 * Exception-first status encoding: a chip is an interrupt, so only the states
 * that need a human keep one — red when money or an order is stuck, amber when
 * something is mid-flight and fragile. Nominal and terminal states render as
 * plain dim text (`.status-plain`) instead, so a routine page carries no
 * colour and the one exceptional row is the only thing that pops.
 */
export const ORDER_STATUS_CHIP: Partial<Record<OrderStatus, string>> = {
  requires_action: "chip--warn",
  payment_failed: "chip--live",
  disputed: "chip--live",
};

/**
 * Money-movement states, same policy, one source. Previously three inline
 * ternary ladders encoded near-identical semantics per table — and terminal
 * negatives borrowed `chip--live`, the exact live/danger collision the chip
 * CSS warns against. Null means nominal: render `.status-plain`, no chip.
 */
export function transferChip(status: string): string | null {
  if (status === "blocked_unpayable" || status === "failed") return "chip--danger";
  if (status === "ready") return "chip--warn";
  return null;
}

export function refundChip(status: string): string | null {
  if (status === "failed" || status === "recovery_required") return "chip--danger";
  if (status === "reversal_pending") return "chip--warn";
  return null;
}

export function payoutAlertChip(status: string): string | null {
  if (status === "failed") return "chip--danger";
  if (status === "disabled") return null;
  return "chip--warn";
}

/** Suspension is an enforced terminal state, not a live event. */
export const SUSPENDED_CHIP = "chip--danger";

/**
 * The reason the privacy RPCs write when a member asks to delete their
 * account (20260905185725). The profile is suspended while the deletion
 * worker runs; the console shows it as a deletion, never offers Unsuspend.
 */
export const ACCOUNT_DELETION_REASON = "Account deletion requested";

export function isDeletionPending(suspendedReason: string | null | undefined): boolean {
  return suspendedReason === ACCOUNT_DELETION_REASON;
}
