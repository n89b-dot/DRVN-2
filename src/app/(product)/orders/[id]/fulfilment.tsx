"use client";

import { useState } from "react";

import { ConfirmDialog } from "@/components/ui";
import {
  markReceived,
  markShipped,
  requestCancellation,
  type CommerceState,
} from "@/features/commerce/actions";
import { useRecoverableAction } from "@/features/commerce/use-recoverable-action";

/** Seller dispatch. Tracking is required for posted goods — without it the
 *  buyer has no visibility, which is the entire point of the step. */
export function DispatchForm({ orderId, isCollection }: { orderId: string; isCollection: boolean }) {
  const [state, action, pending] = useRecoverableAction<CommerceState>(markShipped);
  const [carrier, setCarrier] = useState("");
  const [tracking, setTracking] = useState("");
  const label = isCollection ? "Mark ready for collection" : "Mark dispatched";

  return (
    <div className="grid gap-2">
      <ConfirmDialog
        title={isCollection ? "Mark ready for collection?" : "Mark this order as dispatched?"}
        consequences={[
          "Buyer will be notified",
          isCollection
            ? "Let them know when and where to collect it"
            : "Add tracking so delivery can be confirmed",
        ]}
        confirmLabel={pending ? "Saving…" : label}
        onSubmit={action}
        hidden={{ order_id: orderId }}
        pending={pending}
        error={state.error}
        triggerClassName="btn btn--live"
        fields={
          !isCollection && (
            <div className="field--row mt-3">
              <label className="field">
                <span className="field__label">Carrier</span>
                <input name="carrier" value={carrier} onChange={(event) => setCarrier(event.target.value)} disabled={pending} required className="ctl !max-w-none" placeholder="USPS, UPS, FedEx…" />
              </label>
              <label className="field">
                <span className="field__label">Tracking number</span>
                <input name="tracking_number" value={tracking} onChange={(event) => setTracking(event.target.value)} disabled={pending} required className="ctl !max-w-none" />
              </label>
            </div>
          )
        }
      >
        {label}
      </ConfirmDialog>
    </div>
  );
}

export function ReceivedButton({ orderId }: { orderId: string }) {
  const [state, action, pending] = useRecoverableAction<CommerceState>(markReceived);

  return (
    <div className="grid gap-2">
      <ConfirmDialog
        title="Mark this order as received?"
        consequences={[
          "Confirms the item arrived as purchased",
          "Starts the seller's payout clearing window",
          "Limits later dispute options — report problems first if something's wrong",
        ]}
        confirmLabel={pending ? "Confirming…" : "Mark as received"}
        onSubmit={action}
        hidden={{ order_id: orderId }}
        pending={pending}
        error={state.error}
        triggerClassName="btn btn--live"
      >
        Mark as received
      </ConfirmDialog>
    </div>
  );
}

export function CancelOrder({ orderId }: { orderId: string }) {
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
        triggerClassName="relbtn !static"
        fields={
          <label className="field mt-3">
            <span className="field__label">Reason (optional, recorded on the order)</span>
            <input name="reason" value={reason} onChange={(event) => setReason(event.target.value)} disabled={pending} className="ctl !max-w-none" maxLength={500} />
          </label>
        }
      >
        Cancel this order
      </ConfirmDialog>
    </div>
  );
}
