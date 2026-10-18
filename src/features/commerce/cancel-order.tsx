"use client";

import { useState } from "react";

import { ConfirmDialog } from "@/components/ui";
import { requestCancellation, type CommerceState } from "@/features/commerce/actions";
import { useRecoverableAction } from "@/features/commerce/use-recoverable-action";

/**
 * The seller's cancellation, behind its confirm. Used on the order page and,
 * as "Cancel before checkout", on an accepted offer — where it only shows
 * while settle_seller_cancellation can still succeed.
 */
export function CancelOrder({
  orderId,
  label = "Cancel this order",
  triggerClassName = "relbtn !static",
}: {
  orderId: string;
  label?: string;
  triggerClassName?: string;
}) {
  const [reason, setReason] = useState("");
  const [state, action, pending] = useRecoverableAction<CommerceState>(requestCancellation);

  return (
    <div className="grid gap-2">
      <ConfirmDialog
        title="Cancel this order?"
        destructive
        consequences={[
          "Refunds the buyer in full",
          "Returns this part to sale so it can be bought again",
          "Can't be undone once confirmed",
        ]}
        confirmLabel={pending ? "Cancelling…" : "Confirm cancellation"}
        onSubmit={action}
        hidden={{ order_id: orderId }}
        pending={pending}
        error={state.error}
        triggerClassName={triggerClassName}
        fields={
          <label className="field mt-3">
            <span className="field__label">Reason (optional, recorded on the order)</span>
            <input name="reason" value={reason} onChange={(event) => setReason(event.target.value)} disabled={pending} className="ctl !max-w-none" maxLength={500} />
          </label>
        }
      >
        {label}
      </ConfirmDialog>
    </div>
  );
}
