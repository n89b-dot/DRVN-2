import { createHmac } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

const shippingMocks = vi.hoisted(() => ({
  mapTracker: vi.fn(),
  findShipmentForTracker: vi.fn(),
  applyTrackingSummary: vi.fn(),
}));
const monitoringMocks = vi.hoisted(() => ({
  flushMonitoring: vi.fn(),
  reportError: vi.fn(),
}));
const adminMock = vi.hoisted(() => ({ from: vi.fn() }));

vi.mock("@/lib/shipping/easypost", () => ({ mapTracker: shippingMocks.mapTracker }));
vi.mock("@/lib/shipping/apply-tracking", () => ({
  findShipmentForTracker: shippingMocks.findShipmentForTracker,
  applyTrackingSummary: shippingMocks.applyTrackingSummary,
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => adminMock }));
vi.mock("@/lib/monitoring", () => monitoringMocks);

import { POST } from "./route";

type QueryResult = { data: unknown; error: { code?: string } | null };

function query(result: QueryResult) {
  const builder: Record<string, unknown> = {};
  for (const method of ["insert", "select", "update", "eq", "is"]) {
    builder[method] = vi.fn(() => builder);
  }
  builder.maybeSingle = vi.fn(async () => result);
  builder.then = (resolve: (value: QueryResult) => unknown, reject: (reason: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return builder;
}

function database(...results: QueryResult[]) {
  const builders = results.map(query);
  adminMock.from.mockImplementation(() => {
    const next = builders.shift();
    if (!next) throw new Error("Unexpected database query");
    return next;
  });
  return builders;
}

function webhookRequest(event: object): Request {
  const body = JSON.stringify(event);
  const signature = createHmac("sha256", process.env.EASYPOST_WEBHOOK_SECRET!)
    .update(body, "utf8")
    .digest("hex");
  return new Request("https://example.test/api/shipping/easypost", {
    method: "POST",
    headers: { "x-hmac-signature": `hmac-sha256-hex=${signature}` },
    body,
  });
}

const event = {
  id: "evt_shipping_1",
  description: "tracker.updated",
  result: { id: "trk_1", tracking_code: "TRACK1", status: "delivered" },
};

beforeEach(() => {
  vi.clearAllMocks();
  process.env.EASYPOST_WEBHOOK_SECRET = "isolated-test-secret";
  shippingMocks.mapTracker.mockReturnValue({ trackerRef: "trk_1", trackingCode: "TRACK1" });
  shippingMocks.findShipmentForTracker.mockResolvedValue({
    kind: "found",
    shipment: { id: "shipment_1" },
  });
  shippingMocks.applyTrackingSummary.mockResolvedValue({});
  monitoringMocks.flushMonitoring.mockResolvedValue(undefined);
});

describe("EasyPost webhook durable acknowledgement", () => {
  it("fails closed when the event claim cannot be persisted", async () => {
    database({ data: null, error: { code: "08006" } });

    const response = await POST(webhookRequest(event));

    expect(response.status).toBe(500);
    expect(shippingMocks.findShipmentForTracker).not.toHaveBeenCalled();
  });

  it("returns 500 when the processed marker cannot be persisted", async () => {
    database(
      { data: { id: "easypost:evt_shipping_1" }, error: null },
      { data: null, error: { code: "08006" } }
    );

    const response = await POST(webhookRequest(event));

    expect(response.status).toBe(500);
    expect(shippingMocks.applyTrackingSummary).toHaveBeenCalledOnce();
  });

  it("returns 500 when the processed marker affects no event row", async () => {
    database(
      { data: { id: "easypost:evt_shipping_1" }, error: null },
      { data: null, error: null }
    );

    const response = await POST(webhookRequest(event));

    expect(response.status).toBe(500);
    expect(shippingMocks.applyTrackingSummary).toHaveBeenCalledOnce();
  });

  it.each(["missing", "ambiguous"] as const)(
    "retains an unprocessed payload when tracker mapping is %s",
    async (kind) => {
      const [claim] = database({ data: { id: "easypost:evt_shipping_1" }, error: null });
      shippingMocks.findShipmentForTracker.mockResolvedValue({ kind });

      const response = await POST(webhookRequest(event));

      expect(response.status).toBe(500);
      expect(shippingMocks.applyTrackingSummary).not.toHaveBeenCalled();
      expect(claim.insert).toHaveBeenCalledWith({
        id: "easypost:evt_shipping_1",
        type: "tracker.updated",
        payload: event,
      });
    }
  );

  it("does not reprocess an event whose durable marker is complete", async () => {
    database(
      { data: null, error: { code: "23505" } },
      { data: { processed_at: "2026-09-05T00:00:00.000Z", payload: event }, error: null }
    );

    const response = await POST(webhookRequest(event));

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("duplicate");
    expect(shippingMocks.findShipmentForTracker).not.toHaveBeenCalled();
  });
});
