import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
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
    // The mode is written only through agent_mode_set: no table write here.
    from: (table: string) => {
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
  mocks.rpc.mockImplementation(async (_name: string, args: { p_mode: string }) => ({ data: { mode: args.p_mode, revoked: 0 }, error: null }));
});

describe("saveAgentMode (AG-7, R-agentmode)", () => {
  it("stores Act through agent_mode_set", async () => {
    await expect(saveAgentMode({}, form("act"))).resolves.toEqual({ ok: "Agent set to Act within my limits." });
    expect(mocks.rpc).toHaveBeenCalledWith("agent_mode_set", { p_mode: "act" });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/settings");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/agent");
  });

  it("says how many listings the database stopped the agent on, in the same call", async () => {
    mocks.rpc.mockResolvedValue({ data: { mode: "off", revoked: 2 }, error: null });
    await expect(saveAgentMode({}, form("off"))).resolves.toEqual({ ok: "Agent set to Off. Your agent stopped on 2 listings." });
    expect(mocks.rpc).toHaveBeenCalledOnce();
    expect(mocks.capture).toHaveBeenCalledWith("user-1", { event: "agent_mode_set", props: { mode: "off", ended: 2 } });
  });

  it("never claims a save the database refused or didn't confirm", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "40P01" } });
    await expect(saveAgentMode({}, form("suggest"))).resolves.toEqual({ error: "Your agent setting could not be saved. Nothing changed; try again." });
    mocks.rpc.mockResolvedValue({ data: { mode: "act", revoked: 0 }, error: null });
    expect((await saveAgentMode({}, form("off"))).error).toContain("could not be saved");
    expect(mocks.reportError).toHaveBeenCalledTimes(2);
    expect(mocks.capture).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("refuses an unknown mode before writing", async () => {
    await expect(saveAgentMode({}, form("loud"))).resolves.toEqual({ error: "Pick Off, Suggest or Act within my limits." });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("requires a session", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });
    expect((await saveAgentMode({}, form("off"))).error).toContain("Sign in again");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
