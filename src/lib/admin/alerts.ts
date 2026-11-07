// No "server-only" guard: this module sits in the import graph of
// unit-tested payment code (vitest runs without the RSC condition). It holds
// no secrets beyond reading an env var, and everything importing it is
// already server-only.
import { createAdminClient } from "@/lib/supabase/admin";
import { reportError } from "@/lib/monitoring";

/**
 * Push alerting for the events an operator must not discover by polling —
 * now backed by a durable outbox (admin_alert_outbox, 0026) instead of a
 * fire-and-forget fetch.
 *
 * The contract: `sendAdminAlert` ENQUEUES (the durable commitment — callers
 * may stamp "alerted" once it returns, because delivery is now the outbox's
 * problem), then attempts immediate delivery inline. Failures leave the row
 * `pending` with backoff; `processAlertOutbox` (piggybacked on the jobs
 * route, plus the console's manual run) retries until delivered or attempts
 * exhaust into a visible `failed` row. An unset ADMIN_ALERT_WEBHOOK_URL is
 * recorded as `disabled` — visible in ops, never pretended delivered.
 * `dedupKey` collapses repeats of the same logical alert.
 *
 * Delivery failure never fails the calling mutation — money paths do not
 * depend on the messenger.
 */

export type AdminAlert = {
  kind:
    | "dispute_over_sla"
    | "dispute_escalated"
    | "dispute_auto_refund_failed"
    | "recovery_case_opened"
    | "transfer_stuck"
    | "media_cleanup_stuck"
    | "copyright_notice"
    | "test";
  title: string;
  detail?: string;
  orderId?: string | null;
  amountCents?: number | null;
  /** Same key = same logical alert; only the first enqueue survives. */
  dedupKey?: string;
};

const MAX_DELIVERY_ATTEMPTS = 10;

type Admin = ReturnType<typeof createAdminClient>;

type OutboxRow = {
  id: string;
  kind: string;
  title: string;
  detail: string | null;
  order_id: string | null;
  amount_cents: number | null;
  attempts: number;
  /** As read; the claim swaps on it (see claimForDelivery). */
  next_attempt_at: string;
};

/** POST one alert to the webhook. Throws on failure. */
async function deliver(row: OutboxRow, url: string): Promise<void> {
  const amount = row.amount_cents != null ? ` · $${(row.amount_cents / 100).toFixed(2)}` : "";
  const order = row.order_id ? ` · order ${row.order_id.slice(0, 8)}` : "";
  const text = `[DRVN console] ${row.title}${amount}${order}${row.detail ? ` — ${row.detail}` : ""}`;

  // The row id goes with every attempt, so a receiver that can deduplicate
  // sees a re-send (after a lost "delivered" write) as the same alert.
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": row.id },
    body: JSON.stringify({
      text,
      alertId: row.id,
      kind: row.kind,
      title: row.title,
      detail: row.detail,
      orderId: row.order_id,
      amountCents: row.amount_cents,
    }),
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`webhook rejected delivery: HTTP ${res.status}`);
}

/** How long one delivery attempt holds a row before it can be tried again. */
const DELIVERY_LEASE_MS = 10 * 60_000;

/**
 * Takes a pending row for one delivery attempt by pushing its next attempt
 * out first. The inline send and the sweep can then never both deliver the
 * same row, and if the "delivered" write below fails the row isn't re-sent
 * until the lease runs out.
 *
 * The claim swaps on the `next_attempt_at` the caller read, not on "due by
 * this server's clock". A new row's time is the database's `now()`; compared
 * with a server clock running even slightly behind it, the row looked not yet
 * due, the inline send skipped it, and the alert waited for the next sweep.
 * Whoever changes the value first wins; everyone else sees it has moved.
 */
async function claimForDelivery(admin: Admin, row: OutboxRow): Promise<boolean> {
  const id = row.id;
  const { data, error } = await admin
    .from("admin_alert_outbox")
    .update({ next_attempt_at: new Date(Date.now() + DELIVERY_LEASE_MS).toISOString() })
    .eq("id", id)
    .eq("status", "pending")
    .eq("next_attempt_at", row.next_attempt_at)
    .select("id");
  if (error) {
    reportError("[alerts] outbox claim failed", { alertId: id, error });
    return false;
  }
  return Boolean(data?.length);
}

/**
 * Records a delivery. One retry, because a row left pending is sent again
 * when its lease ends; if both writes fail that duplicate is reported, and
 * the receiver can recognise it by the alert id.
 */
async function markDelivered(admin: Admin, id: string): Promise<void> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const { error } = await admin
      .from("admin_alert_outbox")
      .update({ status: "delivered", delivered_at: new Date().toISOString(), last_error: null })
      .eq("id", id);
    if (!error) return;
    if (attempt === 1) {
      reportError("[alerts] delivered alert could not be marked; it will be re-sent", {
        alertId: id,
        error,
      });
    }
  }
}

async function markAttemptFailed(admin: Admin, row: OutboxRow, error: unknown): Promise<void> {
  const attempts = row.attempts + 1;
  const exhausted = attempts >= MAX_DELIVERY_ATTEMPTS;
  const backoffMinutes = Math.min(2 ** Math.min(attempts, 7), 120);
  const { error: writeError } = await admin
    .from("admin_alert_outbox")
    .update({
      status: exhausted ? "failed" : "pending",
      attempts,
      next_attempt_at: new Date(Date.now() + backoffMinutes * 60_000).toISOString(),
      last_error: (error instanceof Error ? error.message : String(error)).slice(0, 500),
    })
    .eq("id", row.id);
  // Unrecorded, the attempt still ends with the claim's lease, so the row is
  // retried; only the attempt count and the reason are lost.
  if (writeError) {
    reportError("[alerts] failed delivery could not be recorded", { alertId: row.id, writeError });
  }
  if (exhausted) {
    reportError("[alerts] delivery attempts exhausted", { alertId: row.id, kind: row.kind });
  }
}

export async function sendAdminAlert(alert: AdminAlert): Promise<void> {
  try {
    const admin = createAdminClient();
    const url = process.env.ADMIN_ALERT_WEBHOOK_URL;

    const { data: inserted, error } = await admin
      .from("admin_alert_outbox")
      .insert({
        kind: alert.kind,
        title: alert.title,
        detail: alert.detail ?? null,
        order_id: alert.orderId ?? null,
        amount_cents: alert.amountCents ?? null,
        dedup_key: alert.dedupKey ?? null,
        status: url ? "pending" : "disabled",
      })
      .select("id, kind, title, detail, order_id, amount_cents, attempts, next_attempt_at")
      .maybeSingle();
    if (error) {
      // 23505 = dedup key already enqueued — exactly what we want.
      if (error.code !== "23505") {
        reportError("[alerts] outbox enqueue failed", { kind: alert.kind, error });
      }
      return;
    }
    if (!inserted || !url) return;

    // Immediate best-effort delivery; the outbox owns any retry.
    if (!(await claimForDelivery(admin, inserted))) return;
    try {
      await deliver(inserted, url);
      await markDelivered(admin, inserted.id);
    } catch (deliveryError) {
      await markAttemptFailed(admin, inserted, deliveryError);
    }
  } catch (error) {
    // Never let alerting break the calling mutation.
    reportError("[alerts] sendAdminAlert failed", { kind: alert.kind, error });
  }
}

/** Drain pending alerts whose backoff has elapsed. Bounded; safe to repeat. */
export async function processAlertOutbox(
  admin: Admin,
  opts: { batch?: number } = {}
): Promise<{ delivered: number; retrying: number; skipped: number }> {
  const summary = { delivered: 0, retrying: 0, skipped: 0 };
  const url = process.env.ADMIN_ALERT_WEBHOOK_URL;
  if (!url) return summary;

  const { data: pending, error: pendingError } = await admin
    .from("admin_alert_outbox")
    .select("id, kind, title, detail, order_id, amount_cents, attempts, next_attempt_at")
    .eq("status", "pending")
    .lte("next_attempt_at", new Date().toISOString())
    .order("created_at", { ascending: true })
    .limit(opts.batch ?? 25);
  if (pendingError) throw new Error("Alert queue unavailable");

  for (const row of pending ?? []) {
    // Another sweep or the inline send has it; leave it to them.
    if (!(await claimForDelivery(admin, row))) {
      summary.skipped += 1;
      continue;
    }
    try {
      await deliver(row, url);
      await markDelivered(admin, row.id);
      summary.delivered += 1;
    } catch (error) {
      await markAttemptFailed(admin, row, error);
      summary.retrying += 1;
    }
  }
  return summary;
}
