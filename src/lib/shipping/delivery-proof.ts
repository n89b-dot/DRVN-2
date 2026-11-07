import type { TrackingState, TrackingSummary } from "./types";

/**
 * Delivery proof (N95, Neil's ruling "Copy eBay", 7 Nov 2026).
 *
 * A carrier saying "delivered" is not, on its own, proof that THIS order was
 * delivered: a seller could enter the tracking number of an old or unrelated
 * parcel. eBay's valid proof of delivery is a delivered status, the delivery
 * date, a destination matching the order (ZIP or postcode, else city), and a
 * shipping scan before the latest estimated delivery date; a signature is
 * required to defend a case at $750 or more. That is the rule here:
 *
 *  - verified: every one of those holds, and nothing contradicts the sale
 *    (the scan and the delivery both come after the order was placed);
 *  - review:   anything missing or contradictory. DRVN support decides.
 *
 * The record lives in delivery_proofs, one per delivered outbound shipment,
 * written by record_delivery_proof (20261107210300), which copies the
 * order's own facts onto the row and refuses a 'verified' they don't support.
 * Proof decides not-received cases. It never blocks dispatch and never moves
 * a payout.
 *
 * Pure: no server imports, so the matching is unit-tested on its own.
 */

/** A signature is required to defend a case from this order total (eBay: $750). */
export const SIGNATURE_REQUIRED_FROM_CENTS = 75_000;

export type ProofReason =
  | "carrier_date_missing"
  | "delivered_before_sale"
  | "destination_missing"
  | "destination_mismatch"
  | "scan_missing"
  | "scan_before_sale"
  | "scan_after_deadline"
  | "deadline_missing"
  | "signature_missing";

export type DestinationMatch = "postcode" | "city" | "mismatch" | "missing";

/** What the carrier told us, reduced to the facts proof needs. */
export type DeliveryEvidence = {
  /** The carrier's delivered scan time. Never "now". */
  carrierDeliveredAt: string | null;
  destinationPostcode: string | null;
  destinationCity: string | null;
  /** The earliest real carrier scan (a label being created is not a scan). */
  firstScanAt: string | null;
  signedBy: string | null;
};

/** The order's frozen facts the evidence is judged against. */
export type ProofOrder = {
  shipPostcode: string | null;
  shipCity: string | null;
  shipCountry: string | null;
  /** The latest delivery date frozen at purchase (orders.deliver_by). */
  deliverBy: string | null;
  /** When the order was placed: nothing before it can be this order's. */
  createdAt: string;
  totalCents: number;
};

export type DeliveryProofResult = {
  verdict: "verified" | "review";
  destinationMatch: DestinationMatch;
  signatureRequired: boolean;
  reasons: ProofReason[];
};

const SCAN_STATES = new Set<TrackingState>([
  "in_transit",
  "out_for_delivery",
  "available_for_pickup",
  "delivered",
]);

const EPOCH = new Date(0).toISOString();

function validTime(value: string | null | undefined): number | null {
  if (!value || value === EPOCH) return null;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) && ms > 0 ? ms : null;
}

function text(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/**
 * Postcode comparison key: letters and digits only, upper case; a US ZIP+4
 * compares on its five-digit ZIP. Mirrors private.postcode_key.
 */
export function postcodeKey(code: string | null | undefined, country: string | null | undefined): string | null {
  const key = (code ?? "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  if (!key) return null;
  const us = !country || ["US", "USA"].includes(country.trim().toUpperCase());
  return us && /^[0-9]{9}$/.test(key) ? key.slice(0, 5) : key;
}

/** City comparison key: letters and digits only, upper case. Mirrors private.city_key. */
export function cityKey(city: string | null | undefined): string | null {
  const key = (city ?? "").replace(/[^\p{L}\p{N}]/gu, "").toUpperCase();
  return key || null;
}

/** Postcode first; the city only when the carrier gave no postcode. */
export function matchDestination(
  evidence: Pick<DeliveryEvidence, "destinationPostcode" | "destinationCity">,
  order: Pick<ProofOrder, "shipPostcode" | "shipCity" | "shipCountry">
): DestinationMatch {
  const carrierPostcode = postcodeKey(evidence.destinationPostcode, order.shipCountry);
  if (carrierPostcode) {
    const orderPostcode = postcodeKey(order.shipPostcode, order.shipCountry);
    if (!orderPostcode) return "missing";
    return carrierPostcode === orderPostcode ? "postcode" : "mismatch";
  }
  const carrierCity = cityKey(evidence.destinationCity);
  const orderCity = cityKey(order.shipCity);
  if (!carrierCity || !orderCity) return "missing";
  return carrierCity === orderCity ? "city" : "mismatch";
}

/**
 * The facts proof needs from a provider tracking summary. The destination is
 * the carrier's own destination when it reports one, else the location of the
 * delivered scan.
 */
export function deliveryEvidence(summary: TrackingSummary): DeliveryEvidence {
  const deliveredScans = summary.events.filter(
    (event) => event.state === "delivered" && validTime(event.occurredAt) !== null
  );
  const lastDelivered = deliveredScans.at(-1) ?? null;
  const carrierDeliveredAt =
    validTime(summary.deliveredAt) !== null ? summary.deliveredAt : (lastDelivered?.occurredAt ?? null);

  let firstScan: number | null = null;
  for (const event of summary.events) {
    if (!SCAN_STATES.has(event.state)) continue;
    const at = validTime(event.occurredAt);
    if (at !== null && (firstScan === null || at < firstScan)) firstScan = at;
  }

  const destinationPostcode = text(summary.destination?.postalCode) ?? text(lastDelivered?.postalCode);
  const destinationCity = text(summary.destination?.city) ?? text(lastDelivered?.city);
  return {
    carrierDeliveredAt,
    destinationPostcode,
    destinationCity,
    firstScanAt: firstScan === null ? null : new Date(firstScan).toISOString(),
    signedBy: text(summary.signedBy),
  };
}

/** Judges the evidence against the order. */
export function evaluateDeliveryProof(evidence: DeliveryEvidence, order: ProofOrder): DeliveryProofResult {
  const reasons: ProofReason[] = [];
  const sale = validTime(order.createdAt);

  const delivered = validTime(evidence.carrierDeliveredAt);
  if (delivered === null) reasons.push("carrier_date_missing");
  else if (sale !== null && delivered < sale) reasons.push("delivered_before_sale");

  const destinationMatch = matchDestination(evidence, order);
  if (destinationMatch === "missing") reasons.push("destination_missing");
  if (destinationMatch === "mismatch") reasons.push("destination_mismatch");

  const scan = validTime(evidence.firstScanAt);
  const deadline = validTime(order.deliverBy);
  if (scan === null) reasons.push("scan_missing");
  else if (sale !== null && scan < sale) reasons.push("scan_before_sale");
  if (deadline === null) reasons.push("deadline_missing");
  else if (scan !== null && scan > deadline) reasons.push("scan_after_deadline");

  const signatureRequired = order.totalCents >= SIGNATURE_REQUIRED_FROM_CENTS;
  if (signatureRequired && !text(evidence.signedBy)) reasons.push("signature_missing");

  return {
    verdict: reasons.length === 0 ? "verified" : "review",
    destinationMatch,
    signatureRequired,
    reasons,
  };
}

/** Plain-English reasons, for the console and the order page. */
export const PROOF_REASON_LABEL: Record<ProofReason | "evidence_check_failed", string> = {
  carrier_date_missing: "The carrier gave no delivery date",
  delivered_before_sale: "Delivered before the order was placed",
  destination_missing: "The carrier gave no destination to match",
  destination_mismatch: "Delivered somewhere other than the order's address",
  scan_missing: "No carrier scan on record",
  scan_before_sale: "Scanned before the order was placed",
  scan_after_deadline: "First scanned after the latest delivery date",
  deadline_missing: "The order has no latest delivery date",
  signature_missing: "No signature on an order of $750 or more",
  evidence_check_failed: "The order's records don't support the carrier's evidence",
};
