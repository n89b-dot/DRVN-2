import { beforeEach, expect, it, vi } from "vitest";
const { save } = vi.hoisted(() => ({ save: vi.fn() }));
vi.mock("@/features/marketplace/saved-search-actions", () => ({ createSavedSearch: save }));
import { POST } from "./route";

beforeEach(() => { save.mockReset(); });
function request(body = "p_q=turbo&p_max=500", origin = "http://localhost:3005") {
  return new Request("http://localhost:3005/api/marketplace/saved-searches", { method: "POST", headers: { origin }, body });
}
it("rejects cross-origin requests before saving", async () => {
  expect((await POST(request("p_q=turbo", "https://attacker.test"))).status).toBe(403);
  expect(save).not.toHaveBeenCalled();
});
it("preserves fields through the shared authenticated save operation", async () => {
  save.mockResolvedValue({ ok: "Saved" });
  const response = await POST(request());
  expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.json()).toEqual({ ok: "Saved" });
  expect(save.mock.calls[0][1].get("p_max")).toBe("500");
});
it("returns failures without claiming a successful save", async () => {
  save.mockResolvedValueOnce({ error: "Sign in to save searches." });
  expect((await POST(request())).status).toBe(400);
  save.mockRejectedValueOnce(new Error("unavailable"));
  expect((await POST(request())).status).toBe(503);
  expect((await POST(request("x".repeat(8001)))).status).toBe(413);
});
