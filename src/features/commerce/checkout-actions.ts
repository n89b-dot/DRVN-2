"use server";

import { bindCheckoutAnalytics } from "@/lib/purchase-analytics";

import { createHash, randomUUID } from "node:crypto";
import { revalidatePath } from "@/lib/revalidate";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { abuseIdentity } from "@/lib/abuse-identity";
import { getCartIds, removeCartIds } from "@/lib/cart";
import { guestCheckoutIdentity, isPlausibleEmail, setGuestOrders } from "@/lib/guest-checkout";
import { resolveGuestBuyer, sendOrderAccessLink } from "./guest-buyer";
import { freezeOrderShipping, hashDestination, planCartFulfillment, type FulfillmentPlan } from "./checkout-shipping";
import { getPaymentProvider } from "@/lib/payments/provider";
import { getStripeCustomerId } from "@/lib/payments/customers";
import { CHARGE_OUT_OF_BOUNDS_CODE, CHECKOUT_OUT_OF_BOUNDS_MESSAGE } from "@/lib/payments/charge-bounds";
import { RATE_LIMITS, allowAction, rateLimitMessage } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { capture } from "@/lib/analytics";
import { createClient } from "@/lib/supabase/server";
import type { Json, OrderStatus, PurchaseBeginResult } from "@/lib/database.types";
import { reportError } from "@/lib/monitoring";
import { betaCommerceError, getBetaAccess } from "@/lib/beta-access";
import { cartCheckoutRequestKey, forgetCheckoutKey, rememberCheckoutKey } from "@/lib/checkout-key";
import type { CheckoutBreakdown, CommerceState, CheckoutOutcome, ShippingDetails } from "./action-types";
import { releaseCartCheckout } from "./checkout-release";

const PAYMENT_SETTLED_ORDER_STATUSES = new Set([
  "paid",
  "shipped",
  "delivered",
  "completed",
  "refunded",
  "disputed",
]);

const LIVE_ORDER_STATUSES: OrderStatus[] = ["pending", "requires_action"];
const TERMINAL_ORDER_STATUSES = new Set(["payment_failed", "cancelled"]);

/** purchase_begin's refusal text for the per-buyer cap (5 unfinished). */
const UNRESOLVED_CHECKOUT_CAP_ERROR = "Too many unresolved checkouts";
const UNRESOLVED_CHECKOUT_CAP_MESSAGE =
  "You have 5 checkouts waiting for payment. Finish one from your orders, or wait for an unpaid one to lapse (holds last 15 minutes), then try again. Nothing was charged.";
const OWN_HOLD_MESSAGE =
  "Your checkout is already holding these parts. Finish paying in the checkout you started, or check your orders. If you don't, the hold lapses within 15 minutes. Nothing new was charged.";
const RELEASE_UNRESOLVED_MESSAGE =
  "Your earlier payment for these parts is still being confirmed, so they stay held for now. Check your orders in a few minutes before trying again. Nothing new was charged.";

/** The listings among `listingIds` that the buyer's own unfinished
 *  checkouts are holding. A failed read holds nothing (the caller falls back
 *  to its general message). */
async function ownHeldListingIds(
  admin: ReturnType<typeof createAdminClient>,
  buyerId: string,
  /** Omitted: every listing the buyer's unfinished checkouts hold. */
  listingIds?: string[]
): Promise<Set<string>> {
  const { data, error } = await admin
    .from("orders")
    .select("id, order_items(listing_id)")
    .eq("buyer_id", buyerId)
    .in("status", LIVE_ORDER_STATUSES);
  if (error || !Array.isArray(data)) return new Set();
  const wanted = listingIds ? new Set(listingIds) : null;
  const held = new Set<string>();
  for (const order of data) {
    for (const item of order.order_items ?? []) {
      if (item.listing_id && (!wanted || wanted.has(item.listing_id))) held.add(item.listing_id);
    }
  }
  return held;
}

/** True when a saved attempt exists under this payment key and none of its
 *  orders is still waiting for payment. Unknown (a failed read) is "not
 *  over": replaying is always the safe default, never a second reservation. */
async function attemptIsOver(idempotencyKey: string): Promise<boolean> {
  const admin = createAdminClient();
  const { data: attempt, error } = await admin
    .from("purchase_attempts")
    .select("result")
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();
  if (error || !attempt) return false;
  const result = attempt.result;
  const orderIds =
    result && typeof result === "object" && !Array.isArray(result) && Array.isArray(result.orders)
      ? result.orders.flatMap((order) =>
          order && typeof order === "object" && !Array.isArray(order) && typeof order.order_id === "string"
            ? [order.order_id]
            : []
        )
      : [];
  if (!orderIds.length) return false;
  const { data: orders, error: ordersError } = await admin
    .from("orders")
    .select("id, status")
    .in("id", orderIds);
  if (ordersError || orders?.length !== orderIds.length) return false;
  return orders.every((order) => TERMINAL_ORDER_STATUSES.has(order.status));
}

/** OS-W17 (N485): the payment step's breakdown, from what was reserved. */
async function admittedBreakdown(
  admin: ReturnType<typeof createAdminClient>,
  result: PurchaseBeginResult,
  skipped: CheckoutOutcome["skipped"]
): Promise<CheckoutBreakdown> {
  const orderIds = result.orders.map((order) => order.order_id);
  const breakdown: CheckoutBreakdown = {
    goodsCents: result.orders.reduce((sum, order) => sum + order.subtotal_cents, 0),
    shippingCents: result.orders.reduce((sum, order) => sum + order.shipping_cents, 0),
    skipped: skipped.length ? skipped.map((s) => s.title) : undefined,
  };
  const { data: items, error } = await admin
    .from("order_items")
    .select("listing_id, title, price_cents")
    .in("order_id", orderIds);
  if (!error && Array.isArray(items) && items.length) {
    breakdown.lines = items.map((item) => ({
      id: item.listing_id ?? item.title ?? "part",
      title: item.title ?? "Part",
      priceCents: item.price_cents,
    }));
  }
  return breakdown;
}

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return { supabase, user };
}

async function optionalUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { supabase, user };
}

async function purchaseListings(
  buyerId: string,
  listingIds: string[],
  options: {
    idempotencyKey?: string;
    checkoutRequestKey?: string;
    checkoutContext?: Json;
    useSavedCustomer?: boolean;
    shipping?: ShippingDetails;
    /** Server-validated fulfillment plan (0053): quoted DRVN-Shipping amounts
     *  (or zeros for pickup) + the quotes to freeze onto the orders. */
    fulfillment?: FulfillmentPlan;
  } = {}
): Promise<CheckoutOutcome> {
  const admin = createAdminClient();
  const empty: CheckoutOutcome = { orderIds: [], purchased: [], skipped: [] };

  if (!listingIds.length) return { ...empty, error: "Nothing to buy." };

  // Titles for the receipt/skip messages — read before the claim mutates state.
  const { data: requested } = await admin
    .from("listings")
    .select("id, title")
    .in("id", listingIds);
  const titleFor = (id: string) =>
    requested?.find((l) => l.id === id)?.title ?? "That part";

  // The saved Stripe customer is read before anything is reserved: a failed
  // read throws (it must not pass for "no customer"), and failing here leaves
  // nothing to unwind.
  let customerId: string | null = null;
  if (options.useSavedCustomer) {
    try {
      customerId = await getStripeCustomerId(buyerId);
    } catch (customerError) {
      reportError("[commerce] saved customer lookup failed", { buyerId, customerError });
      return { ...empty, error: "We couldn't start that purchase. Nothing was charged — try again." };
    }
  }

  const overrides = options.fulfillment?.overrides ?? {};
  const { data, error } = await admin.rpc("purchase_begin", {
    p_buyer_id: buyerId,
    p_listing_ids: listingIds,
    p_idempotency_key: options.idempotencyKey,
    p_shipping_overrides: Object.keys(overrides).length ? overrides : null,
    p_checkout_request_key: options.checkoutRequestKey,
    p_checkout_context: options.checkoutContext,
  });

  if (error) {
    if (error.code === CHARGE_OUT_OF_BOUNDS_CODE) return { ...empty, error: CHECKOUT_OUT_OF_BOUNDS_MESSAGE };
    // OS-W17 (N88): purchase_begin's cap on unfinished checkouts is a
    // refusal the buyer can act on, not a failure to report.
    if (error.message?.includes(UNRESOLVED_CHECKOUT_CAP_ERROR)) {
      return { ...empty, error: UNRESOLVED_CHECKOUT_CAP_MESSAGE };
    }
    reportError("[commerce] purchase_begin failed", { buyerId, error });
    return { ...empty, error: error.message?.includes("at most") ? error.message : "We couldn't start that purchase. Nothing was charged." };
  }

  const result = data as PurchaseBeginResult;
  const skipped = (result.skipped ?? []).map((s) => ({
    listingId: s.listing_id,
    title: titleFor(s.listing_id),
    reason: s.reason,
  }));

  if (!result.orders?.length) {
    // OS-W17 (N85): "sold or are your own" was wrong when the buyer's own
    // unfinished checkout is what holds them.
    const heldByBuyer = skipped.length
      ? await ownHeldListingIds(admin, buyerId, skipped.map((s) => s.listingId))
      : new Set<string>();
    return {
      ...empty,
      skipped,
      error: skipped.length && skipped.every((s) => heldByBuyer.has(s.listingId))
        ? OWN_HOLD_MESSAGE
        : skipped.length
          ? "Nothing was available — those parts have sold or are your own."
          : "Nothing purchasable in that request.",
    };
  }
  const idempotencyKey = options.idempotencyKey;
  if (!idempotencyKey) {
    return {
      ...empty,
      orderIds: result.orders.map((order) => order.order_id),
      skipped,
      error: "This checkout has no durable request key. Nothing was charged; reload checkout and try again.",
    };
  }

  const provider = getPaymentProvider();
  const orderIds: string[] = [];
  const purchased: CheckoutOutcome["purchased"] = [];
  const failures: string[] = [];

  // Authenticated cart checkout journals the validated address + quote ids in
  // purchase_begin, then freezes every local projection through a transaction
  // which can safely replay after interruption. Guests retain the legacy path
  // until they have an authenticated identity suitable for that private key.
  if (options.checkoutRequestKey) {
    for (const order of result.orders) {
      const { data: currentOrder, error: currentOrderError } = await admin
        .from("orders")
        .select("status")
        .eq("id", order.order_id)
        .eq("buyer_id", buyerId)
        .maybeSingle();
      if (currentOrderError || !currentOrder) {
        return {
          ...empty,
          orderIds: result.orders.map((candidate) => candidate.order_id),
          skipped,
          error: "Couldn't verify the saved checkout. Nothing new was charged; check your orders before retrying.",
        };
      }
      // A prior failed-provider pass may have released an earlier seller order
      // before a later finalize response was interrupted. It needs no shipping
      // repair; the same provider replay below will release any orders still
      // pending without attempting to reopen this terminal order.
      if (["payment_failed", "cancelled"].includes(currentOrder.status)) continue;
      const { data: frozen, error: freezeError } = await admin.rpc(
        "freeze_cart_checkout_shipping",
        {
          p_buyer: buyerId,
          p_idempotency_key: idempotencyKey,
          p_order: order.order_id,
        }
      );
      if (
        freezeError ||
        !frozen ||
        typeof frozen !== "object" ||
        Array.isArray(frozen) ||
        frozen.ok !== true
      ) {
        reportError("[checkout] durable shipping freeze failed", {
          buyerId,
          orderId: order.order_id,
          freezeError,
        });
        return {
          ...empty,
          orderIds: result.orders.map((candidate) => candidate.order_id),
          skipped,
          error: "Couldn't finish the saved delivery plan. Nothing was charged; retry this checkout.",
        };
      }
    }
  } else if (options.shipping) {
    // Guest checkout has no authenticated browser binding. Attach its delivery
    // details before charging; every failed write stops at this boundary.
    for (const order of result.orders) {
      const { error: shipWrite } = await admin
        .from("orders")
        .update({
          ship_name: options.shipping.name,
          ship_line1: options.shipping.line1,
          ship_line2: options.shipping.line2,
          ship_city: options.shipping.city,
          ship_postcode: options.shipping.postcode,
          ship_country: options.shipping.country,
          ship_state: options.shipping.state,
          ship_phone: options.shipping.phone,
          is_collection: options.shipping.isCollection,
        })
        .eq("id", order.order_id);
      if (shipWrite) {
        reportError("[commerce] delivery details write failed", {
          orderId: order.order_id,
          shipWrite,
        });
        return {
          ...empty,
          skipped,
          error: "Couldn't confirm the delivery method for this order. Nothing was charged.",
        };
      }
    }
  }

  // Freeze the chosen DRVN-Shipping service onto each order and create the
  // pending shipment rows the seller will buy labels from (0053).
  if (!options.checkoutRequestKey && options.fulfillment?.quotes.size) {
    try {
      await freezeOrderShipping(admin, result.orders, options.fulfillment.quotes);
    } catch (freezeError) {
      reportError("[checkout] guest shipping freeze failed", {
        buyerId,
        freezeError,
      });
      return {
        ...empty,
        orderIds: result.orders.map((order) => order.order_id),
        skipped,
        error: "Couldn't finish the delivery plan. Nothing was charged; retry this checkout.",
      };
    }
  }

  // ONE payment per checkout, even for a multi-seller basket: the buyer
  // confirms a single charge for the basket total, and the webhook settles
  // every order against the same payment reference. (Splitting seller
  // proceeds is internal bookkeeping until Connect lands.)
  const allOrderIds = result.orders.map((o) => o.order_id);
  const basketTotal = result.orders.reduce((sum, o) => sum + o.total_cents, 0);
  capture(buyerId, { event: "checkout_started", props: { items: listingIds.length } });
  // One diagnostics identity for the whole basket (0039): every order carries
  // it, and the processor metadata carries the same value.
  await bindCheckoutAnalytics(allOrderIds);
  const payment = await provider.createPayment({
    orderId: allOrderIds.join(","),
    buyerId,
    sellerId: result.orders.length === 1 ? result.orders[0].seller_id : "multiple",
    totalCents: basketTotal,
    currency: result.orders[0].currency,
    idempotencyKey,
    customerId,
  });

  if (payment.status === "succeeded") {
    // Synchronous settle (stub provider): finalize every order inline.
    for (const order of result.orders) {
      const { error: finalizeError } = await admin.rpc("purchase_finalize", {
        p_order_id: order.order_id,
        p_success: true,
        p_provider: provider.name,
        p_reference: payment.reference,
      });
      if (finalizeError) {
        reportError("[commerce] purchase_finalize failed after payment", {
          orderId: order.order_id,
          finalizeError,
        });
      }
      const { data: settledOrder, error: settlementReadError } = await admin
        .from("orders")
        .select("status")
        .eq("id", order.order_id)
        .eq("buyer_id", buyerId)
        .maybeSingle();
      if (settlementReadError || !settledOrder || !PAYMENT_SETTLED_ORDER_STATUSES.has(settledOrder.status)) {
        reportError("[commerce] paid order settlement could not be verified", {
          orderId: order.order_id,
          finalizeError,
          settlementReadError,
          status: settledOrder?.status,
        });
        return {
          ...empty,
          orderIds: allOrderIds,
          skipped,
          error: "Payment was received but the order is still being reconciled. Don't pay again; check your orders shortly.",
        };
      }
      orderIds.push(order.order_id);
      purchased.push(
        ...order.listing_ids.map((id) => ({ listingId: id, title: titleFor(id) }))
      );
    }
  } else if (payment.status === "requires_action") {
    // Async settle (Stripe): orders stay pending and listings reserved; the
    // reservation window is the buyer's time to confirm. Stamp the intent on
    // the pending payment rows for reconciliation, then hand the client
    // secret to the browser — the webhook finishes the job.
    const mappedWrite = await admin.rpc("bind_cart_checkout_payment", {
      p_buyer: buyerId,
      p_idempotency_key: idempotencyKey,
      p_orders: allOrderIds,
      p_provider: provider.name,
      p_reference: payment.reference,
    });
    const mappedResult = mappedWrite.data;
    if (
      mappedWrite.error ||
      !mappedResult ||
      typeof mappedResult !== "object" ||
      Array.isArray(mappedResult) ||
      mappedResult.ok !== true ||
      mappedResult.mapped !== allOrderIds.length
    ) {
      const reconciled = await admin
        .from("payments")
        .select("order_id, provider, provider_reference")
        .in("order_id", allOrderIds);
      if (
        reconciled.error ||
        reconciled.data?.length !== allOrderIds.length ||
        reconciled.data.some((row) => row.provider !== provider.name || row.provider_reference !== payment.reference)
      ) {
        reportError("[commerce] async payment mapping could not be verified", {
          orderIds: allOrderIds,
          mappedWriteError: mappedWrite.error,
          reconciliationError: reconciled.error,
        });
        return {
          ...empty,
          orderIds: allOrderIds,
          skipped,
          error: "Payment started, but its local record is still being reconciled. Retry this checkout; don't start another payment.",
        };
      }
    }
    return {
      orderIds: allOrderIds,
      purchased: [],
      skipped,
      payment: {
        clientSecret: payment.clientSecret,
        orderIds: allOrderIds,
        amountCents: basketTotal,
        breakdown: await admittedBreakdown(admin, result, skipped),
      },
    };
  } else if (payment.status === "processing") {
    return { ...empty, orderIds: allOrderIds, skipped, error: "Your payment is processing. Check your order before trying again." };
  } else if (payment.status === "unknown") {
    return { ...empty, orderIds: allOrderIds, skipped, error: payment.reason };
  } else {
    const reason = payment.reason;
    for (const order of result.orders) {
      const { error: releaseError } = await admin.rpc("purchase_finalize", {
        p_order_id: order.order_id,
        p_success: false,
        p_provider: provider.name,
        p_failure_reason: reason,
      });
      const { data: releasedOrder, error: orderReadError } = await admin
        .from("orders")
        .select("status")
        .eq("id", order.order_id)
        .eq("buyer_id", buyerId)
        .maybeSingle();
      if (
        releaseError ||
        orderReadError ||
        !releasedOrder ||
        !["payment_failed", "cancelled"].includes(releasedOrder.status)
      ) {
        reportError("[commerce] failed payment reservation release could not be verified", {
          orderId: order.order_id,
          releaseError,
          orderReadError,
        });
        return {
          ...empty,
          orderIds: allOrderIds,
          skipped,
          error: "Payment failed, but the basket reservation is still being reconciled. Nothing was charged; retry this checkout before starting another.",
        };
      }
      skipped.push(
        ...order.listing_ids.map((id) => ({
          listingId: id,
          title: titleFor(id),
          reason: `payment failed: ${reason}`,
        }))
      );
    }
    failures.push(reason);
  }

  revalidatePath("/marketplace");
  revalidatePath("/orders");
  for (const item of [...purchased, ...skipped]) {
    revalidatePath(`/listings/${item.listingId}`);
  }

  return {
    orderIds,
    purchased,
    skipped,
    // Only report an error when *nothing* went through; a partial success is
    // reported through `skipped` so the buyer sees exactly what happened.
    error: purchased.length === 0 ? `Payment failed: ${failures[0] ?? "unknown"}` : undefined,
  };
}

function readShipping(formData: FormData): { shipping?: ShippingDetails; error?: string } {
  const isCollection = formData.get("is_collection") === "on";
  if (isCollection) {
    return {
      shipping: {
        name: String(formData.get("ship_name") ?? "").trim() || "Collection",
        line1: "",
        line2: null,
        city: "",
        postcode: "",
        country: "",
        state: null,
        phone: String(formData.get("ship_phone") ?? "").trim() || null,
        isCollection: true,
      },
    };
  }

  const name = String(formData.get("ship_name") ?? "").trim();
  const line1 = String(formData.get("ship_line1") ?? "").trim();
  const city = String(formData.get("ship_city") ?? "").trim();
  const postcode = String(formData.get("ship_postcode") ?? "").trim();
  const country = String(formData.get("ship_country") ?? "").trim();

  if (!name || !line1 || !city || !postcode || !country) {
    return { error: "Add a delivery name, address, city, postcode and country." };
  }

  return {
    shipping: {
      name,
      line1,
      line2: String(formData.get("ship_line2") ?? "").trim() || null,
      city,
      postcode,
      country,
      state: String(formData.get("ship_state") ?? "").trim() || null,
      phone: String(formData.get("ship_phone") ?? "").trim() || null,
      isCollection: false,
    },
  };
}

export async function checkoutCart(
  _prev: CommerceState,
  formData: FormData
): Promise<CommerceState> {
  const { user } = await optionalUser();
  const betaAccess = await getBetaAccess(user?.id, "buyer");
  if (betaAccess.enforced && !user) {
    return { error: "Sign in with an invited beta account to check out." };
  }
  if (!betaAccess.eligible) return { error: betaCommerceError("buyer") };

  const { shipping, error: shippingError } = readShipping(formData);
  if (shippingError) return { error: shippingError };

  // The rendered form owns this UUID for its whole lifetime. Keep a separate,
  // buyer-scoped digest for finding the durable purchase attempt after a
  // successful response is lost and the cart cookie has already been cleared.
  // The full payment idempotency key below still binds the address and basket.
  //
  // OS-W17 (N85): the page renders the key this browser's checkout reserved
  // under (the checkout-key cookie), so a reload resumes the same attempt.
  // When that attempt is over, or the buyer changes what they're buying or
  // where it goes, the key is rotated below and a new attempt starts.
  let rawKey = String(formData.get("idempotency_key") ?? "");
  if (user && (rawKey.length < 16 || rawKey.length > 200)) {
    return { error: "This checkout request expired. Reload checkout and try again." };
  }
  const browserIdentity = user ? `user:${user.id}` : null;
  let checkoutRequestKey = user ? cartCheckoutRequestKey(user.id, rawKey) : null;
  const startNewAttempt = () => {
    rawKey = randomUUID();
    checkoutRequestKey = user ? cartCheckoutRequestKey(user.id, rawKey) : null;
  };
  let cartIds: string[] | undefined;

  let replay:
    | {
        listingIds: string[];
        idempotencyKey: string;
        overrides: Record<string, number>;
        result: PurchaseBeginResult;
        context: Json;
      }
    | undefined;

  if (user && checkoutRequestKey) {
    const admin = createAdminClient();
    const { data: attempt, error: attemptError } = await admin
      .from("purchase_attempts")
      .select("idempotency_key, request_fingerprint, result, checkout_context")
      .eq("checkout_request_key", checkoutRequestKey)
      .eq("buyer_id", user.id)
      .maybeSingle();

    if (attemptError) {
      reportError("[checkout] durable request lookup failed", {
        buyerId: user.id,
        attemptError,
      });
      return { error: "We couldn't check the existing checkout. Nothing new was charged. Try again." };
    }

    if (attempt) {
      const fingerprint = attempt.request_fingerprint;
      const result = attempt.result;
      const listingIds =
        fingerprint && typeof fingerprint === "object" && !Array.isArray(fingerprint) &&
        Array.isArray(fingerprint.ids) && fingerprint.ids.every((id) => typeof id === "string")
          ? fingerprint.ids
          : null;
      const rawOverrides =
        fingerprint && typeof fingerprint === "object" && !Array.isArray(fingerprint) &&
        fingerprint.shipping && typeof fingerprint.shipping === "object" && !Array.isArray(fingerprint.shipping)
          ? fingerprint.shipping
          : null;
      const overrides = rawOverrides
        ? Object.fromEntries(
            Object.entries(rawOverrides).filter(
              (entry): entry is [string, number] =>
                typeof entry[1] === "number" && Number.isInteger(entry[1]) && entry[1] >= 0
            )
          )
        : null;
      const purchaseResult =
        result && typeof result === "object" && !Array.isArray(result) &&
        Array.isArray(result.orders) && Array.isArray(result.skipped)
          ? (result as PurchaseBeginResult)
          : null;
      const context = attempt.checkout_context;

      if (
        !listingIds?.length ||
        !overrides ||
        !purchaseResult ||
        !context ||
        typeof context !== "object" ||
        Array.isArray(context) ||
        context.version !== 1 ||
        !context.shipping ||
        typeof context.shipping !== "object" ||
        Array.isArray(context.shipping) ||
        !context.quoteIds ||
        typeof context.quoteIds !== "object" ||
        Array.isArray(context.quoteIds)
      ) {
        reportError("[checkout] durable request was malformed", {
          buyerId: user.id,
          checkoutRequestKey,
        });
        return { error: "We found this checkout but couldn't safely resume it. Open your orders before trying again." };
      }

      const orderIds = purchaseResult.orders.map((order) => order.order_id);
      if (!orderIds.length) {
        return { error: "This checkout did not reserve an order. Reload your cart to try again." };
      }
      const { data: orders, error: ordersError } = await admin
        .from("orders")
        .select("id, status")
        .eq("buyer_id", user.id)
        .in("id", orderIds);
      if (ordersError || orders?.length !== orderIds.length) {
        reportError("[checkout] durable request order verification failed", {
          buyerId: user.id,
          checkoutRequestKey,
          ordersError,
        });
        return { error: "We found this checkout but couldn't verify every order. Open your orders before trying again." };
      }

      const placedPath = () => {
        const params = new URLSearchParams({ placed: "1" });
        return orderIds.length === 1
          ? `/orders/${orderIds[0]}?${params.toString()}`
          : `/orders?${params.toString()}`;
      };
      if (orders.every((order) => PAYMENT_SETTLED_ORDER_STATUSES.has(order.status))) {
        await forgetCheckoutKey();
        redirect(placedPath());
      }

      if (!orders.some((order) => LIVE_ORDER_STATUSES.includes(order.status))) {
        // The attempt behind this key is over — lapsed, failed or released —
        // so its parts are back on sale. Replaying it would answer with the
        // dead orders; a new attempt reserves the cart afresh.
        startNewAttempt();
      } else {
        const storedQuoteIds = context.quoteIds as Record<string, Json | undefined>;
        const quoteSelectionChanged = Object.entries(storedQuoteIds).some(
          ([listingId, quoteId]) =>
            typeof quoteId !== "string" || formData.get(`quote_${listingId}`) !== quoteId
        );
        const expectedIdempotencyKey = createHash("sha256")
          .update(JSON.stringify([browserIdentity, rawKey, shipping, [...listingIds].sort()]))
          .digest("hex");
        const detailsChanged = expectedIdempotencyKey !== attempt.idempotency_key;
        cartIds = await getCartIds();
        const requested = new Set(listingIds);
        const cartChanged =
          cartIds.length > 0 &&
          (cartIds.length !== requested.size || cartIds.some((id) => !requested.has(id)));

        if (quoteSelectionChanged || detailsChanged || cartChanged) {
          // "Edit address", another service or a changed cart: a changed
          // checkout can never be attached to the existing payment, so the
          // buyer's own hold is released (payment cancelled first) and the
          // checkout restarts with what they asked for now.
          const release = await releaseCartCheckout(admin, {
            buyerId: user.id,
            idempotencyKey: attempt.idempotency_key,
            orderIds,
          });
          if (release.outcome === "settled") {
            await forgetCheckoutKey();
            redirect(placedPath());
          }
          if (release.outcome === "unresolved") return { error: RELEASE_UNRESOLVED_MESSAGE };
          // The released parts are on sale again, and this page's basket is
          // the live cart once more (a DRVN-shipped line needs fresh rates).
          revalidatePath("/marketplace");
          revalidatePath("/checkout");
          for (const id of listingIds) revalidatePath(`/listings/${id}`);
          startNewAttempt();
        } else {
          replay = {
            listingIds,
            idempotencyKey: attempt.idempotency_key,
            overrides,
            result: purchaseResult,
            context,
          };
        }
      }
    }
  }

  const requestHeaders = await headers();
  const subject = abuseIdentity(requestHeaders, user?.id);
  if (!(await allowAction(RATE_LIMITS.checkout, subject))) return { error: rateLimitMessage(RATE_LIMITS.checkout) };
  const ids = replay?.listingIds ?? cartIds ?? await getCartIds();
  if (!ids.length) {
    // "Finish checkout" from an order on another device lands on an empty
    // cart: say what is actually holding the parts.
    if (user && (await ownHeldListingIds(createAdminClient(), user.id)).size) {
      return { error: OWN_HOLD_MESSAGE };
    }
    return { error: "Your cart is empty." };
  }

  // Guest checkout: the email is the only extra thing asked for, and it's the
  // address the receipt and dispatch notices have to go to anyway. It resolves
  // to a real (passwordless, unclaimed) account, so the order is an ordinary
  // order — same RLS, same disputes, same payouts — rather than a second class
  // of record the rest of the system has to special-case.
  let buyerId = user?.id ?? null;
  let guestEmail: string | null = null;

  if (!buyerId) {
    const email = String(formData.get("email") ?? "").trim();
    if (!email) return { error: "Add an email so we can send your order confirmation." };
    if (!isPlausibleEmail(email)) return { error: "That email doesn't look right." };

    const { buyer, error: buyerError } = await resolveGuestBuyer(
      email,
      shipping?.name ?? null
    );
    if (buyerError || !buyer) return { error: buyerError ?? "We couldn't set up your order." };

    buyerId = buyer.id;
    guestEmail = email;

    // A brand-new account has no display name, so the seller would see
    // "DRVN member" against an order that has a real name on the parcel.
    // Only ever set on an account this checkout created — never overwrite a
    // registered member's own name.
    if (buyer.created && shipping?.name) {
      await createAdminClient()
        .from("profiles")
        .update({ display_name: shipping.name })
        .eq("id", buyer.id)
        .is("display_name", null);
    }
  }

  // Fulfillment plan (0053, §14/§15): pickup eligibility and DRVN-Shipping
  // amounts are validated server-side — the checkbox and the rate picker are
  // requests, not facts.
  let plan: FulfillmentPlan;
  let checkoutContext: Json | undefined;
  if (replay) {
    // The first attempt already froze its quotes and shipping destination.
    // Reuse only its database fingerprint; never re-rate a now-reserved line
    // or rewrite the already-frozen order details during recovery.
    plan = { overrides: replay.overrides, quotes: new Map() };
    checkoutContext = replay.context;
  } else {
    const quoteIds: Record<string, string> = {};
    for (const id of ids) {
      const value = formData.get(`quote_${id}`);
      if (typeof value === "string" && value) quoteIds[id] = value;
    }
    const destinationHash = shipping
      ? hashDestination({
          line1: shipping.line1,
          city: shipping.city,
          postcode: shipping.postcode,
          country: shipping.country,
        })
      : "";
    const { plan: planned, error: planError } = await planCartFulfillment(createAdminClient(), {
      listingIds: ids,
      isCollection: shipping?.isCollection ?? false,
      quoteIds,
      buyerId,
      destinationHash,
    });
    if (planError || !planned) return { error: planError ?? "Couldn't verify delivery options." };
    plan = planned;
    if (user && shipping) {
      checkoutContext = {
        version: 1,
        shipping,
        destinationHash,
        quoteIds: Object.fromEntries(
          [...planned.quotes.entries()].map(([listingId, quote]) => [listingId, quote.id])
        ),
      };
    }
  }

  // Carried on the form so a double-submitted checkout replays the first
  // result instead of creating a second set of orders.
  const effectiveBrowserIdentity = browserIdentity ?? await guestCheckoutIdentity();
  let effectiveRawKey = rawKey || randomUUID();
  const guestKeyFor = (key: string) => createHash("sha256")
    .update(JSON.stringify([effectiveBrowserIdentity, key, shipping, [...ids].sort()]))
    .digest("hex");
  let idempotencyKey = replay?.idempotencyKey ?? guestKeyFor(effectiveRawKey);
  if (!user && !replay) {
    // OS-W17 (N85): a guest's key now survives a reload too. If the attempt
    // it names is over (lapsed or failed), replaying it would answer with
    // dead orders, so a new attempt starts instead.
    if (await attemptIsOver(idempotencyKey)) {
      effectiveRawKey = randomUUID();
      idempotencyKey = guestKeyFor(effectiveRawKey);
    }
  }

  const outcome = await purchaseListings(buyerId, ids, {
    useSavedCustomer: Boolean(user),
    idempotencyKey,
    checkoutRequestKey: checkoutRequestKey ?? undefined,
    checkoutContext,
    shipping: replay ? undefined : shipping,
    fulfillment: plan,
  });

  // Whatever happens next — an inline confirmation or a Stripe redirect — the
  // guest has no session, so this browser needs a receipt saying which orders
  // are its own. Order ids only, HMAC-signed: it can never be widened into
  // "read this account".
  if (guestEmail && outcome.orderIds.length) {
    await setGuestOrders(outcome.orderIds);
  }

  // Clear only what was actually bought — the old code emptied the whole cart
  // regardless, losing items that were never purchased.
  if (outcome.purchased.length) {
    await removeCartIds(outcome.purchased.map((p) => p.listingId));
  }

  // Async processor: hand the client secret back so the form can swap to the
  // Payment Element confirmation step. The cart stays intact until the money
  // is actually confirmed (the return route clears it).
  if (outcome.payment) {
    // OS-W17 (N85): the basket is reserved under this key; a reload renders
    // it back and resumes this payment instead of starting a second one.
    await rememberCheckoutKey(effectiveRawKey);
    return { payment: outcome.payment };
  }

  if (!outcome.purchased.length) {
    // Orders that exist without a settled outcome (processing, or a payment
    // still being reconciled) are retried under the same key. A key whose
    // attempt has ended is rotated on the next submit, so it can stay.
    if (outcome.orderIds.length) await rememberCheckoutKey(effectiveRawKey);
    return { error: outcome.error ?? "Nothing could be purchased." };
  }
  await forgetCheckoutKey();

  const params = new URLSearchParams({ placed: "1" });
  if (outcome.skipped.length) {
    params.set(
      "skipped",
      outcome.skipped.map((s) => s.title).join(", ").slice(0, 300)
    );
  }

  // A guest has no session, so /orders would bounce them to /login the moment
  // their money went through. They get the public confirmation instead, plus
  // an emailed link that signs them in and doubles as the account claim.
  if (guestEmail) {
    await sendOrderAccessLink(
      guestEmail,
      outcome.orderIds.length === 1 ? `/orders/${outcome.orderIds[0]}` : "/orders"
    );
    redirect(`/order-placed?${params.toString()}`);
  }

  if (outcome.orderIds.length === 1) {
    redirect(`/orders/${outcome.orderIds[0]}?${params.toString()}`);
  }
  redirect(`/orders?${params.toString()}`);
}

export async function completeReservedOrder(
  _prev: CommerceState,
  formData: FormData
): Promise<CommerceState> {
  const { user } = await requireUser();
  const admin = createAdminClient();

  const betaAccess = await getBetaAccess(user.id, "buyer");
  if (!betaAccess.eligible) return { error: betaCommerceError("buyer") };

  const orderId = String(formData.get("order_id") ?? "");
  if (!orderId) return { error: "Missing order." };

  const { data: order, error: orderReadError } = await admin
    .from("orders")
    .select("id, buyer_id, seller_id, status, total_cents, currency, origin_offer_id")
    .eq("id", orderId)
    .maybeSingle();

  if (orderReadError) return { error: "We couldn't load this order. Try again." };
  if (!order) return { error: "Order not found." };
  if (order.buyer_id !== user.id) return { error: "That isn't your order." };
  if (!order.origin_offer_id) return { error: "This checkout link is no longer valid." };
  // A successful request can reach the browser after its response was lost.
  // Return the durable state without asking the provider to create again.
  if (["paid", "shipped", "delivered", "completed"].includes(order.status)) {
    redirect(`/orders/${orderId}`);
  }
  if (order.status !== "pending") {
    return {
      // A lapsed 24-hour hold ends as payment_failed (finish_reservation_expiry),
      // not cancelled; both mean the part went back on sale.
      error:
        order.status === "cancelled"
          ? "This offer lapsed and the part went back on sale."
          : order.status === "payment_failed"
            ? "This offer's checkout ended without payment, and the part went back on sale."
            : "This order has already been settled.",
    };
  }

  const { shipping, error: shippingError } = readShipping(formData);
  if (shippingError) return { error: shippingError };

  // The database freezes this snapshot in the same lock which re-checks the
  // accepted offer and reservation. A lost response can replay the exact
  // address; a changed address cannot be attached to an existing payment.
  const { data: frozenOrder, error: shippingWriteError } = await admin.rpc(
    "freeze_accepted_offer_checkout",
    { p_order: orderId, p_actor: user.id, p_shipping: shipping as unknown as Json }
  );
  if (shippingWriteError) {
    // Collecting takes shipping off; an offer that only reached the minimum
    // charge with shipping can't then be paid by card.
    if (shippingWriteError.code === CHARGE_OUT_OF_BOUNDS_CODE) {
      return { error: "Without shipping this order comes to less than $0.50, which a card can't be charged. Choose delivery instead." };
    }
    reportError("[commerce] accepted-offer delivery write failed", { orderId, shippingWriteError });
    return { error: "Delivery details could not be confirmed. Check this order before trying again." };
  }
  const freezeResult = frozenOrder as { ok?: boolean; reason?: string; total_cents?: number } | null;
  if (!freezeResult?.ok) {
    const { data: currentOrder } = await admin
      .from("orders")
      .select("status")
      .eq("id", orderId)
      .maybeSingle();
    if (currentOrder && ["paid", "shipped", "delivered", "completed"].includes(currentOrder.status)) {
      redirect(`/orders/${orderId}`);
    }
    return { error: freezeResult?.reason ?? "This order changed before checkout. Check the order before trying again." };
  }
  // The freeze prices the order for the buyer's choice (a collected order
  // charges no shipping), so the amount read before it may be stale. The
  // payment is for what the freeze returned, never the earlier read.
  const totalCents = freezeResult.total_cents;
  if (typeof totalCents !== "number" || !Number.isInteger(totalCents) || totalCents <= 0) {
    reportError("[commerce] accepted-offer freeze returned no total", { orderId });
    return { error: "This order changed before checkout. Check the order before trying again." };
  }

  // A failed read throws rather than passing for "no saved customer". Nothing
  // has been sent to the provider yet, so the buyer can simply retry.
  let customerId: string | null;
  try {
    customerId = await getStripeCustomerId(user.id);
  } catch (customerError) {
    reportError("[commerce] saved customer lookup failed", { orderId, customerError });
    return { error: "We couldn't start the payment. Nothing was charged — try again." };
  }

  const provider = getPaymentProvider();
  // Diagnostics identity (0039) — offer-completion orders get one too.
  await bindCheckoutAnalytics([orderId]);
  const payment = await provider.createPayment({
    orderId,
    buyerId: user.id,
    sellerId: order.seller_id ?? "",
    totalCents,
    currency: order.currency,
    idempotencyKey: `order:${orderId}`,
    customerId,
  });

  // Async processor: the buyer confirms in the browser; the webhook settles.
  if (payment.status === "requires_action") {
    const { data: stampedPayment, error: paymentWriteError } = await admin
      .from("payments")
      .update({ provider: provider.name, provider_reference: payment.reference })
      .eq("order_id", orderId)
      .select("id")
      .maybeSingle();
    if (paymentWriteError || !stampedPayment) {
      reportError("[commerce] accepted-offer payment reference write failed", {
        orderId,
        paymentWriteError,
      });
      return { error: "Payment setup is being reconciled. Check this order before trying again." };
    }
    return { payment: { clientSecret: payment.clientSecret, orderIds: [orderId], amountCents: totalCents } };
  }

  if (payment.status === "processing") return { error: "Your payment is processing. Check this order before trying again." };
  if (payment.status === "unknown") return { error: payment.reason };

  const { data: result, error: finalizeError } = await admin.rpc("purchase_finalize", {
    p_order_id: orderId,
    p_success: payment.status === "succeeded",
    p_provider: provider.name,
    p_reference: payment.status === "succeeded" ? payment.reference : null,
    p_failure_reason: payment.status === "failed" ? payment.reason : null,
  });

  revalidatePath("/orders");
  revalidatePath(`/orders/${orderId}`);

  if (finalizeError) {
    reportError("[commerce] accepted-offer finalize failed", { orderId, finalizeError });
    if (payment.status === "succeeded") {
      const { data: currentOrder } = await admin
        .from("orders")
        .select("status")
        .eq("id", orderId)
        .maybeSingle();
      if (currentOrder && ["paid", "shipped", "delivered", "completed"].includes(currentOrder.status)) {
        redirect(`/orders/${orderId}`);
      }
      return { error: "Payment was received and this order is being reconciled. Don't pay again." };
    }
    return { error: "Payment failed, but the reservation could not be released yet. Check this order before trying again." };
  }

  if (payment.status !== "succeeded") {
    return { error: `Payment failed: ${payment.status === "failed" ? payment.reason : "unknown"}` };
  }
  // purchase_finalize refuses anything already settled, so a replayed submit
  // reports the truth rather than pretending to charge twice.
  if (result && typeof result === "object" && "applied" in result && result.applied === false) {
    redirect(`/orders/${orderId}`);
  }
  redirect(`/orders/${orderId}?placed=1`);
}
