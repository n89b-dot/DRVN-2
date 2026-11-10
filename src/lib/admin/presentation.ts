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

/**
 * Why an account deletion is waiting, from account_deletion_requests.blocker_code.
 * N418: late_hold_after_scrub is a return, refund, payout or chargeback that
 * opened after the member's personal data was removed (20261108180000). The
 * account stays disabled; an operator settles the money without the member.
 */
export const DELETION_BLOCKER_LABEL: Record<string, string> = {
  late_hold_after_scrub: "Late hold after scrub",
  open_chargeback: "Open bank chargeback",
  active_financial_obligations: "Open order, return, refund or payout",
  immutable_retained_identity: "Transaction records kept",
};

export function deletionBlockerLabel(code: string | null | undefined): string | null {
  if (!code) return null;
  return DELETION_BLOCKER_LABEL[code] ?? code.replaceAll("_", " ");
}

/**
 * #108: which cases the console offers to resume. The database is the one that
 * decides (admin_resume_account_deletion, 20261110110000) and re-checks the
 * hold; this only decides when to show the control.
 */
export function deletionResumable(outcome: string, blockerCode: string | null, jobStatus: string | null): boolean {
  if (outcome === "completed" || !jobStatus) return false;
  if (jobStatus === "failed") return true;
  return outcome === "operator_attention" && blockerCode === "late_hold_after_scrub" && jobStatus === "completed";
}
