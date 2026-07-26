"use client";

import { useRouter } from "next/navigation";
import { useActionState, useState, useTransition } from "react";

import {
  addToCart,
  buyNow,
  makeOffer,
  type CommerceState,
} from "@/features/commerce/actions";

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
  const [offerOpen, setOfferOpen] = useState(false);
  const [offerState, offerAction, offerPending] = useActionState<CommerceState, FormData>(makeOffer, {});
  const [pending, startTransition] = useTransition();

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
      <button
        type="button"
        onClick={() =>
          guard(() =>
            startTransition(async () => {
              const fd = new FormData();
              fd.set("listing_id", listingId);
              await addToCart(fd);
            })
          )
        }
        className="btn btn--ghost"
      >
        Add to cart
      </button>
      <p className="spec-note">
        <b>Payments are stubbed</b> — no real charge is made yet.
      </p>

      {offerOpen && (
        <div
          className="sheetwrap is-open"
          onClick={(e) => e.target === e.currentTarget && setOfferOpen(false)}
        >
          <div className="sheet">
            <span className="microlabel microlabel--ink">Make an offer</span>
            <form action={offerAction} className="mt-4 flex flex-col gap-3">
              <input type="hidden" name="listing_id" value={listingId} />
              <div className="field">
                <span className="microlabel">Your offer</span>
                <div className="ctl__prefix">
                  <span>$</span>
                  <input name="amount" required inputMode="decimal" placeholder="0" className="ctl" />
                </div>
                <span className="field__hint">
                  The keeper can accept, counter once, or let it lapse.
                </span>
              </div>
              <div className="field">
                <span className="microlabel">Message — optional</span>
                <textarea name="message" rows={2} placeholder="Anything the keeper should know" className="ctl" />
              </div>
              {offerState.error && (
                <p className="field__err" style={{ display: "flex" }}>
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
        </div>
      )}
    </div>
  );
}
