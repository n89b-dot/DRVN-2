import { describe, expect, it, vi } from "vitest";

import type { SpendLedger } from "@/lib/ai/spend";

import type { ImportConfig } from "../config";
import type { NormalizedImportSource } from "../schema";
import { parseExtraction } from "../schema";
import { extractListing, extractWithHeuristics } from "./ai";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => { throw new Error("the ledger is injected in these tests"); } }));

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
// ledger — refused before the call when over the cap, recorded after it.
describe("extractListing spend", () => {
  const config: ImportConfig = { aiMode: "anthropic", model: "claude-test-1" } as ImportConfig;
  const owner = "33333333-3333-4333-8333-333333333333";
  const reply = {
    usage: { input_tokens: 1200, output_tokens: 300 },
    content: [{ type: "tool_use", id: "t1", name: "record_listing_extraction", input: { isSalePost: true, multipleItems: false, rawFitmentMentions: [] } }],
  };
  function ledger(allowed: boolean): SpendLedger & { recorded: unknown[] } {
    const recorded: unknown[] = [];
    return { recorded, allowed: vi.fn(async () => allowed), record: vi.fn(async (_owner, usage) => { recorded.push(usage); }) };
  }

  it("refuses with ai_spend_cap before calling the model when the member is over today's cap", async () => {
    const create = vi.fn();
    const spend = ledger(false);
    const outcome = await extractListing(src("FS: thing $100"), config, { ownerId: owner, spend, client: { messages: { create } } as never });
    expect(outcome).toEqual({ ok: false, code: "ai_spend_cap" });
    expect(create).not.toHaveBeenCalled();
    expect(spend.allowed).toHaveBeenCalledWith(owner);
  });

  it("records the call's usage against the importing member as listing_import", async () => {
    const create = vi.fn(async () => reply);
    const spend = ledger(true);
    const outcome = await extractListing(src("FS: thing $100"), config, { ownerId: owner, spend, client: { messages: { create } } as never });
    expect(outcome.ok).toBe(true);
    expect(spend.record).toHaveBeenCalledWith(owner, expect.objectContaining({ feature: "listing_import", model: "claude-test-1", inputTokens: 1200, outputTokens: 300, taskId: null }));
  });

  it("costs nothing in stub mode, so the ledger isn't consulted", async () => {
    const spend = ledger(false);
    const outcome = await extractListing(src("FS: thing $100"), { aiMode: "stub", model: "stub" } as ImportConfig, { ownerId: owner, spend });
    expect(outcome.ok).toBe(true);
    expect(spend.allowed).not.toHaveBeenCalled();
  });
});
