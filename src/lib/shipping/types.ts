/**
 * DRVN's shipping domain model (transaction-completion brief §8).
 *
 * These types are DRVN-owned, not a mirror of any carrier API. EasyPost is
 * the first provider behind the seam; provider-specific identifiers travel as
 * opaque `*Ref` strings so nothing outside src/lib/shipping ever learns what
 * they mean. The interface exposes only the operations DRVN needs — rate,
 * buy, void, track, return — and adds nothing speculative.
 *
 * Client-safe: types only, no server imports.
 */

export type ShippingAddress = {
  name: string;
  company?: string | null;
  street1: string;
  street2?: string | null;
  city: string;
  /** State/province code where the country uses one. */
  state?: string | null;
  postalCode: string;
  /** ISO-3166-1 alpha-2. */
  country: string;
  phone?: string | null;
  email?: string | null;
};

/** One physical parcel. MVP: one order item = one parcel (brief §12) — the
 *  seller declares the packed dimensions on the listing. */
export type Parcel = {
  lengthIn: number;
  widthIn: number;
  heightIn: number;
  weightOz: number;
};

export type RateQuote = {
  /** Provider rate reference — what buyLabel consumes. Opaque. */
  rateRef: string;
  carrier: string;
  service: string;
  /** Human label ("USPS Priority Mail"), for the buyer-facing picker. */
  serviceLabel: string;
  amountCents: number;
  currency: string;
  estDeliveryDays: number | null;
};

export type RatedShipment = {
  /** Provider shipment reference — pairs with a rateRef at purchase. Opaque. */
  shipmentRef: string;
  rates: RateQuote[];
};

export type PurchasedLabel = {
  shipmentRef: string;
  /** URL of the printable label document. */
  labelUrl: string;
  trackingCode: string;
  carrier: string;
  service: string;
  /** What the provider actually charged for the label. */
  amountCents: number;
  currency: string;
  trackerRef: string | null;
};

/** DRVN's tracking vocabulary — providers map into this, never out of it. */
export type TrackingState =
  | "unknown"
  | "pre_transit"
  | "in_transit"
  | "out_for_delivery"
  | "delivered"
  | "available_for_pickup"
  | "return_to_sender"
  | "failure"
  | "cancelled";

export type TrackingEvent = {
  /** Provider event reference for dedupe. Opaque; may be null for synthesized events. */
  providerEventRef: string | null;
  state: TrackingState;
  description: string | null;
  occurredAt: string;
  city: string | null;
  state_code: string | null;
  country: string | null;
};

export type TrackingSummary = {
  trackerRef: string | null;
  trackingCode: string;
  carrier: string | null;
  state: TrackingState;
  estDeliveryAt: string | null;
  deliveredAt: string | null;
  events: TrackingEvent[];
};

export type AddressVerification = {
  deliverable: boolean;
  /** Provider-normalized form when available — prefer storing this. */
  normalized: ShippingAddress | null;
  /** Human-readable problems ("postal code mismatch"). Empty when clean. */
  messages: string[];
};

export type VoidLabelResult = {
  /** null on a provider read proves no refund has been requested yet. Unknown
   *  values remain ambiguous and must never be treated as a refund. */
  state: "not_requested" | "submitted" | "refunded" | "rejected" | "unknown";
};

export type GetRatesInput = {
  from: ShippingAddress;
  to: ShippingAddress;
  parcel: Parcel;
  /** Marketplace postage identity for this seller (brief §10), when required. */
  endShipperRef?: string | null;
};

export type BuyLabelInput = {
  shipmentRef: string;
  rateRef: string;
  /** Replay guard — a duplicate buy for the same shipment must not double-charge. */
  idempotencyKey?: string;
  endShipperRef?: string | null;
  insuranceCents?: number | null;
};

export type CreateTrackerInput = {
  trackingCode: string;
  /** Carrier slug when known — required for reliable tracking of seller-entered codes. */
  carrier?: string | null;
};

export type GetTrackingInput = {
  trackerRef?: string | null;
  trackingCode?: string | null;
  carrier?: string | null;
};

/**
 * The operations DRVN needs from a shipping provider — nothing more.
 * Implementations: easypost.ts (real), stub.ts (deterministic, for dev/e2e).
 */
export interface ShippingProvider {
  readonly name: string;
  verifyAddress(address: ShippingAddress): Promise<AddressVerification>;
  getRates(input: GetRatesInput): Promise<RatedShipment>;
  buyLabel(input: BuyLabelInput): Promise<PurchasedLabel>;
  voidLabel(input: { shipmentRef: string }): Promise<VoidLabelResult>;
  getLabelRefundStatus(input: { shipmentRef: string }): Promise<VoidLabelResult>;
  createTracker(input: CreateTrackerInput): Promise<TrackingSummary>;
  getTracking(input: GetTrackingInput): Promise<TrackingSummary>;
  /** A return shipment is a rated shipment with the legs swapped and the
   *  provider told it's a return (some carriers price these differently). */
  createReturnShipment(input: GetRatesInput): Promise<RatedShipment>;
  /** Ensures this seller has a postage identity with the provider (EasyPost
   *  EndShipper). Returns the opaque reference to persist on the seller's
   *  fulfillment profile. Providers that don't need one return null. */
  ensureEndShipper(address: ShippingAddress): Promise<string | null>;
}

/** Thrown for provider failures the caller can present or retry on. */
export class ShippingProviderError extends Error {
  readonly retryable: boolean;
  constructor(message: string, opts?: { retryable?: boolean; cause?: unknown }) {
    super(message);
    this.name = "ShippingProviderError";
    this.retryable = opts?.retryable ?? false;
    if (opts?.cause) (this as { cause?: unknown }).cause = opts.cause;
  }
}
