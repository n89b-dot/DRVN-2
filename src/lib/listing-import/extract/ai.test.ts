import { beforeEach, describe, expect, it, vi } from "vitest";

import { databaseLedger, type SpendLedger, type SpendReservation } from "@/lib/ai/spend";

import type { ImportConfig } from "../config";
import type { NormalizedImportSource } from "../schema";
import { parseExtraction } from "../schema";
import { DEFAULT_IMPORT_MODEL } from "../config";
import { LISTING_OUTPUT_SCHEMA, extractListing, extractWithHeuristics, importReserveUsd } from "./ai";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/monitoring", () => ({ reportError: vi.fn() }));

/**
 * An in-memory copy of agent_spend_reserve / agent_spend_settle
 * (20261107100000), so the real databaseLedger runs against the same
 * arithmetic: today's stored cost_usd plus open holds, against the cap.
 * Usage with no cost adds nothing to the sums, exactly as in SQL.
 */
const db = vi.hoisted(() => {
  const state = {
    memberCapUsd: 0.5,
    globalCapUsd: 100,
    holds: new Map<string, { owner: string; amount: number }>(),
    usage: [] as { owner: string; feature: string; model: string; cost: number | null }[],
    next: 0,
  };
  const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);
  const rpc = async (name: string, args: Record<string, unknown>) => {
    if (name === "agent_spend_reserve") {
      const owner = args.p_owner as string;
      const amount = args.p_amount_usd as number;
      if (!(amount > 0) || amount > 5) return { data: null, error: { code: "22023", message: "Invalid spend reservation" } };
      const member =
        sum(state.usage.filter((u) => u.owner === owner).map((u) => u.cost ?? 0)) +
        sum([...state.holds.values()].filter((h) => h.owner === owner).map((h) => h.amount));
      const global = sum(state.usage.map((u) => u.cost ?? 0)) + sum([...state.holds.values()].map((h) => h.amount));
      if (member + amount > state.memberCapUsd || global + amount > state.globalCapUsd) {
        return { data: { allowed: false, reason: "spend_cap" }, error: null };
      }
      const hold = `hold-${++state.next}`;
      state.holds.set(hold, { owner, amount });
      return { data: { allowed: true, hold }, error: null };
    }
    if (name === "agent_spend_settle") {
      const hold = state.holds.get(args.p_hold as string);
      if (hold && hold.owner === args.p_owner) state.holds.delete(args.p_hold as string);
      if ((args.p_input_tokens as number) + (args.p_output_tokens as number) > 0) {
        state.usage.push({
          owner: args.p_owner as string,
          feature: args.p_feature as string,
          model: args.p_model as string,
          cost: (args.p_cost_usd as number | undefined) ?? null,
        });
      }
      return { data: null, error: null };
    }
    throw new Error(`unexpected rpc ${name}`);
  };
  return { state, rpc };
});
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: db.rpc }) }));

/**
 * The heuristic (stub-mode) extractor: deterministic, regex-evidenced, and
 * shaped exactly like the model's tool output — so this suite also pins the
 * contract parseExtraction expects.
 */

const src = (text: string, extra?: Partial<NormalizedImportSource>): NormalizedImportSource => ({
  sourceType: "paste",
  text,
  images: [],
  ...extra,
});

describe("extractWithHeuristics", () => {
  it("reads the classic forum sale line", () => {
    const raw = extractWithHeuristics(
      src(
        "FS: IE intercooler mk7 golf r / gti. Used about 10k miles. Some bent fins but nothing bad. $450 shipped obo. Located Ft Lauderdale. Fits mk7 / mk7.5 MQB cars. PM me."
      )
    );
    const parsed = parseExtraction(raw);
    expect(parsed).not.toBeNull();
    expect(parsed?.isSalePost).toBe(true);
    expect(parsed?.priceCents).toBe(45000);
    expect(parsed?.shippingIncluded).toBe(true);
    expect(parsed?.acceptsOffers).toBe(true);
    expect(parsed?.condition).toBe("used");
    expect(parsed?.rawFitmentMentions.length).toBeGreaterThan(0);
  });

  it("detects BNIB as new and pickup language", () => {
    const parsed = parseExtraction(
      extractWithHeuristics(src("BNIB 034 dogbone insert, $60, local pickup only, Charlotte"))
    );
    expect(parsed?.condition).toBe("new");
    expect(parsed?.allowsCollection).toBe(true);
  });

  it("detects a multi-item part-out", () => {
    const parsed = parseExtraction(
      extractWithHeuristics(
        src(
          [
            "PART OUT — mk7 GTI",
            "APR intake - $250",
            "IE intercooler - $500",
            "034 dogbone insert - $60",
            "Neuspeed wheels - $1,200",
          ].join("\n")
        )
      )
    );
    expect(parsed?.multipleItems).toBe(true);
    expect(parsed?.items?.length).toBeGreaterThanOrEqual(4);
    expect(parsed?.items?.[0].label.toLowerCase()).toContain("apr intake");
  });

  it("prefers declared structured facts for price context", () => {
    const parsed = parseExtraction(
      extractWithHeuristics(
        src("APR turbo inlet for the EA888", {
          structuredFacts: { priceText: "$189.00", partNumber: "MS100141" },
        })
      )
    );
    expect(parsed?.priceCents).toBe(18900);
    expect(parsed?.partNumber).toBe("MS100141");
  });

  it("strips the FS: prefix from titles", () => {
    const parsed = parseExtraction(extractWithHeuristics(src("FS: Bilstein B16 coilovers $900")));
    expect(parsed?.title?.toLowerCase().startsWith("fs")).toBe(false);
    expect(parsed?.title).toContain("Bilstein");
  });

  it("does not mark a random paragraph as a sale post", () => {
    const parsed = parseExtraction(
      extractWithHeuristics(src("Went to the track today, car ran great, need new pads soon"))
    );
    expect(parsed?.isSalePost).toBe(false);
  });
});

// Readiness 78: every importer model call goes through the member's spend
// ledger — its worst case reserved before the call (refused over the cap),
// settled with what it really used after, a failed call included.
describe("extractListing spend", () => {
  const config: ImportConfig = { aiMode: "anthropic", model: DEFAULT_IMPORT_MODEL } as ImportConfig;
  const owner = "33333333-3333-4333-8333-333333333333";
  const answer = { isSalePost: true, multipleItems: false, rawFitmentMentions: [] };
  const reply = (usage = { input_tokens: 1200, output_tokens: 300 }) => ({
    stop_reason: "end_turn",
    usage,
    content: [{ type: "text", text: JSON.stringify(answer) }],
  });
  function ledger(result: SpendReservation) {
    return {
      reserve: vi.fn<SpendLedger["reserve"]>(async () => result),
      settle: vi.fn<SpendLedger["settle"]>(async () => {}),
    };
  }

  beforeEach(() => {
    db.state.holds.clear();
    db.state.usage.length = 0;
    db.state.memberCapUsd = 0.5;
  });

  it("asks for structured output, with no sampling parameters and no forced tool", async () => {
    const create = vi.fn(async () => reply());
    const outcome = await extractListing(src("FS: thing $100"), config, { ownerId: owner, spend: ledger({ ok: true, hold: "h" }), client: { messages: { create } } as never });
    expect(outcome).toEqual({ ok: true, raw: answer });
    const body = (create.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
    for (const sampling of ["temperature", "top_p", "top_k"]) expect(body).not.toHaveProperty(sampling);
    expect(body).not.toHaveProperty("tool_choice");
    expect(body).not.toHaveProperty("tools");
    expect(body.output_config).toEqual({ effort: "low", format: { type: "json_schema", schema: LISTING_OUTPUT_SCHEMA } });
  });

  it("closes every object in the output schema, as structured outputs require", () => {
    const open: string[] = [];
    const walk = (node: unknown, path: string) => {
      if (Array.isArray(node)) return node.forEach((child, i) => walk(child, `${path}[${i}]`));
      if (!node || typeof node !== "object") return;
      const schema = node as Record<string, unknown>;
      if (schema.type === "object" && schema.additionalProperties !== false) open.push(path || "(root)");
      for (const [key, child] of Object.entries(schema)) walk(child, `${path}.${key}`);
    };
    walk(LISTING_OUTPUT_SCHEMA, "");
    expect(open).toEqual([]);
  });

  it("treats a refusal or a cut-off answer as a failed extraction", async () => {
    for (const stop_reason of ["refusal", "max_tokens"]) {
      const create = vi.fn(async () => ({ ...reply(), stop_reason }));
      const outcome = await extractListing(src("FS: thing $100"), config, { ownerId: owner, spend: ledger({ ok: true, hold: "h" }), client: { messages: { create } } as never });
      expect(outcome).toEqual({ ok: false, code: "ai_failed" });
    }
  });

  it("never calls a model with no price, so no call goes uncounted", async () => {
    const create = vi.fn();
    const spend = ledger({ ok: true, hold: "h" });
    const outcome = await extractListing(src("FS: thing $100"), { aiMode: "anthropic", model: "claude-unpriced-1" } as ImportConfig, { ownerId: owner, spend, client: { messages: { create } } as never });
    expect(outcome).toEqual({ ok: false, code: "ai_unavailable" });
    expect(spend.reserve).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
    expect(importReserveUsd("claude-unpriced-1", "x")).toBeNull();
  });

  it("prices the default importer model", () => {
    expect(importReserveUsd(DEFAULT_IMPORT_MODEL, "x")).toBeGreaterThan(0);
  });

  it("stops at the cap through the real ledger: every settled call carries its cost", async () => {
    // 20,000 in and 1,000 out on Sonnet 5 is $0.05 a call; the member cap is $0.50.
    const create = vi.fn(async () => reply({ input_tokens: 20_000, output_tokens: 1_000 }));
    const outcomes: string[] = [];
    for (let i = 0; i < 30; i++) {
      const outcome = await extractListing(src("FS: thing $100"), config, { ownerId: owner, client: { messages: { create } } as never });
      outcomes.push(outcome.ok ? "ok" : outcome.code);
      if (!outcome.ok) break;
    }
    expect(outcomes.at(-1)).toBe("ai_spend_cap");
    const calls = create.mock.calls.length;
    expect(calls).toBeGreaterThan(0);
    expect(calls).toBeLessThanOrEqual(10);
    expect(db.state.usage).toHaveLength(calls);
    expect(db.state.usage.every((u) => u.feature === "listing_import" && typeof u.cost === "number" && u.cost > 0)).toBe(true);
    const spent = db.state.usage.reduce((total, u) => total + (u.cost ?? 0), 0);
    expect(spent).toBeLessThanOrEqual(db.state.memberCapUsd);
    // Every hold was swapped for its usage: nothing left counting twice.
    expect(db.state.holds.size).toBe(0);
  });

  it("refuses with ai_spend_cap before calling the model when the member is over today's cap", async () => {
    const create = vi.fn();
    const spend = ledger({ ok: false, reason: "spend_cap" });
    const outcome = await extractListing(src("FS: thing $100"), config, { ownerId: owner, spend, client: { messages: { create } } as never });
    expect(outcome).toEqual({ ok: false, code: "ai_spend_cap" });
    expect(create).not.toHaveBeenCalled();
    expect(spend.reserve).toHaveBeenCalledWith(owner, "listing_import", expect.any(Number));
    expect(spend.settle).not.toHaveBeenCalled();
  });

  it("reads a paused or suspended reservation as unavailable, never calling the model", async () => {
    for (const reason of ["paused", "suspended"] as const) {
      const create = vi.fn();
      const outcome = await extractListing(src("FS: thing $100"), config, { ownerId: owner, spend: ledger({ ok: false, reason }), client: { messages: { create } } as never });
      expect(outcome).toEqual({ ok: false, code: "ai_unavailable" });
      expect(create).not.toHaveBeenCalled();
    }
  });

  it("settles the hold with the call's usage against the importing member as listing_import", async () => {
    const create = vi.fn(async () => reply());
    const spend = ledger({ ok: true, hold: "hold-1" });
    const outcome = await extractListing(src("FS: thing $100"), config, { ownerId: owner, spend, client: { messages: { create } } as never });
    expect(outcome.ok).toBe(true);
    expect(spend.settle).toHaveBeenCalledWith(owner, "hold-1", expect.objectContaining({ feature: "listing_import", model: DEFAULT_IMPORT_MODEL, inputTokens: 1200, outputTokens: 300, taskId: null, costUsd: expect.any(Number) }));
  });

  it("settles the hold when the model call fails, so the hold never lingers", async () => {
    const create = vi.fn(async () => { throw new Error("overloaded"); });
    const outcome = await extractListing(src("FS: thing $100"), config, { ownerId: owner, spend: databaseLedger(), client: { messages: { create } } as never });
    expect(outcome).toEqual({ ok: false, code: "ai_failed" });
    expect(db.state.holds.size).toBe(0);
    expect(db.state.usage).toHaveLength(0);
  });

  it("holds more for a longer source", () => {
    expect(importReserveUsd("claude-sonnet-5-5", "x".repeat(30_000))!).toBeGreaterThan(importReserveUsd("claude-sonnet-5-5", "x")!);
    // A full answer is always held: 8,000 output tokens at least.
    expect(importReserveUsd("claude-sonnet-5-5", "x")!).toBeGreaterThanOrEqual((8_000 * 10) / 1_000_000);
  });

  it("costs nothing in stub mode, so the ledger isn't consulted", async () => {
    const spend = ledger({ ok: false, reason: "spend_cap" });
    const outcome = await extractListing(src("FS: thing $100"), { aiMode: "stub", model: "stub" } as ImportConfig, { ownerId: owner, spend });
    expect(outcome.ok).toBe(true);
    expect(spend.reserve).not.toHaveBeenCalled();
  });
});
