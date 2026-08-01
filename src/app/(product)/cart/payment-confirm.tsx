"use client";

import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { loadStripe } from "@stripe/stripe-js";
import { useMemo, useState } from "react";

import { saveCardOnIntent } from "@/features/commerce/payment-methods";

/**
 * The browser half of an async payment: `purchase_begin` reserved the parts
 * and the server minted a PaymentIntent — this confirms it. On success Stripe
 * redirects to /cart/complete, which verifies the outcome server-side, clears
 * the bought items from the cart, and lands on the order. The webhook is the
 * settlement authority either way; this component never marks anything paid.
 */
export function PaymentConfirm({
  clientSecret,
  orderIds,
  total,
  canSaveCard = false,
}: {
  clientSecret: string;
  orderIds: string[];
  total: string;
  /** Offer "save this card" (P21) — flags the intent before confirming. */
  canSaveCard?: boolean;
}) {
  const stripePromise = useMemo(
    () => loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? ""),
    []
  );
  const night =
    typeof document !== "undefined" && document.documentElement.dataset.theme === "dark";

  return (
    <Elements
      stripe={stripePromise}
      options={{
        clientSecret,
        appearance: { theme: night ? "night" : "stripe" },
      }}
    >
      <ConfirmInner
        orderIds={orderIds}
        total={total}
        reference={clientSecret.split("_secret")[0]}
        canSaveCard={canSaveCard}
      />
    </Elements>
  );
}

function ConfirmInner({
  orderIds,
  total,
  reference,
  canSaveCard,
}: {
  orderIds: string[];
  total: string;
  reference: string;
  canSaveCard: boolean;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [submitting, setSubmitting] = useState(false);
  const [saveCard, setSaveCard] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm(event: React.FormEvent) {
    event.preventDefault();
    if (!stripe || !elements) return;
    setSubmitting(true);
    setError(null);

    if (canSaveCard && saveCard) {
      // Flag the intent before confirming so Stripe attaches the card to the
      // customer on success.
      const fd = new FormData();
      fd.set("reference", reference);
      await saveCardOnIntent(fd);
    }

    const { error: confirmError } = await stripe.confirmPayment({
      elements,
      confirmParams: {
        return_url: `${window.location.origin}/cart/complete?orders=${orderIds.join(",")}`,
      },
    });
    // Only reached on immediate failure — success navigates away.
    if (confirmError) {
      setError(confirmError.message ?? "Payment failed. Try another card.");
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={confirm} className="mt-4 grid gap-4">
      <span className="microlabel microlabel--ink">Payment</span>
      <PaymentElement />
      {canSaveCard && (
        <label className="flex items-center gap-2 text-[13px]">
          <input
            type="checkbox"
            checked={saveCard}
            onChange={(event) => setSaveCard(event.target.checked)}
            className="accent-live"
          />
          Save this card for next time
        </label>
      )}
      {error && (
        <p role="alert" aria-live="polite" className="field__err">
          {error}
        </p>
      )}
      <button type="submit" disabled={submitting || !stripe} className="btn btn--live w-full">
        {submitting ? "Confirming…" : `Pay ${total}`}
      </button>
      <p className="field__hint">
        The parts are held for you while you pay. Card details go straight to Stripe — DRVN never
        sees them.
      </p>
    </form>
  );
}
