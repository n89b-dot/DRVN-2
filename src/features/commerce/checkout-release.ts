import "server-only";

import type Stripe from "stripe";

import { reportError } from "@/lib/monitoring";
import { resolveExpiryIntent } from "@/lib/payments/reservation-expiry";
import { settleIntent } from "@/lib/payments/settlement";
import { stripeClient } from "@/lib/payments/stripe";
import type { createAdminClient } from "@/lib/supabase/admin";

type Admin = ReturnType<typeof createAdminClient>;

/**
 * OS-W17: put the buyer's own, unconfirmed cart checkout back on sale so a
 * restarted checkout (a new address, another shipping service, a changed
 * cart) can reserve the same parts at once instead of waiting out the
 * 15-minute hold.
 *
 * This is the reservation-expiry transition brought forward, under the same
 * rule (`resolveExpiryIntent`): the PaymentIntent is cancelled first, a
 * captured one is settled instead (the buyer paid in another tab), and a
 * processing or uncertain one keeps the hold. Only then does
 * `release_cart_checkout` close the orders, re-checking the reference under
 * the listing → order → payment locks. Nothing here moves or refunds money.
 */
export type CheckoutReleaseOutcome =
  /** The parts are back on sale; start a fresh checkout. */
  | { outcome: "released" }
  /** The buyer paid after all — show the order, don't charge again. */
  | { outcome: "settled" }
  /** The payment's outcome isn't known yet; the hold stays. */
  | { outcome: "unresolved" };

export type CheckoutReleaseDeps = {
  retrieve: (reference: string) => Promise<Stripe.PaymentIntent>;
  cancel: (reference: string) => Promise<Stripe.PaymentIntent>;
  settle: (admin: Admin, intent: Stripe.PaymentIntent) => Promise<boolean>;
};

const stripeDeps: CheckoutReleaseDeps = {
  retrieve: (reference) =>
    stripeClient().paymentIntents.retrieve(reference, {}, { timeout: 3000, maxNetworkRetries: 0 }),
  cancel: (reference) =>
    stripeClient().paymentIntents.cancel(
      reference,
      { cancellation_reason: "abandoned" },
      { idempotencyKey: `checkout-release:${reference}`, timeout: 3000, maxNetworkRetries: 0 }
    ),
  settle: (admin, intent) => settleIntent(admin, intent, true),
};

export async function releaseCartCheckout(
  admin: Admin,
  input: { buyerId: string; idempotencyKey: string; orderIds: string[] },
  deps: CheckoutReleaseDeps = stripeDeps
): Promise<CheckoutReleaseOutcome> {
  const { buyerId, idempotencyKey, orderIds } = input;
  if (!orderIds.length) return { outcome: "unresolved" };

  const { data: payments, error: paymentsError } = await admin
    .from("payments")
    .select("order_id, provider, provider_reference")
    .in("order_id", orderIds);
  if (paymentsError || payments?.length !== orderIds.length) {
    reportError("[checkout] release payment lookup failed", { buyerId, paymentsError });
    return { outcome: "unresolved" };
  }

  // One payment covers the basket: every order maps to the same intent, or
  // none has one yet.
  const references = [...new Set(payments.map((payment) => payment.provider_reference))];
  if (references.length !== 1) return { outcome: "unresolved" };
  const reference = references[0];

  if (reference) {
    if (payments.some((payment) => payment.provider !== "stripe")) return { outcome: "unresolved" };
    try {
      const intent = await deps.retrieve(reference);
      const intentOrders = intent.metadata?.order_id?.split(",") ?? [];
      if (intent.metadata?.buyer_id !== buyerId || !orderIds.every((id) => intentOrders.includes(id))) {
        reportError("[checkout] release provider ownership mismatch", { buyerId, reference });
        return { outcome: "unresolved" };
      }
      const resolved = await resolveExpiryIntent(
        intent,
        () => deps.cancel(reference),
        (captured) => deps.settle(admin, captured)
      );
      if (resolved === "settled") return { outcome: "settled" };
    } catch (providerError) {
      // A failed cancellation is never evidence that a charge did not happen.
      reportError("[checkout] release could not resolve the payment", { buyerId, reference, providerError });
      return { outcome: "unresolved" };
    }
  }

  const { data, error } = await admin.rpc("release_cart_checkout", {
    p_buyer: buyerId,
    p_idempotency_key: idempotencyKey,
    p_reference: reference ?? undefined,
  });
  const result = data as { ok?: boolean } | null;
  if (error || result?.ok !== true) {
    reportError("[checkout] release was refused", { buyerId, error });
    return { outcome: "unresolved" };
  }
  return { outcome: "released" };
}

const LIVE_STATUSES = ["pending", "requires_action"] as const;

/** The purchase attempt (cart checkout) that reserved `orderId` for this
 *  buyer, signed-in or guest. Only purchase_begin writes attempts, so this
 *  is always a cart basket, never an accepted offer. */
async function attemptHoldingOrder(admin: Admin, buyerId: string, orderId: string) {
  return admin
    .from("purchase_attempts")
    .select("idempotency_key, result")
    .eq("buyer_id", buyerId)
    .contains("result", { orders: [{ order_id: orderId }] })
    .maybeSingle();
}

/**
 * OS-W17 ("Edit cart"): Remove on a part the buyer's own unfinished checkout
 * holds. The whole basket that checkout reserved is released under the same
 * rule as a restart (payment cancelled first, a paid one settled, an
 * uncertain one kept), so the parts left in the cart can check out again at
 * once instead of being "held by your checkout" for 15 minutes.
 *
 * Who the buyer is comes from the caller: the signed-in account, or, for a
 * guest, the orders named in this browser's signed checkout receipt.
 * `none` means no live checkout of theirs holds the part; nothing changed.
 */
export async function releaseCheckoutHolding(
  admin: Admin,
  input: { listingId: string } & ({ buyerId: string } | { guestOrderIds: string[] }),
  deps: CheckoutReleaseDeps = stripeDeps
): Promise<CheckoutReleaseOutcome | { outcome: "none" }> {
  if ("guestOrderIds" in input && !input.guestOrderIds.length) return { outcome: "none" };
  let query = admin
    .from("orders")
    .select("id, buyer_id, order_items(listing_id)")
    .is("origin_offer_id", null)
    .in("status", [...LIVE_STATUSES]);
  query = "buyerId" in input ? query.eq("buyer_id", input.buyerId) : query.in("id", input.guestOrderIds);
  const { data: orders, error } = await query;
  if (error || !Array.isArray(orders)) {
    reportError("[checkout] held-part lookup failed", { error });
    return { outcome: "unresolved" };
  }
  const holding = orders.find((order) =>
    (order.order_items ?? []).some((item) => item.listing_id === input.listingId)
  );
  if (!holding?.buyer_id) return { outcome: "none" };
  const buyerId = holding.buyer_id;

  const { data: attempt, error: attemptError } = await attemptHoldingOrder(admin, buyerId, holding.id);
  if (attemptError) {
    reportError("[checkout] held-part attempt lookup failed", { buyerId, attemptError });
    return { outcome: "unresolved" };
  }
  if (!attempt) return { outcome: "none" };
  const result = attempt.result;
  const orderIds =
    result && typeof result === "object" && !Array.isArray(result) && Array.isArray(result.orders)
      ? result.orders.flatMap((order) =>
          order && typeof order === "object" && !Array.isArray(order) && typeof order.order_id === "string"
            ? [order.order_id]
            : []
        )
      : [];
  if (!orderIds.includes(holding.id)) return { outcome: "unresolved" };

  return releaseCartCheckout(admin, { buyerId, idempotencyKey: attempt.idempotency_key, orderIds }, deps);
}
