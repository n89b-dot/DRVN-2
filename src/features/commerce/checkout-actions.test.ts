import { createHash } from "node:crypto";

import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  beta: vi.fn(),
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
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("next/headers", () => ({ headers: vi.fn() }));
vi.mock("@/lib/abuse-identity", () => ({ abuseIdentity: vi.fn() }));
vi.mock("@/lib/cart", () => ({ getCartIds: mocks.cartIds, removeCartIds: mocks.cartRemove }));
vi.mock("@/lib/guest-checkout", () => ({ guestCheckoutIdentity: vi.fn(), isPlausibleEmail: vi.fn(), setGuestOrders: vi.fn() }));
vi.mock("./guest-buyer", () => ({ resolveGuestBuyer: vi.fn(), sendOrderAccessLink: vi.fn() }));
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
vi.mock("@/lib/beta-access", () => ({
  getBetaAccess: mocks.beta,
  betaCommerceError: () => "Buying is limited to invited beta members.",
}));
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
        return mocks.finalize(args);
      },
      from: (table: string) => {
        if (table === "purchase_attempts") return attemptQuery;
        if (table === "listings") return listingQuery;
        if (table === "payments") return paymentQuery;
        return orderQuery;
      },
    };
  },
}));

import { checkoutCart, completeReservedOrder } from "./checkout-actions";
import { getStripeCustomerId } from "@/lib/payments/customers";

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
  mocks.beta.mockResolvedValue({ enforced: true, eligible: true });
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
  mocks.redirect.mockImplementation((path: string) => { throw new Error(`redirect:${path}`); });
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

it("refuses to replay a bound checkout when its shipping payload changed", async () => {
  const original = durableCartAttempt();
  mocks.attemptRead.mockResolvedValue({ data: original.attempt, error: null });

  const result = await checkoutCart({}, cartCheckoutForm("99 Changed Street"));

  expect(result.error).toContain("details changed");
  expect(mocks.replayOrdersRead).not.toHaveBeenCalled();
  expect(mocks.cartIds).not.toHaveBeenCalled();
  expect(mocks.createPayment).not.toHaveBeenCalled();
});

it("refuses a different service selection on a browser-bound checkout", async () => {
  const original = durableCartAttempt("10 Main Street", "quote-original");
  mocks.attemptRead.mockResolvedValue({ data: original.attempt, error: null });
  const changed = durableCartAttempt("10 Main Street", "quote-changed").form;

  const result = await checkoutCart({}, changed);

  expect(result.error).toContain("shipping service changed");
  expect(mocks.replayOrdersRead).not.toHaveBeenCalled();
  expect(mocks.createPayment).not.toHaveBeenCalled();
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

it("enforces beta access before loading or charging an accepted offer", async () => {
  mocks.beta.mockResolvedValue({ enforced: true, eligible: false });
  const result = await completeReservedOrder({}, checkoutForm());
  expect(result.error).toContain("invited beta");
  expect(mocks.orderRead).not.toHaveBeenCalled();
  expect(mocks.createPayment).not.toHaveBeenCalled();
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

it("reserves nothing when the saved Stripe customer can't be read", async () => {
  mocks.cartIds.mockResolvedValue(["listing-1"]);
  vi.mocked(getStripeCustomerId).mockRejectedValueOnce(new Error("Stripe customer lookup failed"));

  const result = await checkoutCart({}, cartCheckoutForm());

  expect(result.error).toContain("Nothing was charged");
  expect(mocks.purchaseBegin).not.toHaveBeenCalled();
  expect(mocks.createPayment).not.toHaveBeenCalled();
});
