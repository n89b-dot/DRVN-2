"use server";

import { getCartIds } from "@/lib/cart";
import { reportError } from "@/lib/monitoring";
import { getShippingProvider, integratedShippingEnabled } from "@/lib/shipping/provider";
import { ShippingProviderError } from "@/lib/shipping/types";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

import { hashDestination } from "./checkout-shipping";
import { loadFulfillmentProfile, shipFromAddress } from "./fulfillment";

/**
 * DRVN Shipping checkout rates (brief §15, migration 0053).
 *
 * The buyer's selected rate is money, so nothing about it is client-trusted:
 * this action rates each DRVN-Shipping line server-side, persists the small
 * useful set into shipping_rate_quotes (deny-all RLS), and returns only
 * opaque quote ids + display fields. checkoutCart later re-reads the chosen
 * quote by id, checks it against the same destination fingerprint, and uses
 * the SERVER-STORED amount — a tampered form can pick a different quote, but
 * never invent a price.
 */

const QUOTE_TTL_MS = 30 * 60_000;
const MAX_RATES_PER_LINE = 4;

export type QuoteOption = {
  quoteId: string;
  serviceLabel: string;
  amountCents: number;
  estDeliveryDays: number | null;
};

export type CartShippingQuotes = {
  /** Per DRVN-Shipping cart line, in cart order. */
  groups: { listingId: string; title: string; options: QuoteOption[] }[];
  error?: string;
};

export async function quoteCartShipping(
  _prev: CartShippingQuotes,
  formData: FormData
): Promise<CartShippingQuotes> {
  if (!integratedShippingEnabled()) {
    return { groups: [], error: "DRVN Shipping isn't available right now." };
  }

  const line1 = String(formData.get("ship_line1") ?? "").trim();
  const city = String(formData.get("ship_city") ?? "").trim();
  const postcode = String(formData.get("ship_postcode") ?? "").trim();
  const country = String(formData.get("ship_country") ?? "").trim();
  if (!line1 || !city || !postcode || !country) {
    return { groups: [], error: "Add the delivery address first — rates depend on it." };
  }

  const ids = await getCartIds();
  if (!ids.length) return { groups: [] };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const admin = createAdminClient();
  const { data: listings } = await admin
    .from("listings")
    .select(
      "id, title, seller_id, status, shipping_mode, weight_oz, length_in, width_in, height_in, currency"
    )
    .in("id", ids)
    .eq("status", "active")
    .eq("shipping_mode", "drvn");
  if (!listings?.length) return { groups: [] };

  const provider = getShippingProvider();
  const toAddress = {
    name: String(formData.get("ship_name") ?? "").trim() || "Buyer",
    street1: line1,
    street2: String(formData.get("ship_line2") ?? "").trim() || null,
    city,
    state: String(formData.get("ship_state") ?? "").trim() || null,
    postalCode: postcode,
    country,
    phone: String(formData.get("ship_phone") ?? "").trim() || null,
  };
  const destHash = hashDestination({ line1, city, postcode, country });
  const expiresAt = new Date(Date.now() + QUOTE_TTL_MS).toISOString();

  const groups: CartShippingQuotes["groups"] = [];
  for (const listing of listings) {
    if (!listing.weight_oz || !listing.length_in || !listing.width_in || !listing.height_in) {
      return {
        groups: [],
        error: `"${listing.title}" is missing its parcel details — the seller needs to fix the listing.`,
      };
    }
    const profile = await loadFulfillmentProfile(listing.seller_id);
    if (!profile?.address_verified_at) {
      return {
        groups: [],
        error: `"${listing.title}" can't be rated right now — the seller's ship-from address isn't set up.`,
      };
    }

    const parcel = {
      weightOz: Number(listing.weight_oz),
      lengthIn: Number(listing.length_in),
      widthIn: Number(listing.width_in),
      heightIn: Number(listing.height_in),
    };

    let rated;
    try {
      rated = await provider.getRates({
        from: shipFromAddress(profile),
        to: toAddress,
        parcel,
        endShipperRef: profile.easypost_end_shipper_id,
      });
    } catch (error) {
      const reason = error instanceof ShippingProviderError ? error.message : "provider error";
      reportError("[shipping] rate quote failed", { listingId: listing.id, reason });
      return {
        groups: [],
        error: "Couldn't fetch shipping rates just now — try again in a moment.",
      };
    }

    // A small, useful set (§15.5): cheapest first, capped — not the full
    // carrier catalog.
    const useful = rated.rates.slice(0, MAX_RATES_PER_LINE);
    if (!useful.length) {
      return {
        groups: [],
        error: `No carrier will take "${listing.title}" to that address — try local pickup or contact the seller.`,
      };
    }

    const { data: inserted, error: insertError } = await admin
      .from("shipping_rate_quotes")
      .insert(
        useful.map((rate) => ({
          buyer_id: user?.id ?? null,
          listing_id: listing.id,
          provider: provider.name,
          provider_shipment_id: rated.shipmentRef,
          rate_ref: rate.rateRef,
          carrier: rate.carrier,
          service: rate.service,
          service_label: rate.serviceLabel,
          amount_cents: rate.amountCents,
          currency: rate.currency,
          est_delivery_days: rate.estDeliveryDays,
          destination_hash: destHash,
          parcel,
          expires_at: expiresAt,
        }))
      )
      .select("id, service_label, amount_cents, est_delivery_days");
    if (insertError || !inserted?.length) {
      reportError("[shipping] quote persist failed", { listingId: listing.id, insertError });
      return { groups: [], error: "Couldn't hold those rates — try again." };
    }

    groups.push({
      listingId: listing.id,
      title: listing.title,
      options: inserted.map((q) => ({
        quoteId: q.id,
        serviceLabel: q.service_label,
        amountCents: q.amount_cents,
        estDeliveryDays: q.est_delivery_days,
      })),
    });
  }

  return { groups };
}
