import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The chat action's order of refusals (OS-W04 N127) and its replay of a
 * retried send (N121). Everything it calls is a stand-in here; what is
 * checked is what it calls, and in what order.
 */
const state = vi.hoisted(() => ({
  suspended: false as boolean | null,
  calls: [] as string[],
  begin: { replayed: false, member: null as unknown, reply: null as unknown },
}));

const member = { id: "m-1", role: "member", body: "hi", cards: [], images: [], created_at: "2026-11-07T10:00:00Z" };
const reply = { id: "r-1", role: "agent", body: "Stored reply", cards: [], images: [], created_at: "2026-11-07T10:00:05Z" };

vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/monitoring", () => ({ reportError: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ capture: vi.fn() }));
vi.mock("@/lib/agent/beta", () => ({ agentStepOpen: vi.fn(async () => true) }));
vi.mock("@/lib/rate-limit", () => ({
  RATE_LIMITS: { agentChat: {} },
  allowAction: vi.fn(async () => (state.calls.push("rate_limit"), true)),
  rateLimitMessage: () => "slow down",
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "22222222-2222-4222-8222-222222222222" } } }) },
    rpc: async (name: string) => {
      state.calls.push(`member:${name}`);
      return state.suspended === null ? { data: null, error: { code: "57014" } } : { data: state.suspended, error: null };
    },
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    const query = { select: () => query, eq: () => query, neq: () => query, order: () => query, limit: () => (state.calls.push("history"), Promise.resolve({ data: [], error: null })) };
    return {
      from: () => query,
      rpc: async (name: string) => {
        state.calls.push(`admin:${name}`);
        if (name === "agent_chat_turn_begin") return { data: state.begin, error: null };
        if (name === "agent_chat_turn_finish") return { data: reply, error: null };
        return { data: null, error: null };
      },
    };
  },
}));
vi.mock("@/lib/ai/run", () => ({
  runAgentTurn: vi.fn(async () => (state.calls.push("model"), { ok: true, text: "fresh", toolCalls: [], cards: [], stopReason: "end_turn" })),
}));
vi.mock("./cards", () => ({ resolveCards: async () => new Map() }));
vi.mock("./chat-load", () => ({ loadChat: vi.fn(), resolveAbout: async () => null }));

import { runAgentTurn } from "@/lib/ai/run";
import { SUSPENDED_MESSAGE } from "@/lib/suspension";

import { sendAgentMessage } from "./chat";

const fetchSpy = vi.spyOn(globalThis, "fetch");

describe("sendAgentMessage", () => {
  beforeEach(() => {
    state.suspended = false;
    state.calls = [];
    state.begin = { replayed: false, member, reply: null };
    vi.mocked(runAgentTurn).mockClear();
    fetchSpy.mockClear();
  });

  it("refuses a suspended member before storing, fetching, reserving or calling anything", async () => {
    state.suspended = true;
    const result = await sendAgentMessage({ text: "hi", images: [] });
    expect(result).toEqual({ error: SUSPENDED_MESSAGE });
    expect(state.calls).toEqual(["member:is_suspended"]);
    expect(runAgentTurn).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("refuses when suspension can't be checked", async () => {
    state.suspended = null;
    const result = await sendAgentMessage({ text: "hi" });
    expect(result.error).toBeTruthy();
    expect(state.calls).toEqual(["member:is_suspended"]);
    expect(runAgentTurn).not.toHaveBeenCalled();
  });

  it("a member the database calls suspended (between the two checks) is told so, and the model isn't called", async () => {
    const admin = await import("@/lib/supabase/admin");
    const real = admin.createAdminClient;
    vi.spyOn(admin, "createAdminClient").mockImplementationOnce(() => ({ ...real(), rpc: async () => ({ data: null, error: { code: "42501" } }) }) as never);
    const result = await sendAgentMessage({ text: "hi" });
    expect(result).toEqual({ error: SUSPENDED_MESSAGE });
    expect(runAgentTurn).not.toHaveBeenCalled();
  });

  it("runs one turn with a deadline, then stores the reply against the same request", async () => {
    const result = await sendAgentMessage({ text: "hi", requestId: "33333333-3333-4333-8333-333333333333" });
    expect(state.calls).toEqual(["member:is_suspended", "rate_limit", "admin:agent_chat_turn_begin", "history", "model", "admin:agent_chat_turn_finish"]);
    const turn = vi.mocked(runAgentTurn).mock.calls[0][0];
    expect(turn.deadline).toBeGreaterThan(Date.now());
    expect(turn.deadline! - Date.now()).toBeLessThanOrEqual(120_000);
    expect(turn.signal).toBeInstanceOf(AbortSignal);
    expect(result.messages?.map((m) => m.id)).toEqual(["m-1", "r-1"]);
  });

  it("a retried send replays what the first one stored, with no second model call", async () => {
    state.begin = { replayed: true, member, reply };
    const result = await sendAgentMessage({ text: "hi", requestId: "33333333-3333-4333-8333-333333333333" });
    expect(runAgentTurn).not.toHaveBeenCalled();
    expect(state.calls).not.toContain("admin:agent_chat_turn_finish");
    expect(result.messages?.map((m) => m.body)).toEqual(["hi", "Stored reply"]);
  });

  it("a retry while the first send is still answering says so, and doesn't start another", async () => {
    state.begin = { replayed: true, member, reply: null };
    const result = await sendAgentMessage({ text: "hi", requestId: "33333333-3333-4333-8333-333333333333" });
    expect(runAgentTurn).not.toHaveBeenCalled();
    expect(result.messages?.map((m) => m.id)).toEqual(["m-1"]);
    expect(result.error).toMatch(/still answering/);
  });

  it("refuses a request id that isn't one", async () => {
    const result = await sendAgentMessage({ text: "hi", requestId: "not-an-id" });
    expect(result.error).toBeTruthy();
    expect(state.calls).not.toContain("admin:agent_chat_turn_begin");
  });
});
