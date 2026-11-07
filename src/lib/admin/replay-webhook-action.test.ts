import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The console's Replay (adminReplayWebhookEvent) counts every failed replay
 * of a loaded, unprocessed event on webhook_events (N109): an explicit retry
 * once as "retry", a throw from dispatch or from the completion marker once
 * as "error". A replay that never loaded an event records nothing.
 */

const m = vi.hoisted(() => ({
  dispatch: vi.fn(),
  markProcessed: vi.fn(),
  recordFailure: vi.fn(),
  row: { data: { id: "evt_replay", payload: { id: "evt_replay", type: "charge.refunded" } } as unknown, error: null as unknown },
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/monitoring", () => ({ reportError: vi.fn() }));
vi.mock("@/lib/revalidate", () => ({ revalidatePath: vi.fn() }));
vi.mock("./guard", () => ({ getAdminContext: async () => ({ userId: "admin-1", role: "admin" }) }));
vi.mock("./audit", () => ({ auditedAction: (_admin: unknown, _meta: unknown, run: () => Promise<unknown>) => run() }));
vi.mock("./alerts", () => ({ sendAdminAlert: vi.fn() }));
vi.mock("./replay-webhook", () => ({ dispatchRecordedWebhookEvent: m.dispatch }));
vi.mock("@/lib/payments/settlement", () => ({ markWebhookEventProcessed: m.markProcessed }));
vi.mock("@/lib/payments/webhook-failures", () => ({ recordWebhookFailure: m.recordFailure }));
vi.mock("@/lib/money-worker", () => ({ runMoneyWorkerPass: vi.fn() }));
vi.mock("@/lib/payments/refunds", () => ({ refundOrder: vi.fn() }));
vi.mock("@/lib/payments/late-refund-recovery", () => ({ verifyLateRefundRecovery: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => {
      const builder: Record<string, unknown> = {};
      builder.select = () => builder;
      builder.eq = () => builder;
      builder.maybeSingle = async () => m.row;
      return builder;
    },
  }),
}));

import { adminReplayWebhookEvent } from "./actions";

const replay = () => {
  const form = new FormData();
  form.set("event_id", "evt_replay");
  form.set("reason", "checking the stuck refund");
  return adminReplayWebhookEvent({}, form).then((state) => state ?? {});
};
const kinds = () => m.recordFailure.mock.calls.map((call) => call[2]);

beforeEach(() => {
  vi.clearAllMocks();
  m.row = { data: { id: "evt_replay", payload: { id: "evt_replay", type: "charge.refunded" } }, error: null };
  m.markProcessed.mockResolvedValue(undefined);
});

describe("console replay failure tracking", () => {
  it("records nothing when the replay applies", async () => {
    m.dispatch.mockResolvedValue("committed");
    expect(await replay()).toEqual({ ok: "Event replayed and applied." });
    expect(m.recordFailure).not.toHaveBeenCalled();
  });

  it("records an explicit retry once, as retry", async () => {
    m.dispatch.mockResolvedValue("retry");
    expect((await replay()).error).toMatch(/another attempt/);
    expect(kinds()).toEqual(["retry"]);
  });

  it("records a dispatch that throws once, as error, with the error", async () => {
    const error = new Error("tracker mapping missing");
    m.dispatch.mockRejectedValue(error);
    expect((await replay()).error).toBe("tracker mapping missing");
    expect(kinds()).toEqual(["error"]);
    expect(m.recordFailure.mock.calls[0][1]).toBe("evt_replay");
    expect(m.recordFailure.mock.calls[0][3]).toMatchObject({ provider: "stripe", type: "console_replay", error });
    expect(m.markProcessed).not.toHaveBeenCalled();
  });

  it("records a completion marker that throws once, as error", async () => {
    m.dispatch.mockResolvedValue("committed");
    m.markProcessed.mockRejectedValue(new Error("Webhook completion could not be persisted"));
    expect((await replay()).error).toBe("Webhook completion could not be persisted");
    expect(kinds()).toEqual(["error"]);
  });

  it("names EasyPost events by their provider", async () => {
    m.row = { data: { id: "easypost:evt_1", payload: { id: "evt_1" } }, error: null };
    m.dispatch.mockRejectedValue(new Error("tracker mapping missing"));
    await replay();
    expect(m.recordFailure.mock.calls[0][3]).toMatchObject({ provider: "easypost" });
  });

  it("records nothing when no event was loaded", async () => {
    m.row = { data: null, error: null };
    expect((await replay()).error).toBe("Event not found.");
    m.row = { data: { id: "evt_replay", payload: null }, error: null };
    expect((await replay()).error).toMatch(/payload retention/);
    expect(m.recordFailure).not.toHaveBeenCalled();
    expect(m.dispatch).not.toHaveBeenCalled();
  });
});
