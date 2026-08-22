"use client";

import { useActionState } from "react";

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
}: {
  listingId: string;
  triggerLabel?: string;
}) {
  const [state, formAction, pending] = useActionState(deleteListing, null);

  return (
    <ConfirmDialog
      title="Delete this listing?"
      destructive
      consequences={[
        "Removes the listing and its photos permanently",
        "Any open offers and their conversations go with it",
        "This can't be undone — archiving keeps the record instead",
        "A reserved or sold listing can't be deleted — its order history depends on it",
      ]}
      confirmLabel={pending ? "Deleting…" : "Delete permanently"}
      formAction={formAction}
      hidden={{ id: listingId }}
      pending={pending}
      error={state?.error}
      triggerClassName="relbtn !static"
    >
      {triggerLabel}
    </ConfirmDialog>
  );
}
