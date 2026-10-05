import type Stripe from "stripe";

import { sendAdminAlert } from "@/lib/admin/alerts";
import { mapBounded } from "@/lib/map-bounded";
import { reportError } from "@/lib/monitoring";
import type { createAdminClient } from "@/lib/supabase/admin";

import { stripeClient } from "./stripe";

/**
 * Pays out a seller's carry-forward credit (20261008100100).
 *
 * A label refunded after its order's payout went leaves the seller in credit
 * on seller_carry_entries. The database opens one seller_carry_payouts row
 * for the whole balance and takes it off the balance in the same transaction
 * (open_seller_carry_payouts); this worker turns each row into one Stripe
 * transfer to the seller's connected account.
 *
 * Unlike an order's payout there is no source charge: the money is DRVN's own
 * (the label refund came back to the platform), so the transfer comes from
 * the platform balance. If that balance is short, Stripe refuses and the row
 * retries with backoff.
 *
 * Sent exactly once: a live lease, a destination frozen before the first
 * call, the idempotency key and transfer group `carry-payout:{id}`, and — on
 * any retry after Stripe may have been reached — a lookup by that group
 * before creating anything.
 */

type Admin = ReturnType<typeof createAdminClient>;

const MAX_ATTEMPTS = 8;
const BATCH_SIZE = 8;
const LEASE_SECONDS = 300;
/** How long a payout to a seller who can't be paid yet waits before the next look. */
const UNPAYABLE_RECHECK_MS = 6 * 60 * 60_000;

export type CarryPayoutSummary = {
  opened: number;
  paid: number;
  waiting: number;
  cancelled: number;
  failed: number;
};

type PayoutRow = {
  id: string;
  seller_id: string | null;
  amount_cents: number;
  currency: string;
  attempts: number;
  destination: string | null;
  provider_call_may_have_occurred: boolean;
  transfer_reference: string | null;
};

class LeaseLostError extends Error {}

export function carryPayoutOperationKey(payoutId: string) {
  return `carry-payout:${payoutId}`;
}

export async function processCarryPayouts(admin: Admin): Promise<CarryPayoutSummary> {
  const summary: CarryPayoutSummary = { opened: 0, paid: 0, waiting: 0, cancelled: 0, failed: 0 };

  const { data: opened, error: openError } = await admin.rpc("open_seller_carry_payouts", {});
  if (openError) {
    reportError("[carry-payouts] open failed", { openError });
    throw new Error("Carry payout queue unavailable");
  }
  summary.opened = typeof opened === "number" ? opened : 0;

  const workerId = `carry-worker:${process.pid}:${Date.now().toString(36)}`;
  const { data: claimed, error: claimError } = await admin.rpc("claim_seller_carry_payouts", {
    p_worker: workerId,
    p_batch: BATCH_SIZE,
    p_lease_seconds: LEASE_SECONDS,
    p_max_attempts: MAX_ATTEMPTS,
  });
  if (claimError) {
    reportError("[carry-payouts] claim failed", { claimError });
    throw new Error("Carry payout queue unavailable");
  }

  await mapBounded((claimed as unknown as PayoutRow[] | null) ?? [], 2, async (payout) => {
    try {
      summary[await processOne(admin, payout, workerId)] += 1;
    } catch (error) {
      reportError("[carry-payouts] payout failed", { payoutId: payout.id, error });
      summary.failed += 1;
      // A newer owner decides the row now; a stale one must not write to it.
      if (error instanceof LeaseLostError) return;
      await recordFailure(admin, payout, workerId, error);
    }
  });
  return summary;
}

async function release(
  admin: Admin,
  payout: PayoutRow,
  workerId: string,
  fields: { status: "pending" | "failed" | "cancelled"; lastError: string | null; attempts?: number; nextAttemptAt?: string | null }
) {
  const { data, error } = await admin.rpc("release_seller_carry_payout", {
    p_id: payout.id,
    p_worker: workerId,
    p_status: fields.status,
    p_last_error: fields.lastError,
    p_attempts: fields.attempts ?? null,
    p_next_attempt_at: fields.nextAttemptAt ?? null,
  });
  if (error) throw new Error(`release_seller_carry_payout persistence failed: ${error.message}`);
  if (data !== true) throw new LeaseLostError(`Carry payout lease lost for ${payout.id}`);
}

async function recordFailure(admin: Admin, payout: PayoutRow, workerId: string, error: unknown) {
  const attempts = payout.attempts + 1;
  const message = (error instanceof Error ? error.message : String(error)).slice(0, 500);
  const exhausted = attempts >= MAX_ATTEMPTS;
  const backoffMinutes = Math.min(2 ** Math.min(attempts, 6), 120);
  try {
    await release(admin, payout, workerId, {
      status: "failed",
      lastError: message,
      attempts,
      // Exhausted rows are no longer claimed; an operator resolves them.
      nextAttemptAt: exhausted ? null : new Date(Date.now() + backoffMinutes * 60_000).toISOString(),
    });
  } catch (releaseError) {
    reportError("[carry-payouts] could not record failure", { payoutId: payout.id, releaseError });
    return;
  }
  if (exhausted) await alertStuck(payout, `Seller credit payout exhausted ${MAX_ATTEMPTS} attempts: ${message}`);
}

async function alertStuck(payout: PayoutRow, detail: string) {
  await sendAdminAlert({
    kind: "transfer_stuck",
    title: "Seller credit payout requires reconciliation",
    detail: `${detail} (seller_carry_payouts ${payout.id})`,
    amountCents: payout.amount_cents,
    dedupKey: `carry_payout_stuck:${payout.id}`,
  });
}

function destinationOf(transfer: Stripe.Transfer) {
  return typeof transfer.destination === "string" ? transfer.destination : (transfer.destination?.id ?? null);
}

/** The transfer an earlier attempt made for this payout, if Stripe has one. */
async function findSentTransfer(
  payout: PayoutRow,
  destination: string
): Promise<{ kind: "found"; transferId: string } | { kind: "absent" } | { kind: "unsafe"; reason: string }> {
  const key = carryPayoutOperationKey(payout.id);
  const page = await stripeClient().transfers.list({ transfer_group: key, limit: 10 });
  if (page.data.length === 0) return { kind: "absent" };
  const exact = page.data.filter(
    (transfer) =>
      transfer.metadata?.carry_payout_id === payout.id &&
      destinationOf(transfer) === destination &&
      transfer.amount === payout.amount_cents &&
      transfer.currency.toLowerCase() === payout.currency.toLowerCase()
  );
  if (exact.length === 1 && page.data.length === 1 && !page.has_more) {
    return { kind: "found", transferId: exact[0].id };
  }
  return {
    kind: "unsafe",
    reason: `Stripe has ${page.data.length}${page.has_more ? "+" : ""} transfers in group ${key}, ${exact.length} matching the payout`,
  };
}

async function complete(admin: Admin, payout: PayoutRow, workerId: string, transferId: string) {
  const { data, error } = await admin.rpc("complete_seller_carry_payout", {
    p_id: payout.id,
    p_worker: workerId,
    p_transfer_reference: transferId,
  });
  if (error) throw new Error(`complete_seller_carry_payout persistence failed: ${error.message}`);
  if (data !== "completed") throw new LeaseLostError(`Carry payout lease lost for ${payout.id}`);

  if (payout.seller_id) {
    const { error: notificationError } = await admin.from("notifications").insert({
      user_id: payout.seller_id,
      kind: "payout_sent",
      section: "marketplace",
      title: "Label credit added to your Stripe balance",
      body: "A shipping label refund that arrived after your payout was transferred to your Stripe balance. Bank payout timing follows your Stripe payout schedule.",
      href: "/settings#payouts",
      actor_id: null,
    });
    if (notificationError) reportError("[carry-payouts] seller notification failed", { payoutId: payout.id, notificationError });
  }
}

async function processOne(
  admin: Admin,
  payout: PayoutRow,
  workerId: string
): Promise<"paid" | "waiting" | "cancelled" | "failed"> {
  const uncertain = payout.provider_call_may_have_occurred;

  const { data: seller, error: sellerError } = payout.seller_id
    ? await admin.from("profiles").select("stripe_account_id, payouts_enabled").eq("id", payout.seller_id).maybeSingle()
    : { data: null, error: null };
  if (sellerError) throw new Error("Could not read seller payout account");

  if (!uncertain) {
    if (!payout.seller_id) {
      // The account is gone and nothing was sent: put the credit back on the
      // (now ownerless) ledger rather than leave a payout nobody can receive.
      await release(admin, payout, workerId, { status: "cancelled", lastError: "seller account deleted" });
      return "cancelled";
    }
    if (!seller?.stripe_account_id || !seller.payouts_enabled) {
      // A wait, not a failure: attempts are not used up while the seller
      // finishes payout onboarding.
      await release(admin, payout, workerId, {
        status: "pending",
        lastError: "seller has not completed payout onboarding",
        nextAttemptAt: new Date(Date.now() + UNPAYABLE_RECHECK_MS).toISOString(),
      });
      return "waiting";
    }
  }

  const wanted = payout.destination ?? seller?.stripe_account_id ?? null;
  if (!wanted) {
    // Stripe may have been called, but neither the row nor the seller says where.
    await release(admin, payout, workerId, { status: "failed", lastError: "no destination on record", attempts: MAX_ATTEMPTS });
    await alertStuck(payout, "Stripe may have been called but no destination is on record");
    return "failed";
  }

  if (uncertain) {
    const sent = await findSentTransfer(payout, wanted);
    if (sent.kind === "found") {
      await complete(admin, payout, workerId, sent.transferId);
      return "paid";
    }
    if (sent.kind === "unsafe") {
      await release(admin, payout, workerId, { status: "failed", lastError: sent.reason, attempts: MAX_ATTEMPTS });
      await alertStuck(payout, sent.reason);
      return "failed";
    }
  }

  // The last live-lease check before Stripe; also freezes the destination.
  const { data: destination, error: prepareError } = await admin.rpc("prepare_seller_carry_payout", {
    p_id: payout.id,
    p_worker: workerId,
    p_destination: wanted,
  });
  if (prepareError) throw new Error(`prepare_seller_carry_payout persistence failed: ${prepareError.message}`);
  if (typeof destination !== "string" || !destination) throw new LeaseLostError(`Carry payout lease lost for ${payout.id}`);

  const key = carryPayoutOperationKey(payout.id);
  const transfer = await stripeClient().transfers.create(
    {
      amount: payout.amount_cents,
      currency: payout.currency.toLowerCase(),
      destination,
      transfer_group: key,
      metadata: { carry_payout_id: payout.id, transfer_operation: key },
    },
    { idempotencyKey: key }
  );
  await complete(admin, payout, workerId, transfer.id);
  return "paid";
}
