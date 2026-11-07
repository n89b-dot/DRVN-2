"use server";

import { headers } from "next/headers";

import { abuseIdentity } from "@/lib/abuse-identity";
import { getCartIds } from "@/lib/cart";
import { reportError } from "@/lib/monitoring";
import { RATE_LIMITS, allowAction, rateLimitMessage } from "@/lib/rate-limit";
import { getShippingProvider, integratedShippingEnabled } from "@/lib/shipping/provider";
import { ShippingProviderError } from "@/lib/shipping/types";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

import { hashDestination } from "./checkout-shipping";
import {
  MAX_RATES_PER_LINE,
  quoteRequestFingerprint,
  reusableQuoteSet,
  type Parcel,
  type StoredQuote,
} from "./shipping-quote-cache";
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
 *
 * Rating costs provider quota and rows (N96), so a quote needs the caller's
 * own cart, a still-valid stored quote is handed back instead of re-rating,
 * and live rating is counted against a fail-closed quota.
 */

const QUOTE_TTL_MS = 30 * 60_000;
/** A stored quote is reused only while it leaves the buyer this long to pay. */
const QUOTE_REUSE_MIN_REMAINING_MS = 10 * 60_000;

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

  // A quote needs a checkout to belong to (N96): the visitor's own cart, and
  // only its live DRVN-Shipping lines. No cart, no provider call.
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
  const now = Date.now();
  const expiresAt = new Date(now + QUOTE_TTL_MS).toISOString();
  const reusableAfter = new Date(now + QUOTE_REUSE_MIN_REMAINING_MS).toISOString();

  // Pass 1, no provider calls: check every line can be rated and answer what
  // a stored quote still covers.
  type Line = {
    listing: (typeof listings)[number];
    parcel: Parcel;
    profile: NonNullable<Awaited<ReturnType<typeof loadFulfillmentProfile>>>;
    from: ReturnType<typeof shipFromAddress>;
    fingerprint: string;
    cached: QuoteOption[] | null;
  };
  const planned: Line[] = [];
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
    const from = shipFromAddress(profile);
    // The whole provider request, not just the checkout's destination hash:
    // reuse hands back the provider shipment a label is later bought on.
    const fingerprint = quoteRequestFingerprint({
      provider: provider.name,
      from,
      to: toAddress,
      parcel,
      endShipperRef: profile.easypost_end_shipper_id,
    });

    let stored = admin
      .from("shipping_rate_quotes")
      .select("id, service_label, amount_cents, est_delivery_days, provider_shipment_id, parcel, request_fingerprint, created_at")
      .eq("listing_id", listing.id)
      .eq("destination_hash", destHash)
      .eq("request_fingerprint", fingerprint)
      .eq("provider", provider.name)
      .is("consumed_order_id", null)
      .gt("expires_at", reusableAfter);
    stored = user ? stored.eq("buyer_id", user.id) : stored.is("buyer_id", null);
    const { data: storedRows, error: storedError } = await stored
      .order("created_at", { ascending: false })
      .limit(MAX_RATES_PER_LINE * 3);
    if (storedError) {
      // Unreadable cache: rate live (the quota below still applies).
      reportError("[shipping] stored quote read failed", { listingId: listing.id, storedError });
    }
    planned.push({
      listing,
      parcel,
      profile,
      from,
      fingerprint,
      cached: storedError ? null : reusableQuoteSet((storedRows ?? []) as StoredQuote[], parcel, fingerprint),
    });
  }

  // The quota, before any provider call: one unit per line rated live. It
  // fails closed — if the limiter can't answer, nothing is rated.
  const fresh = planned.filter((line) => !line.cached).length;
  if (fresh > 0) {
    const subject = abuseIdentity(await headers(), user?.id);
    for (let unit = 0; unit < fresh; unit++) {
      if (!(await allowAction(RATE_LIMITS.shippingQuote, subject))) {
        return { groups: [], error: rateLimitMessage(RATE_LIMITS.shippingQuote) };
      }
    }
  }

  const groups: CartShippingQuotes["groups"] = [];
  for (const { listing, parcel, profile, from, fingerprint, cached } of planned) {
    if (cached) {
      groups.push({ listingId: listing.id, title: listing.title, options: cached });
      continue;
    }

    let rated;
    try {
      rated = await provider.getRates({
        from,
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
          request_fingerprint: fingerprint,
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
