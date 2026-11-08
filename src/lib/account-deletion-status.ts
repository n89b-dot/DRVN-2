/**
 * What Settings tells a member about their own deletion request (OS-W11 N35).
 * The database's own record (my_account_deletion_status) said where a case
 * stood, but nothing showed it: a member on a financial hold, or waiting on
 * an operator, saw only "Delete my account" again.
 */
export type DeletionStatus = { outcome: string; next_action: string | null; updated_at: string } | null;

export function deletionStatusNotice(status: DeletionStatus): { title: string; body: string } | null {
  if (!status) return null;
  switch (status.outcome) {
    case "temporary_financial_hold":
      return {
        title: "Your deletion request is on hold",
        body: `${status.next_action ?? "Finish your open orders, returns, refunds and payouts, then ask again."} Nothing has been deleted yet, and you can keep using your account to finish them.`,
      };
    case "operator_attention":
      return {
        title: "DRVN is finishing your deletion by hand",
        body: `${status.next_action ?? "An operator has to complete part of it."} We'll email you when it's done. Questions: hello@drvn.app.`,
      };
    case "cleanup_pending":
      return { title: "Your account is being deleted", body: "This runs on its own and usually finishes within a day." };
    default:
      return null;
  }
}

/** How an order is named to its parties: the first eight characters of its id. */
export function orderReference(orderId: string): string {
  return orderId.slice(0, 8).toUpperCase();
}

/** A deletion request's reference: the job id the member is given when cleanup is queued. */
export const DELETION_REFERENCE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The same case, for a member signed out when cleanup was queued (OS-W11
 * follow-up). The worker bans the sign-in and clears the username before it
 * records an operator step or completion, so those never reach Settings.
 * /account-deletion/<reference> shows them instead. A hold pauses before the
 * ban (or lifts it), so a held member is told they can sign in to settle the
 * order; nothing else here assumes the account can still be used.
 */
export function deletionReferenceNotice(outcome: string, holdOrderId: string | null = null): { title: string; body: string } | null {
  switch (outcome) {
    case "cleanup_pending":
      return {
        title: "Your account is being deleted",
        body: "This runs on its own and usually finishes within a day. You've been signed out, and the account can't be signed in to while it runs.",
      };
    // OS-W11: a held deletion is paused before anything is deleted, and the
    // member keeps sign-in to settle what holds it.
    case "temporary_financial_hold":
      return {
        title: holdOrderId ? `Paused: settle order ${orderReference(holdOrderId)}` : "Your deletion is paused on an open transaction",
        body: `${holdOrderId ? "That order" : "An order, return, refund or payout on your account"} is still in progress. You can still sign in to settle it. Deletion carries on by itself once it has, with nothing more needed from you.`,
      };
    case "operator_attention":
      return {
        title: "DRVN is finishing your deletion by hand",
        body: "Records of past sales are kept without your name where the law requires it, and an operator has to complete that part. Questions: hello@drvn.app.",
      };
    case "completed":
      return {
        title: "Your account has been deleted",
        body: "Records of past sales are kept without your name where the law requires it. Nothing more is needed from you.",
      };
    default:
      return null;
  }
}
