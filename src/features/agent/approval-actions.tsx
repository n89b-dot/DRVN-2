"use client";

import { Button, ButtonLink, ResultNote } from "@/components/ui";
import { useRecoverableAction } from "@/features/commerce/use-recoverable-action";
import { formatPrice } from "@/lib/marketplace/taxonomy";

import { decideAgentApproval, type AgentState } from "./actions";

/**
 * A Needs you row's one action: accept what the agent recommended, or open
 * the offer to counter yourself. Accepting is a sale, so it is the owner's
 * tap, never the agent's.
 */
export function ApprovalActions({ approvalId, offerId, amountCents }: { approvalId: string; offerId: string | null; amountCents: number | null }) {
  const [state, submit, pending] = useRecoverableAction<AgentState>(decideAgentApproval);
  const decide = (choice: "accept" | "dismiss") => {
    const data = new FormData();
    data.set("approval_id", approvalId);
    data.set("choice", choice);
    submit(data);
  };
  if (state.ok) return <ResultNote ok={state.ok} />;
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <Button variant="live" onClick={() => decide("accept")} loading={pending} pendingLabel="Accepting…">
        {amountCents != null ? `Accept ${formatPrice(amountCents)}` : "Accept"}
      </Button>
      {offerId && (
        <ButtonLink href={`/offers/${offerId}`} variant="ghost">
          Counter
        </ButtonLink>
      )}
      <ResultNote error={state.error} />
    </div>
  );
}
