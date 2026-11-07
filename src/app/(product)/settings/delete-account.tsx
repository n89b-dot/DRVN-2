"use client";

import { useState } from "react";

import { Button, TextField, UnconfirmedOutcome } from "@/components/ui";
import { useRecoverableAction } from "@/features/commerce/use-recoverable-action";

import { deleteAccount, type ActionState } from "../garage/actions";
import { ReconfirmIdentity, type IdentityProof } from "./reconfirm-identity";

const UNCONFIRMED =
  "Couldn't confirm whether your deletion request went through. Reload to check — if it did, you'll be signed out.";

/**
 * Deliberately awkward: two steps, a typed confirmation, fresh proof it's the
 * owner (the password, or Google again for Google-only members: N41), and
 * cancel as the prominent choice. The action refuses while orders are in flight so a
 * counterparty is never left stranded mid-trade.
 *
 * A lost response never puts "Delete permanently" back: the request may
 * already be in, so the member reloads to see where it stands.
 */
export function DeleteAccount({ proof }: { proof: IdentityProof }) {
  const [state, action, pending] = useRecoverableAction<ActionState>(deleteAccount, UNCONFIRMED);
  const [open, setOpen] = useState(false);

  if (state.error === UNCONFIRMED) return <UnconfirmedOutcome>{UNCONFIRMED}</UnconfirmedOutcome>;

  if (!open) {
    return (
      <Button variant="quiet" onClick={() => setOpen(true)}>
        Delete my account
      </Button>
    );
  }

  return (
    <form action={action} className="grid gap-3">
      <TextField
        id="delete-account-confirm"
        label={
          <>
            Type <b>DELETE</b> to confirm
          </>
        }
        name="confirm"
        required
        autoComplete="off"
        placeholder="DELETE"
        className="!max-w-none"
      />
      <ReconfirmIdentity
        id="delete-account-password"
        proof={proof}
        returnTo="/settings#danger"
        disabled={pending}
        needsGoogle={state.reauth === "oauth"}
      />
      <div className="flex flex-wrap gap-2">
        <Button variant="ghost" onClick={() => setOpen(false)}>
          Keep my account
        </Button>
        <Button type="submit" variant="quiet" loading={pending} pendingLabel="Deleting…">
          Delete permanently
        </Button>
      </div>
      {state.error && (
        <p role="alert" aria-live="polite" className="field__err">
          {state.error}
        </p>
      )}
    </form>
  );
}
