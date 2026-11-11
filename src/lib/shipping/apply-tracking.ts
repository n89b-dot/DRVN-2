import "server-only";

import { canTransition, SHIPMENT_TRANSITIONS } from "@/lib/domain/states";
import { SELLER_INSPECT_HOURS } from "@/lib/domain/return-policy";
import { reportError } from "@/lib/monitoring";
import type { createAdminClient } from "@/lib/supabase/admin";
import type { Shipment, ShipmentStatus } from "@/lib/database.types";
import type { TrackingState, TrackingSummary } from "./types";
import { deliveryEvidence, evaluateDeliveryProof } from "./delivery-proof";

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

export type ShipmentLookupResult =
  | { kind: "found"; shipment: Shipment }
  | { kind: "missing" }
  | { kind: "ambiguous" };

function sameProviderIdentity(shipment: Shipment, summary: TrackingSummary): boolean {
  const normalize = (value: string) => value.replace(/[^a-z0-9]/gi, "").toLowerCase();
  return (
    (shipment.provider === null || shipment.provider === "easypost") &&
    (!summary.trackerRef ||
      !shipment.provider_tracker_id ||
      shipment.provider_tracker_id === summary.trackerRef) &&
    (!summary.trackingCode ||
      !shipment.tracking_code ||
      normalize(shipment.tracking_code) === normalize(summary.trackingCode)) &&
    (!summary.carrier ||
      !shipment.carrier ||
      normalize(shipment.carrier) === normalize(summary.carrier))
  );
}

/** True only when the provider state is a harmless scan older than the
 * already-persisted shipment state. Terminal contradictions are not replays. */
function isEarlierProviderState(current: ShipmentStatus, target: ShipmentStatus): boolean {
  if (current === "delivered") {
    return target === "in_transit" || target === "out_for_delivery";
  }
  if (current === "returned_to_sender" || current === "failed") {
    return target === "in_transit" || target === "out_for_delivery";
  }
  return false;
}

function persistenceFailure(message: string, context: Record<string, unknown>): never {
  reportError(`[shipping] ${message}`, context);
  throw new Error(`${message}; retry required`);
}

export async function findShipmentForTracker(
  admin: Admin,
  summary: TrackingSummary
): Promise<ShipmentLookupResult> {
  if (summary.trackerRef) {
    const { data, error } = await admin
      .from("shipments")
      .select("*")
      .eq("provider_tracker_id", summary.trackerRef)
      .limit(2);
    if (error) {
      persistenceFailure("tracker reference lookup failed", {
        trackerRef: summary.trackerRef,
        error,
      });
    }
    if ((data?.length ?? 0) > 1) return { kind: "ambiguous" };
    if (data?.length === 1) {
      return sameProviderIdentity(data[0], summary)
        ? { kind: "found", shipment: data[0] }
        : { kind: "ambiguous" };
    }
  }
  if (summary.trackingCode) {
    const { data, error } = await admin
      .from("shipments")
      .select("*")
      .eq("tracking_code", summary.trackingCode)
      .limit(2);
    if (error) {
      persistenceFailure("tracking code lookup failed", {
        trackingCode: summary.trackingCode,
        error,
      });
    }
    // Ambiguity (two shipments, one code) means we must not guess.
    if ((data?.length ?? 0) > 1) return { kind: "ambiguous" };
    if (data?.length === 1) {
      return sameProviderIdentity(data[0], summary)
        ? { kind: "found", shipment: data[0] }
        : { kind: "ambiguous" };
    }
  }
  return { kind: "missing" };
}

export async function applyTrackingSummary(
  admin: Admin,
  shipment: Shipment,
  summary: TrackingSummary
): Promise<ApplyTrackingResult> {
  let eventsInserted = 0;
  let currentShipment = shipment;

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
      persistenceFailure("event insert failed", { shipmentId: shipment.id, error });
    }
  }

  // Adopt the tracker reference the first time we learn it.
  if (summary.trackerRef && !shipment.provider_tracker_id) {
    const { data: adopted, error } = await admin
      .from("shipments")
      .update({ provider_tracker_id: summary.trackerRef })
      .eq("id", shipment.id)
      .is("provider_tracker_id", null)
      .select("*")
      .maybeSingle();
    if (error) persistenceFailure("tracker adoption failed", { shipmentId: shipment.id, error });
    if (adopted) {
      currentShipment = adopted;
    } else {
      const { data: persisted, error: lookupError } = await admin
        .from("shipments")
        .select("*")
        .eq("id", shipment.id)
        .maybeSingle();
      if (lookupError || !persisted || persisted.provider_tracker_id !== summary.trackerRef) {
        persistenceFailure("tracker adoption could not be verified", {
          shipmentId: shipment.id,
          lookupError,
        });
      }
      currentShipment = persisted;
    }
  }

  const target = STATE_TO_STATUS[summary.state];
  let statusChanged = false;
  if (target && target !== currentShipment.status) {
    if (canTransition(SHIPMENT_TRANSITIONS, currentShipment.status, target)) {
      const patch: Partial<Shipment> = { status: target };
      if (target === "in_transit" && !currentShipment.shipped_at) {
        patch.shipped_at = summary.events[0]?.occurredAt ?? new Date().toISOString();
      }
      if (target === "delivered") {
        // The shipment row keeps its existing fallback; delivery PROOF (N95)
        // reads only the carrier's own date, never this one.
        patch.delivered_at = summary.deliveredAt ?? new Date().toISOString();
      }
      const { data: updated, error } = await admin
        .from("shipments")
        .update(patch)
        .eq("id", currentShipment.id)
        .eq("status", currentShipment.status)
        .select("*")
        .maybeSingle();
      if (error) persistenceFailure("status update failed", { shipmentId: shipment.id, error });
      if (updated) {
        currentShipment = updated;
        statusChanged = true;
      } else {
        const { data: persisted, error: lookupError } = await admin
          .from("shipments")
          .select("*")
          .eq("id", shipment.id)
          .maybeSingle();
        if (lookupError || !persisted) {
          persistenceFailure("status update could not be verified", {
            shipmentId: shipment.id,
            lookupError,
          });
        }
        if (persisted.status !== target) {
          if (canTransition(SHIPMENT_TRANSITIONS, persisted.status, target)) {
            persistenceFailure("status update did not reach the provider state", {
              shipmentId: shipment.id,
              persistedStatus: persisted.status,
              target,
            });
          }
          if (!isEarlierProviderState(persisted.status, target)) {
            persistenceFailure("provider state conflicts with persisted shipment state", {
              shipmentId: shipment.id,
              persistedStatus: persisted.status,
              target,
            });
          }
        }
        currentShipment = persisted;
      }
    } else if (!isEarlierProviderState(currentShipment.status, target)) {
      persistenceFailure("provider state conflicts with persisted shipment state", {
        shipmentId: shipment.id,
        persistedStatus: currentShipment.status,
        target,
      });
    }
  }

  // Return legs never touch order status — they advance the RMA (0055):
  // first movement = the buyer shipped; delivery starts the seller's
  // 48-hour inspection clock, stamped once onto the row.
  if (currentShipment.direction === "return" && currentShipment.return_id) {
    if (["in_transit", "out_for_delivery"].includes(currentShipment.status)) {
      await markReturnInTransit(admin, currentShipment.return_id);
    } else if (currentShipment.status === "delivered") {
      // The in_transit hop may never have been seen (final-scan-only carriers).
      await markReturnInTransit(admin, currentShipment.return_id);
      await markReturnDelivered(admin, currentShipment.return_id, summary);
    }
  }

  let orderEffect: ApplyTrackingResult["orderEffect"] = "none";
  if (currentShipment.direction === "outbound") {
    if (["in_transit", "out_for_delivery"].includes(currentShipment.status)) {
      orderEffect = (await markOrderShipped(admin, currentShipment)) ? "shipped" : "none";
    } else if (currentShipment.status === "delivered") {
      // Delivery also implies the shipped hop happened, even if we never saw
      // the in_transit event (some carriers only report final scan).
      const shipped = await markOrderShipped(admin, currentShipment);
      orderEffect = (await maybeMarkOrderDelivered(admin, currentShipment.order_id))
        ? "delivered"
        : shipped
          ? "shipped"
          : "none";
      // N95: every delivered outbound shipment gets its proof record, from
      // a payload that itself reports the delivery (an older in-transit
      // replay carries no delivery evidence; the database also refuses
      // evidence older than what it holds). A failure throws like any other
      // persistence failure, so the provider's retry records it; dispatch
      // never waits on it.
      if (summary.state === "delivered") await recordDeliveryProof(admin, currentShipment, summary);
    }
  }

  return { shipmentId: shipment.id, eventsInserted, statusChanged, orderEffect };
}

/**
 * Writes the delivery proof for a delivered outbound shipment (N95): the
 * carrier's evidence, judged against the order's frozen facts. The database
 * copies those facts itself and stores 'review' if they don't support a
 * 'verified' judgement.
 */
export async function recordDeliveryProof(
  admin: Admin,
  shipment: Shipment,
  summary: TrackingSummary
): Promise<"verified" | "review"> {
  const { data: order, error } = await admin
    .from("orders")
    .select("ship_postcode, ship_city, ship_country, deliver_by, created_at, total_cents")
    .eq("id", shipment.order_id)
    .maybeSingle();
  if (error || !order) {
    persistenceFailure("delivery proof order lookup failed", { orderId: shipment.order_id, error });
  }
  const evidence = deliveryEvidence(summary);
  const result = evaluateDeliveryProof(evidence, {
    shipPostcode: order.ship_postcode,
    shipCity: order.ship_city,
    shipCountry: order.ship_country,
    deliverBy: order.deliver_by,
    createdAt: order.created_at,
    totalCents: order.total_cents,
  });
  const { data, error: recordError } = await admin.rpc("record_delivery_proof", {
    p_shipment: shipment.id,
    p_carrier_delivered_at: evidence.carrierDeliveredAt ?? undefined,
    p_destination_postcode: evidence.destinationPostcode ?? undefined,
    p_destination_city: evidence.destinationCity ?? undefined,
    p_first_scan_at: evidence.firstScanAt ?? undefined,
    p_signed_by: evidence.signedBy ?? undefined,
    p_evidence_at: evidence.evidenceAt ?? undefined,
    p_destination_match: result.destinationMatch,
    p_verdict: result.verdict,
    p_reasons: result.reasons,
  });
  const recorded = data as { ok?: boolean; verdict?: "verified" | "review"; reason?: string } | null;
  if (recordError || !recorded?.ok || !recorded.verdict) {
    persistenceFailure("delivery proof could not be recorded", {
      shipmentId: shipment.id,
      recordError,
      reason: recorded?.reason,
    });
  }
  return recorded.verdict;
}

async function readReturnStatus(admin: Admin, returnId: string): Promise<string> {
  const { data, error } = await admin
    .from("returns")
    .select("status")
    .eq("id", returnId)
    .maybeSingle();
  if (error || !data) persistenceFailure("return status could not be verified", { returnId, error });
  return data.status;
}

async function markReturnInTransit(admin: Admin, returnId: string): Promise<boolean> {
  const { data, error } = await admin
    .from("returns")
    .update({ status: "in_transit", shipped_at: new Date().toISOString() })
    .eq("id", returnId)
    .eq("status", "awaiting_shipment")
    .select("id")
    .maybeSingle();
  if (error) persistenceFailure("return in-transit update failed", { returnId, error });
  if (data) return true;
  const status = await readReturnStatus(admin, returnId);
  if (!["in_transit", "delivered", "received", "completed", "escalated"].includes(status)) {
    persistenceFailure("return in-transit update affected no row", { returnId, status });
  }
  return false;
}

async function markReturnDelivered(
  admin: Admin,
  returnId: string,
  summary: TrackingSummary
): Promise<boolean> {
  const deliveredAt = summary.deliveredAt ??
    summary.events.find((event) => event.state === "delivered")?.occurredAt ??
    new Date().toISOString();
  const deliveredTime = new Date(deliveredAt).getTime();
  const sellerRespondBy = new Date(
    (Number.isFinite(deliveredTime) ? deliveredTime : Date.now()) +
      SELLER_INSPECT_HOURS * 3_600_000
  ).toISOString();
  const { data, error } = await admin
    .from("returns")
    .update({
      status: "delivered",
      delivered_at: deliveredAt,
      seller_respond_by: sellerRespondBy,
    })
    .eq("id", returnId)
    .eq("status", "in_transit")
    .select("id")
    .maybeSingle();
  if (error) persistenceFailure("return delivered update failed", { returnId, error });
  if (data) return true;
  const status = await readReturnStatus(admin, returnId);
  if (
    ![
      "delivered",
      "received",
      "completed",
      "escalated",
    ].includes(status)
  ) {
    persistenceFailure("return delivered update affected no row", { returnId, status });
  }
  return false;
}

/**
 * What the two tracking functions in the database answer (plan 2 item A2:
 * the database makes the change; this file no longer writes an order's
 * status). 'moved': the order moved. 'moved_in_case': the order is in an open
 * case, which now resolves to the new status. Otherwise the status the order
 * has, or null when there is no such order.
 */
type TrackingMove = { moved: boolean; status: string | null };

function readTrackingMove(answer: unknown): TrackingMove {
  if (answer === "moved" || answer === "moved_in_case") return { moved: true, status: null };
  if (typeof answer === "string" && answer.startsWith("unchanged:")) return { moved: false, status: answer.slice("unchanged:".length) };
  return { moved: false, status: null };
}

/** paid → shipped, once, mirroring carrier/tracking onto the order's legacy
 *  columns (existing UI + nextAction read them). An open not-received case on
 *  an undispatched order (N6) stays open: dispatch and tracking stay
 *  possible, and resolving the case lands on 'shipped'. */
async function markOrderShipped(admin: Admin, shipment: Shipment): Promise<boolean> {
  const { data, error } = await admin.rpc("order_mark_shipped_from_tracking", {
    p_order: shipment.order_id,
    p_shipped_at: shipment.shipped_at ?? new Date().toISOString(),
    // Left out when the shipment has none: the function's default is null,
    // which is what the order's column then holds.
    p_carrier: shipment.carrier ?? undefined,
    p_tracking: shipment.tracking_code ?? undefined,
  });
  if (error) persistenceFailure("order shipped update failed", { orderId: shipment.order_id, error });
  const move = readTrackingMove(data);
  if (move.moved) return true;
  if (move.status === null) {
    persistenceFailure("order shipped update could not be verified", { orderId: shipment.order_id });
  }
  if (!["shipped", "delivered", "completed", "disputed", "refunded", "cancelled"].includes(move.status)) {
    persistenceFailure("order shipped update affected no row", {
      orderId: shipment.order_id,
      status: move.status,
    });
  }
  return false;
}

/** delivered when every live outbound shipment is delivered (§19). */
export async function maybeMarkOrderDelivered(admin: Admin, orderId: string): Promise<boolean> {
  const { data: shipments, error } = await admin
    .from("shipments")
    .select("status, direction")
    .eq("order_id", orderId)
    .eq("direction", "outbound");
  if (error) persistenceFailure("outbound shipment lookup failed", { orderId, error });
  if (!shipments?.length) {
    persistenceFailure("outbound shipment lookup returned no rows", { orderId });
  }

  const live = shipments.filter((s) => !["cancelled", "failed"].includes(s.status));
  if (!live.length || !live.every((s) => s.status === "delivered")) return false;

  // Delivered while a case is open: the case stays open, and resolving it
  // lands on 'delivered' with this delivery's date, as it would have without
  // the case.
  const { data, error: updateError } = await admin.rpc("order_mark_delivered_from_tracking", {
    p_order: orderId,
    p_delivered_at: new Date().toISOString(),
  });
  if (updateError) persistenceFailure("order delivered update failed", { orderId, updateError });
  const move = readTrackingMove(data);
  if (move.moved) return true;
  if (move.status === null) {
    persistenceFailure("order delivered update could not be verified", { orderId });
  }
  if (!["delivered", "completed", "disputed", "refunded", "cancelled"].includes(move.status)) {
    persistenceFailure("order delivered update affected no row", {
      orderId,
      status: move.status,
    });
  }
  return false;
}
