"use server";

import { bindCheckoutAnalytics } from "@/lib/purchase-analytics";

import { createHash, randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { abuseIdentity } from "@/lib/abuse-identity";
import { getCartIds, removeCartIds } from "@/lib/cart";
import { guestCheckoutIdentity, isPlausibleEmail, setGuestOrders } from "@/lib/guest-checkout";
import { resolveGuestBuyer, sendOrderAccessLink } from "./guest-buyer";
import { freezeOrderShipping, hashDestination, planCartFulfillment, type FulfillmentPlan } from "./checkout-shipping";
import { getPaymentProvider } from "@/lib/payments/provider";
import { getStripeCustomerId } from "@/lib/payments/customers";
import { RATE_LIMITS, allowAction, rateLimitMessage } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { capture } from "@/lib/analytics";
import { createClient } from "@/lib/supabase/server";
import type { PurchaseBeginResult } from "@/lib/database.types";
import { reportError } from "@/lib/monitoring";
import type { CommerceState, CheckoutOutcome, ShippingDetails } from "./action-types";

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

  const overrides = options.fulfillment?.overrides ?? {};
  const { data, error } = await admin.rpc("purchase_begin", {
    p_buyer_id: buyerId,
    p_listing_ids: listingIds,
    p_idempotency_key: options.idempotencyKey ?? null,
    p_shipping_overrides: Object.keys(overrides).length ? overrides : null,
  });

  if (error) {
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
    return {
      ...empty,
      skipped,
      error: skipped.length
        ? "Nothing was available — those parts have sold or are your own."
        : "Nothing purchasable in that request.",
    };
  }

  const provider = getPaymentProvider();
  const orderIds: string[] = [];
  const purchased: CheckoutOutcome["purchased"] = [];
  const failures: string[] = [];

  // Attach the delivery details to every order before charging, so a paid
  // order always knows where it is going. The 0053 collection guard re-checks
  // is_collection against the frozen snapshots — a refusal here means the
  // pre-validation missed something, and the checkout must not continue as a
  // shipping order the buyer believes is a pickup.
  if (options.shipping) {
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
  if (options.fulfillment?.quotes.size) {
    await freezeOrderShipping(admin, result.orders, options.fulfillment.quotes);
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
    idempotencyKey: options.idempotencyKey,
    customerId: options.useSavedCustomer ? await getStripeCustomerId(buyerId) : null,
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
    await admin
      .from("payments")
      .update({ provider: provider.name, provider_reference: payment.reference })
      .in("order_id", allOrderIds);
    return {
      orderIds: allOrderIds,
      purchased: [],
      skipped,
      payment: { clientSecret: payment.clientSecret, orderIds: allOrderIds },
    };
  } else if (payment.status === "processing") {
    return { ...empty, orderIds: allOrderIds, skipped, error: "Your payment is processing. Check your order before trying again." };
  } else if (payment.status === "unknown") {
    return { ...empty, orderIds: allOrderIds, skipped, error: payment.reason };
  } else {
    const reason = payment.reason;
    for (const order of result.orders) {
      await admin.rpc("purchase_finalize", {
        p_order_id: order.order_id,
        p_success: false,
        p_provider: provider.name,
        p_failure_reason: reason,
      });
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
  const requestHeaders = await headers();
  const subject = abuseIdentity(requestHeaders, user?.id);
  if (!(await allowAction(RATE_LIMITS.checkout, subject))) return { error: rateLimitMessage(RATE_LIMITS.checkout) };
  const ids = await getCartIds();
  if (!ids.length) return { error: "Your cart is empty." };

  const { shipping, error: shippingError } = readShipping(formData);
  if (shippingError) return { error: shippingError };

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
  const quoteIds: Record<string, string> = {};
  for (const id of ids) {
    const value = formData.get(`quote_${id}`);
    if (typeof value === "string" && value) quoteIds[id] = value;
  }
  const { plan, error: planError } = await planCartFulfillment(createAdminClient(), {
    listingIds: ids,
    isCollection: shipping?.isCollection ?? false,
    quoteIds,
    buyerId,
    destinationHash: shipping
      ? hashDestination({
          line1: shipping.line1,
          city: shipping.city,
          postcode: shipping.postcode,
          country: shipping.country,
        })
      : "",
  });
  if (planError || !plan) return { error: planError ?? "Couldn't verify delivery options." };

  // Carried on the form so a double-submitted checkout replays the first
  // result instead of creating a second set of orders.
  const browserIdentity = user ? `user:${user.id}` : await guestCheckoutIdentity();
  const rawKey = String(formData.get("idempotency_key") ?? "") || randomUUID();
  const idempotencyKey = createHash("sha256").update(JSON.stringify([browserIdentity, rawKey, shipping, [...ids].sort()])).digest("hex");

  const outcome = await purchaseListings(buyerId, ids, {
    useSavedCustomer: Boolean(user),
    idempotencyKey,
    shipping,
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
    return { payment: outcome.payment };
  }

  if (!outcome.purchased.length) {
    return { error: outcome.error ?? "Nothing could be purchased." };
  }

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

  const orderId = String(formData.get("order_id") ?? "");
  if (!orderId) return { error: "Missing order." };

  const { shipping, error: shippingError } = readShipping(formData);
  if (shippingError) return { error: shippingError };

  const { data: order } = await admin
    .from("orders")
    .select("id, buyer_id, seller_id, status, total_cents, currency")
    .eq("id", orderId)
    .maybeSingle();

  if (!order) return { error: "Order not found." };
  if (order.buyer_id !== user.id) return { error: "That isn't your order." };
  if (order.status !== "pending") {
    return {
      error:
        order.status === "cancelled"
          ? "This offer lapsed and the part went back on sale."
          : "This order has already been settled.",
    };
  }

  await admin
    .from("orders")
    .update({
      ship_name: shipping!.name,
      ship_line1: shipping!.line1,
      ship_line2: shipping!.line2,
      ship_city: shipping!.city,
      ship_postcode: shipping!.postcode,
      ship_country: shipping!.country,
      ship_state: shipping!.state,
      ship_phone: shipping!.phone,
      is_collection: shipping!.isCollection,
    })
    .eq("id", orderId);

  const provider = getPaymentProvider();
  // Diagnostics identity (0039) — offer-completion orders get one too.
  await bindCheckoutAnalytics([orderId]);
  const payment = await provider.createPayment({
    orderId,
    buyerId: user.id,
    sellerId: order.seller_id ?? "",
    totalCents: order.total_cents,
    currency: order.currency,
    idempotencyKey: `order:${orderId}`,
    customerId: await getStripeCustomerId(user.id),
  });

  // Async processor: the buyer confirms in the browser; the webhook settles.
  if (payment.status === "requires_action") {
    await admin
      .from("payments")
      .update({ provider: provider.name, provider_reference: payment.reference })
      .eq("order_id", orderId);
    return { payment: { clientSecret: payment.clientSecret, orderIds: [orderId] } };
  }

  if (payment.status === "processing") return { error: "Your payment is processing. Check this order before trying again." };
  if (payment.status === "unknown") return { error: payment.reason };

  const { data: result } = await admin.rpc("purchase_finalize", {
    p_order_id: orderId,
    p_success: payment.status === "succeeded",
    p_provider: provider.name,
    p_reference: payment.status === "succeeded" ? payment.reference : null,
    p_failure_reason: payment.status === "failed" ? payment.reason : null,
  });

  revalidatePath("/orders");
  revalidatePath(`/orders/${orderId}`);

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
