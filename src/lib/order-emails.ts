import "server-only";

import { emailTransport, type EmailTransport } from "@/lib/email/send";
import { renderOrderEmail, type OrderEmailFacts, type OrderEmailKind } from "@/lib/email/order-messages";
import { reportError } from "@/lib/monitoring";
import { prefEnabled, type NotificationPrefKey } from "@/lib/notification-prefs";
import { siteUrl } from "@/lib/site";
import type { createAdminClient } from "@/lib/supabase/admin";

/**
 * The money pass's orderEmails family (report five #116, OS-W41): sends what
 * the outbox holds (20261110140000), a small batch at a time, inside its own
 * time budget. It runs after every money family has finished
 * (src/lib/money-worker.ts) and each provider call has its own timeout
 * (src/lib/email/resend.ts), so a provider that hangs or fails can delay only
 * these emails, never a transfer, a refund or a payout deadline.
 *
 * With no provider configured, everything waiting is skipped as 'email_off'.
 */

type Admin = ReturnType<typeof createAdminClient>;

export const ORDER_EMAIL_BATCH = 10;
export const ORDER_EMAIL_BUDGET_MS = 20_000;
/** The most one send may take, whatever the transport does; then it is retried later. */
export const ORDER_EMAIL_SEND_TIMEOUT_MS = 10_000;

function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(fallback), ms);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      () => { clearTimeout(timer); resolve(fallback); },
    );
  });
}

/**
 * Which preference can mute each email. Null: always sent. Receipts, refunds,
 * payout notices and anything from DRVN support are not optional, whatever
 * the in-app mute says (the reviewer's ruling, 10 Nov 2026).
 */
export const ORDER_EMAIL_PREF: Record<OrderEmailKind, NotificationPrefKey | null> = {
  order_sold: "offers_sales",
  order_paid: null,
  order_shipped: "order_updates",
  order_delivered: "order_updates",
  receipt_auto_confirmed: "order_updates",
  order_disputed: "order_updates",
  dispute_resolved: "order_updates",
  admin_action: null,
  order_refunded: null,
  payout_setup_reminder: null,
};

/** The cancel reason the day-14 refund writes (src/lib/payments/payout-deadline.ts). */
const PAYOUT_DEADLINE_REASON = /payouts weren't set up within 14 days/i;

export type OrderEmailTally = { claimed: number; sent: number; skipped: number; retrying: number; failed: number; errors: number };

type Claimed = {
  id: string;
  attempt: number;
  recipient_id: string;
  order_id: string;
  kind: OrderEmailKind;
  email: string;
  guest: boolean;
  notification_prefs: unknown;
};

async function facts(admin: Admin, orderId: string): Promise<OrderEmailFacts | null> {
  const [{ data: order, error }, { data: items }] = await Promise.all([
    admin.from("orders").select("id, total_cents, dispatch_by, carrier, tracking_number, cancel_reason").eq("id", orderId).maybeSingle(),
    admin.from("order_items").select("title").eq("order_id", orderId).order("id").limit(20),
  ]);
  if (error || !order) return null;
  return {
    orderId: order.id,
    title: items?.[0]?.title ?? null,
    itemCount: items?.length ?? 1,
    totalCents: order.total_cents,
    dispatchBy: order.dispatch_by,
    carrier: order.carrier,
    trackingNumber: order.tracking_number,
    payoutDeadlineRefund: PAYOUT_DEADLINE_REASON.test(order.cancel_reason ?? ""),
  };
}

async function complete(admin: Admin, row: Claimed, outcome: "sent" | "retry" | "rejected" | "skipped", extra: { providerId?: string | null; error?: string; reason?: "muted" | "email_off" } = {}) {
  const { data, error } = await admin.rpc("complete_order_email", {
    p_id: row.id,
    p_attempt: row.attempt,
    p_outcome: outcome,
    ...(extra.providerId ? { p_provider_message_id: extra.providerId } : {}),
    ...(extra.error ? { p_error: extra.error.slice(0, 200) } : {}),
    ...(extra.reason ? { p_reason: extra.reason } : {}),
  });
  if (error) throw new Error(`Order email outcome not recorded: ${error.code}`);
  return data as string;
}

export async function processOrderEmails(
  admin: Admin,
  { batch = ORDER_EMAIL_BATCH, deadline = Date.now() + ORDER_EMAIL_BUDGET_MS, transport = emailTransport(), origin = siteUrl() }: { batch?: number; deadline?: number; transport?: EmailTransport | null; origin?: string } = {},
): Promise<OrderEmailTally> {
  const tally: OrderEmailTally = { claimed: 0, sent: 0, skipped: 0, retrying: 0, failed: 0, errors: 0 };
  if (!transport) {
    const { data, error } = await admin.rpc("skip_order_emails_email_off");
    if (error) throw new Error(`Order email skip failed: ${error.code}`);
    tally.skipped = Number(data ?? 0);
    return tally;
  }
  while (Date.now() < deadline) {
    const { data, error } = await admin.rpc("claim_order_emails", { p_limit: batch });
    if (error) throw new Error(`Order email claim failed: ${error.code}`);
    const claimed = (data ?? []) as unknown as Claimed[];
    for (const row of claimed) {
      tally.claimed += 1;
      try {
        const pref = ORDER_EMAIL_PREF[row.kind];
        if (pref && !prefEnabled(row.notification_prefs, pref)) {
          await complete(admin, row, "skipped", { reason: "muted" });
          tally.skipped += 1;
          continue;
        }
        const loaded = await facts(admin, row.order_id);
        if (!loaded) {
          await complete(admin, row, "retry", { error: "order unreadable" });
          tally.retrying += 1;
          continue;
        }
        const message = renderOrderEmail(row.kind, loaded, { origin, guest: row.guest });
        const outcome = await withTimeout<Awaited<ReturnType<EmailTransport["send"]>>>(
          transport.send({ to: row.email, ...message, idempotencyKey: `order-email/${row.id}` }),
          ORDER_EMAIL_SEND_TIMEOUT_MS,
          { status: "retry", reason: "send timed out or threw" },
        );
        const status =
          outcome.status === "sent"
            ? await complete(admin, row, "sent", { providerId: outcome.providerId })
            : await complete(admin, row, outcome.status, { error: outcome.reason });
        if (status === "sent") tally.sent += 1;
        else if (status === "pending") tally.retrying += 1;
        else if (status === "failed") tally.failed += 1;
        else if (status === "skipped") tally.skipped += 1;
      } catch (error) {
        // The lease runs out and the row is claimed again; the idempotency
        // key keeps the provider from sending it twice.
        tally.errors += 1;
        reportError("[order-emails] row not finished", { id: row.id, error: error instanceof Error ? error.message : "error" });
      }
      if (Date.now() >= deadline) break;
    }
    if (claimed.length < batch) break;
  }
  return tally;
}
