"use client";

import { useActionState } from "react";

import { ConfirmDialog } from "@/components/ui";

import { deleteListing } from "../../../sell/actions";

/** Deletion is irreversible — the shared confirm dialog states that plainly. */
export function DeleteListing({ listingId }: { listingId: string }) {
  const [state, formAction, pending] = useActionState(deleteListing, null);

  return (
    <ConfirmDialog
      title="Delete this listing?"
      destructive
      consequences={[
        "Removes the listing and its photos permanently",
        "This can't be undone",
        "A reserved or sold listing can't be deleted — its order history depends on it",
      ]}
      confirmLabel={pending ? "Deleting…" : "Delete permanently"}
      formAction={formAction}
      hidden={{ id: listingId }}
      pending={pending}
      error={state?.error}
      triggerClassName="relbtn !static"
    >
      Delete this listing
    </ConfirmDialog>
  );
}
