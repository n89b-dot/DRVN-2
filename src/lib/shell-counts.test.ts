import type { SupabaseClient } from "@supabase/supabase-js";
import { expect, it, vi } from "vitest";

import type { Database } from "@/lib/database.types";

import { loadUnreadNotificationCount } from "./shell-counts";

vi.mock("@/lib/monitoring", () => ({ reportError: vi.fn() }));
vi.mock("@/lib/agent/beta", () => ({ agentTabOpen: vi.fn() }));
vi.mock("@/lib/cart", () => ({ cartCount: vi.fn() }));

function client(prefs: unknown, unread: number) {
  const calls: { table: string; select?: [string, unknown]; or?: string; head?: boolean }[] = [];
  const from = vi.fn((table: string) => {
    const call: (typeof calls)[number] = { table };
    calls.push(call);
    const query: Record<string, unknown> = {};
    query.select = (columns: string, options?: { head?: boolean }) => {
      call.select = [columns, options];
      call.head = Boolean(options?.head);
      return query;
    };
    for (const method of ["eq", "is"]) query[method] = () => query;
    query.or = (filter: string) => {
      call.or = filter;
      return query;
    };
    query.maybeSingle = () => Promise.resolve({ data: { notification_prefs: prefs } });
    query.then = (resolve: (v: unknown) => unknown) => Promise.resolve({ count: unread, error: null }).then(resolve);
    return query;
  });
  // N62: the member's own settings come from my_notification_prefs, not the column.
  const rpc = vi.fn((name: string) => {
    expect(name).toBe("my_notification_prefs");
    return Promise.resolve({ data: prefs, error: null });
  });
  return { supabase: { from, rpc } as unknown as SupabaseClient<Database>, calls };
}

it("N30: counts every unread notification in the database, past 1,000", async () => {
  const { supabase, calls } = client({}, 1834);
  expect(await loadUnreadNotificationCount(supabase, "member")).toBe(1834);
  const read = calls.find((c) => c.table === "notifications")!;
  // An exact count of no rows — not up to 1,000 kinds counted here.
  expect(read.select).toEqual(["id", { count: "exact", head: true }]);
  expect(read.or).toBeUndefined();
  // The closed column is never asked for (N62).
  expect(calls.some((c) => c.table === "profiles")).toBe(false);
});

it("leaves muted kinds out in the query itself", async () => {
  const { supabase, calls } = client({ comments: false }, 7);
  expect(await loadUnreadNotificationCount(supabase, "member")).toBe(7);
  expect(calls.find((c) => c.table === "notifications")!.or).toContain("kind.not.in.(comment,reaction)");
});
