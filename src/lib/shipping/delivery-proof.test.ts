import { describe, expect, it } from "vitest";

import {
  cityKey,
  deliveryEvidence,
  evaluateDeliveryProof,
  matchDestination,
  postcodeKey,
  type DeliveryEvidence,
  type ProofOrder,
} from "./delivery-proof";
import { mapTracker } from "./easypost";
import type { TrackingSummary } from "./types";

const order: ProofOrder = {
  shipPostcode: "89501",
  shipCity: "Reno",
  shipCountry: "US",
  deliverBy: "2026-11-13T00:00:00.000Z",
  createdAt: "2026-11-02T12:00:00.000Z",
  totalCents: 12_000,
};

const good: DeliveryEvidence = {
  carrierDeliveredAt: "2026-11-06T15:00:00.000Z",
  destinationPostcode: "89501",
  destinationCity: "RENO",
  firstScanAt: "2026-11-03T09:00:00.000Z",
  signedBy: null,
};

describe("destination keys", () => {
  it("compares postcodes on letters and digits, and a US ZIP+4 on its ZIP", () => {
    expect(postcodeKey("89501-1234", "US")).toBe("89501");
    expect(postcodeKey("895011234", null)).toBe("89501");
    expect(postcodeKey(" sw1a 1aa ", "GB")).toBe("SW1A1AA");
    expect(postcodeKey("123456789", "GB")).toBe("123456789");
    expect(postcodeKey("  ", "US")).toBeNull();
    expect(postcodeKey(null, "US")).toBeNull();
  });

  it("compares cities without case, spaces or punctuation", () => {
    expect(cityKey("St. Louis")).toBe(cityKey("st louis"));
    expect(cityKey("  ")).toBeNull();
  });
});

describe("matchDestination: postcode, else city", () => {
  it("matches on the postcode when the carrier gives one", () => {
    expect(matchDestination({ destinationPostcode: "89501-0042", destinationCity: "Elsewhere" }, order)).toBe("postcode");
  });

  it("a different postcode is a mismatch, even when the city agrees", () => {
    expect(matchDestination({ destinationPostcode: "89502", destinationCity: "Reno" }, order)).toBe("mismatch");
  });

  it("falls back to the city only when the carrier gave no postcode", () => {
    expect(matchDestination({ destinationPostcode: null, destinationCity: "reno" }, order)).toBe("city");
    expect(matchDestination({ destinationPostcode: null, destinationCity: "Sparks" }, order)).toBe("mismatch");
  });

  it("is missing when there is nothing to compare", () => {
    expect(matchDestination({ destinationPostcode: null, destinationCity: null }, order)).toBe("missing");
    expect(matchDestination({ destinationPostcode: "89501", destinationCity: null }, { ...order, shipPostcode: null })).toBe("missing");
  });
});

describe("evaluateDeliveryProof (N95)", () => {
  it("verifies a delivery with the carrier's date, a matching destination and an in-time scan", () => {
    expect(evaluateDeliveryProof(good, order)).toEqual({
      verdict: "verified",
      destinationMatch: "postcode",
      signatureRequired: false,
      reasons: [],
    });
  });

  it("sends a delivery with no carrier date to review (never 'now')", () => {
    const result = evaluateDeliveryProof({ ...good, carrierDeliveredAt: null }, order);
    expect(result.verdict).toBe("review");
    expect(result.reasons).toEqual(["carrier_date_missing"]);
    expect(evaluateDeliveryProof({ ...good, carrierDeliveredAt: new Date(0).toISOString() }, order).reasons).toEqual([
      "carrier_date_missing",
    ]);
  });

  it("catches an old, unrelated parcel: delivered and scanned before the sale", () => {
    const result = evaluateDeliveryProof(
      { ...good, carrierDeliveredAt: "2026-10-01T10:00:00.000Z", firstScanAt: "2026-09-28T10:00:00.000Z" },
      order
    );
    expect(result.verdict).toBe("review");
    expect(result.reasons).toEqual(["delivered_before_sale", "scan_before_sale"]);
  });

  it("sends a delivery elsewhere to review", () => {
    const result = evaluateDeliveryProof({ ...good, destinationPostcode: "10001", destinationCity: "New York" }, order);
    expect(result).toMatchObject({ verdict: "review", destinationMatch: "mismatch", reasons: ["destination_mismatch"] });
  });

  it("needs a shipping scan before the latest delivery date", () => {
    expect(evaluateDeliveryProof({ ...good, firstScanAt: null }, order).reasons).toEqual(["scan_missing"]);
    expect(evaluateDeliveryProof({ ...good, firstScanAt: "2026-11-14T09:00:00.000Z" }, order).reasons).toEqual([
      "scan_after_deadline",
    ]);
    expect(evaluateDeliveryProof(good, { ...order, deliverBy: null }).reasons).toEqual(["deadline_missing"]);
  });

  it("needs a signature from $750, and only from $750", () => {
    expect(evaluateDeliveryProof(good, { ...order, totalCents: 74_999 })).toMatchObject({
      verdict: "verified",
      signatureRequired: false,
    });
    expect(evaluateDeliveryProof(good, { ...order, totalCents: 75_000 })).toMatchObject({
      verdict: "review",
      signatureRequired: true,
      reasons: ["signature_missing"],
    });
    expect(evaluateDeliveryProof({ ...good, signedBy: "J SMITH" }, { ...order, totalCents: 75_000 })).toMatchObject({
      verdict: "verified",
      signatureRequired: true,
    });
  });

  it("verifies on the city when the carrier reported no postcode", () => {
    expect(evaluateDeliveryProof({ ...good, destinationPostcode: null, destinationCity: "Reno" }, order)).toMatchObject({
      verdict: "verified",
      destinationMatch: "city",
    });
  });
});

describe("deliveryEvidence: what the carrier said", () => {
  const summary = (overrides: Partial<TrackingSummary> = {}): TrackingSummary => ({
    trackerRef: "trk_1",
    trackingCode: "TRACK1",
    carrier: "USPS",
    state: "delivered",
    estDeliveryAt: null,
    deliveredAt: "2026-11-06T15:00:00.000Z",
    events: [
      { providerEventRef: "a", state: "pre_transit", description: "Label created", occurredAt: "2026-11-02T13:00:00.000Z", city: null, state_code: null, country: null },
      { providerEventRef: "b", state: "in_transit", description: "Accepted", occurredAt: "2026-11-03T09:00:00.000Z", city: "Sparks", state_code: "NV", country: "US" },
      { providerEventRef: "c", state: "delivered", description: "Delivered", occurredAt: "2026-11-06T15:00:00.000Z", city: "Reno", state_code: "NV", country: "US", postalCode: "89501" },
    ],
    ...overrides,
  });

  it("takes the first real scan (not label creation) and the delivered scan's location", () => {
    expect(deliveryEvidence(summary())).toEqual({
      carrierDeliveredAt: "2026-11-06T15:00:00.000Z",
      destinationPostcode: "89501",
      destinationCity: "Reno",
      firstScanAt: "2026-11-03T09:00:00.000Z",
      signedBy: null,
    });
  });

  it("prefers the carrier's own destination and keeps the signer", () => {
    const evidence = deliveryEvidence(
      summary({ signedBy: " K TANAKA ", destination: { postalCode: "89509", city: "Reno", state: "NV", country: "US" } })
    );
    expect(evidence).toMatchObject({ destinationPostcode: "89509", signedBy: "K TANAKA" });
  });

  it("never invents a delivery date", () => {
    const evidence = deliveryEvidence(
      summary({
        deliveredAt: null,
        events: [{ providerEventRef: null, state: "delivered", description: null, occurredAt: new Date(0).toISOString(), city: null, state_code: null, country: null }],
      })
    );
    expect(evidence.carrierDeliveredAt).toBeNull();
    expect(evidence.firstScanAt).toBeNull();
  });

  it("carries EasyPost's postcode, destination and signature through", () => {
    const mapped = mapTracker({
      id: "trk_1",
      tracking_code: "TRACK1",
      carrier: "USPS",
      status: "delivered",
      signed_by: "J SMITH",
      carrier_detail: { destination_tracking_location: { city: "RENO", state: "NV", country: "US", zip: "89501" } },
      tracking_details: [
        { status: "in_transit", message: "Accepted", datetime: "2026-11-03T09:00:00Z", tracking_location: { city: "SPARKS", state: "NV", country: "US", zip: "89431" } },
        { status: "delivered", message: "Delivered", datetime: "2026-11-06T15:00:00Z", tracking_location: { city: "RENO", state: "NV", country: "US", zip: "89501" } },
      ],
    });
    expect(mapped.signedBy).toBe("J SMITH");
    expect(mapped.destination).toEqual({ postalCode: "89501", city: "RENO", state: "NV", country: "US" });
    expect(mapped.events[1].postalCode).toBe("89501");
    expect(evaluateDeliveryProof(deliveryEvidence(mapped), { ...order, totalCents: 80_000 }).verdict).toBe("verified");
  });
});
