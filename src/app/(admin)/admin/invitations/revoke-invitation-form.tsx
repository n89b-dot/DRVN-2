"use client";

import { useRef, useState } from "react";
import { unstable_rethrow, useRouter } from "next/navigation";

import { Button } from "@/components/ui";

import { revokeBetaInvitation, type InvitationActionState } from "./actions";

export function RevokeInvitationForm({ invitationId }: { invitationId: string }) {
  const [state, setState] = useState<InvitationActionState>(null);
  const [pending, setPending] = useState(false);
  const submitting = useRef(false);
  const router = useRouter();

  return (
    <form className="mt-3 flex flex-wrap gap-2" onSubmit={async (event) => {
      event.preventDefault();
      if (submitting.current) return;
      const data = new FormData(event.currentTarget);
      submitting.current = true;
      setPending(true);
      setState(null);
      try {
        setState(await revokeBetaInvitation(null, data));
      } catch (error) {
        unstable_rethrow(error);
        setState({ error: "Couldn't confirm revocation. Check the invitation status and retry if needed." });
        router.refresh();
      } finally {
        submitting.current = false;
        setPending(false);
      }
    }}>
      <input type="hidden" name="invitation_id" value={invitationId} />
      <input
        className="ctl min-w-[220px] flex-1"
        name="reason"
        disabled={pending}
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
