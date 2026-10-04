"use client";

import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { loadStripe } from "@stripe/stripe-js";
import { unstable_rethrow, useRouter } from "next/navigation";
import { useActionState, useMemo, useRef, useState, useTransition } from "react";

import {
  createCardSetupIntent,
  removeSavedCard,
} from "@/features/commerce/payment-methods";
import type { CommerceState } from "@/features/commerce/actions";
import type { SavedCard } from "@/lib/payments/customers";
import { Dialog, ObjectRow, Toast } from "@/components/ui";

import { setupAlreadySaved } from "./card-setup";

/**
 * P22 — saved cards in Settings. Reference pass: Preply (concise section),
 * KAYAK (row actions), Link (wallet list). Row shape:
 * brand · •••• last4 · MM/YY · Remove. Add opens a sheet with a SetupIntent.
 */
export function PaymentMethods({ cards }: { cards: SavedCard[] }) {
  const router = useRouter();
  const [removeState, removeAction, removing] = useActionState<CommerceState, FormData>(
    removeSavedCard,
    {}
  );
  const [adding, setAdding] = useState(false);
  const [setupSecret, setSetupSecret] = useState<string | null>(null);
  const [setupError, setSetupError] = useState<string | null>(null);
  const [savedToast, setSavedToast] = useState(false);
  // A transition, so a redirect the action already followed (a session that
  // ended server-side) lands in Next's redirect boundary instead of a second
  // navigation. The ref stops a double click from starting two setups before
  // `starting` renders.
  const [starting, startTransition] = useTransition();
  const startingRef = useRef(false);

  function startAdd() {
    if (startingRef.current) return;
    startingRef.current = true;
    setSetupError(null);
    startTransition(async () => {
      try {
        const result = await createCardSetupIntent();
        if (result.clientSecret) {
          setSetupSecret(result.clientSecret);
          setAdding(true);
        } else {
          setSetupError(result.error ?? "Couldn't start card setup.");
        }
      } catch (error) {
        unstable_rethrow(error);
        setSetupError("Couldn't start card setup. Check your connection and try again.");
      } finally {
        startingRef.current = false;
      }
    });
  }

  return (
    <div className="mt-4 border-t border-[color:var(--rule-soft)] pt-4">
      <span className="microlabel microlabel--ink">Payment methods</span>

      {cards.length === 0 ? (
        <p className="field__hint mt-2">
          No saved cards. Cards you save at checkout appear here.
        </p>
      ) : (
        <div className="rowlist mt-2">
          {cards.map((card) => (
            <ObjectRow
              key={card.id}
              actions={
                <form action={removeAction}>
                  <input type="hidden" name="payment_method_id" value={card.id} />
                  <button type="submit" disabled={removing} className="relbtn !static">
                    Remove
                  </button>
                </form>
              }
            >
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
            </ObjectRow>
          ))}
        </div>
      )}

      <button type="button" onClick={startAdd} disabled={starting} className="jumplink mt-3 text-left">
        {starting ? "Starting…" : "+ Add a card"}
      </button>
      <p className="field__hint mt-2">
        Card details are held by Stripe — DRVN never sees them.
      </p>

      {setupError && (
        <p role="alert" aria-live="polite" className="field__err">
          {setupError}
        </p>
      )}
      {removeState.error && (
        <p role="alert" aria-live="polite" className="field__err">
          {removeState.error}
        </p>
      )}
      {removeState.ok && <Toast key={cards.length} message="Card removed" />}
      {savedToast && <Toast message="Card saved ✓" onDone={() => setSavedToast(false)} />}

      {/* Shared Dialog primitive: dialog role, Escape, focus trap, scroll
          lock — the hand-rolled sheetwrap had none of the four. */}
      <Dialog
        open={Boolean(adding && setupSecret)}
        onClose={() => setAdding(false)}
        label="Add a card"
      >
        <div className="sheet">
          <span className="microlabel microlabel--ink">Add a card</span>
          {setupSecret && (
            <AddCardForm
              clientSecret={setupSecret}
              onSaved={() => {
                setAdding(false);
                setSetupSecret(null);
                setSavedToast(true);
                router.refresh();
              }}
              onClose={() => setAdding(false)}
            />
          )}
        </div>
      </Dialog>
    </div>
  );
}

function AddCardForm({
  clientSecret,
  onSaved,
  onClose,
}: {
  clientSecret: string;
  onSaved: () => void;
  onClose: () => void;
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
      options={{ clientSecret, appearance: { theme: night ? "night" : "stripe" } }}
    >
      <AddCardInner onSaved={onSaved} onClose={onClose} />
    </Elements>
  );
}

function AddCardInner({ onSaved, onClose }: { onSaved: () => void; onClose: () => void }) {
  const stripe = useStripe();
  const elements = useElements();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // `disabled` only lands on the next render; a quick second submit must not
  // start a second confirmation.
  const inFlight = useRef(false);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!stripe || !elements || inFlight.current) return;
    inFlight.current = true;
    setSubmitting(true);
    setError(null);
    try {
      const { error: setupError } = await stripe.confirmSetup({
        elements,
        redirect: "if_required",
      });
      if (setupError && !setupAlreadySaved(setupError)) {
        setError(setupError.message ?? "Couldn't save the card.");
        return;
      }
      onSaved();
    } catch {
      // Stripe.js itself failed (usually the network). Confirming the same
      // SetupIntent again can't add the card twice: if it was saved, the
      // retry is refused and counted as saved above.
      setError("We couldn't reach the payment provider. Try again — the card can only be added once.");
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={save} className="mt-4 grid gap-4">
      <PaymentElement />
      {error && (
        <p role="alert" aria-live="polite" className="field__err">
          {error}
        </p>
      )}
      <div className="sheet__actions">
        <button type="submit" disabled={submitting || !stripe} className="btn btn--live flex-1">
          {submitting ? "Saving…" : "Save card"}
        </button>
        <button type="button" onClick={onClose} className="btn btn--ghost">
          Close
        </button>
      </div>
    </form>
  );
}
