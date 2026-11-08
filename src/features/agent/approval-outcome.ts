/**
 * What agent_approval_decide reports (20261107210500, N128): the outcome of
 * the owner's answer, distinct for each way it can end. Only `accepted` means
 * a sale was made.
 */
export type ApprovalOutcome = "accepted" | "expired" | "refused" | "noop" | "dismissed";

const OUTCOMES: readonly ApprovalOutcome[] = ["accepted", "expired", "refused", "noop", "dismissed"];

/** The outcome in the RPC's result, or null when it says none we know. */
export function readApprovalOutcome(data: unknown): ApprovalOutcome | null {
  const outcome = data && typeof data === "object" ? (data as { outcome?: unknown }).outcome : undefined;
  return OUTCOMES.includes(outcome as ApprovalOutcome) ? (outcome as ApprovalOutcome) : null;
}

/**
 * The owner's note for each outcome. Never says "accepted" unless the offer
 * move reported an accept; an unknown outcome is not treated as a sale.
 */
export function approvalOutcomeNote(outcome: ApprovalOutcome | null): { ok?: string; error?: string } {
  switch (outcome) {
    case "accepted":
      return { ok: "Accepted. The buyer has 24 hours to pay." };
    case "dismissed":
      return { ok: "Dismissed. Your agent waits for the next move on this offer." };
    case "expired":
      return { error: "This offer expired before you accepted it, so nothing was sold." };
    case "refused":
      return { error: "This offer can't be accepted any more, so nothing was sold. Open the offer to see where it stands." };
    case "noop":
      return { error: "The offer moved on before you answered, so nothing changed. Open the offer to see where it stands." };
    default:
      return { error: "Couldn't confirm what happened. Open the offer to see where it stands." };
  }
}
