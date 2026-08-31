"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { reportError } from "@/lib/monitoring";
import { recordLabelRefund, recordSellerAdjustment } from "@/lib/payments/adjustments";
import { integratedShippingEnabled, getShippingProvider } from "@/lib/shipping/provider";
import { ShippingProviderError, type PurchasedLabel } from "@/lib/shipping/types";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

import {
  loadFulfillmentProfile,
  readFulfillmentFields,
  shipFromAddress,
} from "./fulfillment";

/**
 * Settings → Shipping. Saves the seller's private ship-from profile
 * (migration 0051). Writes run on the service-role client — the table has no
 * client write policy — so this action owns validation via
 * readFulfillmentFields.
 *
 * Address verification: when DRVN Shipping is enabled, the provider verifies
 * the address and address_verified_at is stamped on success; a provider
 * outage degrades to saving unverified (verification re-runs on next save)
 * rather than blocking the seller. An address the provider positively calls
 * undeliverable is refused — a wrong ship-from silently poisons every rate
 * quote and label after it.
 */
export type FulfillmentState = { error?: string; ok?: string; labelUrl?: string };

export async function saveFulfillmentProfile(
  _prev: FulfillmentState,
  formData: FormData
): Promise<FulfillmentState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const parsed = readFulfillmentFields(formData);
  if ("error" in parsed) return { error: parsed.error };
  const fields = parsed.fields;

  let verifiedAt: string | null = null;
  if (integratedShippingEnabled()) {
    try {
      const verification = await getShippingProvider().verifyAddress({
        name: fields.ship_from_name,
        company: fields.company,
        street1: fields.street1,
        street2: fields.street2,
        city: fields.city,
        state: fields.state,
        postalCode: fields.postal_code,
        country: fields.country,
        phone: fields.phone,
      });
      if (!verification.deliverable) {
        return {
          error:
            verification.messages[0] ??
            "That address doesn't look deliverable — double-check it.",
        };
      }
      verifiedAt = new Date().toISOString();
      const n = verification.normalized;
      if (n) {
        fields.street1 = n.street1;
        fields.street2 = n.street2 ?? null;
        fields.city = n.city;
        fields.state = n.state ?? null;
        fields.postal_code = n.postalCode;
        fields.country = n.country;
      }
    } catch (error) {
      if (error instanceof ShippingProviderError) {
        // Provider down ≠ seller blocked. Save unverified; DRVN Shipping
        // eligibility (fulfillmentProfileReady) stays off until verified.
        reportError("[fulfillment] address verify unavailable", {
          userId: user.id,
          reason: error.message,
        });
      } else {
        throw error;
      }
    }
  }

  const admin = createAdminClient();
  const { error } = await admin.from("seller_fulfillment_profiles").upsert(
    {
      seller_id: user.id,
      ...fields,
      address_verified_at: verifiedAt,
    },
    { onConflict: "seller_id" }
  );
  if (error) {
    reportError("[fulfillment] save failed", { userId: user.id, error });
    return { error: "Couldn't save your shipping details. Try again." };
  }

  return {
    ok: verifiedAt
      ? "Shipping details saved and verified."
      : "Shipping details saved.",
  };
}

/**
 * Seller buys the DRVN Shipping label(s) for a paid order (brief §15.10-12,
 * §16-17). The buyer already paid the quoted shipping; the label cost lands
 * on the seller as a negative adjustment (0052) that the payout worker nets
 * out — economically funded by that buyer-paid shipping.
 *
 * Failure shapes handled (§41): a timed-out buy that actually succeeded is
 * recovered by the provider's already-purchased re-read; a duplicate submit
 * is stopped by the shipment status compare-and-set and the adjustment's
 * unique external reference; an expired rate re-rates the same parcel and
 * prefers the same carrier+service before falling back to the cheapest.
 */
export async function buyShippingLabel(
  _prev: FulfillmentState,
  formData: FormData
): Promise<FulfillmentState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const orderId = String(formData.get("order_id") ?? "");
  if (!orderId) return { error: "Missing order." };
  if (!integratedShippingEnabled()) {
    return { error: "DRVN Shipping is unavailable right now — dispatch manually below." };
  }

  const admin = createAdminClient();
  const { data: order } = await admin
    .from("orders")
    .select(
      "id, seller_id, status, is_collection, currency, ship_name, ship_line1, ship_line2, ship_city, ship_state, ship_postcode, ship_country, ship_phone"
    )
    .eq("id", orderId)
    .maybeSingle();
  if (!order || order.seller_id !== user.id) return { error: "Not your order." };
  if (order.status !== "paid") return { error: "Labels are for paid, undispatched orders." };
  if (order.is_collection) return { error: "This order is a local pickup — no label needed." };
  if (!order.ship_line1) return { error: "This order has no delivery address." };

  const { data: shipments } = await admin
    .from("shipments")
    .select("*")
    .eq("order_id", orderId)
    .eq("direction", "outbound")
    .eq("fulfillment_type", "drvn_shipping")
    .eq("status", "pending");
  if (!shipments?.length) {
    return { error: "No label waiting to be bought on this order." };
  }

  const profile = await loadFulfillmentProfile(user.id);
  if (!profile) return { error: "Add your ship-from address in Settings → Shipping first." };
  const provider = getShippingProvider();

  let lastLabelUrl: string | null = null;
  for (const shipment of shipments) {
    // The consumed quote row still holds the provider rate reference.
    const { data: quote } = await admin
      .from("shipping_rate_quotes")
      .select("*")
      .eq("consumed_order_id", orderId)
      .eq("provider_shipment_id", shipment.provider_shipment_id ?? "")
      .maybeSingle();

    let label: PurchasedLabel | null = null;
    try {
      if (!shipment.provider_shipment_id || !quote) {
        throw new ShippingProviderError("quote reference missing — re-rating", {
          retryable: false,
        });
      }
      label = await provider.buyLabel({
        shipmentRef: shipment.provider_shipment_id,
        rateRef: quote.rate_ref,
        endShipperRef: profile.easypost_end_shipper_id,
        idempotencyKey: `label:${shipment.id}`,
      });
    } catch (error) {
      if (!(error instanceof ShippingProviderError)) throw error;
      // Expired shipment/rate (or missing refs): re-rate the same parcel to
      // the same address, prefer the service the buyer chose, buy that.
      const parcel = (quote?.parcel ?? null) as {
        weightOz: number;
        lengthIn: number;
        widthIn: number;
        heightIn: number;
      } | null;
      if (!parcel) {
        reportError("[label] no parcel to re-rate", { shipmentId: shipment.id });
        return { error: "Couldn't buy this label — contact support." };
      }
      try {
        const rated = await provider.getRates({
          from: shipFromAddress(profile),
          to: {
            name: order.ship_name ?? "Buyer",
            street1: order.ship_line1,
            street2: order.ship_line2,
            city: order.ship_city ?? "",
            state: order.ship_state,
            postalCode: order.ship_postcode ?? "",
            country: order.ship_country ?? "US",
            phone: order.ship_phone,
          },
          parcel,
          endShipperRef: profile.easypost_end_shipper_id,
        });
        const preferred =
          rated.rates.find(
            (r) => r.carrier === shipment.carrier && r.service === shipment.service
          ) ?? rated.rates[0];
        if (!preferred) throw new ShippingProviderError("no rates on re-rate");
        label = await provider.buyLabel({
          shipmentRef: rated.shipmentRef,
          rateRef: preferred.rateRef,
          endShipperRef: profile.easypost_end_shipper_id,
          idempotencyKey: `label:${shipment.id}:rerate`,
        });
        await admin
          .from("shipments")
          .update({ provider_shipment_id: rated.shipmentRef })
          .eq("id", shipment.id);
      } catch (retryError) {
        const reason =
          retryError instanceof ShippingProviderError ? retryError.message : "provider error";
        reportError("[label] buy failed after re-rate", { shipmentId: shipment.id, reason });
        return {
          error: "The carrier couldn't sell that label just now — try again in a few minutes.",
        };
      }
    }

    if (!label) return { error: "Label purchase failed — try again." };

    // Record the movement + the money, both idempotently.
    const { error: updateError } = await admin
      .from("shipments")
      .update({
        status: "label_purchased",
        purchased_cents: label.amountCents,
        label_reference: label.labelUrl,
        tracking_code: label.trackingCode,
        provider_tracker_id: label.trackerRef,
        carrier: label.carrier || shipment.carrier,
        service: label.service || shipment.service,
      })
      .eq("id", shipment.id)
      .eq("status", "pending");
    if (updateError) {
      reportError("[label] shipment update failed", { shipmentId: shipment.id, updateError });
    }
    await recordSellerAdjustment(admin, {
      sellerId: user.id,
      orderId,
      shipmentId: shipment.id,
      kind: "outbound_label",
      amountCents: -Math.abs(label.amountCents),
      currency: order.currency,
      externalReference: `label:${shipment.id}`,
      description: `${label.carrier} ${label.service} outbound label`,
    });
    lastLabelUrl = label.labelUrl;
  }

  revalidatePath(`/orders/${orderId}`);
  return {
    ok: "Label purchased — print it from this order sheet.",
    labelUrl: lastLabelUrl ?? undefined,
  };
}

/** Voids an unused label: provider refund + shipment cancelled + the
 *  adjustment reversed by an opposing row (never mutated). */
export async function voidShippingLabel(
  _prev: FulfillmentState,
  formData: FormData
): Promise<FulfillmentState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const shipmentId = String(formData.get("shipment_id") ?? "");
  if (!shipmentId) return { error: "Missing shipment." };

  const admin = createAdminClient();
  const { data: shipment } = await admin
    .from("shipments")
    .select("*, orders!inner(seller_id, currency)")
    .eq("id", shipmentId)
    .maybeSingle();
  const orderMeta = (shipment as unknown as { orders?: { seller_id: string | null; currency: string } } | null)
    ?.orders;
  if (!shipment || orderMeta?.seller_id !== user.id) return { error: "Not your shipment." };
  if (shipment.status !== "label_purchased") {
    return { error: "Only an unused, purchased label can be voided." };
  }
  if (!shipment.provider_shipment_id) return { error: "No provider label on record." };

  try {
    const result = await getShippingProvider().voidLabel({
      shipmentRef: shipment.provider_shipment_id,
    });
    if (result.state === "rejected") {
      return { error: "The carrier refused the refund — the label may already be in use." };
    }
  } catch (error) {
    const reason = error instanceof ShippingProviderError ? error.message : "provider error";
    reportError("[label] void failed", { shipmentId, reason });
    return { error: "Couldn't void the label just now — try again shortly." };
  }

  await admin
    .from("shipments")
    .update({ status: "cancelled" })
    .eq("id", shipmentId)
    .eq("status", "label_purchased");
  if (shipment.purchased_cents) {
    await recordLabelRefund(admin, {
      sellerId: user.id,
      orderId: shipment.order_id,
      shipmentId,
      amountCents: shipment.purchased_cents,
      currency: orderMeta?.currency ?? "USD",
      externalReference: `label:${shipmentId}`,
    });
  }
  revalidatePath(`/orders/${shipment.order_id}`);
  return { ok: "Label voided — the cost comes back off your payout deduction." };
}
