"use client";

import { useActionState, useState } from "react";

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

  return (
    <form action={action} className="grid gap-3">
      <input type="hidden" name="order_id" value={orderId} />
      {!isCollection && (
        <div className="field--row">
          <label className="field">
            <span className="field__label">Carrier</span>
            <input name="carrier" required className="ctl !max-w-none" placeholder="Royal Mail" />
          </label>
          <label className="field">
            <span className="field__label">Tracking number</span>
            <input name="tracking_number" required className="ctl !max-w-none" />
          </label>
        </div>
      )}
      <button type="submit" disabled={pending} className="btn btn--live">
        {pending ? "Saving…" : isCollection ? "Mark ready for collection" : "Mark dispatched"}
      </button>
      <Result state={state} />
    </form>
  );
}

export function ReceivedButton({ orderId }: { orderId: string }) {
  const [state, action, pending] = useActionState<CommerceState, FormData>(markReceived, {});

  return (
    <form action={action} className="grid gap-2">
      <input type="hidden" name="order_id" value={orderId} />
      <button type="submit" disabled={pending} className="btn btn--live">
        {pending ? "Confirming…" : "Mark as received"}
      </button>
      <Result state={state} />
    </form>
  );
}

export function CancelOrder({ orderId }: { orderId: string }) {
  const [state, action, pending] = useActionState<CommerceState, FormData>(
    requestCancellation,
    {}
  );
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="relbtn !static">
        Cancel this order
      </button>
    );
  }

  return (
    <form action={action} className="grid gap-2">
      <input type="hidden" name="order_id" value={orderId} />
      <label className="field">
        <span className="field__label">Reason (optional)</span>
        <input name="reason" className="ctl !max-w-none" maxLength={500} />
      </label>
      <div className="flex gap-2">
        <button type="submit" disabled={pending} className="btn btn--live">
          {pending ? "Cancelling…" : "Confirm cancellation"}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="btn btn--ghost">
          Keep it
        </button>
      </div>
      <Result state={state} />
    </form>
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
