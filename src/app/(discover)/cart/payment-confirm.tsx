"use client";

import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { loadStripe } from "@stripe/stripe-js";
import { useMemo, useState } from "react";

import { saveCardOnIntent } from "@/features/commerce/payment-methods";

/** Livesheet tokens → Stripe appearance. Reads the computed CSS custom
 *  properties so the iframe follows any palette retune; hexes are only the
 *  SSR-safe fallbacks. */
function appearanceFromTokens(night: boolean) {
  const token = (name: string, fallback: string) =>
    typeof document !== "undefined"
      ? getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback
      : fallback;
  const live = token("--live", night ? "#ff4530" : "#c02c14");
  const dim = token("--dim", night ? "#8a909b" : "#565963");
  return {
    theme: (night ? "night" : "stripe") as "night" | "stripe",
    variables: {
      colorPrimary: live,
      colorBackground: token("--paper-deep", night ? "#0c0e11" : "#e5e2d8"),
      colorText: token("--ink", night ? "#eceef2" : "#20232a"),
      colorTextSecondary: dim,
      colorDanger: live,
      borderRadius: "10px",
      fontSizeBase: "16px",
    },
    rules: {
      ".Input": { border: "1px solid transparent", boxShadow: "none" },
      ".Input:focus": {
        border: "1px solid transparent",
        boxShadow: `0 0 0 2px ${live}`,
      },
      ".Label": {
        fontSize: "12px",
        textTransform: "uppercase",
        letterSpacing: "0.14em",
        color: dim,
      },
    },
  };
}

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
        // The card field is the most consequential input in the product —
        // themed to the Livesheet tokens instead of Stripe's defaults so it
        // matches .ctl (paper-deep ground, 10px radius, live focus ring).
        // Tokens are read from the live stylesheet (CSS vars can't cross into
        // Stripe's iframe), so a palette retune carries over automatically.
        appearance: appearanceFromTokens(night),
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
        <label className="flex items-center gap-2 text-micro">
          <input
            type="checkbox"
            checked={saveCard}
            onChange={(event) => setSaveCard(event.target.checked)}
            className="sq"
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
