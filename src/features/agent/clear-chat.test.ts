import { beforeEach, describe, expect, it, vi } from "vitest";

/** N125: clearing the chat goes through the member's own RPC, and the R81 cleanup hook runs only after it succeeds. */

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  rpc: vi.fn(),
  after: vi.fn(),
  revalidatePath: vi.fn(),
  reportError: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`redirect:${to}`);
  },
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: mocks.getUser }, rpc: mocks.rpc }) }));
vi.mock("@/lib/revalidate", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/monitoring", () => ({ reportError: mocks.reportError }));
vi.mock("./chat-cleanup", () => ({ afterChatCleared: mocks.after }));

import { clearAgentChat } from "./clear-chat";

const run = () => clearAgentChat({}, new FormData());

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
});

describe("clearAgentChat (N125)", () => {
  it("clears the member's own thread with agent_clear_conversation, then runs the cleanup hook", async () => {
    mocks.rpc.mockResolvedValue({ data: 1, error: null });
    await expect(run()).resolves.toEqual({ ok: "Chat cleared." });
    expect(mocks.rpc).toHaveBeenCalledWith("agent_clear_conversation");
    expect(mocks.after).toHaveBeenCalledWith("user-1");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/agent");
  });

  it("says so when there was nothing to clear", async () => {
    mocks.rpc.mockResolvedValue({ data: 0, error: null });
    await expect(run()).resolves.toEqual({ ok: "Your chat was already empty." });
  });

  it("never claims a clear the database refused, and runs no cleanup", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "57014" } });
    await expect(run()).resolves.toEqual({ error: "Couldn't clear your chat. Nothing was deleted; try again." });
    expect(mocks.after).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
    expect(mocks.reportError).toHaveBeenCalledOnce();
  });

  it("requires a session", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null } });
    await expect(run()).rejects.toThrow("redirect:/login?next=/agent");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
