import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ read: vi.fn(), insert: vi.fn(), allow: vi.fn(), admin: vi.fn(), refresh: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.refresh }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({ RATE_LIMITS: { sendMessage: {} }, allowAction: mocks.allow, rateLimitMessage: () => "Too many messages." }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.admin }));
vi.mock("@/lib/monitoring", () => ({ reportError: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  auth: { getUser: async () => ({ data: { user: { id: "buyer" } } }) },
  from: () => ({ select: () => ({ eq: () => ({ maybeSingle: mocks.read }) }), insert: mocks.insert }),
}) }));
import { sendThreadMessage } from "./message-actions";
const saved = { sender_id: "buyer", body: "Hello", order_id: "order", offer_id: null };
function form() { const data = new FormData(); data.set("message_id", "12345678-1234-4234-8234-123456789012"); data.set("order_id", "order"); data.set("body", "Hello"); return data; }
beforeEach(() => {
  vi.clearAllMocks(); mocks.allow.mockResolvedValue(true); mocks.read.mockResolvedValue({ data: null, error: null }); mocks.insert.mockResolvedValue({ error: null });
  mocks.admin.mockReturnValue({ from: (table: string) => {
    const query = { select: () => query, eq: () => query, limit: () => query,
      maybeSingle: async () => ({ data: table === "orders" ? { id: "order", buyer_id: "buyer", seller_id: "seller" } : { listing_id: "listing" } }) };
    return query;
  } });
});
describe("message submission recovery", () => {
  it("adopts an exact committed retry without inserting or consuming rate limit", async () => {
    mocks.read.mockResolvedValue({ data: saved });
    expect(await sendThreadMessage({}, form())).toEqual({ ok: "Sent." });
    expect(mocks.insert).not.toHaveBeenCalled(); expect(mocks.allow).not.toHaveBeenCalled();
  });
  it.each([{ ...saved, sender_id: "seller" }, { ...saved, body: "Different" }, { ...saved, order_id: "other" }])("does not adopt a mismatched message", async (data) => {
    mocks.read.mockResolvedValue({ data });
    expect((await sendThreadMessage({}, form())).error).toBeTruthy(); expect(mocks.insert).not.toHaveBeenCalled();
  });
  it("reconciles an insert response lost after commit", async () => {
    mocks.read.mockResolvedValueOnce({ data: null }).mockResolvedValueOnce({ data: saved });
    mocks.insert.mockResolvedValue({ error: { code: "23505" } });
    expect(await sendThreadMessage({}, form())).toEqual({ ok: "Sent." });
    expect(mocks.insert).toHaveBeenCalledWith(expect.objectContaining({ id: form().get("message_id"), sender_id: "buyer", recipient_id: "seller" }));
  });
  it("keeps an unconfirmed insert retryable and hides database details", async () => {
    mocks.insert.mockResolvedValue({ error: { message: "private database detail" } });
    const result = await sendThreadMessage({}, form());
    expect(result.error).toContain("Try again"); expect(result.error).not.toContain("private");
  });
  it("rejects mixed conversation contexts before lookup", async () => {
    const data = form(); data.set("offer_id", "offer");
    expect((await sendThreadMessage({}, data)).error).toBeTruthy(); expect(mocks.read).not.toHaveBeenCalled();
  });
  it("refuses to insert when prior delivery cannot be checked", async () => {
    mocks.read.mockResolvedValue({ error: { message: "offline" } });
    expect((await sendThreadMessage({}, form())).error).toBeTruthy(); expect(mocks.insert).not.toHaveBeenCalled();
  });
});
