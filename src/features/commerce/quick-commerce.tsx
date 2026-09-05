"use client";

import { useState, useTransition } from "react";

import { Icon } from "@/components/ui/icons";
import { Toast } from "@/components/ui/toast";
import { cx } from "@/lib/format";

import { addToCart, buyNow, type CommerceState } from "./actions";

/**
 * Quick commerce — Buy now · Add to cart on a Marketplace card, so a buyer
 * who already knows the part doesn't have to open every listing first.
 *
 * Deliberately not the PDP's `PurchaseActions`: that component also owns the
 * offer dialog, the sticky phone buybar, the payment-mode notice and the
 * auth-intent resume flow, none of which belong on a grid card. What it
 * shares is the *behaviour* — the same `buyNow` and `addToCart` server
 * actions, so every rule lives in one place:
 *
 *   · guests can buy (Buy now → /cart?buynow=1; identity at checkout)
 *   · `addToCart` refuses inactive listings and the viewer's own part
 *   · success is confirmed in place (toast + "In cart ✓") and the cart
 *     badge refreshes through the action cookie update, exactly like the PDP
 *   · errors read inline as a polite alert
 *
 * Render it only for a purchasable listing — the card decides (active, not
 * the viewer's own) and passes nothing otherwise, so a sold or reserved part
 * never shows a misleading Buy button. Buttons are `type="button"` and sit
 * outside the card's link region: activating one never opens the listing.
 *
 * Drawn as a stacked fill-then-outline pair (Amazon's card pill, eBay's
 * primary/secondary pairing, Depop's stacked item actions) — see `.qcom` in
 * globals.css for why the primary is ink rather than `--live`.
 */
export function ListingQuickCommerce({
  listingId,
  title,
}: {
  listingId: string;
  title: string;
}) {
  const [buyPending, startBuy] = useTransition();
  const [cartPending, startCart] = useTransition();
  const [cartState, setCartState] = useState<CommerceState | null>(null);

  function runBuyNow() {
    startBuy(async () => {
      const fd = new FormData();
      fd.set("listing_id", listingId);
      // Redirects to the cart; a thrown redirect is the success path.
      await buyNow(fd);
    });
  }

  function runAddToCart() {
    startCart(async () => {
      const fd = new FormData();
      fd.set("listing_id", listingId);
      try {
        const result = await addToCart(fd);
        setCartState(result);
        // Cookie changes refresh the server UI in the same action response.
      } catch {
        setCartState({ error: "Couldn't add that just now — try again." });
      }
    });
  }

  const busy = buyPending || cartPending;

  return (
    <div className="qcom">
      <div className="qcom__row">
        <button
          type="button"
          disabled={busy}
          onClick={runBuyNow}
          className="btn qcom__buy"
          aria-label={`Buy now — ${title}`}
        >
          {buyPending ? "Processing…" : "Buy now"}
        </button>
        {cartState?.ok ? (
          <a
            href="/cart"
            className="btn btn--ghost qcom__cart"
            aria-label={`In cart — view cart`}
          >
            <Icon name="cart" className="qcom__ico" />
            <span className="qcom__label">In cart ✓</span>
          </a>
        ) : (
          <button
            type="button"
            disabled={busy}
            onClick={runAddToCart}
            className={cx("btn btn--ghost qcom__cart", cartPending && "is-busy")}
            aria-label={`Add to cart — ${title}`}
          >
            <Icon name="cart" className="qcom__ico" />
            <span className="qcom__label">
              {cartPending ? "Adding…" : "Add to cart"}
            </span>
          </button>
        )}
      </div>
      {cartState?.error && (
        <p role="alert" aria-live="polite" className="field__err qcom__err">
          {cartState.error}
        </p>
      )}
      {cartState?.ok && <Toast message="Added to cart ✓" />}
    </div>
  );
}
