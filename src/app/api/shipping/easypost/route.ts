import { createHmac, timingSafeEqual } from "node:crypto";

import { mapTracker } from "@/lib/shipping/easypost";
import {
  applyTrackingSummary,
  findShipmentForTracker,
} from "@/lib/shipping/apply-tracking";
import { createAdminClient } from "@/lib/supabase/admin";
import { flushMonitoring, reportError } from "@/lib/monitoring";

/**
 * EasyPost webhook (brief §18): tracker updates drive shipment status,
 * shipment event history, shipped/delivered timestamps and — through
 * apply-tracking — the order's fulfillment state.
 *
 * Safety properties, in order:
 *  - HMAC validation before anything: EasyPost signs the raw body with the
 *    webhook secret (X-Hmac-Signature: hmac-sha256-hex=<hex>). No secret
 *    configured → 500 (a misconfigured deploy must be loud); bad/missing
 *    signature → 400. Nothing unverified is ever parsed into effects.
 *  - Dedup via webhook_events (0019), ids prefixed "easypost:" so they can
 *    never collide with Stripe's. A replay 200s without effects; every
 *    handler downstream is idempotent anyway (event unique index, guarded
 *    status transitions, compare-and-set order updates).
 *  - Unknown event types and trackers for shipments we don't know are 200s —
 *    EasyPost retries on non-2xx, and retrying those can never succeed.
 *  - Failures processing a KNOWN tracker return 500 so EasyPost redelivers.
 */
export async function POST(request: Request): Promise<Response> {
  const secret = process.env.EASYPOST_WEBHOOK_SECRET;
  if (!secret) {
    reportError("[easypost-webhook] EASYPOST_WEBHOOK_SECRET not configured", {});
    return new Response("webhook not configured", { status: 500 });
  }

  const payload = await request.text();
  const signature = request.headers.get("x-hmac-signature");
  if (!signature || !verifySignature(payload, signature, secret)) {
    return new Response("invalid signature", { status: 400 });
  }

  let event: { id?: unknown; description?: unknown; result?: unknown };
  try {
    event = JSON.parse(payload);
  } catch {
    return new Response("invalid payload", { status: 400 });
  }
  const eventId = typeof event.id === "string" ? event.id : null;
  const description = typeof event.description === "string" ? event.description : "unknown";
  if (!eventId) return new Response("invalid payload", { status: 400 });

  const admin = createAdminClient();
  const claimId = `easypost:${eventId}`;

  try {
    const fresh = await claimEvent(admin, claimId, description);
    if (!fresh) return new Response("duplicate", { status: 200 });

    if (description === "tracker.updated" || description === "tracker.created") {
      const tracker = event.result;
      if (tracker && typeof tracker === "object") {
        const summary = mapTracker(tracker as Record<string, unknown>);
        const shipment = await findShipmentForTracker(admin, summary);
        if (shipment) {
          await applyTrackingSummary(admin, shipment, summary);
        }
        // No matching shipment: a tracker created outside DRVN's records
        // (test events, console experiments). Nothing to retry.
      }
    }
    // Other descriptions (refund.*, batch.*): acknowledged, not consumed yet.

    await admin
      .from("webhook_events")
      .update({ processed_at: new Date().toISOString() })
      .eq("id", claimId);
    return new Response("ok", { status: 200 });
  } catch (error) {
    reportError("[easypost-webhook] processing failed", { eventId, description, error });
    // Unprocessed (no processed_at stamp) — EasyPost redelivers, and the
    // claim logic reprocesses an unstamped event.
    return new Response("processing failed", { status: 500 });
  } finally {
    await flushMonitoring();
  }
}

function verifySignature(payload: string, header: string, secret: string): boolean {
  const expected = createHmac("sha256", secret).update(payload, "utf8").digest("hex");
  const provided = header.replace(/^hmac-sha256-hex=/, "").trim();
  if (provided.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(provided, "utf8"), Buffer.from(expected, "utf8"));
  } catch {
    return false;
  }
}

/** Same semantics as the Stripe claim (settlement.ts): true = process it.
 *  A crashed first pass (row exists, processed_at null) reprocesses; insert
 *  errors fail open because every handler is idempotent. */
async function claimEvent(
  admin: ReturnType<typeof createAdminClient>,
  id: string,
  type: string
): Promise<boolean> {
  const { error } = await admin.from("webhook_events").insert({ id, type });
  if (!error) return true;
  if (error.code === "23505") {
    const { data } = await admin
      .from("webhook_events")
      .select("processed_at")
      .eq("id", id)
      .maybeSingle();
    return !data?.processed_at;
  }
  reportError("[easypost-webhook] event claim failed", { id, error });
  return true;
}
