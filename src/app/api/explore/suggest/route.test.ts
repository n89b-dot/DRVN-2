import { beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({
  allowed: true,
  address: "203.0.113.9" as string | null,
  calls: [] as { action: string; subject: string }[],
  searches: 0,
  clients: 0,
}));

vi.mock("@/lib/rate-limit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/rate-limit")>();
  return {
    RATE_LIMITS: actual.RATE_LIMITS,
    allowAction: async (rule: { action: string }, subject: string) => {
      fixture.calls.push({ action: rule.action, subject });
      return fixture.allowed;
    },
  };
});
vi.mock("@/lib/abuse-identity", () => ({
  attributedNetworkIdentity: () => (fixture.address ? `network:${fixture.address}` : null),
  abuseIdentity: () => (fixture.address ? `network:${fixture.address}` : "network:unattributed"),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => {
    fixture.clients += 1;
    return { from: () => { throw new Error("no rows needed"); } };
  },
}));
vi.mock("@/lib/explore/search/provider", () => ({
  getExploreSearchProvider: () => ({ searchIds: async () => { fixture.searches += 1; return []; } }),
}));
vi.mock("@/lib/explore/search/query", () => ({ searchAccounts: async () => { fixture.searches += 1; return []; } }));
vi.mock("@/lib/marketplace/search/provider", () => ({
  getSearchProvider: () => ({ searchIds: async () => { fixture.searches += 1; return []; } }),
}));

import { GET } from "./route";

const ask = (q: string) => GET(new Request(`http://localhost/api/explore/suggest?q=${encodeURIComponent(q)}`));

beforeEach(() => {
  fixture.allowed = true;
  fixture.address = "203.0.113.9";
  fixture.calls = [];
  fixture.searches = 0;
  fixture.clients = 0;
});

describe("explore suggest throttling (N27)", () => {
  it("runs the four searches for a visitor within the limit", async () => {
    const response = await ask("coilovers");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ q: "coilovers", groups: [] });
    expect(fixture.calls).toEqual([{ action: "search-suggest", subject: "network:203.0.113.9" }]);
    expect(fixture.searches).toBe(4);
  });

  it("refuses an over-limit visitor with a controlled 429 before any query", async () => {
    fixture.allowed = false;
    const response = await ask("coilovers");
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("60");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ q: "coilovers", groups: [], limited: true });
    expect(fixture.clients).toBe(0);
    expect(fixture.searches).toBe(0);
  });

  it("puts visitors with no trusted address under one shared ceiling", async () => {
    fixture.address = null;
    await ask("coilovers");
    expect(fixture.calls).toEqual([{ action: "search-suggest-shared", subject: "network:unattributed" }]);
  });

  it("answers short and over-long queries without searching or spending quota", async () => {
    for (const q of ["", "a", "  b  ", "x".repeat(81), `  ${"y".repeat(500)}  `]) {
      const response = await ask(q);
      expect(response.status, q.slice(0, 10)).toBe(200);
      const body = await response.json();
      expect(body.groups).toEqual([]);
      expect(body.q.length).toBeLessThanOrEqual(80);
    }
    expect(fixture.calls).toEqual([]);
    expect(fixture.clients).toBe(0);
    expect(fixture.searches).toBe(0);
  });

  it("still searches a query at the length bound", async () => {
    expect((await ask("z".repeat(80))).status).toBe(200);
    expect(fixture.searches).toBe(4);
  });
});
