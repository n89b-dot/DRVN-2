"use client";

import { useActionState, useState } from "react";

import { deleteAccount, type ActionState } from "../garage/actions";

/**
 * Deliberately awkward: two steps, a typed confirmation, and cancel as the
 * prominent choice. The action refuses while orders are in flight so a
 * counterparty is never left stranded mid-trade.
 */
export function DeleteAccount() {
  const [state, action, pending] = useActionState<ActionState, FormData>(deleteAccount, {});
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="relbtn !static">
        Delete my account
      </button>
    );
  }

  return (
    <form action={action} className="grid gap-3">
      <label className="field">
        <span className="field__label">
          Type <b>DELETE</b> to confirm
        </span>
        <input
          name="confirm"
          required
          autoComplete="off"
          placeholder="DELETE"
          className="ctl !max-w-none"
        />
      </label>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => setOpen(false)} className="btn btn--ghost">
          Keep my account
        </button>
        <button type="submit" disabled={pending} className="relbtn !static">
          {pending ? "Deleting…" : "Delete permanently"}
        </button>
      </div>
      {state.error && (
        <p role="alert" aria-live="polite" className="field__err">
          {state.error}
        </p>
      )}
    </form>
  );
}
