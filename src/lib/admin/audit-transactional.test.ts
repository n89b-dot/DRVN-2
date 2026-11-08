import { describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc: session.rpc }) }));
vi.mock("@/lib/monitoring", () => ({ reportError: vi.fn() }));

import { auditedAction } from "./audit";

const admin = { rpc: vi.fn().mockResolvedValue({ error: null }) };

describe("suspension commands run in the database", () => {
  it.each(["user.suspend", "user.unsuspend"])("%s runs execute_admin_command, never the closure", async (action) => {
    session.rpc.mockResolvedValueOnce({ data: { pausedListingIds: ["listing-1"] }, error: null });
    const mutate = vi.fn();
    const result = await auditedAction(
      admin as never,
      { actorId: "admin-1", action, subjectType: "user", subjectId: "user-1", reason: "Fraud review" },
      mutate
    );
    expect(session.rpc).toHaveBeenCalledWith("execute_admin_command", expect.objectContaining({ p_action: action }));
    expect(mutate).not.toHaveBeenCalled();
    expect(result).toEqual({ pausedListingIds: ["listing-1"] });
  });

  it("reports the database's refusal instead of success", async () => {
    session.rpc.mockResolvedValueOnce({ data: null, error: { message: "User is already suspended or missing" } });
    await expect(
      auditedAction(
        admin as never,
        { actorId: "admin-1", action: "user.suspend", subjectType: "user", subjectId: "user-1", reason: "Fraud review" },
        vi.fn()
      )
    ).rejects.toThrow("already suspended");
  });

  it("the dispute reopen (N91) runs in the database, audited with it", async () => {
    session.rpc.mockResolvedValueOnce({ data: { reopenedFrom: "history-1", previousOutcome: "closed_by_buyer" }, error: null });
    const mutate = vi.fn();
    const result = await auditedAction(
      admin as never,
      { actorId: "admin-1", action: "dispute.reopen", subjectType: "dispute", subjectId: "order-1", orderId: "order-1", reason: "New evidence" },
      mutate
    );
    expect(session.rpc).toHaveBeenCalledWith(
      "execute_admin_command",
      expect.objectContaining({ p_action: "dispute.reopen", p_subject: "order-1", p_reason: "New evidence" })
    );
    expect(mutate).not.toHaveBeenCalled();
    expect(result).toEqual({ reopenedFrom: "history-1", previousOutcome: "closed_by_buyer" });
  });
});
