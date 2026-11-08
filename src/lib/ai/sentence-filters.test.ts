import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { anthropicClient } from "./client";
import { resolveAiConfig } from "./config";
import { FILTERS_SCHEMA, filtersFromAnswer, filtersReserveUsd, sentenceToFilters } from "./sentence-filters";
import type { SpendLedger } from "./spend";
import type { UsageRecord } from "./usage";

/**
 * Sentence to filters (OS-W07): the default agent model rejects a forced
 * tool_choice with a 400, so the call asks for structured output instead.
 * These run the real SDK against a fake `fetch` and check the HTTP body that
 * would leave for the provider. No network.
 */

const OWNER = "22222222-2222-4222-8222-222222222222";
const config = { ...resolveAiConfig({ NODE_ENV: "test", ANTHROPIC_API_KEY: "test" }), mode: "anthropic" as const };
const notHalted = async () => false;

function provider(answer: { status?: number; text?: string; stop_reason?: string }) {
  const bodies: Record<string, unknown>[] = [];
  const fetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body ?? "{}")));
    if (answer.status && answer.status !== 200) {
      return new Response(JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: "fixture" } }), {
        status: answer.status,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(
      JSON.stringify({
        id: "msg_fixture",
        type: "message",
        role: "assistant",
        model: config.model,
        content: [{ type: "text", text: answer.text ?? "{}" }],
        stop_reason: answer.stop_reason ?? "end_turn",
        stop_sequence: null,
        usage: { input_tokens: 300, output_tokens: 40 },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  });
  return { fetch, bodies };
}

function ledger() {
  const reserved: number[] = [];
  const settled: UsageRecord[] = [];
  const spend: SpendLedger = {
    reserve: async (_owner, _feature, amount) => {
      reserved.push(amount);
      return { ok: true, hold: "hold-1" };
    },
    settle: async (_owner, _hold, usage) => void settled.push(usage),
  };
  return { spend, reserved, settled };
}

let previousKey: string | undefined;
beforeEach(() => {
  previousKey = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = "test-key";
});
afterEach(() => {
  process.env.ANTHROPIC_API_KEY = previousKey;
});

describe("sentenceToFilters request (OS-W07)", () => {
  it("asks for structured output, with no forced tool_choice, no tools and no sampling parameters", async () => {
    const { fetch, bodies } = provider({ text: JSON.stringify({ words: "coilovers e46", condition: "used", max_dollars: 500 }) });
    const client = await anthropicClient({ fetch });
    const { spend } = ledger();
    const result = await sentenceToFilters({ ownerId: OWNER, sentence: "used coilovers for an E46 under $500", client, config, spend, halted: notHalted });

    expect(result.ok).toBe(true);
    expect(bodies).toHaveLength(1);
    const body = bodies[0];
    expect(body).not.toHaveProperty("tool_choice");
    expect(body).not.toHaveProperty("tools");
    for (const sampling of ["temperature", "top_p", "top_k"]) expect(body).not.toHaveProperty(sampling);
    expect(body).not.toHaveProperty("thinking");
    expect(body.output_config).toEqual({ effort: "low", format: { type: "json_schema", schema: JSON.parse(JSON.stringify(FILTERS_SCHEMA)) } });
    expect(body.model).toBe("claude-opus-5-5");
  });

  it("closes every object in the schema and sends no numeric bounds, as structured outputs require", () => {
    const open: string[] = [];
    const bounds: string[] = [];
    const walk = (node: unknown, path: string) => {
      if (Array.isArray(node)) return node.forEach((child, i) => walk(child, `${path}[${i}]`));
      if (!node || typeof node !== "object") return;
      const schema = node as Record<string, unknown>;
      if (schema.type === "object" && schema.additionalProperties !== false) open.push(path || "(root)");
      for (const key of ["minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf", "minLength", "maxLength"]) if (key in schema) bounds.push(`${path}.${key}`);
      for (const [key, child] of Object.entries(schema)) walk(child, `${path}.${key}`);
    };
    walk(FILTERS_SCHEMA, "");
    expect(open).toEqual([]);
    expect(bounds).toEqual([]);
  });

  it("turns the JSON answer into the Marketplace's own filters, dropping anything off its vocabulary", async () => {
    const { fetch } = provider({ text: JSON.stringify({ words: "kw v3", category: "not-a-category", condition: "used", min_dollars: 100, max_dollars: 900 }) });
    const client = await anthropicClient({ fetch });
    const result = await sentenceToFilters({ ownerId: OWNER, sentence: "used kw v3 between 100 and 900 dollars", client, config, spend: ledger().spend, halted: notHalted });
    expect(result).toMatchObject({ ok: true, filters: { q: "kw v3", condition: "used", min: "100", max: "900" } });
    if (result.ok) expect(result.filters.category).toBeUndefined();
    expect(filtersFromAnswer(null)).toEqual(filtersFromAnswer({}));
  });

  it("treats a refusal, a cut-off answer or broken JSON as no filters, and still settles what it used", async () => {
    for (const reply of [{ stop_reason: "refusal", text: "" }, { stop_reason: "max_tokens", text: '{"words":"co' }, { text: "not json" }]) {
      const { fetch } = provider(reply);
      const client = await anthropicClient({ fetch });
      const { spend, settled } = ledger();
      const result = await sentenceToFilters({ ownerId: OWNER, sentence: "used coilovers", client, config, spend, halted: notHalted });
      expect(result).toEqual({ ok: false, code: "nothing" });
      expect(settled).toHaveLength(1);
      expect(settled[0]).toMatchObject({ inputTokens: 300, outputTokens: 40 });
    }
  });

  it("keeps #79's spend rules: one attempt, a refused request costs nothing, an unknown outcome is charged its reservation", async () => {
    const rejected = provider({ status: 400 });
    const one = ledger();
    const r1 = await sentenceToFilters({ ownerId: OWNER, sentence: "used coilovers", client: await anthropicClient({ fetch: rejected.fetch }), config, spend: one.spend, halted: notHalted });
    expect(r1).toEqual({ ok: false, code: "model_error" });
    expect(rejected.fetch).toHaveBeenCalledTimes(1);
    expect(one.settled[0].costUsd ?? 0).toBe(0);

    const failed = provider({ status: 500 });
    const two = ledger();
    const r2 = await sentenceToFilters({ ownerId: OWNER, sentence: "used coilovers", client: await anthropicClient({ fetch: failed.fetch }), config, spend: two.spend, halted: notHalted });
    expect(r2).toEqual({ ok: false, code: "model_error" });
    // maxRetries: 0 on the request: the client's own retry never runs.
    expect(failed.fetch).toHaveBeenCalledTimes(1);
    expect(two.reserved).toEqual([filtersReserveUsd(config.model)]);
    expect(two.settled[0].costUsd).toBeCloseTo(filtersReserveUsd(config.model), 10);
  });
});
