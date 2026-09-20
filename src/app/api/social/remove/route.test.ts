import { beforeEach, expect, it, vi } from "vitest";
const { save, follow } = vi.hoisted(() => ({ save: vi.fn(), follow: vi.fn() }));
vi.mock("@/features/social/actions", () => ({ removeSave: save, removeFollow: follow }));
import { POST } from "./route";
beforeEach(() => { save.mockReset(); follow.mockReset(); });
function request(body = "kind=save&target_type=listing&target_id=fixture", origin = "http://localhost:3005") {
  return new Request("http://localhost:3005/api/social/remove", { method: "POST", headers: { origin }, body });
}
it("rejects a foreign origin or unsupported operation before mutation", async () => {
  expect((await POST(request("kind=save", "https://attacker.test"))).status).toBe(403);
  expect((await POST(request("kind=like"))).status).toBe(400);
  expect(save).not.toHaveBeenCalled(); expect(follow).not.toHaveBeenCalled();
});
it("delegates exact removals to the existing authenticated mutation", async () => {
  save.mockResolvedValue({}); follow.mockResolvedValue({});
  expect((await POST(request())).status).toBe(200);
  expect(save.mock.calls[0][1].get("target_id")).toBe("fixture");
  expect((await POST(request("kind=follow&target_type=car&target_id=fixture"))).status).toBe(200);
  expect(follow).toHaveBeenCalledOnce();
});
it("returns unsuccessful removals and transport failures honestly", async () => {
  save.mockResolvedValueOnce({ error: "Sign in again." });
  expect((await POST(request())).status).toBe(400);
  save.mockRejectedValueOnce(new Error("unavailable"));
  expect((await POST(request())).status).toBe(503);
});
