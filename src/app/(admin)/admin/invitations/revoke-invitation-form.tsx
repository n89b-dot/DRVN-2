"use client";

import { useRef, useState, useTransition } from "react";
import { unstable_rethrow, useRouter } from "next/navigation";

import { Button } from "@/components/ui";

import { revokeBetaInvitation, type InvitationActionState } from "./actions";

export function RevokeInvitationForm({ invitationId, onRevoked }: { invitationId: string; onRevoked?: (reason: string) => void }) {
  const [state, setState] = useState<InvitationActionState>(null);
  const [pending, setPending] = useState(false);
  const submitting = useRef(false);
  const router = useRouter();
  // A transition, so a redirect the action already followed (MFA step-up)
  // lands in Next's redirect boundary instead of a second navigation.
  const [, startTransition] = useTransition();

  return (
    <form className="mt-3 flex flex-wrap gap-2" onSubmit={(event) => {
      event.preventDefault();
      if (submitting.current) return;
      const data = new FormData(event.currentTarget);
      submitting.current = true;
      setPending(true);
      setState(null);
      startTransition(async () => {
        try {
          const result = await revokeBetaInvitation(null, data);
          setState(result);
          if (result?.ok) {
            onRevoked?.(String(data.get("reason") ?? "").trim());
            router.refresh();
          }
        } catch (error) {
          unstable_rethrow(error);
          setState({ error: "Couldn't confirm revocation. Check the invitation status and retry if needed." });
          router.refresh();
        } finally {
          submitting.current = false;
          setPending(false);
        }
      });
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
