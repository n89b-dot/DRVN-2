"use client";

import { useState, useTransition } from "react";

import { Icon } from "@/components/ui/icons";
import { Toast } from "@/components/ui/toast";

import { addToCart, type CommerceState } from "./actions";

/**
 * The cart control on a discovery-wall listing card — one 32px live square
 * at the end of the engagement strip, the Figma "for sale" card's action.
 * Adds to cart in place; once it's in, it links to the cart. `type="button"`
 * and outside the card's link region, so activating it never opens the listing.
 */
export function ListingCartButton({ listingId, title }: { listingId: string; title: string }) {
  const [pending, start] = useTransition();
  const [state, setState] = useState<CommerceState | null>(null);

  function run() {
    start(async () => {
      const fd = new FormData();
      fd.set("listing_id", listingId);
      try {
        setState(await addToCart(fd));
      } catch {
        setState({ error: "Couldn't add that just now — try again." });
      }
    });
  }

  if (state?.ok) {
    return (
      <a href="/cart" className="cartbtn" aria-label="In cart — view cart" data-tip="In cart">
        <Icon name="cart" className="cartbtn__ico" />
        <Toast message="Added to cart ✓" />
      </a>
    );
  }
  return (
    <button
      type="button"
      disabled={pending}
      onClick={run}
      className="cartbtn"
      aria-label={`Add to cart — ${title}`}
      data-tip={state?.error ?? "Add to cart"}
    >
      <Icon name="cart" className="cartbtn__ico" />
    </button>
  );
}
