import { beforeEach, describe, expect, it, vi } from "vitest";

// OS-W29: attaching dispute evidence counted the party's photos and then
// inserted, in two requests, so two attaches at once each counted 7 and the
// dispute ended up with 9. The limit is held by the database now
// (20261108130300, proved by supabase/tests/dispute_evidence_cap_race_guard.sql);
// the action no longer counts first, and turns the database's refusal into
// its own message.

const ORDER = "6f1c2b9e-1a2b-4c3d-8e9f-0a1b2c3d4e5f";
const BUYER = "11111111-2222-4333-8444-555555555555";
const PHOTO = `${BUYER}/${ORDER}/photo.jpg`;

const mocks = vi.hoisted(() => ({
  calls: [] as { table: string; op: string; value?: unknown }[],
  insertError: null as { code?: string; message: string } | null,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: BUYER } } }) } }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from(table: string) {
      const builder: Record<string, unknown> = {};
      builder.select = () => {
        mocks.calls.push({ table, op: "select" });
        return builder;
      };
      builder.eq = () => builder;
      builder.is = () => builder;
      builder.update = (value: unknown) => {
        mocks.calls.push({ table, op: "update", value });
        return builder;
      };
      builder.maybeSingle = async () => ({
        data: table === "orders" ? { id: ORDER, buyer_id: BUYER, seller_id: "seller", status: "disputed" } : null,
        error: null,
      });
      builder.insert = async (value: unknown) => {
        mocks.calls.push({ table, op: "insert", value });
        return { error: mocks.insertError };
      };
      // A count read awaited directly: seven photos already attached.
      builder.then = (resolve: (v: unknown) => unknown) =>
        resolve({ data: Array.from({ length: 7 }, (_, i) => ({ id: `e${i}` })), error: null });
      return builder;
    },
  }),
}));
vi.mock("@/lib/rate-limit", () => ({ RATE_LIMITS: { disputeEvidence: {} }, allowAction: async () => true, rateLimitMessage: () => "Limited" }));
vi.mock("@/lib/revalidate", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/monitoring", () => ({ reportError: vi.fn() }));
vi.mock("@/lib/admin/alerts", () => ({ sendAdminAlert: vi.fn() }));
vi.mock("@/lib/payments/refunds", () => ({ refundOrder: vi.fn() }));
vi.mock("./order-thread", () => ({ postOrderEvent: vi.fn() }));
vi.mock("./dispute-command", () => ({ openDisputeCommand: vi.fn() }));

import { addDisputeEvidence } from "./dispute-actions";

function form() {
  const data = new FormData();
  data.set("order_id", ORDER);
  data.set("url", PHOTO);
  data.set("note", "Scratched housing");
  return data;
}

beforeEach(() => {
  mocks.calls.length = 0;
  mocks.insertError = null;
});

describe("attaching dispute evidence", () => {
  it("leaves the 8-photo limit to the database instead of counting first", async () => {
    const result = await addDisputeEvidence({}, form());
    expect(result).toEqual({ ok: "Photo attached to the dispute." });
    // A count read before the insert is what raced: none is made.
    expect(mocks.calls.filter((c) => c.table === "dispute_evidence").map((c) => c.op)).toEqual(["insert"]);
    expect(mocks.calls).toContainEqual({
      table: "dispute_evidence",
      op: "insert",
      value: { order_id: ORDER, uploader_id: BUYER, url: PHOTO, storage_path: PHOTO, note: "Scratched housing" },
    });
  });

  it("explains the database's refusal at the limit, and stamps nothing", async () => {
    mocks.insertError = { code: "23514", message: "new row refused" };
    const result = await addDisputeEvidence({}, form());
    expect(result).toEqual({ error: "You've attached the maximum of 8 photos." });
    expect(mocks.calls.some((c) => c.table === "staged_uploads")).toBe(false);
  });
});
