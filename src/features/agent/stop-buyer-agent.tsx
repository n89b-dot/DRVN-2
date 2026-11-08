"use client";

import { buttonClass, ConfirmDialog, ResultNote } from "@/components/ui";
import { useRecoverableAction } from "@/features/commerce/use-recoverable-action";

import { stopBuyerAgent, type AgentState } from "./actions";
import { useStopNotice } from "./stop-notice";

/**
 * "Stop negotiating for me" (readiness 64): the buyer's way out of a running
 * "Negotiate for me", on the offer page and on /agent. Behind the shared
 * confirm, because it ends the mandate for good (a new one can be started
 * from the listing). Offers already sent stand: they were the buyer's.
 */
export function StopBuyerAgent({
  mandateId,
  offerId,
  compact = false,
  live = true,
}: {
  mandateId: string;
  /** The offer the control sits on, so its page refreshes too. */
  offerId?: string | null;
  /** In a row's action slot: a ghost button rather than the destructive one. */
  compact?: boolean;
  /**
   * Whether the mandate is still running. The stop revalidates the page it
   * sits on, so its Server Action response carries that page with the
   * mandate revoked alongside "Stopped.". A caller that dropped the control
   * then unmounted the result with it, and "Stopped." showed only if React
   * committed it before that tree. So callers keep this mounted across the
   * stop, and a stopped mandate shows only this visit's result, or nothing.
   */
  live?: boolean;
}) {
  // Under StopNotices (/agent), the result goes to the page's slot: the row
  // this sits on moves or goes when the page comes back stopped. The page's
  // setter outlives this component, so the hand-off holds even when that
  // tree lands before the result does.
  const notice = useStopNotice();
  const [state, submit, pending] = useRecoverableAction<AgentState>(
    async (previous, data) => {
      const result = await stopBuyerAgent(previous, data);
      if (result.ok) notice?.(result.ok);
      return result;
    },
    "Couldn't confirm your agent stopped. Check Agent before trying again.",
  );
  if (state.ok) return notice ? null : <ResultNote ok={state.ok} />;
  // Stopped (here or elsewhere): nothing left to stop, and any error or
  // lost-response notice is answered by the page that now says so.
  if (!live) return null;
  return (
    <div className={compact ? "flex flex-wrap items-center justify-end gap-2" : "grid gap-2"}>
      <ConfirmDialog
        title="Stop negotiating for me?"
        destructive={!compact}
        consequences={[
          "Your agent makes no more offers or counters on this part",
          "An offer it already sent stands until it expires or the seller answers",
          "You can start it again from the listing",
        ]}
        confirmLabel={pending ? "Stopping…" : "Stop my agent"}
        onSubmit={submit}
        hidden={{ mandate_id: mandateId, ...(offerId ? { offer_id: offerId } : {}) }}
        pending={pending}
        error={state.error}
        triggerClassName={buttonClass(compact ? "ghost" : "destructive", compact ? undefined : "justify-self-start")}
      >
        Stop negotiating for me
      </ConfirmDialog>
    </div>
  );
}
