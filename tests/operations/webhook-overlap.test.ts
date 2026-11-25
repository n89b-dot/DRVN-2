// The Stripe webhook's dedup turns away an event only once it is marked
// processed (claimWebhookEvent in src/lib/payments/settlement.ts). An event
// that was received and not finished is handled again, which is how a crash
// mid-handler recovers. So while one delivery is still being handled, nothing
// owns the event: a second delivery of it (Stripe timing out and sending it
// again, or the console's replay) runs the same handler at the same instant.
// The handlers are written to be safe when repeated; this proves the capture
// handler is also safe when repeated at once, against the real database, by
// counting what was written. (24 November 2026 outside audit, finding F06.)
import { expect, it } from "vitest";
import type Stripe from "stripe";

import { claimWebhookEvent, dispatchStripeEvent, markWebhookEventProcessed } from "@/lib/payments/settlement";
import { admin } from "./environment";

const DELIVERIES = 6;

it("settles a captured payment once when Stripe delivers the same event several times at once", async () => {
  const userIds: string[] = [];
  const stamp = crypto.randomUUID();
  const eventId = `evt_local_overlap_${stamp}`;
  const intentId = `pi_local_overlap_${stamp}`;
  const chargeId = `ch_local_overlap_${stamp}`;
  try {
    for (const role of ["seller", "buyer"]) {
      const created = await admin.auth.admin.createUser({ email: `overlap-${role}-${stamp}@drvn.test`, email_confirm: true });
      if (created.error || !created.data.user) throw created.error ?? new Error("Missing overlap rehearsal user");
      userIds.push(created.data.user.id);
    }
    const [sellerId, buyerId] = userIds;
    // A checkout skips a seller who cannot take payment (private.seller_can_take_payment),
    // so the fixture says so itself and does not lean on the stack's payments mode.
    await admin.from("profiles").update({ payouts_enabled: true }).eq("id", sellerId).throwOnError();
    const listing = await admin.from("listings")
      .insert({ seller_id: sellerId, title: "Local overlapping delivery fixture", category: "engine", price_cents: 12500, shipping_cents: 0, currency: "USD", status: "active" })
      .select("id").single().throwOnError();

    const begun = await admin.rpc("purchase_begin", {
      p_buyer_id: buyerId,
      p_listing_ids: [listing.data.id],
      p_idempotency_key: `local-overlap:${stamp}`,
      p_checkout_request_key: `local-overlap-browser:${stamp}`,
      p_shipping_overrides: {},
      p_checkout_context: {
        version: 1,
        shipping: { name: "Local Buyer", line1: "1 Test Street", city: "Detroit", postcode: "48201", country: "US", isCollection: false },
        destinationHash: "local-rehearsal-destination",
        quoteIds: {},
      },
    });
    if (begun.error) throw begun.error;
    const orderId = (begun.data as { orders?: { order_id?: string }[] }).orders?.[0]?.order_id;
    if (!orderId) throw new Error("The checkout made no order");
    const order = await admin.from("orders").select("status,total_cents,platform_fee_cents").eq("id", orderId).single().throwOnError();
    expect(order.data.status).toBe("pending");

    const event = {
      id: eventId,
      type: "payment_intent.succeeded",
      created: Math.floor(Date.now() / 1000),
      data: {
        object: {
          id: intentId,
          object: "payment_intent",
          status: "succeeded",
          amount: order.data.total_cents,
          amount_received: order.data.total_cents,
          currency: "usd",
          latest_charge: chargeId,
          metadata: { order_id: orderId, buyer_id: buyerId },
        },
      },
    } as unknown as Stripe.Event;

    // One delivery as the route runs it (src/app/api/stripe/webhook/route.ts):
    // claim, then dispatch. The processed marker is written only afterwards.
    const deliver = async () => ((await claimWebhookEvent(admin, event)) ? dispatchStripeEvent(admin, event) : "duplicate");
    const outcomes = await Promise.all(Array.from({ length: DELIVERIES }, deliver));

    // None was turned away: the event is unfinished, so every delivery ran the handler.
    expect(outcomes).toEqual(Array.from({ length: DELIVERIES }, () => "committed"));

    // And the sale was booked once.
    expect((await admin.from("orders").select("status").eq("id", orderId).single().throwOnError()).data.status).toBe("paid");
    expect((await admin.from("listings").select("status").eq("id", listing.data.id).single().throwOnError()).data.status).toBe("sold");
    const payments = await admin.from("payments").select("status,provider,provider_reference,amount_cents").eq("order_id", orderId).throwOnError();
    expect(payments.data).toEqual([{ status: "succeeded", provider: "stripe", provider_reference: intentId, amount_cents: order.data.total_cents }]);
    const payouts = await admin.from("transfer_intents").select("status,amount_cents,source_transaction").eq("order_id", orderId).throwOnError();
    expect(payouts.data).toEqual([{ status: "holding", amount_cents: order.data.total_cents - order.data.platform_fee_cents, source_transaction: chargeId }]);
    const receipts = await admin.from("remediation_jobs").select("kind").eq("dedup_key", `receipt:${intentId}`).throwOnError();
    expect(receipts.data).toEqual([{ kind: "receipt" }]);
    const journal = await admin.from("webhook_events").select("type,processed_at").eq("id", eventId).throwOnError();
    expect(journal.data).toEqual([{ type: "payment_intent.succeeded", processed_at: null }]);

    // Once it is marked processed, a later delivery is turned away.
    await markWebhookEventProcessed(admin, eventId);
    expect(await claimWebhookEvent(admin, event)).toBe(false);
  } finally {
    await admin.from("webhook_events").delete().eq("id", eventId).throwOnError();
    await admin.from("remediation_jobs").delete().eq("dedup_key", `receipt:${intentId}`).throwOnError();
    if (userIds.length > 1) {
      const orders = await admin.from("orders").select("id").eq("buyer_id", userIds[1]).throwOnError();
      if (orders.data.length) await admin.from("orders").delete().in("id", orders.data.map(row => row.id)).throwOnError();
    }
    for (const userId of [...userIds].reverse()) {
      const deleted = await admin.auth.admin.deleteUser(userId);
      if (deleted.error) throw deleted.error;
    }
  }
});
