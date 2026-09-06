import { beforeEach, expect, it, vi } from "vitest";
import { ensureReturnLabel } from "./return-label";
const rate = { shipmentRef: "saved-shipment", rateRef: "saved-rate", amountCents: 800, currency: "USD", carrier: "USPS", service: "Priority", endShipperRef: "seller-ref" };
const label = { shipmentRef: rate.shipmentRef, amountCents: 800, currency: "USD", carrier: "USPS", service: "Priority", labelUrl: "https://label.example/label.pdf", trackingCode: "TRACK1", trackerRef: "tracker1" };
const read = vi.fn(), rpc = vi.fn(), buy = vi.fn(), createRate = vi.fn();
const admin = { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: read }) }) }), rpc };
const provider = { name: "easypost", buyLabel: buy };
const saved = { provider: "easypost", rated: rate, completed_at: null, label: null };
const run = () => ensureReturnLabel(admin as never, { returnId: "return", actorId: "buyer", provider: provider as never, createRate });
beforeEach(() => { vi.clearAllMocks(); read.mockResolvedValue({ data: saved }); buy.mockResolvedValue(label); rpc.mockResolvedValue({ data: { ok: true } }); createRate.mockResolvedValue({ ...rate, shipmentRef: "unused-new-rate" }); });
it("retries the persisted provider shipment without buying a replacement", async () => {
  expect(await run()).toEqual(label); expect(createRate).not.toHaveBeenCalled();
  expect(buy).toHaveBeenCalledWith(expect.objectContaining({ shipmentRef: "saved-shipment", rateRef: "saved-rate" }));
});
it("uses the persisted winner when concurrent rating loses", async () => {
  read.mockResolvedValue({ data: null }); rpc.mockResolvedValueOnce({ data: saved }).mockResolvedValueOnce({ data: { ok: true } });
  await run(); expect(createRate).toHaveBeenCalledOnce(); expect(buy).toHaveBeenCalledWith(expect.objectContaining({ shipmentRef: "saved-shipment" }));
});
it("does not purchase before durable admission", async () => {
  read.mockResolvedValue({ data: null }); rpc.mockResolvedValue({ error: { message: "write failed" } });
  await expect(run()).rejects.toThrow("persist"); expect(buy).not.toHaveBeenCalled();
});
it("does not assume an unreadable request is a missing request", async () => {
  read.mockResolvedValue({ error: { message: "offline" } }); await expect(run()).rejects.toThrow("inspect"); expect(createRate).not.toHaveBeenCalled(); expect(buy).not.toHaveBeenCalled();
});
it("does not report a purchased label as ready before its local transaction commits", async () => {
  rpc.mockResolvedValue({ error: { message: "ledger failed" } }); await expect(run()).rejects.toThrow("reconciliation");
});
it("reuses a completed label without another provider call", async () => {
  read.mockResolvedValue({ data: { ...saved, completed_at: "2026-09-05", label } }); expect(await run()).toEqual(label); expect(buy).not.toHaveBeenCalled();
});
it("refuses a provider change on retry", async () => {
  read.mockResolvedValue({ data: { ...saved, provider: "stub" } }); await expect(run()).rejects.toThrow("provider changed"); expect(buy).not.toHaveBeenCalled();
});
