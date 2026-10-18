"use client";

import { useState } from "react";

import { ConfirmDialog } from "@/components/ui";
import {
  markReceived,
  markShipped,
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
          "Tells DRVN to pay the seller",
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

