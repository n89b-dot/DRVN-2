import { beforeEach, describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";

const mocks = vi.hoisted(() => ({
  listReversals: vi.fn(),
  createReversal: vi.fn(),
  stripeSecretKey: vi.fn(() => "sk_test_reversal"),
  reportError: vi.fn(),
}));

vi.mock("./stripe", () => ({
  stripeClient: () => ({
    transfers: {
      listReversals: mocks.listReversals,
      createReversal: mocks.createReversal,
    },
  }),
  stripeSecretKey: mocks.stripeSecretKey,
}));
vi.mock("@/lib/monitoring", () => ({ reportError: mocks.reportError }));

import {
  findExistingReversal,
  recoverTransferReversal,
  type ReversalIntent,
} from "./reversal-recovery";

const intent: ReversalIntent = {
  operationId: "22222222-2222-4222-8222-222222222222",
  operationKey: "reversal:22222222-2222-4222-8222-222222222222",
  orderId: "11111111-1111-4111-8111-111111111111",
  transferReference: "tr_original",
  amountCents: 2250,
  currency: "usd",
};

function reversal(
  overrides: Record<string, unknown> = {},
): Stripe.TransferReversal {
  return {
    id: "trr_exact",
    object: "transfer_reversal",
    transfer: intent.transferReference,
    amount: intent.amountCents,
    currency: intent.currency,
    metadata: {
      reversal_operation: intent.operationKey,
      operation_id: intent.operationId,
      order_id: intent.orderId,
    },
    ...overrides,
  } as unknown as Stripe.TransferReversal;
}

type RpcReply = { data: unknown; error: { message?: string } | null };

function fakeAdmin(
  handler: (
    name: string,
    args: Record<string, unknown>,
    call: number,
  ) => RpcReply = (name) => ({
    data:
      name === "claim_refund_reversal"
        ? "claimed"
        : name === "renew_refund_reversal_lease"
          ? true
          : name === "complete_refund_reversal"
            ? "completed"
            : "recovery-a",
    error: null,
  }),
) {
  let call = 0;
  const rpc = vi.fn(async (name: string, args: Record<string, unknown>) =>
    handler(name, args, call++),
  );
  return { admin: { rpc } as never, rpc };
}

const recoveryInput = {
  operationId: intent.operationId,
  orderId: intent.orderId,
  transferReference: intent.transferReference,
  amountCents: intent.amountCents,
  currency: "USD",
  reason: "buyer return",
  attempts: 0,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.stripeSecretKey.mockReturnValue("sk_test_reversal");
  mocks.listReversals.mockResolvedValue({ data: [], has_more: false });
  mocks.createReversal.mockResolvedValue(reversal());
});

describe("reversal provider reconciliation", () => {
  it("paginates to one exact transfer/operation/order/amount/currency match", async () => {
    mocks.listReversals
      .mockResolvedValueOnce({
        data: [reversal({ id: "trr_unrelated", metadata: {} })],
        has_more: true,
      })
      .mockResolvedValueOnce({ data: [reversal()], has_more: false });

    await expect(findExistingReversal(intent)).resolves.toEqual({
      kind: "found",
      reversalId: "trr_exact",
    });
    expect(mocks.listReversals).toHaveBeenNthCalledWith(1, "tr_original", {
      limit: 100,
    }, {timeout:10_000,maxNetworkRetries:0});
    expect(mocks.listReversals).toHaveBeenNthCalledWith(2, "tr_original", {
      limit: 100,
      starting_after: "trr_unrelated",
    }, {timeout:10_000,maxNetworkRetries:0});
  });

  it.each([
    ["transfer", { transfer: "tr_other" }],
    ["amount", { amount: 2249 }],
    ["currency", { currency: "eur" }],
    [
      "operation key",
      {
        metadata: {
          ...reversal().metadata,
          reversal_operation: "reversal:other",
        },
      },
    ],
    [
      "operation id",
      { metadata: { ...reversal().metadata, operation_id: "other" } },
    ],
    ["order id", { metadata: { ...reversal().metadata, order_id: "other" } }],
  ])("holds an operation-related %s mismatch", async (_field, override) => {
    const candidate = reversal(override);
    if (_field === "operation key") {
      candidate.metadata = {
        ...candidate.metadata,
        operation_id: intent.operationId,
      };
    }
    if (_field === "operation id") {
      candidate.metadata = {
        ...candidate.metadata,
        reversal_operation: intent.operationKey,
      };
    }
    mocks.listReversals.mockResolvedValue({
      data: [candidate],
      has_more: false,
    });
    await expect(findExistingReversal(intent)).resolves.toMatchObject({
      kind: "unsafe",
    });
  });

  it("does not choose between duplicate exact matches", async () => {
    mocks.listReversals.mockResolvedValue({
      data: [reversal({ id: "trr_one" }), reversal({ id: "trr_two" })],
      has_more: false,
    });
    await expect(findExistingReversal(intent)).resolves.toMatchObject({
      kind: "unsafe",
    });
  });

  it("fails closed when more than 1000 reversal records would be required", async () => {
    mocks.listReversals.mockResolvedValue({
      data: Array.from({ length: 100 }, (_, index) =>
        reversal({ id: `trr_unrelated_${index}`, metadata: {} }),
      ),
      has_more: true,
    });
    await expect(findExistingReversal(intent)).resolves.toEqual({
      kind: "unsafe",
      reason: "Reversal lookup exceeded 1000 records",
    });
    expect(mocks.listReversals).toHaveBeenCalledTimes(10);
  });
});

describe("reversal crash and concurrency recovery", () => {
  it("persists intent, reconciles, renews ownership, creates, then completes", async () => {
    const { admin, rpc } = fakeAdmin();
    await expect(
      recoverTransferReversal(admin, recoveryInput),
    ).resolves.toEqual({
      ok: true,
      reversedCents: 2250,
    });
    expect(rpc.mock.calls.map(([name]) => name)).toEqual([
      "claim_refund_reversal",
      "renew_refund_reversal_lease",
      "complete_refund_reversal",
    ]);
    expect(mocks.listReversals).toHaveBeenCalledBefore(mocks.createReversal);
    expect(mocks.createReversal).toHaveBeenCalledWith(
      "tr_original",
      expect.objectContaining({
        amount: 2250,
        metadata: expect.objectContaining({
          operation_id: intent.operationId,
          order_id: intent.orderId,
          reversal_operation: intent.operationKey,
        }),
      }),
      { idempotencyKey: intent.operationKey, timeout:10_000,maxNetworkRetries:0 },
    );
  });

  it("recovers success after a completion-write crash without reissuing after key expiry", async () => {
    const first = fakeAdmin((name) => {
      if (name === "claim_refund_reversal")
        return { data: "claimed", error: null };
      if (name === "renew_refund_reversal_lease")
        return { data: true, error: null };
      if (name === "complete_refund_reversal") {
        return {
          data: null,
          error: { message: "database disappeared after Stripe success" },
        };
      }
      return { data: "recovery-a", error: null };
    });
    await expect(
      recoverTransferReversal(first.admin, recoveryInput),
    ).resolves.toMatchObject({
      ok: false,
      recoveryId: "recovery-a",
    });
    expect(mocks.createReversal).toHaveBeenCalledTimes(1);
    expect(first.rpc).toHaveBeenCalledWith(
      "hold_refund_reversal",
      expect.objectContaining({
        p_detail: expect.stringContaining(
          "trr_exact succeeded, but local completion failed",
        ),
      }),
    );

    // Simulates a retry after Stripe has pruned the idempotency key: provider
    // history, rather than key retention, proves the original effect exists.
    mocks.listReversals.mockResolvedValue({
      data: [reversal()],
      has_more: false,
    });
    const retry = fakeAdmin();
    await expect(
      recoverTransferReversal(retry.admin, { ...recoveryInput, attempts: 1 }),
    ).resolves.toEqual({ ok: true, reversedCents: 2250 });
    expect(mocks.createReversal).toHaveBeenCalledTimes(1);
    expect(retry.rpc).toHaveBeenCalledWith(
      "complete_refund_reversal",
      expect.objectContaining({ p_reversal_reference: "trr_exact" }),
    );
  });

  it("holds an unavailable provider outcome in one durable recovery", async () => {
    mocks.listReversals.mockRejectedValue(new Error("provider timeout"));
    const { admin, rpc } = fakeAdmin();
    await expect(
      recoverTransferReversal(admin, recoveryInput),
    ).resolves.toMatchObject({
      ok: false,
      recoveryId: "recovery-a",
    });
    expect(mocks.createReversal).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledWith(
      "hold_refund_reversal",
      expect.objectContaining({ p_operation: intent.operationId }),
    );
  });

  it("holds an exact recovered reversal when its reference write fails", async () => {
    mocks.listReversals.mockResolvedValue({
      data: [reversal()],
      has_more: false,
    });
    const { admin, rpc } = fakeAdmin((name) => ({
      data:
        name === "claim_refund_reversal"
          ? "claimed"
          : name === "hold_refund_reversal"
            ? "recovery-a"
            : null,
      error:
        name === "complete_refund_reversal"
          ? { message: "reference write unavailable" }
          : null,
    }));
    await expect(
      recoverTransferReversal(admin, recoveryInput),
    ).resolves.toMatchObject({
      ok: false,
      recoveryId: "recovery-a",
    });
    expect(mocks.createReversal).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledWith(
      "hold_refund_reversal",
      expect.objectContaining({
        p_detail: expect.stringContaining("trr_exact was found"),
      }),
    );
  });

  it("does not issue when another worker owns the live lease", async () => {
    const { admin } = fakeAdmin((name) => ({
      data: name === "claim_refund_reversal" ? "busy" : null,
      error: null,
    }));
    await expect(
      recoverTransferReversal(admin, recoveryInput),
    ).resolves.toMatchObject({
      ok: false,
      busy: true,
    });
    expect(mocks.listReversals).not.toHaveBeenCalled();
    expect(mocks.createReversal).not.toHaveBeenCalled();
  });

  it("does not issue after its lease expires during provider reconciliation", async () => {
    const { admin } = fakeAdmin((name) => ({
      data:
        name === "claim_refund_reversal"
          ? "claimed"
          : name === "renew_refund_reversal_lease"
            ? false
            : null,
      error: null,
    }));
    await expect(
      recoverTransferReversal(admin, recoveryInput),
    ).resolves.toMatchObject({
      ok: false,
      busy: true,
    });
    expect(mocks.createReversal).not.toHaveBeenCalled();
  });

  it("holds inconsistent history instead of issuing an arbitrary reversal", async () => {
    mocks.listReversals.mockResolvedValue({
      data: [reversal({ amount: intent.amountCents - 1 })],
      has_more: false,
    });
    const { admin, rpc } = fakeAdmin();
    await expect(
      recoverTransferReversal(admin, recoveryInput),
    ).resolves.toMatchObject({
      ok: false,
      recoveryId: "recovery-a",
    });
    expect(mocks.createReversal).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledWith(
      "hold_refund_reversal",
      expect.objectContaining({
        p_detail: expect.stringContaining("inconsistent"),
      }),
    );
  });
});
