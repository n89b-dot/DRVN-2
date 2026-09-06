"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui";

import { revokeBetaInvitation, type InvitationActionState } from "./actions";

export function RevokeInvitationForm({ invitationId }: { invitationId: string }) {
  const [state, action, pending] = useActionState<InvitationActionState, FormData>(
    revokeBetaInvitation,
    null
  );

  return (
    <form action={action} className="mt-3 flex flex-wrap gap-2">
      <input type="hidden" name="invitation_id" value={invitationId} />
      <input
        className="ctl min-w-[220px] flex-1"
        name="reason"
        aria-label="Reason for revocation"
        placeholder="Reason for revocation"
        required
        maxLength={500}
      />
      <Button type="submit" variant="quiet" disabled={pending}>
        {pending ? "Revoking…" : "Revoke"}
      </Button>
      {state?.error && <span className="field__err w-full" role="alert">{state.error}</span>}
      {state?.ok && <span className="field__ok !block w-full" role="status">{state.ok}</span>}
    </form>
  );
}
