"use client";

import { useActionState, useState } from "react";

import {
  acceptRefund,
  closeDispute,
  offerRefund,
  openDispute,
  type CommerceState,
} from "@/features/commerce/actions";
import { DISPUTE_CATEGORIES } from "@/features/commerce/disputes";
import { formatPrice } from "@/lib/payments/fee";

function Result({ state }: { state: CommerceState }) {
  if (!state.error && !state.ok) return null;
  return (
    <p role="alert" aria-live="polite" className={state.error ? "field__err" : "chip chip--ok"}>
      {state.error ?? state.ok}
    </p>
  );
}

/** Buyer-only. Only rendered by the page once dispatch has happened and the
 *  order isn't already disputed/refunded/cancelled — see order/[id]/page.tsx. */
export function ReportProblemForm({ orderId }: { orderId: string }) {
  const [state, action, pending] = useActionState<CommerceState, FormData>(openDispute, {});
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="relbtn !static">
        Report a problem
      </button>
    );
  }

  return (
    <form action={action} className="grid gap-3">
      <input type="hidden" name="order_id" value={orderId} />
      <label className="field">
        <span className="field__label">What went wrong</span>
        <select name="category" required defaultValue="" className="ctl !max-w-none">
          <option value="" disabled>
            Choose one…
          </option>
          {DISPUTE_CATEGORIES.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span className="field__label">Details (optional)</span>
        <textarea
          name="reason"
          rows={4}
          maxLength={1000}
          placeholder="Anything that helps the seller understand what happened…"
          className="ctl"
        />
      </label>
      <div className="flex gap-2">
        <button type="submit" disabled={pending} className="btn btn--live">
          {pending ? "Opening…" : "Open dispute"}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="btn btn--ghost">
          Cancel
        </button>
      </div>
      <Result state={state} />
    </form>
  );
}

/** Seller-only. Offers a full or partial refund on a disputed order — money
 *  doesn't move until the buyer accepts. */
export function RefundOfferForm({
  orderId,
  totalCents,
}: {
  orderId: string;
  totalCents: number;
}) {
  const [state, action, pending] = useActionState<CommerceState, FormData>(offerRefund, {});

  if (state.ok) return <Result state={state} />;

  return (
    <form action={action} className="grid gap-3">
      <input type="hidden" name="order_id" value={orderId} />
      <p className="field__hint">
        Refunds are all-or-nothing: the buyer gets the full {formatPrice(totalCents)} back and the
        order closes as refunded.
      </p>
      <button type="submit" disabled={pending} className="btn btn--live">
        {pending ? "Sending…" : `Offer the full ${formatPrice(totalCents)} refund`}
      </button>
      <Result state={state} />
    </form>
  );
}

/** Buyer-only. Accepts the seller's outstanding refund offer. */
export function AcceptRefundButton({
  orderId,
  offerCents,
}: {
  orderId: string;
  offerCents: number;
}) {
  const [state, action, pending] = useActionState<CommerceState, FormData>(acceptRefund, {});

  return (
    <form action={action} className="grid gap-2">
      <input type="hidden" name="order_id" value={orderId} />
      <button type="submit" disabled={pending} className="btn btn--live">
        {pending ? "Confirming…" : `Accept ${formatPrice(offerCents)} refund`}
      </button>
      <Result state={state} />
    </form>
  );
}

/** Buyer-only. Closes the dispute with no refund — "resolved, no action
 *  needed". */
export function CloseDisputeButton({ orderId }: { orderId: string }) {
  const [state, action, pending] = useActionState<CommerceState, FormData>(closeDispute, {});

  return (
    <form action={action} className="grid gap-2">
      <input type="hidden" name="order_id" value={orderId} />
      <button type="submit" disabled={pending} className="btn btn--ghost">
        {pending ? "Closing…" : "Resolved — no action needed"}
      </button>
      <Result state={state} />
    </form>
  );
}
