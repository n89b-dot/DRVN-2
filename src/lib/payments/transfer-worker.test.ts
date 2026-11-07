import { beforeEach, describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";

const mocks = vi.hoisted(() => ({
  transferList: vi.fn(),
  transferCreate: vi.fn(),
  paymentIntentRetrieve: vi.fn(),
  stripeSecretKey: vi.fn(() => "sk_test_transfer"),
  adjustmentCents: vi.fn(async () => 0),
  reversalShareCents: vi.fn(() => 0),
  reportError: vi.fn(),
  sendAdminAlert: vi.fn(async () => undefined),
}));

vi.mock("./stripe", () => ({
  stripeClient: () => ({
    transfers: { list: mocks.transferList, create: mocks.transferCreate },
    paymentIntents: { retrieve: mocks.paymentIntentRetrieve },
  }),
  stripeSecretKey: mocks.stripeSecretKey,
}));
vi.mock("./adjustments", () => ({ orderAdjustmentCents: mocks.adjustmentCents }));
vi.mock("./refunds", () => ({ reversalShareCents: mocks.reversalShareCents }));
vi.mock("@/lib/monitoring", () => ({ reportError: mocks.reportError }));
vi.mock("@/lib/admin/alerts", () => ({ sendAdminAlert: mocks.sendAdminAlert }));

import {
  CHARGEBACK_HOLD_REASON,
  findExistingTransfer,
  processDueTransfers,
  reconcileTransferRecords,
} from "./transfer-worker";

const dispatch = {
  operationKey: "transfer:order-a",
  orderId: "order-a",
  amountCents: 4500,
  currency: "usd",
  destination: "acct_seller",
  sourceTransaction: "ch_source",
  transferGroup: "pi_group",
};

function transfer(overrides: Record<string, unknown> = {}): Stripe.Transfer {
  return {
    id: "tr_exact",
    amount: 4500,
    currency: "usd",
    destination: "acct_seller",
    source_transaction: "ch_source",
    transfer_group: "pi_group",
    metadata: { order_id: "order-a", transfer_operation: "transfer:order-a" },
    ...overrides,
  } as unknown as Stripe.Transfer;
}

type IntentOverrides = Partial<{
  attempts: number;
  available_at: string | null;
  operation_key: string | null;
  dispatch_amount_cents: number | null;
  dispatch_currency: string | null;
  dispatch_destination: string | null;
  dispatch_source_transaction: string | null;
  dispatch_transfer_group: string | null;
  provider_call_may_have_occurred: boolean;
  source_transaction: string | null;
  dispatch_carry_cents: number | null;
}>;

function intent(overrides: IntentOverrides = {}) {
  return {
    order_id: "order-a",
    seller_id: "seller-a",
    amount_cents: 4500,
    currency: "USD",
    attempts: 0,
    available_at: null,
    source_transaction: "ch_source",
    transfer_reference: null,
    locked_by: "prior-worker",
    operation_key: null,
    dispatch_amount_cents: null,
    dispatch_currency: null,
    dispatch_destination: null,
    dispatch_source_transaction: null,
    dispatch_transfer_group: null,
    provider_call_may_have_occurred: false,
    ...overrides,
  };
}

const frozenIntent = (overrides: IntentOverrides = {}) =>
  intent({
    operation_key: dispatch.operationKey,
    dispatch_amount_cents: dispatch.amountCents,
    dispatch_currency: dispatch.currency,
    dispatch_destination: dispatch.destination,
    dispatch_source_transaction: dispatch.sourceTransaction,
    dispatch_transfer_group: dispatch.transferGroup,
    provider_call_may_have_occurred: true,
    ...overrides,
  });

type RpcBehavior = Record<
  string,
  { data?: unknown; error?: { message?: string; code?: string } | null }
>;

function fakeAdmin(options: {
  claimed?: ReturnType<typeof intent>[];
  rpc?: RpcBehavior;
  order?: Record<string, unknown> | null | Array<Record<string, unknown> | null>;
  orderError?: { message: string } | null;
  payment?: Record<string, unknown> | null;
  profile?: Record<string, unknown> | null;
  orderWrite?: { data?: unknown[] | null; error?: unknown };
  notificationError?: unknown;
  /** stripe_dispute_journal rows per read (the last repeats). */
  chargebacks?: Array<Array<{ dispute_id: string; state: string }>>;
  chargebackError?: { message: string } | null;
} = {}) {
  const inserts: Array<{ table: string; value: unknown }> = [];
  const journalFilters: unknown[] = [];
  let orderReadIndex = 0;
  let journalReadIndex = 0;
  const rpc = vi.fn(async (name: string) => {
    if (name === "claim_transfer_intents") {
      return { data: options.claimed ?? [], error: null };
    }
    const behavior = options.rpc?.[name];
    const defaultData =
      name === "complete_transfer_intent"
        ? "completed"
        : name === "record_transfer_recovery"
          ? "recovery-a"
          : name === "freeze_transfer_carry"
            ? 0
            : true;
    // An explicit `data: null` is a real answer (a lost lease), not "default".
    const data = behavior && "data" in behavior ? behavior.data : defaultData;
    return { data, error: behavior?.error ?? null };
  });

  const from = vi.fn((table: string) => {
    let action: "select" | "update" | "insert" = "select";
    const result = () => {
      if (table === "orders" && action === "select") {
        const defaultOrder = {
          id: "order-a",
          status: "delivered",
          seller_id: "seller-a",
          total_cents: 5000,
          platform_fee_cents: 500,
          refunded_cents: 0,
          transfer_reference: null,
          delivered_at: new Date(0).toISOString(),
        } as Record<string, unknown>;
        const configuredOrder = Array.isArray(options.order)
          ? options.order[Math.min(orderReadIndex++, options.order.length - 1)]
          : options.order;
        return {
          data: configuredOrder === undefined ? defaultOrder : configuredOrder,
          error: options.orderError ?? null,
        };
      }
      if (table === "stripe_dispute_journal") {
        const reads = options.chargebacks ?? [[]];
        return {
          data: reads[Math.min(journalReadIndex++, reads.length - 1)],
          error: options.chargebackError ?? null,
        };
      }
      if (table === "payments") {
        return {
          data:
            options.payment ??
            ({ provider: "stripe", provider_reference: "pi_group" } as Record<string, unknown>),
          error: null,
        };
      }
      if (table === "profiles") {
        return {
          data:
            options.profile ??
            ({ stripe_account_id: "acct_seller", payouts_enabled: true } as Record<
              string,
              unknown
            >),
          error: null,
        };
      }
      if (table === "orders" && action === "update") {
        return { data: options.orderWrite?.data ?? [{ id: "order-a" }], error: options.orderWrite?.error ?? null };
      }
      if (table === "notifications" && action === "insert") {
        return { data: null, error: options.notificationError ?? null };
      }
      return { data: [], error: null };
    };

    const query: Record<string, unknown> & PromiseLike<unknown> = {
      select: vi.fn(() => query),
      update: vi.fn(() => {
        action = "update";
        return query;
      }),
      insert: vi.fn((value: unknown) => {
        action = "insert";
        inserts.push({ table, value });
        return query;
      }),
      eq: vi.fn(() => query),
      is: vi.fn(() => query),
      not: vi.fn(() => query),
      in: vi.fn(() => query),
      contains: vi.fn((column: string, value: unknown) => {
        journalFilters.push({ table, column, value });
        return query;
      }),
      limit: vi.fn(() => query),
      maybeSingle: vi.fn(async () => result()),
      then: (resolve, reject) => Promise.resolve(result()).then(resolve, reject),
    };
    return query;
  });

  return { admin: { rpc, from } as never, rpc, from, inserts, journalFilters };
}

function exactPage(hasMore = false) {
  return { data: [transfer()], has_more: hasMore };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.stripeSecretKey.mockReturnValue("sk_test_transfer");
  mocks.adjustmentCents.mockResolvedValue(0);
  mocks.reversalShareCents.mockReturnValue(0);
  mocks.paymentIntentRetrieve.mockResolvedValue({ latest_charge: "ch_source" });
  mocks.transferCreate.mockResolvedValue(transfer());
  mocks.transferList.mockResolvedValue({ data: [], has_more: false });
});

describe("transfer reconciliation", () => {
  it("paginates until it finds the one exact transfer", async () => {
    mocks.transferList
      .mockResolvedValueOnce({ data: [transfer({ id: "tr_unrelated", metadata: {} })], has_more: true })
      .mockResolvedValueOnce(exactPage());

    await expect(findExistingTransfer(dispatch)).resolves.toEqual({
      kind: "found",
      transferId: "tr_exact",
    });
    expect(mocks.transferList).toHaveBeenNthCalledWith(1, { limit: 100 });
    expect(mocks.transferList).toHaveBeenNthCalledWith(2, {
      limit: 100,
      starting_after: "tr_unrelated",
    });
  });

  it.each([
    ["amount", { amount: 4499 }],
    ["currency", { currency: "eur" }],
    ["destination", { destination: "acct_other" }],
    ["source", { source_transaction: "ch_other" }],
    ["group", { transfer_group: "pi_other" }],
    ["operation", { metadata: { order_id: "order-a", transfer_operation: "transfer:other" } }],
    ["order", { metadata: { order_id: "order-other", transfer_operation: "transfer:order-a" } }],
  ])("treats a related %s mismatch as unsafe", async (_field, mismatch) => {
    mocks.transferList.mockResolvedValue({ data: [transfer(mismatch)], has_more: false });
    const result = await findExistingTransfer(dispatch);
    expect(result.kind).toBe("unsafe");
  });

  it("rejects duplicate exact matches instead of choosing the first", async () => {
    mocks.transferList.mockResolvedValue({
      data: [transfer({ id: "tr_one" }), transfer({ id: "tr_two" })],
      has_more: false,
    });
    await expect(findExistingTransfer(dispatch)).resolves.toMatchObject({ kind: "unsafe" });
  });

  it("fails closed when the identity-complete lookup reaches its bound", async () => {
    mocks.transferList.mockResolvedValue({
      data: Array.from({ length: 100 }, (_, index) =>
        transfer({ id: `tr_unrelated_${index}`, metadata: {} })
      ),
      has_more: true,
    });

    await expect(findExistingTransfer(dispatch)).resolves.toEqual({
      kind: "unsafe",
      reason: "Transfer lookup exceeded 1000 records",
    });
    expect(mocks.transferList).toHaveBeenCalledTimes(10);
  });
});

describe("transfer worker crash recovery", () => {
  it("reconciles a reclaimed attempts=0 transfer and describes Stripe balance truthfully", async () => {
    mocks.transferList.mockResolvedValue(exactPage());
    const { admin, rpc, inserts } = fakeAdmin({ claimed: [frozenIntent()] });

    await expect(processDueTransfers(admin)).resolves.toMatchObject({ transferred: 1, failed: 0 });
    expect(mocks.transferCreate).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledWith(
      "complete_transfer_intent",
      expect.objectContaining({ p_transfer_reference: "tr_exact" })
    );
    expect(inserts).toContainEqual({
      table: "notifications",
      value: expect.objectContaining({
        title: "Funds added to your Stripe balance",
        body: expect.stringContaining("Bank payout timing follows your Stripe payout schedule"),
      }),
    });
  });

  it("routes a reclaimed legacy transfer with no frozen payload to one operator case", async () => {
    const { admin, rpc } = fakeAdmin({
      claimed: [intent({ provider_call_may_have_occurred: true })],
      rpc: { record_transfer_recovery: { data: "recovery-a" } },
    });
    await expect(processDueTransfers(admin)).resolves.toMatchObject({ failed: 1 });
    expect(mocks.transferList).not.toHaveBeenCalled();
    expect(mocks.transferCreate).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledWith(
      "record_transfer_recovery",
      expect.objectContaining({
        p_key: "transfer-unresolved:order-a",
        p_worker: expect.stringMatching(/^worker:/),
      })
    );
  });

  it("opens recovery instead of creating after a related provider mismatch", async () => {
    mocks.transferList.mockResolvedValue({
      data: [transfer({ destination: "acct_unexpected" })],
      has_more: false,
    });
    const { admin, rpc } = fakeAdmin({ claimed: [frozenIntent()] });
    await expect(processDueTransfers(admin)).resolves.toMatchObject({ failed: 1 });
    expect(mocks.transferCreate).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledWith(
      "record_transfer_recovery",
      expect.objectContaining({ p_key: "transfer-unresolved:order-a" })
    );
  });

  it("keeps uncertainty retryable when recovery persistence fails", async () => {
    const { admin, rpc } = fakeAdmin({
      claimed: [intent({ provider_call_may_have_occurred: true })],
      rpc: {
        record_transfer_recovery: { error: { message: "recovery write failed" } },
        release_transfer_intent: { data: true },
      },
    });
    await expect(processDueTransfers(admin)).resolves.toMatchObject({ failed: 1 });
    expect(mocks.transferCreate).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledWith(
      "release_transfer_intent",
      expect.objectContaining({ p_status: "failed", p_attempts: 1 })
    );
  });

  it("does not call Stripe when freezing the payload fails", async () => {
    const { admin, rpc } = fakeAdmin({
      claimed: [intent()],
      rpc: {
        prepare_transfer_dispatch: { error: { message: "database unavailable" } },
        release_transfer_intent: { data: true },
      },
    });
    await expect(processDueTransfers(admin)).resolves.toMatchObject({ failed: 1 });
    expect(mocks.transferCreate).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledWith("release_transfer_intent", expect.any(Object));
  });

  it("keeps a carried-forward charge back from a fresh transfer", async () => {
    const { admin, rpc } = fakeAdmin({
      claimed: [intent()],
      rpc: { freeze_transfer_carry: { data: 800 } },
    });
    await expect(processDueTransfers(admin)).resolves.toMatchObject({ transferred: 1 });
    expect(rpc).toHaveBeenCalledWith("freeze_transfer_carry", {
      p_order: "order-a",
      p_worker: expect.any(String),
      p_payable_cents: 4500,
    });
    expect(rpc).toHaveBeenCalledWith(
      "prepare_transfer_dispatch",
      expect.objectContaining({ p_amount_cents: 3700 })
    );
    expect(mocks.transferCreate).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 3700 }),
      expect.anything()
    );
  });

  it("does not transfer when the carry-forward freeze loses the lease", async () => {
    const { admin } = fakeAdmin({
      claimed: [intent()],
      rpc: { freeze_transfer_carry: { data: null } },
    });
    await expect(processDueTransfers(admin)).resolves.toMatchObject({ failed: 1 });
    expect(mocks.transferCreate).not.toHaveBeenCalled();
  });

  it("refuses a carry-forward amount that would empty the transfer", async () => {
    const { admin, rpc } = fakeAdmin({
      claimed: [intent()],
      rpc: { freeze_transfer_carry: { data: 4500 }, release_transfer_intent: { data: true } },
    });
    await expect(processDueTransfers(admin)).resolves.toMatchObject({ failed: 1 });
    expect(mocks.transferCreate).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalledWith("prepare_transfer_dispatch", expect.anything());
  });

  it("re-sends a frozen carry-reduced transfer without calling it a changed amount", async () => {
    const { admin, rpc } = fakeAdmin({
      claimed: [frozenIntent({ dispatch_amount_cents: 3700, dispatch_carry_cents: 800 })],
    });
    mocks.transferCreate.mockResolvedValue(transfer({ amount: 3700 }));
    await expect(processDueTransfers(admin)).resolves.toMatchObject({ transferred: 1 });
    expect(rpc).not.toHaveBeenCalledWith("record_transfer_recovery", expect.anything());
    expect(rpc).not.toHaveBeenCalledWith("freeze_transfer_carry", expect.anything());
    expect(mocks.transferCreate).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 3700 }),
      expect.anything()
    );
  });

  it("recovers success after a failed completion write without creating twice", async () => {
    const first = fakeAdmin({
      claimed: [intent()],
      rpc: {
        prepare_transfer_dispatch: { data: true },
        complete_transfer_intent: { error: { message: "write failed" } },
        release_transfer_intent: { data: true },
      },
    });
    await expect(processDueTransfers(first.admin)).resolves.toMatchObject({ failed: 1 });
    expect(mocks.transferCreate).toHaveBeenCalledTimes(1);

    mocks.transferList.mockResolvedValue(exactPage());
    const retry = fakeAdmin({ claimed: [frozenIntent({ attempts: 1 })] });
    await expect(processDueTransfers(retry.admin)).resolves.toMatchObject({ transferred: 1 });
    expect(mocks.transferCreate).toHaveBeenCalledTimes(1);
  });

  it("does not create when the lease expires during provider lookup", async () => {
    const { admin, rpc } = fakeAdmin({
      claimed: [frozenIntent()],
      rpc: { prepare_transfer_dispatch: { data: false } },
    });
    await expect(processDueTransfers(admin)).resolves.toMatchObject({ failed: 1 });
    expect(rpc).toHaveBeenCalledWith(
      "prepare_transfer_dispatch",
      expect.objectContaining({ p_operation_key: dispatch.operationKey })
    );
    expect(mocks.transferCreate).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalledWith("release_transfer_intent", expect.any(Object));
  });

  it("lets a stale owner neither complete, release, stamp, nor notify", async () => {
    const { admin, rpc, from } = fakeAdmin({
      claimed: [intent()],
      rpc: {
        prepare_transfer_dispatch: { data: true },
        complete_transfer_intent: { data: "lost" },
      },
    });
    await expect(processDueTransfers(admin)).resolves.toMatchObject({ failed: 1 });
    expect(mocks.transferCreate).toHaveBeenCalledTimes(1);
    expect(rpc).not.toHaveBeenCalledWith("release_transfer_intent", expect.any(Object));
    expect(from).not.toHaveBeenCalledWith("notifications");
    expect(from.mock.calls.filter(([table]) => table === "orders")).toHaveLength(1);
  });

  it("recovers the frozen provider effect before a now-refunded order can cancel it", async () => {
    mocks.reversalShareCents.mockReturnValue(100);
    mocks.transferList.mockResolvedValue(exactPage());
    const { admin, rpc } = fakeAdmin({
      claimed: [frozenIntent()],
      order: {
        id: "order-a",
        status: "refunded",
        seller_id: "seller-a",
        total_cents: 5000,
        platform_fee_cents: 500,
        refunded_cents: 5000,
        transfer_reference: null,
        delivered_at: new Date(0).toISOString(),
      },
    });
    await expect(processDueTransfers(admin)).resolves.toMatchObject({ transferred: 1 });
    expect(mocks.transferCreate).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledWith(
      "complete_transfer_intent",
      expect.objectContaining({ p_transfer_reference: "tr_exact" })
    );
    expect(rpc).not.toHaveBeenCalledWith("release_transfer_intent", expect.any(Object));
  });

  it("holds an absent uncertain transfer when the order is disputed", async () => {
    const deliveredOrder = {
      id: "order-a",
      status: "delivered",
      seller_id: "seller-a",
      total_cents: 5000,
      platform_fee_cents: 500,
      refunded_cents: 0,
      transfer_reference: null,
      delivered_at: new Date(0).toISOString(),
    };
    const { admin, rpc } = fakeAdmin({
      claimed: [frozenIntent()],
      order: [deliveredOrder, { ...deliveredOrder, status: "disputed" }],
    });
    await expect(processDueTransfers(admin)).resolves.toMatchObject({ requeued: 1 });
    expect(mocks.transferCreate).not.toHaveBeenCalled();
    // Reachable again on a backed-off reconciliation time, not left to readiness.
    expect(rpc).toHaveBeenCalledWith(
      "release_transfer_intent",
      expect.objectContaining({
        p_status: "holding",
        p_attempts: 1,
        p_next_attempt_at: expect.any(String),
      })
    );
    expect(rpc).not.toHaveBeenCalledWith("prepare_transfer_dispatch", expect.any(Object));
  });

  it("holds an absent uncertain transfer until its clearing time", async () => {
    const { admin, rpc } = fakeAdmin({
      claimed: [
        frozenIntent({ available_at: new Date(Date.now() + 60_000).toISOString() }),
      ],
    });
    await expect(processDueTransfers(admin)).resolves.toMatchObject({ requeued: 1 });
    expect(mocks.transferCreate).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledWith(
      "release_transfer_intent",
      expect.objectContaining({
        p_status: "holding",
        p_attempts: 1,
        p_next_attempt_at: expect.any(String),
      })
    );
  });

  it("records an existing transfer before handling a new dispute", async () => {
    mocks.transferList.mockResolvedValue(exactPage());
    const { admin, rpc } = fakeAdmin({
      claimed: [frozenIntent()],
      order: {
        id: "order-a",
        status: "disputed",
        seller_id: "seller-a",
        total_cents: 5000,
        platform_fee_cents: 500,
        refunded_cents: 0,
        transfer_reference: null,
        delivered_at: new Date(0).toISOString(),
      },
      rpc: { complete_transfer_intent: { data: "recovery" } },
    });
    await expect(processDueTransfers(admin)).resolves.toMatchObject({ failed: 1 });
    expect(mocks.transferCreate).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledWith(
      "complete_transfer_intent",
      expect.objectContaining({ p_transfer_reference: "tr_exact" })
    );
    expect(rpc).not.toHaveBeenCalledWith("release_transfer_intent", expect.any(Object));
  });

  it("does not invent a new amount when reconciliation is empty", async () => {
    mocks.reversalShareCents.mockReturnValue(100);
    const { admin, rpc } = fakeAdmin({
      claimed: [frozenIntent()],
      rpc: { record_transfer_recovery: { data: "recovery-a" } },
    });
    await expect(processDueTransfers(admin)).resolves.toMatchObject({ failed: 1 });
    expect(mocks.transferCreate).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledWith(
      "record_transfer_recovery",
      expect.objectContaining({ p_amount: 4500 })
    );
  });

  it("requeues provider uncertainty when Stripe lookup is unavailable", async () => {
    mocks.transferList.mockRejectedValue(new Error("provider timeout"));
    const { admin, rpc } = fakeAdmin({ claimed: [frozenIntent()] });
    await expect(processDueTransfers(admin)).resolves.toMatchObject({ failed: 1 });
    expect(mocks.transferCreate).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledWith(
      "release_transfer_intent",
      expect.objectContaining({ p_status: "failed", p_attempts: 1 })
    );
  });
});

// 20261107130000 (readiness B9): an unresolved bank chargeback freezes the
// payout even when an in-app close or a refund has put the order back to
// delivered (every fixture order here is delivered, past its clearing time).
describe("bank chargeback freeze", () => {
  const chargeback = (state: string) => [{ dispute_id: "dp_guard", state }];

  it.each(["open", "loss_pending", "recovery", "a_state_added_later"])(
    "shelves a fresh payout while the chargeback is %s",
    async (state) => {
      const { admin, rpc, journalFilters } = fakeAdmin({
        claimed: [intent()],
        chargebacks: [chargeback(state)],
      });
      await expect(processDueTransfers(admin)).resolves.toMatchObject({
        requeued: 1,
        transferred: 0,
      });
      expect(journalFilters).toContainEqual({
        table: "stripe_dispute_journal",
        column: "order_ids",
        value: ["order-a"],
      });
      expect(rpc).toHaveBeenCalledWith("release_transfer_intent", {
        p_order: "order-a",
        p_worker: expect.stringMatching(/^worker:/),
        p_status: "holding",
        p_last_error: CHARGEBACK_HOLD_REASON,
        p_attempts: null,
        p_next_attempt_at: null,
      });
      expect(rpc).not.toHaveBeenCalledWith("freeze_transfer_carry", expect.anything());
      expect(rpc).not.toHaveBeenCalledWith("prepare_transfer_dispatch", expect.anything());
      expect(mocks.transferCreate).not.toHaveBeenCalled();
      expect(mocks.paymentIntentRetrieve).not.toHaveBeenCalled();
    }
  );

  it.each(["won", "warning_closed", "lost"])(
    "pays on the normal schedule once the chargeback is %s",
    async (state) => {
      const { admin, rpc } = fakeAdmin({
        claimed: [intent()],
        chargebacks: [chargeback(state)],
      });
      await expect(processDueTransfers(admin)).resolves.toMatchObject({ transferred: 1 });
      expect(rpc).toHaveBeenCalledWith(
        "prepare_transfer_dispatch",
        expect.objectContaining({ p_amount_cents: 4500 })
      );
      expect(mocks.transferCreate).toHaveBeenCalledTimes(1);
    }
  );

  it("is frozen by one unresolved chargeback among resolved ones", async () => {
    const { admin } = fakeAdmin({
      claimed: [intent()],
      chargebacks: [
        [
          { dispute_id: "dp_old", state: "won" },
          { dispute_id: "dp_new", state: "open" },
        ],
      ],
    });
    await expect(processDueTransfers(admin)).resolves.toMatchObject({ requeued: 1 });
    expect(mocks.transferCreate).not.toHaveBeenCalled();
  });

  it("never pays when the journal can't be read", async () => {
    const { admin, rpc } = fakeAdmin({
      claimed: [intent()],
      chargebackError: { message: "journal unavailable" },
    });
    await expect(processDueTransfers(admin)).resolves.toMatchObject({ failed: 1 });
    expect(mocks.transferCreate).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledWith(
      "release_transfer_intent",
      expect.objectContaining({ p_status: "failed", p_attempts: 1 })
    );
  });

  it("records a transfer Stripe already made instead of sending a second one", async () => {
    mocks.transferList.mockResolvedValue(exactPage());
    const { admin, rpc } = fakeAdmin({
      claimed: [frozenIntent()],
      chargebacks: [chargeback("open")],
      // The database records it and opens an operator case (complete_transfer_intent).
      rpc: { complete_transfer_intent: { data: "recovery" } },
    });
    await expect(processDueTransfers(admin)).resolves.toMatchObject({ failed: 1 });
    expect(mocks.transferCreate).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledWith(
      "complete_transfer_intent",
      expect.objectContaining({
        p_operation_key: dispatch.operationKey,
        p_transfer_reference: "tr_exact",
      })
    );
    expect(rpc).not.toHaveBeenCalledWith("release_transfer_intent", expect.any(Object));
  });

  it("shelves an uncertain payout Stripe never made, keeping its frozen request", async () => {
    const { admin, rpc } = fakeAdmin({
      claimed: [frozenIntent()],
      chargebacks: [chargeback("recovery")],
    });
    await expect(processDueTransfers(admin)).resolves.toMatchObject({ requeued: 1 });
    // It reconciled first: a possible provider effect is never skipped.
    expect(mocks.transferList).toHaveBeenCalled();
    expect(mocks.transferCreate).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalledWith("prepare_transfer_dispatch", expect.anything());
    expect(rpc).not.toHaveBeenCalledWith("record_transfer_recovery", expect.anything());
    // Still reachable: a backed-off reconciliation time, not an open-ended
    // shelf, because Stripe may yet complete the earlier request.
    const calls = rpc.mock.calls as unknown as Array<[string, Record<string, unknown>]>;
    const release = calls.find(([name]) => name === "release_transfer_intent")?.[1];
    expect(release).toMatchObject({
      p_status: "holding",
      p_last_error: CHARGEBACK_HOLD_REASON,
      p_attempts: 1,
    });
    const retryAt = Date.parse(String(release?.p_next_attempt_at));
    expect(retryAt).toBeGreaterThan(Date.now());
    expect(retryAt).toBeLessThanOrEqual(Date.now() + 2 * 60_000 + 1_000);
  });

  it("records a transfer that appeared at Stripe after an earlier empty check", async () => {
    // First pass: nothing yet (the request is in flight), so it is shelved.
    const first = fakeAdmin({ claimed: [frozenIntent()], chargebacks: [chargeback("recovery")] });
    await expect(processDueTransfers(first.admin)).resolves.toMatchObject({ requeued: 1 });
    // A later pass, claimed again during the same chargeback, finds it.
    mocks.transferList.mockResolvedValue(exactPage());
    const later = fakeAdmin({
      claimed: [frozenIntent({ attempts: 1 })],
      chargebacks: [chargeback("recovery")],
      rpc: { complete_transfer_intent: { data: "recovery" } },
    });
    await expect(processDueTransfers(later.admin)).resolves.toMatchObject({ failed: 1 });
    expect(later.rpc).toHaveBeenCalledWith(
      "complete_transfer_intent",
      expect.objectContaining({ p_transfer_reference: "tr_exact" })
    );
    expect(mocks.transferCreate).not.toHaveBeenCalled();
  });

  // The order the chargeback put into `disputed` (it stays disputed for the
  // whole bank case), while an earlier worker's Stripe request was in flight.
  const disputedOrder = {
    id: "order-a",
    status: "disputed",
    seller_id: "seller-a",
    total_cents: 5000,
    platform_fee_cents: 500,
    refunded_cents: 0,
    transfer_reference: null,
    delivered_at: new Date(0).toISOString(),
  };

  it("keeps a disputed order's uncertain payout reachable and records the transfer on a later pass", async () => {
    // Pass 1: Stripe shows nothing yet. Shelved with a reconciliation time,
    // not on the plain readiness shelf the chargeback would never release.
    const first = fakeAdmin({
      claimed: [frozenIntent()],
      order: disputedOrder,
      chargebacks: [chargeback("open")],
    });
    await expect(processDueTransfers(first.admin)).resolves.toMatchObject({ requeued: 1 });
    expect(first.rpc).toHaveBeenCalledWith(
      "release_transfer_intent",
      expect.objectContaining({
        p_status: "holding",
        p_attempts: 1,
        p_next_attempt_at: expect.any(String),
        p_last_error: CHARGEBACK_HOLD_REASON,
      })
    );
    // Pass 2, claimed again on that time, order still disputed: still nothing.
    const second = fakeAdmin({
      claimed: [frozenIntent({ attempts: 1 })],
      order: disputedOrder,
      chargebacks: [chargeback("open")],
    });
    await expect(processDueTransfers(second.admin)).resolves.toMatchObject({ requeued: 1 });
    expect(second.rpc).toHaveBeenCalledWith(
      "release_transfer_intent",
      expect.objectContaining({ p_status: "holding", p_attempts: 2 })
    );
    // Pass 3: the in-flight request has completed at Stripe; it is recorded.
    mocks.transferList.mockResolvedValue(exactPage());
    const third = fakeAdmin({
      claimed: [frozenIntent({ attempts: 2 })],
      order: disputedOrder,
      chargebacks: [chargeback("open")],
      rpc: { complete_transfer_intent: { data: "recovery" } },
    });
    await expect(processDueTransfers(third.admin)).resolves.toMatchObject({ failed: 1 });
    expect(third.rpc).toHaveBeenCalledWith(
      "complete_transfer_intent",
      expect.objectContaining({
        p_operation_key: dispatch.operationKey,
        p_transfer_reference: "tr_exact",
      })
    );
    expect(mocks.transferCreate).not.toHaveBeenCalled();
  });

  it("asks an operator once a disputed order's reconciliation budget runs out", async () => {
    const { admin, rpc } = fakeAdmin({
      claimed: [frozenIntent({ attempts: 7 })],
      order: disputedOrder,
      chargebacks: [chargeback("loss_pending")],
    });
    await expect(processDueTransfers(admin)).resolves.toMatchObject({ failed: 1 });
    expect(mocks.transferCreate).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledWith(
      "record_transfer_recovery",
      expect.objectContaining({
        p_key: "transfer-unresolved:order-a",
        p_detail: expect.stringContaining("no transfer was found after 8 checks"),
      })
    );
    expect(rpc).not.toHaveBeenCalledWith("release_transfer_intent", expect.anything());
  });

  it("asks an operator once the reconciliation budget runs out during a chargeback", async () => {
    const { admin, rpc } = fakeAdmin({
      claimed: [frozenIntent({ attempts: 7 })],
      chargebacks: [chargeback("open")],
    });
    await expect(processDueTransfers(admin)).resolves.toMatchObject({ failed: 1 });
    expect(mocks.transferCreate).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledWith(
      "record_transfer_recovery",
      expect.objectContaining({
        p_key: "transfer-unresolved:order-a",
        p_detail: expect.stringContaining("bank chargeback"),
        p_amount: 4500,
      })
    );
    expect(rpc).not.toHaveBeenCalledWith("release_transfer_intent", expect.anything());
  });

  it("re-reads the journal after provider lookup and holds a chargeback that opened meanwhile", async () => {
    const { admin, rpc } = fakeAdmin({
      claimed: [frozenIntent()],
      chargebacks: [[], chargeback("open")],
    });
    await expect(processDueTransfers(admin)).resolves.toMatchObject({ requeued: 1 });
    expect(mocks.transferCreate).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalledWith("prepare_transfer_dispatch", expect.anything());
  });

  it("resends a frozen uncertain payout with its own key once the chargeback is won", async () => {
    const { admin, rpc } = fakeAdmin({
      claimed: [frozenIntent({ attempts: 1 })],
      chargebacks: [chargeback("won")],
    });
    await expect(processDueTransfers(admin)).resolves.toMatchObject({ transferred: 1 });
    expect(rpc).toHaveBeenCalledWith(
      "prepare_transfer_dispatch",
      expect.objectContaining({ p_operation_key: dispatch.operationKey, p_amount_cents: 4500 })
    );
    expect(mocks.transferCreate).toHaveBeenCalledTimes(1);
    expect(mocks.transferCreate).toHaveBeenCalledWith(expect.anything(), {
      idempotencyKey: dispatch.operationKey,
    });
  });

  it("calls no provider when the database refuses dispatch for a chargeback opened after the read", async () => {
    // prepare_transfer_dispatch shelves the row itself and answers false.
    const { admin, rpc } = fakeAdmin({
      claimed: [intent()],
      rpc: { prepare_transfer_dispatch: { data: false } },
    });
    await expect(processDueTransfers(admin)).resolves.toMatchObject({ failed: 1 });
    expect(mocks.transferCreate).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalledWith("release_transfer_intent", expect.any(Object));
    expect(rpc).not.toHaveBeenCalledWith("complete_transfer_intent", expect.any(Object));
  });
});

// 20261107130000: a full refund must not strand a payout Stripe may already
// have been called for. It is reconciled with backoff; a late transfer is
// recorded (the database opens a transfer_after_refund case for an operator,
// with no automatic reversal); only an exhausted budget cancels it.
describe("refunded order with a possibly-sent payout", () => {
  const refundedOrder = {
    id: "order-a",
    status: "refunded",
    seller_id: "seller-a",
    total_cents: 5000,
    platform_fee_cents: 500,
    refunded_cents: 5000,
    transfer_reference: null,
    delivered_at: new Date(0).toISOString(),
  };

  it("still cancels a refunded payout Stripe was never called for, at once", async () => {
    const { admin, rpc } = fakeAdmin({ claimed: [intent()], order: refundedOrder });
    await expect(processDueTransfers(admin)).resolves.toMatchObject({ cancelled: 1 });
    expect(rpc).toHaveBeenCalledWith(
      "release_transfer_intent",
      expect.objectContaining({ p_status: "cancelled", p_last_error: "order is refunded" })
    );
    expect(mocks.transferList).not.toHaveBeenCalled();
    expect(mocks.transferCreate).not.toHaveBeenCalled();
  });

  it("reconciles a crashed in-flight request instead of cancelling, then records the late transfer", async () => {
    // Pass 1, reclaimed after the crash: Stripe shows nothing yet.
    const first = fakeAdmin({ claimed: [frozenIntent()], order: refundedOrder });
    await expect(processDueTransfers(first.admin)).resolves.toMatchObject({ requeued: 1 });
    expect(first.rpc).toHaveBeenCalledWith(
      "release_transfer_intent",
      expect.objectContaining({
        p_status: "holding",
        p_attempts: 1,
        p_next_attempt_at: expect.any(String),
      })
    );
    expect(first.rpc).not.toHaveBeenCalledWith(
      "release_transfer_intent",
      expect.objectContaining({ p_status: "cancelled" })
    );
    // Pass 2, claimed on that time: the request completed at Stripe.
    mocks.transferList.mockResolvedValue(exactPage());
    const later = fakeAdmin({
      claimed: [frozenIntent({ attempts: 1 })],
      order: refundedOrder,
      rpc: { complete_transfer_intent: { data: "recovery" } },
    });
    await expect(processDueTransfers(later.admin)).resolves.toMatchObject({ failed: 1 });
    expect(later.rpc).toHaveBeenCalledWith(
      "complete_transfer_intent",
      expect.objectContaining({
        p_operation_key: dispatch.operationKey,
        p_transfer_reference: "tr_exact",
      })
    );
    expect(mocks.transferCreate).not.toHaveBeenCalled();
  });

  it("cancels only once the attempt budget has found no transfer", async () => {
    const { admin, rpc } = fakeAdmin({
      claimed: [frozenIntent({ attempts: 7 })],
      order: refundedOrder,
    });
    await expect(processDueTransfers(admin)).resolves.toMatchObject({ cancelled: 1 });
    expect(mocks.transferList).toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledWith(
      "release_transfer_intent",
      expect.objectContaining({
        p_status: "cancelled",
        p_attempts: 8,
        p_last_error: expect.stringContaining("no Stripe transfer found after 8 checks"),
      })
    );
    expect(rpc).not.toHaveBeenCalledWith("record_transfer_recovery", expect.anything());
    expect(mocks.transferCreate).not.toHaveBeenCalled();
  });
});

type QueuedResult = { data: unknown; error: unknown };

function queuedAdmin(...results: QueuedResult[]) {
  const builders = results.map((result) => {
    const builder: Record<string, unknown> = {};
    for (const method of ["select", "update", "eq", "is", "not", "in", "limit"]) {
      builder[method] = vi.fn(() => builder);
    }
    builder.maybeSingle = vi.fn(async () => result);
    builder.then = (
      resolve: (value: QueuedResult) => unknown,
      reject: (reason: unknown) => unknown
    ) => Promise.resolve(result).then(resolve, reject);
    return builder;
  });
  const from = vi.fn(() => {
    const builder = builders.shift();
    if (!builder) throw new Error("Unexpected database query");
    return builder;
  });
  return { admin: { from } as never, from, builders };
}

describe("transfer record reconciliation", () => {
  it("only considers provider-certain legacy intents for order-reference repair", async () => {
    const first = queuedAdmin(
      { data: [], error: null },
      { data: [], error: null }
    );

    await expect(reconcileTransferRecords(first.admin)).resolves.toEqual({
      ordersRepaired: 0,
      intentsRepaired: 0,
    });

    const legacyQuery = first.from.mock.results[1]?.value as Record<string, ReturnType<typeof vi.fn>>;
    expect(legacyQuery.in).toHaveBeenCalledWith("status", [
      "holding",
      "ready",
      "blocked_unpayable",
    ]);
    expect(legacyQuery.is).toHaveBeenCalledWith("operation_key", null);
    expect(legacyQuery.eq).toHaveBeenCalledWith("provider_call_may_have_occurred", false);
  });

  it("fails when an order repair affects no row and readback has a conflicting reference", async () => {
    const { admin } = queuedAdmin(
      {
        data: [
          {
            order_id: "order-a",
            transfer_reference: "tr_expected",
            orders: { transfer_reference: null },
          },
        ],
        error: null,
      },
      { data: null, error: null },
      { data: { transfer_reference: "tr_conflict" }, error: null }
    );

    await expect(reconcileTransferRecords(admin)).rejects.toThrow(
      "Could not verify repaired order transfer reference for order-a"
    );
  });

  it("fails when a legacy intent repair loses its compare-and-set race", async () => {
    const { admin } = queuedAdmin(
      { data: [], error: null },
      {
        data: [
          {
            order_id: "order-a",
            operation_key: null,
            provider_call_may_have_occurred: false,
            orders: { transfer_reference: "tr_expected" },
          },
        ],
        error: null,
      },
      { data: null, error: null },
      { data: { status: "failed", transfer_reference: null }, error: null }
    );

    await expect(reconcileTransferRecords(admin)).rejects.toThrow(
      "Could not verify repaired transfer intent for order-a"
    );
  });
});
