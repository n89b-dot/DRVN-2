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

describe("a refused chargeback retry never blocks the next one (N944, #108)", () => {
  it("closes the journal entry through the retry releaser and rethrows the refusal", async () => {
    const { RefusedOperationError } = await import("./audit");
    const rpc = vi.fn(async (name: string) => {
      if (name === "assert_admin_actor") return { error: null };
      if (name === "begin_admin_external_operation") return { data: { operationId: "op-1", reused: false }, error: null };
      if (name === "release_refused_dispute_retry") return { data: { released: true }, error: null };
      throw new Error(`unexpected ${name}`);
    });
    const insert = vi.fn().mockResolvedValue({ error: null });
    const mutate = vi.fn().mockRejectedValue(new RefusedOperationError("This chargeback isn't held for review (it is open)"));
    await expect(
      auditedAction({ rpc, from: () => ({ insert }) } as never, { actorId: "actor", action: "recovery.retry_dispute", subjectType: "payment", subjectId: "case", reason: "Checked" }, mutate),
    ).rejects.toThrow("isn't held");
    expect(rpc).toHaveBeenCalledWith("release_refused_dispute_retry", { p_actor: "actor", p_operation: "op-1", p_detail: "This chargeback isn't held for review (it is open)" });
  });
});
