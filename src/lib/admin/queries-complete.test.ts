import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * N138: a failed read on the audit and member pages must not read as "no
 * actions recorded" or as a 404 — failed, empty and genuinely missing are
 * three different answers. N133: the Users filters are one database query
 * (admin_users_page), not 1,000 listing rows and a URL full of seller ids.
 */

type Result = { data?: unknown; count?: number | null; error: { message: string } | null };

const state = vi.hoisted(() => ({
  tables: {} as Record<string, Result>,
  rpc: vi.fn(),
  fromCalls: [] as string[],
}));

vi.mock("server-only", () => ({}));
vi.mock("./guard", () => ({
  adminReadClient: async () => ({
    rpc: state.rpc,
    from: (table: string) => {
      state.fromCalls.push(table);
      const result = state.tables[table] ?? { data: [], count: 0, error: null };
      const builder: Record<string, unknown> = {};
      for (const m of ["select", "eq", "neq", "lt", "gte", "in", "is", "not", "order", "limit", "range", "ilike", "or"]) builder[m] = () => builder;
      builder.maybeSingle = async () => result;
      builder.then = (resolve: (value: Result) => unknown) => resolve(result);
      return builder;
    },
  }),
  requireAdminRead: async () => ({ userId: "admin-1", role: "admin" }),
}));
vi.mock("@/lib/monitoring", () => ({ reportError: vi.fn() }));
vi.mock("@/lib/evidence-urls", () => ({ signEvidenceUrls: vi.fn() }));

import { getAuditLog, getUserDetail, searchUsers } from "./queries";

const ID = "6f1c2b9e-1a2b-4c3d-8e9f-0a1b2c3d4e5f";
const profile = {
  id: ID, username: "kaito", display_name: "Kaito", profile_type: "member", created_at: "2026-09-01T00:00:00Z",
  suspended_at: null, suspended_reason: null, payouts_enabled: false, stripe_account_id: null,
};

beforeEach(() => {
  state.tables = {};
  state.fromCalls = [];
  state.rpc.mockReset();
});

describe("member detail (N138)", () => {
  it("throws when the member can't be read, instead of saying they don't exist", async () => {
    state.tables.profiles = { data: null, error: { message: "timeout" } };
    await expect(getUserDetail(ID)).rejects.toThrow("Couldn't load this member");
  });

  it("is null only when the member genuinely isn't there", async () => {
    state.tables.profiles = { data: null, error: null };
    await expect(getUserDetail(ID)).resolves.toBeNull();
  });

  it("throws when part of the sheet fails, instead of showing none", async () => {
    state.tables.profiles = { data: profile, error: null };
    state.tables.admin_audit_log = { data: null, error: { message: "timeout" } };
    await expect(getUserDetail(ID)).rejects.toThrow("Couldn't load their admin history");
  });

  it("reads a member with an empty history as empty", async () => {
    state.tables.profiles = { data: profile, error: null };
    const detail = await getUserDetail(ID);
    expect(detail?.adminHistory).toEqual([]);
    expect(detail?.purchases).toEqual([]);
  });
});

describe("audit log (N138, paged actor filter)", () => {
  it("throws on a failed read, never 'No actions recorded'", async () => {
    state.rpc.mockResolvedValue({ data: null, error: { message: "timeout" } });
    await expect(getAuditLog()).rejects.toThrow("Couldn't load the audit log");
  });

  it("an empty log is an empty page", async () => {
    state.rpc.mockResolvedValue({ data: [], error: null });
    await expect(getAuditLog()).resolves.toMatchObject({ rows: [], hasMore: false });
  });

  it("sends the actor's name to the database's paged query, never a list of ids", async () => {
    state.rpc.mockResolvedValue({ data: [], error: null });
    await getAuditLog({ actorQuery: "  dana ", action: "order.", page: 3 });
    expect(state.rpc).toHaveBeenCalledWith("admin_audit_page", expect.objectContaining({ p_actor: "dana", p_action: "order.", p_offset: 150, p_limit: 51 }));
    expect(state.fromCalls).not.toContain("admin_audit_log");
  });
});

describe("Users filters (N133)", () => {
  it("asks the database for the Sellers page, with no capped listing or order fetch", async () => {
    state.rpc.mockResolvedValue({
      data: {
        total: 1050,
        rows: [{ id: ID, username: "kaito", display_name: "Kaito", profile_type: "member", created_at: "2026-09-01T00:00:00Z",
          suspended_at: null, suspended_reason: null, payouts_enabled: false, listing_count: 3, sale_count: 2, dispute_count: 1, is_admin: false }],
      },
      error: null,
    });
    const result = await searchUsers("kai", "no_payouts", 19);
    expect(state.rpc).toHaveBeenCalledWith("admin_users_page", { p_query: "kai", p_state: "no_payouts", p_offset: 950, p_limit: 50 });
    expect(state.fromCalls).toEqual([]);
    expect(result).toMatchObject({ total: 1050, page: 19, hasMore: true });
    expect(result.rows[0]).toMatchObject({ listingCount: 3, saleCount: 2, disputeCount: 1, payoutsEnabled: false });
  });

  it("throws when the page can't be read", async () => {
    state.rpc.mockResolvedValue({ data: null, error: { message: "timeout" } });
    await expect(searchUsers("", "sellers")).rejects.toThrow("Couldn't load users");
  });
});
