"use client";

import { loadStripe } from "@stripe/stripe-js";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState } from "react";

import { payWithSavedCard, type SavedCardPayState } from "@/features/commerce/payment-methods";
import type { SavedCard } from "@/lib/payments/customers";

import { PaymentConfirm } from "../cart/payment-confirm";

/**
 * P21 payment step when the buyer has saved cards: radio rows first
 * (Preply/KAYAK shape), "use a new card" swaps to the Payment Element.
 * Saved-card confirmation runs server-side; 3DS falls back to
 * handleNextAction in the browser.
 */
export function SavedCardPay({
  savedCards,
  clientSecret,
  orderIds,
  total,
}: {
  savedCards: SavedCard[];
  clientSecret: string;
  orderIds: string[];
  total: string;
}) {
  const router = useRouter();
  const [useNewCard, setUseNewCard] = useState(false);
  const [selected, setSelected] = useState(savedCards[0]?.id ?? "");
  const [state, action, pending] = useActionState<SavedCardPayState, FormData>(
    payWithSavedCard,
    {}
  );

  // The PaymentIntent reference is the client secret's prefix.
  const reference = clientSecret.split("_secret")[0];

  useEffect(() => {
    if (!state.completeUrl) return;
    if (!state.actionClientSecret) {
      router.push(state.completeUrl);
      return;
    }
    // 3DS on a saved card: run the challenge, then land on the verifier.
    (async () => {
      const stripe = await loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? "");
      if (!stripe) return;
      await stripe.handleNextAction({ clientSecret: state.actionClientSecret! });
      router.push(state.completeUrl!);
    })();
  }, [state.completeUrl, state.actionClientSecret, router]);

  if (useNewCard) {
    return (
      <div className="grid gap-3">
        <PaymentConfirm clientSecret={clientSecret} orderIds={orderIds} total={total} canSaveCard />
        <button type="button" onClick={() => setUseNewCard(false)} className="jumplink text-left">
          ← Use a saved card
        </button>
      </div>
    );
  }

  return (
    <form action={action} className="grid gap-3">
      <span className="microlabel microlabel--ink">Payment</span>
      <input type="hidden" name="reference" value={reference} />
      <input type="hidden" name="orders" value={orderIds.join(",")} />
      <input type="hidden" name="payment_method_id" value={selected} />

      <div className="rowlist">
        {savedCards.map((card) => (
          <label key={card.id} className="order cursor-pointer">
            <input
              type="radio"
              name="card_choice"
              checked={selected === card.id}
              onChange={() => setSelected(card.id)}
              className="accent-live"
            />
            <span className="min-w-0">
              <span className="order__name block uppercase">
                {card.kind === "link" ? "Link" : `${card.brand} •••• ${card.last4}`}
              </span>
              <span className="order__meta block truncate">
                {card.kind === "link"
                  ? (card.email ?? "Stripe Link wallet")
                  : `Expires ${String(card.expMonth).padStart(2, "0")}/${String(card.expYear).slice(-2)}`}
              </span>
            </span>
          </label>
        ))}
      </div>

      <button type="button" onClick={() => setUseNewCard(true)} className="jumplink text-left">
        + Use a new card
      </button>

      {state.error && (
        <p role="alert" aria-live="polite" className="field__err">
          {state.error}
        </p>
      )}

      <button type="submit" disabled={pending || !selected} className="btn btn--live w-full">
        {pending ? "Confirming…" : `Pay ${total}`}
      </button>
    </form>
  );
}
