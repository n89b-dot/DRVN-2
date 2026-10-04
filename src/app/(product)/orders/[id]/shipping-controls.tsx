"use client";

import { motion } from "motion/react";

import { Button, ButtonLink, ResultNote, UnconfirmedOutcome } from "@/components/ui";
import { useRecoverableAction } from "@/features/commerce/use-recoverable-action";
import { springs, transitions } from "@/lib/motion";
import {
  buyShippingLabel,
  voidShippingLabel,
  type FulfillmentState,
} from "@/features/commerce/fulfillment-actions";
import { formatPrice } from "@/lib/payments/fee";

/**
 * Seller-side DRVN Shipping controls on the order sheet (§15.10-12).
 * The label URL only ever reaches this component server-side for the seller —
 * shipments' label_reference is not client-readable by column grant (0052).
 *
 * Both actions move money, so a lost response never puts the button back:
 * the seller reloads to see whether the label was bought (or voided) first.
 */
const BUY_UNCONFIRMED = "Couldn't confirm whether the label was bought. Reload to check before buying again.";
const VOID_UNCONFIRMED = "Couldn't confirm whether the label was voided. Reload to check before trying again.";

export function BuyLabelPanel({
  orderId,
  quotedCents,
}: {
  orderId: string;
  quotedCents: number | null;
}) {
  const [state, action, pending] = useRecoverableAction<FulfillmentState>(
    buyShippingLabel,
    BUY_UNCONFIRMED
  );
  if (state.error === BUY_UNCONFIRMED) return <UnconfirmedOutcome>{BUY_UNCONFIRMED}</UnconfirmedOutcome>;
  return (
    <form action={action} className="grid gap-2">
      <input type="hidden" name="order_id" value={orderId} />
      <p className="spec-note">
        The buyer already paid{quotedCents != null ? ` ${formatPrice(quotedCents)}` : ""} for
        this shipping — the label cost nets out of your payout against it.
      </p>
      <Button type="submit" variant="live" loading={pending} pendingLabel="Buying label…">
        Buy shipping label
      </Button>
      {state.labelUrl && (
        // The bought label settling in is the payoff of the purchase action.
        <motion.a
          href={state.labelUrl}
          target="_blank"
          rel="noreferrer"
          className="jumplink"
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0, transition: { ...springs.responsive, opacity: transitions.fast } }}
        >
          Print the label →
        </motion.a>
      )}
      <ResultNote error={state.error} ok={!state.error ? state.ok : null} />
    </form>
  );
}

export function LabelReadyPanel({
  shipmentId,
  labelUrl,
  trackingCode,
  carrier,
}: {
  shipmentId: string;
  labelUrl: string | null;
  trackingCode: string | null;
  carrier: string | null;
}) {
  const [state, action, pending] = useRecoverableAction<FulfillmentState>(
    voidShippingLabel,
    VOID_UNCONFIRMED
  );
  const unconfirmed = state.error === VOID_UNCONFIRMED;
  return (
    <div className="grid gap-2">
      {labelUrl && (
        <ButtonLink href={labelUrl} target="_blank" rel="noreferrer" variant="ghost">
          Print the label
        </ButtonLink>
      )}
      {trackingCode && (
        <p className="spec-note">
          {carrier ?? "Carrier"} · {trackingCode} — tracking attaches to this order
          automatically.
        </p>
      )}
      {unconfirmed ? (
        <UnconfirmedOutcome>{VOID_UNCONFIRMED}</UnconfirmedOutcome>
      ) : (
        <>
          <form action={action}>
            <input type="hidden" name="shipment_id" value={shipmentId} />
            <button type="submit" disabled={pending} className="jumplink">
              {pending ? "Voiding…" : "Bought by mistake? Void the label"}
            </button>
          </form>
          <ResultNote error={state.error} ok={!state.error ? state.ok : null} />
        </>
      )}
    </div>
  );
}
