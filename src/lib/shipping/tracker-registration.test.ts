import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * N110 (OS-W30): seller-entered tracking is registered with the EasyPost
 * tracker whenever a key is configured — DRVN Shipping (labels) on or off —
 * off the request path, with retries; with no provider, nothing happens and
 * nothing is refused.
 */

const mocks = vi.hoisted(() => ({ reportError: vi.fn() }));
vi.mock("@/lib/monitoring", () => ({ reportError: mocks.reportError }));

import { easypostProvider } from "./easypost";
import {
  getTrackingProvider,
  processTrackerRegistrations,
  registerShipmentTracker,
  resolveTrackingMode,
  trackingConfigured,
} from "./tracker-registration";
import { ShippingProviderError, type ShippingProvider } from "./types";

type Shipment = {
  id: string;
  tracking_code: string | null;
  carrier: string | null;
  status: string;
  provider_tracker_id: string | null;
};

function fakeAdmin(shipments: Record<string, Shipment>, jobs: unknown[] = []) {
  const writes: { id: string; values: Record<string, unknown> }[] = [];
  // Heartbeats call rpc(...).abortSignal(...); everything else awaits rpc(...).
  const rpc = vi.fn((...call: [name: string, args?: unknown]) => {
    const [name] = call;
    const result = name === "claim_remediation_jobs" ? { data: jobs, error: null } : { data: null, error: null };
    return Object.assign(Promise.resolve(result), { abortSignal: () => Promise.resolve(result) });
  });
  const admin = {
    rpc,
    from: (table: string) => {
      expect(table).toBe("shipments");
      return {
        select: () => ({
          eq: (_col: string, id: string) => ({
            maybeSingle: async () => ({ data: shipments[id] ?? null, error: null }),
          }),
        }),
        update: (values: Record<string, unknown>) => ({
          eq: (_col: string, id: string) => ({
            is: async () => {
              const row = shipments[id];
              if (row && row.provider_tracker_id === null) {
                row.provider_tracker_id = values.provider_tracker_id as string;
                writes.push({ id, values });
              }
              return { error: null };
            },
          }),
        }),
      };
    },
  };
  return { admin: admin as never, writes, rpc };
}

function provider(createTracker: ShippingProvider["createTracker"]): ShippingProvider {
  return { name: "easypost", createTracker } as unknown as ShippingProvider;
}

const summary = (trackerRef: string | null) => ({
  trackerRef,
  trackingCode: "1Z999",
  carrier: "UPS",
  state: "in_transit" as const,
  estDeliveryAt: null,
  deliveredAt: null,
  events: [],
});

const shipped = (): Record<string, Shipment> => ({
  "ship-1": { id: "ship-1", tracking_code: "1Z999", carrier: "UPS", status: "in_transit", provider_tracker_id: null },
});

beforeEach(() => vi.clearAllMocks());

describe("resolveTrackingMode", () => {
  it("tracks through EasyPost whenever a key is set, whatever the DRVN Shipping flag says", () => {
    expect(resolveTrackingMode({ EASYPOST_API_KEY: "EZAK_live" })).toBe("easypost");
    expect(resolveTrackingMode({ EASYPOST_API_KEY: "EZAK_live", NODE_ENV: "production" })).toBe("easypost");
    expect(resolveTrackingMode({ EASYPOST_API_KEY: "EZAK_live", SHIPPING_MODE: "disabled" })).toBe("easypost");
    expect(getTrackingProvider({ EASYPOST_API_KEY: "EZAK_live" })).toBe(easypostProvider);
  });

  it("is off with no key, outside the dev stub, and never throws", () => {
    expect(resolveTrackingMode({})).toBe("off");
    expect(resolveTrackingMode({ NODE_ENV: "production", FLAG_INTEGRATED_SHIPPING_V1: "true" })).toBe("off");
    expect(resolveTrackingMode({ FLAG_INTEGRATED_SHIPPING_V1: "true" })).toBe("stub");
    // An impossible shipping config disables tracking instead of breaking dispatch.
    expect(resolveTrackingMode({ FLAG_INTEGRATED_SHIPPING_V1: "true", SHIPPING_MODE: "stub", NODE_ENV: "production" })).toBe("off");
    expect(trackingConfigured({})).toBe(false);
    expect(getTrackingProvider({})).toBeNull();
  });
});

describe("registerShipmentTracker", () => {
  it("registers the tracking number and stores the tracker reference", async () => {
    const { admin, writes } = fakeAdmin(shipped());
    const createTracker = vi.fn().mockResolvedValue(summary("trk_1"));
    await expect(registerShipmentTracker(admin, "ship-1", { provider: provider(createTracker) })).resolves.toBe("registered");
    expect(createTracker).toHaveBeenCalledWith({ trackingCode: "1Z999", carrier: "UPS" });
    expect(writes).toEqual([{ id: "ship-1", values: { provider: "easypost", provider_tracker_id: "trk_1" } }]);
  });

  it("retries a transient failure, then succeeds", async () => {
    const { admin } = fakeAdmin(shipped());
    const sleep = vi.fn().mockResolvedValue(undefined);
    const createTracker = vi
      .fn()
      .mockRejectedValueOnce(new ShippingProviderError("EasyPost unreachable", { retryable: true }))
      .mockRejectedValueOnce(new ShippingProviderError("EasyPost 503", { retryable: true, status: 503 }))
      .mockResolvedValue(summary("trk_2"));
    await expect(
      registerShipmentTracker(admin, "ship-1", { provider: provider(createTracker), sleep, backoffMs: 100 }),
    ).resolves.toBe("registered");
    expect(createTracker).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls).toEqual([[100], [200]]);
  });

  it("throws after its attempts so the queued job retries later", async () => {
    const { admin, writes } = fakeAdmin(shipped());
    const createTracker = vi.fn().mockRejectedValue(new ShippingProviderError("EasyPost 500", { retryable: true, status: 500 }));
    await expect(
      registerShipmentTracker(admin, "ship-1", { provider: provider(createTracker), sleep: async () => {} }),
    ).rejects.toThrow("EasyPost 500");
    expect(createTracker).toHaveBeenCalledTimes(3);
    expect(writes).toEqual([]);
  });

  it("stops on a number the provider refuses, but keeps retrying DRVN's own auth failures", async () => {
    const refused = vi.fn().mockRejectedValue(new ShippingProviderError("Invalid tracking code", { status: 422 }));
    await expect(
      registerShipmentTracker(fakeAdmin(shipped()).admin, "ship-1", { provider: provider(refused), sleep: async () => {} }),
    ).resolves.toBe("rejected");
    expect(refused).toHaveBeenCalledTimes(1);

    const badKey = vi.fn().mockRejectedValue(new ShippingProviderError("Unauthorized", { status: 401 }));
    await expect(
      registerShipmentTracker(fakeAdmin(shipped()).admin, "ship-1", { provider: provider(badKey), sleep: async () => {} }),
    ).rejects.toThrow("Unauthorized");
    expect(badKey).toHaveBeenCalledTimes(3);
  });

  it("makes no provider call when the shipment already has a tracker, has no tracking, or no provider is configured", async () => {
    const createTracker = vi.fn();
    const rows = shipped();
    rows["ship-1"].provider_tracker_id = "trk_label";
    await expect(registerShipmentTracker(fakeAdmin(rows).admin, "ship-1", { provider: provider(createTracker) })).resolves.toBe("already");
    await expect(registerShipmentTracker(fakeAdmin({}).admin, "ship-1", { provider: provider(createTracker) })).resolves.toBe("skipped");
    await expect(registerShipmentTracker(fakeAdmin(shipped()).admin, "ship-1", { provider: null })).resolves.toBe("skipped");
    expect(createTracker).not.toHaveBeenCalled();
  });
});

describe("against a mocked EasyPost API", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    vi.stubEnv("EASYPOST_API_KEY", "EZTK_test");
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    fetchMock.mockReset();
  });

  it("POSTs the seller's tracking number to /trackers and stores EasyPost's tracker id, flag off", async () => {
    expect(process.env.FLAG_INTEGRATED_SHIPPING_V1).not.toBe("true");
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ id: "trk_ep_1", object: "Tracker", tracking_code: "1Z999", carrier: "UPS", status: "pre_transit", tracking_details: [] }), { status: 200 }),
    );
    const { admin, writes } = fakeAdmin(shipped());
    await expect(registerShipmentTracker(admin, "ship-1")).resolves.toBe("registered");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.easypost.com/v2/trackers");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ tracker: { tracking_code: "1Z999", carrier: "UPS" } });
    expect(writes[0]?.values).toEqual({ provider: "easypost", provider_tracker_id: "trk_ep_1" });
  });

  it("treats EasyPost's 422 for an unknown number as a refusal, not a retry loop", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: { message: "Invalid tracking code" } }), { status: 422 }));
    await expect(registerShipmentTracker(fakeAdmin(shipped()).admin, "ship-1")).resolves.toBe("rejected");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("processTrackerRegistrations", () => {
  it("leaves the queue waiting when no tracking provider is configured", async () => {
    const { admin, rpc } = fakeAdmin(shipped());
    await expect(processTrackerRegistrations(admin, { provider: null })).resolves.toMatchObject({ claimed: 0, waiting: true });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("registers claimed jobs once each and hands failures back to the queue's backoff", async () => {
    const rows = shipped();
    rows["ship-2"] = { id: "ship-2", tracking_code: "1Z000", carrier: "UPS", status: "in_transit", provider_tracker_id: null };
    const jobs = [
      { id: "job-1", lease_id: "lease-1", payload: { shipment_id: "ship-1" } },
      { id: "job-2", lease_id: "lease-2", payload: { shipment_id: "ship-2" } },
    ];
    const { admin, rpc } = fakeAdmin(rows, jobs);
    const createTracker = vi
      .fn()
      .mockResolvedValueOnce(summary("trk_1"))
      .mockRejectedValueOnce(new ShippingProviderError("EasyPost 503", { retryable: true, status: 503 }));
    const result = await processTrackerRegistrations(admin, { provider: provider(createTracker) });
    expect(result).toEqual({ claimed: 2, registered: 1, already: 0, skipped: 0, rejected: 0, failed: 1 });
    expect(createTracker).toHaveBeenCalledTimes(2);
    const finishes = rpc.mock.calls.filter(([name]) => name === "finish_remediation_job").map(([, args]) => args);
    expect(finishes).toEqual([
      { p_id: "job-1", p_lease: "lease-1", p_error: undefined },
      { p_id: "job-2", p_lease: "lease-2", p_error: "EasyPost 503" },
    ]);
    expect(rpc).toHaveBeenCalledWith("claim_remediation_jobs", { p_kind: "tracker_registration", p_limit: 10 });
  });
});
