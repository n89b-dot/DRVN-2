import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * OS-W11 follow-up: the deletion worker banned sign-in and scrubbed the
 * profile before it rechecked financial holds, so a hold found after cleanup
 * paused the job with the member locked out of the order holding it. Holds
 * are now asked before the ban, straight after it, and after cleanup; any
 * hold lifts the ban before the job pauses, and nothing is deleted on a hold
 * found before cleanup.
 */

type Answer = { financial_hold: boolean; retained_identity: boolean };

const state = vi.hoisted(() => ({
  events: [] as string[],
  answers: [] as Answer[],
  bannedUntil: null as string | null,
  liftError: null as { message: string } | null,
  finished: [] as { p_error?: string }[],
}));

vi.mock("server-only", () => ({}));
vi.mock("./job-lease", () => ({ jobHeartbeat: () => async () => {} }));
vi.mock("./payments/stripe", () => ({ stripeClient: vi.fn() }));
vi.mock("@/lib/media-lifecycle", () => ({ removeMediaObject: vi.fn() }));
vi.mock("@/lib/monitoring", () => ({ reportError: vi.fn() }));
vi.mock("@/lib/account-export-worker", () => ({
  purgeAccountExportsForUser: vi.fn(async () => {
    state.events.push("purge-exports");
  }),
}));

function thenable<T>(value: T) {
  const promise = Promise.resolve(value) as Promise<T> & { throwOnError: () => Promise<T> };
  promise.throwOnError = () => promise;
  return promise;
}

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    const from = (table: string) => {
      let op = "select";
      const result = () => {
        if (table === "account_deletion_requests" && op === "select") return { data: { id: "req-1" }, error: null };
        if (table === "profiles" && op === "select") return { data: { stripe_customer_id: null }, error: null };
        return { data: [], error: null };
      };
      const chain: Record<string, unknown> = {};
      for (const method of ["select", "update", "delete", "upsert", "insert"]) {
        chain[method] = () => {
          op = method;
          if (method !== "select") state.events.push(`${table}.${method}`);
          return chain;
        };
      }
      for (const method of ["eq", "in", "order", "limit", "maybeSingle", "throwOnError"]) chain[method] = () => chain;
      chain.then = (resolve: (value: unknown) => unknown) => resolve(result());
      return chain;
    };
    return {
      from,
      storage: { from: () => ({ list: async () => ({ data: [], error: null }) }) },
      auth: {
        admin: {
          getUserById: async () => ({ data: { user: { id: "u-1", banned_until: state.bannedUntil } }, error: null }),
          updateUserById: async (_id: string, attrs: { ban_duration?: string }) => {
            if (attrs.ban_duration === "none") {
              state.events.push("lift-ban");
              return { error: state.liftError };
            }
            state.events.push("ban");
            return { error: null };
          },
          deleteUser: async () => {
            state.events.push("delete-auth-user");
            return { error: null };
          },
        },
      },
      rpc: (name: string, args: Record<string, unknown>) => {
        if (name === "claim_remediation_jobs") {
          return thenable({ data: [{ id: "job-1", lease_id: "lease-1", payload: { user_id: "u-1", stripe_customer_id: null } }], error: null });
        }
        // The hold answer, whichever way the worker asks for it.
        if (name === "account_deletion_hold_gate" || name === "account_deletion_blockers") {
          state.events.push("hold-check");
          const answer = state.answers.shift() ?? { financial_hold: false, retained_identity: false };
          return thenable({ data: { ...answer, held: answer.financial_hold, hold_order_id: answer.financial_hold ? "order-1" : null }, error: null });
        }
        if (name === "finish_remediation_job") state.finished.push(args as { p_error?: string });
        state.events.push(name);
        return thenable({ data: null, error: null });
      },
    };
  },
}));

const { processAccountDeletions } = await import("./account-deletion-worker");

const HOLD: Answer = { financial_hold: true, retained_identity: true };
const CLEAR: Answer = { financial_hold: false, retained_identity: false };

const DESTRUCTIVE = ["profiles.update", "activity_posts.delete", "listings.delete", "cars.delete", "agent_purge_member", "delete-auth-user"];

beforeEach(() => {
  state.events = [];
  state.answers = [];
  state.bannedUntil = null;
  state.liftError = null;
  state.finished = [];
});

describe("account deletion and financial holds (OS-W11 follow-up)", () => {
  it("pauses on a hold before banning sign-in or deleting anything", async () => {
    state.answers = [HOLD];
    await expect(processAccountDeletions()).resolves.toMatchObject({ outcome: "temporary_financial_hold" });
    expect(state.events).toEqual(["hold-check", "pause_account_deletion_hold"]);
  });

  it("gives sign-in back to a member still banned from an earlier pass", async () => {
    state.bannedUntil = new Date(Date.now() + 86_400_000).toISOString();
    state.answers = [HOLD];
    await processAccountDeletions();
    expect(state.events).toEqual(["hold-check", "lift-ban", "pause_account_deletion_hold"]);
  });

  it("asks again straight after the ban, and lifts it before anything is deleted", async () => {
    state.answers = [CLEAR, HOLD];
    await expect(processAccountDeletions()).resolves.toMatchObject({ outcome: "temporary_financial_hold" });
    expect(state.events).toEqual(["hold-check", "ban", "hold-check", "lift-ban", "pause_account_deletion_hold"]);
    for (const step of DESTRUCTIVE) expect(state.events).not.toContain(step);
  });

  it("lifts the ban when a hold appears during cleanup, and never deletes the sign-in", async () => {
    state.answers = [CLEAR, CLEAR, HOLD];
    await processAccountDeletions();
    const events = state.events;
    expect(events.indexOf("lift-ban")).toBeGreaterThan(events.indexOf("profiles.update"));
    expect(events.indexOf("lift-ban")).toBeLessThan(events.indexOf("pause_account_deletion_hold"));
    expect(events).not.toContain("delete-auth-user");
    expect(events).not.toContain("purge-exports");
  });

  it("keeps the job's lease and retries, rather than pausing with the member locked out, if the ban can't be lifted", async () => {
    state.answers = [CLEAR, HOLD];
    state.liftError = { message: "auth down" };
    await expect(processAccountDeletions()).rejects.toThrow("Could not restore account access");
    expect(state.events).not.toContain("pause_account_deletion_hold");
    expect(state.finished).toEqual([expect.objectContaining({ p_error: "Could not restore account access for a held deletion" })]);
  });

  it("with nothing held, bans and then cleans up and deletes as before", async () => {
    state.answers = [CLEAR, CLEAR, CLEAR];
    await expect(processAccountDeletions()).resolves.toMatchObject({ completed: 1 });
    const events = state.events;
    expect(events.indexOf("ban")).toBeLessThan(events.indexOf("profiles.update"));
    expect(events).toContain("delete-auth-user");
    expect(events).not.toContain("lift-ban");
    expect(events).not.toContain("pause_account_deletion_hold");
  });
});
