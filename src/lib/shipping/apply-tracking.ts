import "server-only";

import { canTransition, SHIPMENT_TRANSITIONS } from "@/lib/domain/states";
import { SELLER_INSPECT_HOURS } from "@/lib/domain/return-policy";
import { reportError } from "@/lib/monitoring";
import type { createAdminClient } from "@/lib/supabase/admin";
import type { Shipment, ShipmentStatus } from "@/lib/database.types";
import type { TrackingState, TrackingSummary } from "./types";

type Admin = ReturnType<typeof createAdminClient>;

/**
 * Applies a provider tracking summary to DRVN's shipment/order records —
 * shared by the EasyPost webhook, the manual tracking sync, and the stub
 * flow. Idempotent by construction:
 *
 *  - events dedupe on shipment_events_dedupe_key (0052) — a duplicate
 *    webhook re-inserts nothing;
 *  - status only ever advances along SHIPMENT_TRANSITIONS; an out-of-order
 *    or repeated event that maps to an illegal/identical transition is
 *    silently skipped (the DB guard would refuse it anyway);
 *  - order effects are compare-and-set (`.in("status", …)`) so replays and
 *    races cannot double-fire.
 *
 * Order derivation (brief §19): first outbound movement flips paid → shipped;
 * an order is `delivered` only when EVERY live outbound shipment is
 * delivered. Detailed per-parcel progress stays in Shipment UI. Return-leg
 * shipments never touch order status — the returns domain consumes their
 * delivery separately.
 */

const STATE_TO_STATUS: Partial<Record<TrackingState, ShipmentStatus>> = {
  in_transit: "in_transit",
  out_for_delivery: "out_for_delivery",
  delivered: "delivered",
  available_for_pickup: "out_for_delivery",
  return_to_sender: "returned_to_sender",
  failure: "failed",
  // pre_transit / unknown / cancelled: no shipment-status movement.
};

export type ApplyTrackingResult = {
  shipmentId: string | null;
  eventsInserted: number;
  statusChanged: boolean;
  orderEffect: "none" | "shipped" | "delivered";
};

export async function findShipmentForTracker(
  admin: Admin,
  summary: TrackingSummary
): Promise<Shipment | null> {
  if (summary.trackerRef) {
    const { data } = await admin
      .from("shipments")
      .select("*")
      .eq("provider_tracker_id", summary.trackerRef)
      .maybeSingle();
    if (data) return data;
  }
  if (summary.trackingCode) {
    const { data } = await admin
      .from("shipments")
      .select("*")
      .eq("tracking_code", summary.trackingCode)
      .limit(2);
    // Ambiguity (two shipments, one code) means we must not guess.
    if (data?.length === 1) return data[0];
  }
  return null;
}

export async function applyTrackingSummary(
  admin: Admin,
  shipment: Shipment,
  summary: TrackingSummary
): Promise<ApplyTrackingResult> {
  let eventsInserted = 0;

  for (const event of summary.events) {
    const { error } = await admin.from("shipment_events").insert({
      shipment_id: shipment.id,
      provider_event_ref: event.providerEventRef,
      status: event.state,
      description: event.description,
      occurred_at: event.occurredAt,
      city: event.city,
      state: event.state_code,
      country: event.country,
    });
    if (!error) eventsInserted += 1;
    else if (error.code !== "23505") {
      reportError("[shipping] event insert failed", { shipmentId: shipment.id, error });
    }
  }

  // Adopt the tracker reference the first time we learn it.
  if (summary.trackerRef && !shipment.provider_tracker_id) {
    await admin
      .from("shipments")
      .update({ provider_tracker_id: summary.trackerRef })
      .eq("id", shipment.id)
      .is("provider_tracker_id", null);
  }

  const target = STATE_TO_STATUS[summary.state];
  let statusChanged = false;
  if (target && target !== shipment.status) {
    if (canTransition(SHIPMENT_TRANSITIONS, shipment.status, target)) {
      const patch: Partial<Shipment> = { status: target };
      if (target === "in_transit" && !shipment.shipped_at) {
        patch.shipped_at = summary.events[0]?.occurredAt ?? new Date().toISOString();
      }
      if (target === "delivered") {
        patch.delivered_at = summary.deliveredAt ?? new Date().toISOString();
      }
      const { data: updated, error } = await admin
        .from("shipments")
        .update(patch)
        .eq("id", shipment.id)
        .eq("status", shipment.status)
        .select("id");
      if (error) {
        reportError("[shipping] status update failed", { shipmentId: shipment.id, error });
      }
      statusChanged = Boolean(updated?.length);
    }
    // Illegal transition = out-of-order/duplicate event; deliberately quiet.
  }

  // Return legs never touch order status — they advance the RMA (0055):
  // first movement = the buyer shipped; delivery starts the seller's
  // 48-hour inspection clock, stamped once onto the row.
  if (shipment.direction === "return" && shipment.return_id && statusChanged) {
    if (target === "in_transit" || target === "out_for_delivery") {
      await admin
        .from("returns")
        .update({ status: "in_transit", shipped_at: new Date().toISOString() })
        .eq("id", shipment.return_id)
        .eq("status", "awaiting_shipment");
    } else if (target === "delivered") {
      // The in_transit hop may never have been seen (final-scan-only carriers).
      await admin
        .from("returns")
        .update({ status: "in_transit", shipped_at: new Date().toISOString() })
        .eq("id", shipment.return_id)
        .eq("status", "awaiting_shipment");
      await admin
        .from("returns")
        .update({
          status: "delivered",
          delivered_at: summary.deliveredAt ?? new Date().toISOString(),
          seller_respond_by: new Date(
            Date.now() + SELLER_INSPECT_HOURS * 3_600_000
          ).toISOString(),
        })
        .eq("id", shipment.return_id)
        .eq("status", "in_transit");
    }
  }

  let orderEffect: ApplyTrackingResult["orderEffect"] = "none";
  if (shipment.direction === "outbound" && statusChanged) {
    if (target === "in_transit" || target === "out_for_delivery") {
      orderEffect = (await markOrderShipped(admin, shipment)) ? "shipped" : "none";
    } else if (target === "delivered") {
      orderEffect = (await maybeMarkOrderDelivered(admin, shipment.order_id)) ? "delivered" : "none";
      // Delivery also implies the shipped hop happened, even if we never saw
      // the in_transit event (some carriers only report final scan).
      if (orderEffect === "none") await markOrderShipped(admin, shipment);
    }
  }

  return { shipmentId: shipment.id, eventsInserted, statusChanged, orderEffect };
}

/** paid → shipped, once, mirroring carrier/tracking onto the order's legacy
 *  columns (existing UI + nextAction read them). */
async function markOrderShipped(admin: Admin, shipment: Shipment): Promise<boolean> {
  const { data, error } = await admin
    .from("orders")
    .update({
      status: "shipped",
      shipped_at: shipment.shipped_at ?? new Date().toISOString(),
      carrier: shipment.carrier,
      tracking_number: shipment.tracking_code,
    })
    .eq("id", shipment.order_id)
    .eq("status", "paid")
    .select("id");
  if (error) reportError("[shipping] order shipped update failed", { orderId: shipment.order_id, error });
  return Boolean(data?.length);
}

/** delivered when every live outbound shipment is delivered (§19). */
export async function maybeMarkOrderDelivered(admin: Admin, orderId: string): Promise<boolean> {
  const { data: shipments, error } = await admin
    .from("shipments")
    .select("status, direction")
    .eq("order_id", orderId)
    .eq("direction", "outbound");
  if (error || !shipments?.length) return false;

  const live = shipments.filter((s) => !["cancelled", "failed"].includes(s.status));
  if (!live.length || !live.every((s) => s.status === "delivered")) return false;

  const { data, error: updateError } = await admin
    .from("orders")
    .update({ status: "delivered", delivered_at: new Date().toISOString() })
    .eq("id", orderId)
    .in("status", ["paid", "shipped"])
    .select("id");
  if (updateError) {
    reportError("[shipping] order delivered update failed", { orderId, updateError });
  }
  return Boolean(data?.length);
}
