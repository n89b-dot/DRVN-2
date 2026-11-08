import { beforeEach, expect, it, vi } from "vitest";

/**
 * N95 follow-up (Codex review of #108): a shipment delivered before delivery
 * proof existed gets a review record in the migration and an
 * 'evaluate_proof' job; the tracker queue re-reads the carrier's evidence
 * and records the real proof.
 */

const mocks = vi.hoisted(() => ({ recordDeliveryProof: vi.fn(), reportError: vi.fn() }));
vi.mock("./apply-tracking", () => ({ recordDeliveryProof: mocks.recordDeliveryProof }));
vi.mock("@/lib/monitoring", () => ({ reportError: mocks.reportError }));

import { evaluateShipmentProof, processTrackerRegistrations } from "./tracker-registration";
import type { ShippingProvider, TrackingSummary } from "./types";

const delivered = {
  id: "ship-1",
  order_id: "order-1",
  direction: "outbound",
  status: "delivered",
  tracking_code: "1Z999",
  carrier: "UPS",
  provider_tracker_id: "trk_1",
};

function fakeAdmin(row: Record<string, unknown> | null, jobs: unknown[] = []) {
  const rpc = vi.fn((name: string) => {
    const result = name === "claim_remediation_jobs" ? { data: jobs, error: null } : { data: null, error: null };
    return Object.assign(Promise.resolve(result), { abortSignal: () => Promise.resolve(result) });
  });
  return {
    rpc,
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: row, error: null }) }) }) }),
  };
}

const tracking = (state: TrackingSummary["state"]): TrackingSummary => ({
  trackerRef: "trk_1",
  trackingCode: "1Z999",
  carrier: "UPS",
  state,
  estDeliveryAt: null,
  deliveredAt: state === "delivered" ? "2026-11-06T15:00:00.000Z" : null,
  events: [],
});

function provider(getTracking: ShippingProvider["getTracking"]): ShippingProvider {
  return { name: "easypost", getTracking } as unknown as ShippingProvider;
}

beforeEach(() => vi.resetAllMocks());

it("re-reads a delivered shipment's carrier evidence and records its proof", async () => {
  const getTracking = vi.fn(async () => tracking("delivered"));
  const admin = fakeAdmin(delivered);
  await expect(evaluateShipmentProof(admin as never, "ship-1", provider(getTracking))).resolves.toBe("evaluated");
  expect(getTracking).toHaveBeenCalledWith({ trackerRef: "trk_1", trackingCode: "1Z999", carrier: "UPS" });
  expect(mocks.recordDeliveryProof).toHaveBeenCalledWith(admin, delivered, tracking("delivered"));
});

it("records nothing when the carrier no longer reports a delivery, or the shipment isn't delivered", async () => {
  const getTracking = vi.fn(async () => tracking("in_transit"));
  await expect(evaluateShipmentProof(fakeAdmin(delivered) as never, "ship-1", provider(getTracking))).resolves.toBe("skipped");
  await expect(
    evaluateShipmentProof(fakeAdmin({ ...delivered, status: "in_transit" }) as never, "ship-1", provider(getTracking))
  ).resolves.toBe("skipped");
  expect(mocks.recordDeliveryProof).not.toHaveBeenCalled();
});

it("routes evaluate_proof jobs from the tracker queue", async () => {
  const getTracking = vi.fn(async () => tracking("delivered"));
  const admin = fakeAdmin(delivered, [{ id: "job-1", lease_id: "lease-1", payload: { shipment_id: "ship-1", evaluate_proof: true } }]);
  await expect(processTrackerRegistrations(admin as never, { provider: provider(getTracking) })).resolves.toMatchObject({
    claimed: 1,
    evaluated: 1,
    failed: 0,
  });
  expect(admin.rpc).toHaveBeenCalledWith("finish_remediation_job", { p_id: "job-1", p_lease: "lease-1", p_error: undefined });
});
