import { createHash } from "node:crypto";

import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  orderRead: vi.fn(),
  freeze: vi.fn(),
  finalize: vi.fn(),
  paymentWrite: vi.fn(),
  createPayment: vi.fn(),
  redirect: vi.fn(),
  bindAnalytics: vi.fn(),
  reportError: vi.fn(),
  cartIds: vi.fn(),
  attemptRead: vi.fn(),
  attemptEq: vi.fn(),
  replayOrdersRead: vi.fn(),
  cartRemove: vi.fn(),
  purchaseBegin: vi.fn(),
  cartFreeze: vi.fn(),
  listingRead: vi.fn(),
  plan: vi.fn(),
  paymentMapWrite: vi.fn(),
  paymentMapRead: vi.fn(),
  bindPayment: vi.fn(),
  guestAdmit: vi.fn(),
  guestBind: vi.fn(),
  guestRelease: vi.fn(),
  release: vi.fn(),
  rememberKey: vi.fn(),
  forgetKey: vi.fn(),
  itemsRead: vi.fn(),
  guestIdentity: vi.fn(),
  guestBuyer: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("next/headers", () => ({ headers: vi.fn() }));
vi.mock("@/lib/abuse-identity", () => ({ abuseIdentity: vi.fn().mockReturnValue("network:203.0.113.9") }));
vi.mock("@/lib/cart", () => ({ getCartIds: mocks.cartIds, removeCartIds: mocks.cartRemove }));
vi.mock("@/lib/guest-checkout", () => ({
  guestCheckoutIdentity: mocks.guestIdentity,
  isPlausibleEmail: vi.fn(() => true),
  setGuestOrders: vi.fn(),
}));
vi.mock("./guest-buyer", () => ({ resolveGuestBuyer: mocks.guestBuyer, sendOrderAccessLink: vi.fn() }));
vi.mock("@/lib/checkout-key", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/checkout-key")>()),
  rememberCheckoutKey: mocks.rememberKey,
  forgetCheckoutKey: mocks.forgetKey,
}));
vi.mock("./checkout-release", () => ({ releaseCartCheckout: mocks.release }));
vi.mock("./checkout-shipping", () => ({
  freezeOrderShipping: vi.fn(),
  hashDestination: vi.fn().mockReturnValue("destination-hash"),
  planCartFulfillment: mocks.plan,
}));
vi.mock("@/lib/payments/provider", () => ({
  getPaymentProvider: () => ({ name: "stripe", createPayment: mocks.createPayment }),
}));
vi.mock("@/lib/payments/customers", () => ({ getStripeCustomerId: vi.fn().mockResolvedValue("cus_buyer") }));
vi.mock("@/lib/rate-limit", () => ({ RATE_LIMITS: {}, allowAction: vi.fn().mockResolvedValue(true), rateLimitMessage: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ capture: vi.fn() }));
vi.mock("@/lib/purchase-analytics", () => ({ bindCheckoutAnalytics: mocks.bindAnalytics }));
vi.mock("@/lib/monitoring", () => ({ reportError: mocks.reportError }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: mocks.auth } }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    const attemptQuery = {
      select: () => attemptQuery,
      eq: (...args: unknown[]) => {
        mocks.attemptEq(...args);
        return attemptQuery;
      },
      maybeSingle: mocks.attemptRead,
    };
    const orderQuery = {
      select: () => orderQuery,
      eq: () => orderQuery,
      in: mocks.replayOrdersRead,
      maybeSingle: mocks.orderRead,
      update: () => ({ eq: () => ({ select: () => ({ maybeSingle: mocks.paymentWrite }) }) }),
    };
    const listingQuery = {
      select: () => listingQuery,
      in: mocks.listingRead,
    };
    const paymentQuery = {
      select: () => ({ in: mocks.paymentMapRead }),
      update: () => ({
        in: () => ({ select: mocks.paymentMapWrite }),
        eq: () => ({ select: () => ({ maybeSingle: mocks.paymentWrite }) }),
      }),
    };
    return {
      rpc: (name: string, args?: unknown) => {
        if (name === "freeze_accepted_offer_checkout") return mocks.freeze(args);
        if (name === "freeze_cart_checkout_shipping") return mocks.cartFreeze(args);
        if (name === "purchase_begin") return mocks.purchaseBegin(args);
        if (name === "bind_cart_checkout_payment") return mocks.bindPayment(args);
        if (name === "guest_hold_admit") return mocks.guestAdmit(args);
        if (name === "guest_hold_bind") return mocks.guestBind(args);
        if (name === "guest_hold_release") return mocks.guestRelease(args);
        return mocks.finalize(args);
      },
      from: (table: string) => {
        if (table === "purchase_attempts") return attemptQuery;
        if (table === "listings") return listingQuery;
        if (table === "payments") return paymentQuery;
        if (table === "order_items") return { select: () => ({ in: mocks.itemsRead }) };
        return orderQuery;
      },
    };
  },
}));

import { checkoutCart, completeReservedOrder } from "./checkout-actions";
import { getStripeCustomerId } from "@/lib/payments/customers";
import { guestCheckoutIdentity, isPlausibleEmail } from "@/lib/guest-checkout";
import { resolveGuestBuyer } from "./guest-buyer";
import { freezeOrderShipping } from "./checkout-shipping";
import { GUEST_HOLD_LIMIT_MESSAGE, GUEST_HOLD_TAKEN_MESSAGE } from "./guest-holds";
import { cartCheckoutRequestKey } from "@/lib/checkout-key";

const pendingOfferOrder = {
  id: "order-1",
  buyer_id: "buyer-1",
  seller_id: "seller-1",
  status: "pending",
  total_cents: 5500,
  currency: "USD",
  origin_offer_id: "offer-1",
};

function checkoutForm(includeAddress = true) {
  const form = new FormData();
  form.set("order_id", "order-1");
  if (includeAddress) {
    form.set("ship_name", "Buyer One");
    form.set("ship_line1", "10 Main Street");
    form.set("ship_city", "Detroit");
    form.set("ship_postcode", "48201");
    form.set("ship_country", "US");
  }
  return form;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ data: { user: { id: "buyer-1" } } });
  mocks.orderRead.mockResolvedValue({ data: pendingOfferOrder, error: null });
  mocks.freeze.mockResolvedValue({ data: { ok: true, applied: true, total_cents: 5500 }, error: null });
  mocks.finalize.mockResolvedValue({ data: { applied: true }, error: null });
  mocks.paymentWrite.mockResolvedValue({ data: { id: "payment-1" }, error: null });
  mocks.createPayment.mockResolvedValue({ status: "requires_action", reference: "pi_1", clientSecret: "secret" });
  mocks.bindAnalytics.mockResolvedValue(undefined);
  mocks.cartIds.mockResolvedValue([]);
  mocks.attemptRead.mockResolvedValue({ data: null, error: null });
  mocks.replayOrdersRead.mockResolvedValue({ data: [], error: null });
  mocks.cartRemove.mockResolvedValue(undefined);
  mocks.purchaseBegin.mockResolvedValue({
    data: {
      orders: [{
        order_id: "order-1",
        seller_id: "seller-1",
        currency: "USD",
        subtotal_cents: 5000,
        shipping_cents: 500,
        platform_fee_cents: 550,
        total_cents: 5500,
        listing_ids: ["listing-1"],
      }],
      skipped: [],
    },
    error: null,
  });
  mocks.cartFreeze.mockResolvedValue({ data: { ok: true, replayed: false }, error: null });
  mocks.listingRead.mockResolvedValue({ data: [{ id: "listing-1", title: "Intercooler" }], error: null });
  mocks.plan.mockResolvedValue({ plan: { overrides: {}, quotes: new Map() } });
  mocks.paymentMapWrite.mockResolvedValue({
    data: [{ order_id: "order-1", provider: "stripe", provider_reference: "pi_1" }],
    error: null,
  });
  mocks.paymentMapRead.mockResolvedValue({
    data: [{ order_id: "order-1", provider: "stripe", provider_reference: "pi_1" }],
    error: null,
  });
  mocks.bindPayment.mockResolvedValue({ data: { ok: true, mapped: 1 }, error: null });
  mocks.guestAdmit.mockResolvedValue({ data: ["hold-1"], error: null });
  mocks.guestBind.mockResolvedValue({ data: 1, error: null });
  mocks.guestRelease.mockResolvedValue({ data: 1, error: null });
  mocks.redirect.mockImplementation((path: string) => { throw new Error(`redirect:${path}`); });
  mocks.release.mockResolvedValue({ outcome: "released" });
  mocks.rememberKey.mockResolvedValue(undefined);
  mocks.forgetKey.mockResolvedValue(undefined);
  mocks.itemsRead.mockResolvedValue({ data: [], error: null });
  mocks.guestIdentity.mockResolvedValue("guest:browser-1");
  mocks.guestBuyer.mockResolvedValue({ buyer: { id: "guest-1", created: false } });
});

function cartCheckoutForm(line1 = "10 Main Street") {
  const form = new FormData();
  form.set("idempotency_key", "33333333-3333-4333-8333-333333333333");
  form.set("ship_name", "Buyer One");
  form.set("ship_line1", line1);
  form.set("ship_city", "Detroit");
  form.set("ship_postcode", "48201");
  form.set("ship_country", "US");
  return form;
}

function durableCartAttempt(line1 = "10 Main Street", quoteId?: string) {
  const form = cartCheckoutForm(line1);
  if (quoteId) form.set("quote_listing-1", quoteId);
  const shipping = {
    name: "Buyer One",
    line1,
    line2: null,
    city: "Detroit",
    postcode: "48201",
    country: "US",
    state: null,
    phone: null,
    isCollection: false,
  };
  return {
    form,
    attempt: {
      idempotency_key: createHash("sha256")
        .update(JSON.stringify(["user:buyer-1", "33333333-3333-4333-8333-333333333333", shipping, ["listing-1"]]))
        .digest("hex"),
      request_fingerprint: { ids: ["listing-1"], shipping: {} },
      checkout_context: {
        version: 1,
        shipping,
        destinationHash: "destination-hash",
        quoteIds: quoteId ? { "listing-1": quoteId } : {},
      },
      result: {
        orders: [{
          order_id: "order-1",
          seller_id: "seller-1",
          currency: "USD",
          subtotal_cents: 5000,
          shipping_cents: 500,
          platform_fee_cents: 550,
          total_cents: 5500,
          listing_ids: ["listing-1"],
        }],
        skipped: [],
      },
    },
  };
}

it("recovers the authenticated buyer's exact paid checkout before reading an empty cart", async () => {
  const { form, attempt } = durableCartAttempt();
  mocks.attemptRead.mockResolvedValue({ data: attempt, error: null });
  mocks.replayOrdersRead.mockResolvedValue({ data: [{ id: "order-1", status: "paid" }], error: null });

  await expect(checkoutCart({}, form)).rejects.toThrow("redirect:/orders/order-1?placed=1");

  const requestKey = createHash("sha256")
    .update(JSON.stringify(["cart-checkout:v1", "user:buyer-1", "33333333-3333-4333-8333-333333333333"]))
    .digest("hex");
  expect(mocks.attemptEq).toHaveBeenCalledWith("checkout_request_key", requestKey);
  expect(mocks.attemptEq).toHaveBeenCalledWith("buyer_id", "buyer-1");
  expect(mocks.cartIds).not.toHaveBeenCalled();
  expect(mocks.createPayment).not.toHaveBeenCalled();
});

// OS-W17 — checkout resume and reservations. The form carries the key the
// page rendered from the checkout-key cookie; these cover what the server
// does with an existing attempt under that key.
const FORM_KEY = "33333333-3333-4333-8333-333333333333";

it("N85: resumes the same reserved attempt after a reload instead of reporting nothing available", async () => {
  const { form, attempt } = durableCartAttempt();
  mocks.attemptRead.mockResolvedValue({ data: attempt, error: null });
  mocks.replayOrdersRead.mockResolvedValue({ data: [{ id: "order-1", status: "pending" }], error: null });
  mocks.cartIds.mockResolvedValue(["listing-1"]);

  const result = await checkoutCart({}, form);

  expect(mocks.release).not.toHaveBeenCalled();
  expect(mocks.purchaseBegin).toHaveBeenCalledWith(expect.objectContaining({
    p_idempotency_key: attempt.idempotency_key,
    p_checkout_context: attempt.checkout_context,
  }));
  expect(mocks.createPayment).toHaveBeenCalledWith(expect.objectContaining({ idempotencyKey: attempt.idempotency_key }));
  expect(result.payment?.clientSecret).toBe("secret");
  expect(mocks.rememberKey).toHaveBeenCalledWith(FORM_KEY);
});

it("N86: Edit address releases the buyer's own hold and restarts the checkout for the new address", async () => {
  const original = durableCartAttempt();
  mocks.attemptRead.mockResolvedValue({ data: original.attempt, error: null });
  mocks.replayOrdersRead.mockResolvedValue({ data: [{ id: "order-1", status: "pending" }], error: null });
  mocks.cartIds.mockResolvedValue(["listing-1"]);

  const result = await checkoutCart({}, cartCheckoutForm("99 Changed Street"));

  expect(mocks.release).toHaveBeenCalledWith(expect.anything(), {
    buyerId: "buyer-1",
    idempotencyKey: original.attempt.idempotency_key,
    orderIds: ["order-1"],
  });
  // A new attempt: neither the old payment key nor the old browser binding.
  const begun = mocks.purchaseBegin.mock.calls[0][0] as Record<string, unknown>;
  expect(begun.p_idempotency_key).not.toBe(original.attempt.idempotency_key);
  expect(begun.p_checkout_request_key).not.toBe(cartCheckoutRequestKey("buyer-1", FORM_KEY));
  expect(begun.p_checkout_context).toEqual(expect.objectContaining({
    shipping: expect.objectContaining({ line1: "99 Changed Street" }),
  }));
  expect(mocks.release.mock.invocationCallOrder[0]).toBeLessThan(mocks.purchaseBegin.mock.invocationCallOrder[0]);
  expect(result.payment?.clientSecret).toBe("secret");
  // The cookie now names the new attempt, so a reload resumes that one.
  const remembered = mocks.rememberKey.mock.calls[0][0];
  expect(remembered).not.toBe(FORM_KEY);
  expect(cartCheckoutRequestKey("buyer-1", remembered)).toBe(begun.p_checkout_request_key);
});

it("N86: a different shipping service releases and restarts rather than refusing", async () => {
  const original = durableCartAttempt("10 Main Street", "quote-original");
  mocks.attemptRead.mockResolvedValue({ data: original.attempt, error: null });
  mocks.replayOrdersRead.mockResolvedValue({ data: [{ id: "order-1", status: "pending" }], error: null });
  mocks.cartIds.mockResolvedValue(["listing-1"]);

  const result = await checkoutCart({}, durableCartAttempt("10 Main Street", "quote-changed").form);

  expect(mocks.release).toHaveBeenCalledTimes(1);
  expect(mocks.purchaseBegin).toHaveBeenCalledWith(expect.objectContaining({
    p_idempotency_key: expect.not.stringMatching(original.attempt.idempotency_key),
  }));
  expect(result.payment).toBeDefined();
});

it("N86: a changed cart releases the old basket and reserves the new one", async () => {
  const { form, attempt } = durableCartAttempt();
  mocks.attemptRead.mockResolvedValue({ data: attempt, error: null });
  mocks.replayOrdersRead.mockResolvedValue({ data: [{ id: "order-1", status: "pending" }], error: null });
  mocks.cartIds.mockResolvedValue(["listing-1", "listing-2"]);

  await checkoutCart({}, form);

  expect(mocks.release).toHaveBeenCalledTimes(1);
  expect(mocks.purchaseBegin).toHaveBeenCalledWith(expect.objectContaining({
    p_listing_ids: ["listing-1", "listing-2"],
  }));
});

it("N86: keeps the hold and starts nothing when the earlier payment can't be resolved", async () => {
  const original = durableCartAttempt();
  mocks.attemptRead.mockResolvedValue({ data: original.attempt, error: null });
  mocks.replayOrdersRead.mockResolvedValue({ data: [{ id: "order-1", status: "pending" }], error: null });
  mocks.cartIds.mockResolvedValue(["listing-1"]);
  mocks.release.mockResolvedValue({ outcome: "unresolved" });

  const result = await checkoutCart({}, cartCheckoutForm("99 Changed Street"));

  expect(result.error).toContain("still being confirmed");
  expect(mocks.purchaseBegin).not.toHaveBeenCalled();
  expect(mocks.createPayment).not.toHaveBeenCalled();
});

it("N86: shows the order, not a second payment, when the released checkout had in fact been paid", async () => {
  const original = durableCartAttempt();
  mocks.attemptRead.mockResolvedValue({ data: original.attempt, error: null });
  mocks.replayOrdersRead.mockResolvedValue({ data: [{ id: "order-1", status: "pending" }], error: null });
  mocks.cartIds.mockResolvedValue(["listing-1"]);
  mocks.release.mockResolvedValue({ outcome: "settled" });

  await expect(checkoutCart({}, cartCheckoutForm("99 Changed Street"))).rejects.toThrow("redirect:/orders/order-1?placed=1");

  expect(mocks.forgetKey).toHaveBeenCalled();
  expect(mocks.purchaseBegin).not.toHaveBeenCalled();
  expect(mocks.createPayment).not.toHaveBeenCalled();
});

it("N85: starts a new attempt when the remembered one has lapsed", async () => {
  const { form, attempt } = durableCartAttempt();
  mocks.attemptRead.mockResolvedValue({ data: attempt, error: null });
  mocks.replayOrdersRead.mockResolvedValue({ data: [{ id: "order-1", status: "payment_failed" }], error: null });
  mocks.cartIds.mockResolvedValue(["listing-1"]);

  const result = await checkoutCart({}, form);

  expect(mocks.release).not.toHaveBeenCalled();
  expect(mocks.purchaseBegin).toHaveBeenCalledWith(expect.objectContaining({
    p_idempotency_key: expect.not.stringMatching(attempt.idempotency_key),
  }));
  expect(result.payment).toBeDefined();
});

it("N85: a guest's lapsed attempt is not replayed either", async () => {
  mocks.auth.mockResolvedValue({ data: { user: null } });
  mocks.cartIds.mockResolvedValue(["listing-1"]);
  mocks.attemptRead.mockResolvedValue({ data: { result: { orders: [{ order_id: "order-1" }], skipped: [] } }, error: null });
  mocks.replayOrdersRead.mockResolvedValue({ data: [{ id: "order-1", status: "payment_failed" }], error: null });
  const form = cartCheckoutForm();
  form.set("email", "guest@example.test");
  const shipping = { name: "Buyer One", line1: "10 Main Street", line2: null, city: "Detroit", postcode: "48201", country: "US", state: null, phone: null, isCollection: false };
  const lapsedKey = createHash("sha256")
    .update(JSON.stringify(["guest:browser-1", FORM_KEY, shipping, ["listing-1"]]))
    .digest("hex");

  await checkoutCart({}, form);

  expect(mocks.attemptEq).toHaveBeenCalledWith("idempotency_key", lapsedKey);
  const begun = mocks.purchaseBegin.mock.calls[0][0] as Record<string, unknown>;
  expect(begun.p_buyer_id).toBe("guest-1");
  expect(begun.p_idempotency_key).not.toBe(lapsedKey);
});

it("N85: says the buyer's own checkout holds the parts, not that they sold", async () => {
  mocks.cartIds.mockResolvedValue(["listing-1"]);
  mocks.purchaseBegin.mockResolvedValue({
    data: { orders: [], skipped: [{ listing_id: "listing-1", reason: "unavailable" }] },
    error: null,
  });
  mocks.replayOrdersRead.mockResolvedValue({
    data: [{ id: "order-9", order_items: [{ listing_id: "listing-1" }] }],
    error: null,
  });

  const result = await checkoutCart({}, cartCheckoutForm());

  expect(result.error).toContain("Your checkout is already holding these parts");
  expect(result.error).not.toContain("sold");
  expect(mocks.createPayment).not.toHaveBeenCalled();
});

it("N87: an empty cart on another device says the buyer's own checkout holds the parts", async () => {
  mocks.cartIds.mockResolvedValue([]);
  mocks.replayOrdersRead.mockResolvedValue({
    data: [{ id: "order-9", order_items: [{ listing_id: "listing-1" }] }],
    error: null,
  });

  const result = await checkoutCart({}, cartCheckoutForm());

  expect(result.error).toContain("Your checkout is already holding these parts");
  expect(mocks.purchaseBegin).not.toHaveBeenCalled();
});

it("N88: explains the unfinished-checkout cap instead of a generic failure", async () => {
  mocks.cartIds.mockResolvedValue(["listing-1"]);
  mocks.purchaseBegin.mockResolvedValue({ data: null, error: { code: "P0001", message: "Too many unresolved checkouts" } });

  const result = await checkoutCart({}, cartCheckoutForm());

  expect(result.error).toContain("5 checkouts waiting for payment");
  expect(result.error).toContain("Nothing was charged");
  expect(mocks.reportError).not.toHaveBeenCalled();
  expect(mocks.createPayment).not.toHaveBeenCalled();
});

it("N485: the payment step's breakdown is what the server reserved, not the page-load cart", async () => {
  mocks.cartIds.mockResolvedValue(["listing-1", "listing-2"]);
  mocks.listingRead.mockResolvedValue({
    data: [{ id: "listing-1", title: "Intercooler" }, { id: "listing-2", title: "Downpipe" }],
    error: null,
  });
  // listing-2 sold meanwhile and listing-1's price rose to $50 since the page loaded.
  mocks.purchaseBegin.mockResolvedValue({
    data: {
      orders: [{
        order_id: "order-1", seller_id: "seller-1", currency: "USD",
        subtotal_cents: 5000, shipping_cents: 500, platform_fee_cents: 550, total_cents: 5500,
        listing_ids: ["listing-1"],
      }],
      skipped: [{ listing_id: "listing-2", reason: "unavailable" }],
    },
    error: null,
  });
  mocks.itemsRead.mockResolvedValue({ data: [{ listing_id: "listing-1", title: "Intercooler", price_cents: 5000 }], error: null });

  const result = await checkoutCart({}, cartCheckoutForm());

  expect(result.payment).toEqual(expect.objectContaining({
    amountCents: 5500,
    breakdown: {
      goodsCents: 5000,
      shippingCents: 500,
      lines: [{ id: "listing-1", title: "Intercooler", priceCents: 5000 }],
      skipped: ["Downpipe"],
    },
  }));
});

it("journals and freezes authenticated delivery before crossing the provider boundary", async () => {
  mocks.cartIds.mockResolvedValue(["listing-1"]);
  mocks.createPayment.mockResolvedValue({ status: "requires_action", reference: "pi_1", clientSecret: "secret" });

  const result = await checkoutCart({}, cartCheckoutForm());

  expect(mocks.purchaseBegin).toHaveBeenCalledWith(expect.objectContaining({
    p_checkout_request_key: expect.any(String),
    p_checkout_context: expect.objectContaining({
      version: 1,
      shipping: expect.objectContaining({ line1: "10 Main Street" }),
      quoteIds: {},
    }),
  }));
  expect(mocks.cartFreeze).toHaveBeenCalledWith(expect.objectContaining({
    p_buyer: "buyer-1",
    p_order: "order-1",
    p_idempotency_key: expect.any(String),
  }));
  expect(result.payment?.clientSecret).toBe("secret");
});

it("does not expose payment confirmation when the local provider mapping is unverified", async () => {
  mocks.cartIds.mockResolvedValue(["listing-1"]);
  mocks.createPayment.mockResolvedValue({ status: "requires_action", reference: "pi_1", clientSecret: "secret" });
  mocks.bindPayment.mockResolvedValue({ data: null, error: { message: "response lost" } });
  mocks.paymentMapRead.mockResolvedValue({ data: [], error: null });

  const result = await checkoutCart({}, cartCheckoutForm());

  expect(result.payment).toBeUndefined();
  expect(result.error).toContain("reconciled");
  expect(mocks.cartRemove).not.toHaveBeenCalled();
});

it("does not clear the cart or claim placement until inline settlement is verified", async () => {
  mocks.cartIds.mockResolvedValue(["listing-1"]);
  mocks.createPayment.mockResolvedValue({ status: "succeeded", reference: "pi_succeeded" });
  mocks.finalize.mockResolvedValue({ data: null, error: { message: "response lost" } });
  mocks.orderRead.mockResolvedValue({ data: { status: "pending" }, error: null });

  const result = await checkoutCart({}, cartCheckoutForm());

  expect(result.error).toContain("Don't pay again");
  expect(mocks.cartRemove).not.toHaveBeenCalled();
  expect(mocks.redirect).not.toHaveBeenCalled();
});

it("adopts an inline settlement whose RPC response was lost", async () => {
  mocks.cartIds.mockResolvedValue(["listing-1"]);
  mocks.createPayment.mockResolvedValue({ status: "succeeded", reference: "pi_succeeded" });
  mocks.finalize.mockResolvedValue({ data: null, error: { message: "response lost" } });
  mocks.orderRead.mockResolvedValue({ data: { status: "paid" }, error: null });

  await expect(checkoutCart({}, cartCheckoutForm())).rejects.toThrow("redirect:/orders/order-1?placed=1");

  expect(mocks.cartRemove).toHaveBeenCalledWith(["listing-1"]);
});

it("reports reconciliation when a failed payment reservation release is unverified", async () => {
  mocks.cartIds.mockResolvedValue(["listing-1"]);
  mocks.createPayment.mockResolvedValue({ status: "failed", reason: "card declined" });
  mocks.finalize.mockResolvedValue({ data: null, error: { message: "release response lost" } });
  mocks.orderRead
    .mockResolvedValueOnce({ data: { status: "pending" }, error: null })
    .mockResolvedValueOnce({ data: { status: "pending" }, error: null });

  const result = await checkoutCart({}, cartCheckoutForm());

  expect(result.error).toContain("reservation is still being reconciled");
  expect(mocks.cartRemove).not.toHaveBeenCalled();
});

it("reports payment failure only after the reservation release is verified", async () => {
  mocks.cartIds.mockResolvedValue(["listing-1"]);
  mocks.createPayment.mockResolvedValue({ status: "failed", reason: "card declined" });
  mocks.orderRead
    .mockResolvedValueOnce({ data: { status: "pending" }, error: null })
    .mockResolvedValueOnce({ data: { status: "payment_failed" }, error: null });

  const result = await checkoutCart({}, cartCheckoutForm());

  expect(result.error).toContain("Payment failed");
  expect(result.error).not.toContain("reconciled");
  expect(mocks.cartRemove).not.toHaveBeenCalled();
});

it("refuses the accepted-offer payment route for an ordinary pending order", async () => {
  mocks.orderRead.mockResolvedValue({ data: { ...pendingOfferOrder, origin_offer_id: null }, error: null });
  const result = await completeReservedOrder({}, checkoutForm());
  expect(result.error).toContain("checkout link");
  expect(mocks.freeze).not.toHaveBeenCalled();
  expect(mocks.createPayment).not.toHaveBeenCalled();
});

it("turns a lost successful response into a truthful order redirect without another provider call", async () => {
  mocks.orderRead.mockResolvedValue({ data: { ...pendingOfferOrder, status: "paid" }, error: null });
  await expect(completeReservedOrder({}, checkoutForm(false))).rejects.toThrow("redirect:/orders/order-1");
  expect(mocks.createPayment).not.toHaveBeenCalled();
});

it("does not cross the provider boundary when the immutable shipping freeze fails", async () => {
  mocks.freeze.mockResolvedValue({ data: null, error: { message: "snapshot changed" } });
  const result = await completeReservedOrder({}, checkoutForm());
  expect(result.error).toContain("Check this order");
  expect(result.error).not.toContain("Nothing was charged");
  expect(mocks.createPayment).not.toHaveBeenCalled();
});

it("charges a collected accepted offer the total the freeze priced, without shipping", async () => {
  // The order was read at 5500 (goods + flat shipping); collecting takes the
  // 500 of shipping off inside the freeze.
  mocks.freeze.mockResolvedValue({ data: { ok: true, applied: true, total_cents: 5000 }, error: null });
  mocks.createPayment.mockResolvedValue({ status: "requires_action", reference: "pi_1", clientSecret: "secret_1" });
  mocks.paymentWrite.mockResolvedValue({ data: { id: "pay-1" }, error: null });
  const form = checkoutForm(false);
  form.set("is_collection", "on");
  form.set("ship_name", "Buyer One");
  const result = await completeReservedOrder({}, form);
  expect(mocks.freeze).toHaveBeenCalledWith(
    expect.objectContaining({ p_shipping: expect.objectContaining({ isCollection: true }) })
  );
  expect(mocks.createPayment).toHaveBeenCalledWith(expect.objectContaining({ totalCents: 5000 }));
  expect(result.payment?.amountCents).toBe(5000);
});

it("says why a collected offer below the card minimum can't be paid", async () => {
  mocks.freeze.mockResolvedValue({ data: null, error: { code: "22003", message: "out of bounds" } });
  const result = await completeReservedOrder({}, checkoutForm());
  expect(result.error).toContain("less than $0.50");
  expect(mocks.createPayment).not.toHaveBeenCalled();
});

it("passes on the freeze's reason when pickup isn't offered", async () => {
  mocks.freeze.mockResolvedValue({
    data: { ok: false, applied: false, reason: "Local pickup isn't offered for this part — choose delivery instead." },
    error: null,
  });
  mocks.orderRead
    .mockResolvedValueOnce({ data: pendingOfferOrder, error: null })
    .mockResolvedValueOnce({ data: { status: "pending" }, error: null });
  const result = await completeReservedOrder({}, checkoutForm());
  expect(result.error).toContain("Local pickup isn't offered");
  expect(mocks.createPayment).not.toHaveBeenCalled();
});

it("never charges a total the freeze didn't confirm", async () => {
  mocks.freeze.mockResolvedValue({ data: { ok: true, applied: true }, error: null });
  const result = await completeReservedOrder({}, checkoutForm());
  expect(result.error).toContain("Check the order");
  expect(mocks.createPayment).not.toHaveBeenCalled();
});

it("withholds a client secret when its local payment mapping cannot be verified", async () => {
  mocks.paymentWrite.mockResolvedValue({ data: null, error: { message: "write lost" } });
  const result = await completeReservedOrder({}, checkoutForm());
  expect(result.payment).toBeUndefined();
  expect(result.error).toContain("reconciled");
});

it("does not claim placement when local settlement fails after provider success", async () => {
  mocks.createPayment.mockResolvedValue({ status: "succeeded", reference: "pi_succeeded" });
  mocks.finalize.mockResolvedValue({ data: null, error: { message: "database unavailable" } });
  mocks.orderRead
    .mockResolvedValueOnce({ data: pendingOfferOrder, error: null })
    .mockResolvedValueOnce({ data: { status: "pending" }, error: null });
  const result = await completeReservedOrder({}, checkoutForm());
  expect(result.error).toContain("Don't pay again");
  expect(mocks.redirect).not.toHaveBeenCalled();
});

it("recognizes settlement that committed before its RPC response was lost", async () => {
  mocks.createPayment.mockResolvedValue({ status: "succeeded", reference: "pi_succeeded" });
  mocks.finalize.mockResolvedValue({ data: null, error: { message: "response lost" } });
  mocks.orderRead
    .mockResolvedValueOnce({ data: pendingOfferOrder, error: null })
    .mockResolvedValueOnce({ data: { status: "paid" }, error: null });
  await expect(completeReservedOrder({}, checkoutForm())).rejects.toThrow("redirect:/orders/order-1");
  expect(mocks.redirect).toHaveBeenCalledWith("/orders/order-1");
});

it("says why a basket outside the card-charge bounds was refused, before anything is reserved", async () => {
  mocks.cartIds.mockResolvedValue(["listing-1"]);
  mocks.purchaseBegin.mockResolvedValue({ data: null, error: { code: "22003", message: "out of bounds" } });

  const result = await checkoutCart({}, cartCheckoutForm());

  expect(result.error).toContain("between $0.50 and $999,999.99");
  expect(mocks.createPayment).not.toHaveBeenCalled();
  expect(mocks.reportError).not.toHaveBeenCalled();
});

it("says so when the database refuses a seller whose payouts are off (N244)", async () => {
  mocks.cartIds.mockResolvedValue(["listing-1"]);
  mocks.purchaseBegin.mockResolvedValue({ data: null, error: { code: "LS001", message: "This seller can't take payment yet" } });

  const result = await checkoutCart({}, cartCheckoutForm());

  expect(result.error).toMatch(/payouts aren't set up. Nothing was charged/);
  expect(mocks.createPayment).not.toHaveBeenCalled();
  expect(mocks.reportError).not.toHaveBeenCalled();
});

it("reserves nothing when the saved Stripe customer can't be read", async () => {
  mocks.cartIds.mockResolvedValue(["listing-1"]);
  vi.mocked(getStripeCustomerId).mockRejectedValueOnce(new Error("Stripe customer lookup failed"));

  const result = await checkoutCart({}, cartCheckoutForm());

  expect(result.error).toContain("Nothing was charged");
  expect(mocks.purchaseBegin).not.toHaveBeenCalled();
  expect(mocks.createPayment).not.toHaveBeenCalled();
});

// OS-W31: guest checkout opens with the beta gone, so its holds are capped
// (N89) and its DRVN Shipping path must work for a quote with no buyer.
function asGuest() {
  mocks.auth.mockResolvedValue({ data: { user: null } });
  vi.mocked(guestCheckoutIdentity).mockResolvedValue("guest:device-1");
  vi.mocked(isPlausibleEmail).mockReturnValue(true);
  vi.mocked(resolveGuestBuyer).mockResolvedValue({ buyer: { id: "guest-buyer-1", created: false } } as never);
  mocks.cartIds.mockResolvedValue(["listing-1"]);
}

function guestForm() {
  const form = cartCheckoutForm();
  form.set("email", "guest@example.com");
  form.set("quote_listing-1", "quote-guest");
  return form;
}

const buyerlessQuote = { id: "quote-guest", listing_id: "listing-1", buyer_id: null, amount_cents: 500 };

it("guest DRVN Shipping: a buyer-less quote freezes through the guest path, never the signed-in buyer-matched freeze", async () => {
  asGuest();
  mocks.plan.mockResolvedValue({ plan: { overrides: { "listing-1": 500 }, quotes: new Map([["listing-1", buyerlessQuote]]) } });

  const result = await checkoutCart({}, guestForm());

  expect(mocks.plan).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
    buyerId: "guest-buyer-1",
    quoteIds: { "listing-1": "quote-guest" },
  }));
  expect(mocks.purchaseBegin).toHaveBeenCalledWith(expect.objectContaining({ p_checkout_request_key: undefined }));
  expect(mocks.cartFreeze).not.toHaveBeenCalled();
  expect(vi.mocked(freezeOrderShipping)).toHaveBeenCalledWith(
    expect.anything(),
    expect.arrayContaining([expect.objectContaining({ order_id: "order-1" })]),
    new Map([["listing-1", buyerlessQuote]]),
  );
  expect(result.payment?.clientSecret).toBe("secret");
});

it("admits a guest's holds before reserving anything, keyed by one-way digests of device and network, and binds them after", async () => {
  asGuest();

  await checkoutCart({}, guestForm());

  const admit = mocks.guestAdmit.mock.calls[0][0] as Record<string, unknown>;
  expect(admit).toMatchObject({ p_listing_ids: ["listing-1"], p_buyer: "guest-buyer-1" });
  expect(admit.p_device).toMatch(/^[0-9a-f]{64}$/);
  expect(admit.p_network).toMatch(/^[0-9a-f]{64}$/);
  expect(JSON.stringify(admit)).not.toContain("device-1");
  expect(JSON.stringify(admit)).not.toContain("203.0.113.9");
  expect(mocks.guestAdmit.mock.invocationCallOrder[0]).toBeLessThan(mocks.purchaseBegin.mock.invocationCallOrder[0]);
  expect(mocks.guestBind).toHaveBeenCalledWith({ p_hold_ids: ["hold-1"], p_buyer: "guest-buyer-1" });
  expect(mocks.guestRelease).not.toHaveBeenCalled();
});

it("refuses a guest over the hold cap (GH429) or on a part another guest holds (GH409) before reserving or charging", async () => {
  asGuest();
  mocks.guestAdmit.mockResolvedValueOnce({ data: null, error: { code: "GH429", message: "cap" } });
  expect(await checkoutCart({}, guestForm())).toEqual({ error: GUEST_HOLD_LIMIT_MESSAGE });
  mocks.guestAdmit.mockResolvedValueOnce({ data: null, error: { code: "GH409", message: "taken" } });
  expect(await checkoutCart({}, guestForm())).toEqual({ error: GUEST_HOLD_TAKEN_MESSAGE });
  expect(mocks.purchaseBegin).not.toHaveBeenCalled();
  expect(mocks.createPayment).not.toHaveBeenCalled();
});

it("gives a guest's admission back when nothing was reserved", async () => {
  asGuest();
  mocks.purchaseBegin.mockResolvedValue({ data: { orders: [], skipped: [{ listing_id: "listing-1", reason: "sold" }] }, error: null });

  await checkoutCart({}, guestForm());

  expect(mocks.guestRelease).toHaveBeenCalledWith({ p_hold_ids: ["hold-1"] });
  expect(mocks.guestBind).not.toHaveBeenCalled();
});

it("never admits guest holds for a signed-in buyer", async () => {
  mocks.cartIds.mockResolvedValue(["listing-1"]);
  await checkoutCart({}, cartCheckoutForm());
  expect(mocks.guestAdmit).not.toHaveBeenCalled();
});
