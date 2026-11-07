import { createHmac, timingSafeEqual } from "node:crypto";

import { recordWebhookFailure } from "@/lib/payments/webhook-failures";
import { dispatchEasyPostEvent } from "@/lib/shipping/webhook";
import { createAdminClient } from "@/lib/supabase/admin";
import { flushMonitoring, reportError } from "@/lib/monitoring";
import type { Json } from "@/lib/database.types";

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
 *  - Unknown event types are intentionally ignored. Unknown or ambiguous
 *    trackers remain unprocessed because the shipment may be persisted after
 *    an early provider callback; the retained payload can be replayed.
 *  - Failures processing tracker events return 500 so EasyPost redelivers.
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

  let claimed = false;
  try {
    const fresh = await claimEvent(admin, claimId, description, event as Json);
    if (!fresh) return new Response("duplicate", { status: 200 });
    claimed = true;

    await dispatchEasyPostEvent(admin, event);

    const { data: completed, error: completionError } = await admin
      .from("webhook_events")
      .update({ processed_at: new Date().toISOString() })
      .eq("id", claimId)
      .select("id")
      .maybeSingle();
    if (completionError || completed?.id !== claimId) {
      throw new Error("webhook completion could not be persisted");
    }
    return new Response("ok", { status: 200 });
  } catch (error) {
    reportError("[easypost-webhook] processing failed", { eventId, description, error });
    if (claimed) await recordWebhookFailure(admin, claimId, "error", { provider: "easypost", type: description, error });
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
 *  A crashed first pass (row exists, processed_at null) reprocesses. Database
 *  errors fail closed so no provider event is acknowledged without a durable
 *  claim and retained replay payload. */
async function claimEvent(
  admin: ReturnType<typeof createAdminClient>,
  id: string,
  type: string,
  payload: Json
): Promise<boolean> {
  const { data: claimed, error } = await admin
    .from("webhook_events")
    .insert({ id, type, payload })
    .select("id")
    .maybeSingle();
  if (!error && claimed?.id === id) return true;
  if (!error) throw new Error("webhook claim did not persist a row");
  if (error.code === "23505") {
    const { data, error: lookupError } = await admin
      .from("webhook_events")
      .select("processed_at, payload")
      .eq("id", id)
      .maybeSingle();
    if (lookupError || !data) throw new Error("existing webhook claim could not be verified");
    if (data.processed_at) return false;
    if (data.payload === null) {
      const { data: retained, error: retainError } = await admin
        .from("webhook_events")
        .update({ type, payload })
        .eq("id", id)
        .is("processed_at", null)
        .select("id")
        .maybeSingle();
      if (retainError || retained?.id !== id) {
        throw new Error("webhook replay payload could not be retained");
      }
    }
    return true;
  }
  reportError("[easypost-webhook] event claim failed", { id, error });
  throw new Error("webhook persistence unavailable; retry delivery");
}
