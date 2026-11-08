import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ read: vi.fn(), insert: vi.fn(), allow: vi.fn(), admin: vi.fn(), refresh: vi.fn(), suspended: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.refresh }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({ RATE_LIMITS: { sendMessage: {} }, allowAction: mocks.allow, rateLimitMessage: () => "Too many messages." }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.admin }));
vi.mock("@/lib/monitoring", () => ({ reportError: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  auth: { getUser: async () => ({ data: { user: { id: "buyer" } } }) },
  rpc: async () => ({ data: mocks.suspended() }),
  from: () => ({
    select: () => ({ eq: () => ({ maybeSingle: mocks.read }) }),
    insert: mocks.insert,
    update: () => ({ in: () => ({ is: async () => ({ error: null }) }) }),
  }),
}) }));
import { sendThreadMessage } from "./message-actions";
const saved = { sender_id: "buyer", recipient_id: "seller", body: "Hello", order_id: "order", offer_id: null, listing_id: "listing", attachments: [] as string[] };
function form() { const data = new FormData(); data.set("message_id", "12345678-1234-4234-8234-123456789012"); data.set("order_id", "order"); data.set("body", "Hello"); return data; }
beforeEach(() => {
  vi.clearAllMocks(); mocks.suspended.mockReturnValue(false); mocks.allow.mockResolvedValue(true); mocks.read.mockResolvedValue({ data: null, error: null }); mocks.insert.mockResolvedValue({ error: null });
  mocks.admin.mockReturnValue({ from: (table: string) => {
    const query = { select: () => query, eq: () => query, limit: () => query,
      maybeSingle: async () => ({ data: table === "orders" ? { id: "order", buyer_id: "buyer", seller_id: "seller" }
        : table === "listings" ? { id: "part-1", seller_id: "seller" } : { listing_id: "listing" } }) };
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
  describe("a listing enquiry retry (no order or offer to tell contexts apart)", () => {
    const enquiry = { ...saved, order_id: null, listing_id: "part-1" };
    function enquiryForm() { const data = new FormData(); data.set("message_id", "12345678-1234-4234-8234-123456789012"); data.set("listing_id", "part-1"); data.set("body", "Hello"); return data; }
    it("adopts the same enquiry", async () => {
      mocks.read.mockResolvedValue({ data: enquiry });
      expect(await sendThreadMessage({}, enquiryForm())).toEqual({ ok: "Sent." });
      expect(mocks.insert).not.toHaveBeenCalled(); expect(mocks.allow).not.toHaveBeenCalled();
    });
    it.each([{ ...enquiry, listing_id: "part-2" }, { ...enquiry, recipient_id: "someone-else" }])("does not adopt one about another listing or to someone else", async (data) => {
      mocks.read.mockResolvedValue({ data });
      expect((await sendThreadMessage({}, enquiryForm())).error).toMatch(/changed/); expect(mocks.insert).not.toHaveBeenCalled();
    });
    it("does not count a lost enquiry insert as sent when the stored row differs", async () => {
      mocks.read.mockResolvedValueOnce({ data: null }).mockResolvedValueOnce({ data: { ...enquiry, listing_id: "part-2" } });
      mocks.insert.mockResolvedValue({ error: { code: "23505" } });
      expect((await sendThreadMessage({}, enquiryForm())).error).toContain("Try again");
    });
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
  it("sends photos that live in the sender's folder for this recipient", async () => {
    const data = form(); data.set("body", ""); data.append("attachment", "buyer/seller/a.jpg");
    expect(await sendThreadMessage({}, data)).toEqual({ ok: "Sent." });
    expect(mocks.insert).toHaveBeenCalledWith(expect.objectContaining({ body: "", attachments: ["buyer/seller/a.jpg"] }));
  });
  it.each(["seller/buyer/a.jpg", "buyer/other/a.jpg", "buyer/seller/x/a.jpg", "buyer/seller/../a.jpg"])("refuses a photo path outside the sender's folder (%s)", async (path) => {
    const data = form(); data.append("attachment", path);
    expect((await sendThreadMessage({}, data)).error).toBeTruthy(); expect(mocks.insert).not.toHaveBeenCalled();
  });
  it("refuses more than four photos and an empty message", async () => {
    const many = form(); for (let i = 0; i < 5; i++) many.append("attachment", `buyer/seller/${i}.jpg`);
    expect((await sendThreadMessage({}, many)).error).toContain("four");
    const empty = form(); empty.set("body", "  ");
    expect((await sendThreadMessage({}, empty)).error).toBeTruthy();
  });
  it("tells a suspended member why the send was refused", async () => {
    mocks.suspended.mockReturnValue(true);
    mocks.insert.mockResolvedValue({ error: { code: "42501", message: "row-level security" } });
    expect((await sendThreadMessage({}, form())).error).toMatch(/suspended/i);
  });
});
