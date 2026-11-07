import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { modelContext } from "@/lib/agent/context";
import type { MemberClient } from "@/lib/capabilities/types";

import { anthropicClient } from "./client";
import { estimateCostUsd, resolveAiConfig } from "./config";
import { runAgentTurn, TURN_CAP_USD } from "./run";
import type { SpendLedger } from "./spend";
import type { UsageRecord } from "./usage";

/**
 * The provider boundary (OS-PR64 / OS-W04): these run the real Anthropic
 * SDK and its tool runner against a fake `fetch`, so what they check is the
 * HTTP body that would leave for the provider, every round of it, and how
 * many requests are made at all. No network.
 */

const OWNER = "22222222-2222-4222-8222-222222222222";
const LISTING = "55555555-5555-4555-8555-555555555555";
const VIN = "WVWZZZAUZKW123456";
const config = { ...resolveAiConfig({ NODE_ENV: "test", ANTHROPIC_API_KEY: "test" }), mode: "anthropic" as const };
const notHalted = async () => false;

type Reply = { content: unknown[]; stop_reason: string; input_tokens?: number; output_tokens?: number };

function message(reply: Reply) {
  return {
    id: `msg_${Math.random().toString(36).slice(2)}`,
    type: "message",
    role: "assistant",
    model: config.model,
    content: reply.content,
    stop_reason: reply.stop_reason,
    stop_sequence: null,
    usage: { input_tokens: reply.input_tokens ?? 100, output_tokens: reply.output_tokens ?? 20 },
  };
}

const text = (value: string): Reply => ({ content: [{ type: "text", text: value }], stop_reason: "end_turn" });
const toolUse = (name: string, input: unknown, tokens?: Partial<Reply>): Reply => ({
  content: [{ type: "tool_use", id: `toolu_${Math.random().toString(36).slice(2)}`, name, input }],
  stop_reason: "tool_use",
  ...tokens,
});

/** A provider that answers each request with the next scripted reply, and keeps every request body it was sent. */
function provider(replies: Reply[]) {
  const bodies: Record<string, unknown>[] = [];
  const fetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body ?? "{}")));
    const reply = replies[Math.min(bodies.length - 1, replies.length - 1)];
    return new Response(JSON.stringify(message(reply)), { status: 200, headers: { "content-type": "application/json" } });
  });
  return { fetch, bodies };
}

/** A provider that never answers until the request is aborted. */
function hangingProvider() {
  const fetch = vi.fn(
    (_url: string | URL | Request, init?: RequestInit) =>
      new Promise<Response>((_, reject) => {
        const signal = init?.signal;
        if (signal?.aborted) return reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
        signal?.addEventListener("abort", () => reject(signal.reason ?? new DOMException("Aborted", "AbortError")), { once: true });
      }),
  );
  return { fetch };
}

/** A spend ledger that records every reservation and settlement. */
function ledger(answer: Awaited<ReturnType<SpendLedger["reserve"]>> = { ok: true, hold: "hold-1" }) {
  const reserved: number[] = [];
  const settled: UsageRecord[] = [];
  const spend: SpendLedger = {
    reserve: async (_owner, _feature, amount) => {
      reserved.push(amount);
      return answer;
    },
    settle: async (_owner, _hold, usage) => void settled.push(usage),
  };
  return { spend, reserved, settled };
}

/** The member's own reads, over rows that honour the query's filters (the parts the tools use). */
function memberDb(tables: Record<string, Record<string, unknown>[]>): MemberClient {
  return {
    from(table: string) {
      const filters: [string, unknown][] = [];
      const rows = () => (tables[table] ?? []).filter((row) => filters.every(([column, value]) => (row[column] ?? null) === value));
      const query = {
        select: () => query,
        eq: (column: string, value: unknown) => (filters.push([column, value]), query),
        is: (column: string, value: unknown) => (filters.push([column, value]), query),
        in: () => query,
        order: () => query,
        limit: () => Promise.resolve({ data: rows(), error: null }),
        maybeSingle: () => Promise.resolve({ data: rows()[0] ?? null, error: null }),
      };
      return query;
    },
    rpc: () => Promise.resolve({ data: [], error: null }),
  } as unknown as MemberClient;
}

const LISTING_ROW = { id: LISTING, seller_id: OWNER, title: "Garrett G25-660", price_cents: 100000, currency: "USD", condition: "used", brand: "Garrett", part_number: "G25-660", category: "turbo", shipping_cents: 0, status: "active" };

let previousKey: string | undefined;
beforeEach(() => {
  previousKey = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = "test-key";
});
afterEach(() => {
  process.env.ANTHROPIC_API_KEY = previousKey;
  vi.useRealTimers();
});

describe("what reaches the provider (readiness 63)", () => {
  it("redacts every earlier turn, the agent's included, in every round, and leaves the stored history as it was", async () => {
    const { fetch, bodies } = provider([toolUse("read_listing", { listingId: LISTING }), text("It fits.")]);
    const client = await anthropicClient({ fetch });
    // Turn one, as stored: the member typed their VIN, email and phone, and the agent repeated the VIN.
    const history = [
      { role: "user" as const, content: `My VIN is ${VIN}, mail kaito@drvn.test or call 415-555-0132` },
      { role: "assistant" as const, content: `Thanks, I have ${VIN} on file; I'll email kaito@drvn.test.` },
    ];
    const stored = structuredClone(history);
    const { spend } = ledger();
    const result = await runAgentTurn({ context: modelContext(OWNER, "buyer"), supabase: memberDb({ listings: [LISTING_ROW] }), message: "Turn two: does this turbo fit?", history, client, config, spend, halted: notHalted });

    expect(result).toMatchObject({ ok: true, text: "It fits." });
    expect(bodies).toHaveLength(2);
    for (const body of bodies) {
      const sent = JSON.stringify(body);
      expect(sent).not.toContain(VIN);
      expect(sent).not.toContain("kaito@drvn.test");
      expect(sent).not.toContain("415-555-0132");
      expect(sent).toContain("Turn two: does this turbo fit?");
    }
    const firstMessages = bodies[0].messages as { role: string; content: string }[];
    expect(firstMessages[0].content).toContain("[VIN removed]");
    expect(firstMessages[1]).toMatchObject({ role: "assistant" });
    expect(firstMessages[1].content).toContain("[VIN removed]");
    expect(firstMessages[1].content).toContain("[email]");
    // Storage keeps what the member typed.
    expect(history).toEqual(stored);
  });

  it("an order thread, where a buyer typed their address, never reaches the provider; a question about the listing does (N122)", async () => {
    const address = "14 Acacia Avenue, Leeds LS6 2AB";
    const messages = [
      { listing_id: LISTING, recipient_id: OWNER, order_id: null, kind: "message", body: "Does it come with the oil feed line?", created_at: "2026-11-01T10:00:00Z" },
      { listing_id: LISTING, recipient_id: OWNER, order_id: "66666666-6666-4666-8666-666666666666", kind: "message", body: `Please ship to ${address}`, created_at: "2026-11-02T10:00:00Z" },
      { listing_id: LISTING, recipient_id: OWNER, order_id: "66666666-6666-4666-8666-666666666666", kind: "event", body: `Delivery booked to ${address}`, created_at: "2026-11-02T11:00:00Z" },
    ];
    const { fetch, bodies } = provider([toolUse("read_listing_messages", { listingId: LISTING }), text("One buyer asked about the oil line.")]);
    const client = await anthropicClient({ fetch });
    const { spend } = ledger();
    const result = await runAgentTurn({ context: modelContext(OWNER, "seller"), supabase: memberDb({ listings: [LISTING_ROW], messages }), message: "What are buyers asking?", client, config, spend, halted: notHalted });

    expect(result.ok).toBe(true);
    const sent = JSON.stringify(bodies);
    expect(sent).toContain("oil feed line");
    expect(sent).not.toContain("Acacia");
    expect(sent).not.toContain("LS6 2AB");
  });
});

describe("the kill switch and suspension (readiness 66, N127)", () => {
  it("a switch that is on makes no provider request at all", async () => {
    const { fetch } = provider([text("never")]);
    const { spend, reserved } = ledger();
    const result = await runAgentTurn({ context: modelContext(OWNER, "buyer"), supabase: memberDb({}), message: "hi", client: await anthropicClient({ fetch }), config, spend, halted: async () => true });
    expect(result).toMatchObject({ ok: false, code: "paused" });
    expect(fetch).not.toHaveBeenCalled();
    expect(reserved).toEqual([]);
  });

  it("a switch flipped while a tool runs stops the next request (checked after the tools, before the provider)", async () => {
    const { fetch } = provider([toolUse("read_listing", { listingId: LISTING }), text("never")]);
    let flipped = false;
    const db = memberDb({ listings: [LISTING_ROW] });
    const slowRead: MemberClient = {
      ...db,
      from: (table: string) => {
        // The admin flips "Every agent" while this read is running.
        flipped = true;
        return db.from(table as never);
      },
    } as unknown as MemberClient;
    const { spend, settled } = ledger();
    const result = await runAgentTurn({ context: modelContext(OWNER, "buyer"), supabase: slowRead, message: "hi", client: await anthropicClient({ fetch }), config, spend, halted: async () => flipped });
    expect(result).toMatchObject({ ok: false, code: "paused" });
    // The tool ran to its end; the request after it never went out.
    expect(result.toolCalls.map((call) => call.name)).toEqual(["read_listing"]);
    expect(fetch).toHaveBeenCalledTimes(1);
    // The round it did make is still counted, and nothing unknown is charged.
    expect(settled).toEqual([expect.objectContaining({ inputTokens: 100, outputTokens: 20, costUsd: estimateCostUsd(config.model, 100, 20) })]);
  });

  it("a tool that finishes with too little time left doesn't start another request", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const { fetch } = provider([toolUse("read_listing", { listingId: LISTING }), text("never")]);
    const db = memberDb({ listings: [LISTING_ROW] });
    const slowRead: MemberClient = {
      ...db,
      from: (table: string) => {
        vi.setSystemTime(Date.now() + 26_000);
        return db.from(table as never);
      },
    } as unknown as MemberClient;
    const { spend } = ledger();
    const result = await runAgentTurn({ context: modelContext(OWNER, "buyer"), supabase: slowRead, message: "hi", client: await anthropicClient({ fetch }), config, spend, halted: notHalted, deadline: Date.now() + 30_000 });
    expect(result).toMatchObject({ ok: false, code: "timeout" });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("a refusal from the database (suspended, or a switch it sees) makes no provider request", async () => {
    for (const reason of ["suspended", "paused", "spend_cap"] as const) {
      const { fetch } = provider([text("never")]);
      const { spend, settled } = ledger({ ok: false, reason });
      const result = await runAgentTurn({ context: modelContext(OWNER, "buyer"), supabase: memberDb({}), message: "hi", client: await anthropicClient({ fetch }), config, spend, halted: notHalted });
      expect(result).toMatchObject({ ok: false, code: reason });
      expect(fetch).not.toHaveBeenCalled();
      expect(settled).toEqual([]);
    }
  });
});

describe("one turn's own bounds (readiness 67, N121)", () => {
  it("reserves the turn's cap before calling, and never spends past it", async () => {
    // Each round is sent 60,000 tokens: after one, the next round's worst case no longer fits.
    const { fetch } = provider([toolUse("read_listing", { listingId: LISTING }, { input_tokens: 60_000, output_tokens: 1_000 }), text("never")]);
    const { spend, reserved, settled } = ledger();
    const result = await runAgentTurn({ context: modelContext(OWNER, "buyer"), supabase: memberDb({ listings: [LISTING_ROW] }), message: "hi", client: await anthropicClient({ fetch }), config, spend, halted: notHalted });
    expect(reserved).toEqual([TURN_CAP_USD]);
    expect(result).toMatchObject({ ok: false, code: "incomplete" });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(settled).toHaveLength(1);
    expect(estimateCostUsd(settled[0].model, settled[0].inputTokens, settled[0].outputTokens)!).toBeLessThanOrEqual(TURN_CAP_USD);
  });

  it("drops the oldest history rather than send a first round that couldn't fit", async () => {
    const { fetch, bodies } = provider([text("ok")]);
    const long = "a long earlier message ".repeat(350);
    const history = Array.from({ length: 40 }, (_, i) => ({ role: (i % 2 ? "assistant" : "user") as "user" | "assistant", content: `${i} ${long}` }));
    const { spend } = ledger();
    const result = await runAgentTurn({ context: modelContext(OWNER, "buyer"), supabase: memberDb({}), message: "latest question", history, client: await anthropicClient({ fetch }), config, spend, halted: notHalted });
    expect(result.ok).toBe(true);
    const sent = bodies[0].messages as { role: string; content: string }[];
    expect(sent.length).toBeLessThan(history.length + 1);
    expect(sent[0].role).toBe("user");
    expect(sent.at(-1)!.content).toContain("latest question");
  });

  it("stops at the deadline: the abort reaches the hanging request, and the turn is settled", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    const { fetch } = hangingProvider();
    const { spend, settled } = ledger();
    const pending = runAgentTurn({ context: modelContext(OWNER, "buyer"), supabase: memberDb({}), message: "hi", client: await anthropicClient({ fetch }), config, spend, halted: notHalted, deadline: Date.now() + 10_000 });
    await vi.advanceTimersByTimeAsync(10_500);
    await expect(pending).resolves.toMatchObject({ ok: false, code: "timeout" });
    // Aborted, so not retried.
    expect(fetch).toHaveBeenCalledTimes(1);
    // The provider may have processed it: its worst case is charged, not released.
    expect(settled).toHaveLength(1);
    expect(settled[0]).toMatchObject({ inputTokens: 0, outputTokens: 0 });
    expect(settled[0].costUsd!).toBeGreaterThan(0);
    expect(settled[0].costUsd!).toBeLessThanOrEqual(TURN_CAP_USD);
  });

  it("a later round lost in transit is charged at its worst case on top of the rounds that came back", async () => {
    let calls = 0;
    const fetch = vi.fn(async () => {
      if (++calls === 1) return new Response(JSON.stringify(message(toolUse("read_listing", { listingId: LISTING }))), { status: 200, headers: { "content-type": "application/json" } });
      throw new TypeError("socket hang up");
    });
    const { spend, settled } = ledger();
    const result = await runAgentTurn({ context: modelContext(OWNER, "buyer"), supabase: memberDb({ listings: [LISTING_ROW] }), message: "hi", client: await anthropicClient({ fetch }), config, spend, halted: notHalted });
    expect(result).toMatchObject({ ok: false, code: "model_error" });
    expect(settled).toHaveLength(1);
    expect(settled[0]).toMatchObject({ inputTokens: 100, outputTokens: 20 });
    expect(settled[0].costUsd!).toBeGreaterThan(estimateCostUsd(config.model, 100, 20)! + 0.1);
    expect(settled[0].costUsd!).toBeLessThanOrEqual(TURN_CAP_USD);
  });

  it("a request the provider rejected outright (a 400, never retried or billed) releases the reservation", async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: "bad" } }), { status: 400, headers: { "content-type": "application/json" } }));
    const { spend, settled } = ledger();
    const result = await runAgentTurn({ context: modelContext(OWNER, "buyer"), supabase: memberDb({}), message: "hi", client: await anthropicClient({ fetch }), config, spend, halted: notHalted });
    expect(result).toMatchObject({ ok: false, code: "model_error" });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(settled).toEqual([expect.objectContaining({ inputTokens: 0, outputTokens: 0 })]);
    expect(settled[0].costUsd ?? 0).toBe(0);
  });

  it("stops when the caller gives up", async () => {
    const { fetch } = hangingProvider();
    const caller = new AbortController();
    const { spend } = ledger();
    const pending = runAgentTurn({ context: modelContext(OWNER, "buyer"), supabase: memberDb({}), message: "hi", client: await anthropicClient({ fetch }), config, spend, halted: notHalted, signal: caller.signal });
    setTimeout(() => caller.abort(), 20);
    await expect(pending).resolves.toMatchObject({ ok: false, code: "timeout" });
  });

  it("won't start with too little time left", async () => {
    const { fetch } = provider([text("never")]);
    const { spend, reserved } = ledger();
    const result = await runAgentTurn({ context: modelContext(OWNER, "buyer"), supabase: memberDb({}), message: "hi", client: await anthropicClient({ fetch }), config, spend, halted: notHalted, deadline: Date.now() + 1_000 });
    expect(result).toMatchObject({ ok: false, code: "timeout" });
    expect(fetch).not.toHaveBeenCalled();
    expect(reserved).toEqual([]);
  });

  it("retries a failed request once, in its own loop, not the SDK's default twice", async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ type: "error", error: { type: "overloaded_error", message: "busy" } }), { status: 529, headers: { "content-type": "application/json", "retry-after-ms": "1" } }));
    const { spend } = ledger();
    const result = await runAgentTurn({ context: modelContext(OWNER, "buyer"), supabase: memberDb({}), message: "hi", client: await anthropicClient({ fetch }), config, spend, halted: notHalted });
    expect(result).toMatchObject({ ok: false, code: "model_error" });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  describe("every attempt is accounted for on its own (GPT review of #79)", () => {
    const ok = () => new Response(JSON.stringify(message(text("Here you go."))), { status: 200, headers: { "content-type": "application/json" } });
    const bad = () => new Response(JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: "bad" } }), { status: 400, headers: { "content-type": "application/json" } });
    const lost = () => {
      throw new TypeError("socket hang up");
    };
    async function turn(...answers: (() => Response)[]) {
      let call = 0;
      const fetch = vi.fn(async () => answers[Math.min(call++, answers.length - 1)]());
      const { spend, settled } = ledger();
      const result = await runAgentTurn({ context: modelContext(OWNER, "buyer"), supabase: memberDb({}), message: "hi", client: await anthropicClient({ fetch }), config, spend, halted: notHalted });
      return { result, fetch, usage: settled[0] };
    }

    it("lost, then a 400: the lost attempt is still charged, the 400 isn't", async () => {
      const { result, fetch, usage } = await turn(lost, bad);
      expect(result).toMatchObject({ ok: false, code: "model_error" });
      expect(fetch).toHaveBeenCalledTimes(2);
      expect(usage.costUsd!).toBeGreaterThan(0);
    });

    it("lost, then lost: both attempts are charged, and together they fit the reservation", async () => {
      const once = (await turn(lost, bad)).usage.costUsd!;
      const { result, fetch, usage } = await turn(lost, lost);
      expect(result).toMatchObject({ ok: false, code: "model_error" });
      expect(fetch).toHaveBeenCalledTimes(2);
      expect(usage.costUsd!).toBeCloseTo(once * 2, 6);
      expect(usage.costUsd!).toBeLessThanOrEqual(TURN_CAP_USD);
    });

    it("lost, then a success: the reply's tokens and the lost attempt's worst case", async () => {
      const once = (await turn(lost, bad)).usage.costUsd!;
      const { result, fetch, usage } = await turn(lost, ok);
      expect(result).toMatchObject({ ok: true, text: "Here you go." });
      expect(fetch).toHaveBeenCalledTimes(2);
      expect(usage).toMatchObject({ inputTokens: 100, outputTokens: 20 });
      expect(usage.costUsd!).toBeCloseTo(estimateCostUsd(config.model, 100, 20)! + once, 6);
    });

    it("a switch flipped while waiting to retry stops the retry", async () => {
      let flipped = false;
      const fetch = vi.fn(async () => {
        // The admin pauses the agent during the retry wait.
        setTimeout(() => (flipped = true), 10);
        return new Response(JSON.stringify({ type: "error", error: { type: "overloaded_error", message: "busy" } }), { status: 529, headers: { "content-type": "application/json", "retry-after-ms": "100" } });
      });
      const { spend, settled } = ledger();
      const result = await runAgentTurn({ context: modelContext(OWNER, "buyer"), supabase: memberDb({}), message: "hi", client: await anthropicClient({ fetch }), config, spend, halted: async () => flipped });
      expect(result).toMatchObject({ ok: false, code: "paused" });
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(settled[0].costUsd!).toBeGreaterThan(0);
    });

    it("no retry starts with too little time left", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      const fetch = vi.fn(async () => {
        vi.setSystemTime(Date.now() + 26_000);
        return new Response(JSON.stringify({ type: "error", error: { type: "overloaded_error", message: "busy" } }), { status: 529, headers: { "content-type": "application/json", "retry-after-ms": "0" } });
      });
      const { spend } = ledger();
      const result = await runAgentTurn({ context: modelContext(OWNER, "buyer"), supabase: memberDb({}), message: "hi", client: await anthropicClient({ fetch }), config, spend, halted: notHalted, deadline: Date.now() + 30_000 });
      expect(result).toMatchObject({ ok: false, code: "timeout" });
      expect(fetch).toHaveBeenCalledTimes(1);
    });

    it("a retry that wouldn't fit what is left of the reservation isn't sent", async () => {
      // A first round near half the cap: one charged unknown attempt leaves too little for a second.
      const big = "a long earlier message ".repeat(1_400);
      const fetch = vi.fn(async () => lost());
      const { spend } = ledger();
      const result = await runAgentTurn({ context: modelContext(OWNER, "buyer"), supabase: memberDb({}), message: "hi", history: [{ role: "user", content: big }, { role: "assistant", content: "ok" }, { role: "user", content: big }, { role: "assistant", content: "ok" }], client: await anthropicClient({ fetch }), config, spend, halted: notHalted });
      expect(result).toMatchObject({ ok: false, code: "incomplete" });
      expect(fetch).toHaveBeenCalledTimes(1);
    });
  });

  it("checks the switches right before the first request too, once the budget is held", async () => {
    const { fetch } = provider([text("never")]);
    let checks = 0;
    const { spend, settled } = ledger();
    const result = await runAgentTurn({ context: modelContext(OWNER, "buyer"), supabase: memberDb({}), message: "hi", client: await anthropicClient({ fetch }), config, spend, halted: async () => ++checks > 1 });
    expect(result).toMatchObject({ ok: false, code: "paused" });
    expect(fetch).not.toHaveBeenCalled();
    // Reserved, then released whole: nothing was sent.
    expect(settled).toEqual([expect.objectContaining({ inputTokens: 0, outputTokens: 0 })]);
    expect(settled[0].costUsd ?? 0).toBe(0);
  });
});
