import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  update: vi.fn(),
  liveMandates: vi.fn(),
  rpc: vi.fn(),
  revalidatePath: vi.fn(),
  reportError: vi.fn(),
  capture: vi.fn(),
}));

vi.mock("@/lib/revalidate", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/monitoring", () => ({ reportError: mocks.reportError }));
vi.mock("@/lib/analytics", () => ({ capture: mocks.capture }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: mocks.getUser },
    rpc: mocks.rpc,
    from: (table: string) => {
      if (table === "profiles") return { update: (values: unknown) => ({ eq: () => mocks.update(values) }) };
      if (table === "agent_mandates") return { select: () => ({ eq: () => ({ in: () => mocks.liveMandates() }) }) };
      throw new Error(`unexpected table ${table}`);
    },
  }),
}));

import { saveAgentMode } from "./agent-actions";

function form(mode: string) {
  const data = new FormData();
  data.set("agent_mode", mode);
  return data;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getUser.mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });
  mocks.update.mockResolvedValue({ error: null });
  mocks.liveMandates.mockResolvedValue({ data: [], error: null });
  mocks.rpc.mockResolvedValue({ data: "revoked", error: null });
});

describe("saveAgentMode (AG-7)", () => {
  it("stores Act without touching any mandate", async () => {
    await expect(saveAgentMode({}, form("act"))).resolves.toEqual({ ok: "Agent set to Act within my limits." });
    expect(mocks.update).toHaveBeenCalledWith({ agent_mode: "act" });
    expect(mocks.liveMandates).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/settings");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/agent");
  });

  it("ends every live mandate when the member drops below Act, and says how many", async () => {
    mocks.liveMandates.mockResolvedValue({ data: [{ id: "m-1" }, { id: "m-2" }], error: null });

    await expect(saveAgentMode({}, form("off"))).resolves.toEqual({ ok: "Agent set to Off. Your agent stopped on 2 listings." });
    expect(mocks.rpc.mock.calls).toEqual([
      ["agent_mandate_set_status", { p_mandate: "m-1", p_status: "revoked" }],
      ["agent_mandate_set_status", { p_mandate: "m-2", p_status: "revoked" }],
    ]);
    expect(mocks.capture).toHaveBeenCalledWith("user-1", { event: "agent_mode_set", props: { mode: "off", ended: 2 } });
  });

  it("never claims a mandate stopped when the database refused", async () => {
    mocks.liveMandates.mockResolvedValue({ data: [{ id: "m-1" }], error: null });
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "22023" } });

    const result = await saveAgentMode({}, form("suggest"));
    expect(result.ok).toBeUndefined();
    expect(result.error).toContain("Saved as Suggest");
    expect(result.error).toContain("couldn't be stopped");
    expect(mocks.reportError).toHaveBeenCalledOnce();
    expect(mocks.capture).not.toHaveBeenCalled();
  });

  it("refuses an unknown mode before writing", async () => {
    await expect(saveAgentMode({}, form("loud"))).resolves.toEqual({ error: "Pick Off, Suggest or Act within my limits." });
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("does not claim success after a failed write", async () => {
    mocks.update.mockResolvedValue({ error: { code: "42501" } });

    await expect(saveAgentMode({}, form("off"))).resolves.toEqual({ error: "Your agent setting could not be saved. Try again." });
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("requires a session", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });
    expect((await saveAgentMode({}, form("off"))).error).toContain("Sign in again");
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
