import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * N133: the finance CSV exports asked for 5,000 rows and PostgREST sent the
 * first 1,000; the name lookups put every id in one URL. Now each export
 * reads keyset pages (500 at a time, under the 1,000-row cap) until a short
 * page, joins names in the database or looks them up in short chunks, and
 * is complete, refused, or an error — never quietly cut short.
 */

type Row = { id: string; sort_at: string } & Record<string, unknown>;

const state = vi.hoisted(() => ({
  orders: [] as Row[],
  audit: [] as { id: number; actor_id: string; created_at: string; action: string; subject_type: string; subject_id: string; order_id: string | null; reason: string; metadata: unknown }[],
  rpcCalls: [] as Record<string, unknown>[],
  auditPages: 0,
  auditCalls: [] as Record<string, unknown>[],
  profileLookups: [] as number[],
  failOnOrdersPage: 0,
}));

function profilesBuilder() {
  const builder: Record<string, unknown> = {};
  builder.select = () => builder;
  builder.in = (_column: string, ids: string[]) => {
    state.profileLookups.push(ids.length);
    return Promise.resolve({ data: ids.map((id) => ({ id, username: `u${id}`, display_name: `Admin ${id}` })), error: null });
  };
  return builder;
}

const client = {
  rpc: async (name: string, args: Record<string, unknown>) => {
    if (name === "admin_export_orders") {
      state.rpcCalls.push(args);
      if (state.failOnOrdersPage && state.rpcCalls.length === state.failOnOrdersPage) {
        return { data: null, error: { message: "statement timeout" } };
      }
      const after = args.p_after_id
        ? state.orders.findIndex((r) => r.id === args.p_after_id && r.sort_at === args.p_after_at) + 1
        : 0;
      // Like PostgREST: never more than 1,000 rows, whatever was asked.
      return { data: state.orders.slice(after, after + Math.min(Number(args.p_limit), 1000)), error: null };
    }
    if (name === "admin_audit_page") {
      state.auditPages += 1;
      state.auditCalls.push(args);
      // The database filters by actor name itself; this fixture's actors are
      // all named "Admin actor-N", so "nobody" matches none.
      const named = args.p_actor === "nobody" ? [] : state.audit;
      const rows = named.filter((r) => args.p_before_id == null || r.id < Number(args.p_before_id));
      return { data: rows.slice(Number(args.p_offset ?? 0)).slice(0, Math.min(Number(args.p_limit), 1000)), error: null };
    }
    return { data: null, error: { message: `unexpected rpc ${name}` } };
  },
  from: () => profilesBuilder(),
};

vi.mock("@/lib/admin/guard", () => ({
  getAdminContext: async () => ({ userId: "admin-1", role: "admin" }),
  requireAdminRead: async () => ({ userId: "admin-1", role: "admin" }),
  adminReadClient: async () => client,
}));
vi.mock("@/lib/monitoring", () => ({ reportError: vi.fn() }));
vi.mock("@/lib/evidence-urls", () => ({ signEvidenceUrls: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => client }));

const { GET } = await import("./route");
const { exportOrderRows, ExportTooLargeError } = await import("@/lib/admin/queries");

const pad = (n: number) => String(n).padStart(12, "0");

function seedOrders(count: number) {
  // Newest first, 100 sharing each timestamp: the cursor needs the id too.
  state.orders = Array.from({ length: count }, (_, i) => ({
    id: `00000000-0000-4000-8000-${pad(count - i)}`,
    sort_at: new Date(Date.UTC(2026, 9, 1) + Math.floor((count - i) / 100) * 1000).toISOString(),
    created_at: "2026-10-01T00:00:00Z",
    status: "paid",
    title: i === 0 ? "=HYPERLINK(evil)" : "Turbo",
    buyer_id: "b1",
    buyer_username: "buyer",
    buyer_display_name: "Buyer One",
    seller_id: "s1",
    seller_username: "seller",
    seller_display_name: null,
    total_cents: 1000,
    refunded_cents: 0,
    currency: "USD",
    transferred: false,
  }));
}

beforeEach(() => {
  state.rpcCalls = [];
  state.auditPages = 0;
  state.auditCalls = [];
  state.profileLookups = [];
  state.failOnOrdersPage = 0;
  seedOrders(2500);
  state.audit = Array.from({ length: 1700 }, (_, i) => ({
    id: 1700 - i,
    actor_id: `actor-${i % 250}`,
    created_at: "2026-10-01T00:00:00Z",
    action: "order.force_refund",
    subject_type: "order",
    subject_id: "o1",
    order_id: null,
    reason: "audit",
    metadata: {},
  }));
});

describe("orders export (N133)", () => {
  it("exports all 2,500 orders, past the 1,000-row cap, each exactly once", async () => {
    const response = await GET(new Request("https://drvn.test/admin/export?view=orders"));
    expect(response.status).toBe(200);
    expect(response.headers.get("x-drvn-export-rows")).toBe("2500");
    const lines = (await response.text()).split("\n");
    expect(lines).toHaveLength(2501);
    const ids = lines.slice(1).map((line) => line.split(",")[0]);
    expect(new Set(ids).size).toBe(2500);
    expect(ids).toEqual(state.orders.map((r) => r.id));
    // Names come from the database join, not a URL full of ids.
    expect(lines[1]).toContain("Buyer One");
    expect(lines[1]).toContain("@seller");
    // Formula injection still neutralised.
    expect(lines[1]).toContain("'=HYPERLINK(evil)");
  });

  it("pages with a keyset cursor taken from each page's last row", async () => {
    await GET(new Request("https://drvn.test/admin/export?view=orders&q=Buyer%20One&status=paid"));
    expect(state.rpcCalls).toHaveLength(6); // 5 full pages of 500, then an empty one
    expect(state.rpcCalls[0]).toMatchObject({ p_view: "orders", p_query: "Buyer One", p_status: "paid", p_limit: 500 });
    expect(state.rpcCalls[0].p_after_id).toBeUndefined();
    expect(state.rpcCalls[1]).toMatchObject({ p_after_id: state.orders[499].id, p_after_at: state.orders[499].sort_at });
  });

  it("answers an error instead of a partial file when a page fails", async () => {
    state.failOnOrdersPage = 3;
    const response = await GET(new Request("https://drvn.test/admin/export?view=orders"));
    expect(response.status).toBe(503);
    expect(response.headers.get("content-disposition")).toBeNull();
    expect(await response.text()).toMatch(/no file was made/);
  });

  it("refuses an export past the limit rather than cutting it short", async () => {
    await expect(exportOrderRows("orders", {}, 1200)).rejects.toBeInstanceOf(ExportTooLargeError);
  });

  it("exports disputes through the same complete reader", async () => {
    const response = await GET(new Request("https://drvn.test/admin/export?view=disputes&scope=resolved&category=wrong_item"));
    expect(response.headers.get("x-drvn-export-rows")).toBe("2500");
    expect(state.rpcCalls[0]).toMatchObject({ p_view: "disputes_resolved", p_category: "wrong_item" });
  });
});

describe("audit export (N133)", () => {
  it("exports all 1,700 audit rows and looks up 250 actors in short chunks", async () => {
    const response = await GET(new Request("https://drvn.test/admin/export?view=audit"));
    expect(response.status).toBe(200);
    expect(response.headers.get("x-drvn-export-rows")).toBe("1700");
    const lines = (await response.text()).split("\n");
    expect(lines).toHaveLength(1701);
    expect(state.auditPages).toBe(4); // 500 + 500 + 500 + 200
    expect(Math.max(...state.profileLookups)).toBeLessThanOrEqual(100);
    expect(state.profileLookups.reduce((a, b) => a + b, 0)).toBe(250);
    expect(lines[1]).toContain("Admin actor-0");
  });

  it("filters by actor name in the database: 1,000 matching actors never become an id list", async () => {
    state.audit = state.audit.map((r, i) => ({ ...r, actor_id: `actor-${i % 1000}` }));
    const response = await GET(new Request("https://drvn.test/admin/export?view=audit&actor=Admin"));
    expect(response.headers.get("x-drvn-export-rows")).toBe("1700");
    expect(state.auditCalls[0]).toMatchObject({ p_actor: "Admin", p_limit: 500 });
    expect(state.auditCalls[1]).toMatchObject({ p_before_id: 1201, p_before_at: "2026-10-01T00:00:00Z" });
    for (const call of state.auditCalls) expect(JSON.stringify(call).length).toBeLessThan(500);
    // Names for the file are looked up in chunks of 100 or fewer.
    expect(Math.max(...state.profileLookups)).toBeLessThanOrEqual(100);
    expect(state.profileLookups.reduce((a, b) => a + b, 0)).toBe(1000);
  });

  it("an actor search that matches no one exports an empty file, not everyone", async () => {
    const response = await GET(new Request("https://drvn.test/admin/export?view=audit&actor=nobody"));
    expect(response.headers.get("x-drvn-export-rows")).toBe("0");
    expect(state.auditCalls[0]).toMatchObject({ p_actor: "nobody" });
  });
});
