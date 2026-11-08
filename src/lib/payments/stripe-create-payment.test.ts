import { beforeEach, describe, expect, it, vi } from "vitest";
import Stripe from "stripe";

const state = vi.hoisted(() => ({
  rpc: vi.fn(),
  create: vi.fn(),
  retrieve: vi.fn(),
  stampError: null as { message: string } | null,
  settings: { data: [] as unknown[] | null, error: null as { message: string } | null },
}));

vi.mock("@/lib/monitoring", () => ({ reportError: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    rpc: state.rpc,
    from: (table: string) =>
      table === "settlement_settings"
        ? { select: () => ({ limit: async () => state.settings }) }
        : { update: () => ({ in: async () => ({ error: state.stampError }) }) },
  }),
}));
vi.mock("stripe", async (importOriginal) => {
  const actual = await importOriginal<{ default: typeof Stripe }>();
  class FakeStripe {
    paymentIntents = { create: state.create, retrieve: state.retrieve };
    static errors = actual.default.errors;
  }
  return { default: FakeStripe };
});

import { SELLER_PAYOUTS_OFF_REASON, StripePaymentProvider, provablyNotCreated } from "./stripe";

const request = {
  orderId: "order-b,order-a",
  buyerId: "buyer-1",
  sellerId: "multiple",
  totalCents: 30,
  currency: "USD",
  idempotencyKey: "checkout-key",
  customerId: null,
};

function invalidRequest(code: string, statusCode = 400) {
  return Stripe.errors.StripeError.generate({
    type: "invalid_request_error",
    code,
    message: code,
    statusCode,
  } as never);
}

function prepared(overrides: Record<string, unknown> = {}) {
  return {
    data: { correlation_id: "corr-1", reference: null, created_at: new Date().toISOString(), ...overrides },
    error: null,
  };
}

beforeEach(() => {
  process.env.STRIPE_SECRET_KEY = "sk_test_unit";
  state.rpc.mockReset();
  state.create.mockReset();
  state.retrieve.mockReset();
  state.stampError = null;
  state.settings = { data: [], error: null };
});

describe("provablyNotCreated", () => {
  it("accepts only a 400 validation refusal", () => {
    expect(provablyNotCreated(invalidRequest("amount_too_small"))).toBe(true);
    expect(provablyNotCreated(invalidRequest("resource_missing", 404))).toBe(false);
    expect(provablyNotCreated(invalidRequest("idempotency_key_in_use"))).toBe(false);
    expect(
      provablyNotCreated(
        Stripe.errors.StripeError.generate({ type: "idempotency_error", message: "x", statusCode: 400 } as never)
      )
    ).toBe(false);
    expect(
      provablyNotCreated(Stripe.errors.StripeError.generate({ type: "api_error", message: "x", statusCode: 500 } as never))
    ).toBe(false);
    expect(provablyNotCreated(new Error("socket hang up"))).toBe(false);
  });
});

describe("StripePaymentProvider.createPayment", () => {
  it("refuses an out-of-bounds amount before persisting anything", async () => {
    const result = await new StripePaymentProvider().createPayment(request);
    expect(result.status).toBe("failed");
    expect(state.rpc).not.toHaveBeenCalled();
    expect(state.create).not.toHaveBeenCalled();
  });

  it("records a provider refusal so the reservation is released", async () => {
    state.rpc.mockImplementation(async (name: string) =>
      name === "prepare_payment_request" ? prepared() : { data: { rejected: true, released: 2 }, error: null }
    );
    state.create.mockRejectedValue(invalidRequest("amount_too_small"));
    const result = await new StripePaymentProvider().createPayment({ ...request, totalCents: 5000 });
    expect(result).toEqual({ status: "failed", reason: "card payments must come to between $0.50 and $999,999.99" });
    expect(state.rpc).toHaveBeenCalledWith("record_payment_request_rejection", {
      p_key: expect.stringMatching(/^checkout:/),
      p_reason: "amount_too_small",
    });
  });

  it("never calls Stripe when the database refuses a new payment for a seller whose payouts are off", async () => {
    // 20261107210050: payouts switched off after an offer was accepted.
    state.rpc.mockResolvedValue({ data: null, error: { code: "LS001", message: "This seller can't take payment yet" } });
    const result = await new StripePaymentProvider().createPayment({ ...request, totalCents: 5000 });
    expect(result).toEqual({ status: "failed", reason: SELLER_PAYOUTS_OFF_REASON });
    expect(state.create).not.toHaveBeenCalled();
    expect(state.retrieve).not.toHaveBeenCalled();
    expect(state.rpc).toHaveBeenCalledTimes(1);
  });

  it("keeps an uncertain create unresolved", async () => {
    state.rpc.mockResolvedValue(prepared());
    state.create.mockRejectedValue(
      Stripe.errors.StripeError.generate({ type: "api_error", message: "x", statusCode: 500 } as never)
    );
    const result = await new StripePaymentProvider().createPayment({ ...request, totalCents: 5000 });
    expect(result.status).toBe("unknown");
    expect(state.rpc).not.toHaveBeenCalledWith("record_payment_request_rejection", expect.anything());
  });

  it("stays unresolved when the refusal can't be recorded", async () => {
    state.rpc.mockImplementation(async (name: string) =>
      name === "prepare_payment_request" ? prepared() : { data: null, error: { message: "timeout" } }
    );
    state.create.mockRejectedValue(invalidRequest("amount_too_small"));
    const result = await new StripePaymentProvider().createPayment({ ...request, totalCents: 5000 });
    expect(result.status).toBe("unknown");
  });

  it("hands back the payment even when the diagnostics stamp fails", async () => {
    state.rpc.mockImplementation(async (name: string) =>
      name === "prepare_payment_request" ? prepared() : { data: true, error: null }
    );
    state.create.mockResolvedValue({ id: "pi_1", status: "requires_payment_method", client_secret: "secret_1" });
    state.stampError = { message: "timeout" };
    const result = await new StripePaymentProvider().createPayment({ ...request, totalCents: 5000 });
    expect(result).toEqual({ status: "requires_action", reference: "pi_1", clientSecret: "secret_1" });
    const { reportError } = await import("@/lib/monitoring");
    expect(reportError).toHaveBeenCalledWith("[stripe] order correlation stamp failed", expect.anything());
  });

  it("never sends a rejected request to Stripe again", async () => {
    state.rpc.mockResolvedValue(prepared({ rejected: true }));
    const result = await new StripePaymentProvider().createPayment({ ...request, totalCents: 5000 });
    expect(result.status).toBe("failed");
    expect(state.create).not.toHaveBeenCalled();
  });

  describe("card verification", () => {
    const settings = {
      receipt_release_after_days: 3,
      card_verification_from_cents: 50000,
    };

    beforeEach(() => {
      state.rpc.mockImplementation(async (name: string) =>
        name === "prepare_payment_request" ? prepared() : { data: true, error: null }
      );
      state.create.mockResolvedValue({ id: "pi_1", status: "requires_payment_method", client_secret: "secret_1" });
    });

    it("asks the card's bank to verify a payment at the owner's threshold", async () => {
      state.settings = { data: [settings], error: null };
      await new StripePaymentProvider().createPayment({ ...request, totalCents: 50000 });
      expect(state.create.mock.calls[0][0]).toMatchObject({
        payment_method_options: { card: { request_three_d_secure: "any" } },
      });
    });

    it("leaves it to Stripe below the threshold, when switched off, or when unreadable", async () => {
      state.settings = { data: [settings], error: null };
      await new StripePaymentProvider().createPayment({ ...request, totalCents: 49999 });
      state.settings = { data: [{ ...settings, card_verification_from_cents: null }], error: null };
      await new StripePaymentProvider().createPayment({ ...request, totalCents: 90000 });
      state.settings = { data: null, error: { message: "timeout" } };
      await new StripePaymentProvider().createPayment({ ...request, totalCents: 90000 });
      for (const [params] of state.create.mock.calls) expect(params).not.toHaveProperty("payment_method_options");
    });
  });
});
