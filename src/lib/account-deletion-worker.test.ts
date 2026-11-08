import { createHmac } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * N16 (OS-W34): the worker hands every pass to the database's scrub
 * (scrub_deleted_account, 20261107220510) after revoking access, with a
 * keyed digest of the email taken once — a resumed pass finds the digest
 * already recorded and sends none.
 */
const state = vi.hoisted(() => ({
  calls: [] as string[],
  rpcArgs: {} as Record<string, unknown>,
  request: { id: "req-1", email_digest: null as string | null, scrubbed_at: null as string | null },
  authUpdates: [] as Record<string, unknown>[],
  bannedUntil: null as string | null,
  gates: [] as Record<string, unknown>[],
  finaliseReply: null as Record<string, unknown> | null,
  scrubError: null as { message: string } | null,
  finished: [] as unknown[],
  stripeCustomer: null as string | null,
  stripeDeleted: [] as string[],
}));

vi.mock("server-only", () => ({}));
vi.mock("./job-lease", () => ({ jobHeartbeat: () => async () => {} }));
vi.mock("./payments/stripe", () => ({
  stripeClient: () => ({
    customers: {
      retrieve: async (id: string) => ({ id, deleted: false, metadata: { user_id: "u-1" } }),
      del: async (id: string) => { state.calls.push("stripe-delete"); state.stripeDeleted.push(id); return { id, deleted: true }; },
    },
  }),
}));
vi.mock("@/lib/media-lifecycle", () => ({ removeMediaObject: vi.fn() }));
vi.mock("@/lib/monitoring", () => ({ reportError: vi.fn() }));
vi.mock("@/lib/account-export-worker", () => ({ purgeAccountExportsForUser: vi.fn(async () => { state.calls.push("purge-exports"); }) }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    // Every query builder chain resolves to rows for its table.
    const chain = (table: string): unknown => {
      const result = () => {
        if (table === "account_deletion_requests") return { data: state.request, error: null };
        if (table === "profiles") return { data: { stripe_customer_id: state.stripeCustomer }, error: null };
        return { data: [], error: null };
      };
      const proxy: unknown = new Proxy(function () {}, {
        get(_t, prop) {
          if (prop === "then") return (resolve: (v: unknown) => unknown) => resolve(result());
          if (prop === "throwOnError") return () => proxy;
          return () => proxy;
        },
      });
      return proxy;
    };
    return {
      from: (table: string) => chain(table),
      storage: { from: () => ({ list: async () => ({ data: [], error: null }) }) },
      auth: {
        admin: {
          getUserById: async () => ({ data: { user: { id: "u-1", email: " Dana@Example.TEST ", banned_until: state.bannedUntil } }, error: null }),
          updateUserById: async (_id: string, attrs: Record<string, unknown>) => {
            state.calls.push(`auth-update:${Object.keys(attrs).join(",")}`);
            state.authUpdates.push(attrs);
            return { error: null };
          },
          deleteUser: async () => ({ error: null }),
        },
      },
      // A promise with throwOnError, like the client's builder.
      rpc: (name: string, args: Record<string, unknown>) => {
        const reply = (async () => {
          state.calls.push(name);
          state.rpcArgs[name] = args;
          if (name === "claim_remediation_jobs") return { data: [{ id: "job-1", lease_id: "lease-1", payload: { user_id: "u-1" } }], error: null };
          // Each queued gate answer in turn, then clear.
          if (name === "account_deletion_hold_gate") return { data: state.gates.shift() ?? { financial_hold: false, retained_identity: true, held: false, hold_order_id: null }, error: null };
          // A trader: kept for their orders; finalise records it and finishes the job (20261108130400).
          if (name === "account_deletion_finalise") return { data: state.finaliseReply ?? { financial_hold: false, retained_identity: true, held: false, outcome: "operator_attention" }, error: null };
          if (name === "scrub_deleted_account") return state.scrubError ? { data: null, error: state.scrubError } : { data: { messages: 1 }, error: null };
          if (name === "finish_remediation_job") state.finished.push(args);
          return { data: null, error: null };
        })();
        return Object.assign(reply, { throwOnError: () => reply });
      },
    };
  },
}));

const { processAccountDeletions } = await import("./account-deletion-worker");

beforeEach(() => {
  state.calls = [];
  state.rpcArgs = {};
  state.request = { id: "req-1", email_digest: null, scrubbed_at: null };
  state.authUpdates = [];
  state.bannedUntil = null;
  state.gates = [];
  state.finaliseReply = null;
  state.scrubError = null;
  state.finished = [];
  state.stripeCustomer = null;
  state.stripeDeleted = [];
  vi.stubEnv("ACCOUNT_EMAIL_DIGEST_KEY", "k".repeat(40));
});

describe("N16 deletion scrub in the worker", () => {
  it("revokes access, then scrubs with a keyed digest of the email, never the email itself", async () => {
    await expect(processAccountDeletions()).resolves.toMatchObject({ outcome: "operator_attention" });
    const scrub = state.rpcArgs.scrub_deleted_account as Record<string, unknown>;
    expect(scrub).toEqual({
      p_user: "u-1",
      p_email_digest: createHmac("sha256", "k".repeat(40)).update("dana@example.test").digest("hex"),
      p_digest_key: "dedicated-v1",
    });
    expect(JSON.stringify(scrub)).not.toMatch(/dana/i);
    expect(state.calls.indexOf("auth-update:ban_duration")).toBeLessThan(state.calls.indexOf("scrub_deleted_account"));
    expect(state.calls.indexOf("scrub_deleted_account")).toBeLessThan(state.calls.indexOf("purge-exports"));
  });

  it("a resumed pass sends no new digest: the first one is already recorded", async () => {
    state.request = { id: "req-1", email_digest: "a".repeat(64), scrubbed_at: null };
    await processAccountDeletions();
    expect(state.rpcArgs.scrub_deleted_account).toEqual({ p_user: "u-1", p_email_digest: null, p_digest_key: null });
  });

  it("N439: a trader's saved cards are deleted too, though their account is kept for its orders", async () => {
    state.stripeCustomer = "cus_123";
    await expect(processAccountDeletions()).resolves.toMatchObject({ outcome: "operator_attention" });
    expect(state.stripeDeleted).toEqual(["cus_123"]);
    expect(state.calls.indexOf("scrub_deleted_account")).toBeLessThan(state.calls.indexOf("stripe-delete"));
  });

  it("a scrub that fails leaves the job to retry, and nothing after it runs", async () => {
    state.scrubError = { message: "boom" };
    await expect(processAccountDeletions()).rejects.toThrow("Personal data scrub failed");
    expect(state.calls).not.toContain("agent_purge_member");
    expect(state.calls).not.toContain("purge-exports");
    expect(state.finished).toEqual([{ p_id: "job-1", p_lease: "lease-1", p_error: "Personal data scrub failed" }]);
  });
});

/**
 * N418 (ruled 8 Nov 2026): a return or chargeback that opens after the scrub
 * never gives sign-in back. The member's email and phone are gone, so nobody
 * could settle it through the account: the ban stays and the case goes to an
 * operator (the database records late_hold_after_scrub, 20261108180000).
 */
describe("N418 a late hold after the scrub never reinstates the member", () => {
  const held = { financial_hold: true, retained_identity: true, held: true, hold_order_id: "order-1" };
  const lifted = () => state.authUpdates.some((attrs) => attrs.ban_duration === "none");

  it("N418: a hold found at finalise, after this pass's scrub, keeps the ban and records operator attention", async () => {
    // No scrubbed flag from the database: the worker saw its own scrub commit.
    state.finaliseReply = held;
    await expect(processAccountDeletions()).resolves.toMatchObject({ continued: 1, outcome: "operator_attention" });
    expect(state.calls.indexOf("scrub_deleted_account")).toBeLessThan(state.calls.indexOf("pause_account_deletion_hold"));
    expect(lifted()).toBe(false);
    expect(state.authUpdates).toEqual([{ ban_duration: "876000h" }]);
  });

  it("N418: a resumed pass on a scrubbed case that meets a hold at the first gate leaves the ban in place", async () => {
    state.request = { id: "req-1", email_digest: "a".repeat(64), scrubbed_at: "2026-11-08T10:00:00Z" };
    state.bannedUntil = new Date(Date.now() + 86_400_000).toISOString();
    state.gates = [held];
    await expect(processAccountDeletions()).resolves.toMatchObject({ continued: 1, outcome: "operator_attention" });
    expect(lifted()).toBe(false);
    expect(state.authUpdates).toEqual([]);
    expect(state.calls).not.toContain("scrub_deleted_account");
    expect(state.calls).toContain("pause_account_deletion_hold");
  });

  it("N418: the database's scrubbed flag alone keeps the ban at the gate after it", async () => {
    state.gates = [{ ...held, held: false, financial_hold: false }, { ...held, scrubbed: true }];
    await expect(processAccountDeletions()).resolves.toMatchObject({ continued: 1, outcome: "operator_attention" });
    expect(lifted()).toBe(false);
    expect(state.authUpdates).toEqual([{ ban_duration: "876000h" }]);
  });

  it("N418 control: before any scrub, a hold still gives a banned member sign-in back to settle it", async () => {
    state.bannedUntil = new Date(Date.now() + 86_400_000).toISOString();
    state.gates = [held];
    await expect(processAccountDeletions()).resolves.toMatchObject({ continued: 1, outcome: "temporary_financial_hold" });
    expect(lifted()).toBe(true);
    expect(state.calls.indexOf("auth-update:ban_duration")).toBeLessThan(state.calls.indexOf("pause_account_deletion_hold"));
  });
});
