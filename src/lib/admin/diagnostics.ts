import type {
  AdminAuditLogEntry,
  Order,
  Payment,
  RefundOperation,
  TransferIntent,
  WebhookEvent,
} from "@/lib/database.types";

/**
 * The order diagnostics timeline (brief §AF): one chronological view of a
 * transaction assembled from records that already exist — order stamps,
 * payment, retained webhook events, the transfer intent, refund operations
 * and admin actions. Pure so it's unit-testable; the admin order sheet
 * renders the result. Correlation identity (orders.correlation_id, 0039)
 * names the basket; this function names the sequence.
 */

export type TimelineEvent = {
  at: string;
  source: "order" | "stripe" | "transfer" | "refund" | "dispute" | "admin";
  label: string;
  detail?: string;
};

function money(cents: number, currency: string): string {
  return `${(cents / 100).toFixed(2)} ${currency.toUpperCase()}`;
}

export function buildOrderTimeline({
  order,
  payment,
  transferIntent,
  refundOps,
  webhookEvents,
  audit,
}: {
  order: Order;
  payment: Payment | null;
  transferIntent: TransferIntent | null;
  refundOps: RefundOperation[];
  webhookEvents: WebhookEvent[];
  audit: AdminAuditLogEntry[];
}): TimelineEvent[] {
  const events: TimelineEvent[] = [];
  const push = (at: string | null, event: Omit<TimelineEvent, "at">) => {
    if (at) events.push({ at, ...event });
  };

  push(order.created_at, {
    source: "order",
    label: "Order placed",
    detail: money(order.total_cents, order.currency),
  });
  if (payment) {
    push(payment.created_at, {
      source: "order",
      label: "Payment record created",
      detail: payment.provider_reference ?? undefined,
    });
  }
  for (const event of webhookEvents) {
    push(event.received_at, {
      source: "stripe",
      label: `Stripe ${event.type}`,
      detail: event.processed_at
        ? undefined
        : event.failed_attempts > 0
          ? `not applied yet — ${event.failed_attempts} failed ${event.failed_attempts === 1 ? "delivery" : "deliveries"}, last ${event.last_failure_kind ?? "failure"}`
          : "received but not fully processed",
    });
  }
  push(order.shipped_at, {
    source: "order",
    label: "Shipped",
    detail: [order.carrier, order.tracking_number].filter(Boolean).join(" ") || undefined,
  });
  push(order.delivered_at, { source: "order", label: "Delivered (buyer confirmed)" });
  push(order.completed_at, { source: "order", label: "Completed" });
  push(order.cancelled_at, {
    source: "order",
    label: "Cancelled",
    detail: order.cancel_reason ?? undefined,
  });

  push(order.disputed_at, {
    source: "dispute",
    label: "Dispute opened",
    detail: (order.dispute_category ?? "other").replaceAll("_", " "),
  });
  push(order.dispute_escalated_at, {
    source: "dispute",
    label: order.dispute_escalated_by ? "Dispute escalated by the buyer" : "Dispute escalated by the SLA sweep",
  });
  push(order.dispute_resolved_at, {
    source: "dispute",
    label: "Dispute resolved",
    detail: order.dispute_outcome?.replaceAll("_", " ") ?? undefined,
  });

  if (transferIntent) {
    push(transferIntent.created_at, {
      source: "transfer",
      label: "Transfer intent recorded",
      detail: money(transferIntent.amount_cents, transferIntent.currency),
    });
    // available_at in the future is a fact worth seeing in sequence too, but a
    // timeline of things that happened stays truthful: only show it once due.
    if (transferIntent.available_at && new Date(transferIntent.available_at) <= new Date()) {
      push(transferIntent.available_at, {
        source: "transfer",
        label: "Clearing window ended — transfer due",
      });
    }
  }
  push(order.transferred_at, {
    source: "transfer",
    label: "Transferred to seller",
    detail: order.transfer_reference ?? undefined,
  });

  for (const op of refundOps) {
    push(op.created_at, {
      source: "refund",
      label: op.external ? "External refund recorded" : "Refund requested",
      detail: `${money(op.amount_cents, op.currency)} — ${op.reason}`,
    });
    push(op.provider_completed_at, {
      source: "refund",
      label: "Refund succeeded at provider",
      detail: op.refund_reference ?? undefined,
    });
    push(op.reversal_completed_at, {
      source: "refund",
      label: "Seller transfer reversed",
      detail: op.reversal_reference ?? undefined,
    });
    if (op.status === "failed" || op.status === "recovery_required") {
      push(op.updated_at, {
        source: "refund",
        label: op.status === "failed" ? "Refund operation failed" : "Refund needs human recovery",
        detail: op.last_error ?? undefined,
      });
    }
  }

  for (const entry of audit) {
    push(entry.created_at, {
      source: "admin",
      label: entry.action.replaceAll("_", " "),
      detail: entry.reason ?? undefined,
    });
  }

  return events.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
}
