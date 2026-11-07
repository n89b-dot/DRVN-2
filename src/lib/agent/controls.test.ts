import { beforeEach, describe, expect, it, vi } from "vitest";

const admin = vi.hoisted(() => ({ answer: { data: [] as unknown[] | null, error: null as { code: string } | null }, throws: false, filters: [] as string[] }));

vi.mock("@/lib/monitoring", () => ({ reportError: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    if (admin.throws) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set");
    const query = {
      select: () => query,
      is: () => query,
      or: (filter: string) => (admin.filters.push(filter), query),
      limit: () => Promise.resolve(admin.answer),
    };
    return { from: () => query };
  },
}));

import { agentModelHalted } from "./controls";

const OWNER = "22222222-2222-4222-8222-222222222222";

/** Readiness report two, 66: a switch that can't be read stops the model. */
describe("the kill switches that reach the model", () => {
  beforeEach(() => {
    admin.answer = { data: [], error: null };
    admin.throws = false;
    admin.filters = [];
  });

  it("runs when no switch names the member or everyone", async () => {
    expect(await agentModelHalted(OWNER)).toBe(false);
    expect(admin.filters[0]).toContain("scope.eq.all");
    expect(admin.filters[0]).toContain(`subject_id.eq.${OWNER}`);
  });

  it("stops when one does", async () => {
    admin.answer = { data: [{ scope: "all" }], error: null };
    expect(await agentModelHalted(OWNER)).toBe(true);
  });

  it("stops when the switches can't be read, or there is no client to read them with", async () => {
    admin.answer = { data: null, error: { code: "PGRST301" } };
    expect(await agentModelHalted(OWNER)).toBe(true);
    admin.throws = true;
    expect(await agentModelHalted(OWNER)).toBe(true);
  });

  it("stops for an id that isn't a member id, rather than build a filter from it", async () => {
    expect(await agentModelHalted("x,scope.eq.none")).toBe(true);
    expect(admin.filters).toEqual([]);
  });
});
