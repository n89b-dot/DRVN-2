import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * OS-W11 follow-up: the console's account-deletion queue read only the
 * oldest 50 unfinished cases, with no way to the 51st, so a long-lived hold
 * could hide every case asked after it. It now pages, oldest first with the
 * id as a tiebreak, and says whether there is more.
 */

type Call = { method: string; args: unknown[] };
type Result = { data: unknown; count?: number | null; error: { message: string } | null };

const state = vi.hoisted(() => ({
  calls: {} as Record<string, Call[]>,
  results: {} as Record<string, Result>,
}));

vi.mock("server-only", () => ({}));
vi.mock("./guard", () => ({
  adminReadClient: async () => ({
    from: (table: string) => {
      const calls: Call[] = (state.calls[table] = []);
      const builder: Record<string, unknown> = {};
      for (const method of ["select", "eq", "neq", "in", "order", "limit", "range"]) {
        builder[method] = (...args: unknown[]) => {
          calls.push({ method, args });
          return builder;
        };
      }
      builder.then = (resolve: (value: Result) => unknown) =>
        resolve(state.results[table] ?? { data: [], count: 0, error: null });
      return builder;
    },
  }),
  requireAdminRead: async () => ({ userId: "admin-1", role: "admin" }),
}));
vi.mock("@/lib/monitoring", () => ({ reportError: vi.fn() }));
vi.mock("@/lib/evidence-urls", () => ({ signEvidenceUrls: vi.fn() }));

import { deletionBlockerLabel } from "./presentation";
import { ACCOUNT_DELETIONS_PAGE_SIZE, getAccountDeletionCases } from "./queries";

const row = (n: number) => ({
  id: `case-${n}`,
  user_id: null,
  outcome: "temporary_financial_hold",
  next_action: "Waiting",
  responsible_owner: "privacy worker",
  policy_decisions_pending: [],
  updated_at: "2026-11-07T00:00:00Z",
  requested_at: "2026-11-01T00:00:00Z",
  review_at: null,
});

beforeEach(() => {
  state.calls = {};
  state.results = {};
});

describe("account deletion queue paging (OS-W11 follow-up)", () => {
  it("reaches the cases after the first 50", async () => {
    state.results.account_deletion_requests = { data: [row(51), row(52)], count: 52, error: null };
    const result = await getAccountDeletionCases(1);
    const calls = state.calls.account_deletion_requests;
    expect(calls).toContainEqual({ method: "range", args: [ACCOUNT_DELETIONS_PAGE_SIZE, 2 * ACCOUNT_DELETIONS_PAGE_SIZE - 1] });
    expect(result).toMatchObject({ total: 52, page: 1, hasMore: false });
    expect(result.rows.map((r) => r.id)).toEqual(["case-51", "case-52"]);
  });

  it("says there is more when the first page is full", async () => {
    state.results.account_deletion_requests = {
      data: Array.from({ length: ACCOUNT_DELETIONS_PAGE_SIZE }, (_, i) => row(i + 1)),
      count: 51,
      error: null,
    };
    const result = await getAccountDeletionCases();
    expect(state.calls.account_deletion_requests).toContainEqual({ method: "range", args: [0, ACCOUNT_DELETIONS_PAGE_SIZE - 1] });
    expect(result).toMatchObject({ total: 51, page: 0, hasMore: true });
  });

  it("orders oldest first with a stable tiebreak, so a page boundary never repeats or skips a case", async () => {
    await getAccountDeletionCases();
    const orders = state.calls.account_deletion_requests.filter((c) => c.method === "order");
    expect(orders).toEqual([
      { method: "order", args: ["requested_at", { ascending: true }] },
      { method: "order", args: ["id", { ascending: true }] },
    ]);
  });
});

describe("N418: the deletion queue says why a case waits", () => {
  it("N418: a late hold after the scrub reaches the console with its reason", async () => {
    state.results.account_deletion_requests = {
      data: [{ ...row(1), outcome: "operator_attention", blocker_code: "late_hold_after_scrub", next_action: "Order ABCD1234 has a return" }],
      count: 1,
      error: null,
    };
    const result = await getAccountDeletionCases();
    const select = state.calls.account_deletion_requests.find((c) => c.method === "select");
    expect(String(select?.args[0])).toContain("blocker_code");
    expect(result.rows[0]).toMatchObject({ outcome: "operator_attention", blockerCode: "late_hold_after_scrub" });
    expect(deletionBlockerLabel(result.rows[0].blockerCode)).toBe("Late hold after scrub");
  });

  it("N418: every code the database writes has a label, and an unknown one still reads", () => {
    expect(deletionBlockerLabel("open_chargeback")).toBe("Open bank chargeback");
    expect(deletionBlockerLabel("active_financial_obligations")).toBe("Open order, return, refund or payout");
    expect(deletionBlockerLabel("immutable_retained_identity")).toBe("Transaction records kept");
    expect(deletionBlockerLabel("some_new_code")).toBe("some new code");
    expect(deletionBlockerLabel(null)).toBeNull();
  });
});
