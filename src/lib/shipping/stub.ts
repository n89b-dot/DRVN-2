import {
  ShippingProviderError,
  type AddressVerification,
  type BuyLabelInput,
  type CreateTrackerInput,
  type GetRatesInput,
  type GetTrackingInput,
  type PurchasedLabel,
  type RatedShipment,
  type ShippingProvider,
  type TrackingSummary,
  type VoidLabelResult,
} from "./types";

/**
 * Deterministic shipping stub — the SHIPPING_MODE=stub provider, mirroring
 * the payments stub's role: dev and e2e run the full DRVN Shipping flow (rate
 * → select → buy → track → deliver) with no network and no EasyPost account.
 *
 * Determinism rules (so e2e can assert on amounts):
 *  - Two rates: "Stub Ground" = 800 + 10¢/oz, "Stub Priority" = 1500 + 15¢/oz.
 *  - Refs encode their inputs (`stubshp_<weight>`, `stubrate_<service>_<amount>`)
 *    so buyLabel can price the label without shared state between requests —
 *    serverless instances share nothing, exactly like the real provider.
 *  - Tracking: codes containing "DELIVERED" report delivered; everything else
 *    reports in_transit. The e2e driver flips a shipment by writing the
 *    tracking event through the webhook route, not by mutating the stub.
 */

function groundCents(weightOz: number): number {
  return 800 + Math.round(weightOz * 10);
}
function priorityCents(weightOz: number): number {
  return 1500 + Math.round(weightOz * 15);
}

function rated(input: GetRatesInput, isReturn: boolean): RatedShipment {
  const weight = Math.max(1, Math.round(input.parcel.weightOz));
  const prefix = isReturn ? "stubret" : "stubshp";
  const shipmentRef = `${prefix}_${weight}`;
  return {
    shipmentRef,
    rates: [
      {
        rateRef: `stubrate_ground_${groundCents(weight)}`,
        carrier: "StubCarrier",
        service: "Ground",
        serviceLabel: "StubCarrier Ground",
        amountCents: groundCents(weight),
        currency: "USD",
        estDeliveryDays: 5,
      },
      {
        rateRef: `stubrate_priority_${priorityCents(weight)}`,
        carrier: "StubCarrier",
        service: "Priority",
        serviceLabel: "StubCarrier Priority",
        amountCents: priorityCents(weight),
        currency: "USD",
        estDeliveryDays: 2,
      },
    ],
  };
}

function summaryFor(trackingCode: string, carrier: string | null): TrackingSummary {
  const delivered = trackingCode.includes("DELIVERED");
  const now = new Date().toISOString();
  return {
    trackerRef: `stubtrk_${trackingCode}`,
    trackingCode,
    carrier: carrier ?? "StubCarrier",
    state: delivered ? "delivered" : "in_transit",
    estDeliveryAt: null,
    deliveredAt: delivered ? now : null,
    events: [
      {
        providerEventRef: `${trackingCode}:0`,
        state: delivered ? "delivered" : "in_transit",
        description: delivered ? "Delivered (stub)" : "In transit (stub)",
        occurredAt: now,
        city: null,
        state_code: null,
        country: "US",
      },
    ],
  };
}

export const stubShippingProvider: ShippingProvider = {
  name: "stub",

  async verifyAddress(address): Promise<AddressVerification> {
    // "UNDELIVERABLE" anywhere in street1 exercises the failure path in e2e.
    const bad = address.street1.toUpperCase().includes("UNDELIVERABLE");
    return {
      deliverable: !bad,
      normalized: bad ? null : address,
      messages: bad ? ["Address is not deliverable (stub)"] : [],
    };
  },

  async getRates(input: GetRatesInput): Promise<RatedShipment> {
    return rated(input, false);
  },

  async createReturnShipment(input: GetRatesInput): Promise<RatedShipment> {
    return rated(input, true);
  },

  async buyLabel(input: BuyLabelInput): Promise<PurchasedLabel> {
    const match = /^stubrate_(ground|priority)_(\d+)$/.exec(input.rateRef);
    if (!match || !input.shipmentRef.startsWith("stub")) {
      throw new ShippingProviderError("Unknown stub rate/shipment reference");
    }
    const service = match[1] === "ground" ? "Ground" : "Priority";
    // Unique per real shipment row (the idempotency key carries its id), so
    // codes never collide across orders — a replayed buy still gets the same
    // code back. Falls back to the shipment ref for keyless callers.
    const suffix = (input.idempotencyKey ?? input.shipmentRef)
      .replace(/[^a-zA-Z0-9]/g, "")
      .toUpperCase()
      .slice(-16);
    const trackingCode = `STUB${service.toUpperCase()}${suffix}`;
    return {
      shipmentRef: input.shipmentRef,
      labelUrl: `https://stub.invalid/labels/${input.shipmentRef}.pdf`,
      trackingCode,
      carrier: "StubCarrier",
      service,
      amountCents: Number(match[2]),
      currency: "USD",
      trackerRef: `stubtrk_${trackingCode}`,
    };
  },

  async voidLabel(): Promise<VoidLabelResult> {
    return { state: "refunded" };
  },

  async createTracker(input: CreateTrackerInput): Promise<TrackingSummary> {
    return summaryFor(input.trackingCode, input.carrier ?? null);
  },

  async getTracking(input: GetTrackingInput): Promise<TrackingSummary> {
    const code =
      input.trackingCode ??
      (input.trackerRef?.startsWith("stubtrk_") ? input.trackerRef.slice("stubtrk_".length) : null);
    if (!code) throw new ShippingProviderError("getTracking needs a trackerRef or trackingCode");
    return summaryFor(code, input.carrier ?? null);
  },

  async ensureEndShipper(): Promise<string | null> {
    return "stubes_1";
  },
};
