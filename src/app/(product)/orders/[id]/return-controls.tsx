"use client";

import { Button, TextArea, TextField } from "@/components/ui";
import { useRecoverableAction } from "@/features/commerce/use-recoverable-action";
import {
  cancelReturn,
  confirmReturnReceived,
  createReturnLabel,
  markReturnShipped,
  proposeReturn,
  reportReturnProblem,
  type ReturnState,
} from "@/features/commerce/return-actions";
import {
  approveShopReturn,
  rejectShopReturn,
  requestShopReturn,
} from "@/features/commerce/shop-actions";
import { formatPrice } from "@/lib/payments/fee";

/** Return/RMA controls on the order sheet (0055). Pure UI — every rule is
 *  re-checked server-side and in the database's transition guard. */

function Result({ state }: { state: ReturnState }) {
  if (!state.error && !state.ok) return null;
  return (
    <p
      role={state.error ? "alert" : "status"}
      aria-live="polite"
      className={state.error ? "field__err" : "chip chip--ok"}
    >
      {state.error ?? state.ok}
    </p>
  );
}

/** Seller, inside an open dispute: authorize return-for-refund (§25). */
export function ProposeReturnForm({
  orderId,
  items,
}: {
  orderId: string;
  items: { id: string; title: string; priceCents: number }[];
}) {
  const [state, action, pending] = useRecoverableAction<ReturnState>(proposeReturn);
  if (state.ok) return <Result state={state} />;

  return (
    <form onSubmit={(event) => { event.preventDefault(); void action(new FormData(event.currentTarget)); }} className="grid gap-2">
      <input type="hidden" name="order_id" value={orderId} />
      {items.length > 1 && (
        <fieldset className="grid gap-1 border-0 p-0">
          <legend className="field__hint mb-1">What&apos;s coming back?</legend>
          {items.map((item) => (
            <label key={item.id} className="flex items-center gap-2 text-micro">
              <input type="checkbox" name="item_id" value={item.id} defaultChecked className="sq" />
              <span className="min-w-0 truncate">
                {item.title} — {formatPrice(item.priceCents)}
              </span>
            </label>
          ))}
        </fieldset>
      )}
      <p className="field__hint">
        The buyer ships it back (label on you); the refund only moves once you
        have the part again — never before.
      </p>
      <Button type="submit" loading={pending} pendingLabel="Setting up…">
        Ask for the item back, then refund
      </Button>
      <Result state={state} />
    </form>
  );
}

/** Buyer, return awaiting shipment: DRVN label + manual tracking + withdraw. */
export function ReturnShippingPanel({
  returnId,
  sellerPaysPostage,
}: {
  returnId: string;
  sellerPaysPostage: boolean;
}) {
  const [labelState, labelAction, labelPending] = useRecoverableAction<ReturnState>(createReturnLabel);
  const [shipState, shipAction, shipPending] = useRecoverableAction<ReturnState>(markReturnShipped);
  const [cancelState, cancelAction, cancelPending] = useRecoverableAction<ReturnState>(cancelReturn);

  return (
    <div className="grid gap-4">
      {sellerPaysPostage && (
        <form onSubmit={(event) => { event.preventDefault(); void labelAction(new FormData(event.currentTarget)); }} className="grid gap-2">
          <input type="hidden" name="return_id" value={returnId} />
          <Button type="submit" variant="live" loading={labelPending} pendingLabel="Preparing…">
            Get a prepaid return label
          </Button>
          {labelState.labelUrl && (
            <a href={labelState.labelUrl} target="_blank" rel="noreferrer" className="jumplink">
              Print the return label →
            </a>
          )}
          <Result state={labelState} />
        </form>
      )}

      <form onSubmit={(event) => { event.preventDefault(); void shipAction(new FormData(event.currentTarget)); }} className="grid gap-2">
        <input type="hidden" name="return_id" value={returnId} />
        {!labelState.labelUrl && (
          <div className="grid gap-2 sm:grid-cols-2">
            <TextField
              id={`ret-carrier-${returnId}`}
              label="Carrier"
              name="carrier"
              placeholder="USPS"
              className="!max-w-none"
              fieldClassName="!mb-0"
            />
            <TextField
              id={`ret-tracking-${returnId}`}
              label="Tracking number"
              name="tracking_number"
              className="!max-w-none"
              fieldClassName="!mb-0"
            />
          </div>
        )}
        <Button type="submit" loading={shipPending} pendingLabel="Saving…">
          {labelState.labelUrl ? "I've shipped it" : "Add tracking — it's shipped"}
        </Button>
        <Result state={shipState} />
      </form>

      <form onSubmit={(event) => { event.preventDefault(); void cancelAction(new FormData(event.currentTarget)); }}>
        <input type="hidden" name="return_id" value={returnId} />
        <button type="submit" disabled={cancelPending} className="jumplink">
          {cancelPending ? "Withdrawing…" : "Changed your mind? Withdraw the return"}
        </button>
        <Result state={cancelState} />
      </form>
    </div>
  );
}

/** Seller, return delivered/in transit: confirm or contest (§27/§29). */
export function ReturnInspectionPanel({ returnId }: { returnId: string }) {
  const [confirmState, confirmAction, confirmPending] = useRecoverableAction<ReturnState>(confirmReturnReceived);
  const [problemState, problemAction, problemPending] = useRecoverableAction<ReturnState>(reportReturnProblem);

  return (
    <div className="grid gap-4">
      <form onSubmit={(event) => { event.preventDefault(); void confirmAction(new FormData(event.currentTarget)); }} className="grid gap-2">
        <input type="hidden" name="return_id" value={returnId} />
        <Button type="submit" variant="live" loading={confirmPending} pendingLabel="Confirming…">
          It&apos;s back and as expected — refund the buyer
        </Button>
        <Result state={confirmState} />
      </form>

      <details>
        <summary className="jumplink cursor-pointer">
          Wrong item, damaged, or not what you sent?
        </summary>
        <form onSubmit={(event) => { event.preventDefault(); void problemAction(new FormData(event.currentTarget)); }} className="mt-3 grid gap-2">
          <input type="hidden" name="return_id" value={returnId} />
          <TextArea
            id={`ret-problem-${returnId}`}
            label="What's wrong with what came back"
            name="note"
            rows={3}
            required
            className="!max-w-none"
            fieldClassName="!mb-0"
            hint="Add photos to the dispute evidence above too — DRVN reviews before any refund moves."
          />
          <Button type="submit" loading={problemPending} pendingLabel="Flagging…">
            Flag it for DRVN review
          </Button>
          <Result state={problemState} />
        </form>
      </details>
    </div>
  );
}

/** Buyer, delivered order under a frozen shop policy (§24B): open a
 *  preference return. Postage is on the buyer; original shipping stays. */
export function RequestShopReturnForm({
  orderId,
  windowDays,
  deadline,
}: {
  orderId: string;
  windowDays: number;
  deadline: string;
}) {
  const [state, action, pending] = useRecoverableAction<ReturnState>(requestShopReturn);
  if (state.ok) return <Result state={state} />;

  return (
    <form onSubmit={(event) => { event.preventDefault(); void action(new FormData(event.currentTarget)); }} className="grid gap-2">
      <input type="hidden" name="order_id" value={orderId} />
      <p className="field__hint">
        This shop takes change-of-mind returns for {windowDays} days after
        delivery — until {new Date(deadline).toLocaleDateString()}. You pay the
        return postage; the item price comes back once it&apos;s received.
      </p>
      <TextField
        id={`shop-return-reason-${orderId}`}
        label="Why it's coming back (optional)"
        name="reason"
        className="!max-w-none"
        fieldClassName="!mb-0"
      />
      <Button type="submit" loading={pending} pendingLabel="Requesting…">
        Request a return
      </Button>
      <Result state={state} />
    </form>
  );
}

/** Shop, a requested preference return: approve or decline (§24B). */
export function ShopReturnApprovalPanel({ returnId }: { returnId: string }) {
  const [approveState, approveAction, approvePending] = useRecoverableAction<ReturnState>(approveShopReturn);
  const [rejectState, rejectAction, rejectPending] = useRecoverableAction<ReturnState>(rejectShopReturn);

  return (
    <div className="grid gap-3">
      <form onSubmit={(event) => { event.preventDefault(); void approveAction(new FormData(event.currentTarget)); }} className="grid gap-2">
        <input type="hidden" name="return_id" value={returnId} />
        <Button type="submit" variant="live" loading={approvePending} pendingLabel="Approving…">
          Approve the return
        </Button>
        <Result state={approveState} />
      </form>
      <form onSubmit={(event) => { event.preventDefault(); void rejectAction(new FormData(event.currentTarget)); }}>
        <input type="hidden" name="return_id" value={returnId} />
        <button type="submit" disabled={rejectPending} className="jumplink">
          {rejectPending ? "Declining…" : "Decline this request"}
        </button>
        <Result state={rejectState} />
      </form>
    </div>
  );
}
