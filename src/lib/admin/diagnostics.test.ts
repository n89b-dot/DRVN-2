import { describe, expect, it } from "vitest";

import type { Order, Payment, RefundOperation, TransferIntent, WebhookEvent } from "@/lib/database.types";

import { buildOrderTimeline } from "./diagnostics";

const BASE_ORDER = {
  id: "order-1",
  buyer_id: "b",
  seller_id: "s",
  buyer_label: null,
  seller_label: null,
  status: "paid",
  subtotal_cents: 10_000,
  shipping_cents: 500,
  platform_fee_cents: 1_000,
  total_cents: 10_500,
  currency: "GBP",
  ship_name: null,
  ship_line1: null,
  ship_line2: null,
  ship_city: null,
  ship_postcode: null,
  ship_country: null,
  ship_state: null,
  ship_phone: null,
  is_collection: false,
  carrier: null,
  tracking_number: null,
  shipped_at: null,
  delivered_at: null,
  completed_at: null,
  cancelled_at: null,
  cancel_reason: null,
  dispute_category: null,
  dispute_reason: null,
  disputed_at: null,
  disputed_by: null,
  dispute_resolved_at: null,
  dispute_escalated_at: null,
  dispute_escalated_by: null,
  dispute_outcome: null,
  dispute_sla_alerted_at: null,
  pre_dispute_status: null,
  refund_offer_cents: null,
  refund_offered_at: null,
  refund_offer_expires_at: null,
  dispatch_by: null,
  deliver_by: null,
  available_by: null,
  delivery_estimate_source: null,
  dispute_respond_by: null,
  dispute_escalate_until: null,
  transfer_reference: null,
  transferred_at: null,
  refunded_cents: 0,
  platform_fee_refunded_cents: 0,
  refunded_at: null,
  origin_offer_id: null,
  shipping_quote: null,
  pickup_ready_at: null,
  correlation_id: "11111111-2222-3333-4444-555555555555",
  created_at: "2026-08-01T10:00:00Z",
  updated_at: "2026-08-01T10:00:00Z",
} satisfies Order;

describe("buildOrderTimeline", () => {
  it("orders every event chronologically across sources", () => {
    const order: Order = {
      ...BASE_ORDER,
      shipped_at: "2026-08-03T09:00:00Z",
      carrier: "DPD",
      tracking_number: "TRK1",
      delivered_at: "2026-08-05T09:00:00Z",
      transferred_at: "2026-08-12T09:00:00Z",
      transfer_reference: "tr_1",
    };
    const payment = {
      id: "pay-1",
      order_id: "order-1",
      provider: "stripe",
      provider_reference: "pi_1",
      status: "succeeded",
      amount_cents: 10_500,
      refunded_cents: 0,
      currency: "GBP",
      idempotency_key: null,
      failure_reason: null,
      raw: {},
      created_at: "2026-08-01T10:00:05Z",
      updated_at: "2026-08-01T10:01:00Z",
    } satisfies Payment;
    const transferIntent = {
      order_id: "order-1",
      seller_id: "s",
      amount_cents: 9_500,
      currency: "GBP",
      status: "transferred",
      available_at: "2026-08-12T08:00:00Z",
      transfer_reference: "tr_1",
      source_transaction: null,
      dispatch_amount_cents: 9_500,
      attempts: 1,
      last_error: null,
      locked_at: null,
      locked_by: null,
      lease_expires_at: null,
      next_attempt_at: null,
      last_attempt_at: null,
      created_at: "2026-08-01T10:01:00Z",
      updated_at: "2026-08-12T09:00:00Z",
    } satisfies TransferIntent;
    const webhookEvents: WebhookEvent[] = [
      {
        id: "evt_1",
        type: "payment_intent.succeeded",
        received_at: "2026-08-01T10:00:30Z",
        processed_at: "2026-08-01T10:00:31Z",
        payload: null,
        failed_attempts: 0,
        last_failed_at: null,
        last_failure_kind: null,
        last_failure_detail: null,
      },
    ];

    const timeline = buildOrderTimeline({
      order,
      payment,
      transferIntent,
      refundOps: [],
      webhookEvents,
      audit: [],
    });

    const labels = timeline.map((event) => event.label);
    expect(labels).toEqual([
      "Order placed",
      "Payment record created",
      "Stripe payment_intent.succeeded",
      "Transfer intent recorded",
      "Shipped",
      "Delivered (buyer confirmed)",
      "Clearing window ended — transfer due",
      "Transferred to seller",
    ]);
    const times = timeline.map((event) => new Date(event.at).getTime());
    expect([...times].sort((a, b) => a - b)).toEqual(times);
    expect(timeline.find((event) => event.label === "Shipped")?.detail).toBe("DPD TRK1");
  });

  it("surfaces refund lifecycle including failure states", () => {
    const op = {
      id: "op-1",
      order_id: "order-1",
      payment_reference: "pi_1",
      amount_cents: 2_000,
      currency: "GBP",
      remaining_before_cents: 10_500,
      reason: "damaged in transit",
      requested_by: "admin-1",
      actor_role: "admin",
      idempotency_key: "k",
      refund_reference: "re_1",
      reversal_reference: null,
      reversal_due_cents: 1_800,
      status: "recovery_required",
      external: false,
      resolve_dispute: false,
      dispute_outcome: null,
      attempts: 3,
      next_attempt_at: null,
      last_error: "reversal failed",
      recovery_id: "rec-1",
      created_at: "2026-08-06T10:00:00Z",
      updated_at: "2026-08-06T12:00:00Z",
      provider_completed_at: "2026-08-06T10:05:00Z",
      effects_completed_at: null,
      reversal_completed_at: null,
    } satisfies RefundOperation;

    const timeline = buildOrderTimeline({
      order: BASE_ORDER,
      payment: null,
      transferIntent: null,
      refundOps: [op],
      webhookEvents: [],
      audit: [],
    });

    const labels = timeline.map((event) => event.label);
    expect(labels).toContain("Refund requested");
    expect(labels).toContain("Refund succeeded at provider");
    expect(labels).toContain("Refund needs human recovery");
    expect(timeline.find((event) => event.label === "Refund requested")?.detail).toBe(
      "20.00 GBP — damaged in transit",
    );
  });

  it("does not show a future clearing window as an event that happened", () => {
    const future = new Date(Date.now() + 86_400_000).toISOString();
    const timeline = buildOrderTimeline({
      order: BASE_ORDER,
      payment: null,
      transferIntent: {
        order_id: "order-1",
        seller_id: "s",
        amount_cents: 9_500,
        currency: "GBP",
        status: "holding",
        available_at: future,
        transfer_reference: null,
        source_transaction: null,
        dispatch_amount_cents: null,
        attempts: 0,
        last_error: null,
        locked_at: null,
        locked_by: null,
        lease_expires_at: null,
        next_attempt_at: null,
        last_attempt_at: null,
        created_at: "2026-08-01T10:01:00Z",
        updated_at: "2026-08-01T10:01:00Z",
      },
      refundOps: [],
      webhookEvents: [],
      audit: [],
    });
    expect(timeline.map((event) => event.label)).not.toContain(
      "Clearing window ended — transfer due",
    );
  });
});
