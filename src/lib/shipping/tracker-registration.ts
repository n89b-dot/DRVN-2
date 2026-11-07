import "server-only";

import { jobHeartbeat } from "@/lib/job-lease";
import { reportError } from "@/lib/monitoring";
import type { createAdminClient } from "@/lib/supabase/admin";

import { easypostProvider } from "./easypost";
import { resolveShippingMode } from "./provider";
import { stubShippingProvider } from "./stub";
import { ShippingProviderError, type ShippingProvider } from "./types";

/**
 * Carrier tracking for seller-entered tracking numbers (N110, OS-W30).
 *
 * Tracking is not label buying. DRVN Shipping (rates and labels) stays behind
 * FLAG_INTEGRATED_SHIPPING_V1; registering a tracking number with the
 * EasyPost tracker only needs the API key, so it runs whenever a key is
 * configured, flag or not. With no key it is off and dispatch carries on
 * without it — a seller is never refused for want of a tracker.
 *
 * Registration happens off the request path, after mark_order_dispatched has
 * checked the seller and queued a tracker_registration job in the same
 * transaction: markShipped tries once the response is sent (a few quick
 * attempts), and the money worker's shipping family claims what is left with
 * the shared remediation backoff. With no provider configured the worker
 * settles queued jobs as untracked, so they never sit overdue.
 */

type Admin = ReturnType<typeof createAdminClient>;
type EnvLike = Record<string, string | undefined>;

export type TrackingMode = "easypost" | "stub" | "off";

/** Pure over `env` for unit tests. Never throws: tracking failing to resolve must not stop a dispatch. */
export function resolveTrackingMode(env: EnvLike = process.env): TrackingMode {
  if (env.EASYPOST_API_KEY && env.SHIPPING_MODE !== "stub") return "easypost";
  try {
    // No key: only the dev/e2e stub tracks, and only where DRVN Shipping
    // itself would run on the stub.
    return resolveShippingMode(env) === "stub" ? "stub" : "off";
  } catch {
    return "off";
  }
}

export function getTrackingProvider(env: EnvLike = process.env): ShippingProvider | null {
  const mode = resolveTrackingMode(env);
  if (mode === "easypost") return easypostProvider;
  if (mode === "stub") return stubShippingProvider;
  return null;
}

export function trackingConfigured(env: EnvLike = process.env): boolean {
  return resolveTrackingMode(env) !== "off";
}

export type TrackerOutcome =
  /** The tracker reference is now on the shipment. */
  | "registered"
  /** It already had one (a DRVN label, an earlier attempt). No provider call. */
  | "already"
  /** Nothing to register: no tracking, no provider, or the shipment is over. */
  | "skipped"
  /** The provider refused this tracking number; retrying won't change that. */
  | "rejected";

const CLOSED_SHIPMENT = new Set(["cancelled", "failed", "delivered"]);

/** Auth or config failures are DRVN's to fix, so they stay retryable; any other 4xx is about the number. */
function rejectsTheNumber(error: unknown): boolean {
  return (
    error instanceof ShippingProviderError &&
    !error.retryable &&
    error.status !== null &&
    error.status >= 400 &&
    error.status < 500 &&
    error.status !== 401 &&
    error.status !== 403
  );
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Register one shipment's tracking number. Reads the shipment first, so a
 * shipment that already has a tracker costs no provider call; the write is a
 * compare-and-set on provider_tracker_id. Throws when every attempt failed
 * for a reason worth retrying later.
 */
export async function registerShipmentTracker(
  admin: Admin,
  shipmentId: string,
  opts: {
    provider?: ShippingProvider | null;
    attempts?: number;
    backoffMs?: number;
    sleep?: (ms: number) => Promise<void>;
  } = {},
): Promise<TrackerOutcome> {
  const provider = opts.provider === undefined ? getTrackingProvider() : opts.provider;
  if (!provider) return "skipped";

  const { data: shipment, error: readError } = await admin
    .from("shipments")
    .select("id, tracking_code, carrier, status, provider_tracker_id")
    .eq("id", shipmentId)
    .maybeSingle();
  if (readError) throw new Error("Shipment tracker state unavailable");
  if (!shipment?.tracking_code || CLOSED_SHIPMENT.has(shipment.status)) return "skipped";
  if (shipment.provider_tracker_id) return "already";

  const attempts = Math.max(1, opts.attempts ?? 3);
  const backoffMs = opts.backoffMs ?? 500;
  const sleep = opts.sleep ?? defaultSleep;
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const summary = await provider.createTracker({
        trackingCode: shipment.tracking_code,
        carrier: shipment.carrier,
      });
      if (!summary.trackerRef) {
        reportError("[tracker] provider returned no tracker reference", { shipmentId });
        return "rejected";
      }
      const { error: writeError } = await admin
        .from("shipments")
        .update({ provider: provider.name, provider_tracker_id: summary.trackerRef })
        .eq("id", shipmentId)
        .is("provider_tracker_id", null);
      if (writeError) throw new Error("Tracker reference write failed");
      return "registered";
    } catch (error) {
      if (rejectsTheNumber(error)) {
        reportError("[tracker] provider refused the tracking number", { shipmentId, error });
        return "rejected";
      }
      lastError = error;
      if (attempt < attempts) await sleep(backoffMs * 2 ** (attempt - 1));
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Tracker registration failed");
}

export type TrackerWorkerSummary = {
  claimed: number;
  registered: number;
  already: number;
  skipped: number;
  rejected: number;
  failed: number;
  /** No tracking provider configured: queued jobs were settled as untracked. */
  untracked?: true;
};

/** The durable retry: claim queued tracker_registration jobs and register each. */
export async function processTrackerRegistrations(
  admin: Admin,
  opts: { batch?: number; provider?: ShippingProvider | null } = {},
): Promise<TrackerWorkerSummary> {
  const summary: TrackerWorkerSummary = { claimed: 0, registered: 0, already: 0, skipped: 0, rejected: 0, failed: 0 };
  const provider = opts.provider === undefined ? getTrackingProvider() : opts.provider;
  // No provider: the dispatches stand untracked, exactly as before N110, and
  // their jobs are settled (skipped) rather than left due — the job-health
  // snapshot pages on a pending job 30 minutes overdue.

  const claimed = await admin.rpc("claim_remediation_jobs", {
    p_kind: "tracker_registration",
    p_limit: opts.batch ?? 10,
  });
  if (claimed.error) throw new Error("Tracker registration claim failed");
  type Job = { id: string; lease_id: string; payload: { shipment_id?: string } };
  for (const job of (claimed.data ?? []) as unknown as Job[]) {
    summary.claimed += 1;
    let failure: string | undefined;
    try {
      await jobHeartbeat(admin, job)();
      const shipmentId = job.payload?.shipment_id;
      // One attempt per claim: the queue's own backoff spaces the retries.
      const outcome = shipmentId && provider
        ? await registerShipmentTracker(admin, shipmentId, { provider, attempts: 1 })
        : "skipped";
      summary[outcome] += 1;
    } catch (error) {
      summary.failed += 1;
      failure = error instanceof Error ? error.message : "Tracker registration failed";
      reportError("[tracker] queued registration failed; it will retry", { jobId: job.id, error });
    }
    const finished = await admin.rpc("finish_remediation_job", { p_id: job.id, p_lease: job.lease_id, p_error: failure });
    if (finished.error) throw new Error("Tracker registration acknowledgement failed");
  }
  return provider ? summary : { ...summary, untracked: true };
}
