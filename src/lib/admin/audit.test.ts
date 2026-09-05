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

it("resumes the explicitly linked replacement after an audit crash", async () => {
  const rpc = vi.fn().mockResolvedValueOnce({error:null}).mockResolvedValueOnce({data:{operationId:"existing",reused:true}});
  const insert = vi.fn().mockResolvedValue({error:null});
  const mutate = vi.fn().mockResolvedValue({operationId:"same-refund"});
  await expect(auditedAction({rpc,from:()=>({insert})} as never,{...entry,action:"recovery.replace_refund"},mutate)).resolves.toEqual({operationId:"same-refund"});
  expect(mutate).toHaveBeenCalledOnce();
  expect(insert.mock.calls[0][0].metadata.operationId).toBe("existing");
});
