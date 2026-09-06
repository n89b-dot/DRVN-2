"use client";

import { useRef, useState } from "react";
import { unstable_rethrow } from "next/navigation";

import { MessageComposer } from "@/features/commerce/message-composer";
import { ConfirmDialog, Message, MessageThread } from "@/components/ui";
import {
  markReceived,
  markShipped,
  requestCancellation,
  type CommerceState,
} from "@/features/commerce/actions";

function useRecoverableOrderAction(action: (previous: CommerceState, data: FormData) => Promise<CommerceState>) {
  const [state, setState] = useState<CommerceState>({});
  const [pending, setPending] = useState(false);
  const submitting = useRef(false);
  async function submit(data: FormData) {
    if (submitting.current) return;
    submitting.current = true;
    setPending(true);
    setState({});
    try {
      setState(await action({}, data));
    } catch (error) {
      unstable_rethrow(error);
      setState({ error: "Couldn't confirm the update. Your details are still here; retry to check the saved result." });
    } finally {
      submitting.current = false;
      setPending(false);
    }
  }
  return [state, submit, pending] as const;
}

/** Seller dispatch. Tracking is required for posted goods — without it the
 *  buyer has no visibility, which is the entire point of the step. */
export function DispatchForm({ orderId, isCollection }: { orderId: string; isCollection: boolean }) {
  const [state, action, pending] = useRecoverableOrderAction(markShipped);
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
                <input name="carrier" value={carrier} onChange={(event) => setCarrier(event.target.value)} disabled={pending} required className="ctl !max-w-none" placeholder="Royal Mail" />
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
  const [state, action, pending] = useRecoverableOrderAction(markReceived);

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
  const [state, action, pending] = useRecoverableOrderAction(requestCancellation);

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

/** Post-sale thread, keyed to the order so buy-now purchases have a channel. */
export function OrderThread({
  orderId,
  currentUserId,
  messages,
}: {
  orderId: string;
  currentUserId: string;
  messages: { id: string; sender_id: string; sender_name: string; body: string; created_at: string }[];
}) {

  return (
    <div className="grid gap-3">
      {messages.length > 0 ? (
        <MessageThread>
          {messages.map((m) => (
            <Message
              key={m.id}
              me={m.sender_id === currentUserId}
              who={m.sender_id === currentUserId ? "You" : m.sender_name}
              body={m.body}
            />
          ))}
        </MessageThread>
      ) : (
        <p className="spec-note">
          No messages yet. Anything about delivery, fitment or condition belongs here — it stays
          attached to the order.
        </p>
      )}

      <MessageComposer orderId={orderId} />
    </div>
  );
}
