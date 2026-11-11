import "server-only";

import { emailTransport, type EmailTransport } from "@/lib/email/send";
import { renderOrderEmail, type OrderEmailFacts, type OrderEmailKind } from "@/lib/email/order-messages";
import { sendAdminAlert } from "@/lib/admin/alerts";
import { reportError } from "@/lib/monitoring";
import { prefEnabled, type NotificationPrefKey } from "@/lib/notification-prefs";
import { siteUrl } from "@/lib/site";
import type { createAdminClient } from "@/lib/supabase/admin";

/**
 * The money pass's orderEmails family (report five #116, OS-W41): sends what
 * the outbox holds (20261111090000), one row at a time until the queue is
 * empty or its time is up (work review #147: the time sets the batch, not a
 * count). It runs after every money family has finished
 * (src/lib/money-worker.ts) and each provider call has its own timeout
 * (src/lib/email/resend.ts), so a provider that hangs or fails can delay only
 * these emails, never a transfer, a refund or a payout deadline.
 *
 * With no provider configured, everything waiting is skipped as 'email_off'.
 *
 * When our own account with the provider is at fault (a rotated or suspended
 * key, a sending domain that lapsed, a quota: `provider: true` on the
 * outcome), every message would fail the same way. The pass stops at the
 * first one, that row goes back to waiting without the attempt counted, and
 * an operator is alerted, at most once an hour. Nothing is dropped: every row
 * waiting at that moment is kept 72 hours, the ones the pass never reached
 * included. A row that does fail for good (five attempts, or a message the
 * provider refuses) raises an alert of its own, naming the order, so it is
 * never only a row in a table.
 *
 * A rate limit is nobody's fault (review of #204). Sends are spaced so the
 * provider's limit is not reached in the ordinary run. If it is reached
 * anyway, the pass stops, the row goes back without the attempt counted, and
 * nothing is claimed before the provider's own wait is over; the next pass
 * carries on. No alert: one line to monitoring every ten minutes at most.
 */

type Admin = ReturnType<typeof createAdminClient>;

/** A ceiling on one pass, far above what the time allows: a guard against a loop, not a rate. */
export const ORDER_EMAIL_BATCH = 2_000;
/** How long one pass may spend on emails when the money pass leaves it the time. */
export const ORDER_EMAIL_BUDGET_MS = 120_000;
/** The most one send may take, whatever the transport does; then it is retried later. */
export const ORDER_EMAIL_SEND_TIMEOUT_MS = 10_000;
/**
 * The least time from one send's start to the next. Resend's published
 * default is two requests a second; this keeps under it. To be confirmed on
 * the first real send (record row #1-H5).
 */
export const ORDER_EMAIL_GAP_MS = 550;
/** A rate limit is reported to monitoring at most this often. */
const RATE_LIMIT_REPORT_EVERY_MS = 10 * 60_000;
let rateLimitReportedAt = 0;

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
  order_cancelled: null,
  order_partially_refunded: null,
  dispatch_reminder: "order_updates",
};

/** The cancel reason the day-14 refund writes (src/lib/payments/payout-deadline.ts). */
const PAYOUT_DEADLINE_REASON = /payouts weren't set up within 14 days/i;

/** The reasons DRVN itself writes when it cancels an unpaid order (0007, 0012). A person's reason is never read into an email. */
const CHECKOUT_TIMEOUT_REASON = /^checkout not completed in time$/i;
const CHECKOUT_ABANDONED_REASON = /^checkout abandoned$/i;
/** The reason a lost card dispute writes (src/lib/payments/settlement.ts, recordExternalRefund). */
const CHARGEBACK_LOST_REASON = /^Card dispute lost \(/;
/** The dispute reason a card dispute writes (apply_stripe_dispute_event, hold_stripe_dispute). */
const CARD_DISPUTE_REASON = /^Card dispute /;

/**
 * `retrying` counts rows that will be tried again, a row held for a provider
 * fault included, so the family reads as failing while email is not going
 * out. `held` is 1 when the pass stopped for a provider fault. `limited` is
 * 1 when it stopped for a rate limit: that row is not in `retrying`, because
 * a rate limit is not the family failing. `repeatedKey` counts emails taken
 * as sent because the provider refused their key as already used.
 */
export type OrderEmailTally = { claimed: number; sent: number; skipped: number; retrying: number; failed: number; errors: number; held: number; limited: number; repeatedKey: number };

type Claimed = {
  id: string;
  attempt: number;
  recipient_id: string;
  order_id: string;
  kind: OrderEmailKind;
  email: string;
  guest: boolean;
  /** The recipient is the order's buyer (claim_order_emails). */
  buyer: boolean;
  notification_prefs: unknown;
};

async function facts(admin: Admin, row: Pick<Claimed, "order_id" | "recipient_id" | "kind" | "buyer">): Promise<OrderEmailFacts | null> {
  const orderId = row.order_id;
  const [{ data: order, error }, { data: items }, reminder] = await Promise.all([
    admin.from("orders").select("id, total_cents, refunded_cents, currency, dispatch_by, carrier, tracking_number, cancel_reason, dispute_reason").eq("id", orderId).maybeSingle(),
    admin.from("order_items").select("title").eq("order_id", orderId).order("id").limit(20),
    row.kind === "payout_setup_reminder"
      ? admin
          .from("payout_setup_reminders")
          .select("sale_count")
          .eq("seller_id", row.recipient_id)
          .eq("order_id", orderId)
          .order("reminded_on", { ascending: false })
          .limit(1)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  if (error || !order) return null;
  return {
    currency: order.currency,
    saleCount: reminder.data?.sale_count ?? 1,
    orderId: order.id,
    title: items?.[0]?.title ?? null,
    itemCount: items?.length ?? 1,
    totalCents: order.total_cents,
    dispatchBy: order.dispatch_by,
    carrier: order.carrier,
    trackingNumber: order.tracking_number,
    payoutDeadlineRefund: PAYOUT_DEADLINE_REASON.test(order.cancel_reason ?? ""),
    buyer: row.buyer,
    chargebackLost: CHARGEBACK_LOST_REASON.test(order.cancel_reason ?? ""),
    cardDispute: CARD_DISPUTE_REASON.test(order.dispute_reason ?? ""),
    refundedCents: order.refunded_cents ?? 0,
    cancelledBecause: CHECKOUT_TIMEOUT_REASON.test(order.cancel_reason ?? "") ? "timeout" : CHECKOUT_ABANDONED_REASON.test(order.cancel_reason ?? "") ? "abandoned" : null,
  };
}

async function complete(admin: Admin, row: Claimed, outcome: "sent" | "retry" | "rejected" | "provider" | "rate_limited" | "skipped", extra: { providerId?: string | null; error?: string; reason?: "muted" | "email_off" | "not_sent"; retryAfter?: number } = {}) {
  const { data, error } = await admin.rpc("complete_order_email", {
    p_id: row.id,
    p_attempt: row.attempt,
    p_outcome: outcome,
    ...(extra.providerId ? { p_provider_message_id: extra.providerId } : {}),
    ...(extra.error ? { p_error: extra.error.slice(0, 200) } : {}),
    ...(extra.reason ? { p_reason: extra.reason } : {}),
    ...(extra.retryAfter ? { p_retry_after: extra.retryAfter } : {}),
  });
  if (error) throw new Error(`Order email outcome not recorded: ${error.code}`);
  return data as string;
}

export async function processOrderEmails(
  admin: Admin,
  {
    batch = ORDER_EMAIL_BATCH,
    notAfter = Infinity,
    deadline = Math.min(Date.now() + ORDER_EMAIL_BUDGET_MS, notAfter),
    transport = emailTransport(),
    origin = siteUrl(),
    gapMs = ORDER_EMAIL_GAP_MS,
  }: {
    batch?: number;
    /** When the caller's own time ends (the money pass): emails stop then, whatever is left of their budget. */
    notAfter?: number;
    deadline?: number;
    transport?: EmailTransport | null;
    origin?: string;
    /** The least time between the starts of two sends. */
    gapMs?: number;
  } = {},
): Promise<OrderEmailTally> {
  const tally: OrderEmailTally = { claimed: 0, sent: 0, skipped: 0, retrying: 0, failed: 0, errors: 0, held: 0, limited: 0, repeatedKey: 0 };
  let lastSendAt = -Infinity;
  if (!transport) {
    const { data, error } = await admin.rpc("skip_order_emails_email_off");
    if (error) throw new Error(`Order email skip failed: ${error.code}`);
    tally.skipped = Number(data ?? 0);
    return tally;
  }
  // One row per claim: a row is leased (and its attempt counted) only when
  // it is about to be sent, so a pass that runs out of time never leaves
  // claimed rows waiting out a lease they were never tried under.
  // Until the queue is empty or the time is up. `batch` is only a ceiling.
  drain: while (Date.now() < deadline && tally.claimed < batch) {
    const { data, error } = await admin.rpc("claim_order_emails", { p_limit: 1 });
    if (error) throw new Error(`Order email claim failed: ${error.code}`);
    const claimed = (data ?? []) as unknown as Claimed[];
    if (claimed.length === 0) break;
    for (const row of claimed) {
      tally.claimed += 1;
      try {
        const pref = ORDER_EMAIL_PREF[row.kind];
        if (pref && !prefEnabled(row.notification_prefs, pref)) {
          await complete(admin, row, "skipped", { reason: "muted" });
          tally.skipped += 1;
          continue;
        }
        const loaded = await facts(admin, row);
        if (!loaded) {
          // Never handed to the provider: the retry keeps its window (20261111150000).
          await complete(admin, row, "retry", { error: "order unreadable", reason: "not_sent" });
          tally.retrying += 1;
          continue;
        }
        const message = renderOrderEmail(row.kind, loaded, { origin, guest: row.guest });
        const wait = lastSendAt + gapMs - Date.now();
        if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
        lastSendAt = Date.now();
        const outcome = await withTimeout<Awaited<ReturnType<EmailTransport["send"]>>>(
          transport.send({ to: row.email, ...message, idempotencyKey: `order-email/${row.id}` }),
          ORDER_EMAIL_SEND_TIMEOUT_MS,
          { status: "retry", reason: "send timed out or threw" },
        );
        if (outcome.status === "retry" && outcome.provider) {
          // Our account with the provider, not this message: every row would
          // fail the same way. Keep this one, stop, and tell an operator.
          await complete(admin, row, "provider", { error: outcome.reason });
          tally.held = 1;
          tally.retrying += 1;
          reportError("[order-emails] the email provider refused our account; order emails are waiting", { provider: transport.name, reason: outcome.reason });
          await sendAdminAlert({
            kind: "order_email_provider",
            title: "Order emails are not going out",
            detail: `${transport.name} refused our account (${outcome.reason}). Receipts, refund and dispatch emails are waiting, not lost: they are kept for 72 hours. Check the provider's API key, the sending domain and the plan's quota.`,
            dedupKey: `order-email-provider:${new Date().toISOString().slice(0, 13)}`,
          });
          break drain;
        }
        if (outcome.status === "retry" && outcome.rateLimited) {
          // The provider asked us to slow down. Not an attempt, not an alert:
          // the row goes back, the queue waits out the provider's time, and
          // the next pass carries on.
          await complete(admin, row, "rate_limited", { error: outcome.reason, retryAfter: outcome.retryAfterSeconds });
          tally.limited = 1;
          if (Date.now() - rateLimitReportedAt >= RATE_LIMIT_REPORT_EVERY_MS) {
            rateLimitReportedAt = Date.now();
            reportError("[order-emails] the email provider rate-limited a pass; it carries on next pass", { provider: transport.name, reason: outcome.reason, retryAfterSeconds: outcome.retryAfterSeconds ?? null });
          }
          break drain;
        }
        const status =
          outcome.status === "sent"
            ? await complete(admin, row, "sent", { providerId: outcome.providerId, ...(outcome.repeatedKey ? { error: `${transport.name}: taken as sent, the key was already used` } : {}) })
            : await complete(admin, row, outcome.status, { error: outcome.reason });
        if (outcome.status === "sent" && outcome.repeatedKey) tally.repeatedKey += 1;
        if (status === "sent") tally.sent += 1;
        else if (status === "pending") tally.retrying += 1;
        else if (status === "failed" || status === "skipped") {
          if (status === "failed") tally.failed += 1;
          else tally.skipped += 1;
          // An email that will now never be sent: said once, with its order (work review #147).
          reportError("[order-emails] an order email was not sent", { id: row.id, orderId: row.order_id, kind: row.kind, status, reason: outcome.status === "sent" ? null : outcome.reason });
          await sendAdminAlert({
            kind: "order_email_failed",
            title: status === "failed" ? "An order email failed after five attempts" : "The email provider refused an order email",
            detail: `${row.kind} for order ${row.order_id} (outbox row ${row.id}): ${outcome.status === "sent" ? "" : outcome.reason}. The recipient was not emailed; the in-app notice stands.`,
            orderId: row.order_id,
            dedupKey: `order-email-failed:${row.id}`,
          });
        }
      } catch (error) {
        // The lease runs out and the row is claimed again; the idempotency
        // key keeps the provider from sending it twice.
        tally.errors += 1;
        reportError("[order-emails] row not finished", { id: row.id, error: error instanceof Error ? error.message : "error" });
      }
    }
  }
  // One line for the pass, however many: these rows are marked sent on the
  // provider's refusal of a repeated key, not on its acceptance.
  if (tally.repeatedKey > 0) {
    reportError("[order-emails] emails taken as sent because their key was already used", { provider: transport.name, count: tally.repeatedKey });
  }
  return tally;
}
