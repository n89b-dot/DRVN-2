"use client";

import { useActionState, useState } from "react";

import { deleteListing } from "../../../sell/actions";

/** Two-step, and the safe choice is the default — deletion is irreversible. */
export function DeleteListing({ listingId }: { listingId: string }) {
  const [confirming, setConfirming] = useState(false);
  const [state, formAction, pending] = useActionState(deleteListing, null);

  if (!confirming) {
    return (
      <button type="button" onClick={() => setConfirming(true)} className="relbtn !static">
        Delete this listing
      </button>
    );
  }

  return (
    <div className="grid gap-2">
      <p className="field__err">This can&apos;t be undone.</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => setConfirming(false)} className="btn btn--ghost">
          Keep it
        </button>
        <form action={formAction}>
          <input type="hidden" name="id" value={listingId} />
          <button type="submit" className="btn btn--live" disabled={pending}>
            {pending ? "Deleting…" : "Delete permanently"}
          </button>
        </form>
      </div>
      {state?.error && (
        <p role="alert" aria-live="polite" className="field__err">
          {state.error}
        </p>
      )}
    </div>
  );
}
