import { beforeEach, describe, expect, it, vi } from "vitest";

const monitoringMocks = vi.hoisted(() => ({ reportError: vi.fn() }));
vi.mock("@/lib/monitoring", () => monitoringMocks);

import { applyTrackingSummary, findShipmentForTracker } from "./apply-tracking";
import type { Shipment } from "@/lib/database.types";
import type { TrackingSummary } from "./types";

type QueryResult = { data: unknown; error: { code?: string } | null };

function query(result: QueryResult) {
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "insert", "update", "eq", "is", "limit"]) {
    builder[method] = vi.fn(() => builder);
  }
  builder.maybeSingle = vi.fn(async () => result);
  builder.then = (resolve: (value: QueryResult) => unknown, reject: (reason: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return builder;
}

function adminWith(...results: QueryResult[]) {
  const builders = results.map(query);
  return {
    from: vi.fn(() => {
      const next = builders.shift();
      if (!next) throw new Error("Unexpected database query");
      return next;
    }),
  };
}

function shipment(overrides: Partial<Shipment> = {}): Shipment {
  return {
    id: "shipment_1",
    order_id: "order_1",
    direction: "outbound",
    return_id: null,
    provider: "easypost",
    provider_shipment_id: "shp_1",
    provider_tracker_id: "trk_1",
    fulfillment_type: "drvn_shipping",
    carrier: "USPS",
    service: "Priority",
    status: "delivered",
    tracking_code: "TRACK1",
    label_reference: null,
    quoted_cents: 500,
    purchased_cents: 500,
    insured_value_cents: null,
    signature_required: false,
    shipped_at: "2026-09-04T10:00:00.000Z",
    delivered_at: "2026-09-05T10:00:00.000Z",
    created_at: "2026-09-04T00:00:00.000Z",
    updated_at: "2026-09-05T10:00:00.000Z",
    ...overrides,
  };
}

function summary(overrides: Partial<TrackingSummary> = {}): TrackingSummary {
  return {
    trackerRef: "trk_1",
    trackingCode: "TRACK1",
    carrier: "USPS",
    state: "delivered",
    estDeliveryAt: null,
    deliveredAt: "2026-09-05T10:00:00.000Z",
    events: [
      {
        providerEventRef: "event_1",
        state: "delivered",
        description: "Delivered",
        occurredAt: "2026-09-05T10:00:00.000Z",
        city: "Reno",
        state_code: "NV",
        country: "US",
      },
    ],
    ...overrides,
  };
}

beforeEach(() => vi.clearAllMocks());

describe("tracking lookup durability", () => {
  it("does not classify a failed shipment lookup as missing", async () => {
    const admin = adminWith({ data: null, error: { code: "08006" } });

    await expect(findShipmentForTracker(admin as never, summary())).rejects.toThrow(
      "tracker reference lookup failed; retry required"
    );
  });

  it("reports an ambiguous tracker without choosing a shipment", async () => {
    const admin = adminWith({
      data: [shipment(), shipment({ id: "shipment_2" })],
      error: null,
    });

    await expect(findShipmentForTracker(admin as never, summary())).resolves.toEqual({
      kind: "ambiguous",
    });
  });

  it.each([
    ["provider", { provider: "stub" }],
    ["tracking code", { tracking_code: "OTHER" }],
    ["carrier", { carrier: "FedEx" }],
  ])("rejects a tracker whose % conflicts with the shipment", async (_field, mismatch) => {
    const admin = adminWith({ data: [shipment(mismatch)], error: null });

    await expect(findShipmentForTracker(admin as never, summary())).resolves.toEqual({
      kind: "ambiguous",
    });
  });

  it("rejects tracking-code fallback when the shipment has another tracker", async () => {
    const admin = adminWith(
      { data: [], error: null },
      { data: [shipment({ provider_tracker_id: "trk_other" })], error: null }
    );

    await expect(findShipmentForTracker(admin as never, summary())).resolves.toEqual({
      kind: "ambiguous",
    });
  });
});

describe("tracking replay convergence", () => {
  it("finishes an outbound order after shipment status committed on the first attempt", async () => {
    const admin = adminWith(
      { data: null, error: { code: "23505" } },
      { data: null, error: null },
      { data: { status: "shipped" }, error: null },
      { data: [{ status: "delivered", direction: "outbound" }], error: null },
      { data: { id: "order_1" }, error: null }
    );

    await expect(applyTrackingSummary(admin as never, shipment(), summary())).resolves.toEqual({
      shipmentId: "shipment_1",
      eventsInserted: 0,
      statusChanged: false,
      orderEffect: "delivered",
    });
  });

  it("finishes a return after shipment and in-transit state committed on the first attempt", async () => {
    const admin = adminWith(
      { data: null, error: { code: "23505" } },
      { data: null, error: null },
      { data: { status: "in_transit" }, error: null },
      { data: { id: "return_1" }, error: null }
    );
    const returnShipment = shipment({ direction: "return", return_id: "return_1" });

    await expect(applyTrackingSummary(admin as never, returnShipment, summary())).resolves.toEqual({
      shipmentId: "shipment_1",
      eventsInserted: 0,
      statusChanged: false,
      orderEffect: "none",
    });
  });

  it("ignores an earlier scan while finishing effects from the delivered state", async () => {
    const admin = adminWith(
      { data: null, error: { code: "23505" } },
      { data: null, error: null },
      { data: { status: "shipped" }, error: null },
      { data: [{ status: "delivered", direction: "outbound" }], error: null },
      { data: { id: "order_1" }, error: null }
    );

    await expect(
      applyTrackingSummary(admin as never, shipment(), summary({ state: "in_transit" }))
    ).resolves.toMatchObject({ orderEffect: "delivered", statusChanged: false });
  });
});

describe("tracking effect failures", () => {
  it("retries a non-duplicate event persistence failure", async () => {
    const admin = adminWith({ data: null, error: { code: "08006" } });
    await expect(applyTrackingSummary(admin as never, shipment(), summary())).rejects.toThrow(
      "event insert failed; retry required"
    );
  });

  it("retries a shipment status persistence failure", async () => {
    const admin = adminWith(
      { data: null, error: { code: "23505" } },
      { data: null, error: { code: "08006" } }
    );
    await expect(
      applyTrackingSummary(
        admin as never,
        shipment({ status: "in_transit" }),
        summary()
      )
    ).rejects.toThrow("status update failed; retry required");
  });

  it("retries when a shipment compare-and-set affects no row before reaching the target", async () => {
    const admin = adminWith(
      { data: null, error: { code: "23505" } },
      { data: null, error: null },
      { data: shipment({ status: "out_for_delivery" }), error: null }
    );
    await expect(
      applyTrackingSummary(admin as never, shipment({ status: "in_transit" }), summary())
    ).rejects.toThrow("status update did not reach the provider state; retry required");
  });

  it("fails closed when the persisted shipment reaches a conflicting terminal state", async () => {
    const admin = adminWith(
      { data: null, error: { code: "23505" } },
      { data: null, error: null },
      { data: shipment({ status: "failed" }), error: null }
    );
    await expect(
      applyTrackingSummary(admin as never, shipment({ status: "in_transit" }), summary())
    ).rejects.toThrow("provider state conflicts with persisted shipment state; retry required");
  });

  it("fails closed when delivery conflicts with a terminal return state", async () => {
    const admin = adminWith(
      { data: null, error: { code: "23505" } },
      { data: null, error: null },
      { data: { status: "cancelled" }, error: null }
    );
    await expect(
      applyTrackingSummary(
        admin as never,
        shipment({ direction: "return", return_id: "return_1" }),
        summary()
      )
    ).rejects.toThrow("return in-transit update affected no row; retry required");
  });

  it("fails closed when an initial provider state conflicts with a terminal shipment", async () => {
    const admin = adminWith({ data: null, error: { code: "23505" } });
    await expect(
      applyTrackingSummary(admin as never, shipment({ status: "failed" }), summary())
    ).rejects.toThrow("provider state conflicts with persisted shipment state; retry required");
  });

  it("retries a downstream return persistence failure", async () => {
    const admin = adminWith(
      { data: null, error: { code: "23505" } },
      { data: null, error: { code: "08006" } }
    );
    await expect(
      applyTrackingSummary(
        admin as never,
        shipment({ direction: "return", return_id: "return_1" }),
        summary()
      )
    ).rejects.toThrow("return in-transit update failed; retry required");
  });

  it("retries a downstream order persistence failure", async () => {
    const admin = adminWith(
      { data: null, error: { code: "23505" } },
      { data: null, error: { code: "08006" } }
    );
    await expect(applyTrackingSummary(admin as never, shipment(), summary())).rejects.toThrow(
      "order shipped update failed; retry required"
    );
  });
});
