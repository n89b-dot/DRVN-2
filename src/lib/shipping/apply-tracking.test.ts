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

const proofRecorded: QueryResult = { data: { ok: true, verdict: "review" }, error: null };

// Plan 2 item A2: an order's status is changed by two database functions, not
// by updates from this file. `moves` are their answers, in call order.
const ORDER_MOVES = ["order_mark_shipped_from_tracking", "order_mark_delivered_from_tracking"];
const proofCalls = (admin: { rpc: ReturnType<typeof vi.fn> }) => admin.rpc.mock.calls.filter(([name]) => name === "record_delivery_proof");

function adminWithMoves(moves: QueryResult[], ...results: QueryResult[]) {
  const builders = results.map(query);
  const answers = [...moves];
  const admin = {
    proof: proofRecorded,
    from: vi.fn(() => {
      const next = builders.shift();
      if (!next) throw new Error("Unexpected database query");
      return next;
    }),
    rpc: vi.fn(async (...call: [name: string, args?: unknown]): Promise<QueryResult> => {
      const [name] = call;
      if (!ORDER_MOVES.includes(name)) return admin.proof;
      const next = answers.shift();
      if (!next) throw new Error(`Unexpected call of ${name}`);
      return next;
    }),
  };
  return admin;
}

/** No order is expected to move: any call of the two functions fails the test. */
function adminWith(...results: QueryResult[]) {
  return adminWithMoves([], ...results);
}

const moved: QueryResult = { data: "moved", error: null };
const movedInCase: QueryResult = { data: "moved_in_case", error: null };
const unchanged = (status: string): QueryResult => ({ data: `unchanged:${status}`, error: null });

/** The order facts delivery proof reads (N95). */
const proofOrder: QueryResult = {
  data: {
    ship_postcode: "89501",
    ship_city: "Reno",
    ship_country: "US",
    deliver_by: "2026-09-10T00:00:00.000Z",
    created_at: "2026-09-01T00:00:00.000Z",
    total_cents: 5000,
  },
  error: null,
};

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
    const admin = adminWithMoves(
      [unchanged("shipped"), moved],
      { data: null, error: { code: "23505" } },
      { data: [{ status: "delivered", direction: "outbound" }], error: null },
      proofOrder
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
    const admin = adminWithMoves(
      [unchanged("shipped"), moved],
      { data: null, error: { code: "23505" } },
      { data: [{ status: "delivered", direction: "outbound" }], error: null }
    );

    await expect(
      applyTrackingSummary(admin as never, shipment(), summary({ state: "in_transit" }))
    ).resolves.toMatchObject({ orderEffect: "delivered", statusChanged: false });
    // A delayed in-transit payload never rewrites the delivery proof.
    expect(proofCalls(admin)).toEqual([]);
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
    const admin = adminWithMoves(
      [{ data: null, error: { code: "08006" } }],
      { data: null, error: { code: "23505" } }
    );
    await expect(applyTrackingSummary(admin as never, shipment(), summary())).rejects.toThrow(
      "order shipped update failed; retry required"
    );
  });

  it("retries when the delivered change fails in the database", async () => {
    const admin = adminWithMoves(
      [unchanged("shipped"), { data: null, error: { code: "08006" } }],
      { data: null, error: { code: "23505" } },
      { data: [{ status: "delivered", direction: "outbound" }], error: null }
    );
    await expect(applyTrackingSummary(admin as never, shipment(), summary())).rejects.toThrow(
      "order delivered update failed; retry required"
    );
  });

  // The database answers with the order's status when it moved nothing; a
  // status the change should have been possible from, or no order at all,
  // is a retry, as it was when this file read the row back itself.
  it.each([
    ["the order is still unpaid", unchanged("pending"), "order shipped update affected no row; retry required"],
    ["there is no such order", { data: null, error: null }, "order shipped update could not be verified; retry required"],
    ["the database answers something this file does not know", { data: "ok", error: null }, "order shipped update could not be verified; retry required"],
  ])("retries the shipped change when %s", async (_, answer, message) => {
    const admin = adminWithMoves([answer], { data: null, error: { code: "23505" } });
    await expect(applyTrackingSummary(admin as never, shipment(), summary())).rejects.toThrow(message);
  });

  it.each([
    ["the order went back to paid", unchanged("paid"), "order delivered update affected no row; retry required"],
    ["there is no such order", { data: null, error: null }, "order delivered update could not be verified; retry required"],
  ])("retries the delivered change when %s", async (_, answer, message) => {
    const admin = adminWithMoves(
      [unchanged("shipped"), answer],
      { data: null, error: { code: "23505" } },
      { data: [{ status: "delivered", direction: "outbound" }], error: null }
    );
    await expect(applyTrackingSummary(admin as never, shipment(), summary())).rejects.toThrow(message);
  });

  it.each(["delivered", "completed", "disputed", "refunded", "cancelled"])("an order already %s is left alone, and that is not a failure", async (status) => {
    const admin = adminWithMoves([unchanged(status)], { data: null, error: { code: "23505" } });
    await expect(
      applyTrackingSummary(admin as never, shipment({ status: "in_transit" }), summary({ state: "in_transit", deliveredAt: null }))
    ).resolves.toMatchObject({ orderEffect: "none" });
  });
});

describe("an open case and delivery proof (N6, N95)", () => {
  it("records dispatch on an undispatched order in a not-received case without closing it", async () => {
    const admin = adminWithMoves(
      [movedInCase], // the order is disputed: its case now resolves to shipped
      { data: null, error: null } // event insert
    );
    await expect(
      applyTrackingSummary(admin as never, shipment({ status: "in_transit" }), summary({ state: "in_transit", deliveredAt: null }))
    ).resolves.toMatchObject({ orderEffect: "shipped" });
    expect(proofCalls(admin)).toEqual([]);
    // The change is the database's, with the shipment's own time, carrier and code.
    expect(admin.rpc.mock.calls).toEqual([
      ["order_mark_shipped_from_tracking", { p_order: "order_1", p_shipped_at: "2026-09-04T10:00:00.000Z", p_carrier: "USPS", p_tracking: "TRACK1" }],
    ]);
    expect(admin.from).toHaveBeenCalledTimes(1);
  });

  it("records a delivered parcel's proof from the carrier's own evidence", async () => {
    // The order is disputed: nothing to ship, and its case now resolves to delivered.
    const admin = adminWithMoves(
      [unchanged("disputed"), movedInCase],
      { data: null, error: { code: "23505" } },
      { data: null, error: { code: "23505" } },
      { data: null, error: { code: "23505" } },
      { data: [{ status: "delivered", direction: "outbound" }], error: null },
      proofOrder
    );
    const delivered = summary({
      signedBy: null,
      destination: { postalCode: "89501-1234", city: "Reno", state: "NV", country: "US" },
      events: [
        { providerEventRef: "a", state: "pre_transit", description: "Label", occurredAt: "2026-09-02T09:00:00.000Z", city: null, state_code: null, country: null },
        { providerEventRef: "b", state: "in_transit", description: "Accepted", occurredAt: "2026-09-03T09:00:00.000Z", city: "Sparks", state_code: "NV", country: "US" },
        { providerEventRef: "c", state: "delivered", description: "Delivered", occurredAt: "2026-09-05T10:00:00.000Z", city: "Reno", state_code: "NV", country: "US", postalCode: "89501" },
      ],
    });
    await expect(applyTrackingSummary(admin as never, shipment(), delivered)).resolves.toMatchObject({
      orderEffect: "delivered",
    });
    expect(admin.rpc).toHaveBeenCalledWith("record_delivery_proof", {
      p_shipment: "shipment_1",
      p_carrier_delivered_at: "2026-09-05T10:00:00.000Z",
      p_destination_postcode: "89501-1234",
      p_destination_city: "Reno",
      p_first_scan_at: "2026-09-03T09:00:00.000Z",
      p_signed_by: undefined,
      p_evidence_at: "2026-09-05T10:00:00.000Z",
      p_destination_match: "postcode",
      p_verdict: "verified",
      p_reasons: [],
    });
  });

  it("retries when the proof can't be recorded", async () => {
    const admin = adminWithMoves(
      [unchanged("shipped"), moved],
      { data: null, error: { code: "23505" } },
      { data: [{ status: "delivered", direction: "outbound" }], error: null },
      proofOrder
    );
    admin.proof = { data: null, error: { code: "08006" } };
    await expect(applyTrackingSummary(admin as never, shipment(), summary())).rejects.toThrow(
      "delivery proof could not be recorded; retry required"
    );
  });
});
