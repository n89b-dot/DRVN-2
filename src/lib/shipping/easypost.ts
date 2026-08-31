import "server-only";

import {
  ShippingProviderError,
  type AddressVerification,
  type BuyLabelInput,
  type CreateTrackerInput,
  type GetRatesInput,
  type GetTrackingInput,
  type Parcel,
  type PurchasedLabel,
  type RatedShipment,
  type RateQuote,
  type ShippingAddress,
  type ShippingProvider,
  type TrackingEvent,
  type TrackingState,
  type TrackingSummary,
  type VoidLabelResult,
} from "./types";

/**
 * EasyPost implementation of the ShippingProvider seam (brief §8/§10).
 *
 * Plain fetch against the REST API — same posture as the Typesense client:
 * no SDK dependency, explicit timeouts, and every provider object mapped into
 * DRVN's own types at this boundary so EasyPost vocabulary never leaks out.
 *
 * Marketplace account model: DRVN is a platform buying postage on behalf of
 * sellers. USPS postage on a platform account requires an EndShipper identity
 * per seller (ensureEndShipper → seller_fulfillment_profiles.
 * easypost_end_shipper_id). The reference is opaque here precisely so a later
 * move between EndShipper and Forge changes this file, not the callers.
 *
 * Test vs production is the API key itself (EZTK… vs EZAK…); nothing in this
 * module branches on it.
 */

const BASE = "https://api.easypost.com/v2";
const TIMEOUT_MS = 15_000;

type Json = Record<string, unknown>;

function apiKey(): string {
  const key = process.env.EASYPOST_API_KEY;
  if (!key) {
    throw new ShippingProviderError("EASYPOST_API_KEY is not configured", { retryable: false });
  }
  return key;
}

async function request(method: "GET" | "POST", path: string, body?: Json): Promise<Json> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      headers: {
        Authorization: `Basic ${Buffer.from(`${apiKey()}:`).toString("base64")}`,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (cause) {
    // Network failure / timeout — safe to retry a read; writes go through
    // callers that re-check state before re-calling (label idempotency).
    throw new ShippingProviderError("EasyPost unreachable", { retryable: true, cause });
  }

  const text = await res.text();
  let json: Json = {};
  try {
    json = text ? (JSON.parse(text) as Json) : {};
  } catch {
    // fall through with the raw text in the error below
  }

  if (!res.ok) {
    const err = json.error as Json | undefined;
    const message =
      (typeof err?.message === "string" && err.message) ||
      `EasyPost ${res.status}${text ? `: ${text.slice(0, 300)}` : ""}`;
    throw new ShippingProviderError(message, {
      retryable: res.status === 429 || res.status >= 500,
    });
  }
  return json;
}

// ── Pure mappers (exported for unit tests) ─────────────────────────────────

export function toEasypostAddress(a: ShippingAddress): Json {
  return {
    name: a.name,
    company: a.company ?? undefined,
    street1: a.street1,
    street2: a.street2 ?? undefined,
    city: a.city,
    state: a.state ?? undefined,
    zip: a.postalCode,
    country: a.country,
    phone: a.phone ?? undefined,
    email: a.email ?? undefined,
  };
}

export function fromEasypostAddress(a: Json | null | undefined): ShippingAddress | null {
  if (!a || typeof a.street1 !== "string" || typeof a.city !== "string") return null;
  return {
    name: typeof a.name === "string" ? a.name : "",
    company: typeof a.company === "string" ? a.company : null,
    street1: a.street1,
    street2: typeof a.street2 === "string" ? a.street2 : null,
    city: a.city,
    state: typeof a.state === "string" ? a.state : null,
    postalCode: typeof a.zip === "string" ? a.zip : "",
    country: typeof a.country === "string" ? a.country : "US",
    phone: typeof a.phone === "string" ? a.phone : null,
    email: typeof a.email === "string" ? a.email : null,
  };
}

export function toEasypostParcel(p: Parcel): Json {
  return {
    length: p.lengthIn,
    width: p.widthIn,
    height: p.heightIn,
    weight: p.weightOz,
  };
}

/** EasyPost rates are dollar strings ("7.33"). */
export function dollarsToCents(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return Math.round(value * 100);
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return Math.round(parsed * 100);
  }
  return null;
}

/** "PriorityMailInternational" → "Priority Mail International". */
export function humanizeService(service: string): string {
  return service
    .replace(/([a-z\d])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .trim();
}

const TRACKING_STATE_MAP: Record<string, TrackingState> = {
  pre_transit: "pre_transit",
  in_transit: "in_transit",
  out_for_delivery: "out_for_delivery",
  delivered: "delivered",
  available_for_pickup: "available_for_pickup",
  return_to_sender: "return_to_sender",
  failure: "failure",
  cancelled: "cancelled",
  error: "failure",
  unknown: "unknown",
};

export function mapTrackingState(status: unknown): TrackingState {
  return typeof status === "string" ? (TRACKING_STATE_MAP[status] ?? "unknown") : "unknown";
}

export function mapRates(shipment: Json): RatedShipment {
  const shipmentRef = typeof shipment.id === "string" ? shipment.id : null;
  if (!shipmentRef) {
    throw new ShippingProviderError("EasyPost shipment has no id");
  }
  const raw = Array.isArray(shipment.rates) ? shipment.rates : [];
  const rates: RateQuote[] = [];
  for (const entry of raw) {
    const r = entry as Json;
    const amountCents = dollarsToCents(r.rate);
    if (typeof r.id !== "string" || typeof r.carrier !== "string" || typeof r.service !== "string")
      continue;
    if (amountCents == null || amountCents < 0) continue;
    rates.push({
      rateRef: r.id,
      carrier: r.carrier,
      service: r.service,
      serviceLabel: `${r.carrier} ${humanizeService(r.service)}`,
      amountCents,
      currency: typeof r.currency === "string" ? r.currency : "USD",
      estDeliveryDays:
        typeof r.delivery_days === "number"
          ? r.delivery_days
          : typeof r.est_delivery_days === "number"
            ? r.est_delivery_days
            : null,
    });
  }
  rates.sort((a, b) => a.amountCents - b.amountCents);
  return { shipmentRef, rates };
}

export function mapTracker(tracker: Json): TrackingSummary {
  const details = Array.isArray(tracker.tracking_details) ? tracker.tracking_details : [];
  const events: TrackingEvent[] = details.map((entry, index) => {
    const d = entry as Json;
    const loc = (d.tracking_location ?? {}) as Json;
    return {
      // EasyPost tracking_details rows carry no id; datetime+message is the
      // stable identity used for dedupe.
      providerEventRef:
        typeof d.datetime === "string"
          ? `${d.datetime}:${typeof d.message === "string" ? d.message : index}`
          : null,
      state: mapTrackingState(d.status),
      description: typeof d.message === "string" ? d.message : null,
      occurredAt: typeof d.datetime === "string" ? d.datetime : new Date(0).toISOString(),
      city: typeof loc.city === "string" ? loc.city : null,
      state_code: typeof loc.state === "string" ? loc.state : null,
      country: typeof loc.country === "string" ? loc.country : null,
    };
  });
  const delivered = events.filter((e) => e.state === "delivered");
  return {
    trackerRef: typeof tracker.id === "string" ? tracker.id : null,
    trackingCode: typeof tracker.tracking_code === "string" ? tracker.tracking_code : "",
    carrier: typeof tracker.carrier === "string" ? tracker.carrier : null,
    state: mapTrackingState(tracker.status),
    estDeliveryAt: typeof tracker.est_delivery_date === "string" ? tracker.est_delivery_date : null,
    deliveredAt: delivered.length ? delivered[delivered.length - 1].occurredAt : null,
    events,
  };
}

// ── Provider ───────────────────────────────────────────────────────────────

async function ratedShipment(input: GetRatesInput, isReturn: boolean): Promise<RatedShipment> {
  const body: Json = {
    shipment: {
      from_address: toEasypostAddress(input.from),
      to_address: toEasypostAddress(input.to),
      parcel: toEasypostParcel(input.parcel),
      is_return: isReturn || undefined,
    },
  };
  const shipment = await request("POST", "/shipments", body);
  return mapRates(shipment);
}

function labelFromShipment(shipment: Json): PurchasedLabel | null {
  const postage = shipment.postage_label as Json | undefined;
  const selected = shipment.selected_rate as Json | undefined;
  const tracker = shipment.tracker as Json | undefined;
  if (!postage || typeof postage.label_url !== "string") return null;
  const amountCents = dollarsToCents(selected?.rate);
  return {
    shipmentRef: typeof shipment.id === "string" ? shipment.id : "",
    labelUrl: postage.label_url,
    trackingCode: typeof shipment.tracking_code === "string" ? shipment.tracking_code : "",
    carrier: typeof selected?.carrier === "string" ? selected.carrier : "",
    service: typeof selected?.service === "string" ? selected.service : "",
    amountCents: amountCents ?? 0,
    currency: typeof selected?.currency === "string" ? selected.currency : "USD",
    trackerRef: typeof tracker?.id === "string" ? tracker.id : null,
  };
}

export const easypostProvider: ShippingProvider = {
  name: "easypost",

  async verifyAddress(address: ShippingAddress): Promise<AddressVerification> {
    const result = await request("POST", "/addresses", {
      address: toEasypostAddress(address),
      verify: ["delivery"],
    });
    const verifications = (result.verifications ?? {}) as Json;
    const delivery = (verifications.delivery ?? {}) as Json;
    const errors = Array.isArray(delivery.errors) ? delivery.errors : [];
    return {
      deliverable: delivery.success === true,
      normalized: fromEasypostAddress(result),
      messages: errors
        .map((e) => (typeof (e as Json).message === "string" ? ((e as Json).message as string) : null))
        .filter((m): m is string => Boolean(m)),
    };
  },

  getRates(input: GetRatesInput): Promise<RatedShipment> {
    return ratedShipment(input, false);
  },

  createReturnShipment(input: GetRatesInput): Promise<RatedShipment> {
    return ratedShipment(input, true);
  },

  async buyLabel(input: BuyLabelInput): Promise<PurchasedLabel> {
    const body: Json = {
      rate: { id: input.rateRef },
      end_shipper_id: input.endShipperRef ?? undefined,
      insurance:
        input.insuranceCents && input.insuranceCents > 0
          ? (input.insuranceCents / 100).toFixed(2)
          : undefined,
    };
    try {
      const shipment = await request("POST", `/shipments/${input.shipmentRef}/buy`, body);
      const label = labelFromShipment(shipment);
      if (!label) throw new ShippingProviderError("EasyPost buy returned no label");
      return label;
    } catch (error) {
      // A shipment can only be bought once. If a retry raced an earlier
      // success (timeout after purchase — brief §41), re-read the shipment
      // and return the existing label rather than failing the operation.
      if (error instanceof ShippingProviderError && /purchas/i.test(error.message)) {
        const shipment = await request("GET", `/shipments/${input.shipmentRef}`);
        const label = labelFromShipment(shipment);
        if (label) return label;
      }
      throw error;
    }
  },

  async voidLabel(input: { shipmentRef: string }): Promise<VoidLabelResult> {
    const shipment = await request("POST", `/shipments/${input.shipmentRef}/refund`);
    const status = typeof shipment.refund_status === "string" ? shipment.refund_status : "";
    if (status === "refunded") return { state: "refunded" };
    if (status === "rejected") return { state: "rejected" };
    return { state: "submitted" };
  },

  async createTracker(input: CreateTrackerInput): Promise<TrackingSummary> {
    const tracker = await request("POST", "/trackers", {
      tracker: {
        tracking_code: input.trackingCode,
        carrier: input.carrier ?? undefined,
      },
    });
    return mapTracker(tracker);
  },

  async getTracking(input: GetTrackingInput): Promise<TrackingSummary> {
    if (input.trackerRef) {
      return mapTracker(await request("GET", `/trackers/${input.trackerRef}`));
    }
    if (input.trackingCode) {
      // Creating a tracker for an existing code returns the existing tracker.
      return this.createTracker({
        trackingCode: input.trackingCode,
        carrier: input.carrier ?? null,
      });
    }
    throw new ShippingProviderError("getTracking needs a trackerRef or trackingCode");
  },

  async ensureEndShipper(address: ShippingAddress): Promise<string | null> {
    const result = await request("POST", "/end_shippers", {
      address: toEasypostAddress(address),
    });
    if (typeof result.id !== "string") {
      throw new ShippingProviderError("EasyPost end_shipper has no id");
    }
    return result.id;
  },
};
