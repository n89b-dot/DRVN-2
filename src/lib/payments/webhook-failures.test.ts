import { beforeEach, describe, expect, it, vi } from "vitest";

const reportError = vi.hoisted(() => vi.fn());
vi.mock("@/lib/monitoring", () => ({ reportError }));

import { recordWebhookFailure } from "./webhook-failures";

const adminWith = (rpc: (...args: unknown[]) => unknown) => ({ rpc: vi.fn(rpc) }) as never;

beforeEach(() => reportError.mockClear());

describe("recordWebhookFailure", () => {
  it("records a retry and reports it with the attempt count", async () => {
    const admin = adminWith(async () => ({ data: 3, error: null }));
    await expect(recordWebhookFailure(admin, "evt_1", "retry", { provider: "stripe", type: "charge.refunded" })).resolves.toBe(3);
    expect((admin as unknown as { rpc: ReturnType<typeof vi.fn> }).rpc).toHaveBeenCalledWith("record_webhook_failure", {
      p_id: "evt_1",
      p_kind: "retry",
      p_detail: "handler asked for redelivery",
    });
    expect(reportError).toHaveBeenCalledWith("[stripe:webhook] event left for redelivery", { eventId: "evt_1", type: "charge.refunded", attempts: 3 });
  });

  it("records a thrown handler's name and message, bounded", async () => {
    const admin = adminWith(async () => ({ data: 1, error: null }));
    await recordWebhookFailure(admin, "easypost:evt_2", "error", { provider: "easypost", type: "tracker.updated", error: new TypeError("x".repeat(400)) });
    const args = (admin as unknown as { rpc: ReturnType<typeof vi.fn> }).rpc.mock.calls[0][1] as { p_detail: string };
    expect(args.p_detail.startsWith("TypeError: x")).toBe(true);
    expect(args.p_detail.length).toBe(300);
    // The route already reported the throw; nothing more here.
    expect(reportError).not.toHaveBeenCalled();
  });

  it("never throws when the record can't be written", async () => {
    const failing = adminWith(async () => ({ data: null, error: { message: "down" } }));
    await expect(recordWebhookFailure(failing, "evt_3", "error", { provider: "stripe", type: "x" })).resolves.toBeNull();
    const throwing = adminWith(() => { throw new Error("no client"); });
    await expect(recordWebhookFailure(throwing, "evt_3", "retry", { provider: "stripe", type: "x" })).resolves.toBeNull();
    expect(reportError).toHaveBeenCalledWith("[stripe:webhook] failed delivery could not be recorded", expect.objectContaining({ eventId: "evt_3" }));
  });
});
