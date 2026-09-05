import { beforeEach, expect, it, vi } from "vitest";
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/features/commerce/dispute-command", () => ({ openDisputeCommand: vi.fn() }));
import { openDisputeCommand } from "@/features/commerce/dispute-command";
import { POST } from "./route";
const id = "11111111-1111-4111-8111-111111111111";
function request(body: unknown, origin = "https://drvn.test") { return POST(new Request(`https://drvn.test/api/orders/${id}/dispute`, { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(body) }), { params: Promise.resolve({ id }) }); }
beforeEach(() => { vi.resetAllMocks(); vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://drvn.test"); });
it("rejects cross-origin requests before executing a mutation", async () => {
  expect((await request({ category: "wrong_item" }, "https://attacker.test")).status).toBe(403);
  expect(openDisputeCommand).not.toHaveBeenCalled();
});
it("bounds the actual body even without a content-length header", async () => {
  expect((await request({ category: "wrong_item", reason: "a".repeat(8192) })).status).toBe(413);
  expect(openDisputeCommand).not.toHaveBeenCalled();
});
it("uses the route order and returns ordinary uncached JSON", async () => {
  vi.mocked(openDisputeCommand).mockResolvedValue({ ok: "Opened" });
  const response = await request({ category: "wrong_item", order_id: "untrusted" });
  expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.json()).toEqual({ ok: "Opened" });
  expect(vi.mocked(openDisputeCommand).mock.calls[0][0].get("order_id")).toBe(id);
});
it("preserves authorization and validation errors", async () => {
  vi.mocked(openDisputeCommand).mockResolvedValue({ error: "That isn't your order." });
  expect((await request({ category: "wrong_item" })).status).toBe(400);
});

it("validates the public origin behind an internal reverse proxy", async () => {
  vi.mocked(openDisputeCommand).mockResolvedValue({ ok: "Opened" });
  const response = await POST(new Request(`http://internal:3000/api/orders/${id}/dispute`, { method: "POST", headers: { origin: "https://drvn.test", "content-type": "application/json" }, body: JSON.stringify({ category: "wrong_item" }) }), { params: Promise.resolve({ id }) });
  expect(response.status).toBe(200);
});
