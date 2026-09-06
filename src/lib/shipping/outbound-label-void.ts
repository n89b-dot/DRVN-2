import "server-only";

import { reportError } from "@/lib/monitoring";
import type { createAdminClient } from "@/lib/supabase/admin";

import { getShippingProvider } from "./provider";
import type { ShippingProvider, VoidLabelResult } from "./types";

type Admin = ReturnType<typeof createAdminClient>;

type SavedVoid = {
  provider: string;
  provider_shipment_reference: string;
  status: "requested" | "provider_pending" | "completed" | "rejected";
  attempts: number;
};

type Claim = {
  action: "dispatch" | "reconcile" | "completed" | "rejected";
  request: SavedVoid;
  observation_started_at: string;
};

export type OutboundLabelVoidOutcome = "refunded" | "rejected" | "pending";

async function observe(
  admin: Admin,
  input: {
    shipmentId: string;
    workerId: string;
    source: "dispatch" | "reconcile";
    result: VoidLabelResult;
    attempt: number;
    observedAt: string;
    detail?: string;
  }
): Promise<OutboundLabelVoidOutcome> {
  const observation = await admin.rpc("record_outbound_label_void_observation", {
    p_shipment: input.shipmentId,
    p_worker: input.workerId,
    p_source: input.source,
    p_state: input.result.state,
    p_attempt: input.attempt,
    p_observed_at: input.observedAt,
    p_detail: input.detail,
  });
  const state = (observation.data as { state?: OutboundLabelVoidOutcome } | null)?.state;
  if (observation.error || !state) {
    throw new Error("The carrier outcome could not be committed; the saved void request needs reconciliation");
  }
  return state;
}

/**
 * Freezes the exact purchased label before requesting a carrier refund. One
 * worker owns the initial POST. Every concurrent/lost-response retry reads
 * the same provider Shipment; a POST can only be reissued after an expired
 * lease and a later provider read explicitly reports refund_status=null.
 */
export async function ensureOutboundLabelVoid(admin: Admin, input: {
  shipmentId: string;
  actorId: string;
  provider: ShippingProvider;
  workerId?: string;
}): Promise<OutboundLabelVoidOutcome> {
  const workerId = input.workerId ?? crypto.randomUUID();
  const prepared = await admin.rpc("prepare_outbound_label_void", {
    p_shipment: input.shipmentId,
    p_actor: input.actorId,
    p_provider: input.provider.name,
  });
  if (prepared.error || !prepared.data) throw new Error("Could not persist the outbound label void request");

  const saved = prepared.data as unknown as SavedVoid;
  if (saved.provider !== input.provider.name) throw new Error("Outbound label void provider changed");

  const claimRequest = async (): Promise<Claim> => {
    const claimed = await admin.rpc("claim_outbound_label_void", {
      p_shipment: input.shipmentId,
      p_worker: workerId,
    });
    if (claimed.error || !claimed.data) throw new Error("Could not claim the outbound label void request");
    return claimed.data as unknown as Claim;
  };

  const execute = async (
    claim: Claim,
    mayReclaim = true,
    dispatchConfirmed = false,
  ): Promise<OutboundLabelVoidOutcome> => {
    if (claim.action === "completed") return "refunded";
    if (claim.action === "rejected") return "rejected";
    if (claim.request.provider !== input.provider.name) throw new Error("Outbound label void provider changed");

    if (claim.action === "dispatch" && !dispatchConfirmed) {
      // Recheck ownership immediately before the POST so a worker which was
      // paused past its lease cannot act after another worker took ownership.
      const confirmed = await claimRequest();
      if (confirmed.action !== "dispatch") {
        if (confirmed.action === "completed") return "refunded";
        if (confirmed.action === "rejected") return "rejected";
        return "pending";
      }
      return execute(confirmed, mayReclaim, true);
    }

    const source = claim.action === "dispatch" ? "dispatch" : "reconcile";
    if (!claim.observation_started_at) throw new Error("Label refund claim omitted its database observation time");
    const observedAt = claim.observation_started_at;
    let result: VoidLabelResult;
    try {
      result = source === "dispatch"
        ? await input.provider.voidLabel({ shipmentRef: claim.request.provider_shipment_reference })
        : await input.provider.getLabelRefundStatus({
            shipmentRef: claim.request.provider_shipment_reference,
          });
    } catch (error) {
      const detail = error instanceof Error ? error.message : "provider error";
      try {
        await observe(admin, {
          shipmentId: input.shipmentId,
          workerId,
          source,
          result: { state: "unknown" },
          attempt: claim.request.attempts,
          observedAt,
          detail,
        });
      } catch {
        // The durable request and alert were already committed before the
        // provider call; preserve the original provider ambiguity.
      }
      throw new Error("The carrier refund outcome is unknown; its saved request needs reconciliation");
    }

    const outcome = await observe(admin, {
      shipmentId: input.shipmentId,
      workerId,
      source,
      result,
      attempt: claim.request.attempts,
      observedAt,
    });
    if (mayReclaim && source === "reconcile" && result.state === "not_requested") {
      // Usually the first lease is still live and this remains reconcile.
      // Once it expires, only this post-expiry exact read can authorize one
      // new owner to make the POST which a crashed worker never reached.
      const reclaimed = await claimRequest();
      return reclaimed.action === "reconcile" ? "pending" : execute(reclaimed, false);
    }
    return outcome;
  };

  return execute(await claimRequest());
}

export type OutboundLabelVoidWorkerSummary = {
  scanned: number;
  completed: number;
  pending: number;
  rejected: number;
  failed: number;
};

/** Bounded oldest-first reconciliation for the money-worker heartbeat. */
export async function reconcileOutboundLabelVoids(
  admin: Admin,
  opts: { batch?: number; provider?: ShippingProvider; now?: number } = {},
): Promise<OutboundLabelVoidWorkerSummary> {
  const batch = Math.max(1, Math.min(opts.batch ?? 5, 20));
  const now = opts.now ?? Date.now();
  const requestedBefore = new Date(now - 60_000).toISOString();
  const ordinaryBefore = new Date(now - 15 * 60_000).toISOString();
  const submittedBefore = new Date(now - 6 * 60 * 60_000).toISOString();
  const due = [
    `and(status.eq.requested,updated_at.lt.${requestedBefore})`,
    `and(status.eq.provider_pending,provider_state.eq.submitted,updated_at.lt.${submittedBefore})`,
    `and(status.eq.provider_pending,provider_state.in.(not_requested,unknown),updated_at.lt.${ordinaryBefore})`,
    `and(status.eq.provider_pending,provider_state.is.null,updated_at.lt.${ordinaryBefore})`,
  ].join(",");
  const queue = await admin
    .from("outbound_label_void_requests")
    .select("shipment_id,seller_id,provider")
    .or(due)
    .order("updated_at", { ascending: true })
    .limit(batch);
  if (queue.error) throw new Error("Outbound label refund queue unavailable");

  const summary: OutboundLabelVoidWorkerSummary = {
    scanned: 0,
    completed: 0,
    pending: 0,
    rejected: 0,
    failed: 0,
  };
  if (!queue.data?.length) return summary;
  const provider = opts.provider ?? getShippingProvider();
  for (const row of queue.data) {
    summary.scanned += 1;
    if (row.provider !== provider.name) {
      summary.failed += 1;
      reportError("[label-void] configured provider cannot reconcile saved request", {
        shipmentId: row.shipment_id,
        savedProvider: row.provider,
        configuredProvider: provider.name,
      });
      continue;
    }
    try {
      const outcome = await ensureOutboundLabelVoid(admin, {
        shipmentId: row.shipment_id,
        actorId: row.seller_id,
        provider,
      });
      if (outcome === "refunded") summary.completed += 1;
      else if (outcome === "rejected") summary.rejected += 1;
      else summary.pending += 1;
    } catch (error) {
      summary.failed += 1;
      reportError("[label-void] automatic reconciliation failed", {
        shipmentId: row.shipment_id,
        error,
      });
    }
  }
  return summary;
}
