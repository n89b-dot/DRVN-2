import { beforeEach, expect, it, vi } from "vitest";

import { ensureOutboundLabelVoid, reconcileOutboundLabelVoids } from "./outbound-label-void";

const shipment = "shipment-1";
const worker = "worker-1";
const saved = {
  provider: "easypost",
  provider_shipment_reference: "shp_frozen",
  status: "provider_pending",
  attempts: 1,
};
const post = vi.fn();
const read = vi.fn();
const rpc = vi.fn();
const provider = {
  name: "easypost",
  voidLabel: post,
  getLabelRefundStatus: read,
};

function claim(action: "dispatch" | "reconcile" | "completed" | "rejected") {
  return { data: { action, request: saved, observation_started_at: "2026-09-05T20:00:00Z" } };
}

function mockRpc(claims: Array<ReturnType<typeof claim>>, observed = "pending") {
  rpc.mockImplementation(async (name: string) => {
    if (name === "prepare_outbound_label_void") return { data: saved };
    if (name === "claim_outbound_label_void") return claims.shift();
    if (name === "record_outbound_label_void_observation") return { data: { state: observed } };
    throw new Error(`unexpected RPC ${name}`);
  });
}

const run = () => ensureOutboundLabelVoid(
  { rpc } as never,
  { shipmentId: shipment, actorId: "seller", workerId: worker, provider: provider as never },
);

beforeEach(() => {
  vi.clearAllMocks();
  post.mockResolvedValue({ state: "refunded" });
  read.mockResolvedValue({ state: "submitted" });
});

it("lets the atomic first owner submit once after a checked ownership fence", async () => {
  mockRpc([claim("dispatch"), claim("dispatch")], "refunded");
  expect(await run()).toBe("refunded");
  expect(post).toHaveBeenCalledOnce();
  expect(post).toHaveBeenCalledWith({ shipmentRef: "shp_frozen" });
  expect(read).not.toHaveBeenCalled();
  expect(rpc).toHaveBeenCalledWith("record_outbound_label_void_observation", expect.objectContaining({
    p_worker: worker,
    p_source: "dispatch",
    p_state: "refunded",
    p_attempt: 1,
  }));
});

it("reconciles a lost response by reading and never repeats the POST", async () => {
  mockRpc([claim("reconcile")], "refunded");
  read.mockResolvedValue({ state: "refunded" });
  expect(await run()).toBe("refunded");
  expect(read).toHaveBeenCalledWith({ shipmentRef: "shp_frozen" });
  expect(post).not.toHaveBeenCalled();
});

it("holds an asynchronous carrier refund without crediting it", async () => {
  mockRpc([claim("reconcile")], "pending");
  expect(await run()).toBe("pending");
  expect(post).not.toHaveBeenCalled();
  expect(rpc).toHaveBeenCalledWith("record_outbound_label_void_observation", expect.objectContaining({
    p_source: "reconcile",
    p_state: "submitted",
  }));
});

it("does not reissue while the original claim lease is live", async () => {
  mockRpc([claim("reconcile"), claim("reconcile")], "pending");
  read.mockResolvedValue({ state: "not_requested" });
  expect(await run()).toBe("pending");
  expect(read).toHaveBeenCalledOnce();
  expect(post).not.toHaveBeenCalled();
});

it("reissues once only after a post-expiry read proves no refund exists", async () => {
  mockRpc([claim("reconcile"), claim("dispatch"), claim("dispatch")], "pending");
  read.mockResolvedValue({ state: "not_requested" });
  post.mockResolvedValue({ state: "submitted" });
  expect(await run()).toBe("pending");
  expect(read).toHaveBeenCalledOnce();
  expect(post).toHaveBeenCalledOnce();
});

it("persists provider ambiguity and does not claim success", async () => {
  mockRpc([claim("dispatch"), claim("dispatch")]);
  post.mockRejectedValue(new Error("timeout"));
  await expect(run()).rejects.toThrow("outcome is unknown");
  expect(rpc).toHaveBeenCalledWith("record_outbound_label_void_observation", expect.objectContaining({
    p_source: "dispatch",
    p_state: "unknown",
    p_detail: "timeout",
    p_attempt: 1,
  }));
});

it("stops a stale owner at the immediate pre-dispatch fence", async () => {
  mockRpc([claim("dispatch"), claim("reconcile")]);
  expect(await run()).toBe("pending");
  expect(post).not.toHaveBeenCalled();
});

it("replays terminal outcomes without touching the provider", async () => {
  mockRpc([claim("completed")]);
  expect(await run()).toBe("refunded");
  mockRpc([claim("rejected")]);
  expect(await run()).toBe("rejected");
  expect(post).not.toHaveBeenCalled();
  expect(read).not.toHaveBeenCalled();
});

it("never calls the provider before durable admission", async () => {
  rpc.mockResolvedValue({ error: { message: "write failed" } });
  await expect(run()).rejects.toThrow("persist");
  expect(post).not.toHaveBeenCalled();
  expect(read).not.toHaveBeenCalled();
});

function workerAdmin(
  rows: Array<{ shipment_id: string; seller_id: string; provider: string }>,
  rpcImpl: (name: string, args: Record<string, unknown>) => Promise<unknown>,
) {
  const limit = vi.fn().mockResolvedValue({ data: rows });
  const order = vi.fn(() => ({ limit }));
  const or = vi.fn(() => ({ order }));
  const select = vi.fn(() => ({ or }));
  return { admin: { from: vi.fn(() => ({ select })), rpc: vi.fn(rpcImpl) }, limit, or };
}

it("automatically reconciles a bounded pending refund without another POST", async () => {
  const row = { shipment_id: shipment, seller_id: "seller", provider: "easypost" };
  const fixture = workerAdmin([row], async (name) => {
    if (name === "prepare_outbound_label_void") return { data: saved };
    if (name === "claim_outbound_label_void") return claim("reconcile");
    if (name === "record_outbound_label_void_observation") return { data: { state: "refunded" } };
    throw new Error(name);
  });
  read.mockResolvedValue({ state: "refunded" });
  const summary = await reconcileOutboundLabelVoids(fixture.admin as never, {
    provider: provider as never,
    batch: 5,
    now: Date.parse("2026-09-05T20:00:00Z"),
  });
  expect(summary).toEqual({ scanned: 1, completed: 1, pending: 0, rejected: 0, failed: 0 });
  expect(post).not.toHaveBeenCalled();
  expect(read).toHaveBeenCalledOnce();
  expect(fixture.limit).toHaveBeenCalledWith(5);
  expect(fixture.or).toHaveBeenCalledWith(expect.stringContaining("provider_state.eq.submitted"));
});

it("treats asynchronous submission as healthy pending work", async () => {
  const fixture = workerAdmin(
    [{ shipment_id: shipment, seller_id: "seller", provider: "easypost" }],
    async (name) => {
      if (name === "prepare_outbound_label_void") return { data: saved };
      if (name === "claim_outbound_label_void") return claim("reconcile");
      if (name === "record_outbound_label_void_observation") return { data: { state: "pending" } };
      throw new Error(name);
    },
  );
  expect(await reconcileOutboundLabelVoids(fixture.admin as never, { provider: provider as never }))
    .toEqual({ scanned: 1, completed: 0, pending: 1, rejected: 0, failed: 0 });
});

it("fails visibly when the configured provider cannot inspect the frozen identity", async () => {
  const fixture = workerAdmin(
    [{ shipment_id: shipment, seller_id: "seller", provider: "stub" }],
    async () => { throw new Error("RPC must not run"); },
  );
  expect(await reconcileOutboundLabelVoids(fixture.admin as never, { provider: provider as never }))
    .toEqual({ scanned: 1, completed: 0, pending: 0, rejected: 0, failed: 1 });
  expect(read).not.toHaveBeenCalled();
  expect(post).not.toHaveBeenCalled();
});
