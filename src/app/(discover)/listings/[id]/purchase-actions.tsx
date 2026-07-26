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
        className="h-12 rounded-pill bg-accent text-sm font-semibold text-white transition hover:bg-accent/90"
      >
        {pending ? "Processing…" : "Buy now"}
      </button>
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
        className="h-12 rounded-pill border border-border text-sm font-semibold text-text-secondary transition hover:text-text-primary"
      >
        Add to cart
      </button>
      <button
        type="button"
        onClick={() => guard(() => setOfferOpen(true))}
        className="h-12 rounded-pill border border-border text-sm font-semibold text-text-secondary transition hover:text-text-primary"
      >
        Make an offer
      </button>
      <p className="text-center text-xs text-text-muted">
        Payments are stubbed — no real charge is made yet.
      </p>

      {offerOpen && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/60 px-5"
          onClick={(e) => e.target === e.currentTarget && setOfferOpen(false)}
        >
          <div className="w-full max-w-[380px] rounded-card border border-border bg-surface p-6">
            <h2 className="text-lg font-semibold text-text-primary">Make an offer</h2>
            <form action={offerAction} className="mt-4 flex flex-col gap-3">
              <input type="hidden" name="listing_id" value={listingId} />
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-text-muted">$</span>
                <input
                  name="amount"
                  required
                  inputMode="decimal"
                  placeholder="Your offer"
                  className="h-12 w-full rounded-input border border-border bg-app pl-7 pr-3 text-sm text-text-primary outline-none placeholder:text-text-muted focus:border-accent"
                />
              </div>
              <textarea
                name="message"
                rows={2}
                placeholder="Message to the seller (optional)"
                className="w-full resize-y rounded-input border border-border bg-app px-3 py-2.5 text-sm text-text-primary outline-none placeholder:text-text-muted focus:border-accent"
              />
              {offerState.error && <p className="text-sm text-red-400">{offerState.error}</p>}
              {offerState.ok && <p className="text-sm text-success">{offerState.ok}</p>}
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setOfferOpen(false)}
                  className="rounded-pill px-4 py-2 text-sm text-text-secondary hover:text-text-primary"
                >
                  Close
                </button>
                <button
                  type="submit"
                  disabled={offerPending}
                  className="rounded-pill bg-accent px-5 py-2 text-sm font-semibold text-white transition hover:bg-accent/90"
                >
                  {offerPending ? "Sending…" : "Send offer"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
