"use client";

import { useActionState } from "react";

import { ConfirmDialog } from "@/components/ui";
import {
  markReceived,
  markShipped,
  requestCancellation,
  sendThreadMessage,
  type CommerceState,
} from "@/features/commerce/actions";

function Result({ state }: { state: CommerceState }) {
  if (!state.error && !state.ok) return null;
  return (
    <p role="alert" aria-live="polite" className={state.error ? "field__err" : "chip chip--ok"}>
      {state.error ?? state.ok}
    </p>
  );
}

/** Seller dispatch. Tracking is required for posted goods — without it the
 *  buyer has no visibility, which is the entire point of the step. */
export function DispatchForm({ orderId, isCollection }: { orderId: string; isCollection: boolean }) {
  const [state, action, pending] = useActionState<CommerceState, FormData>(markShipped, {});
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
        formAction={action}
        hidden={{ order_id: orderId }}
        pending={pending}
        error={state.error}
        triggerClassName="btn btn--live"
        fields={
          !isCollection && (
            <div className="field--row mt-3">
              <label className="field">
                <span className="field__label">Carrier</span>
                <input name="carrier" required className="ctl !max-w-none" placeholder="Royal Mail" />
              </label>
              <label className="field">
                <span className="field__label">Tracking number</span>
                <input name="tracking_number" required className="ctl !max-w-none" />
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
  const [state, action, pending] = useActionState<CommerceState, FormData>(markReceived, {});

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
        formAction={action}
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
  const [state, action, pending] = useActionState<CommerceState, FormData>(
    requestCancellation,
    {}
  );

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
        formAction={action}
        hidden={{ order_id: orderId }}
        pending={pending}
        error={state.error}
        triggerClassName="relbtn !static"
        fields={
          <label className="field mt-3">
            <span className="field__label">Reason (optional, recorded on the order)</span>
            <input name="reason" className="ctl !max-w-none" maxLength={500} />
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
  const [state, action, pending] = useActionState<CommerceState, FormData>(sendThreadMessage, {});

  return (
    <div className="grid gap-3">
      {messages.length > 0 ? (
        <div className="thread">
          {messages.map((m) => (
            <div
              key={m.id}
              className={`msg ${m.sender_id === currentUserId ? "msg--me" : ""}`}
            >
              <span className="msg__who">
                {m.sender_id === currentUserId ? "You" : m.sender_name}
              </span>
              <p className="msg__body">{m.body}</p>
            </div>
          ))}
        </div>
      ) : (
        <p className="spec-note">
          No messages yet. Anything about delivery, fitment or condition belongs here — it stays
          attached to the order.
        </p>
      )}

      <form action={action} className="composer__row">
        <input type="hidden" name="order_id" value={orderId} />
        <input
          name="body"
          required
          maxLength={4000}
          placeholder="Message the other party…"
          className="ctl max-w-none flex-1 !py-2"
        />
        <button type="submit" disabled={pending} className="btn btn--ghost !py-2.5">
          {pending ? "Sending…" : "Send"}
        </button>
      </form>
      <Result state={state} />
    </div>
  );
}
