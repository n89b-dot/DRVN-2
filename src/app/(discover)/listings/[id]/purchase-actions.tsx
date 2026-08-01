"use client";

import { useRouter } from "next/navigation";
import { useActionState, useId, useState, useTransition } from "react";

import {
  addToCart,
  buyNow,
  makeOffer,
  type CommerceState,
} from "@/features/commerce/actions";
import { Dialog, Toast } from "@/components/ui";

export function PurchaseActions({
  listingId,
  isLoggedIn,
  isOwn,
  isActive,
}: {
  listingId: string;
  isLoggedIn: boolean;
  isOwn: boolean;
  isActive: boolean;
}) {
  const router = useRouter();
  const idBase = useId();
  const [offerOpen, setOfferOpen] = useState(false);
  const [offerState, offerAction, offerPending] = useActionState<CommerceState, FormData>(makeOffer, {});
  const [pending, startTransition] = useTransition();
  const [cartState, setCartState] = useState<CommerceState | null>(null);

  if (isOwn || !isActive) return null;

  function guard(run: () => void) {
    if (!isLoggedIn) {
      router.push(`/login?next=${encodeURIComponent(`/listings/${listingId}`)}`);
      return;
    }
    run();
  }

  return (
    <div className="mt-5 flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            guard(() =>
              startTransition(async () => {
                const fd = new FormData();
                fd.set("listing_id", listingId);
                await buyNow(fd);
              })
            )
          }
          className="btn btn--live flex-1"
        >
          {pending ? "Processing…" : "Buy now"}
        </button>
        <button
          type="button"
          onClick={() => guard(() => setOfferOpen(true))}
          className="btn btn--ghost flex-1"
        >
          Make an offer
        </button>
      </div>
      {cartState?.ok ? (
        <a href="/cart" className="btn btn--ghost">
          In cart ✓ — view cart
        </a>
      ) : (
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            guard(() =>
              startTransition(async () => {
                const fd = new FormData();
                fd.set("listing_id", listingId);
                const result = await addToCart(fd);
                setCartState(result);
                // Refresh the shell so the cart badge count updates in place.
                if (result.ok) router.refresh();
              })
            )
          }
          className="btn btn--ghost"
        >
          Add to cart
        </button>
      )}
      {cartState?.error && (
        <p role="alert" aria-live="polite" className="field__err">
          {cartState.error}
        </p>
      )}
      {cartState?.ok && <Toast message="Added to cart ✓" />}
      <p className="spec-note">
        <b>Test mode</b> — payments run on Stripe&apos;s test rails; no real money moves.
      </p>

      {/* Shared Dialog primitive: dialog role, Escape, focus trap, scroll
          lock. The amount input is a real <label> now — screen readers used
          to announce it as "edit text, blank". */}
      <Dialog open={offerOpen} onClose={() => setOfferOpen(false)} label="Make an offer">
        <div className="sheet">
          <span className="microlabel microlabel--ink">Make an offer</span>
          <form action={offerAction} className="mt-4 flex flex-col gap-3">
            <input type="hidden" name="listing_id" value={listingId} />
            <div className="field">
              <label htmlFor={`${idBase}-amount`} className="microlabel">
                Your offer
              </label>
              <div className="ctl__prefix">
                <span aria-hidden="true">$</span>
                <input
                  id={`${idBase}-amount`}
                  name="amount"
                  required
                  inputMode="decimal"
                  placeholder="0"
                  className="ctl"
                />
              </div>
              <span className="field__hint">
                The seller can accept, counter once, or let it lapse. Offers expire after 72
                hours.
              </span>
            </div>
            <div className="field">
              <label htmlFor={`${idBase}-message`} className="microlabel">
                Message — optional
              </label>
              <textarea
                id={`${idBase}-message`}
                name="message"
                rows={2}
                placeholder="Anything the seller should know"
                className="ctl"
              />
            </div>
            {offerState.error && (
              <p role="alert" aria-live="polite" className="field__err">
                {offerState.error}
              </p>
            )}
            {offerState.ok && <p className="field__ok" style={{ display: "block" }}>{offerState.ok}</p>}
            <div className="sheet__actions">
              <button type="submit" disabled={offerPending} className="btn btn--live flex-1">
                {offerPending ? "Sending…" : "Send offer"}
              </button>
              <button type="button" onClick={() => setOfferOpen(false)} className="btn btn--ghost">
                Close
              </button>
            </div>
          </form>
        </div>
      </Dialog>
    </div>
  );
}
