import { beforeEach, expect, it, vi } from "vitest";

/**
 * The offer actions are thin wrappers over offer_move (migration
 * 20261017160000): the database checks turn, round, bounds and limits, and a
 * retried move replays. These tests pin what the wrappers send and how they
 * read the answer; offer_move_guard.sql covers the rules themselves.
 */
const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  rpc: vi.fn(),
  order: vi.fn(),
  insert: vi.fn(),
  redirect: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/rate-limit", () => ({ RATE_LIMITS: {}, allowAction: vi.fn(), rateLimitMessage: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ capture: vi.fn() }));
vi.mock("@/lib/monitoring", () => ({ reportError: vi.fn() }));
vi.mock("@/lib/suspension", () => ({ SUSPENDED_MESSAGE: "suspended", isSuspended: vi.fn().mockResolvedValue(false) }));
vi.mock("@/lib/beta-access", () => ({ getBetaAccess: vi.fn().mockResolvedValue({ eligible: true }), betaCommerceError: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: mocks.auth }, rpc: mocks.rpc }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({
      insert: mocks.insert,
      select: () => ({ eq: () => ({ maybeSingle: mocks.order }) }),
    }),
  }),
}));

import { acceptCounter, counterOffer, respondToOffer, withdrawOffer } from "./offer-actions";

function form(fields: Record<string, string>) {
  const data = new FormData();
  data.set("offer_id", "offer-1");
  data.set("round", "3");
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

const moved = (patch: Record<string, unknown> = {}) => ({ data: { offer_id: "offer-1", round_no: 4, kind: "counter", outcome: "done", replayed: false, order_id: null, ...patch }, error: null });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ data: { user: { id: "seller-1" } } });
  mocks.rpc.mockResolvedValue(moved());
  mocks.order.mockResolvedValue({ data: { buyer_id: "buyer-1", seller_id: "seller-1" }, error: null });
  mocks.insert.mockResolvedValue({ error: null });
});

it("sends a seller counter as one move at the round it was made, keyed so a retry replays", async () => {
  await expect(respondToOffer({}, form({ decision: "countered", counter_amount: "150" }))).resolves.toEqual({ ok: "Counter sent." });
  expect(mocks.rpc).toHaveBeenCalledWith("offer_move", {
    p_offer: "offer-1", p_kind: "counter", p_amount: 15000,
    p_idempotency_key: "counter:offer-1:r3:15000", p_expected_round: 3,
  });
});

it("refuses a move without the round it was made at", async () => {
  const data = form({ decision: "declined" });
  data.delete("round");
  await expect(respondToOffer({}, data)).resolves.toHaveProperty("error");
  expect(mocks.rpc).not.toHaveBeenCalled();
});

it("says plainly when it isn't the member's turn, the offer moved on, or it's settled", async () => {
  for (const [code, text] of [["OF002", "not your turn"], ["OF003", "changed since you opened it"], ["OF005", "already been settled"]]) {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code } });
    const result = await respondToOffer({}, form({ decision: "accepted" }));
    expect(result.error).toContain(text);
  }
});

it("notifies the buyer once on a fresh acceptance, and not again on a replay", async () => {
  mocks.rpc.mockResolvedValueOnce(moved({ kind: "accept", order_id: "order-1" }));
  await expect(respondToOffer({}, form({ decision: "accepted" }))).resolves.toEqual({ ok: "Offer accepted — the buyer has 24 hours to complete checkout." });
  expect(mocks.insert).toHaveBeenCalledTimes(1);
  mocks.rpc.mockResolvedValueOnce(moved({ kind: "accept", order_id: "order-1", replayed: true }));
  await respondToOffer({}, form({ decision: "accepted" }));
  expect(mocks.insert).toHaveBeenCalledTimes(1);
});

it("tells the seller when the buyer couldn't be notified of an acceptance", async () => {
  mocks.rpc.mockResolvedValueOnce(moved({ kind: "accept", order_id: "order-1" }));
  mocks.insert.mockResolvedValueOnce({ error: { message: "down" } });
  const result = await respondToOffer({}, form({ decision: "accepted" }));
  expect(result.ok).toContain("couldn't notify the buyer");
});

it("reports an expired turn instead of a success", async () => {
  mocks.rpc.mockResolvedValueOnce(moved({ kind: "expire", outcome: "expired" }));
  await expect(withdrawOffer({}, form({}))).resolves.toEqual({ error: "This offer has expired." });
});

it("sends a buyer counter-back and explains a below-minimum one without naming the number", async () => {
  mocks.auth.mockResolvedValue({ data: { user: { id: "buyer-1" } } });
  await expect(counterOffer({}, form({ counter_amount: "120" }))).resolves.toEqual({ ok: "Counter-offer sent." });
  expect(mocks.rpc).toHaveBeenCalledWith("offer_move", expect.objectContaining({ p_kind: "counter", p_amount: 12000, p_expected_round: 3 }));
  mocks.rpc.mockResolvedValueOnce(moved({ kind: "below_minimum", outcome: "below_minimum" }));
  const result = await counterOffer({}, form({ counter_amount: "90" }));
  expect(result.error).toContain("lower than the seller will accept");
  expect(result.error).not.toMatch(/\$\d/);
  mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: "OF001" } });
  await expect(counterOffer({}, form({ counter_amount: "130" }))).resolves.toEqual({ error: "You've used your 3 offers on this part." });
});

it("takes the buyer to checkout for the order an accepted counter opened", async () => {
  mocks.auth.mockResolvedValue({ data: { user: { id: "buyer-1" } } });
  mocks.rpc.mockResolvedValueOnce(moved({ kind: "accept", order_id: "order-9", replayed: true }));
  await acceptCounter({}, form({}));
  expect(mocks.redirect).toHaveBeenCalledWith("/orders/order-9/checkout");
});
