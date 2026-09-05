import { describe, it, expect, vi } from "vitest";
import { auditedAction } from "./audit";
const entry = { actorId: "actor", action: "order.force_refund", subjectType: "order" as const, subjectId: "order", reason: "Verified refund" };
describe("external admin failure recovery", () => {
  it("does not repeat an operation whose prior result needs reconciliation", async () => {
    const rpc = vi.fn().mockResolvedValueOnce({ error: null }).mockResolvedValueOnce({ data: { operationId: "existing", reused: true } });
    const mutate = vi.fn();
    await expect(auditedAction({ rpc } as never, entry, mutate)).rejects.toThrow("existing");
    expect(mutate).not.toHaveBeenCalled();
  });
  it("reports provider success followed by completion-audit failure without repeating it", async () => {
    const rpc = vi.fn().mockResolvedValueOnce({ error: null }).mockResolvedValueOnce({ data: { operationId: "durable-id", reused: false } });
    const admin = { rpc, from: () => ({ insert: vi.fn().mockResolvedValue({ error: { code: "08006" } }) }) };
    const mutate = vi.fn().mockResolvedValue({ reference: "refund-reference" });
    await expect(auditedAction(admin as never, entry, mutate)).rejects.toThrow("durable-id");
    expect(mutate).toHaveBeenCalledOnce();
  });
});
