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
