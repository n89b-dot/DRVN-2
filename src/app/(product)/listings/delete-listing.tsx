"use client";

import { useActionState } from "react";
import { unstable_rethrow } from "next/navigation";

import { ConfirmDialog } from "@/components/ui";

import { deleteListing } from "../sell/actions";

/**
 * Permanent deletion, behind the shared consequence-confirm dialog. Offered
 * on the ledger row and the edit page for any listing the delete guard
 * allows (everything except reserved/sold — order history depends on those,
 * so they archive instead).
 */
export function DeleteListing({
  listingId,
  triggerLabel = "Delete this listing",
  triggerClassName = "relbtn !static",
}: {
  listingId: string;
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

  return (
    <ConfirmDialog
      title="Delete this listing?"
      destructive
      consequences={[
        "Removes the listing permanently; its photos are then deleted from DRVN's storage",
        "Any open offers and their conversations go with it",
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
      {triggerLabel}
    </ConfirmDialog>
  );
}
