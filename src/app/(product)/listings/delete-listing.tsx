"use client";

import { useActionState } from "react";
import { unstable_rethrow } from "next/navigation";

import { ConfirmDialog, ResultNote } from "@/components/ui";

import { deleteListing, withdrawListing } from "../sell/actions";

/**
 * Removing a listing, behind the shared consequence-confirm dialog. A
 * listing with offers is withdrawn, never deleted (N77, Neil's ruling):
 * its live offers end with a listing-withdrawal reason, the buyers are
 * told, and the record is kept. One without offers can still be deleted
 * permanently. Reserved and sold listings belong to their order.
 */
export function DeleteListing({
  listingId,
  hasOffers = false,
  triggerLabel,
  triggerClassName = "relbtn !static",
}: {
  listingId: string;
  /** Known to have offers (live or past): offer Withdraw straight away. */
  hasOffers?: boolean;
  triggerLabel?: string;
  triggerClassName?: string;
}) {
  const [state, formAction, pending] = useActionState(async (previous: Parameters<typeof deleteListing>[0], data: FormData) => {
    try {
      return await deleteListing(previous, data);
    } catch (error) {
      unstable_rethrow(error);
      return { error: "Couldn’t confirm the change. Try again to check the same request." };
    }
  }, null);
  const [withdrawn, withdrawAction, withdrawing] = useActionState(async (previous: Parameters<typeof withdrawListing>[0], data: FormData) => {
    try {
      return await withdrawListing(previous, data);
    } catch (error) {
      unstable_rethrow(error);
      return { error: "Couldn’t confirm the change. Try again to check the same request." };
    }
  }, null);

  if (withdrawn?.ok) return <ResultNote ok={withdrawn.ok} />;

  if (hasOffers || state?.withdrawInstead) {
    return (
      <ConfirmDialog
        title="Withdraw this listing?"
        destructive
        consequences={[
          "Takes it off the market and archives it — nothing is deleted",
          "Every open offer on it ends, and each buyer is told",
          "Offer and message history stays for you and the buyers",
          "A reserved or sold listing can't be withdrawn — its order decides it",
        ]}
        confirmLabel={withdrawing ? "Withdrawing…" : "Withdraw listing"}
        formAction={withdrawAction}
        hidden={{ id: listingId }}
        pending={withdrawing}
        error={withdrawn?.error ?? (state?.withdrawInstead ? state.error : undefined)}
        triggerClassName={triggerClassName}
      >
        {triggerLabel ? "Withdraw" : "Withdraw this listing"}
      </ConfirmDialog>
    );
  }

  return (
    <ConfirmDialog
      title="Delete this listing?"
      destructive
      consequences={[
        "Removes the listing permanently; its photos are then deleted from DRVN's storage",
        "Only a listing nobody has made an offer on can be deleted — one with offers is withdrawn instead",
        "This can't be undone — archiving keeps the record instead",
        "A reserved or sold listing can't be deleted — its order history depends on it",
      ]}
      confirmLabel={pending ? "Deleting…" : "Delete permanently"}
      formAction={formAction}
      hidden={{ id: listingId }}
      pending={pending}
      error={state?.error}
      triggerClassName={triggerClassName}
    >
      {triggerLabel ?? "Delete this listing"}
    </ConfirmDialog>
  );
}
