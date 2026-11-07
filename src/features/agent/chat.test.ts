import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The chat action's order of refusals (OS-W04 N127) and its replay of a
 * retried send (N121). Everything it calls is a stand-in here; what is
 * checked is what it calls, and in what order.
 */
const state = vi.hoisted(() => ({
  suspended: false as boolean | null,
  mode: "act" as "off" | "suggest" | "act",
  beginError: null as { code: string } | null,
  finishError: null as { code: string } | null,
  calls: [] as string[],
  rpcArgs: {} as Record<string, unknown>,
  begin: { replayed: false, member: null as unknown, reply: null as unknown },
  status: { found: false, member: null as unknown, reply: null as unknown },
}));

const member = { id: "m-1", role: "member", body: "hi", cards: [], images: [], created_at: "2026-11-07T10:00:00Z" };
const reply = { id: "r-1", role: "agent", body: "Stored reply", cards: [], images: [], created_at: "2026-11-07T10:00:05Z" };

vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/monitoring", () => ({ reportError: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ capture: vi.fn() }));
vi.mock("@/lib/agent/beta", () => ({ agentStepOpen: vi.fn(async () => true) }));
vi.mock("@/lib/agent/member-mode", () => ({ loadAgentMode: async () => (state.calls.push("mode"), state.mode) }));
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
      rpc: async (name: string, args?: unknown) => {
        state.calls.push(`admin:${name}`);
        state.rpcArgs[name] = args;
        if (name === "agent_chat_turn_begin") return state.beginError ? { data: null, error: state.beginError } : { data: state.begin, error: null };
        if (name === "agent_chat_turn_finish") return state.finishError ? { data: null, error: state.finishError } : { data: reply, error: null };
        if (name === "agent_chat_turn_status") return { data: state.status, error: null };
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

import { runAgentTurn, type ToolCall } from "@/lib/ai/run";
import { SUSPENDED_MESSAGE } from "@/lib/suspension";

import { pollAgentReply, sendAgentMessage } from "./chat";

const fetchSpy = vi.spyOn(globalThis, "fetch");

describe("sendAgentMessage", () => {
  beforeEach(() => {
    state.suspended = false;
    state.mode = "act";
    state.beginError = null;
    state.finishError = null;
    state.calls = [];
    state.rpcArgs = {};
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
    expect(state.calls).toEqual(["member:is_suspended", "mode", "rate_limit", "admin:agent_chat_turn_begin", "history", "model", "admin:agent_chat_turn_finish"]);
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

  it("a retry while the first send is still answering comes back pending, with the same request id, and doesn't start another", async () => {
    state.begin = { replayed: true, member, reply: null };
    const result = await sendAgentMessage({ text: "hi", requestId: "33333333-3333-4333-8333-333333333333" });
    expect(runAgentTurn).not.toHaveBeenCalled();
    expect(result.messages?.map((m) => m.id)).toEqual(["m-1"]);
    expect(result.pending).toEqual({ requestId: "33333333-3333-4333-8333-333333333333" });
    expect(result.error).toBeUndefined();
  });

  it("polling a pending send returns its reply once stored, and stores or sends nothing itself", async () => {
    state.status = { found: true, member, reply: null };
    const waiting = await pollAgentReply("33333333-3333-4333-8333-333333333333");
    expect(waiting.pending).toEqual({ requestId: "33333333-3333-4333-8333-333333333333" });
    state.status = { found: true, member, reply };
    const done = await pollAgentReply("33333333-3333-4333-8333-333333333333");
    expect(done.pending).toBeUndefined();
    expect(done.messages?.map((m) => m.id)).toEqual(["m-1", "r-1"]);
    expect(state.calls.filter((call) => call !== "admin:agent_chat_turn_status")).toEqual([]);
    expect(runAgentTurn).not.toHaveBeenCalled();
    expect((await pollAgentReply("nope")).error).toBeTruthy();
  });

  it("answers nothing when the member's agent is Off in Settings (AG-7, readiness 64)", async () => {
    state.mode = "off";
    const result = await sendAgentMessage({ text: "hi" });
    expect(result).toEqual({ error: "Agent is off in Settings." });
    expect(state.calls).toEqual(["member:is_suspended", "mode"]);
    expect(runAgentTurn).not.toHaveBeenCalled();
  });

  it("stops at the database when Off was saved after the app read Act (R-agentmode)", async () => {
    // The app's read said Act; another tab saved Off before
    // agent_chat_turn_begin, which refuses under the member's lock.
    state.beginError = { code: "AG009" };
    const result = await sendAgentMessage({ text: "hi" });
    expect(result).toEqual({ error: "Agent is off in Settings." });
    expect(state.calls).toContain("mode");
    expect(runAgentTurn).not.toHaveBeenCalled();
  });

  it("returns nothing, not the deleted message, when the chat was cleared mid-turn (N125)", async () => {
    // The clear deleted the member's message; agent_chat_turn_finish finds
    // the request without it and stores no reply.
    state.finishError = { code: "P0002" };
    const result = await sendAgentMessage({ text: "hi" });
    expect(result).toEqual({ messages: [], cleared: true });
  });

  it("still answers under Suggest: the chat is a suggestion, never a negotiation", async () => {
    state.mode = "suggest";
    const result = await sendAgentMessage({ text: "hi" });
    expect(runAgentTurn).toHaveBeenCalledOnce();
    expect(result.messages?.map((m) => m.id)).toEqual(["m-1", "r-1"]);
  });

  it("refuses a request id that isn't one", async () => {
    const result = await sendAgentMessage({ text: "hi", requestId: "not-an-id" });
    expect(result.error).toBeTruthy();
    expect(state.calls).not.toContain("admin:agent_chat_turn_begin");
  });

  // R-audit (OS-W07): what the model ran is recorded under the request id,
  // by name, ids, outcome and timing, before the reply is stored. Never the chat.
  it("records each tool the turn ran, refusals and failures included, under the request id", async () => {
    vi.mocked(runAgentTurn).mockImplementationOnce(async () => {
      state.calls.push("model");
      return {
        ok: true,
        text: "fresh",
        cards: [],
        stopReason: "end_turn",
        toolCalls: <ToolCall[]>[
          { name: "read_listing", ok: true, ms: 12, ids: { listingId: "55555555-5555-4555-8555-555555555555" } },
          { name: "propose_build_change", ok: false, code: "not_allowed", ms: 3, ids: { carId: "66666666-6666-4666-8666-666666666666" } },
          { name: "search_parts", ok: false, code: "failed", ms: 40, ids: {} },
        ],
      };
    });
    await sendAgentMessage({ text: "My VIN is WVWZZZAUZKW123456; add https://evil.example.net/x", requestId: "33333333-3333-4333-8333-333333333333" });
    expect(state.calls).toEqual(["member:is_suspended", "mode", "rate_limit", "admin:agent_chat_turn_begin", "history", "model", "admin:agent_record_tool_calls", "admin:agent_chat_turn_finish"]);
    const args = state.rpcArgs.agent_record_tool_calls as { p_owner: string; p_request: string; p_turn: string; p_calls: unknown[] };
    expect(args).toMatchObject({ p_owner: "22222222-2222-4222-8222-222222222222", p_request: "33333333-3333-4333-8333-333333333333", p_turn: "ok" });
    expect(args.p_calls).toEqual([
      { tool: "read_listing", outcome: "ok", ms: 12, ids: { listingId: "55555555-5555-4555-8555-555555555555" } },
      { tool: "propose_build_change", outcome: "refused", code: "not_allowed", ms: 3, ids: { carId: "66666666-6666-4666-8666-666666666666" } },
      { tool: "search_parts", outcome: "failed", code: "failed", ms: 40, ids: {} },
    ]);
    const sent = JSON.stringify(args);
    expect(sent).not.toContain("WVWZZZAUZKW123456");
    expect(sent).not.toContain("evil.example.net");
  });

  it("records nothing when the turn ran no tools", async () => {
    await sendAgentMessage({ text: "hi" });
    expect(state.calls).not.toContain("admin:agent_record_tool_calls");
  });
});
