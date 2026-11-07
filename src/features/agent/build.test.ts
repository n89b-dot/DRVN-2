import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * N124 (OS-W07): Confirm on an "Update my build" card saves exactly the
 * proposal the card showed. The stored draft is read as the member; if the
 * link it would save isn't the one the card named, nothing is saved.
 */
const state = vi.hoisted(() => ({ cards: [] as unknown[], saved: [] as unknown[] }));

vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ capture: vi.fn() }));
vi.mock("@/app/(product)/garage/actions", () => ({
  saveModItems: vi.fn(async (_car: string, items: unknown[]) => (state.saved.push(...items), {})),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "22222222-2222-4222-8222-222222222222" } } }) },
    from(table: string) {
      const query = {
        select: () => query,
        eq: () => query,
        contains: () => query,
        order: () => Promise.resolve({ data: [], error: null }),
        limit: () => Promise.resolve({ data: table === "agent_messages" ? [{ cards: state.cards }] : [], error: null }),
        maybeSingle: () => Promise.resolve({ data: table === "cars" ? { id: CAR } : null, error: null }),
      };
      return query;
    },
  }),
}));

const CAR = "33333333-3333-4333-8333-333333333333";
const ID = "55555555-5555-4555-8555-555555555555";
const LINK = "https://www.kwsuspensions.com/en/products/v3-coilovers";
const draft = (product_url: string | null) => ({ kind: "build_change", id: ID, car: CAR, replaces: null, brand: "KW", product: "V3 coilovers", part_number: null, category: "suspension", product_url, image_url: null });

const { confirmBuildChange } = await import("./build");

describe("confirmBuildChange", () => {
  beforeEach(() => {
    state.saved = [];
  });

  it("saves the link the card showed", async () => {
    state.cards = [draft(LINK)];
    expect(await confirmBuildChange(ID, { productUrl: LINK })).toMatchObject({ ok: "Saved to your build." });
    expect(state.saved).toEqual([expect.objectContaining({ id: ID, product_url: LINK })]);
  });

  it("saves nothing when the card showed a different link, or none", async () => {
    state.cards = [draft(LINK)];
    for (const shown of [{ productUrl: "https://parts-deals.example.net/kw" }, { productUrl: null }, undefined]) {
      const result = await confirmBuildChange(ID, shown);
      expect(result.error).toBe("That change isn't the one shown. Reload to see it again.");
    }
    expect(state.saved).toEqual([]);
  });

  it("an older draft holding an unsafe link saves without it, as its card showed", async () => {
    state.cards = [draft("javascript:alert(1)")];
    expect(await confirmBuildChange(ID, { productUrl: "javascript:alert(1)" })).toMatchObject({ error: expect.any(String) });
    expect(await confirmBuildChange(ID, { productUrl: null })).toMatchObject({ ok: "Saved to your build." });
    expect(state.saved).toEqual([expect.objectContaining({ id: ID, product_url: null })]);
  });
});
