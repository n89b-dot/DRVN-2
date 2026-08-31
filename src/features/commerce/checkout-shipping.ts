import "server-only";

import { createHash } from "node:crypto";

import type { ShippingRateQuote } from "@/lib/database.types";
import { reportError } from "@/lib/monitoring";
import type { createAdminClient } from "@/lib/supabase/admin";

/**
 * Server-side fulfillment validation + freeze for checkout (brief §14/§15).
 *
 * Nothing here trusts the form: pickup eligibility comes from the listings,
 * shipping amounts come from server-held quotes (0053), and the chosen
 * service is frozen onto the order + turned into a pending shipment row in
 * the same flow that creates the orders. The 0053 DB guard re-checks pickup
 * against the frozen snapshots as a last line.
 */

type Admin = ReturnType<typeof createAdminClient>;

/** Destination fingerprint (0053): a quote can only pay for the address it
 *  was rated against. Shared by the rating action and checkout validation. */
export function hashDestination(input: {
  line1: string;
  city: string;
  postcode: string;
  country: string;
}): string {
  return createHash("sha256")
    .update(
      [input.line1, input.city, input.postcode, input.country]
        .map((part) => part.trim().toLowerCase())
        .join("|")
    )
    .digest("hex");
}

export type FulfillmentPlan = {
  /** listing_id → shipping cents override for purchase_begin. */
  overrides: Record<string, number>;
  /** listing_id → validated quote row, for the post-order freeze. */
  quotes: Map<string, ShippingRateQuote>;
};

export async function planCartFulfillment(
  admin: Admin,
  input: {
    listingIds: string[];
    isCollection: boolean;
    /** listing_id → quote id, straight from the form (opaque ids only). */
    quoteIds: Record<string, string>;
    buyerId: string | null;
    destinationHash: string;
  }
): Promise<{ plan?: FulfillmentPlan; error?: string }> {
  const { data: listings, error } = await admin
    .from("listings")
    .select("id, title, shipping_mode, allows_collection, status")
    .in("id", input.listingIds);
  if (error || !listings) {
    reportError("[checkout] fulfillment listing read failed", { error });
    return { error: "Couldn't verify the basket. Try again." };
  }

  const active = listings.filter((l) => l.status === "active");
  const overrides: Record<string, number> = {};
  const quotes = new Map<string, ShippingRateQuote>();

  if (input.isCollection) {
    // §14: pickup is only offerable when every item in the seller-order
    // supports it. The basket-level checkbox therefore requires every
    // buyable line to allow collection — never trust the client's box.
    const refusing = active.filter((l) => !l.allows_collection);
    if (refusing.length) {
      return {
        error: `Local pickup isn't offered for ${refusing[0].title} — choose delivery instead.`,
      };
    }
    // Collected orders charge no shipping: override every line to zero (the
    // flat shipping_cents is a delivery price).
    for (const l of active) overrides[l.id] = 0;
    return { plan: { overrides, quotes } };
  }

  for (const listing of active) {
    if (listing.shipping_mode === "pickup_only") {
      return {
        error: `${listing.title} is local pickup only — it can't be shipped.`,
      };
    }
    if (listing.shipping_mode !== "drvn") continue;

    const quoteId = input.quoteIds[listing.id];
    if (!quoteId) {
      return { error: `Pick a shipping service for ${listing.title}.` };
    }
    const { data: quote } = await admin
      .from("shipping_rate_quotes")
      .select("*")
      .eq("id", quoteId)
      .maybeSingle();
    const rejection = !quote
      ? "missing"
      : quote.listing_id !== listing.id
        ? "listing_mismatch"
        : quote.consumed_order_id !== null
          ? "consumed"
          : new Date(quote.expires_at).getTime() < Date.now()
            ? "expired"
            : quote.buyer_id !== null && quote.buyer_id !== input.buyerId
              ? "buyer_mismatch"
              : quote.destination_hash !== input.destinationHash
                ? "destination_mismatch"
                : null;
    if (rejection || !quote) {
      // The buyer-facing message stays generic; the reason is operator data.
      reportError("[checkout] quote rejected", {
        listingId: listing.id,
        quoteId,
        rejection,
      });
      return {
        error: `The shipping rate for ${listing.title} expired — refresh the rates and pick again.`,
      };
    }
    overrides[listing.id] = quote.amount_cents;
    quotes.set(listing.id, quote);
  }

  return { plan: { overrides, quotes } };
}

/**
 * After purchase_begin created the orders: freeze the chosen service onto
 * each order (orders.shipping_quote), consume the quotes, and create the
 * pending DRVN-Shipping shipment rows the seller will buy labels from.
 * Runs before payment; failures are reported but never strand the checkout —
 * the shipment can be reconstructed from the frozen order quote.
 */
export async function freezeOrderShipping(
  admin: Admin,
  orders: { order_id: string; listing_ids: string[] }[],
  quotes: Map<string, ShippingRateQuote>
): Promise<void> {
  if (!quotes.size) return;

  for (const order of orders) {
    const orderQuotes = order.listing_ids
      .map((listingId) => ({ listingId, quote: quotes.get(listingId) }))
      .filter((entry): entry is { listingId: string; quote: ShippingRateQuote } =>
        Boolean(entry.quote)
      );
    if (!orderQuotes.length) continue;

    const frozen = orderQuotes.map(({ listingId, quote }) => ({
      listing_id: listingId,
      provider: quote.provider,
      carrier: quote.carrier,
      service: quote.service,
      service_label: quote.service_label,
      amount_cents: quote.amount_cents,
      currency: quote.currency,
      est_delivery_days: quote.est_delivery_days,
      parcel: quote.parcel,
      quoted_at: quote.created_at,
    }));

    const { error: quoteWrite } = await admin
      .from("orders")
      .update({ shipping_quote: frozen })
      .eq("id", order.order_id);
    if (quoteWrite) {
      reportError("[checkout] shipping_quote freeze failed", {
        orderId: order.order_id,
        quoteWrite,
      });
    }

    const { data: items } = await admin
      .from("order_items")
      .select("id, listing_id")
      .eq("order_id", order.order_id);

    for (const { listingId, quote } of orderQuotes) {
      await admin
        .from("shipping_rate_quotes")
        .update({ consumed_order_id: order.order_id })
        .eq("id", quote.id)
        .is("consumed_order_id", null);

      const { data: shipment, error: shipmentError } = await admin
        .from("shipments")
        .insert({
          order_id: order.order_id,
          direction: "outbound",
          provider: quote.provider,
          provider_shipment_id: quote.provider_shipment_id,
          fulfillment_type: "drvn_shipping",
          carrier: quote.carrier,
          service: quote.service,
          status: "pending",
          quoted_cents: quote.amount_cents,
        })
        .select("id")
        .single();
      if (shipmentError || !shipment) {
        reportError("[checkout] shipment create failed", {
          orderId: order.order_id,
          shipmentError,
        });
        continue;
      }
      const itemId = (items ?? []).find((i) => i.listing_id === listingId)?.id;
      if (itemId) {
        const { error: linkError } = await admin
          .from("shipment_items")
          .insert({ shipment_id: shipment.id, order_item_id: itemId });
        if (linkError) {
          reportError("[checkout] shipment item link failed", {
            shipmentId: shipment.id,
            linkError,
          });
        }
      }
    }
  }
}
