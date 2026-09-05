import { randomUUID } from "node:crypto";

import type Stripe from "stripe";

import { reportError } from "@/lib/monitoring";
import { createAdminClient } from "@/lib/supabase/admin";

import { stripeClient, stripeSecretKey } from "./stripe";

type Admin = ReturnType<typeof createAdminClient>;

const REVERSAL_PAGE_SIZE = 100;
const MAX_REVERSAL_PAGES = 10;
const REVERSAL_LEASE_SECONDS = 300;

export type ReversalIntent = {
  operationId: string;
  operationKey: string;
  orderId: string;
  transferReference: string;
  amountCents: number;
  currency: string;
};

export type ReversalReconciliation =
  | { kind: "found"; reversalId: string }
  | { kind: "absent" }
  | { kind: "unsafe"; reason: string };

export type ReversalRecoveryResult = {
  ok: boolean;
  reversedCents: number;
  recoveryId?: string;
  busy?: boolean;
};

function transferId(value: string | Stripe.Transfer): string {
  return typeof value === "string" ? value : value.id;
}

function exactReversalMatch(
  reversal: Stripe.TransferReversal,
  intent: ReversalIntent,
): boolean {
  return (
    transferId(reversal.transfer) === intent.transferReference &&
    reversal.metadata?.reversal_operation === intent.operationKey &&
    reversal.metadata?.operation_id === intent.operationId &&
    reversal.metadata?.order_id === intent.orderId &&
    reversal.amount === intent.amountCents &&
    reversal.currency.toLowerCase() === intent.currency
  );
}

function reversalRelatesToOperation(
  reversal: Stripe.TransferReversal,
  intent: ReversalIntent,
): boolean {
  return (
    reversal.metadata?.reversal_operation === intent.operationKey ||
    reversal.metadata?.operation_id === intent.operationId
  );
}

/** Scan the complete bounded history. Absence is safe only after every page. */
export async function findExistingReversal(
  intent: ReversalIntent,
): Promise<ReversalReconciliation> {
  const exact: Stripe.TransferReversal[] = [];
  const inconsistent: string[] = [];
  let startingAfter: string | undefined;

  for (let pageNumber = 0; pageNumber < MAX_REVERSAL_PAGES; pageNumber += 1) {
    const page = await stripeClient().transfers.listReversals(
      intent.transferReference,
      {
        limit: REVERSAL_PAGE_SIZE,
        ...(startingAfter ? { starting_after: startingAfter } : {}),
      },
      { timeout: 10_000, maxNetworkRetries: 0 },
    );
    for (const reversal of page.data) {
      if (exactReversalMatch(reversal, intent)) exact.push(reversal);
      else if (reversalRelatesToOperation(reversal, intent))
        inconsistent.push(reversal.id);
    }

    if (!page.has_more) break;
    const last = page.data.at(-1);
    if (!last) {
      return {
        kind: "unsafe",
        reason: "Stripe returned an empty reversal page with has_more",
      };
    }
    startingAfter = last.id;
    if (pageNumber === MAX_REVERSAL_PAGES - 1) {
      return {
        kind: "unsafe",
        reason: `Reversal lookup exceeded ${MAX_REVERSAL_PAGES * REVERSAL_PAGE_SIZE} records`,
      };
    }
  }

  if (exact.length === 1 && inconsistent.length === 0) {
    return { kind: "found", reversalId: exact[0].id };
  }
  if (exact.length > 1 || inconsistent.length > 0) {
    return {
      kind: "unsafe",
      reason: `Reversal lookup found ${exact.length} exact and ${inconsistent.length} inconsistent operation matches`,
    };
  }
  return { kind: "absent" };
}

async function hold(
  admin: Admin,
  intent: ReversalIntent,
  workerId: string,
  attempts: number,
  detail: string,
): Promise<string | undefined> {
  const backoffMinutes = Math.min(2 ** Math.min(attempts, 6), 60);
  const { data, error } = await admin.rpc("hold_refund_reversal", {
    p_operation: intent.operationId,
    p_worker: workerId,
    p_operation_key: intent.operationKey,
    p_detail: detail.slice(0, 2000),
    p_next_attempt_at: new Date(
      Date.now() + backoffMinutes * 60_000,
    ).toISOString(),
  });
  if (error)
    throw new Error(
      `Reversal recovery persistence failed: ${error.message ?? "unknown"}`,
    );
  return typeof data === "string" ? data : undefined;
}

async function complete(
  admin: Admin,
  intent: ReversalIntent,
  workerId: string,
  reversalId: string,
): Promise<void> {
  const { data, error } = await admin.rpc("complete_refund_reversal", {
    p_operation: intent.operationId,
    p_worker: workerId,
    p_operation_key: intent.operationKey,
    p_transfer_reference: intent.transferReference,
    p_amount_cents: intent.amountCents,
    p_currency: intent.currency,
    p_reversal_reference: reversalId,
  });
  if (error)
    throw new Error(
      `Reversal completion persistence failed: ${error.message ?? "unknown"}`,
    );
  if (data !== "completed")
    throw new Error(`Reversal completion lost ownership (${String(data)})`);
}

/**
 * Claims one reversal, reconciles Stripe before every possible reissue, then
 * records completion through a lease-checked database transition.
 */
export async function recoverTransferReversal(
  admin: Admin,
  input: {
    operationId: string;
    orderId: string;
    transferReference: string;
    amountCents: number;
    currency: string;
    reason: string;
    attempts: number;
  },
): Promise<ReversalRecoveryResult> {
  const intent: ReversalIntent = {
    operationId: input.operationId,
    operationKey: `reversal:${input.operationId}`,
    orderId: input.orderId,
    transferReference: input.transferReference,
    amountCents: input.amountCents,
    currency: input.currency.toLowerCase(),
  };
  const workerId = `reversal-worker:${randomUUID()}`;
  const { data: claim, error: claimError } = await admin.rpc(
    "claim_refund_reversal",
    {
      p_operation: intent.operationId,
      p_worker: workerId,
      p_transfer_reference: intent.transferReference,
      p_amount_cents: intent.amountCents,
      p_currency: intent.currency,
      p_operation_key: intent.operationKey,
      p_lease_seconds: REVERSAL_LEASE_SECONDS,
    },
  );
  if (claimError)
    throw new Error(
      `Reversal intent persistence failed: ${claimError.message ?? "unknown"}`,
    );
  if (claim === "completed")
    return { ok: true, reversedCents: intent.amountCents };
  if (claim === "busy") return { ok: false, reversedCents: 0, busy: true };
  if (claim !== "claimed") {
    throw new Error(`Reversal intent could not be claimed (${String(claim)})`);
  }

  let reconciliation: ReversalReconciliation;
  try {
    if (!stripeSecretKey())
      throw new Error("Stripe is unavailable for reversal reconciliation");
    reconciliation = await findExistingReversal(intent);
  } catch (error) {
    const detail = `Could not establish reversal history for ${intent.operationKey}: ${error instanceof Error ? error.message : String(error)}`;
    const recoveryId = await hold(
      admin,
      intent,
      workerId,
      input.attempts,
      detail,
    );
    reportError("[refunds] reversal reconciliation unavailable", {
      operationId: intent.operationId,
      error,
    });
    return { ok: false, reversedCents: 0, recoveryId };
  }

  if (reconciliation.kind === "unsafe") {
    const recoveryId = await hold(
      admin,
      intent,
      workerId,
      input.attempts,
      reconciliation.reason,
    );
    return { ok: false, reversedCents: 0, recoveryId };
  }
  if (reconciliation.kind === "found") {
    try {
      await complete(admin, intent, workerId, reconciliation.reversalId);
      return { ok: true, reversedCents: intent.amountCents };
    } catch (error) {
      const detail =
        `Stripe reversal ${reconciliation.reversalId} was found, but local completion failed: ` +
        (error instanceof Error ? error.message : String(error));
      const recoveryId = await hold(
        admin,
        intent,
        workerId,
        input.attempts,
        detail,
      );
      reportError("[refunds] recovered reversal completion failed", {
        operationId: intent.operationId,
        reversal: reconciliation.reversalId,
        error,
      });
      return { ok: false, reversedCents: 0, recoveryId };
    }
  }

  const { data: renewed, error: renewError } = await admin.rpc(
    "renew_refund_reversal_lease",
    {
      p_operation: intent.operationId,
      p_worker: workerId,
      p_operation_key: intent.operationKey,
      p_lease_seconds: REVERSAL_LEASE_SECONDS,
    },
  );
  if (renewError)
    throw new Error(
      `Reversal lease check failed: ${renewError.message ?? "unknown"}`,
    );
  if (renewed !== true) return { ok: false, reversedCents: 0, busy: true };

  let reversal: Stripe.TransferReversal;
  try {
    reversal = await stripeClient().transfers.createReversal(
      intent.transferReference,
      {
        amount: intent.amountCents,
        metadata: {
          order_id: intent.orderId,
          operation_id: intent.operationId,
          reversal_operation: intent.operationKey,
          reason: input.reason.slice(0, 480),
        },
      },
      { idempotencyKey: intent.operationKey, timeout: 10_000, maxNetworkRetries: 0 },
    );
  } catch (error) {
    const detail =
      `Refund reversal ${intent.operationKey} has an unknown provider outcome: ` +
      (error instanceof Error ? error.message : String(error));
    const recoveryId = await hold(
      admin,
      intent,
      workerId,
      input.attempts,
      detail,
    );
    reportError("[refunds] transfer reversal uncertain", {
      operationId: intent.operationId,
      transfer: intent.transferReference,
      amount: intent.amountCents,
      error,
    });
    return { ok: false, reversedCents: 0, recoveryId };
  }

  try {
    await complete(admin, intent, workerId, reversal.id);
    return { ok: true, reversedCents: intent.amountCents };
  } catch (error) {
    const detail =
      `Stripe reversal ${reversal.id} succeeded, but local completion failed: ` +
      (error instanceof Error ? error.message : String(error));
    const recoveryId = await hold(
      admin,
      intent,
      workerId,
      input.attempts,
      detail,
    );
    reportError("[refunds] reversal success persistence failed", {
      operationId: intent.operationId,
      reversal: reversal.id,
      error,
    });
    return { ok: false, reversedCents: 0, recoveryId };
  }
}
