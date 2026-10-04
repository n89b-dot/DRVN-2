import { beforeEach, describe, expect, it, vi } from "vitest";

type Result = { data: unknown; error: unknown };

const state = vi.hoisted(() => ({
  /** Answers for successive profile reads (select … maybeSingle). */
  reads: [] as Result[],
  /** Answer for the conditional pointer write (update … select). */
  write: { data: [], error: null } as Result,
  updates: [] as Record<string, unknown>[],
  customersCreate: vi.fn(),
  accountsCreate: vi.fn(),
}));

vi.mock("@/lib/monitoring", () => ({ reportError: vi.fn() }));
vi.mock("./stripe", () => ({
  stripeClient: () => ({
    customers: { create: state.customersCreate },
    accounts: { create: state.accountsCreate },
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => {
      const read: Record<string, unknown> = {};
      read.select = () => read;
      read.eq = () => read;
      read.maybeSingle = async () => state.reads.shift() ?? { data: null, error: null };
      const write: Record<string, unknown> = {};
      write.eq = () => write;
      write.is = () => write;
      write.select = async () => state.write;
      return {
        ...read,
        update: (values: Record<string, unknown>) => {
          state.updates.push(values);
          return write;
        },
      };
    },
  }),
}));

import { getOrCreateStripeCustomer, getStripeCustomerId } from "./customers";
import { getConnectAccountId, getOrCreateConnectAccount } from "./connect";

beforeEach(() => {
  state.reads = [];
  state.write = { data: [], error: null };
  state.updates = [];
  state.customersCreate.mockReset().mockResolvedValue({ id: "cus_new" });
  state.accountsCreate.mockReset().mockResolvedValue({ id: "acct_new" });
});

describe("Stripe customer pointer", () => {
  it("throws on a failed read instead of reporting no customer", async () => {
    state.reads = [{ data: null, error: { message: "timeout" } }];
    await expect(getStripeCustomerId("user-1")).rejects.toThrow("lookup failed");
  });

  it("never creates a customer when the existing pointer can't be read", async () => {
    state.reads = [{ data: null, error: { message: "timeout" } }];
    await expect(getOrCreateStripeCustomer("user-1", "a@example.test")).rejects.toThrow();
    expect(state.customersCreate).not.toHaveBeenCalled();
  });

  it("returns the new customer once its pointer is stored", async () => {
    state.reads = [{ data: { stripe_customer_id: null }, error: null }];
    state.write = { data: [{ stripe_customer_id: "cus_new" }], error: null };
    await expect(getOrCreateStripeCustomer("user-1")).resolves.toBe("cus_new");
    expect(state.updates).toEqual([{ stripe_customer_id: "cus_new" }]);
  });

  it("uses the stored id when a concurrent request won the write", async () => {
    state.reads = [
      { data: { stripe_customer_id: null }, error: null },
      { data: { stripe_customer_id: "cus_winner" }, error: null },
    ];
    await expect(getOrCreateStripeCustomer("user-1")).resolves.toBe("cus_winner");
  });

  it("throws, never returning an unsaved id, when the pointer write fails", async () => {
    state.reads = [{ data: { stripe_customer_id: null }, error: null }];
    state.write = { data: null, error: { message: "connection reset" } };
    await expect(getOrCreateStripeCustomer("user-1")).rejects.toThrow("pointer write failed");
  });

  it("throws when nothing matched and nothing is stored", async () => {
    state.reads = [
      { data: { stripe_customer_id: null }, error: null },
      { data: null, error: null },
    ];
    await expect(getOrCreateStripeCustomer("user-1")).rejects.toThrow("not saved");
  });
});

describe("Connect account pointer", () => {
  it("throws on a failed read (R2-05 kept)", async () => {
    state.reads = [{ data: null, error: { message: "timeout" } }];
    await expect(getConnectAccountId("seller-1")).rejects.toThrow("lookup failed");
  });

  it("returns the new account once its pointer is stored", async () => {
    state.reads = [{ data: { stripe_account_id: null }, error: null }];
    state.write = { data: [{ stripe_account_id: "acct_new" }], error: null };
    await expect(getOrCreateConnectAccount("seller-1")).resolves.toBe("acct_new");
  });

  it("uses the stored id when a concurrent request won the write", async () => {
    state.reads = [
      { data: { stripe_account_id: null }, error: null },
      { data: { stripe_account_id: "acct_winner" }, error: null },
    ];
    await expect(getOrCreateConnectAccount("seller-1")).resolves.toBe("acct_winner");
  });

  it("throws when the pointer write fails", async () => {
    state.reads = [{ data: { stripe_account_id: null }, error: null }];
    state.write = { data: null, error: { message: "connection reset" } };
    await expect(getOrCreateConnectAccount("seller-1")).rejects.toThrow("pointer write failed");
  });
});
