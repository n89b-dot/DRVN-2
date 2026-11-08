import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it, vi } from "vitest";

/**
 * OS-W07 review follow-ups (Codex on #94):
 *  - P1: a pasted page's canonical metadata can name any address. A build
 *    link's provenance is the member's own address or where DRVN's checked
 *    fetch landed, never the page's canonical claim.
 *  - P2: a tool name the model made up is recorded as unknown_tool, and the
 *    audit keeps only known id keys; the SQL function holds the same lists.
 */

const PASTED = "https://kws.ly/v3";
const LANDED = "https://www.kwsuspensions.com/en/products/v3-coilovers";
const CANONICAL = "https://parts-deals.example.net/collect?session=1";

vi.mock("@/lib/rate-limit", () => ({ RATE_LIMITS: { fetchPartLink: {} }, allowAction: async () => true }));
vi.mock("@/lib/mods/part-link", () => ({
  fetchPartLink: async () => ({
    ok: true,
    // The member's short link redirected here; the page claims the attacker's address as canonical.
    fetched_url: LANDED,
    product_url: CANONICAL,
    source_domain: "parts-deals.example.net",
    title: "KW V3 coilovers",
    brand: "KW",
    product: "V3 coilovers",
    part_number: "35210000",
    category: "suspension",
    image_url: null,
    ref_price_cents: null,
    ref_price_currency: null,
  }),
}));

const { modelContext } = await import("@/lib/agent/context");
const { resolveAiConfig } = await import("./config");
const { AUDIT_ID_KEYS, runAgentTurn, toolCallIds } = await import("./run");
const { openLedger } = await import("./spend");
const { CAPABILITIES } = await import("@/lib/capabilities/registry");

type MemberClient = import("@/lib/capabilities/types").MemberClient;

const OWNER = "22222222-2222-4222-8222-222222222222";
const CAR = { id: "33333333-3333-4333-8333-333333333333", name: "Mk8 Golf R" };
const config = { ...resolveAiConfig({ NODE_ENV: "test", ANTHROPIC_API_KEY: "test" }), mode: "anthropic" as const };
const notHalted = async () => false;

function garage(): MemberClient {
  const query = {
    select: () => query,
    eq: () => query,
    in: () => query,
    order: () => query,
    limit: () => Promise.resolve({ data: [CAR], error: null }),
    maybeSingle: () => Promise.resolve({ data: CAR, error: null }),
  };
  return { from: () => query, rpc: () => Promise.resolve({ data: [], error: null }) } as unknown as MemberClient;
}

/** A model that calls each scripted tool in turn (whether or not it was offered), then answers. */
function scripted(script: { tool: string; input: unknown }[]) {
  const results: string[] = [];
  let next = 0;
  const client = {
    beta: {
      messages: {
        async create(params: { messages: { content: unknown }[] }) {
          const last = params.messages.at(-1)!;
          if (Array.isArray(last.content)) for (const block of last.content as { type: string; content?: unknown }[]) if (block.type === "tool_result") results.push(String(block.content));
          if (next < script.length) {
            const step = script[next++];
            return { content: [{ type: "tool_use", id: `toolu_${next}`, name: step.tool, input: step.input }], stop_reason: "tool_use", usage: { input_tokens: 10, output_tokens: 5 } };
          }
          return { content: [{ type: "text", text: "Done." }], stop_reason: "end_turn", usage: { input_tokens: 10, output_tokens: 5 } };
        },
      },
    },
  };
  return { client: client as unknown as NonNullable<Parameters<typeof runAgentTurn>[0]["client"]>, results };
}

const brief = (calls: readonly { name: string; ok: boolean; code?: string }[]) => calls.map(({ name, ok, code }) => (code ? { name, ok, code } : { name, ok }));

describe("build link provenance (P1)", () => {
  it("read_part_link hands the model the page DRVN fetched, not the page's canonical claim", async () => {
    const { client, results } = scripted([{ tool: "read_part_link", input: { url: PASTED } }]);
    await runAgentTurn({ context: modelContext(OWNER, "buyer"), supabase: garage(), message: `fitted these: ${PASTED}`, client, config, spend: openLedger, halted: notHalted });
    expect(results[0]).toContain(LANDED);
    expect(results[0]).not.toContain("parts-deals");
  });

  it("a canonical address the member never gave or visited can't go on the build", async () => {
    const { client } = scripted([
      { tool: "read_part_link", input: { url: PASTED } },
      { tool: "propose_build_change", input: { carId: CAR.id, product: "V3 coilovers", productUrl: CANONICAL } },
      { tool: "propose_build_change", input: { carId: CAR.id, product: "V3 coilovers", productUrl: LANDED } },
    ]);
    const result = await runAgentTurn({ context: modelContext(OWNER, "buyer"), supabase: garage(), message: `fitted these: ${PASTED}`, client, config, spend: openLedger, halted: notHalted });
    expect(brief(result.toolCalls)).toEqual([{ name: "read_part_link", ok: true }, { name: "propose_build_change", ok: false, code: "not_allowed" }, { name: "propose_build_change", ok: true }]);
    // Where the member's own link really led is fine: DRVN fetched it, through the guard.
    expect(result.ok && result.cards).toEqual([expect.objectContaining({ kind: "build_change", product_url: LANDED })]);
  });
});

describe("audit vocabulary (P2)", () => {
  it("a tool the model made up is recorded as unknown_tool, never under its own name", async () => {
    const { client } = scripted([{ tool: "password_huntertwo", input: {} }]);
    const result = await runAgentTurn({ context: modelContext(OWNER, "buyer"), supabase: garage(), message: "hi", client, config, spend: openLedger, halted: notHalted });
    expect(result.toolCalls).toEqual([{ name: "unknown_tool", ok: false, code: "not_allowed", ms: 0, ids: {} }]);
    expect(JSON.stringify(result.toolCalls)).not.toContain("hunter");
  });

  it("keeps only known id keys, whatever keys the model wrote", () => {
    const id = "55555555-5555-4555-8555-555555555555";
    expect(toolCallIds({ listingId: id, passwordHuntertwoId: id, carId: "not-a-uuid", modIds: [id, "x"] }, { proposalId: id })).toEqual({ listingId: id, modIds: [id], proposalId: id });
  });

  it("the database's lists are the app's: every capability, unknown_tool, and the same id keys", () => {
    const sql = readFileSync(fileURLToPath(new URL("../../../supabase/migrations/20261107210200_agent_tool_audit.sql", import.meta.url)), "utf8");
    const list = (name: string) => {
      const match = sql.match(new RegExp(`when '${name}' then array\\[([^\\]]*)\\]`));
      expect(match, name).not.toBeNull();
      return [...match![1].matchAll(/'([^']+)'/g)].map((m) => m[1]).sort();
    };
    expect(list("tool")).toEqual([...CAPABILITIES.map((capability) => capability.name), "unknown_tool"].sort());
    expect(list("id_key")).toEqual([...AUDIT_ID_KEYS].sort());
    expect(list("code")).toEqual(["failed", "invalid_input", "invalid_output", "not_allowed", "stopped"]);
  });
});
