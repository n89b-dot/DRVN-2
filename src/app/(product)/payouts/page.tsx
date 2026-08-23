import { redirect } from "next/navigation";

export const metadata = { title: "Payouts - DRVN" };

/**
 * Payouts lives in Settings now — its own section on the configuration
 * sheet. This route survives only so old links (order emails, bookmarks,
 * the ledger jumplinks that shipped before the move) still land somewhere
 * true.
 */
export default function PayoutsPage() {
  redirect("/settings#payouts");
}
